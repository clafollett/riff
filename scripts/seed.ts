/**
 * Build the Inn. Idempotent — safe to re-run.
 * The server does this automatically on first boot; this is here for when you
 * want to do it deliberately.
 */
import { resolveConfig } from '../src/core/config.ts';
import { openTheInn } from '../src/village/open.ts';
import { systemClock } from '../src/core/clock.ts';

const cfg = resolveConfig();
const { ledger, world, firstRun } = openTheInn(cfg, systemClock);

console.log(`\n  home   : ${cfg.home}`);
console.log(`  world  : ${world.root}`);
console.log(`  ledger : ${cfg.ledgerPath}`);
console.log(`  staff  : ${ledger.listAgents().length}`);
console.log(firstRun ? '\n  The Inn is open.\n' : '\n  The Inn was already open.\n');
ledger.close();
