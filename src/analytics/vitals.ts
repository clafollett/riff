/**
 * Vitals — what the company actually did, as numbers.
 *
 * Every figure here is a projection over the event log, the ledger's own
 * tables and the world's git history. Nothing is recorded for it and no table
 * backs it: a metric breaks neither a rule nor a render, so by the house split
 * it is not a row. The window is therefore free — ask ninety days of a company
 * two weeks old and the answer is simply smaller.
 *
 * The README makes empirical claims: that agents accrete structure and never
 * remove any, that the envelope is the one door outward, that Rule 6 is the
 * load-bearing one. This module is where those claims become checkable, which
 * is the same standard the commit log is held to.
 */
import type { Ledger } from '../ledger/ledger.ts';
import type { World } from '../worldfs/world.ts';
import type { Clock } from '../core/clock.ts';
import type { AgentId, Event } from '../core/types.ts';

export type Window = {
  /** What was asked for, verbatim — echoed back so a report can name itself. */
  spec: string;
  /** The cut, as ISO. Both SQL and `git --since` are given this exact string,
   *  so the two halves of a report can never disagree about where it starts. */
  since: string;
  /** Exclusive. Now, for the window being reported; the start of that window
   *  for the one before it. */
  until: string;
  days: number;
};

export type ShiftVitals = {
  woke: number;
  slept: number;
  failed: number;
  /** Shifts stopped for making tool calls the gate never heard about. */
  blind: number;
  /** Shifts cut at the turn ceiling with work still in hand. */
  truncated: number;
  rotated: number;
  rotateFailed: number;
  compacted: number;
  turns: number;
  costUsd: number;
  costPerShift: number;
  turnsPerShift: number;
  /** Failed and blind over woke. The number that says whether the loop works
   *  at all, before any question of whether the work is good. */
  troubleRate: number;
  /** Shifts that woke, spent money and left nothing behind — no document, no
   *  mail, no task, no note. The most expensive thing a company can do is pay
   *  attention to itself, and until now it did not appear in any figure. */
  barren: number;
  /** The largest share of the window's inference bill one person accounts
   *  for. A total hides an agent quietly burning two thirds of it. */
  costShareTop: number;
};

export type ThrottleVitals = { rateLimited: number; throttled: number; usagePaused: number };

export type CommonsVitals = {
  held: number;
  ceiling: number;
  /** Every posting, revisions included. */
  posted: number;
  /** Documents the shelf had never held before. A company that rewrites the
   *  same four pages all week is not accreting, and counting every posting as
   *  growth said it was — on a shelf whose contents had not changed. */
  added: number;
  /** Postings over a document that already existed. Revision is the shape of
   *  a company thinking, and is not the thing Rule 6 bounds. */
  revised: number;
  removed: number;
  /** Additions minus removals. The accretion number Rule 6 exists to bound,
   *  and the one that has to agree with what the shelf actually holds. */
  net: number;
  /** Times the ceiling actually refused a posting. Zero with a full shelf
   *  means the pressure has never been tested, not that it works. */
  refused: number;
};

export type EnvelopeVitals = {
  filed: number;
  approved: number;
  rejected: number;
  withdrawn: number;
  released: number;
  pending: number;
  /** How long the oldest undecided draft has waited. The board is a
   *  bottleneck the company cannot route around, so this is its latency. */
  oldestPendingHours: number | null;
  medianDecisionHours: number | null;
};

export type WorkVitals = {
  opened: number;
  claimed: number;
  done: number;
  dropped: number;
  blocked: number;
  openNow: number;
  /** Finished over finished-plus-abandoned. */
  completionRate: number;
};

export type OrgVitals = {
  /** Everyone but the board. */
  headcount: number;
  hired: number;
  retired: number;
  /** Hires minus retirements. Rule 6 bounds documents and nothing bounds
   *  this, so it is the accretion claim applied to the org chart. */
  net: number;
  /** A reporting line pointing at nobody — the shape a bad rename leaves. */
  orphans: number;
  /** Deepest chain of command, and the widest span in it. The board is not
   *  in either: it governs, it does not manage, so counting the chair as a
   *  layer would report every company as one deeper than it is. */
  depth: number;
  widest: number;
  shiftsPerHead: number;
};

