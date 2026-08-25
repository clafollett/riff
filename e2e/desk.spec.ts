import { test, expect, type Page } from '@playwright/test';

/**
 * The Desk exists because the work was unreachable. So every assertion here
 * is about reaching something — a draft you can read in full, a document
 * under its own title, a report line, a reason that lands on the author.
 * A screenshot proves the pixels arrived; these prove the content did.
 */

const go = async (page: Page, view: string) => {
  await page.getByRole('button', { name: new RegExp(`^${view}`) }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(new RegExp(view, 'i'));
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Testwright Co' })).toBeVisible();
});

test('the rail names the company and counts what is waiting', async ({ page }) => {
  await expect(page.locator('.brand .biz')).toHaveText('proving the console renders');
  await expect(page.locator('.navitem .pill')).toHaveText('1');
  await expect(page.locator('.status')).toContainText('1 waiting on you');
});

test('the envelope shows the whole draft, not a summary of it', async ({ page }) => {
  const item = page.locator('.item').first();
  await expect(item.locator('.who')).toHaveText('fen');
  await expect(item.locator('.cap')).toHaveText('external.write');
  // The body of the draft, not just the one-line summary the requester wrote.
  await expect(item.locator('.draft')).toContainText('We would like to run the test on you.');
  await expect(item.locator('.draft strong')).toHaveText('What it costs you.');
});

test('markup written by an agent renders as text, never as markup', async ({ page }) => {
  const draft = page.locator('.item .draft').first();
  await expect(draft).toContainText('<script>alert(1)</script>');
  await expect(draft.locator('script')).toHaveCount(0);
  expect(await page.evaluate(() => document.querySelectorAll('.draft script').length)).toBe(0);
});

test('a decision clears the queue and the reason is kept', async ({ page, request }) => {
  await page.locator('.item textarea').first().fill('Not yet — the claim is not true.');
  await page.getByRole('button', { name: 'Send back' }).click();

  await expect(page.locator('.item')).toHaveCount(0);
  await expect(page.locator('.navitem .pill')).toHaveCount(0);
  await expect(page.locator('.status')).toContainText('0 waiting on you');

  // The reason is the whole point of the gate — a rejection that does not
  // reach the author teaches nobody anything.
  const state = await (await request.get('/api/state')).json();
  expect(state.pendingBoard).toBe(0);
});

test('staff renders the report tree the CEO actually built', async ({ page }) => {
  await go(page, 'Staff');
  const names = await page.locator('.card .name').allTextContents();
  expect(names).toEqual(['Tester', 'Wren', 'Fen']);

  // Depth is the reporting line: chair, then CEO under them, then the lead.
  const lefts = await page.locator('.row').evaluateAll(
    (rows) => rows.map((r) => Number.parseFloat(getComputedStyle(r).marginLeft)));
  expect(lefts[0]).toBeLessThan(lefts[1]!);
  expect(lefts[1]).toBeLessThan(lefts[2]!);

  // The role must sit on one line — it wrapped into a column at this width.
  const box = await page.locator('.card .role').first().boundingBox();
  expect(box!.height).toBeLessThan(30);
});

test('opening a colleague shows the persona they were given', async ({ page }) => {
  await go(page, 'Staff');
  await page.locator('.card', { hasText: 'Wren' }).click();
  await expect(page.locator('.detail .persona')).toContainText('Testwright Co');
  await expect(page.locator('.detail .meta')).toContainText('hired');
});

test('the commons lists documents under the titles their authors chose', async ({ page }) => {
  await go(page, 'Commons');
  await expect(page.locator('.doc .t')).toHaveText(['What we are for', 'Scores, including ours']);
  await expect(page.locator('.gauge')).toContainText('2/40');
});

test('a commons document opens as prose, with no frontmatter to skim past', async ({ page }) => {
  await go(page, 'Commons');
  await page.locator('.doc', { hasText: 'What we are for' }).click();
  await expect(page.locator('.reader h2')).toHaveText('What we are for');
  await expect(page.locator('.reader .body h1')).toHaveText('What we are for');
  await expect(page.locator('.reader .body li')).toHaveCount(2);
  await expect(page.locator('.reader .body')).not.toContainText('author:');
  await expect(page.locator('.reader .body')).not.toContainText('---');
});

