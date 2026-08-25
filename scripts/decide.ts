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
  constitutionFor({ ceo: cfg.ceo.id, board: cfg.board.map((b) => b.id) }),
  { count: () => world.commonsCount(), exists: (p) => world.exists(p) },
);
const ok = gate.decide(id!, cfg.board[0]!.id, verdict === 'approve', rest.join(' '));
console.log(ok ? `  ${verdict}d ${id}` : `  refused — already decided or no standing`);
ledger.close();
