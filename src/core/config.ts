import { homedir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

/**
 * Where the Inn lives.
 *
 * Nothing here is baked into source. The location is RESOLVED at runtime and
 * SCAFFOLDED on init, because the living Inn is data — it outlives any one
 * checkout, and it must survive the project folder being moved or renamed.
 *
 * Resolution order, first match wins:
 *   1. INN_WORLD / INN_LEDGER      explicit per-path override
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
};

export const DEFAULT_HOME = join(homedir(), '.lafollett-bnb');
const PROJECT_CONFIG = 'inn.config.json';
const CONFIG_NAME = 'config.json';

const abs = (base: string, p: string): string => (isAbsolute(p) ? p : resolve(base, p));

const fromHome = (home: string): InnConfig => ({
  version: 1,
  home,
  worldDir: join(home, 'world'),
  ledgerPath: join(home, 'ledger.db'),
});

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

  return {
    version: 1,
    home: base,
    worldDir: env['INN_WORLD'] ? abs(cwd, env['INN_WORLD']) : abs(base, merged.worldDir ?? 'world'),
    ledgerPath: env['INN_LEDGER'] ? abs(cwd, env['INN_LEDGER']) : abs(base, merged.ledgerPath ?? 'ledger.db'),
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
