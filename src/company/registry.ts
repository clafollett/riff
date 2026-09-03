import { Ledger } from '../ledger/ledger.ts';
import { World } from '../worldfs/world.ts';
import { Gate } from '../policy/gate.ts';
import { constitutionFor, type Constitution } from '../policy/rules.ts';
import { Scheduler } from '../runtime/scheduler.ts';
import { found } from './genesis.ts';
import {
  archiveDir, companyHome, DEFAULT_POLICY, listCompanies, persisted, readPolicy,
  resolveConfig, scaffoldConfig, setRunningFlag, slugId,
  type CompanyPolicy, type CompanyRef, type RiffConfig,
} from '../core/config.ts';
import type { Clock } from '../core/clock.ts';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One installation, many companies.
 *
 * Each company is a directory with its own world, ledger and constitution, and
 * nothing about one reaches into another — separate SQLite files, separate git
 * repositories, separate schedulers. That isolation is the point: founding a
 * second company must not be able to disturb the first.
 *
 * Contexts are opened lazily and kept, because a ledger connection and a
 * scheduler are expensive to build and the console switches between companies
 * on a click.
 */
export type Company = {
  slug: string;
  cfg: RiffConfig;
  ledger: Ledger;
  world: World;
  gate: Gate;
  constitution: Constitution;
  scheduler: Scheduler;
};

export class Registry {
  readonly #clock: Clock;
  readonly #open = new Map<string, Company>();

