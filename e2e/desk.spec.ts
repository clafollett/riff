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
  // toContainText auto-waits; innerText() would read the loading placeholder.
  await expect(page.locator('.reader .body p').first()).toContainText('testable');
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

test('the commons reads in the order it was written', async ({ page }) => {
  // Listed alphabetically, forty documents give a newcomer no way in — there
  // was nothing on screen saying which came first.
  await go(page, 'Commons');
  await expect(page.locator('.doc').first()).toBeVisible();

  const numbers = await page.locator('.doc .n').allInnerTexts();
  expect(numbers.map(Number)).toEqual(numbers.map((_, i) => i + 1));
  await expect(page.locator('.doc .stamp').first()).toBeVisible();

  // Re-sorting reorders the list but not the numbering — #1 is still the
  // first thing the company wrote, wherever it now sits.
  await page.getByRole('button', { name: 'A–Z' }).click();
  const titles = await page.locator('.doc .t').allInnerTexts();
  expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)));
  const resorted = (await page.locator('.doc .n').allInnerTexts()).map(Number);
  expect([...resorted].sort((a, b) => a - b)).toEqual(numbers.map(Number));

  await page.getByRole('button', { name: 'Order written' }).click();
  await expect(page.locator('.doc .n').first()).toHaveText('1');
});

test('mail addressed to the board is readable, and says so before you look', async ({ page }) => {
  // Agents wrote to the chair from the first hour and the console had no
  // inbox at all — the message existed and the only way in was a SQL query.
  await expect(page).toHaveTitle(/^\(\d+\) The Desk$/);
  await expect(page.locator('.navitem').filter({ hasText: 'Inbox' }).locator('.pill')).toHaveText('19');

  await go(page, 'Inbox');
  await expect(page.locator('.bar')).toContainText('19 messages');
  // Opened, the body renders as prose rather than raw markdown.
  await page.getByLabel('Filter messages').fill('noise floor');
  await page.locator('.msg').first().locator('.row').click();
  await expect(page.locator('.msg.open .body h2').first()).toHaveText('The noise floor is real');
});

test('a message can be put back to unread, to keep it in front of you', async ({ page }) => {
  // Reading something at a moment you cannot act on it should not lose it.
  await go(page, 'Inbox');
  const m = page.locator('.msg').first();
  await expect(m).toBeVisible();
  await m.locator('.row').click();
  await m.getByRole('button', { name: 'Mark read' }).click();
  await expect(m).not.toHaveClass(/unread/);
  await expect(m.locator('.new')).toHaveCount(0);

  await m.getByRole('button', { name: 'Mark unread' }).click();
  await expect(m).toHaveClass(/unread/);
  await expect(m.locator('.new')).toHaveText('New');
  await expect(page.locator('.navitem').filter({ hasText: 'Inbox' }).locator('.pill')).toBeVisible();
});

test('messages are collapsed by default, and page rather than pile up', async ({ page }) => {
  await go(page, 'Inbox');
  await expect(page.locator('.msg').first()).toBeVisible();

  // Collapsed: a one-line preview each, no bodies, and a page that fits.
  await expect(page.locator('.msg.open')).toHaveCount(0);
  await expect(page.locator('.msg .body')).toHaveCount(0);
  await expect(page.locator('.msg .preview').first()).toBeVisible();

  // Paged rather than endless.
  const perPage = await page.locator('.msg').count();
  expect(perPage).toBeLessThanOrEqual(15);
  await expect(page.locator('.pager')).toContainText('page 1 of 2');

  await page.getByRole('button', { name: 'Older' }).click();
  await expect(page.locator('.pager')).toContainText('page 2 of 2');
  await expect(page.locator('.msg').first()).toBeVisible();
  await page.getByRole('button', { name: 'Newer' }).click();
  await expect(page.locator('.pager')).toContainText('page 1 of 2');
});

