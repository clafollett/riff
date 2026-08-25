import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * UI regression tests.
 *
 * Every test here exists because the bug it describes actually shipped. All of
 * them were invisible to screenshot review, which is the whole point: a
 * screenshot cannot tell you a button is unclickable or that an element
 * measures 0x0 while looking perfectly fine.
 */

const errors = (page: Page): string[] => {
  const found: string[] = [];
  page.on('console', (m: ConsoleMessage) => { if (m.type() === 'error') found.push(m.text()); });
  page.on('pageerror', (e) => found.push(`pageerror: ${e.message}`));
  return found;
};

test.describe('the village loads', () => {
  test('renders without console errors', async ({ page }) => {
    const found = errors(page);
    await page.goto('/');
    await expect(page.locator('#n-staff')).toHaveText('12');
    expect(found, `console errors: ${found.join(' | ')}`).toEqual([]);
  });

  test('the canvas actually paints — not a blank rectangle', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#n-staff')).toHaveText('12');
    await page.waitForTimeout(500);           // let a few frames land

    const distinct = await page.evaluate(() => {
      const c = document.querySelector('canvas') as HTMLCanvasElement;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      const seen = new Set<string>();
      for (let i = 0; i < d.length; i += 4 * 997) seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
      return seen.size;
    });
    expect(distinct, 'canvas looks like a flat fill').toBeGreaterThan(8);
  });

  test('the event stream connects', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#n-staff')).toHaveText('12');
    await expect(page.locator('#n-inn')).not.toHaveText('disconnected');
  });
});

test.describe('HUD controls are reachable', () => {
  // REGRESSION: #hud carries pointer-events:none so you can walk "under" it.
  // The buttons are not .chip, so they inherited it and were unclickable for
  // their entire existence. A screenshot showed them looking completely fine.
  for (const id of ['btn-open', 'btn-meeting']) {
    test(`${id} actually receives pointer events`, async ({ page }) => {
      await page.goto('/');
      const btn = page.locator(`#${id}`);
      await expect(btn).toBeVisible();
      await expect(btn).toBeEnabled();

      const blocked = await btn.evaluate((el) => getComputedStyle(el).pointerEvents === 'none');
      expect(blocked, `${el_msg(id)}`).toBe(false);

      // Playwright's actionability check fails if something covers it or it
      // cannot receive the click — this is the real assertion.
      await btn.click({ trial: true, timeout: 3000 });
    });
  }
});

const el_msg = (id: string) => `#${id} has pointer-events:none — it cannot be clicked`;

/**
 * Ordering matters here, so it is stated rather than implied.
 *
 * Tests share one village. "Calling a meeting" summons every staff member to
 * the Inn, which parks them ~17 tiles from the Keeper — just off the right edge
 * of the canvas. Anything that needs to click a colleague must therefore run
 * BEFORE that, while people are still at their own doors. Playwright runs
 * declaration order with a single worker.
 */
test.describe('walking and talking', () => {
  /**
   * Deliberately walks to the target rather than assuming anyone is nearby.
   *
   * An earlier version clicked wherever the nearest agent happened to be, which
   * passed alone and failed in the suite: the meeting test summons everyone to
   * the Inn, leaving the keeper seventeen tiles away and the click landing in
   * the side panel. Walking makes the test independent of what ran before it,
   * and exercises movement on the way.
   */
  test('walk to a colleague, select them, and send a message', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#n-staff')).toHaveText('12');
    await page.waitForTimeout(400);

    const target = await page.evaluate(async () => {
      const st = await fetch('/api/state').then((r) => r.json());
      const me = st.inn.rules.innkeeper;
      const pos: Record<string, any> = Object.fromEntries(st.positions.map((p: any) => [p.agentId, p]));
      const mine = pos[me];
      const other = st.staff
        .filter((a: any) => a.id !== me && pos[a.id])
        .map((a: any) => ({ a, d: Math.hypot(pos[a.id].x - mine.x, pos[a.id].y - mine.y) }))
        .sort((p: any, q: any) => p.d - q.d)[0].a;
      return {
        name: other.name,
        dx: Math.round(pos[other.id].x - mine.x),
        dy: Math.round(pos[other.id].y - mine.y),
      };
    });

    // Click where they stand. Selection does not require proximity — and it
    // must not require walking, because buildings are solid and a naive
    // straight-line walk jams into a wall (which is the collision working).
    const at = await page.evaluate((d: { dx: number; dy: number }) => {
      const c = document.querySelector('canvas') as HTMLCanvasElement;
      const t = 32;
      return { x: c.width / 2 + d.dx * t, y: c.height / 2 + d.dy * t, w: c.width, h: c.height };
    }, { dx: target.dx, dy: target.dy });

    expect(at.x, 'target is off-canvas — did an earlier test move everyone?').toBeGreaterThan(0);
    expect(at.x).toBeLessThan(at.w);
    await page.locator('canvas').click({ position: { x: at.x, y: at.y } });

    await expect(page.locator('#sel')).toHaveClass(/on/);
    await expect(page.locator('#sel .nm')).toHaveText(target.name);

    await page.locator('#btn-talk').click();
    await expect(page.locator('#dlg h3')).toContainText(target.name);
    await page.locator('#dlg-text').fill('Where are you up to?');
    await page.locator('#dlg-ok').click();
    await expect(page.locator('#toast')).toContainText(/Sent to/);
  });
});

