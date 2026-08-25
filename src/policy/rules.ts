import type { AgentId, Capability } from '../core/types.ts';

/**
 * The House Rules, as configuration rather than prose.
 *
 * Rules 1 and 5 are deliberately absent from this file:
 *   R1 "work well together"  — a disposition. Lives in the persona prompt and
 *                              in the shared commons. Code cannot enforce it.
 *   R5 "if I'm away, don't stop" — a scheduling property, not a permission.
 *                              Lives in the scheduler.
 * Rules 2, 3 and 4 are permissions, so they live here and in the gate.
 */
export type HouseRules = {
  /** R4: the only staff allowed to touch money. Everyone else is denied outright. */
  treasurers: AgentId[];
  /** R4: per-treasurer, per-day ceiling in integer cents. */
  dailyCapCents: number;
  /**
   * R4: what happens past the ceiling.
   *  'escalate' — ask the Innkeeper for an exception (recommended)
   *  'deny'     — hard wall, no appeal
   */
  overCap: 'escalate' | 'deny';
  /** R2: capabilities a house manager may not self-authorise. The Steward signs. */
  stewardApproves: Capability[];
  /** R3: capabilities that can never be self-authorised by anyone but you. */
  innkeeperApproves: Capability[];
  /** Who plays Steward — runs the Inn on your behalf. Receives R2 escalations. */
  steward: AgentId;
  /** You. Receives R3 escalations, bypasses the gate entirely. */
  innkeeper: AgentId;
};

export const DEFAULT_HOUSE_RULES: HouseRules = {
  treasurers: ['hollis'],
  dailyCapCents: 500, // $5.00/day. Rule 4, to the cent.
  overCap: 'escalate',
  stewardApproves: ['hire', 'world.write_other'],
  // R3: "you can take work all the way out into the real world, but it always
  // lands as a draft." One capability, no exceptions, no config to loosen it.
  innkeeperApproves: ['external.write'],
  steward: 'hollis',
  innkeeper: 'cali',
};