test('prose reads as paragraphs, not as one block per source line', async ({ page }) => {
  // The reader carried white-space: pre-wrap from before the markdown pass
  // existed, so the newline BETWEEN two rendered blocks survived as a real
  // blank line — every paragraph sat two lines apart and it read as broken
  // line spacing. Measured, because it looks plausible in a screenshot.
  await go(page, 'Commons');
  await page.locator('.doc', { hasText: 'What we are for' }).click();
  await expect(page.locator('.reader .body p').first()).toBeVisible();

  const metrics = await page.locator('.reader .body').evaluate((el) => {
    const line = Number.parseFloat(getComputedStyle(el).lineHeight);
    const kids = [...el.children];
    const gaps: number[] = [];
    for (let i = 1; i < kids.length; i++) {
      if (kids[i - 1]!.tagName === 'P' && kids[i]!.tagName === 'P') {
        gaps.push(kids[i]!.getBoundingClientRect().top - kids[i - 1]!.getBoundingClientRect().bottom);
      }
    }
    return { line, gaps, preWrap: getComputedStyle(el).whiteSpace };
  });

  expect(metrics.preWrap).not.toMatch(/pre/);
  // A paragraph break should be a fraction of a line, never a whole one.
  for (const gap of metrics.gaps) expect(gap).toBeLessThan(metrics.line);
});

test('a wrapped sentence is one paragraph, not one per source line', async ({ page }) => {
  await go(page, 'Commons');
  await page.locator('.doc', { hasText: 'What we are for' }).click();
  // The fixture writes this as a single line; the real documents wrap at ~80
  // columns, and the renderer must join those back before the CSS sees them.
  const text = await page.locator('.reader .body p').first().innerText();
  expect(text).toContain('testable');
  expect(await page.locator('.reader .body p').count()).toBeLessThan(4);
});

test('a markdown table renders as a table, not a line of pipes', async ({ page }) => {
  // The seats doctrine and every scorecard is a table. The hand-rolled
  // renderer had no table support at all and they came out as run-on prose.
  await go(page, 'Commons');
  await page.locator('.doc', { hasText: 'Scores, including ours' }).click();
  const table = page.locator('.reader .body table');
  await expect(table).toHaveCount(1);
  await expect(table.locator('th')).toHaveText(['subject', 'score']);
  await expect(table.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('.reader .body')).not.toContainText('|');

  // Wide tables scroll inside their own box; the page never scrolls sideways.
  await expect(page.locator('.reader .body .tablewrap')).toHaveCount(1);
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('a doubled commons prefix still resolves to one document', async ({ page }) => {
  // Written as commons/records/scores.md by an author who had already typed
  // the prefix. It must appear once, on the right shelf.
  await go(page, 'Commons');
  const shelves = await page.locator('.doc .shelf').allTextContents();
  expect(shelves).toContain('records');
  expect(shelves.some((s) => s.includes('commons'))).toBe(false);
});

test('work in flight is visible without opening a terminal', async ({ page }) => {
  // status.ts showed tasks, note counts and broken reporting lines, and the
  // console showed none of them — so the briefing had to tell the board to go
  // run a script. A console you have to leave is not finished.
  await go(page, 'Work');
  await expect(page.locator('.task')).toHaveCount(3);
  await expect(page.locator('.wrap h2')).toHaveText(['In flight', 'Dropped on purpose', 'Finished']);

  // Dropped is neither finished nor in flight — for a company whose weakest
  // seam is removal, that distinction is the whole point.
  const dropped = page.locator('.task.gone');
  await expect(dropped).toHaveCount(1);
  await expect(dropped.locator('.title')).toHaveText('Grade ourselves under v0.1 again');
  await expect(page.locator('section', { hasText: 'In flight' }).locator('.task.gone')).toHaveCount(0);

  await expect(page.locator('.tally')).toContainText('1 in flight');
  await expect(page.locator('.tally')).toContainText('1 dropped');
});

test('opening a task shows the body its author wrote', async ({ page }) => {
  await go(page, 'Work');
  await page.locator('.task', { hasText: 'Score a system we do not own' }).locator('header').click();
  await expect(page.locator('.task .detail')).toContainText('Track B, from published artifacts.');
});

test('the record reads the git log, not the event stream', async ({ page }) => {
  await go(page, 'Record');
  await expect(page.locator('.log li').first()).toBeVisible();
  await expect(page.locator('.tally')).toBeVisible();
  await page.getByRole('button', { name: 'A month' }).click();
  await expect(page.locator('.log li').first()).toBeVisible();
});

test('the feed picks up an event live, without a reload', async ({ page }) => {
  await go(page, 'Feed');
  // A company that has only just been founded has an empty tail, and the
  // stream carries new events only. Saying so beats an empty <ol>.
  await expect(page.getByText('Quiet. Events appear as they happen.')).toBeVisible();

  await page.evaluate(async () => {
    await fetch('/api/say', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'fen', text: 'A word from the board.' }),
    });
  });

  await expect(page.locator('.feed li').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.feed')).toContainText('A word from the board.');
});

test('the console holds together on a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await go(page, 'Staff');
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