  constructor(clock: Clock) { this.#clock = clock; }

  /**
   * Every company, each carrying whether it is actually working.
   *
   * A company that has never been opened cannot be running, so the absence of
   * an entry in #open is itself the answer — no need to touch its ledger.
   */
  list(): Array<CompanyRef & { running: boolean; awake: string[] }> {
    return listCompanies().map((c) => {
      const open = this.#open.get(c.slug);
      return {
        ...c,
        running: open?.scheduler.running ?? false,
        awake: open ? open.scheduler.awake : [],
      };
    });
  }

  has(slug: string): boolean { return existsSync(companyHome(slug)); }

  /** Start or pause one company by slug, opening it if needed. */
  async setRunning(slug: string, run: boolean): Promise<boolean> {
    const c = this.get(slug);
    if (!c) return false;
    if (run) c.scheduler.start(); else await c.scheduler.stop();
    setRunningFlag(c.cfg.home, run);
    return true;
  }

  /**
   * Start every company the operator left running. Called once on boot, so a
   * restart does not silently pause work somebody asked for.
   */
  resume(): string[] {
    const back: string[] = [];
    for (const ref of listCompanies()) {
      if (!ref.wanted) continue;
      const c = this.get(ref.slug);
      if (!c) continue;
      c.scheduler.start();
      back.push(ref.slug);
    }
    return back;
  }

  /** Open a company, founding nothing. Returns null if the slug is unknown. */
  get(slug: string): Company | null {
    const already = this.#open.get(slug);
    if (already) return already;
    if (!this.has(slug)) return null;
    return this.#build(slug, resolveConfig(process.cwd(), slug));
  }

  /**
   * Found a new company. The board is inherited — one person runs this
   * installation and every company on it answers to them — but everything
   * else starts empty, because the CEO builds the rest.
   */
  found(input: { name: string; business: string; ceo: string; chair: string }):
    { ok: true; company: Company } | { ok: false; reason: string } {
    const name = input.name.trim();
    if (!name) return { ok: false, reason: 'a company needs a name' };
    const slug = slugId(name);
    if (this.has(slug)) return { ok: false, reason: `${slug} already exists` };

    const chair = input.chair.trim() || 'Chair';
    const ceo = input.ceo.trim() || 'CEO';
    const home = companyHome(slug);
    const cfg: RiffConfig = {
      version: 1,
      home,
      worldDir: `${home}/world`,
      ledgerPath: `${home}/ledger.db`,
      company: { name, business: input.business.trim() },
      board: [{ id: slugId(chair), name: chair, role: 'Chairman' }],
      ceo: { id: slugId(ceo), name: ceo },
      connectors: {},
      policy: DEFAULT_POLICY,
    };
    scaffoldConfig(cfg);
    return { ok: true, company: this.#build(slug, cfg) };
  }

  #build(slug: string, cfg: RiffConfig): Company {
    const { ledger, world } = found(cfg, this.#clock);
    // Made at open, so a volume that cannot be written to says so now rather
    // than a day later in the middle of somebody's build.
    const cacheDir = join(cfg.home, 'scratch', 'cache');
    mkdirSync(cacheDir, { recursive: true });
    const p = cfg.policy;
    const constitution = constitutionFor({
      ceo: cfg.ceo.id,
      board: cfg.board.map((b) => b.id),
      commonsCeiling: p.commonsCeiling,
      portfolioCeiling: p.portfolioCeiling,
      dailyCapCents: p.dailyCapCents,
    });
    const gate = new Gate(ledger, constitution, {
      count: () => world.commonsCount(),
      exists: (p) => world.exists(p),
    }, {
      count: () => world.projectCount(),
      has: (name) => world.listProjects().includes(name),
    });
    const scheduler = new Scheduler({
      ledger, gate, world, clock: this.#clock,
      options: {
        maxTurns: p.maxTurns,
        rotateAtContextPct: p.rotateAtContextPct,
        // Beside the world, never inside it: the end-of-turn commit stages the
        // whole tree, and a build cache is not part of anybody's work.
        cacheDir,
        concurrency: p.concurrency,
        baseIntervalMs: Math.round(p.baseIntervalMinutes * 60_000),
        throttleAboveUtilization: p.throttleAboveUtilization,
        pauseAboveUtilization: p.pauseAboveUtilization,
      },
      ...(Object.keys(cfg.connectors ?? {}).length ? { connectors: cfg.connectors } : {}),
    });
    const company: Company = { slug, cfg, ledger, world, gate, constitution, scheduler };
    this.#open.set(slug, company);
    return company;
  }

  /**
   * Let go of a company: stop its scheduler and close its ledger.
   * Anything that moves a company's directory must do this first, because an
   * open SQLite handle and a renamed path disagree about where the file is.
   */
  async close(slug: string): Promise<void> {
    const c = this.#open.get(slug);
    if (!c) return;
    await c.scheduler.stop();
    c.ledger.close();
    this.#open.delete(slug);
  }

  /**
   * Change what a company is called.
   *
   * The display name and the slug are deliberately independent. Renaming a
   * company should not have to move its directory, and a directory move should
   * not be a side effect of fixing a typo in a title.
   *
   * Who the CEO and the chair ARE is not editable here. Their ids are on every
   * approval, note and commit already made, and changing one mid-life orphans
   * all of it — scripts/rename-agent.ts exists to do that job properly.
   */
  async update(
    slug: string,
    patch: { name?: string; business?: string; slug?: string; policy?: Partial<CompanyPolicy> },
  ): Promise<{ ok: true; slug: string } | { ok: false; reason: string }> {
    if (!this.has(slug)) return { ok: false, reason: `no company '${slug}'` };

    const wanted = patch.slug?.trim() ? slugId(patch.slug) : slug;
    if (wanted !== slug && this.has(wanted)) return { ok: false, reason: `${wanted} already exists` };

    // The scheduler reads its dials once, at construction, so a policy change
    // only means anything after the company is let go and built again. That
    // must not quietly pause a company that was working.
    const wasRunning = listCompanies().find((c) => c.slug === slug)?.wanted ?? false;
    await this.close(slug);

    const from = companyHome(slug);
    const to = companyHome(wanted);
    if (wanted !== slug) renameSync(from, to);

    const path = join(to, 'config.json');
    const cfg = JSON.parse(readFileSync(path, 'utf8')) as RiffConfig;
    const next: RiffConfig = {
      ...cfg,
      home: to,
      worldDir: join(to, 'world'),
      ledgerPath: join(to, 'ledger.db'),
      company: {
        name: patch.name?.trim() || cfg.company.name,
        business: patch.business?.trim() ?? cfg.company.business,
      },
      policy: readPolicy({ ...readPolicy(cfg.policy), ...(patch.policy ?? {}) }),
    };
    // Where it lives is the directory's job to say, not the file's.
    writeFileSync(path, JSON.stringify(persisted(next), null, 2) + '\n', 'utf8');
    if (wasRunning) await this.setRunning(wanted, true);
    return { ok: true, slug: wanted };
  }

  /**
   * Remove a company from the list without destroying it. The directory moves
   * to ~/.riff/archive/<slug>-<stamp>/, git history and all.
   */
  async archive(slug: string): Promise<{ ok: true; at: string } | { ok: false; reason: string }> {
    if (!this.has(slug)) return { ok: false, reason: `no company '${slug}'` };
    await this.close(slug);
    const dir = archiveDir();
    mkdirSync(dir, { recursive: true });
    const stamp = this.#clock.iso().replace(/[:.]/g, '-');
    const at = join(dir, `${slug}-${stamp}`);
    renameSync(companyHome(slug), at);
    return { ok: true, at };
  }

  /** Every company currently held open, for shutdown. */
  opened(): Company[] { return [...this.#open.values()]; }
}
