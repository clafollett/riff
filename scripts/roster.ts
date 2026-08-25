/** Who works here. `node scripts/roster.ts` */
import { Ledger } from '../src/ledger/ledger.ts';
import { resolveConfig } from '../src/core/config.ts';

const cfg = resolveConfig();
const l = new Ledger(cfg.ledgerPath);
console.log(`\n  The LaFollett Bed & Breakfast — ${cfg.home}\n`);
for (const a of l.listAgents()) {
  const reports = a.reportsTo ? `→ ${a.reportsTo}` : '';
  console.log(`  ${a.name.padEnd(8)} ${a.title.padEnd(22)} ${a.building.padEnd(16)} ${reports}`);
}
console.log();
l.close();
