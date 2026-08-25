/**
 * Let the company run unattended, with hard stops.
 *
 *   node scripts/run-overnight.ts [hours] [maxTicks]
 *
 * Everything here is a ceiling, not an estimate. An unattended run on someone
 * else's machine gets a deadline and a tick budget, because a subscription
 * exhausted overnight means they cannot work in the morning.
 */
import { Ledger } from '../src/ledger/ledger.ts';
import { World } from '../src/worldfs/world.ts';
import { Gate } from '../src/policy/gate.ts';
import { constitutionFor } from '../src/policy/rules.ts';
import { Scheduler } from '../src/runtime/scheduler.ts';
import { resolveConfig } from '../src/core/config.ts';
import { systemClock } from '../src/core/clock.ts';

// The container entrypoint passes through unset variables as empty strings,
// and Number('') is 0 — an unattended run that stops the instant it starts.
const arg = (i: number, fallback: number): number => {
  const n = Number(process.argv[i]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const hours = arg(2, 7);
const maxTicks = arg(3, 40);

const cfg = resolveConfig();
const ledger = new Ledger(cfg.ledgerPath, systemClock);
const world = new World(cfg.worldDir, systemClock);
const gate = new Gate(
  ledger,
  constitutionFor({ ceo: cfg.ceo.id, board: cfg.board.map((b) => b.id) }),
  { count: () => world.commonsCount(), exists: (p) => world.exists(p) },
);

const until = Date.now() + hours * 3600_000;
const scheduler = new Scheduler({
  ledger, gate, world, clock: systemClock,
  ...(cfg.connectors && Object.keys(cfg.connectors).length ? { connectors: cfg.connectors } : {}),
  options: {
    // Deliberately slow. Emergence needs time between wake-ups more than it
    // needs frequency — an agent that wakes before anything has changed just
    // re-reads its own last message.
    baseIntervalMs: 12 * 60_000,
    concurrency: 2,
    maxTurns: 30,
    maxTicks,
    until,
  },
  onTick: (r) => {
    const when = new Date().toISOString().slice(11, 19);
    console.log(`[${when}] ${r.agentId.padEnd(8)} ${r.ok ? 'ok ' : 'ERR'} ` +
      `${String(r.turns).padStart(3)} turns  $${r.costUsd.toFixed(2)}  ` +
      `${(r.summary.split('\n').find((l) => l.trim()) ?? r.error ?? '').slice(0, 96)}`);
  },
});

console.log(`\n  ${cfg.company.name} — running unattended`);
console.log(`  stops at   : ${new Date(until).toLocaleString()} (or ${maxTicks} wake-ups, whichever first)`);
console.log(`  staff      : ${ledger.listAgents().filter((a) => a.tier !== 'board').map((a) => a.id).join(', ')}`);
console.log(`  pacing     : ~12 min base, 2 at a time\n`);

scheduler.start();

const finish = async () => {
  await scheduler.stop();
  console.log(`\n  stopped after ${scheduler.ticks} wake-ups · $${scheduler.spentTodayUsd.toFixed(2)}\n`);
  ledger.close();
  process.exit(0);
};
process.on('SIGINT', finish);
process.on('SIGTERM', finish);
setInterval(() => { if (!scheduler.running) void finish(); }, 5_000).unref();
