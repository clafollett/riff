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
 *   1. INN_KEEPER / INN_WORLD / INN_LEDGER   explicit overrides
 *   2. INN_HOME                    relocate the whole Inn
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
  innkeeper: { id: string; name: string };
};

/** Best guess at who is running this, for the first-run prompt to confirm. */
export const guessKeeperName = (): string => {
  const fromEnv = process.env['INN_KEEPER'];
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
export const keeperId = (name: string): string =>
  name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'keeper';

export const DEFAULT_HOME = join(homedir(), '.lafollett-bnb');
const PROJECT_CONFIG = 'inn.config.json';
const CONFIG_NAME = 'config.json';

const abs = (base: string, p: string): string => (isAbsolute(p) ? p : resolve(base, p));

const fromHome = (home: string): InnConfig => {
  const name = guessKeeperName();
  return {
    version: 1,
    home,
    worldDir: join(home, 'world'),
    ledgerPath: join(home, 'ledger.db'),
    innkeeper: { id: keeperId(name), name },
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
  const home = env['INN_HOME'] ? abs(cwd, env['INN_HOME']) : null;

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
  const storedKeeper = merged.innkeeper;
  const keeperName = env['INN_KEEPER']?.trim() || storedKeeper?.name || guessKeeperName();

  return {
    version: 1,
    home: base,
    worldDir: env['INN_WORLD'] ? abs(cwd, env['INN_WORLD']) : abs(base, merged.worldDir ?? 'world'),
    ledgerPath: env['INN_LEDGER'] ? abs(cwd, env['INN_LEDGER']) : abs(base, merged.ledgerPath ?? 'ledger.db'),
    innkeeper: { id: storedKeeper?.id ?? keeperId(keeperName), name: keeperName },
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
