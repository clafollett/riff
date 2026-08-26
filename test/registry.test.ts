import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * One installation, many companies.
 *
 * Every test here runs against a throwaway HOME, because the module reads
 * ~/.riff at import time and a test that can archive the operator's real
 * company is not a test.
 */
const run = (script: string): string => {
  const home = process.env['TEST_HOME']!;
  return execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    // RIFF_ROOT is the containment boundary; HOME alone is not, because
    // a module that snapshots homedir() at import escapes it.
    env: { ...process.env, HOME: home, RIFF_ROOT: join(home, '.riff'), RIFF_COMPANY_ID: '' },
    cwd: process.cwd(),
  });
};

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'riff-registry-'));
  process.env['TEST_HOME'] = home;
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  delete process.env['TEST_HOME'];
});

describe('companies are separate worlds', () => {
  test('founding two leaves each with its own staff, ledger and repo', () => {
    const out = run(`
      const { Registry } = await import('${process.cwd()}/src/company/registry.ts');
      const { systemClock } = await import('${process.cwd()}/src/core/clock.ts');
      const r = new Registry(systemClock);
      const a = r.found({ name: 'Alpha Works', business: 'one', ceo: 'Ash', chair: 'Cali' });
      const b = r.found({ name: 'Beta Works', business: 'two', ceo: 'Bay', chair: 'Cali' });
      if (!a.ok || !b.ok) throw new Error('found failed');

      a.company.ledger.emit('ash', 'test.marker', null, {});
      console.log(JSON.stringify({
        slugs: r.list().map((c) => c.slug).sort(),
        ceoA: a.company.cfg.ceo.name,
        ceoB: b.company.cfg.ceo.name,
        seqA: a.company.ledger.latestSeq(),
        seqB: b.company.ledger.latestSeq(),
        sameLedgerFile: a.company.cfg.ledgerPath === b.company.cfg.ledgerPath,
      }));
    `);
    const r = JSON.parse(out) as Record<string, unknown>;
    assert.deepEqual(r['slugs'], ['alpha-works', 'beta-works']);
    assert.equal(r['ceoA'], 'Ash');
    assert.equal(r['ceoB'], 'Bay');
    assert.equal(r['sameLedgerFile'], false);
    // An event in one must not appear in the other's sequence.
    assert.ok((r['seqA'] as number) > (r['seqB'] as number), JSON.stringify(r));
  });

  test('a name already taken is refused rather than merged into', () => {
    const out = run(`
      const { Registry } = await import('${process.cwd()}/src/company/registry.ts');
      const { systemClock } = await import('${process.cwd()}/src/core/clock.ts');
      const r = new Registry(systemClock);
      r.found({ name: 'Alpha Works', business: '', ceo: 'Ash', chair: 'Cali' });
      const again = r.found({ name: 'alpha works', business: '', ceo: 'Other', chair: 'Cali' });
      console.log(JSON.stringify({ ok: again.ok, reason: again.ok ? null : again.reason }));
    `);
    const r = JSON.parse(out) as { ok: boolean; reason: string };
    assert.equal(r.ok, false);
    assert.match(r.reason, /already exists/);
  });

  test('an unknown slug returns nothing instead of inventing a company', () => {
    const out = run(`
      const { Registry } = await import('${process.cwd()}/src/company/registry.ts');
      const { systemClock } = await import('${process.cwd()}/src/core/clock.ts');
      const r = new Registry(systemClock);
      r.found({ name: 'Alpha Works', business: '', ceo: 'Ash', chair: 'Cali' });
      console.log(JSON.stringify({ got: r.get('nope'), count: r.list().length }));
    `);
    assert.deepEqual(JSON.parse(out), { got: null, count: 1 });
  });
});

