/**
 * Wake exactly one staff member, once, and report what happened.
 *
 *   node scripts/tick.ts hollis
 *
 * Deliberately not the scheduler: one agent, one wake-up, hard turn cap. This
 * is the script for proving the runtime works before letting a village loose.
 */
import { resolveConfig } from '../src/core/config.ts';
import { openTheInn } from '../src/village/open.ts';
import { PolicyGate } from '../src/policy/gate.ts';
import { houseRulesFor } from '../src/policy/rules.ts';
import { systemClock } from '../src/core/clock.ts';
import { tick } from '../src/runtime/staff.ts';

const who = process.argv[2] ?? 'hollis';
const maxTurns = Number(process.argv[3] ?? 8);

const cfg = resolveConfig();
const clock = systemClock;
const { ledger, world } = openTheInn(cfg, clock);
const gate = new PolicyGate(ledger, houseRulesFor(cfg.innkeeper.id));

const agent = ledger.getAgent(who);
if (!agent) {
  console.error(`Nobody called '${who}' works here.`);
  process.exit(1);
}

console.log(`\n  Waking ${agent.name} (${agent.title})  ·  max ${maxTurns} turns\n`);
const before = ledger.latestSeq();
const started = Date.now();

const r = await tick({
  agent, ledger, gate, world, clock, maxTurns,
  trace: (line) => console.log(line),
  ...(cfg.connectors && Object.keys(cfg.connectors).length ? { connectors: cfg.connectors } : {}),
});

console.log(`  ok      : ${r.ok}`);
console.log(`  turns   : ${r.turns}`);
console.log(`  cost    : $${r.costUsd.toFixed(4)}`);
console.log(`  elapsed : ${((Date.now() - started) / 1000).toFixed(1)}s`);
if (r.rateLimit) console.log(`  limits  : ${r.rateLimit.status} (${r.rateLimit.rateLimitType ?? 'n/a'})`);
if (r.error) console.log(`  ERROR   : ${r.error}`);
if (r.summary) console.log(`\n  --- what ${agent.name} said ---\n${r.summary.split('\n').map((l) => '  ' + l).join('\n')}`);

const events = ledger.eventsSince(before);
console.log(`\n  --- ${events.length} events ---`);
for (const e of events) {
  const d = e.dataJson ? JSON.parse(e.dataJson) : {};
  const extra = d.rule ? ` [${d.rule}]` : d.title ? ` "${d.title}"` : '';
  console.log(`  ${e.actor.padEnd(8)} ${e.kind.padEnd(24)} ${e.subject ?? ''}${extra}`);
}
console.log(`\n  pending approvals: ${ledger.listApprovals('pending').length}`);
ledger.close();