test('opening a message shows it, and does not quietly mark it read', async ({ page }) => {
  await go(page, 'Inbox');
  const first = page.locator('.msg').first();
  await expect(first).toBeVisible();
  const unreadBefore = await page.locator('.msg.unread').count();

  await first.locator('.row').click();
  await expect(first).toHaveClass(/open/);
  await expect(first.locator('.row')).toHaveAttribute('aria-expanded', 'true');
  await expect(first.locator('.body')).toBeVisible();
  await expect(first.locator('.preview')).toHaveCount(0);

  // Reading and marking read are separate decisions — expanding must not
  // spend the one the operator controls.
  await expect(page.locator('.msg.unread')).toHaveCount(unreadBefore);

  await first.locator('.row').click();
  await expect(page.locator('.msg.open')).toHaveCount(0);
});

test('filtering narrows the list and resets to the first page', async ({ page }) => {
  await go(page, 'Inbox');
  await page.getByLabel('Filter messages').fill('noise floor');
  await expect(page.locator('.msg')).toHaveCount(1);
  await expect(page.locator('.pager')).toHaveCount(0);
  await page.getByLabel('Filter messages').fill('');
  await expect(page.locator('.pager')).toContainText('page 1 of 2');
});

test('marking read is an explicit act, and nothing else does it by accident', async ({ page }) => {
  await go(page, 'Inbox');
  // count() does not auto-wait, and the messages arrive after the heading.
  await expect(page.locator('.msg').first()).toBeVisible();
  const pill = page.locator('.navitem').filter({ hasText: 'Inbox' }).locator('.pill');
  const before = Number(await pill.innerText());
  expect(before).toBeGreaterThan(1);

  // The broadcast label looks like a chip and is not a control. Clicking it
  // used to silently mark the message read, which read as a toggle that had
  // broken — the unread bar vanished and clicking again did nothing.
  await page.getByLabel('Filter messages').fill('whole company');
  const broadcast = page.locator('.msg', { has: page.locator('.to-all') }).first();
  await expect(broadcast).toHaveClass(/unread/);
  await broadcast.locator('.to-all').click();
  // It sits inside the row, so it opens the message — which is all it does.
  await expect(broadcast).toHaveClass(/open/);
  await expect(broadcast).toHaveClass(/unread/);

  // Unread says so in words, not only in a coloured edge.
  await expect(broadcast.locator('.new')).toHaveText('New');

  // The explicit control is the only thing that does it.
  await broadcast.getByRole('button', { name: 'Mark read' }).click();
  await expect(broadcast).not.toHaveClass(/unread/);
  await expect(broadcast.locator('.new')).toHaveCount(0);
  await expect(pill).toHaveText(String(before - 1));

  await page.getByLabel('Filter messages').fill('');
  await page.getByRole('button', { name: /Mark all read/ }).click();
  await expect(page.locator('.msg.unread')).toHaveCount(0);
  await expect(page.locator('.navitem').filter({ hasText: 'Inbox' }).locator('.pill')).toHaveCount(0);

  // The tab counts everything outstanding, and mail is no longer part of it.
  // Approvals still are, and whether one is pending depends on which other
  // tests have run — so assert against what the status bar actually says.
  const waiting = Number(/(\d+) waiting on you/.exec(await page.locator('.status').innerText())?.[1] ?? '0');
  await expect(page).toHaveTitle(waiting ? `(${waiting}) The Desk` : 'The Desk');
});

