/**
 * Whether any of this is working, as numbers.
 *
 *   node scripts/vitals.ts [window] [--json]
 *   node scripts/vitals.ts 24.hours
 *   node scripts/vitals.ts 2.weeks --company lafollett-labs-llc
 *
 * status.ts answers "where does the company stand right now". This answers
 * "did the last week go well", which is a different question and the only one
 * that can contradict the README.
 */
import { Ledger } from '../src/ledger/ledger.ts';
import { World } from '../src/worldfs/world.ts';
import { constitutionFor } from '../src/policy/rules.ts';
import { resolveConfig } from '../src/core/config.ts';
import { systemClock } from '../src/core/clock.ts';
import { takeCompanyFlag } from '../src/core/cli.ts';
import { vitals } from '../src/analytics/vitals.ts';

takeCompanyFlag();

const asJson = process.argv.includes('--json');
const spec = process.argv.slice(2).find((a) => !a.startsWith('-')) ?? '7.days';

const cfg = resolveConfig();
const ledger = new Ledger(cfg.ledgerPath, systemClock);
const world = new World(cfg.worldDir, systemClock);
const c = constitutionFor({ ceo: cfg.ceo.id, board: cfg.board.map((b) => b.id) });

const v = vitals(
  { ledger, world, clock: systemClock, commonsCeiling: c.commonsCeiling },
  spec,
);

if (asJson) {
  console.log(JSON.stringify(v, null, 2));
  ledger.close();
  process.exit(0);
}

const usd = (n: number): string => `$${n.toFixed(2)}`;

/** Millions once it is millions. 41,283,904 is not a number anybody reads. */
const tok = (n: number): string => (n >= 1e6
  ? `${(n / 1e6).toFixed(1)}M`
  : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n));

/**
 * The same figure over the window before this one. A count with nothing to
 * compare it against is a number; with this it is a direction. Blank when
 * there is no previous window, rather than a misleading "+0".
 */
const d = (key: keyof NonNullable<typeof v.previous>, now: number, unit = ''): string => {
  const was = v.previous?.[key];
  if (was == null) return '';
  const delta = now - was;
  if (Math.abs(delta) < 0.005) return `same as last ${v.window.spec}`;
  const sign = delta > 0 ? '+' : '−';
  const size = unit === '$' ? `$${Math.abs(delta).toFixed(2)}` : String(Math.round(Math.abs(delta)));
  return `${sign}${size} on last ${v.window.spec} (was ${unit === '$' ? usd(was) : was})`;
};
const pct = (n: number): string => `${Math.round(n * 100)}%`;
const hrs = (n: number | null): string => (n == null ? '—' : `${n.toFixed(1)}h`);

/** A label, a figure, and — only where it earns its place — a reading. */
const line = (label: string, value: string | number, note = ''): void => {
  console.log(`    ${label.padEnd(23)} ${String(value).padStart(9)}   ${note}`.trimEnd());
};
const head = (s: string): void => console.log(`\n  ${s.toUpperCase()}`);

// The line of business holds the founder's whole brief now, which is pages.
// A report header wants the first line of it, not the document.
const business = (cfg.company.business.split('\n').find((l) => l.trim()) ?? '').trim();
console.log(`\n  ${cfg.company.name}${business ? ` — ${business.slice(0, 72)}` : ''}`);
console.log(`  ${v.window.spec}, since ${v.window.since.slice(0, 16).replace('T', ' ')}`);

const s = v.shifts;
head('shifts');
line('woken', s.woke);
line('finished', s.slept, d('shifts', s.slept));
line('cut at the ceiling', s.truncated);
line('failed', s.failed, d('failed', s.failed));
line('blind', s.blind, s.blind ? 'made tool calls the gate never heard about' : d('blind', s.blind));
line('barren', s.barren,
  s.barren ? `woke, spent, left nothing behind — ${pct(s.barren / Math.max(1, s.slept))} of shifts` : '');