describe('managing a company', () => {
  test('renaming the label leaves the folder alone', () => {
    const out = run(`
      const { Registry } = await import('${process.cwd()}/src/company/registry.ts');
      const { systemClock } = await import('${process.cwd()}/src/core/clock.ts');
      const r = new Registry(systemClock);
      r.found({ name: 'Alpha Works', business: 'one', ceo: 'Ash', chair: 'Cali' });
      const res = await r.update('alpha-works', { name: 'Alpha Industries' });
      const after = r.list()[0];
      console.log(JSON.stringify({ res, slug: after.slug, name: after.name, business: after.business }));
    `);
    const r = JSON.parse(out) as Record<string, unknown>;
    assert.deepEqual(r['res'], { ok: true, slug: 'alpha-works' });
    assert.equal(r['slug'], 'alpha-works', 'the folder must not move on a label change');
    assert.equal(r['name'], 'Alpha Industries');
    assert.equal(r['business'], 'one', 'an unset field must not be blanked');
  });

  test('renaming the slug moves the folder and rewrites the stored paths', () => {
    const out = run(`
      const { Registry } = await import('${process.cwd()}/src/company/registry.ts');
      const { systemClock } = await import('${process.cwd()}/src/core/clock.ts');
      const r = new Registry(systemClock);
      r.found({ name: 'Alpha Works', business: '', ceo: 'Ash', chair: 'Cali' });
      await r.update('alpha-works', { slug: 'alpha' });
      const c = r.get('alpha');
      console.log(JSON.stringify({
        slugs: r.list().map((x) => x.slug),
        home: c.cfg.home.endsWith('/companies/alpha'),
        world: c.cfg.worldDir.endsWith('/companies/alpha/world'),
        ledgerOpens: c.ledger.latestSeq() >= 0,
      }));
    `);
    const r = JSON.parse(out) as Record<string, unknown>;
    assert.deepEqual(r['slugs'], ['alpha']);
    assert.equal(r['home'], true);
    assert.equal(r['world'], true);
    assert.equal(r['ledgerOpens'], true, 'the moved ledger must still open');
  });

  test('archiving moves the company aside and never deletes it', () => {
    const out = run(`
      const { Registry } = await import('${process.cwd()}/src/company/registry.ts');
      const { systemClock } = await import('${process.cwd()}/src/core/clock.ts');
      const r = new Registry(systemClock);
      const a = r.found({ name: 'Alpha Works', business: '', ceo: 'Ash', chair: 'Cali' });
      if (a.ok) a.company.world.writeCommons('doctrine/x.md', { title: 'x' }, 'body');
      const res = await r.archive('alpha-works');
      console.log(JSON.stringify({ res, left: r.list().length }));
    `);
    const r = JSON.parse(out) as { res: { ok: boolean; at: string }; left: number };
    assert.equal(r.res.ok, true);
    assert.equal(r.left, 0, 'it must leave the company list');
    assert.ok(existsSync(r.res.at), 'the directory must still exist');
    assert.ok(existsSync(join(r.res.at, 'world', 'commons', 'doctrine', 'x.md')),
      'the world and its documents must survive intact');
    assert.ok(existsSync(join(r.res.at, 'world', '.git')), 'git history must survive');
  });
});

describe('working, and staying that way', () => {
  test('a company records whether it should be working, and resumes', () => {
    // A scheduler lives in a process; the operator's intent does not. Restarting
    // the server used to pause everything while the console reported idle.
    const out = run(`
      const { Registry } = await import('${process.cwd()}/src/company/registry.ts');
      const { systemClock } = await import('${process.cwd()}/src/core/clock.ts');
      const first = new Registry(systemClock);
      first.found({ name: 'Alpha Works', business: '', ceo: 'Ash', chair: 'Cali' });
      first.found({ name: 'Beta Works', business: '', ceo: 'Bay', chair: 'Cali' });
      await first.setRunning('alpha-works', true);
      const wantedAfterStart = first.list().map((c) => [c.slug, c.wanted]);
      for (const c of first.opened()) { await c.scheduler.stop(); c.ledger.close(); }

      // A brand new process, exactly as a server restart would see it.
      const second = new Registry(systemClock);
      const beforeResume = second.list().map((c) => [c.slug, c.running]);
      const resumed = second.resume();
      const afterResume = second.list().map((c) => [c.slug, c.running]);
      for (const c of second.opened()) { await c.scheduler.stop(); c.ledger.close(); }
      console.log(JSON.stringify({ wantedAfterStart, beforeResume, resumed, afterResume }));
    `);
    const r = JSON.parse(out) as Record<string, any>;
    assert.deepEqual(r['wantedAfterStart'].sort(), [['alpha-works', true], ['beta-works', false]]);
    // Nothing runs until resume is called — opening a company must not start it.
    assert.deepEqual(r['beforeResume'].sort(), [['alpha-works', false], ['beta-works', false]]);
    assert.deepEqual(r['resumed'], ['alpha-works']);
    assert.deepEqual(r['afterResume'].sort(), [['alpha-works', true], ['beta-works', false]]);
  });

  test('pausing is remembered too, so a restart does not undo it', () => {
    const out = run(`
      const { Registry } = await import('${process.cwd()}/src/company/registry.ts');
      const { systemClock } = await import('${process.cwd()}/src/core/clock.ts');
      const r = new Registry(systemClock);
      r.found({ name: 'Alpha Works', business: '', ceo: 'Ash', chair: 'Cali' });
      await r.setRunning('alpha-works', true);
      await r.setRunning('alpha-works', false);
      for (const c of r.opened()) { await c.scheduler.stop(); c.ledger.close(); }
      const fresh = new Registry(systemClock);
      const resumed = fresh.resume();
      for (const c of fresh.opened()) { await c.scheduler.stop(); c.ledger.close(); }
      console.log(JSON.stringify({ wanted: fresh.list()[0].wanted, resumed }));
    `);
    assert.deepEqual(JSON.parse(out), { wanted: false, resumed: [] });
  });
});

