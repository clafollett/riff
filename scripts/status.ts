import { Ledger } from '../src/ledger/ledger.ts';
import { World } from '../src/worldfs/world.ts';
import { resolveConfig } from '../src/core/config.ts';
import { systemClock } from '../src/core/clock.ts';
import { computeMorale } from '../src/gateway/morale.ts';
const cfg = resolveConfig();
const l = new Ledger(cfg.ledgerPath); const w = new World(cfg.worldDir);
for (const c of w.git.contributionsSince('1.day')) console.log(`  ${c.commits}  ${c.author}`);
const t = l.listTasks();
console.log(`\n  tasks: ${t.filter(x=>x.status==='done').length} done / ${t.length}`);
console.log(`  notes: ${l.countNotes()}   approvals pending: ${l.listApprovals('pending').length}`);
console.log('\n  morale (derived from the log):');
for (const m of computeMorale(l, systemClock, cfg.innkeeper.id).slice(0, 4)) {
  console.log(`   ${String(m.score).padStart(3)}  ${m.name.padEnd(8)} ${m.why}`);
}
l.close();