line('in trouble', pct(s.troubleRate),
  s.troubleRate > 0.2 ? '⚠ this is the loop, not the work' : '');
line('turns a shift', s.turnsPerShift.toFixed(1));
line('list price', usd(s.costUsd),
  s.slept ? `${usd(s.costPerShift)} a shift · ${d('costUsd', s.costUsd, '$')}` : '');
line('biggest share', pct(s.costShareTop),
  s.costShareTop > 0.5 ? '⚠ one person is most of the bill' : '');
if (s.rotated || s.compacted || s.rotateFailed) {
  line('rotated · compacted', `${s.rotated} · ${s.compacted}`,
    s.rotateFailed ? `⚠ ${s.rotateFailed} rotations failed` : '');
}
if (v.throttle.rateLimited || v.throttle.throttled || v.throttle.usagePaused) {
  line('rate limited', v.throttle.rateLimited,
    `${v.throttle.throttled} throttled, ${v.throttle.usagePaused} paused`);
}

// The section that says what the company actually spent. Everything above
// priced in dollars is the SDK's imputed list price on an account that is
// billed by subscription: a comparison, not a bill. Tokens and the window are
// the resources that run out, so they get their own heading rather than a
// footnote under the money.
const tk = v.tokens;
head('what it consumed');
if (!tk.measured) {
  line('tokens', '—', 'no shift in this window reported usage');
} else {
  line('tokens', tok(tk.total), `${tok(tk.perShift)} a shift · ${tk.measured} of ${s.slept} shifts measured`);
  line('output', tok(tk.output), 'what the models actually wrote');
  line('fresh input', tok(tk.input));
  line('cache read · write', `${tok(tk.cacheRead)} · ${tok(tk.cacheWrite)}`,
    tk.cacheHitRate < 0.5
      ? `⚠ only ${pct(tk.cacheHitRate)} of input came from cache — rotating too eagerly?`
      : `${pct(tk.cacheHitRate)} of input came from cache`);
}
const lm = v.limits;
if (!lm.seen) {
  line('subscription window', '—', 'no rate-limit reading in this window');
} else {
  const window = lm.type ? lm.type.replace(/_/g, ' ') : 'window';
  line('subscription window', pct(lm.latest),
    `${window} · peak ${pct(lm.peak)} over ${lm.seen} shift${lm.seen === 1 ? '' : 's'}`);
  if (lm.peak >= 0.8) console.log('    ⚠ the company has come within a fifth of the ceiling this window');
}

// The failure mode worth catching in one figure: staff who message each other
// all week and land nothing anybody can read back.
head('talk against work');
line('commits by staff', v.talk.byStaff, d('commits', v.talk.byStaff));
line('commits in all', v.talk.commits,
  v.talk.unattributed ? `${v.talk.unattributed} by the harness or nobody on the roster` : '');
line('messages', v.talk.messages,
  v.talk.byStaff ? `${v.talk.perCommit.toFixed(1)} per commit` : 'nothing landed to weigh them against');
line('actually delivered', v.talk.deliveries,
  v.talk.broadcastFanout > 3
    ? `⚠ ${v.talk.broadcastFanout.toFixed(1)} inboxes a message`
    : `${v.talk.broadcastFanout.toFixed(1)} inboxes a message`);
line('notes on each other', v.talk.notes);
line('memory consolidated', v.talk.memoryConsolidated,
  !v.talk.memoryConsolidated && s.slept ? 'nobody wrote anything down to keep' : '');
line('cost a commit', v.talk.byStaff ? usd(v.talk.costPerCommit) : '—');

// Rule 6 bounds the shelf; nothing bounds the payroll, and the payroll is
// where the money goes.
const o = v.org;
head('the org chart');
line('headcount', o.headcount, `${o.depth} deep, widest span ${o.widest}`);
line('hired · retired', `${o.hired} · ${o.retired}`,
  o.hired && !o.retired ? '⚠ nobody left, the same claim as an unpruned commons' : '');