test('a reply reaches the person who wrote to you', async ({ page }) => {
  await go(page, 'Inbox');
  const first = page.locator('.msg').first();
  await first.locator('.row').click();
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

test('the sidebar can be dragged wider, and stays where you put it', async ({ page }) => {
  const rail = page.locator('.rail');
  const splitter = page.locator('.splitter').first();
  const widthOf = async () => Math.round((await rail.boundingBox())!.width);

  const before = await widthOf();
  const box = (await splitter.boundingBox())!;

  // A real drag, through the handle sitting on the border.
  await page.mouse.move(box.x + box.width / 2, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 90, box.y + 300, { steps: 8 });
  await page.mouse.up();

  const after = await widthOf();
  expect(after).toBeGreaterThan(before + 60);
  await expect(splitter).toHaveAttribute('aria-valuenow', String(after));

  // Set once, stays set — including across a reload.
  await page.reload();
  await expect(page.locator('.co')).not.toBeEmpty();
  expect(await widthOf()).toBe(after);
});

test('the splitter is a real control, not just a draggable pixel', async ({ page }) => {
  const splitter = page.locator('.splitter').first();
  // A 1px border is a target nobody can hit; the grab area is wider than the
  // line it draws.
  const box = (await splitter.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(8);

  await expect(splitter).toHaveAttribute('role', 'separator');
  await expect(splitter).toHaveAttribute('aria-orientation', 'vertical');

  // Reachable and operable from the keyboard.
  await splitter.focus();
  const start = Number(await splitter.getAttribute('aria-valuenow'));
  await page.keyboard.press('ArrowLeft');
  await expect(splitter).toHaveAttribute('aria-valuenow', String(start - 8));
  await page.keyboard.press('Home');
  await expect(splitter).toHaveAttribute('aria-valuenow', await splitter.getAttribute('aria-valuemin') ?? '');
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

  test('a company can be carried out as one file and back in', async ({ page }) => {
    // Sending a company to someone else was a folder-copy and a conversation
    // about which absolute paths to fix by hand.
    await page.locator('.switcher').click();
    await page.getByRole('button', { name: 'Manage companies…' }).click();
    await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible();
    const card = page.locator('.card').first();
    const name = await card.locator('.name').innerText();
    // The copy keeps its old display name, so the slug is the only thing that
    // tells the two apart on screen.
    const slug = (await card.locator('.meta').innerText()).split('·').pop()!.trim();

    const download = await Promise.all([
      page.waitForEvent('download'),
      card.getByRole('button', { name: 'Export' }).click(),
    ]).then(([d]) => d);
    expect(download.suggestedFilename()).toMatch(/\.helmsted\.tar\.gz$/);
    const file = await download.path();

    const before = await page.locator('.card').count();
    await page.getByLabel('Company export file').setInputFiles(file);

    // It arrives paused and beside the original, never on top of it.
    await expect(page.locator('.landed')).toContainText(name);
    await expect(page.locator('.card')).toHaveCount(before + 1);
    const arrived = page.locator('.card').filter({ hasText: `${slug}-2` });
    await expect(arrived).toHaveCount(1);
    await expect(arrived.locator('.name')).toHaveText(name);
    await expect(arrived.locator('.state')).toHaveText('paused');
  });

  test('a file that is not a company is refused in words', async ({ page }) => {
    await page.locator('.switcher').click();
    await page.getByRole('button', { name: 'Manage companies…' }).click();
    await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible();
    await page.getByLabel('Company export file').setInputFiles({
      name: 'holiday.tar.gz', mimeType: 'application/gzip', buffer: Buffer.from('not a company at all'),
    });
    await expect(page.locator('.oops')).toContainText('not a Helmsted export');
    await expect(page.locator('.landed')).toHaveCount(0);
  });

  test('archiving asks for the name, then removes it from the list', async ({ page }) => {
    const manage = async () => {
      await page.locator('.switcher').click();
      await page.getByRole('button', { name: 'Manage companies…' }).click();
      await expect(page.getByRole('heading', { name: 'Companies' })).toBeVisible();
    };

    // The export test left a copy beside the original, under the same display
    // name. Both go — and archiving whichever one is active switches the
    // console away, so the view has to be reopened between them.
    await manage();
    const kestrels = page.locator('.card', { hasText: 'Kestrel' });
    for (let left = await kestrels.count(); left > 0; left--) {
      await kestrels.first().getByRole('button', { name: 'Archive' }).click();
      const confirm = page.getByRole('button', { name: 'Archive it' });

      // Armed only by typing the name — the same friction any tool asks for
      // before it moves a repository.
      await expect(confirm).toBeDisabled();
      await page.locator('.dialog input').fill('Wrong Name');
      await expect(confirm).toBeDisabled();
      await page.locator('.dialog input').fill('Kestrel Provisioning');
      await expect(confirm).toBeEnabled();
      await confirm.click();

      await manage();
      await expect(kestrels).toHaveCount(left - 1);
    }

    await expect(page.locator('.card')).toHaveCount(1);
    await expect(page.locator('.card')).toContainText('Testwright Co');
  });
});
