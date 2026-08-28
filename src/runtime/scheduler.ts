import type { Agent, AgentId } from '../core/types.ts';
import type { Ledger } from '../ledger/ledger.ts';
import type { Gate } from '../policy/gate.ts';
import type { World } from '../worldfs/world.ts';
import type { Clock } from '../core/clock.ts';
import { tick, type TickResult } from './staff.ts';
import type { SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';
import { applyApproved } from './executor.ts';
import { RANK } from '../core/types.ts';

export type SchedulerOptions = {
  /** How often a staff member wakes, in ms. Scaled by rank — the CEO
   *  keeps a closer eye on things than a member. */
  baseIntervalMs: number;
  /** How many staff may be awake at once. Protects rate limits and your wallet,
   *  and keeps the feed legible. */
  concurrency: number;
  /**
   * Hard stop for the whole company, in USD per local day — inference cost,
   * NOT the staff's Rule 4 spending money. Null on a Claude subscription,
   * where inference is covered and the real constraint is the rate limiter
   * below. Keep a number here only when running on metered API billing.
   */
  dailyBudgetUsd: number | null;
  /** Ceiling on a single wake-up. Null on a subscription, same reasoning. */
  perTickBudgetUsd: number | null;
  /**
   * Start stretching intervals once subscription utilization passes this.
   * Coasting to the limit and getting rejected wastes a whole window; slowing
   * down early keeps the company alive across it.
   */
  throttleAboveUtilization: number;
  /**
   * Stop outright once the window is this far spent, so the operator keeps
   * headroom for their own work. Throttling only slows the company down; on a
   * subscription a company that never stops will take the whole window, and
   * the person who pays for it finds it gone. 1 disables the stop.
   */
  pauseAboveUtilization: number;
  maxTurns: number;
  /**
   * Replace an agent's conversation mid-shift once it is this much of the
   * model's context window full (0-100). 0 leaves it to the runtime's own
   * compaction. See CompanyPolicy.rotateAtContextPct.
   */
  rotateAtContextPct: number;
  /**
   * Hard ceilings for an unattended run. Neither is a cost estimate — they are
   * stops. Leaving something unbounded running on somebody's machine overnight
   * is not a thing to do, and a subscription that gets exhausted at 3am means
   * they cannot work in the morning.
   */
  maxTicks: number | null;
  /** Epoch ms. The scheduler stops itself here regardless of anything else. */
  until: number | null;
};

/** Defaults assume a Claude subscription: no dollar caps, paced by rate limit. */
export const DEFAULT_SCHEDULE: SchedulerOptions = {
  baseIntervalMs: 5 * 60_000,
  concurrency: 3,
  dailyBudgetUsd: null,
  perTickBudgetUsd: null,
  maxTicks: null,
  until: null,
  throttleAboveUtilization: 0.7,
  pauseAboveUtilization: 0.92,
  // Read a file, edit it, run the tests, read the failure, fix it: five turns
  // before anything works. At 24 every shift of a coding company was cut.
  maxTurns: 60,
  rotateAtContextPct: 50,
};

type Deps = {
  ledger: Ledger; gate: Gate; world: World; clock: Clock;
  connectors?: Record<string, { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }>;
  options?: Partial<SchedulerOptions>;
  onTick?: (r: TickResult) => void;
};

/**
 * Who works next, when more people are due than there are slots.
 *
 * Longest-waiting first, NOT highest rank. Rank already buys its advantage in
 * #intervalFor, where a senior comes due about twice as often as a member.
 * Sorting by rank here spent it a second time: with ten staff and three slots
 * the same seniors won every contest, and a member could sit due, be passed
 * over, and still be due on the next pass, indefinitely. Invisible at two
 * staff, and a mystery about idle juniors at ten.
 *
 * Rank breaks ties so the order stays deterministic when two people have
 * waited exactly as long — which, on a company where nobody has run yet, is
 * everybody.
 */
export const selectDue = (
  staff: Agent[],
  opts: { now: number; nextDue: Map<AgentId, number>; inFlight: Set<AgentId>; slots: number },
): Agent[] => {
  const overdue = (a: Agent): number => opts.now - (opts.nextDue.get(a.id) ?? 0);
  return staff
    .filter((a) => a.tier !== 'board' && a.status === 'active')
    .filter((a) => !opts.inFlight.has(a.id))
    .filter((a) => overdue(a) >= 0)
    .sort((a, b) => overdue(b) - overdue(a) || RANK[a.tier] - RANK[b.tier])
    .slice(0, Math.max(0, opts.slots));
};

/**
 * House Rule 5, as a property of the system rather than a request in a prompt:
 * the company keeps working whether or not anyone is watching.
 *
 * Staff are woken on a stagger rather than all at once — partly for rate
 * limits and cost, partly because twenty-two agents waking simultaneously
 * makes the company look like a seizure instead of a place where people work.
 */
export class Scheduler {
  #d: Deps;
  #opts: SchedulerOptions;
  #running = false;
  #abort = new AbortController();
  #nextDue = new Map<AgentId, number>();
  /** In-flight shifts, so stop() can wait for them rather than abandoning them. */
  #flights = new Set<Promise<void>>();
  #inFlight = new Set<AgentId>();
  #spentToday = 0;
  #spendDay: string;
  #ticks = 0;
  /** >1 stretches every interval. Raised as the subscription window fills. */
  #throttle = 1;
  /** Epoch ms. The company rests until the rate-limit window resets. */
  #pausedUntil = 0;
  #lastRateLimit: SDKRateLimitInfo | null = null;

  constructor(d: Deps) {
    this.#d = d;
    this.#opts = { ...DEFAULT_SCHEDULE, ...d.options };
    this.#spendDay = d.clock.day();
  }

  get running(): boolean { return this.#running; }
  get spentTodayUsd(): number { return this.#spentToday; }
  get ticks(): number { return this.#ticks; }
  get rateLimit(): SDKRateLimitInfo | null { return this.#lastRateLimit; }
  get pausedUntil(): number { return this.#pausedUntil; }

  /** Who is mid-shift this second. The console shows it live. */
  get awake(): AgentId[] { return [...this.#inFlight]; }

  /** When each active agent is next due, so the console can say "in 4 min". */
  dueAt(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [id, at] of this.#nextDue) out[id] = at;
    return out;
  }

  /**
   * Pace the company off the subscription's own rate-limit signal.
   *
   * 'rejected' means the window is spent — resting until it resets beats
   * hammering a wall and burning the next window on retries. 'allowed_warning'
   * and high utilization stretch the intervals instead, so the company slows
   * down rather than stopping dead.
   */
  #applyRateLimit(info: SDKRateLimitInfo): void {
    this.#lastRateLimit = info;

    if (info.status === 'rejected') {
      this.#pausedUntil = normaliseResetsAt(info.resetsAt) ?? Date.now() + 15 * 60_000;
      this.#d.ledger.emit('company', 'company.rate_limited', null, {
        rateLimitType: info.rateLimitType, resumesAt: new Date(this.#pausedUntil).toISOString(),
      });
      return;
    }

    const u = info.utilization ?? 0;

    // The operator's headroom. Slowing down still spends the window, just
    // later; only stopping leaves any of it for the person who pays for it.
    if (this.#opts.pauseAboveUtilization < 1 && u >= this.#opts.pauseAboveUtilization) {
      this.#pausedUntil = normaliseResetsAt(info.resetsAt) ?? Date.now() + 15 * 60_000;
      this.#d.ledger.emit('company', 'company.usage_paused', null, {
        utilization: u, ceiling: this.#opts.pauseAboveUtilization,
        rateLimitType: info.rateLimitType,
        resumesAt: new Date(this.#pausedUntil).toISOString(),
      });
      return;
    }

    const prev = this.#throttle;
    this.#throttle = info.status === 'allowed_warning' ? 3
      : u > this.#opts.throttleAboveUtilization ? 1 + (u - this.#opts.throttleAboveUtilization) * 6
      : 1;
    if (Math.abs(this.#throttle - prev) > 0.25) {
      this.#d.ledger.emit('company', 'company.throttled', null, {
        utilization: u, factor: Number(this.#throttle.toFixed(2)), rateLimitType: info.rateLimitType,
      });
    }
  }

  /** Rank sets cadence: the CEO wakes ~2x as often as a member. */
  #intervalFor(a: Agent): number {
    const rank = RANK[a.tier];
    const factor = 1 + rank * 0.35;
    // Jitter so ticks never phase-lock into a thundering herd.
    const jitter = 0.85 + ((hash(a.id) % 30) / 100);
    return this.#opts.baseIntervalMs * factor * jitter * this.#throttle;
  }

  #rolloverIfNewDay(): void {
    const today = this.#d.clock.day();
    if (today !== this.#spendDay) {
      this.#spendDay = today;
      this.#spentToday = 0;
      this.#d.ledger.emit('company', 'budget.rollover', null, { day: today });
    }
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#abort = new AbortController();
    this.#d.ledger.emit('company', 'work.started', null, { options: this.#opts });
    void this.#loop();
  }

  /**
   * Stop, and WAIT for anyone mid-shift to finish.
   *
   * Aborting the loop does not abort a shift already in the SDK. Returning
   * before those settle means the caller closes the ledger underneath them,
   * and the shift crashes the process on its closing `agent.slept` — which is
   * exactly what a server shutdown used to do to whoever was working.
   */
  async stop(): Promise<void> {
    // Stopping what was never started is not an event. `start` has always
    // guarded against announcing itself twice; `stop` did not, so every open
    // and close of a paused company appended a `work.paused` describing
    // nothing that happened. Restart the server ten times and the log grew
    // ten entries. The wait below still runs unconditionally — a second
    // caller must not return while a shift is in flight.
    const wasRunning = this.#running;
    this.#running = false;
    this.#abort.abort();
    if (this.#flights.size) await Promise.allSettled([...this.#flights]);
    if (wasRunning) {
      this.#d.ledger.emit('company', 'work.paused', null, { spentTodayUsd: this.#spentToday });
    }
  }

  #track(p: Promise<void>): void {
    this.#flights.add(p);
    void p.catch(() => { /* #wake reports its own failures */ })
      .finally(() => this.#flights.delete(p));
  }

  async #loop(): Promise<void> {
    while (this.#running) {
      this.#rolloverIfNewDay();

      // Hard stops first, before anything else is considered.
      if (this.#opts.maxTicks != null && this.#ticks >= this.#opts.maxTicks) {
        this.#d.ledger.emit('company', 'scheduler.stopped', null,
          { why: 'tick ceiling reached', ticks: this.#ticks });
        await this.stop();
        break;
      }
      if (this.#opts.until != null && Date.now() >= this.#opts.until) {
        this.#d.ledger.emit('company', 'scheduler.stopped', null,
          { why: 'deadline reached', ticks: this.#ticks });
        await this.stop();
        break;
      }

      // Rate-limited: rest rather than hammering a spent window.
      if (Date.now() < this.#pausedUntil) {
        await sleep(30_000, this.#abort.signal);
        continue;
      }
      // Metered-billing stop. Null on a subscription, where this never trips.
      if (this.#opts.dailyBudgetUsd != null && this.#spentToday >= this.#opts.dailyBudgetUsd) {
        await sleep(30_000, this.#abort.signal);
        continue;
      }

      const now = Date.now();
const due = selectDue(this.#d.ledger.listAgents(), {
        now, nextDue: this.#nextDue, inFlight: this.#inFlight,
        slots: this.#opts.concurrency - this.#inFlight.size,
      });

      for (const a of due) this.#track(this.#wake(a));

      // Approved work is applied by the company, never by the requester — so a
      // staff member cannot enact its own escalation.
      applyApproved(this.#d.ledger, this.#d.world, this.#d.clock, Object.keys(this.#d.connectors ?? {}));

      await sleep(2_000, this.#abort.signal);
    }
  }

  async #wake(a: Agent): Promise<void> {
    this.#inFlight.add(a.id);
    this.#ticks++;
    try {
      const r = await tick({
        agent: a, ledger: this.#d.ledger, gate: this.#d.gate,
        world: this.#d.world, clock: this.#d.clock,
        ...(this.#opts.perTickBudgetUsd != null ? { maxBudgetUsd: this.#opts.perTickBudgetUsd } : {}),
        maxTurns: this.#opts.maxTurns,
        rotateAtContextPct: this.#opts.rotateAtContextPct,
        ...(this.#d.connectors ? { connectors: this.#d.connectors } : {}),
        signal: this.#abort.signal,
      });
      this.#spentToday += r.costUsd;
      if (r.rateLimit) this.#applyRateLimit(r.rateLimit);
      this.#d.onTick?.(r);
    } finally {
      this.#inFlight.delete(a.id);
      this.#nextDue.set(a.id, Date.now() + this.#intervalFor(a));
    }
  }

  /** Wake someone immediately — used by "call a meeting" and by direct address. */
  nudge(id: AgentId): void { this.#nextDue.set(id, 0); }
}

/** resetsAt has arrived as both epoch-seconds and epoch-ms; normalise. */
const normaliseResetsAt = (v: number | undefined): number | null => {
  if (v == null || !Number.isFinite(v)) return null;
  return v < 1e12 ? v * 1000 : v;
};

const hash = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((res) => {
    if (signal.aborted) return res();
    const t = setTimeout(res, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true });
  });
