/**
 * The domain. Everything else in the Inn is downstream of these shapes.
 *
 * Two storage worlds, one rule:
 *   - If a staff member INVENTS it, it is a file under world/.   (emergence)
 *   - If breaking it breaks a House Rule or a render frame, it is a
 *     row in ledger.db.                                          (integrity)
 */

// ---------------------------------------------------------------- identities

export type AgentId = string; // slug: 'matt', 'greg'
export type BuildingId = string; // slug: 'the-study', 'the-vault'
export type TaskId = string;
export type ApprovalId = string;
export type EventId = string;

/** Staff hierarchy. The Innkeeper is you; you are in the world, not above it. */
export const ROLES = ['innkeeper', 'chief_of_staff', 'house_manager', 'house_assistant'] as const;
export type Role = (typeof ROLES)[number];

/** Lower rank number = more authority. Used by the gate to test standing. */
export const RANK: Record<Role, number> = {
  innkeeper: 0,
  chief_of_staff: 1,
  house_manager: 2,
  house_assistant: 3,
};

export type AgentStatus = 'active' | 'idle' | 'off_shift' | 'dismissed';

export type Agent = {
  id: AgentId;
  name: string;
  role: Role;
  title: string;
  /** Who they answer to. Only the Innkeeper reports to nobody. */
  reportsTo: AgentId | null;
  building: BuildingId;
  department: string;
  status: AgentStatus;
  hiredAt: string; // ISO
  hiredBy: AgentId | null;
  /** Model to run this staff member on. Workers are cheap, directors think. */
  model: string;
};

// ------------------------------------------------------------------- capabilities

/**
 * Every action a staff member can attempt is one of these. The gate switches
 * on this and nothing else — if it is not enumerated here, it cannot happen.
 */
export const CAPABILITIES = [
  'world.read', // read own files
  'world.read_other', // read a colleague's files — allowed, but LOUD
  'world.write', // write own files
  'world.write_other', // tamper with a colleague's files — escalates
  'note.write', // write a note about a colleague
  'task.create',
  'task.assign',
  'message', // speak to a colleague
  'hire', // grow the staff
  'spend', // costs real money
  'external.read', // read inbox / calendar / the outside world
  'external.write', // touch the outside world — ALWAYS lands as a draft
] as const;
export type Capability = (typeof CAPABILITIES)[number];

// ------------------------------------------------------------------- the gate

export type GateRequest = {
  actor: AgentId;
  capability: Capability;
  /** What is being acted upon: an agent id, a file path, an external target. */
  target?: string;
  /** Required for `spend`. Integer cents. Never floats — this is money. */
  amountCents?: number;
  /** One line, human-readable. Shows up in your inbox. Staff must write it. */
  summary: string;
  payload?: unknown;
};

export type Decision =
  | { kind: 'allow'; rule: string }
  | { kind: 'deny'; rule: string; reason: string }
  | { kind: 'escalate'; rule: string; tier: ApprovalTier; approvalId: ApprovalId; reason: string };

/** Who has to sign off. `human` means it waits in your envelope. */
export type ApprovalTier = 'chief_of_staff' | 'innkeeper';

export type ApprovalState = 'pending' | 'approved' | 'rejected' | 'expired';

export type Approval = {
  id: ApprovalId;
  requestedBy: AgentId;
  capability: Capability;
  tier: ApprovalTier;
  state: ApprovalState;
  summary: string;
  target: string | null;
  amountCents: number | null;
  payloadJson: string | null;
  requestedAt: string;
  decidedBy: AgentId | null;
  decidedAt: string | null;
  decisionReason: string | null;
};

// -------------------------------------------------------------------- work

export type TaskStatus = 'open' | 'claimed' | 'in_progress' | 'blocked' | 'done' | 'dropped';

export type Task = {
  id: TaskId;
  title: string;
  body: string;
  status: TaskStatus;
  createdBy: AgentId;
  assignedTo: AgentId | null;
  /** Delegation tree. A director's task spawns worker subtasks. */
  parentId: TaskId | null;
  priority: number; // 0 highest
  createdAt: string;
  updatedAt: string;
};

// ------------------------------------------------------------------ the map

export type Facing = 'up' | 'down' | 'left' | 'right';

/** Live pose. Written every tick, read every frame — hence a row, not a file. */
export type Position = {
  agentId: AgentId;
  x: number;
  y: number;
  facing: Facing;
  /** Free text: 'walking to the-vault', 'thinking', 'talking to greg'. */
  activity: string;
  updatedAt: string;
};

export type Building = {
  id: BuildingId;
  name: string;
  department: string;
  x: number;
  y: number;
  w: number;
  h: number;
  doorX: number;
  doorY: number;
};

// ---------------------------------------------------------------- event log

/**
 * Append-only. The single source of truth for "what happened while I was gone".
 * The village map is a projection of this; so is morale; so is the audit trail.
 */
export type Event = {
  id: EventId;
  seq: number;
  at: string;
  actor: AgentId;
  kind: string; // 'task.done', 'gate.deny', 'note.written', 'agent.hired'
  subject: string | null;
  dataJson: string | null;
};

// ------------------------------------------------------------------- money

export type SpendRecord = {
  id: string;
  agentId: AgentId;
  amountCents: number;
  purpose: string;
  approvalId: ApprovalId | null;
  at: string;
};
