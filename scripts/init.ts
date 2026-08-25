/**
 * Build the Inn, asking who keeps it.
 *
 *   node scripts/init.ts
 *   INN_KEEPER="Dana" node scripts/init.ts        (non-interactive)
 *   INN_HOME=/some/where node scripts/init.ts
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { resolveConfig, scaffoldConfig, isInitialised, keeperId, type InnConfig } from '../src/core/config.ts';
import { openTheInn } from '../src/village/open.ts';
import { systemClock } from '../src/core/clock.ts';

let cfg: InnConfig = resolveConfig();

if (isInitialised(cfg)) {
  console.log(`\n  The Inn at ${cfg.home} is already built.`);
  console.log(`  Inn Keeper: ${cfg.innkeeper.name}\n`);
  process.exit(0);
}

// Only ask when there is somebody there to answer. Scripted and CI runs fall
// through to the guess, which is why INN_KEEPER exists.
if (stdin.isTTY && !process.env['INN_KEEPER']) {
  const rl = createInterface({ input: stdin, output: stdout });
  console.log(`\n  Building a new Inn at ${cfg.home}`);
  const answer = (await rl.question(`  Who keeps it? [${cfg.innkeeper.name}] `)).trim();
  rl.close();
  if (answer) cfg = { ...cfg, innkeeper: { id: keeperId(answer), name: answer } };
}

scaffoldConfig(cfg);
const { ledger } = openTheInn(cfg, systemClock);

console.log(`\n  home       : ${cfg.home}`);
console.log(`  world      : ${cfg.worldDir}`);
console.log(`  ledger     : ${cfg.ledgerPath}`);
console.log(`  Inn Keeper : ${cfg.innkeeper.name} (${cfg.innkeeper.id})`);
console.log(`  staff      : ${ledger.listAgents().length}`);
console.log(`\n  The Inn is open. Run: npm run inn\n`);
ledger.close();
