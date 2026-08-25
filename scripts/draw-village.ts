/**
 * Have the village draw itself.
 *
 *   node scripts/draw-village.ts
 *
 * Costs nothing and needs no image model — SVG is the one image format a
 * language model can author directly, which is why the art loop lives here.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { World } from '../src/worldfs/world.ts';
import { Ledger } from '../src/ledger/ledger.ts';
import { resolveConfig } from '../src/core/config.ts';
import { systemClock } from '../src/core/clock.ts';
import { registerAsset, assetsDir } from '../src/village/assets.ts';
import { buildingSvg, characterSvg, type Look } from '../src/village/svg.ts';
import { PROPS, wallSvg } from '../src/village/props.ts';
import { HOUSES } from '../src/village/map.ts';
import { ramp } from '../src/village/palette.ts';

const cfg = resolveConfig();
const world = new World(cfg.worldDir, systemClock);
const ledger = new Ledger(cfg.ledgerPath, systemClock);
const dir = assetsDir(world);
mkdirSync(dir, { recursive: true });

let hung = 0;
const hang = (key: string, file: string, body: string, brief: string) => {
  writeFileSync(join(dir, file), body, 'utf8');
  const m = /viewBox="[-\d]+ [-\d]+ (\d+) (\d+)"|width="(\d+)" height="(\d+)"/.exec(body);
  const w = Number(m?.[1] ?? m?.[3] ?? 32), h = Number(m?.[2] ?? m?.[4] ?? 32);
  const res = registerAsset(world, { key, file, w, h, by: 'ansel', at: systemClock.iso(), brief });
  if (res.ok) hung++; else console.error(`  ! ${key}: ${res.reason}`);
};

// ---- buildings ----
for (const h of HOUSES) {
  hang(`house/${h.id}`, `house-${h.id}.svg`,
    buildingSvg({ name: h.name, department: h.department, wTiles: h.w, hTiles: h.h }),
    `${h.name}, drawn by the Workshop`);
}

// ---- props ----
for (const [name, make] of Object.entries(PROPS)) {
  hang(`prop/${name}`, `prop-${name}.svg`, make(), name);
}

// ---- walls ----
hang('wall/h', 'wall-h.svg', wallSvg(true), 'a run of stone wall');
hang('wall/v', 'wall-v.svg', wallSvg(false), 'a run of stone wall');

// ---- the staff, in the same visual language as everything else ----
const SHIRTS: Record<string, string> = {
  innkeeper: '#b8452f', steward: '#c47a2c',
  house_manager: '#3f6fa8', house_assistant: '#5d8a3a',
};
const HAIRS = ['#2e2018', '#4a2f1c', '#7a4a20', '#a86a2c', '#3a3a42', '#6b2f2f'];
const SKINS = [ramp('skin').hi, ramp('skin').light, ramp('skin').base, ramp('skin').dark];

for (const a of ledger.listAgents()) {
  const seed = [...a.id].reduce((n, c) => n + c.charCodeAt(0), 0);
  const look: Look = {
    skin: SKINS[seed % SKINS.length]!,
    hair: HAIRS[(seed * 3) % HAIRS.length]!,
    shirt: SHIRTS[a.role] ?? '#7a7a7a',
    trouser: seed % 2 ? '#3b3630' : '#463d33',
    ...(a.role === 'house_assistant' ? { vest: '#e8e04a' } : {}),
  };
  for (const facing of ['up', 'down', 'left', 'right'] as const) {
    hang(`staff/${a.id}/${facing}`, `staff-${a.id}-${facing}.svg`,
      characterSvg(look, facing), `${a.name} facing ${facing}`);
  }
}

world.git.commitAs({ id: 'ansel', name: 'Ansel' }, `ansel: drew ${hung} pieces for the village`);
console.log(`\n  hung ${hung} pieces in ${dir}\n`);
ledger.close();
