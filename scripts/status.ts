/**
 * Where the company stands.
 *
 *   node scripts/status.ts
 *
 * Exists because I hand-wrote and threw away the same throwaway probe five
 * times in one session. A diagnostic you keep recreating has earned a name.
 */
import { Ledger } from '../src/ledger/ledger.ts';
import { World } from '../src/worldfs/world.ts';
import { resolveConfig } from '../src/core/config.ts';
import { constitutionFor } from '../src/policy/rules.ts';
import { systemClock } from '../src/core/clock.ts';
import { takeCompanyFlag } from '../src/core/cli.ts';

takeCompanyFlag();

const cfg = resolveConfig();
const ledger = new Ledger(cfg.ledgerPath, systemClock);
const world = new World(cfg.worldDir, systemClock);
const c = constitutionFor({
  ceo: cfg.ceo.id,
  board: cfg.board.map((b) => b.id),
  commonsCeiling: cfg.policy.commonsCeiling,
  portfolioCeiling: cfg.policy.portfolioCeiling,
  dailyCapCents: cfg.policy.dailyCapCents,
});

const agents = ledger.listAgents();
const tasks = ledger.listTasks();
const pending = ledger.listApprovals('pending');

console.log(`\n  ${cfg.company.name}${cfg.company.business ? ` — ${cfg.company.business}` : ''}`);
console.log(`  ${cfg.home}\n`);

console.log('  WHO WORKS HERE');
for (const a of agents) {
  const to = a.reportsTo ? ` → ${a.reportsTo}` : '';
  console.log(`    ${a.tier.padEnd(9)} ${a.name.padEnd(9)} ${a.role}${to}`);
  if (a.activity) console.log(`    ${''.padEnd(9)} ${''.padEnd(9)} ${dim(a.activity)}`);
}

// A reporting line pointing at nobody is the shape a bad rename leaves behind.
const orphans = agents.filter((a) => a.reportsTo && !ledger.getAgent(a.reportsTo));
if (orphans.length) console.log(`\n  ⚠ ${orphans.length} broken reporting line(s): ${orphans.map((a) => a.id).join(', ')}`);

console.log(`\n  COMMONS  ${world.commonsCount()} / ${c.commonsCeiling}`);
console.log(`  CARRYING ${world.projectCount()}${c.portfolioCeiling ? ` / ${c.portfolioCeiling}` : ''}` +
  `${world.listProjects().length ? `  ${world.listProjects().join(', ')}` : ''}`);
for (const d of world.listCommons()) console.log(`    ${d}`);

console.log(`\n  WAITING ON THE BOARD  ${pending.filter((a) => a.tier === 'board').length}`);
for (const a of pending) console.log(`    [${a.tier}] ${a.requestedBy}: ${a.summary.slice(0, 72)}`);
if (!pending.length) console.log('    nothing');

const done = tasks.filter((t) => t.status === 'done').length;
console.log(`\n  WORK  ${done} done / ${tasks.length}`);
for (const t of tasks.filter((t) => t.status !== 'done')) {
  console.log(`    [${t.status}] ${t.title.slice(0, 68)}`);
}

console.log(`\n  RECORD  ${ledger.countNotes()} notes · ${ledger.latestSeq()} events`);
for (const cnt of world.git.contributionsSince('7.days')) {
  console.log(`    ${String(cnt.commits).padStart(3)}  ${cnt.author}`);
}
console.log();
ledger.close();

function dim(s: string): string { return s.length > 64 ? s.slice(0, 61) + '...' : s; }
