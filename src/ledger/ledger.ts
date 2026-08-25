import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { newId } from '../core/ids.ts';
import { systemClock, type Clock } from '../core/clock.ts';
import type {
  Agent, AgentId, Approval, ApprovalId, ApprovalTier, Building, Capability,
  Event, Position, SpendRecord, Task, TaskId, TaskStatus,
} from '../core/types.ts';

const SCHEMA = join(dirname(fileURLToPath(import.meta.url)), 'schema.sql');

type Row = Record<string, unknown>;
const str = (v: unknown): string => String(v);
const nstr = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number => Number(v);
const nnum = (v: unknown): number | null => (v == null ? null : Number(v));

/** Outcome of an attempted spend. `capped` is a refusal, not an error. */
export type SpendOutcome =
  | { ok: true; record: SpendRecord; spentTodayCents: number; remainingCents: number }
  | { ok: false; reason: 'capped'; spentTodayCents: number; capCents: number; requestedCents: number };

export class Ledger {
  #db: DatabaseSync;
  #clock: Clock;

  constructor(path: string, clock: Clock = systemClock) {
    this.#db = new DatabaseSync(path);
    this.#clock = clock;
    this.#db.exec(readFileSync(SCHEMA, 'utf8'));
  }

  get db(): DatabaseSync { return this.#db; }
  close(): void { this.#db.close(); }

  // ------------------------------------------------------------------ meta
  setMeta(key: string, value: string): void {
    this.#db.prepare('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
  }
  getMeta(key: string): string | null {
    const r = this.#db.prepare('SELECT value FROM meta WHERE key=?').get(key) as Row | undefined;
    return r ? str(r['value']) : null;
  }

  // ---------------------------------------------------------------- events
  /**
   * Append-only. `seq` is assigned inside the INSERT so two staff members
   * writing at the same instant cannot collide on it.
   */
  emit(actor: AgentId, kind: string, subject?: string | null, data?: unknown): Event {
    const id = newId('evt', this.#clock.now());
    const at = this.#clock.iso();
    const dataJson = data === undefined ? null : JSON.stringify(data);
    this.#db.prepare(
      `INSERT INTO events(id,seq,at,actor,kind,subject,data_json)
       SELECT ?, COALESCE(MAX(seq),0)+1, ?, ?, ?, ?, ? FROM events`
    ).run(id, at, actor, kind, subject ?? null, dataJson);
    const row = this.#db.prepare('SELECT * FROM events WHERE id=?').get(id) as Row;
    return this.#toEvent(row);
  }

  eventsSince(seq: number, limit = 500): Event[] {
    return (this.#db.prepare('SELECT * FROM events WHERE seq>? ORDER BY seq LIMIT ?').all(seq, limit) as Row[])
      .map((r) => this.#toEvent(r));
  }

  latestSeq(): number {
    const r = this.#db.prepare('SELECT COALESCE(MAX(seq),0) AS s FROM events').get() as Row;
    return num(r['s']);
  }

  #toEvent(r: Row): Event {
    return {
      id: str(r['id']), seq: num(r['seq']), at: str(r['at']), actor: str(r['actor']),
      kind: str(r['kind']), subject: nstr(r['subject']), dataJson: nstr(r['data_json']),
    };
  }

  // ---------------------------------------------------------------- agents
  upsertAgent(a: Agent): void {
    this.#db.prepare(
      `INSERT INTO agents(id,name,role,title,reports_to,building,department,status,hired_at,hired_by,model)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, role=excluded.role, title=excluded.title,
         reports_to=excluded.reports_to, building=excluded.building,
         department=excluded.department, status=excluded.status, model=excluded.model`
    ).run(a.id, a.name, a.role, a.title, a.reportsTo, a.building, a.department, a.status, a.hiredAt, a.hiredBy, a.model);
  }

  getAgent(id: AgentId): Agent | null {
    const r = this.#db.prepare('SELECT * FROM agents WHERE id=?').get(id) as Row | undefined;
    return r ? this.#toAgent(r) : null;
  }

  listAgents(includeDismissed = false): Agent[] {
    const sql = includeDismissed
      ? 'SELECT * FROM agents ORDER BY role, name'
      : "SELECT * FROM agents WHERE status!='dismissed' ORDER BY role, name";
    return (this.#db.prepare(sql).all() as Row[]).map((r) => this.#toAgent(r));
  }

  /** Walks `reports_to` upward. Cycle-safe: bails once it revisits an id. */
  chainOfCommand(id: AgentId): Agent[] {
    const chain: Agent[] = [];
    const seen = new Set<string>();
    let cur = this.getAgent(id);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.push(cur);
      cur = cur.reportsTo ? this.getAgent(cur.reportsTo) : null;
    }
    return chain;
  }

  #toAgent(r: Row): Agent {
    return {
      id: str(r['id']), name: str(r['name']), role: str(r['role']) as Agent['role'],
      title: str(r['title']), reportsTo: nstr(r['reports_to']), building: str(r['building']),
      department: str(r['department']), status: str(r['status']) as Agent['status'],
      hiredAt: str(r['hired_at']), hiredBy: nstr(r['hired_by']), model: str(r['model']),
    };
  }

  // ------------------------------------------------------------- buildings
  upsertBuilding(b: Building): void {
    this.#db.prepare(
      `INSERT INTO buildings(id,name,department,x,y,w,h,door_x,door_y) VALUES(?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, department=excluded.department,
         x=excluded.x,y=excluded.y,w=excluded.w,h=excluded.h,door_x=excluded.door_x,door_y=excluded.door_y`
    ).run(b.id, b.name, b.department, b.x, b.y, b.w, b.h, b.doorX, b.doorY);
  }