export type TalkVitals = {
  messages: number;
  /** Recipients, not messages. One broadcast to twenty-two people is one row
   *  here and twenty-two inbox reads on everybody's next shift. */
  deliveries: number;
  broadcastFanout: number;
  notes: number;
  memoryConsolidated: number;
  /** Every commit in the world, whoever made it. */
  commits: number;
  /** The ones a member of staff actually made. The world is committed by the
   *  harness too — a repair, an ignore file, the initial layout — and counting
   *  those as company output flatters every ratio below. */
  byStaff: number;
  /** Commits by nobody on the roster: the harness, the company itself, or a
   *  person who worked here under an id that no longer exists. Reported rather
   *  than dropped, because a number that quietly goes missing is worse than a
   *  number that is explained. */
  unattributed: number;
  /** Messages per commit of real work. Agents that talk to each other forever
   *  and land nothing is the failure mode this catches in one figure. */
  perCommit: number;
  /** Dollars of inference per commit of real work. */
  costPerCommit: number;
};

export type MoneyVitals = { spends: number; cents: number; exceptions: number };

export type RuleBite = { kind: string; rule: string; capability: string; n: number };

export type PersonVitals = {
  id: AgentId;
  name: string;
  tier: string;
  role: string;
  shifts: number;
  turns: number;
  costUsd: number;
  commits: number;
  messages: number;
  posted: number;
  filed: number;
  done: number;
  /** Gate refusals against them. A member fighting the gate every shift has
   *  either a bad mandate or a bad idea, and both are worth seeing. */
  denied: number;
};

/**
 * The figures worth reading as a direction rather than a level, over the
 * window immediately before this one. A count with nothing to compare it
 * against is a number, not a signal.
 */
export type Trend = {
  shifts: number; costUsd: number; commits: number; messages: number;
  posted: number; removed: number; filed: number; released: number;
  done: number; dropped: number; blind: number; failed: number;
  hired: number; retired: number; barren: number;
};

export type Vitals = {
  window: Window;
  previous: Trend | null;
  shifts: ShiftVitals;
  org: OrgVitals;
  throttle: ThrottleVitals;
  commons: CommonsVitals;
  envelope: EnvelopeVitals;
  work: WorkVitals;
  talk: TalkVitals;
  money: MoneyVitals;
  gate: { allow: number; deny: number; escalate: number; rules: RuleBite[] };
  people: PersonVitals[];
};

const MS: Record<string, number> = {
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
};

/**
 * Accepts what `git log --since` accepts of the forms anyone actually types:
 * `3.days`, `12 hours`, `2.weeks`. Anything else falls back to a week rather
 * than throwing, because a mistyped window on a status command should still
 * print a report.
 */
export const parseWindow = (spec: string, endAt: number): Window => {
  const m = /^(\d+)[.\s_-]*(hour|day|week|month)s?$/i.exec(spec.trim());
  const unit = m?.[2]?.toLowerCase() ?? 'day';
  const n = m ? Number(m[1]) : 7;
  const ms = (MS[unit] ?? MS['day']!) * (n > 0 ? n : 7);
  return {
    spec: m ? spec.trim() : '7.days',
    since: new Date(endAt - ms).toISOString(),
    until: new Date(endAt).toISOString(),
    days: ms / MS['day']!,
  };
};

/**
 * What counts as having done something. A shift that woke, spent money and
 * emitted none of these read the company and went back to sleep — which is
 * the expensive failure the totals were hiding.
 */
const PRODUCTIVE = [
  'commons.posted', 'commons.removed', 'message.sent', 'note.written',
  'task.opened', 'task.claimed', 'task.done', 'task.dropped',
  'memory.consolidated', 'gate.escalate', 'external.released', 'role.filled',
] as const;

