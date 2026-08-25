import { existsSync } from 'node:fs';
import { Ledger } from '../ledger/ledger.ts';
import { World } from '../worldfs/world.ts';
import { constitutionFor, RULES_TEXT } from '../policy/rules.ts';
import { scaffoldConfig, type InnConfig } from '../core/config.ts';
import type { Clock } from '../core/clock.ts';

/**
 * Found the company.
 *
 * This creates the board and ONE agent: the CEO. There is no roster, no
 * department list, no org chart — those are the CEO's to invent from the
 * company's line of business, and they arrive as proposals the board approves.
 *
 * That is the whole bet. A cast written by me is a simulation of a company; a
 * cast the CEO argues for is the beginning of one.
 */
export const found = (cfg: InnConfig, clock: Clock): {
  ledger: Ledger; world: World; firstRun: boolean;
} => {
  const firstRun = !existsSync(cfg.ledgerPath);
  scaffoldConfig(cfg);

  const world = new World(cfg.worldDir, clock);
  const ledger = new Ledger(cfg.ledgerPath, clock);
  world.ensure();

  // ---- the board: humans, terminal authority ----
  for (const member of cfg.board) {
    ledger.upsertAgent({
      id: member.id, name: member.name, tier: 'board', role: member.role,
      department: 'board', reportsTo: null, status: 'active',
      activity: '', mandate: 'Terminal authority. Approves what leaves the company.',
      hiredAt: clock.iso(), hiredBy: null, model: 'human',
    });
    world.ensureStaff(member.id);
  }

  // ---- the CEO: the only agent that exists before the company does ----
  const chair = cfg.board[0];
  ledger.upsertAgent({
    id: cfg.ceo.id, name: cfg.ceo.name, tier: 'executive', role: 'CEO',
    department: 'office of the CEO', reportsTo: chair?.id ?? null, status: 'active',
    activity: 'founding the company',
    mandate: `Build ${cfg.company.name} into a company that does real work in ${cfg.company.business || 'its field'}. ` +
             `Decide what it is for, who it needs, and what it should ship. The board approves; you decide what to ask for.`,
    hiredAt: clock.iso(), hiredBy: chair?.id ?? null, model: 'claude-opus-5',
  });
  world.ensureStaff(cfg.ceo.id);

  const c = constitutionFor({ ceo: cfg.ceo.id, board: cfg.board.map((b) => b.id) });

  if (!world.exists('constitution.md')) {
    world.writeDoc('constitution.md', {
      data: { company: cfg.company.name, enforced: 'in code, not in prose' },
      body: `# ${cfg.company.name}\n\n${cfg.company.business ? `**Line of business:** ${cfg.company.business}\n\n` : ''}` +
            `## The Rules\n\n${RULES_TEXT(c)}\n`,
    });
  }

  // The CEO's opening brief. Deliberately a QUESTION, not a specification —
  // if the founding document told them what to build, nothing would emerge.
  if (!world.exists(`staff/${cfg.ceo.id}/persona.md`)) {
    world.writeDoc(`staff/${cfg.ceo.id}/persona.md`, {
      data: { agent: cfg.ceo.id, tier: 'executive', role: 'CEO' },
      body: [
        `# ${cfg.ceo.name}`,
        '',
        `You are the CEO of **${cfg.company.name}**${cfg.company.business ? `, a company in ${cfg.company.business}` : ''}.`,
        '',
        'You are the only person here. There is no staff, no plan, and no product.',
        'Nobody is going to hand you any of those.',
        '',
        '## What is yours to decide',
        '',
        '- **What this company is for.** Write a vision and a mission and put them in the commons.',
        '  Make them specific enough to be wrong.',
        '- **Who it needs.** Propose roles with real mandates — what each seat owns, and what',
        '  goes undone without it. Vague seats produce vague work.',
        '- **What it should ship first.** Something real, small enough to finish.',
        '',
        '## What is not yours',
        '',
        'Hiring needs the board. Anything reaching the outside world lands as a draft.',
        'Both of those are enforced by the company itself, so do not plan around them.',
        '',
        '## How to think about growth',
        '',
        'Every seat you add is a permanent cost. Every document in the commons is one',
        'somebody must later read. Argue for what earns its place, and say plainly when',
        'something has stopped earning it.',
      ].join('\n'),
    });
  }

  if (firstRun) {
    ledger.emit('company', 'company.founded', null, {
      company: cfg.company.name, business: cfg.company.business,
      board: cfg.board.map((b) => b.id), ceo: cfg.ceo.id,
    });
    world.git.commitAs({ id: 'company', name: cfg.company.name }, `${cfg.company.name} is founded`);
  }
  return { ledger, world, firstRun };
};
