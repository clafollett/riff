import { test, expect, type Page } from '@playwright/test';

/**
 * The Desk exists because the work was unreachable. So every assertion here
 * is about reaching something — a draft you can read in full, a document
 * under its own title, a report line, a reason that lands on the author.
 * A screenshot proves the pixels arrived; these prove the content did.
 */

const go = async (page: Page, view: string) => {
  await page.getByRole('button', { name: new RegExp(`^${view}`) }).click();
  // The view's own heading is the first one. Rendered agent prose contributes
  // headings of its own further down the page.
  await expect(page.locator('main h1').first()).toContainText(new RegExp(view, 'i'));
};

/**
 * Select a company by name through the switcher. The console remembers the
 * last one across reloads, so tests state which company they mean rather than
 * inheriting whatever the previous test left open.
 */
const useCompany = async (page: Page, name: string) => {
  if ((await page.locator('.co').innerText()).trim() === name) return;
  // The switcher is a toggle, so clicking blind can close a menu a previous
  // step left open. Open it deliberately.
  const menu = page.locator('.menu');
  if (!(await menu.isVisible())) await page.locator('.switcher').click();
  await expect(menu).toBeVisible();
  await menu.locator('.menuitem').filter({ hasText: name }).first().click();
  await expect(page.locator('.co')).toHaveText(name);
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.co')).not.toBeEmpty();
  await useCompany(page, 'Testwright Co');
});

test('the rail names the company and counts what is waiting', async ({ page }) => {
  await expect(page.locator('.brand .biz')).toHaveText('proving the console renders');
  await expect(page.locator('.navitem').filter({ hasText: 'Envelope' }).locator('.pill')).toHaveText('1');
  await expect(page.locator('.status')).toContainText('1 waiting on you');
});

test('the envelope shows the whole draft, not a summary of it', async ({ page }) => {
  const item = page.locator('.item').first();
  // The name a person is called by, not the tool handle.
  await expect(item.locator('.who')).toHaveText('Fen');
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
  await expect(page.locator('.navitem').filter({ hasText: 'Envelope' }).locator('.pill')).toHaveCount(0);
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
  await expect(page.locator('.reader .title')).toHaveText('What we are for');
  await expect(page.locator('.reader .body h2').first()).toHaveText('What we are for');
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

test('the feed shows what already happened, then keeps up', async ({ page }) => {
  await go(page, 'Feed');
  // The stream carries only what arrives while you watch, so the feed used to
  // open blank however busy the company had been. It seeds from history now.
  const seeded = await page.locator('.feed li').count();
  expect(seeded).toBeGreaterThan(0);
  // And it names people rather than printing their tool handles.
  await expect(page.locator('.feed .actor').first()).not.toHaveText(/^[a-z_]+$/);

  await page.evaluate(async () => {
    await fetch('/api/say', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'fen', text: 'A word from the board.' }),
    });
  });

  await expect(page.locator('.feed')).toContainText('A word from the board.', { timeout: 15_000 });
  expect(await page.locator('.feed li').count()).toBeGreaterThan(seeded);
});

test('mail addressed to the board is readable, and says so before you look', async ({ page }) => {
  // Agents wrote to the chair from the first hour and the console had no
  // inbox at all — the message existed and the only way in was a SQL query.
  await expect(page).toHaveTitle(/^\(\d+\) The Desk$/);
  await expect(page.locator('.navitem').filter({ hasText: 'Inbox' }).locator('.pill')).toHaveText('2');

  await go(page, 'Inbox');
  await expect(page.locator('.msg')).toHaveCount(2);
  await expect(page.locator('.msg.unread')).toHaveCount(2);
  // The body renders as prose, not as raw markdown.
  await expect(page.locator('.msg .body h2').first()).toHaveText('The noise floor is real');
  await expect(page.locator('.msg .body strong').first()).toHaveText('Nothing needs you yet');
});

test('opening a message reads it, and the badge follows', async ({ page }) => {
  await go(page, 'Inbox');
  await page.locator('.msg').first().locator('header').click();
  await expect(page.locator('.msg.unread')).toHaveCount(1);
  await expect(page.locator('.navitem').filter({ hasText: 'Inbox' }).locator('.pill')).toHaveText('1');

  await page.getByRole('button', { name: /Mark all read/ }).click();
  await expect(page.locator('.msg.unread')).toHaveCount(0);
  await expect(page.locator('.navitem').filter({ hasText: 'Inbox' }).locator('.pill')).toHaveCount(0);
  // Nothing outstanding, so the tab stops shouting.
  await expect(page).toHaveTitle('The Desk');
});

