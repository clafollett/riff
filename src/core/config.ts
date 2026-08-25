import { homedir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { userInfo } from 'node:os';

/**
 * Where the Inn lives.
 *
 * Nothing here is baked into source. The location is RESOLVED at runtime and
 * SCAFFOLDED on init, because the living Inn is data — it outlives any one
 * checkout, and it must survive the project folder being moved or renamed.
 *
 * Resolution order, first match wins:
 *   1. INN_KEEPER / HELMSTED_WORLD / HELMSTED_LEDGER   explicit overrides
 *   2. HELMSTED_HOME                    relocate the whole Inn
 *   3. ./inn.config.json           project-local, for development
 *   4. ~/.lafollett-bnb/config.json  the scaffolded default
 *   5. built-in defaults           only ever used to WRITE #4, never assumed
 */

export type InnConfig = {
  version: 1;
  /** The Inn's root. world/ and ledger.db live under it unless overridden. */
  home: string;
  worldDir: string;
  ledgerPath: string;
  /**
   * Whose Inn this is. Every install has a different human at the top, so the
   * Inn Keeper is configuration, never a name in the source.
   */
  company: { name: string; business: string };
  /** Humans. Terminal authority. */
  board: Array<{ id: string; name: string; role: string }>;
  /** The primary agent. Builds the company. */
  ceo: { id: string; name: string };
  /**
   * External MCP servers handed to every staff session — an image generator,
   * a calendar, an inbox. The Inn knows nothing about any specific provider;
   * plugging one in is a config change, not a code change.
   *
   * Credentials belong in headers here, and this file is gitignored. Anything
   * these tools reach still crosses the gate: touching the outside world is
   * `external.write`, which always lands as a draft.
   */
  connectors: Record<string, { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }>;
};

/** Best guess at who is running this, for the first-run prompt to confirm. */
export const guessKeeperName = (): string => {
  const fromEnv = process.env['HELMSTED_CHAIR'];
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  try {
    const g = execFileSync('git', ['config', '--get', 'user.name'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (g) return g.split(/\s+/)[0] ?? g;
  } catch { /* no git identity configured */ }
  const u = userInfo().username;
  return u ? u.charAt(0).toUpperCase() + u.slice(1) : 'Keeper';
};

/** Filesystem- and id-safe handle derived from a display name. */
export const slugId = (name: string): string =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'keeper';

export const DEFAULT_HOME = join(homedir(), '.helmsted');
const PROJECT_CONFIG = 'helmsted.config.json';
const CONFIG_NAME = 'config.json';

const abs = (base: string, p: string): string => (isAbsolute(p) ? p : resolve(base, p));

const fromHome = (home: string): InnConfig => {
  const name = guessKeeperName();
  return {
    version: 1,
    home,
    worldDir: join(home, 'world'),
    ledgerPath: join(home, 'ledger.db'),
    company: { name: 'Untitled Company', business: '' },
    board: [{ id: slugId(name), name, role: 'Chairman' }],
    ceo: { id: 'ceo', name: 'CEO' },
    connectors: {},
  };
};

const readConfigFile = (path: string): Partial<InnConfig> | null => {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')) as Partial<InnConfig>; }
  catch { return null; }
};

/** Resolve without touching disk beyond reading. Never creates anything. */
export const resolveConfig = (cwd = process.cwd()): InnConfig => {
  const env = process.env;
  const home = env['HELMSTED_HOME'] ? abs(cwd, env['HELMSTED_HOME']) : null;

  const projectCfg = readConfigFile(join(cwd, PROJECT_CONFIG));
  const homeCfg = readConfigFile(join(home ?? DEFAULT_HOME, CONFIG_NAME));

  const base = home
    ?? (projectCfg?.home ? abs(cwd, projectCfg.home) : null)
    ?? (homeCfg?.home ? abs(cwd, homeCfg.home) : null)
    ?? DEFAULT_HOME;

  const merged = { ...fromHome(base), ...homeCfg, ...projectCfg, home: base };

  // An explicit INN_KEEPER wins; otherwise a stored keeper is kept forever,
  // because renaming the Inn Keeper mid-life would orphan every approval,
  // note and commit already attributed to them.
  const chairName = env['HELMSTED_CHAIR']?.trim() || merged.board?.[0]?.name || guessKeeperName();
  const board = merged.board?.length
    ? merged.board
    : [{ id: slugId(chairName), name: chairName, role: 'Chairman' }];

  return {
    version: 1,
    home: base,
    worldDir: env['HELMSTED_WORLD'] ? abs(cwd, env['HELMSTED_WORLD']) : abs(base, merged.worldDir ?? 'world'),
    ledgerPath: env['HELMSTED_LEDGER'] ? abs(cwd, env['HELMSTED_LEDGER']) : abs(base, merged.ledgerPath ?? 'ledger.db'),
    company: {
      name: env['HELMSTED_COMPANY']?.trim() || merged.company?.name || 'Untitled Company',
      business: env['HELMSTED_BUSINESS']?.trim() || merged.company?.business || '',
    },
    board,
    ceo: merged.ceo ?? { id: 'ceo', name: 'CEO' },
    connectors: merged.connectors ?? {},
  };
};

/** Create the Inn's home and write the config. Idempotent. */
export const scaffoldConfig = (cfg: InnConfig): { created: boolean; path: string } => {
  mkdirSync(cfg.home, { recursive: true });
  mkdirSync(cfg.worldDir, { recursive: true });
  mkdirSync(resolve(cfg.ledgerPath, '..'), { recursive: true });

  const path = join(cfg.home, CONFIG_NAME);
  if (existsSync(path)) return { created: false, path };

  writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  return { created: true, path };
};

export const isInitialised = (cfg: InnConfig): boolean =>
  existsSync(join(cfg.home, CONFIG_NAME)) && existsSync(cfg.ledgerPath);
