/**
 * Read what is waiting on the board, in full.
 *
 *   node scripts/review.ts            list what is pending
 *   node scripts/review.ts <id>       read one draft end to end
 */
import { Ledger } from '../src/ledger/ledger.ts';
import { World } from '../src/worldfs/world.ts';
import { resolveConfig } from '../src/core/config.ts';
import { systemClock } from '../src/core/clock.ts';
import { takeCompanyFlag } from '../src/core/cli.ts';

takeCompanyFlag();

const want = process.argv[2];
const cfg = resolveConfig();
const l = new Ledger(cfg.ledgerPath, systemClock);
const w = new World(cfg.worldDir, systemClock);

for (const a of l.listApprovals('pending')) {
  if (want && a.id !== want) continue;
  const pl = JSON.parse(a.payloadJson ?? '{}') as Record<string, string>;
  console.log(`\n${'─'.repeat(76)}`);
  console.log(`${a.id}   [${a.tier}]   from ${a.requestedBy}   ${a.capability}`);
  console.log(`${'─'.repeat(76)}`);
  console.log(`\nSUMMARY\n  ${a.summary}\n`);
  if (pl['draftPath']) {
    const d = w.readDoc(pl['draftPath']);
    console.log(`DRAFT  ${pl['draftPath']}\n`);
    console.log(d ? d.body : '  (the draft file is missing — the approval points at nothing)');
  }
}
l.close();