  listBuildings(): Building[] {
    return (this.#db.prepare('SELECT * FROM buildings ORDER BY id').all() as Row[]).map((r) => ({
      id: str(r['id']), name: str(r['name']), department: str(r['department']),
      x: num(r['x']), y: num(r['y']), w: num(r['w']), h: num(r['h']),
      doorX: num(r['door_x']), doorY: num(r['door_y']),
    }));
  }

  // ------------------------------------------------------------- positions
  setPosition(p: Omit<Position, 'updatedAt'>): void {
    this.#db.prepare(
      `INSERT INTO positions(agent_id,x,y,facing,activity,updated_at) VALUES(?,?,?,?,?,?)
       ON CONFLICT(agent_id) DO UPDATE SET x=excluded.x,y=excluded.y,
         facing=excluded.facing,activity=excluded.activity,updated_at=excluded.updated_at`
    ).run(p.agentId, p.x, p.y, p.facing, p.activity, this.#clock.iso());
  }

  listPositions(): Position[] {
    return (this.#db.prepare('SELECT * FROM positions').all() as Row[]).map((r) => ({
      agentId: str(r['agent_id']), x: num(r['x']), y: num(r['y']),
      facing: str(r['facing']) as Position['facing'], activity: str(r['activity']),
      updatedAt: str(r['updated_at']),
    }));
  }

  // ----------------------------------------------------------------- tasks
  createTask(t: Omit<Task, 'createdAt' | 'updatedAt'>): Task {
    const now = this.#clock.iso();
    this.#db.prepare(
      `INSERT INTO tasks(id,title,body,status,created_by,assigned_to,parent_id,priority,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?)`
    ).run(t.id, t.title, t.body, t.status, t.createdBy, t.assignedTo, t.parentId, t.priority, now, now);
    return { ...t, createdAt: now, updatedAt: now };
  }

  updateTaskStatus(id: TaskId, status: TaskStatus, assignedTo?: AgentId | null): void {
    if (assignedTo === undefined) {
      this.#db.prepare('UPDATE tasks SET status=?, updated_at=? WHERE id=?').run(status, this.#clock.iso(), id);
    } else {
      this.#db.prepare('UPDATE tasks SET status=?, assigned_to=?, updated_at=? WHERE id=?')
        .run(status, assignedTo, this.#clock.iso(), id);
    }
  }

  getTask(id: TaskId): Task | null {
    const r = this.#db.prepare('SELECT * FROM tasks WHERE id=?').get(id) as Row | undefined;
    return r ? this.#toTask(r) : null;
  }

  listTasks(filter?: { assignedTo?: AgentId; status?: TaskStatus }): Task[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (filter?.assignedTo) { where.push('assigned_to=?'); args.push(filter.assignedTo); }
    if (filter?.status) { where.push('status=?'); args.push(filter.status); }
    const sql = `SELECT * FROM tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY priority, created_at`;
    return (this.#db.prepare(sql).all(...(args as never[])) as Row[]).map((r) => this.#toTask(r));
  }

  #toTask(r: Row): Task {
    return {
      id: str(r['id']), title: str(r['title']), body: str(r['body']),
      status: str(r['status']) as TaskStatus, createdBy: str(r['created_by']),
      assignedTo: nstr(r['assigned_to']), parentId: nstr(r['parent_id']),
      priority: num(r['priority']), createdAt: str(r['created_at']), updatedAt: str(r['updated_at']),
    };
  }

  // ------------------------------------------------------------- approvals
  createApproval(input: {
    requestedBy: AgentId; capability: Capability; tier: ApprovalTier; summary: string;
    target?: string | null; amountCents?: number | null; payload?: unknown;
  }): Approval {
    const id = newId('apr', this.#clock.now());
    const at = this.#clock.iso();
    this.#db.prepare(
      `INSERT INTO approvals(id,requested_by,capability,tier,state,summary,target,amount_cents,payload_json,requested_at)
       VALUES(?,?,?,?,'pending',?,?,?,?,?)`
    ).run(id, input.requestedBy, input.capability, input.tier, input.summary,
      input.target ?? null, input.amountCents ?? null,
      input.payload === undefined ? null : JSON.stringify(input.payload), at);
    return this.getApproval(id)!;
  }

  getApproval(id: ApprovalId): Approval | null {
    const r = this.#db.prepare('SELECT * FROM approvals WHERE id=?').get(id) as Row | undefined;
    return r ? this.#toApproval(r) : null;
  }

  listApprovals(state: Approval['state'] = 'pending', tier?: ApprovalTier): Approval[] {
    const sql = tier
      ? 'SELECT * FROM approvals WHERE state=? AND tier=? ORDER BY requested_at'
      : 'SELECT * FROM approvals WHERE state=? ORDER BY requested_at';
    const args = tier ? [state, tier] : [state];
    return (this.#db.prepare(sql).all(...(args as never[])) as Row[]).map((r) => this.#toApproval(r));
  }

  /**
   * Decide a pending approval. Returns false if it was already decided —
   * this is what makes approval exactly-once, so a draft cannot publish twice.
   */
  decideApproval(id: ApprovalId, decidedBy: AgentId, approved: boolean, reason: string): boolean {
    const res = this.#db.prepare(
      `UPDATE approvals SET state=?, decided_by=?, decided_at=?, decision_reason=?
       WHERE id=? AND state='pending'`
    ).run(approved ? 'approved' : 'rejected', decidedBy, this.#clock.iso(), reason, id);
    return Number(res.changes) === 1;
  }

  #toApproval(r: Row): Approval {
    return {
      id: str(r['id']), requestedBy: str(r['requested_by']),
      capability: str(r['capability']) as Capability, tier: str(r['tier']) as ApprovalTier,
      state: str(r['state']) as Approval['state'], summary: str(r['summary']),
      target: nstr(r['target']), amountCents: nnum(r['amount_cents']),
      payloadJson: nstr(r['payload_json']), requestedAt: str(r['requested_at']),
      decidedBy: nstr(r['decided_by']), decidedAt: nstr(r['decided_at']),
      decisionReason: nstr(r['decision_reason']),
    };
  }

  // ----------------------------------------------------------------- money
  spentTodayCents(agentId: AgentId): number {
    const r = this.#db.prepare(
      'SELECT COALESCE(SUM(amount_cents),0) AS s FROM spend WHERE agent_id=? AND spend_day=?'
    ).get(agentId, this.#clock.day()) as Row;
    return num(r['s']);
  }

  /**
   * House Rule 4, enforced rather than requested.
   *
   * BEGIN IMMEDIATE takes the write lock BEFORE the SUM is read, so two staff
   * members spending concurrently serialise here instead of both observing the
   * same "remaining" and both being allowed through. Without IMMEDIATE this is
   * a textbook check-then-act race and the cap leaks real money.
   */
  trySpend(input: {
    agentId: AgentId; amountCents: number; purpose: string;
    capCents: number; approvalId?: ApprovalId | null;
  }): SpendOutcome {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new TypeError(`spend must be a positive integer number of cents, got ${input.amountCents}`);
    }
    const day = this.#clock.day();
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const cur = this.#db.prepare(
        'SELECT COALESCE(SUM(amount_cents),0) AS s FROM spend WHERE agent_id=? AND spend_day=?'
      ).get(input.agentId, day) as Row;
      const spent = num(cur['s']);

      if (spent + input.amountCents > input.capCents) {
        this.#db.exec('ROLLBACK');
        return {
          ok: false, reason: 'capped', spentTodayCents: spent,
          capCents: input.capCents, requestedCents: input.amountCents,
        };
      }

      const id = newId('spn', this.#clock.now());
      const at = this.#clock.iso();
      this.#db.prepare(
        'INSERT INTO spend(id,agent_id,amount_cents,purpose,approval_id,at,spend_day) VALUES(?,?,?,?,?,?,?)'
      ).run(id, input.agentId, input.amountCents, input.purpose, input.approvalId ?? null, at, day);
      this.#db.exec('COMMIT');

      const record: SpendRecord = {
        id, agentId: input.agentId, amountCents: input.amountCents,
        purpose: input.purpose, approvalId: input.approvalId ?? null, at,
      };
      return {
        ok: true, record,
        spentTodayCents: spent + input.amountCents,
        remainingCents: input.capCents - (spent + input.amountCents),
      };
    } catch (err) {
      try { this.#db.exec('ROLLBACK'); } catch { /* already unwound */ }
      throw err;
    }
  }

  // ------------------------------------------------------------ notes index
  indexNote(n: { path: string; author: AgentId; subject: string | null; title: string; writtenAt: string }): void {
    this.#db.prepare(
      `INSERT INTO notes_index(path,author,subject,title,written_at,indexed_at) VALUES(?,?,?,?,?,?)
       ON CONFLICT(path) DO UPDATE SET author=excluded.author, subject=excluded.subject,
         title=excluded.title, written_at=excluded.written_at, indexed_at=excluded.indexed_at`
    ).run(n.path, n.author, n.subject, n.title, n.writtenAt, this.#clock.iso());
  }

  clearNoteIndex(): void { this.#db.exec('DELETE FROM notes_index'); }

  countNotes(): number {
    const r = this.#db.prepare('SELECT COUNT(*) AS c FROM notes_index').get() as Row;
    return num(r['c']);
  }

  notesAbout(subject: AgentId): Array<{ path: string; author: string; title: string; writtenAt: string }> {
    return (this.#db.prepare(
      'SELECT path,author,title,written_at FROM notes_index WHERE subject=? ORDER BY written_at DESC'
    ).all(subject) as Row[]).map((r) => ({
      path: str(r['path']), author: str(r['author']),
      title: str(r['title']), writtenAt: str(r['written_at']),
    }));
  }
}
