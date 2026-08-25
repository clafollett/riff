/**
 * Scaffold the Inn. Run once; safe to re-run.
 *
 *   node scripts/init.ts              → ~/.lafollett-bnb
 *   INN_HOME=/some/where node scripts/init.ts
 */
import { resolveConfig, scaffoldConfig, isInitialised } from '../src/core/config.ts';

const cfg = resolveConfig();
const existed = isInitialised(cfg);
const { created, path } = scaffoldConfig(cfg);

console.log(`\n  Inn home : ${cfg.home}`);
console.log(`  world    : ${cfg.worldDir}`);
console.log(`  ledger   : ${cfg.ledgerPath}`);
console.log(`  config   : ${path} ${created ? '(written)' : '(already there)'}`);
console.log(existed ? '\n  The Inn is already built.\n' : '\n  Scaffolded. Now run: node scripts/seed.ts\n');