describe('the legacy layout', () => {
  test('a company stored flat is moved into companies/, git and all', () => {
    // The first version put one company directly in ~/.riff. Anyone who
    // ran Riff before this existed has a live world there.
    const root = join(home, '.riff');
    mkdirSync(join(root, 'world', 'commons'), { recursive: true });
    writeFileSync(join(root, 'config.json'), JSON.stringify({
      version: 1, home: root, worldDir: join(root, 'world'), ledgerPath: join(root, 'ledger.db'),
      company: { name: 'Old Company', business: 'legacy' },
      board: [{ id: 'cali', name: 'Cali', role: 'Chairman' }],
      ceo: { id: 'vale', name: 'Vale' }, connectors: {},
    }));
    writeFileSync(join(root, 'ledger.db'), '');
    writeFileSync(join(root, 'world', 'commons', 'kept.md'), 'still here');
    execFileSync('git', ['-C', join(root, 'world'), 'init', '-q', '-b', 'main']);

    const out = run(`
      const { migrateLegacyLayout, listCompanies, resolveConfig } = await import('${process.cwd()}/src/core/config.ts');
      const moved = migrateLegacyLayout();
      const again = migrateLegacyLayout();
      console.log(JSON.stringify({ moved, again, list: listCompanies(), home: resolveConfig().home }));
    `);
    const r = JSON.parse(out) as Record<string, any>;
    assert.deepEqual(r['moved'], { moved: 'old-company' });
    assert.equal(r['again'], null, 'migration must be idempotent');
    assert.equal(r['list'][0].name, 'Old Company');

    const moved = join(root, 'companies', 'old-company');
    assert.ok(existsSync(join(moved, 'world', 'commons', 'kept.md')), 'documents must move');
    assert.ok(existsSync(join(moved, 'world', '.git')), 'the repository must move');
    assert.ok(!existsSync(join(root, 'world')), 'nothing may be left behind');
    // The stored config recorded absolute paths from the old location.
    assert.equal(r['home'], moved);
  });

  test('a fresh install has no legacy layout to move', () => {
    mkdirSync(join(home, '.riff'), { recursive: true });
    const out = run(`
      const { migrateLegacyLayout } = await import('${process.cwd()}/src/core/config.ts');
      console.log(JSON.stringify(migrateLegacyLayout()));
    `);
    assert.equal(JSON.parse(out), null);
  });
});

describe('naming a company when several exist', () => {
  test('one company is unambiguous; several without a name is refused', () => {
    const out = run(`
      const { Registry } = await import('${process.cwd()}/src/company/registry.ts');
      const { systemClock } = await import('${process.cwd()}/src/core/clock.ts');
      const { resolveConfig, isOperatorError } = await import('${process.cwd()}/src/core/config.ts');
      const r = new Registry(systemClock);
      r.found({ name: 'Alpha Works', business: '', ceo: 'Ash', chair: 'Cali' });
      const single = resolveConfig().company.name;
      r.found({ name: 'Beta Works', business: '', ceo: 'Bay', chair: 'Cali' });
      let refused = null;
      try { resolveConfig(); } catch (e) { refused = { operator: isOperatorError(e), msg: e.message }; }
      const named = resolveConfig(process.cwd(), 'beta-works').company.name;
      console.log(JSON.stringify({ single, refused, named }));
    `);
    const r = JSON.parse(out) as Record<string, any>;
    assert.equal(r['single'], 'Alpha Works', 'a lone company needs no naming');
    assert.equal(r['refused'].operator, true, 'ambiguity is an operator error, not a crash');
    assert.match(r['refused'].msg, /alpha-works, beta-works/);
    assert.equal(r['named'], 'Beta Works');
  });
});

describe('opening a company is not something that happened to it', () => {
  test('open and close leaves no trace in the log; a real pause still does', () => {
    // `stop` announced itself unconditionally, so every restart of the server
    // appended a `work.paused` describing nothing. An append-only log is only
    // worth reading if everything in it is an event.
    const out = run(`
      const { Registry } = await import('${process.cwd()}/src/company/registry.ts');
      const { systemClock } = await import('${process.cwd()}/src/core/clock.ts');
      const r = new Registry(systemClock);
      const a = r.found({ name: 'Quiet Co', business: 'x', ceo: 'Quill', chair: 'Cali' });
      if (!a.ok) throw new Error('found failed');
      const mark = a.company.ledger.latestSeq();
      await r.close('quiet-co');

      const kinds = [];
      for (let i = 0; i < 3; i++) {
        const again = new Registry(systemClock);
        const c = again.get('quiet-co');
        kinds.push(...c.ledger.eventsSince(mark).map((e) => e.kind));
        await again.close('quiet-co');
      }

      const last = new Registry(systemClock);
      await last.setRunning('quiet-co', true);
      await last.setRunning('quiet-co', false);
      const real = last.get('quiet-co').ledger.eventsSince(mark).map((e) => e.kind);
      console.log(JSON.stringify({ onOpen: kinds, real }));
    `);
    const r = JSON.parse(out) as { onOpen: string[]; real: string[] };
    assert.deepEqual(r.onOpen, [], 'opening a paused company must write nothing');
    assert.ok(r.real.includes('work.started'), 'starting is still recorded');
    assert.ok(r.real.includes('work.paused'), 'pausing something that was running is still recorded');
  });
});
