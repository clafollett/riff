/**
 * Found a company.
 *
 *   node scripts/init.ts
 *   HELMSTED_COMPANY="LaFollett Labs LLC" HELMSTED_BUSINESS="AI and agentic systems" \
 *   HELMSTED_CHAIR="Cali" node scripts/init.ts
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { resolveConfig, scaffoldConfig, isInitialised, slugId, type HelmstedConfig } from '../src/core/config.ts';
import { found } from '../src/company/genesis.ts';
import { systemClock } from '../src/core/clock.ts';

let cfg: HelmstedConfig = resolveConfig();

if (isInitialised(cfg)) {
  console.log(`\n  ${cfg.company.name} already exists at ${cfg.home}.\n`);
  process.exit(0);
}

// Only ask when somebody is there to answer; scripted runs use the env vars.
if (stdin.isTTY && !process.env['HELMSTED_COMPANY']) {
  const rl = createInterface({ input: stdin, output: stdout });
  console.log(`\n  Founding a company at ${cfg.home}`);
  const name = (await rl.question(`  Company name? [${cfg.company.name}] `)).trim();
  const business = (await rl.question('  Line of business? ')).trim();
  const chair = (await rl.question(`  Chairman? [${cfg.board[0]?.name ?? 'you'}] `)).trim();
  const ceo = (await rl.question(`  CEO's name? [${cfg.ceo.name}] `)).trim();
  rl.close();
  cfg = {
    ...cfg,
    company: { name: name || cfg.company.name, business: business || cfg.company.business },
    board: chair ? [{ id: slugId(chair), name: chair, role: 'Chairman' }] : cfg.board,
    ceo: ceo ? { id: slugId(ceo), name: ceo } : cfg.ceo,
  };
}

scaffoldConfig(cfg);
const { ledger } = found(cfg, systemClock);

console.log(`\n  ${cfg.company.name}`);
if (cfg.company.business) console.log(`  ${cfg.company.business}`);
console.log(`  board  : ${cfg.board.map((b) => `${b.name} (${b.role})`).join(', ')}`);
console.log(`  CEO    : ${cfg.ceo.name}`);
console.log(`  home   : ${cfg.home}`);
console.log(`\n  One agent works here. The CEO builds the rest.\n  Run: node scripts/tick.ts ${cfg.ceo.id}\n`);
ledger.close();