test.describe('calling a meeting', () => {
  // REGRESSION: this used window.prompt(), which THROWS in embedded browsers
  // ("prompt() is not supported"), killing the handler on its first line.
  test('opens an in-page dialog, not a native prompt', async ({ page }) => {
    const found = errors(page);
    await page.goto('/');
    await page.locator('#btn-meeting').click();

    await expect(page.locator('#veil')).toHaveClass(/on/);
    await expect(page.locator('#dlg h3')).toHaveText(/Call everyone to the Inn/i);
    await expect(page.locator('#dlg-text')).toBeFocused();
    expect(found).toEqual([]);
  });

  test('cancel closes it and sends nothing', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-meeting').click();
    await page.locator('#dlg-cancel').click();
    await expect(page.locator('#veil')).not.toHaveClass(/on/);
  });

  test('sending summons the staff and reports back', async ({ page }) => {
    await page.goto('/');
    await page.locator('#btn-meeting').click();
    await page.locator('#dlg-text').fill('What do you each need from me?');
    await page.locator('#dlg-ok').click();

    await expect(page.locator('#toast')).toHaveClass(/on/);
    await expect(page.locator('#toast')).toContainText(/Summoned \d+ to the Inn/);
    await expect(page.locator('#veil')).not.toHaveClass(/on/);
  });
});

test.describe('morale', () => {
  // REGRESSION: .fill is a <span>, which is display:inline — and inline boxes
  // ignore width and height. The bars carried a correct background colour and
  // silently measured 0x0.
  test('bars have real width, not zero', async ({ page }) => {
    await page.goto('/');
    const fills = page.locator('#morale .fill');
    await expect(fills.first()).toBeVisible();

    const boxes = await fills.evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { w: r.width, h: r.height, display: getComputedStyle(e).display };
      }));

    expect(boxes.length).toBeGreaterThan(0);
    for (const b of boxes) {
      expect(b.display, 'inline boxes ignore width/height').not.toBe('inline');
      expect(b.h, 'bar has no height').toBeGreaterThan(0);
    }
    expect(Math.max(...boxes.map((b) => b.w)), 'every bar measured zero width').toBeGreaterThan(0);
  });

  test('one row per staff member, and each explains itself', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#morale .m-row')).toHaveCount(11);   // 12 minus the keeper
    await expect(page.locator('#morale .why').first()).not.toBeEmpty();
  });
});

test.describe('the envelope', () => {
  test('a pending draft renders with its summary', async ({ page }) => {
    await page.goto('/');
    const card = page.locator('#approvals .card').first();
    await expect(card).toBeVisible();
    await expect(card).toContainText('posy');
    await expect(card).toContainText('Publish 3 Etsy listings');
    await expect(page.locator('#n-appr')).toHaveText('1');
  });

  test('approving clears it from the envelope', async ({ page }) => {
    await page.goto('/');
    await page.locator('#approvals .card button.go').first().click();
    await expect(page.locator('#approvals .empty')).toBeVisible();
    await expect(page.locator('#n-appr')).toHaveText('0');
  });
});