/** Ratios over an empty window are 0, not NaN — a report is not a place to
 *  print "NaN" at a person who simply has not run the company yet. */
const over = (part: number, whole: number): number => (whole > 0 ? part / whole : 0);

const median = (xs: number[]): number | null => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
};

const hoursBetween = (a: string, b: string): number =>
  (Date.parse(b) - Date.parse(a)) / 3_600_000;

const data = (e: Event): Record<string, unknown> => {
  if (!e.dataJson) return {};
  try {
    const v: unknown = JSON.parse(e.dataJson);
    return v && typeof v === 'object' ? v as Record<string, unknown> : {};
  } catch {
    return {};
  }
};

const numberOf = (o: Record<string, unknown>, k: string): number => {
  const v = o[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
};

/** The scalars worth reading as a direction, lifted out of a full report. */
const trendOf = (v: Vitals): Trend => ({
  shifts: v.shifts.slept,
  costUsd: v.shifts.costUsd,
  commits: v.talk.byStaff,
  messages: v.talk.messages,
  posted: v.commons.added,
  removed: v.commons.removed,
  filed: v.envelope.filed,
  released: v.envelope.released,
  done: v.work.done,
  dropped: v.work.dropped,
  blind: v.shifts.blind,
  failed: v.shifts.failed,
  hired: v.org.hired,
  retired: v.org.retired,
  barren: v.shifts.barren,
});

export type VitalsDeps = {
  ledger: Ledger;
  world: World;
  clock: Clock;
  commonsCeiling: number;
};

export const vitals = (
  d: VitalsDeps,
  spec = '7.days',
  /** Where the window ends. The report walks itself back by one window to
   *  fill in `previous`; nothing else should pass this. */
  endAt = d.clock.now().getTime(),
  /** False on the inner call that builds `previous`, so it does not recurse. */
  compare = true,
): Vitals => {
  const window = parseWindow(spec, endAt);
  const { since, until } = window;

  // One pass over the histogram, indexed two ways: totals for the company,
  // and per-actor for the table at the bottom of the report.
  const counts = d.ledger.eventCounts(since, until);
  const total = new Map<string, number>();
  const mine = new Map<AgentId, Map<string, number>>();
  for (const c of counts) {
    total.set(c.kind, (total.get(c.kind) ?? 0) + c.n);
    let m = mine.get(c.actor);
    if (!m) mine.set(c.actor, (m = new Map()));
    m.set(c.kind, (m.get(c.kind) ?? 0) + c.n);
  }
  const n = (kind: string): number => total.get(kind) ?? 0;
  const nOf = (who: AgentId, kind: string): number => mine.get(who)?.get(kind) ?? 0;

  // One ordered pass over the kinds whose payload has to be read rather than
  // counted, plus the two that bracket a shift. `agent.slept` is the only
  // place a shift's turns and dollars are written down, and walking woke →
  // slept in sequence is the only way to tell a shift that did something from
  // one that woke, read the company, and went back to sleep.
  const shiftLog = d.ledger.eventsOfKinds(
    ['agent.woke', 'agent.slept', ...PRODUCTIVE], since, until);

  const turnsBy = new Map<AgentId, number>();
  const costBy = new Map<AgentId, number>();
  const busy = new Set<AgentId>();      // has produced since waking
  const open = new Set<AgentId>();      // woke inside this window
  let slept = 0;
  let turns = 0;
  let costUsd = 0;
  let truncated = 0;
  let barren = 0;
  let deliveries = 0;
  const posted: string[] = [];

  for (const e of shiftLog) {
    if (e.kind === 'agent.woke') { open.add(e.actor); busy.delete(e.actor); continue; }

    if (e.kind === 'agent.slept') {
      const dj = data(e);
      const t = numberOf(dj, 'turns');
      const c = numberOf(dj, 'costUsd');
      slept++;
      turns += t;
      costUsd += c;
      if (dj['truncated'] === true) truncated++;
      turnsBy.set(e.actor, (turnsBy.get(e.actor) ?? 0) + t);
      costBy.set(e.actor, (costBy.get(e.actor) ?? 0) + c);
      // A shift whose waking fell before the window is not evidence of
      // anything — only a shift seen end to end can be called barren.
      if (open.has(e.actor) && !busy.has(e.actor)) barren++;
      open.delete(e.actor);
      busy.delete(e.actor);
      continue;
    }

    // One broadcast is one row here and a message in twenty-two inboxes.
    if (e.kind === 'message.sent') deliveries += Math.max(1, numberOf(data(e), 'recipients'));
    if (e.kind === 'commons.posted' && e.subject) posted.push(e.subject);
    busy.add(e.actor);
  }

  const woke = n('agent.woke');
  const failed = n('agent.failed');
  const blind = n('shift.blind');
  const costliest = Math.max(0, ...costBy.values());
  const shifts: ShiftVitals = {
    woke,
    slept,
    failed,
    blind,
    truncated,
    rotated: n('session.rotated'),
    rotateFailed: n('session.rotate_failed'),
    compacted: n('session.compacted'),
    turns,
    costUsd,
    costPerShift: over(costUsd, slept),
    turnsPerShift: over(turns, slept),
    troubleRate: over(failed + blind, woke),
    barren,
    costShareTop: over(costliest, costUsd),
  };

  const gateRows = d.ledger.gateDecisions(since, until);
  const gateKind = (k: string): number =>
    gateRows.filter((r) => r.kind === k).reduce((s, r) => s + r.n, 0);

  // When each document FIRST appeared, over all of history — a posting inside
  // the window onto a page that predates it is a rewrite, not growth.
  const firstSeen = d.ledger.commonsHistory();
  const added = new Set(
    posted.filter((path) => (firstSeen.get(path)?.created ?? '') >= since)).size;

  const removed = n('commons.removed');
  const commons: CommonsVitals = {
    held: d.world.commonsCount(),
    ceiling: d.commonsCeiling,
    posted: posted.length,
    added,
    revised: posted.length - added,
    removed,
    net: added - removed,
    refused: gateRows
      .filter((r) => r.rule === 'R6.commons_full')
      .reduce((s, r) => s + r.n, 0),
  };

  const approvals = d.ledger.approvalsBetween(since, until);
  const filed = approvals.filter((a) => a.requestedAt >= since && a.requestedAt < until);
  const decided = approvals.filter((a) => a.decidedAt != null && a.decidedAt >= since && a.decidedAt < until);
  const pending = approvals.filter((a) => a.state === 'pending');
  const envelope: EnvelopeVitals = {
    filed: filed.length,
    approved: decided.filter((a) => a.state === 'approved').length,
    rejected: decided.filter((a) => a.state === 'rejected').length,
    withdrawn: n('approval.withdrawn'),
    released: n('external.released'),
    pending: pending.length,
    oldestPendingHours: pending.length
      ? Math.max(...pending.map((a) => hoursBetween(a.requestedAt, until)))
      : null,
    medianDecisionHours: median(
      decided.map((a) => hoursBetween(a.requestedAt, a.decidedAt!)),
    ),
  };

  const tasks = d.ledger.listTasks();
  const done = n('task.done');
  const dropped = n('task.dropped');
  const work: WorkVitals = {
    opened: n('task.opened'),
    claimed: n('task.claimed'),
    done,
    dropped,
    blocked: n('task.blocked'),
    openNow: tasks.filter((t) => t.status !== 'done' && t.status !== 'dropped').length,
    completionRate: over(done, done + dropped),
  };

  // Git records the agent id in the author email and the display name beside
  // it. Key on the id: the display name is what a rename changes, and the
  // email domain has already changed once under a company that kept working
  // across the change, so the local part is the only stable half.
  const roster = d.ledger.listAgents(true);
  const ids = new Set(roster.map((a) => a.id));
  const names = new Map(roster.map((a) => [a.name, a.id]));

  const commits = d.world.git.since(since, until);
  const commitsBy = new Map<AgentId, number>();
  let unattributed = 0;
  for (const c of commits) {
    const local = c.email.split('@')[0] ?? '';
    const who = ids.has(local) ? local : names.get(c.author);
    if (who == null) { unattributed++; continue; }
    commitsBy.set(who, (commitsBy.get(who) ?? 0) + 1);
  }
  const byStaff = commits.length - unattributed;

  const messages = n('message.sent');
  const talk: TalkVitals = {
    messages,
    deliveries,
    broadcastFanout: over(deliveries, messages),
    notes: n('note.written'),
    memoryConsolidated: n('memory.consolidated'),
    commits: commits.length,
    byStaff,
    unattributed,
    perCommit: over(messages, byStaff),
    costPerCommit: over(costUsd, byStaff),
  };

  const spends = d.ledger.spendBetween(since, until);
  const money: MoneyVitals = {
    spends: spends.reduce((s, r) => s + r.n, 0),
    cents: spends.reduce((s, r) => s + r.cents, 0),
    exceptions: n('spend.exception'),
  };

  const people: PersonVitals[] = roster
    .map((a) => ({
      id: a.id,
      name: a.name,
      tier: a.tier,
      role: a.role,
      shifts: nOf(a.id, 'agent.slept'),
      turns: turnsBy.get(a.id) ?? 0,
      costUsd: costBy.get(a.id) ?? 0,
      commits: commitsBy.get(a.id) ?? 0,
      messages: nOf(a.id, 'message.sent'),
      posted: nOf(a.id, 'commons.posted'),
      filed: filed.filter((ap) => ap.requestedBy === a.id).length,
      done: nOf(a.id, 'task.done'),
      denied: nOf(a.id, 'gate.deny'),
    }))
    .filter((p) => p.shifts || p.commits || p.messages || p.posted || p.filed || p.done)
    .sort((x, y) => y.commits - x.commits || y.shifts - x.shifts);

  // Rule 6 bounds the shelf. Nothing bounds the payroll, and twenty-two
  // agents waking on a schedule is where the money actually goes — so the
  // accretion claim gets asked of the org chart too.
  const staff = d.ledger.listAgents().filter((a) => a.tier !== 'board');
  const byBoss = new Map<AgentId, number>();
  for (const a of staff) {
    if (a.reportsTo) byBoss.set(a.reportsTo, (byBoss.get(a.reportsTo) ?? 0) + 1);
  }
  const org: OrgVitals = {
    headcount: staff.length,
    hired: n('role.filled'),
    retired: n('role.retired'),
    net: n('role.filled') - n('role.retired'),
    orphans: staff.filter((a) => a.reportsTo && !d.ledger.getAgent(a.reportsTo)).length,
    depth: Math.max(0, ...staff.map(
      (a) => d.ledger.chainOfCommand(a.id).filter((x) => x.tier !== 'board').length)),
    widest: Math.max(0, ...byBoss.values()),
    shiftsPerHead: over(slept, staff.length),
  };

  // The window before this one, at the same length. Recursion stops after one
  // step because the inner call is given no window to compare against.
  const previous: Trend | null = compare
    ? trendOf(vitals(d, spec, Date.parse(since), false))
    : null;

  return {
    window,
    previous,
    shifts,
    org,
    throttle: {
      rateLimited: n('company.rate_limited'),
      throttled: n('company.throttled'),
      usagePaused: n('company.usage_paused'),
    },
    commons,
    envelope,
    work,
    talk,
    money,
    gate: {
      allow: gateKind('allow'),
      deny: gateKind('deny'),
      escalate: gateKind('escalate'),
      rules: gateRows.slice(0, 20),
    },
    people,
  };
};
