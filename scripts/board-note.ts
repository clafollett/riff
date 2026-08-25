/** A note from the board to someone. `node scripts/board-note.ts <who> "..."` */
import { Ledger } from '../src/ledger/ledger.ts';
import { resolveConfig } from '../src/core/config.ts';
import { systemClock } from '../src/core/clock.ts';
import { takeCompanyFlag } from '../src/core/cli.ts';

takeCompanyFlag();
const [to, ...rest] = process.argv.slice(2);
const cfg = resolveConfig();
const l = new Ledger(cfg.ledgerPath, systemClock);
const from = cfg.board[0]!.id;
const n = l.sendMessage(from, to === 'everyone' ? null : to!, rest.join(' '));
l.emit(from, 'message.sent', to ?? null, { recipients: n });
console.log(`  delivered to ${n}`);
l.close();
