/**
 * Have the village draw itself.
 *
 *   node scripts/draw-village.ts
 *
 * Writes an SVG per building plus a few trees, and hangs them in the manifest.
 * Costs nothing and needs no image model — which is the point of using SVG.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { World } from '../src/worldfs/world.ts';
import { resolveConfig } from '../src/core/config.ts';
import { systemClock } from '../src/core/clock.ts';
import { registerAsset, assetsDir } from '../src/village/assets.ts';
import { buildingSvg, treeSvg } from '../src/village/svg.ts';
import { PROPS, wallSvg } from '../src/village/props.ts';
import { HOUSES } from '../src/village/map.ts';

const cfg = resolveConfig();
const world = new World(cfg.worldDir, systemClock);
const dir = assetsDir(world);
mkdirSync(dir, { recursive: true });

let hung = 0;
for (const h of HOUSES) {
  const file = `house-${h.id}.svg`;
  const svg = buildingSvg({
    name: h.name, department: h.department,
    wTiles: h.w, hTiles: h.h,
    smoke: h.department !== 'analytics',
  });
  writeFileSync(join(dir, file), svg, 'utf8');
  const m = /viewBox="0 -(\d+) (\d+) (\d+)"/.exec(svg);
  const r = registerAsset(world, {
    key: `house/${h.id}`, file, w: Number(m?.[2] ?? h.w * 32), h: Number(m?.[3] ?? h.h * 32 + 12),
    by: 'ansel', at: systemClock.iso(), brief: `${h.name}, drawn by the Workshop`,
  });
  if (r.ok) hung++;
  else console.error(`  ! ${h.id}: ${r.reason}`);
}

for (let v = 0; v < 3; v++) {
  const file = `prop-tree-${v}.svg`;
  writeFileSync(join(dir, file), treeSvg(v), 'utf8');
  const r = registerAsset(world, {
    key: `prop/tree-${v}`, file, w: 48, h: 56,
    by: 'ansel', at: systemClock.iso(), brief: 'an oak',
  });
  if (r.ok) hung++;
}

// the small things — density is what separates a village from a diagram
for (const [name, make] of Object.entries(PROPS)) {
  const file = `prop-${name}.svg`;
  const svg = make();
  writeFileSync(join(dir, file), svg, 'utf8');
  const m = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  const r = registerAsset(world, {
    key: `prop/${name}`, file, w: Number(m?.[1] ?? 32), h: Number(m?.[2] ?? 32),
    by: 'ansel', at: systemClock.iso(), brief: name,
  });
  if (r.ok) hung++; else console.error(`  ! ${name}: ${r.reason}`);
}

// plot walls
for (const [key, horizontal] of [['wall/h', true], ['wall/v', false]] as const) {
  const file = `wall-${horizontal ? 'h' : 'v'}.svg`;
  writeFileSync(join(dir, file), wallSvg(horizontal), 'utf8');
  const r = registerAsset(world, {
    key, file, w: horizontal ? 32 : 12, h: horizontal ? 12 : 32,
    by: 'ansel', at: systemClock.iso(), brief: 'a run of stone wall',
  });
  if (r.ok) hung++; else console.error(`  ! ${key}: ${r.reason}`);
}

world.git.commitAs({ id: 'ansel', name: 'Ansel' }, `ansel: drew ${hung} pieces for the village`);
console.log(`\n  hung ${hung} pieces in ${dir}\n`);
