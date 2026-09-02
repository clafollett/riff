/**
 * The shape of a Vitals report — and nothing else.
 *
 * Split out so the console can import the very types the server answers with.
 * `vitals.ts` reaches for the Ledger, the World and the node builtins under
 * them; a browser bundle typechecked against that drags in a runtime it will
 * never have. This module imports nothing but an id alias, so both sides can
 * name the same fields.
 *
 * The console used to restate all ninety of these by hand. Renaming a field
 * on one side then typechecked on both and rendered `undefined`, with no
 * error anywhere — which is not a thing a reader of a report can be expected
 * to notice.
 */
import type { AgentId } from '../core/types.ts';

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

/** A rule that refused something. Allows are counted in the totals but never
 *  listed: there are thousands of them and none is news. */
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
