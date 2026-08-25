import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve, sep, extname } from 'node:path';
import type { World } from '../worldfs/world.ts';
import type { AgentId } from '../core/types.ts';

/**
 * The village's own art.
 *
 * The staff generate this themselves through whichever image-generation MCP
 * connector the Inn Keeper has plugged in — the Inn supplies the money gate,
 * the bookkeeping and the naming scheme, and knows nothing about any specific
 * provider. Swapping Higgsfield for something else is a config change.
 *
 * Keys are structural, not filenames:
 *   house/<buildingId>            a building
 *   staff/<agentId>/<facing>      a character, one per direction
 *   prop/<name>, tile/<name>      scenery and ground
 *
 * The renderer asks for a key and falls back to drawn geometry when the Inn
 * has not made that piece yet, so art arrives incrementally without a rebuild.
 */

export type AssetEntry = {
  key: string;
  file: string;          // relative to assets/, never absolute
  w: number;
  h: number;
  by: AgentId;
  at: string;
  brief: string;
};

export type AssetManifest = { version: 1; assets: Record<string, AssetEntry> };

const ALLOWED = new Set(['.png', '.webp', '.jpg', '.jpeg']);
const EMPTY: AssetManifest = { version: 1, assets: {} };

export const assetsDir = (world: World): string => join(world.root, 'assets');
const manifestPath = (world: World): string => join(assetsDir(world), 'manifest.json');

export const readManifest = (world: World): AssetManifest => {
  const p = manifestPath(world);
  if (!existsSync(p)) return { ...EMPTY, assets: {} };
  try {
    const m = JSON.parse(readFileSync(p, 'utf8')) as AssetManifest;
    return m && typeof m === 'object' && m.assets ? m : { ...EMPTY, assets: {} };
  } catch {
    // A half-written manifest must not take the village down; the files on
    // disk are the truth and this can be rebuilt.
    return { ...EMPTY, assets: {} };
  }
};

const writeManifest = (world: World, m: AssetManifest): void => {
  mkdirSync(assetsDir(world), { recursive: true });
  writeFileSync(manifestPath(world), JSON.stringify(m, null, 2) + '\n', 'utf8');
};

/** Structural key check. Staff choose these, so they are validated, not trusted. */
export const isValidKey = (key: string): boolean =>
  /^(house\/[a-z0-9-]+|staff\/[a-z0-9-]+\/(up|down|left|right)|prop\/[a-z0-9-]+|tile\/[a-z0-9-]+)$/.test(key);

/**
 * Record a finished piece. The file must already sit inside assets/ — staff
 * cannot register something from elsewhere on the machine, and cannot register
 * a file type the browser would not treat as an image.
 */
export const registerAsset = (
  world: World,
  input: { key: string; file: string; w: number; h: number; by: AgentId; at: string; brief: string },
): { ok: true; entry: AssetEntry } | { ok: false; reason: string } => {
  if (!isValidKey(input.key)) {
    return { ok: false, reason: `'${input.key}' is not a valid asset key` };
  }
  const ext = extname(input.file).toLowerCase();
  if (!ALLOWED.has(ext)) {
    return { ok: false, reason: `${ext || 'that'} is not an image the village can use` };
  }

  const dir = resolve(assetsDir(world));
  const abs = resolve(dir, input.file);
  if (abs !== dir && !abs.startsWith(dir + sep)) {
    return { ok: false, reason: 'the file must live inside assets/' };
  }
  if (!existsSync(abs) || !statSync(abs).isFile()) {
    return { ok: false, reason: `${input.file} is not there yet — generate it first` };
  }

  const m = readManifest(world);
  const entry: AssetEntry = {
    key: input.key, file: abs.slice(dir.length + 1),
    w: input.w, h: input.h, by: input.by, at: input.at, brief: input.brief,
  };
  m.assets[input.key] = entry;
  writeManifest(world, m);
  return { ok: true, entry };
};

/** A brief the staff write before spending anything, so the ask is on record. */
export const writeSpec = (
  world: World, key: string, brief: string, by: AgentId, at: string,
): string => {
  const rel = `assets/specs/${key.replace(/\//g, '__')}.md`;
  world.writeDoc(rel, {
    data: { key, by, at, status: 'commissioned' },
    body: `# ${key}\n\n${brief}\n`,
  });
  return rel;
};
