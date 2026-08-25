import { Ledger } from '../src/ledger/ledger.ts';
import { resolveConfig } from '../src/core/config.ts';
const l = new Ledger(resolveConfig().ledgerPath);
console.log('  every gate decision on `hire`:');
for (const e of l.eventsSince(0, 100000)) {
  const d = e.dataJson ? JSON.parse(e.dataJson) : {};
  if (d.capability === 'hire') console.log(`   ${e.kind.padEnd(14)} rule=${d.rule}  "${String(d.summary).slice(0,50)}"`);
}
console.log(`\n  agents      : ${l.listAgents().map(a=>a.id).join(', ')}`);
console.log(`  approvals   : ${l.listApprovals('pending').length} pending, ${l.listApprovals('approved').length} approved`);
console.log('  role.filled events:', l.eventsSince(0,100000).filter(e=>e.kind==='role.filled').length);
l.close();
