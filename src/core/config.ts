import { homedir } from 'node:os';
import { join, resolve, isAbsolute } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { userInfo } from 'node:os';

/**
 * Where the company lives.
 *
 * Nothing here is baked into source. The location is RESOLVED at runtime and
 * SCAFFOLDED on init, because a living company is data — it outlives any one
 * checkout, and it must survive the project folder being moved or renamed.
 *
 * One installation holds MANY companies, each self-contained under
 * ~/.helmsted/companies/<slug>/ with its own world, ledger and config. A
 * company is a directory you can copy, archive, or delete whole — nothing
 * about one reaches into another.
 *
 * Resolution order, first match wins:
 *   1. HELMSTED_WORLD / HELMSTED_LEDGER   move one piece
 *   2. HELMSTED_HOME                      point at one company directly
 *   3. HELMSTED_COMPANY_ID                pick a company by slug
 *   4. ./helmsted.config.json             project-local, for development
 *   5. the only company that exists       the common case
 *   6. built-in defaults                  only ever used to WRITE a new one
 *
 * Identity — HELMSTED_COMPANY, HELMSTED_BUSINESS, HELMSTED_CHAIR,
 * HELMSTED_CEO — overrides the stored config on every read, which is what
 * makes a container run reproducible from environment alone.
 */

