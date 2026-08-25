/**
 * Open the Inn. Idempotent — safe to re-run; it upserts rather than clobbers,
 * and never overwrites a persona the staff have since edited themselves.
 *
 *   node scripts/seed.ts [worldDir] [ledgerPath]
 */
import { mkdirSync } from 'node:fs';
import { Ledger } from '../src/ledger/ledger.ts';
import { World } from '../src/worldfs/world.ts';
import { systemClock } from '../src/core/clock.ts';
import { titleFor } from '../src/core/titles.ts';
import { DEFAULT_HOUSE_RULES } from '../src/policy/rules.ts';
import { HOUSES, houseById } from '../src/village/map.ts';
import { OPENING_STAFF } from '../src/village/staff.ts';

const worldDir = process.argv[2] ?? 'world';
const ledgerPath = process.argv[3] ?? 'var/ledger.db';

mkdirSync('var', { recursive: true });

const clock = systemClock;
const world = new World(worldDir, clock);
const ledger = new Ledger(ledgerPath, clock);

world.ensure();

// ---------------------------------------------------------------- the grounds
for (const h of HOUSES) ledger.upsertBuilding(h);
console.log(`grounds: ${HOUSES.length} houses`);

// ------------------------------------------------------------- the House Rules
const r = DEFAULT_HOUSE_RULES;
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

// ----------------------------------------------------------------- the staff
let hired = 0;
for (const s of OPENING_STAFF) {
  const house = houseById(s.house);
  if (!house) throw new Error(`${s.name} was assigned to '${s.house}', which is not on the grounds`);

  // "The Market" -> "Market", so titles read "Market Manager".
  const shortName = house.name.replace(/^The\s+/i, '');

  ledger.upsertAgent({
    id: s.id,
    name: s.name,
    role: s.role,
    title: titleFor(s.role, shortName),
    reportsTo: s.reportsTo,
    building: s.house,
    department: house.department,
    status: 'active',
    hiredAt: clock.iso(),
    hiredBy: null,
    model: 'claude-opus-5',
  });

  world.ensureStaff(s.id);

  // Only write a brief if they do not have one. Once the staff start editing
  // their own personas, re-seeding must not talk over them.
  const personaPath = world.personaPath(s.id);
  if (!world.exists(personaPath)) {
    world.writeDoc(personaPath, {
      data: { agent: s.id, role: s.role, house: s.house, written_by: 'the-inn' },
      body: `# ${s.name}\n\n${s.brief}\n`,
    });
  }

  ledger.setPosition({
    agentId: s.id, x: house.doorX, y: house.doorY,
    facing: 'down', activity: 'just arrived',
  });
  hired++;
}
console.log(`staff: ${hired} on the books`);

// ------------------------------------------------------------------ commons
if (!world.exists('commons/bulletin/README.md')) {
  world.writeDoc('commons/bulletin/README.md', {
    data: { title: 'The Commons' },
    body: `# The Commons

Shared ground. Anyone may read or write anything here.

There is no schema and no approval needed. If the Inn needs something that
does not exist yet, make it here.
`,
  });
}

ledger.emit('inn', 'inn.seeded', null, { houses: HOUSES.length, staff: hired });
world.reindexNotes(ledger);

const sha = world.git.commitAs({ id: 'inn', name: 'The Inn' }, 'The Inn opens');
console.log(`world:  ${world.root}${sha ? ` @ ${sha.slice(0, 7)}` : ' (no changes)'}`);
console.log(`ledger: ${ledgerPath}`);
console.log('\nThe Inn is open.');
ledger.close();
