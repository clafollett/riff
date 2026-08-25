import type { AgentId, Capability } from '../core/types.ts';

/**
 * The company's constitution.
 *
 * Six rules. Four are enforced here and in the gate; two deliberately are not,
 * because they are dispositions rather than permissions and pretending
 * otherwise would be theatre.
 */
export type Constitution = {
  /** R4: the only seats that may touch money. Everyone else is refused. */
  treasurers: AgentId[];
  /** R4: per-treasurer, per-day ceiling, integer cents. */
  dailyCapCents: number;
  /** R4: past the ceiling — ask the board, or refuse outright. */
  overCap: 'escalate' | 'deny';

  /** R2: what a lead may not self-authorise. The executive tier signs. */
  executiveApproves: Capability[];
  /** R3: what nobody but the board may authorise. No override exists. */
  boardApproves: Capability[];

  /** The primary agent. Receives R2 escalations, runs the company. */
  ceo: AgentId;
  /** Humans. Terminal authority; they bypass the gate because they ARE it. */
  board: AgentId[];

  /**
   * R6 — the complexity budget.
   *
   * The commons may hold this many documents. Past it, adding one requires
   * removing one.
   *
   * This is the load-bearing rule and the reason it exists is empirical: a
   * previous system of ours became unmanageable because agents accrete
   * structure and never remove any. Each addition is individually defensible;
   * together they are sediment. A human team simplifies because complexity
   * hurts them daily — agents feel nothing, so the pressure has to be
   * structural. Variation without selection is not emergence, it is a pile.
   */
  commonsCeiling: number;
};

export const constitutionFor = (opts: {
  ceo: AgentId;
  board: AgentId[];
  treasurers?: AgentId[];
  dailyCapCents?: number;
  commonsCeiling?: number;
}): Constitution => ({
  ceo: opts.ceo,
  board: opts.board,
  treasurers: opts.treasurers ?? [opts.ceo],
  dailyCapCents: opts.dailyCapCents ?? 500,
  overCap: 'escalate',
  executiveApproves: ['hire', 'world.write_other'],
  // R3 has exactly one member and no configuration to loosen it. The moment
  // there is a bypass, something will eventually find a reason to use it.
  boardApproves: ['external.write'],
  commonsCeiling: opts.commonsCeiling ?? 40,
});

/** Rendered into every agent's prompt, so the rules are stated once. */
export const RULES_TEXT = (c: Constitution): string => [
  '1. Work well together.',
  '2. Work however you see fit inside your mandate — the CEO approves what needs approving.',
  '3. You may take work all the way to the outside world, but it always lands as a draft.',
  '   Nothing leaves this company without the board.',
  `4. Only ${c.treasurers.join(', ')} may spend, up to $${(c.dailyCapCents / 100).toFixed(2)} a day.`,
  '5. If the board is not around, do not stop.',
  `6. The commons holds ${c.commonsCeiling} documents. To add one past that, remove one.`,
  '   Decide what stops being true, not just what starts being true.',
  '',
  'Rules 2, 3, 4 and 6 are enforced by the company itself, not by your good intentions.',
  'Rules 1 and 5 are yours to keep. Nothing checks them but each other.',
].join('\n');