line('net', (o.net > 0 ? '+' : '') + o.net, d('hired', o.hired));
line('shifts a head', o.shiftsPerHead.toFixed(1));
if (o.orphans) line('broken reporting', o.orphans, '⚠ reports to somebody who does not work here');

// Rule 6 is the claim this report exists to test. A full shelf with no
// removals is not a working pressure, it is an untested one.
const cm = v.commons;
head('commons — rule 6');
line('held', `${cm.held}/${cm.ceiling}`, cm.held >= cm.ceiling ? '⚠ at the ceiling' : '');
line('added', cm.added, d('posted', cm.added));
line('revised', cm.revised, cm.revised ? 'rewrites of pages that already existed' : '');
line('removed', cm.removed,
  cm.added && !cm.removed ? '⚠ accretion with no selection' : d('removed', cm.removed));
line('net', (cm.net > 0 ? '+' : '') + cm.net);
line('refused as full', cm.refused,
  cm.refused ? 'the ceiling actually bit' : 'the ceiling has never bitten');

const e = v.envelope;
head('the envelope — rule 3');
line('filed', e.filed, d('filed', e.filed));
line('approved · rejected', `${e.approved} · ${e.rejected}`);
line('withdrawn', e.withdrawn);
line('released outward', e.released, d('released', e.released));
line('still pending', e.pending,
  e.oldestPendingHours != null && e.oldestPendingHours > 24
    ? `⚠ oldest has waited ${hrs(e.oldestPendingHours)}`
    : e.pending ? `oldest ${hrs(e.oldestPendingHours)}` : '');
line('median decision', hrs(e.medianDecisionHours));

const w = v.work;
head('work');
line('opened · claimed', `${w.opened} · ${w.claimed}`);
line('done · dropped', `${w.done} · ${w.dropped}`,
  w.done + w.dropped ? `${pct(w.completionRate)} finished · ${d('done', w.done)}` : '');
line('open now', w.openNow);

head('the gate');
line('allow · deny · escalate', `${v.gate.allow} · ${v.gate.deny} · ${v.gate.escalate}`);
if (v.money.cents) line('spent', usd(v.money.cents / 100), `over ${v.money.spends} payments`);
if (v.money.exceptions) line('over-cap exceptions', v.money.exceptions);
for (const r of v.gate.rules.filter((x) => x.kind !== 'allow').slice(0, 6)) {
  console.log(`      ${String(r.n).padStart(5)}  ${r.kind.padEnd(9)} ${r.rule}  ${r.capability}`);
}

if (v.people.length) {
  head('who did the work');
  console.log(`    ${'who'.padEnd(12)}${'shifts'.padStart(7)}${'commits'.padStart(8)}` +
    `${'posts'.padStart(7)}${'mail'.padStart(6)}${'drafts'.padStart(8)}` +
    `${'done'.padStart(6)}${'tokens'.padStart(9)}${'list $'.padStart(9)}`);
  for (const p of v.people) {
    console.log(`    ${p.name.slice(0, 11).padEnd(12)}${String(p.shifts).padStart(7)}` +
      `${String(p.commits).padStart(8)}${String(p.posted).padStart(7)}` +
      `${String(p.messages).padStart(6)}${String(p.filed).padStart(8)}` +
      `${String(p.done).padStart(6)}${tok(p.tokens).padStart(9)}` +
      `${usd(p.costUsd).padStart(9)}` +
      (p.denied ? `   ${p.denied} denied` : ''));
  }
}

// A page of zeroes reads like a broken installation. Say which it is.
if (!s.woke) {
  console.log(`\n  Nobody worked a shift in this window. Start the company, ` +
    `or widen it:\n    node scripts/vitals.ts 30.days`);
}

console.log();
ledger.close();
