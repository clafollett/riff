import { Ledger } from '../src/ledger/ledger.ts';
import { World } from '../src/worldfs/world.ts';
import { Gate } from '../src/policy/gate.ts';
import { constitutionFor } from '../src/policy/rules.ts';
import { resolveConfig } from '../src/core/config.ts';
import { systemClock } from '../src/core/clock.ts';
import { takeCompanyFlag } from '../src/core/cli.ts';

takeCompanyFlag();

const [id, verdict, ...rest] = process.argv.slice(2);
const cfg = resolveConfig();
const ledger = new Ledger(cfg.ledgerPath, systemClock);
const world = new World(cfg.worldDir, systemClock);
const gate = new Gate(
  ledger,
  // The company's own policy, not the defaults. These scripts exist to prove
  // a change before a company runs on it, and a gate built from defaults
  // proves it against rules the runtime does not use.
  constitutionFor({
    ceo: cfg.ceo.id,
    board: cfg.board.map((b) => b.id),
    commonsCeiling: cfg.policy.commonsCeiling,
    portfolioCeiling: cfg.policy.portfolioCeiling,
    dailyCapCents: cfg.policy.dailyCapCents,
  }),
  { count: () => world.commonsCount(), exists: (p) => world.exists(p) },
  { count: () => world.projectCount(), has: (n) => world.listProjects().includes(n) },
);
const ok = gate.decide(id!, cfg.board[0]!.id, verdict === 'approve', rest.join(' '));
console.log(ok ? `  ${verdict}d ${id}` : `  refused — already decided or no standing`);
ledger.close();
