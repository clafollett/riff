import { existsSync } from 'node:fs';
import { Ledger } from '../ledger/ledger.ts';
import { World } from '../worldfs/world.ts';
import { titleFor } from '../core/titles.ts';
import { houseRulesFor } from '../policy/rules.ts';
import { HOUSES, houseById } from './map.ts';
import { OPENING_STAFF, INNKEEPER_SLOT } from './staff.ts';
import { scaffoldConfig, type InnConfig } from '../core/config.ts';
import type { Clock } from '../core/clock.ts';

/**
 * Build the Inn if it does not exist yet, then hand it back ready to run.
 *
 * Idempotent by construction — everything upserts, and a persona the staff
 * have since rewritten is never overwritten. This is what lets a fresh clone
 * on someone else's machine become a working village with no setup steps:
 * their Inn is theirs, seeded from the same opening staff but sharing none of
 * anyone else's history.
 */
export const openTheInn = (cfg: InnConfig, clock: Clock): {
  ledger: Ledger; world: World; firstRun: boolean;
} => {
  const firstRun = !existsSync(cfg.ledgerPath);
  scaffoldConfig(cfg);

  const world = new World(cfg.worldDir, clock);
  const ledger = new Ledger(cfg.ledgerPath, clock);
  world.ensure();

  for (const h of HOUSES) ledger.upsertBuilding(h);

  const r = houseRulesFor(cfg.innkeeper.id);
  if (!world.exists('house-rules.md')) {
    world.writeDoc('house-rules.md', {
      data: { authority: 'inn-keeper', enforced: 'in code, not in prose' },
      body: `# The House Rules

Five rules. Everything else at the Inn, the staff decided for themselves.

**1. Work well together.**

**2. Get work done however you see fit** — so long as the Steward approves
what needs approving.

**3. You may take work all the way out into the real world, but it always
lands as a draft.** Nothing goes live without the Inn Keeper.

**4. Only ${r.treasurers.join(' and ')} may spend money**, and only up to
$${(r.dailyCapCents / 100).toFixed(2)} a day.

**5. If the Inn Keeper is not around, do not stop.** Keep the work moving.

---

Rules 2, 3 and 4 are not requests. They are enforced by the Inn itself —
every action passes a gate before it happens, and no amount of reasoning
gets around it. Rule 3 in particular has no override: there is exactly one
door to the outside world and it opens onto the Keeper's desk.

Rules 1 and 5 are yours to keep. Nothing checks them but each other.
`,
    });
  }

  // The Inn Keeper first — the staff report to them, so they must exist before
  // any foreign key points at them.
  const keeper = cfg.innkeeper;
  ledger.upsertAgent({
    id: keeper.id, name: keeper.name, role: 'innkeeper', title: titleFor('innkeeper'),
    reportsTo: null, building: 'the-house', department: 'civic', status: 'active',
    hiredAt: clock.iso(), hiredBy: null, model: 'claude-opus-5',
  });
  world.ensureStaff(keeper.id);
  if (!world.exists(world.personaPath(keeper.id))) {
    world.writeDoc(world.personaPath(keeper.id), {
      data: { agent: keeper.id, role: 'innkeeper', house: 'the-house', written_by: 'the-inn' },
      body: `# ${keeper.name}\n\nThe Inn Keeper. The only human on the property.\n` +
            `Everything here exists to give them back their time.\n`,
    });
  }
  if (!ledger.listPositions().some((p) => p.agentId === keeper.id)) {
    const house = houseById('the-house')!;
    ledger.setPosition({
      agentId: keeper.id, x: house.doorX, y: house.doorY, facing: 'down', activity: 'home',
    });
  }

  for (const s of OPENING_STAFF) {
    const house = houseById(s.house);
    if (!house) throw new Error(`${s.name} was assigned to '${s.house}', which is not on the grounds`);
    const shortName = house.name.replace(/^The\s+/i, '');

    ledger.upsertAgent({
      id: s.id, name: s.name, role: s.role, title: titleFor(s.role, shortName),
      reportsTo: s.reportsTo === INNKEEPER_SLOT ? keeper.id : s.reportsTo,
      building: s.house, department: house.department,
      status: 'active', hiredAt: clock.iso(), hiredBy: null, model: 'claude-opus-5',
    });
    world.ensureStaff(s.id);

    // Never talk over a brief the staff have edited themselves.
    const personaPath = world.personaPath(s.id);
    if (!world.exists(personaPath)) {
      world.writeDoc(personaPath, {
        data: { agent: s.id, role: s.role, house: s.house, written_by: 'the-inn' },
        body: `# ${s.name}\n\n${s.brief}\n`,
      });
    }
    if (!ledger.listPositions().some((p) => p.agentId === s.id)) {
      ledger.setPosition({
        agentId: s.id, x: house.doorX, y: house.doorY,
        facing: 'down', activity: 'just arrived',
      });
    }
  }

  if (!world.exists('commons/bulletin/README.md')) {
    world.writeCommons('bulletin/README.md', { title: 'The Commons' },
      `# The Commons

Shared ground. Anyone may read or write anything here.

There is no schema and no approval needed. If the Inn needs something that
does not exist yet, make it here.
`);
  }

  world.reindexNotes(ledger);
  if (firstRun) {
    ledger.emit('inn', 'inn.seeded', null, {
      houses: HOUSES.length, staff: OPENING_STAFF.length + 1, innkeeper: keeper.id,
    });
    world.git.commitAs({ id: 'inn', name: 'The Inn' }, 'The Inn opens');
  }
  return { ledger, world, firstRun };
};