export type HelmstedConfig = {
  version: 1;
  /** The company's root. world/ and ledger.db live under it unless overridden. */
  home: string;
  worldDir: string;
  ledgerPath: string;
  /**
   * Whose company this is. Every install has a different human at the top, so
   * the chair is configuration, never a name in the source.
   */
  company: { name: string; business: string };
  /** Humans. Terminal authority. */
  board: Array<{ id: string; name: string; role: string }>;
  /** The primary agent. Builds the company. */
  ceo: { id: string; name: string };
  /**
   * External MCP servers handed to every staff session — an image generator,
   * a calendar, an inbox. Helmsted knows nothing about any specific provider;
   * plugging one in is a config change, not a code change.
   *
   * Credentials belong in headers here, and this file is gitignored. Anything
   * these tools reach still crosses the gate: touching the outside world is
   * `external.write`, which always lands as a draft.
   */
  connectors: Record<string, { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }>;
  /**
   * Whether this company should be working.
   *
   * Persisted because a scheduler lives in a process and the operator's
   * intent does not. Restarting the server used to silently pause every
   * company that was running, with the console cheerfully reporting idle.
   */
  running?: boolean;
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

const PROJECT_CONFIG = 'helmsted.config.json';
const CONFIG_NAME = 'config.json';

/**
 * An error the operator can act on, as opposed to a defect. Scripts print the
 * message and stop; a stack trace here would bury the one line that helps.
 */
const OPERATOR_ERROR = Symbol.for('helmsted.operatorError');
export const operatorError = (message: string): Error =>
  Object.assign(new Error(message), { [OPERATOR_ERROR]: true });
export const isOperatorError = (e: unknown): boolean =>
  e instanceof Error && (e as unknown as Record<symbol, unknown>)[OPERATOR_ERROR] === true;

const readConfigFile = (path: string): Partial<HelmstedConfig> | null => {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')) as Partial<HelmstedConfig>; }
  catch { return null; }
};

/**
 * The installation root — read at CALL time, never frozen at import.
 *
 * These were module constants derived from homedir(), which meant the e2e
 * suite listed and could open the operator's real companies even though its
 * config set a throwaway home. A containment boundary that only holds until
 * someone imports the module early is not a boundary.
 */
export const installRoot = (env = process.env): string =>
  env['HELMSTED_ROOT']?.trim() || join(homedir(), '.helmsted');

export const companiesDir = (env = process.env): string => join(installRoot(env), 'companies');

/**
 * Where removed companies go.
 *
 * A company is a git repository with real history in it. Nothing here deletes
 * one — removing it moves it aside, stamped, and the operator can throw it
 * away themselves once they are sure. Making removal cheap is the point;
 * making it irreversible is not.
 */
export const archiveDir = (env = process.env): string => join(installRoot(env), 'archive');

/** Where one company lives. Self-contained: world, ledger, config. */
export const companyHome = (slug: string): string => join(companiesDir(), slug);

export type CompanyRef = {
  slug: string;
  name: string;
  business: string;
  home: string;
  ceo: string;
  founded: boolean;
  /** What the operator last asked for, which a restart must honour. */
  wanted: boolean;
};

const readRef = (slug: string): CompanyRef | null => {
  const home = companyHome(slug);
  const cfg = readConfigFile(join(home, CONFIG_NAME));
  if (!cfg) return null;
  return {
    slug,
    name: cfg.company?.name ?? slug,
    business: cfg.company?.business ?? '',
    home,
    ceo: cfg.ceo?.name ?? 'CEO',
    founded: existsSync(join(home, 'ledger.db')),
    wanted: cfg.running === true,
  };
};

/** Every company on this machine, newest activity first. */
export const listCompanies = (): CompanyRef[] => {
  const dir = companiesDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((d) => { try { return statSync(join(dir, d)).isDirectory(); } catch { return false; } })
    .map(readRef)
    .filter((r): r is CompanyRef => r !== null)
    .sort((a, b) => {
      const at = (p: string) => { try { return statSync(join(p, 'ledger.db')).mtimeMs; } catch { return 0; } };
      return at(b.home) - at(a.home);
    });
};

/**
 * The first layout put a single company flat in ~/.helmsted. Anyone who ran
 * Helmsted before companies existed has a live world there, with its own git
 * history, so this moves it rather than leaving it stranded. Idempotent, and
 * it never overwrites an existing company directory.
 */
export const migrateLegacyLayout = (): { moved: string } | null => {
  const root = installRoot();
  const legacyCfg = join(root, CONFIG_NAME);
  if (!existsSync(legacyCfg) || !existsSync(join(root, 'world'))) return null;

  const cfg = readConfigFile(legacyCfg);
  const slug = slugId(cfg?.company?.name ?? 'company');
  const target = companyHome(slug);
  if (existsSync(target)) return null;

  mkdirSync(companiesDir(), { recursive: true });
  mkdirSync(target, { recursive: true });
  // Move rather than copy: the world is a git repository and the ledger has
  // sidecar -wal/-shm files. Renaming the whole set keeps them consistent.
  for (const entry of ['world', 'ledger.db', 'ledger.db-wal', 'ledger.db-shm', CONFIG_NAME]) {
    const from = join(root, entry);
    if (existsSync(from)) renameSync(from, join(target, entry));
  }
  // The stored config records absolute paths from the old location.
  const moved = readConfigFile(join(target, CONFIG_NAME));
  if (moved) {
    writeFileSync(join(target, CONFIG_NAME), JSON.stringify({
      ...moved, home: target, worldDir: join(target, 'world'), ledgerPath: join(target, 'ledger.db'),
    }, null, 2) + '\n', 'utf8');
  }
  return { moved: slug };
};

const abs = (base: string, p: string): string => (isAbsolute(p) ? p : resolve(base, p));

const fromHome = (home: string): HelmstedConfig => {
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

/** Resolve without touching disk beyond reading. Never creates anything. */
/**
 * Which company a bare invocation means.
 *
 * An explicit slug always wins. Otherwise: if exactly one company exists, that
 * is unambiguously the one — and if several do, refusing to guess is better
 * than picking one and writing to it. The caller names it.
 */
export const resolveSlug = (env = process.env): string | null => {
  const explicit = env['HELMSTED_COMPANY_ID']?.trim();
  if (explicit) return slugId(explicit);
  const all = listCompanies();
  return all.length === 1 ? all[0]!.slug : null;
};

export const resolveConfig = (cwd = process.cwd(), slug?: string): HelmstedConfig => {
  const env = process.env;
  const pick = slug ?? resolveSlug(env);
  const explicitHome = env['HELMSTED_HOME'] ? abs(cwd, env['HELMSTED_HOME']) : null;

  // Several companies exist and nobody said which. Falling through here would
  // scaffold a brand new world at the INSTALL ROOT, next to the companies
  // directory rather than inside it — a silent third company nobody asked for.
  // Refusing is the only safe answer, and the message names the way out.
  if (!explicitHome && !pick && !readConfigFile(join(cwd, PROJECT_CONFIG))) {
    const all = listCompanies();
    if (all.length > 1) {
      throw operatorError(
        `This installation holds ${all.length} companies and none was named.\n` +
        `  Pass --company <slug>, or set HELMSTED_COMPANY_ID.\n` +
        // Sorted, not by recency: a list you read to pick a name should be in
        // the same order every time, whatever you ran last.
        `  Known: ${all.map((c) => c.slug).sort().join(', ')}`,
      );
    }
  }

  const home = explicitHome ?? (pick ? companyHome(pick) : null);

  const projectCfg = readConfigFile(join(cwd, PROJECT_CONFIG));
  const homeCfg = readConfigFile(join(home ?? installRoot(), CONFIG_NAME));

  const base = home
    ?? (projectCfg?.home ? abs(cwd, projectCfg.home) : null)
    ?? (homeCfg?.home ? abs(cwd, homeCfg.home) : null)
    ?? installRoot();

  const merged = { ...fromHome(base), ...homeCfg, ...projectCfg, home: base };

  // An explicit HELMSTED_CHAIR wins; otherwise the stored chair is kept
  // forever, because renaming them mid-life would orphan every approval,
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
    ceo: env['HELMSTED_CEO']?.trim()
      ? { id: slugId(env['HELMSTED_CEO'].trim()), name: env['HELMSTED_CEO'].trim() }
      : merged.ceo ?? { id: 'ceo', name: 'CEO' },
    connectors: merged.connectors ?? {},
  };
};

/** Record whether a company should be working, for the next process to honour. */
export const setRunningFlag = (home: string, running: boolean): void => {
  const path = join(home, CONFIG_NAME);
  const cfg = readConfigFile(path);
  if (!cfg) return;
  writeFileSync(path, JSON.stringify({ ...cfg, running }, null, 2) + '\n', 'utf8');
};

/** Create the company's home and write the config. Idempotent. */
export const scaffoldConfig = (cfg: HelmstedConfig): { created: boolean; path: string } => {
  mkdirSync(cfg.home, { recursive: true });
  mkdirSync(cfg.worldDir, { recursive: true });
  mkdirSync(resolve(cfg.ledgerPath, '..'), { recursive: true });

  const path = join(cfg.home, CONFIG_NAME);
  if (existsSync(path)) return { created: false, path };

  writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  return { created: true, path };
};

export const isInitialised = (cfg: HelmstedConfig): boolean =>
  existsSync(join(cfg.home, CONFIG_NAME)) && existsSync(cfg.ledgerPath);