test('a reply reaches the person who wrote to you', async ({ page }) => {
  await go(page, 'Inbox');
  const first = page.locator('.msg').first();
  await first.locator('header').click();
  await first.getByRole('button', { name: 'Reply' }).click();
  await first.locator('textarea').fill('Understood — publish the detection floor beside it.');
  await first.getByRole('button', { name: 'Send' }).click();

  await go(page, 'Feed');
  await expect(page.locator('.feed')).toContainText('publish the detection floor');
});

test('the console updates itself as the company works', async ({ page }) => {
  // Views used to load once on mount, so anything the company did while you
  // were looking at a page simply did not appear until you navigated away and
  // back. Nothing here reloads the page.
  const seq = () => page.locator('.status').innerText();
  const before = await seq();

  // Straight at the API, not through the console, so this proves the console
  // noticed rather than that it remembered what it just did.
  await page.evaluate(async () => {
    await fetch('/api/say', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to: 'fen', text: 'Something new happened.' }),
    });
  });

  // The status bar carries the event count, and it must move on its own.
  await expect.poll(seq, { timeout: 15_000 }).not.toEqual(before);

  // And the feed shows it without a reload.
  await go(page, 'Feed');
  await expect(page.locator('.feed')).toContainText('Something new happened.');
});

test('the console holds together on a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await go(page, 'Staff');
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test.describe('many companies, one console', () => {
  // These run last and in order: each builds on the previous one's state, and
  // the console remembers which company was open, so the shared beforeEach
  // that expects Testwright does not apply here.
  test.describe.configure({ mode: 'serial' });

  test('a company can be founded from the console and becomes active', async ({ page }) => {
    await page.locator('.switcher').click();
    await page.getByRole('button', { name: 'Manage companies…' }).click();
    await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible();

    await page.getByRole('button', { name: 'Found a company' }).click();
    await page.getByLabel('Company name').fill('Kestrel Provisioning');
    await page.getByLabel('Line of business').fill('field logistics');
    await page.getByLabel("CEO's name").fill('Rook');
    await page.getByLabel('Chairman').fill('Tester');
    await page.getByRole('button', { name: 'Found it' }).click();

    // The new company becomes active, and lands in the switcher — it once did
    // the first without the second, because switching unmounted the view whose
    // event refreshed the list.
    await expect(page.locator('.co')).toHaveText('Kestrel Provisioning');
    await page.locator('.switcher').click();
    await expect(page.locator('.menuitem').filter({ hasText: 'Kestrel' })).toHaveCount(1);
    await expect(page.locator('.menuitem').filter({ hasText: 'Testwright' })).toHaveCount(1);
  });

  test('a founded company starts with a CEO and nothing else', async ({ page }) => {
    await useCompany(page, 'Kestrel Provisioning');
    // One agent, no commons, no roster. The CEO builds the rest.
    await expect(page.locator('.status')).toContainText('1 staff');
    await expect(page.locator('.status')).toContainText('commons 0/40');
  });

  test('switching companies does not leak one world into another', async ({ page }) => {
    const read = async () => (await page.locator('.status').innerText()).replace(/\s+/g, ' ');

    await useCompany(page, 'Testwright Co');
    const testwright = await read();

    await useCompany(page, 'Kestrel Provisioning');
    const kestrel = await read();

    expect(testwright).not.toEqual(kestrel);
    // Testwright has a CEO and a lead; a company founded a moment ago has only
    // its CEO. Board members are not counted as staff.
    expect(testwright).toContain('2 staff');
    expect(testwright).toContain('commons 2/40');
    expect(kestrel).toContain('1 staff');
    expect(kestrel).toContain('commons 0/40');

    // The commons of one must not be readable while the other is selected.
    await go(page, 'Commons');
    await expect(page.locator('.doc')).toHaveCount(0);
  });

  test('archiving asks for the name, then removes it from the list', async ({ page }) => {
    await page.locator('.switcher').click();
    await page.getByRole('button', { name: 'Manage companies…' }).click();

    await page.locator('.card', { hasText: 'Kestrel' }).getByRole('button', { name: 'Archive' }).click();
    const confirm = page.getByRole('button', { name: 'Archive it' });

    // Armed only by typing the name — the same friction any tool asks for
    // before it moves a repository.
    await expect(confirm).toBeDisabled();
    await page.locator('.dialog input').fill('Wrong Name');
    await expect(confirm).toBeDisabled();
    await page.locator('.dialog input').fill('Kestrel Provisioning');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(page.locator('.card')).toHaveCount(1);
    await expect(page.locator('.card')).toContainText('Testwright Co');
  });
});
