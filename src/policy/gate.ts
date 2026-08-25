import type { Decision, GateRequest } from '../core/types.ts';
import type { Ledger } from '../ledger/ledger.ts';
import type { HouseRules } from './rules.ts';

/**
 * The policy gate. Every action any staff member attempts passes through
 * `request()` — the runtime exposes no tool that bypasses it.
 *
 * IMPORTANT — `spend` is not advisory.
 * For every other capability, `request()` decides and the caller then acts.
 * For `spend`, deciding and acting must be one atomic step or the daily cap
 * leaks under concurrency, so an `allow` for `spend` means the money has
 * ALREADY been recorded. There is deliberately no way to ask "would this be
 * allowed?" for money — that question is the race.
 */
export class PolicyGate {
  #ledger: Ledger;
  #rules: HouseRules;

  constructor(ledger: Ledger, rules: HouseRules) {
    this.#ledger = ledger;
    this.#rules = rules;
  }

  get rules(): HouseRules { return this.#rules; }

  request(req: GateRequest): Decision {
    const d = this.#decide(req);
    // Every decision is logged, including the allows. This log is the whole
    // answer to "what did they do while I was gone".
    this.#ledger.emit(req.actor, `gate.${d.kind}`, req.target ?? null, {
      capability: req.capability,
      rule: d.rule,
      summary: req.summary,
      ...(d.kind !== 'allow' ? { reason: d.reason } : {}),
      ...(d.kind === 'escalate' ? { approvalId: d.approvalId, tier: d.tier } : {}),
      ...(req.amountCents != null ? { amountCents: req.amountCents } : {}),
    });
    return d;
  }

  #decide(req: GateRequest): Decision {
    const { capability, actor } = req;
    const r = this.#rules;

    // You are the principal, not a subject. The gate exists to protect you
    // from the staff, not to supervise you.
    if (actor === r.innkeeper) return { kind: 'allow', rule: 'innkeeper.bypass' };

    const agent = this.#ledger.getAgent(actor);
    if (!agent) {
      return { kind: 'deny', rule: 'staff.unknown', reason: `no staff member '${actor}' works here` };
    }
    if (agent.status === 'dismissed') {
      return { kind: 'deny', rule: 'staff.dismissed', reason: `${agent.name} no longer works here` };
    }

    // ---- R3: the outside world is reachable, but only ever as a draft. ----
    // Checked before everything else so no later branch can shadow it.
    if (r.innkeeperApproves.includes(capability)) {
      const ap = this.#ledger.createApproval({
        requestedBy: actor, capability, tier: 'innkeeper', summary: req.summary,
        target: req.target ?? null, amountCents: req.amountCents ?? null, payload: req.payload,
      });
      return {
        kind: 'escalate', rule: 'R3.drafts_only', tier: 'innkeeper', approvalId: ap.id,
        reason: 'reaches the outside world; held as a draft for the Innkeeper',
      };
    }

    // ---------------------------- R4: money ----------------------------
    if (capability === 'spend') {
      if (!r.treasurers.includes(actor)) {
        return {
          kind: 'deny', rule: 'R4.not_treasurer',
          reason: `only ${r.treasurers.join(', ')} may spend; ${agent.name} may not`,
        };
      }
      const amount = req.amountCents;
      if (amount == null || !Number.isInteger(amount) || amount <= 0) {
        return { kind: 'deny', rule: 'R4.bad_amount', reason: 'spend needs a positive integer amountCents' };
      }

      // Atomic: this either records the money or refuses. No gap to race in.
      const out = this.#ledger.trySpend({
        agentId: actor, amountCents: amount, purpose: req.summary, capCents: r.dailyCapCents,
      });

      if (out.ok) return { kind: 'allow', rule: 'R4.within_cap' };

      if (r.overCap === 'deny') {
        return {
          kind: 'deny', rule: 'R4.over_cap',
          reason: `daily cap ${fmt(out.capCents)} would be exceeded (${fmt(out.spentTodayCents)} spent, ${fmt(out.requestedCents)} requested)`,
        };
      }
      const ap = this.#ledger.createApproval({
        requestedBy: actor, capability, tier: 'innkeeper', summary: req.summary,
        target: req.target ?? null, amountCents: amount, payload: req.payload,
      });
      return {
        kind: 'escalate', rule: 'R4.over_cap', tier: 'innkeeper', approvalId: ap.id,
        reason: `over the ${fmt(out.capCents)} daily cap (${fmt(out.spentTodayCents)} already spent today)`,
      };
    }

    // ---------------------- R2: the Steward signs ----------------------
    if (r.stewardApproves.includes(capability)) {
      // The Steward does not need their own signature.
      if (actor === r.steward) return { kind: 'allow', rule: 'R2.steward_self' };
      const ap = this.#ledger.createApproval({
        requestedBy: actor, capability, tier: 'steward', summary: req.summary,
        target: req.target ?? null, amountCents: req.amountCents ?? null, payload: req.payload,
      });
      return {
        kind: 'escalate', rule: 'R2.steward_approves', tier: 'steward', approvalId: ap.id,
        reason: `${capability} needs the Steward's sign-off`,
      };
    }

    // Reading a colleague's files is ALLOWED — deliberately. It is how one of
    // them noticed a colleague had faked a product. But it is never quiet: the
    // emit in request() makes every peek visible in the log and on the map.
    if (capability === 'world.read_other') {
      return { kind: 'allow', rule: 'transparency.read_is_loud' };
    }

    // R2's spirit: within your own remit, work however you like.
    return { kind: 'allow', rule: 'R2.autonomy' };
  }

  /**
   * Resolve a pending approval. Returns false if it was already decided —
   * the ledger's conditional UPDATE is what makes this exactly-once, so a
   * double-click in your inbox cannot publish a draft twice.
   */
  decide(approvalId: string, decidedBy: string, approved: boolean, reason = ''): boolean {
    const ap = this.#ledger.getApproval(approvalId);
    if (!ap) return false;

    // Standing check: only the tier that was asked may answer.
    const permitted = ap.tier === 'innkeeper'
      ? decidedBy === this.#rules.innkeeper
      : decidedBy === this.#rules.steward || decidedBy === this.#rules.innkeeper;
    if (!permitted) {
      this.#ledger.emit(decidedBy, 'gate.decide_refused', approvalId, {
        reason: `${decidedBy} lacks standing to answer a ${ap.tier} approval`,
      });
      return false;
    }

    const ok = this.#ledger.decideApproval(approvalId, decidedBy, approved, reason);
    if (ok) {
      this.#ledger.emit(decidedBy, approved ? 'approval.approved' : 'approval.rejected', approvalId, {
        capability: ap.capability, summary: ap.summary, requestedBy: ap.requestedBy, reason,
      });
    }
    return ok;
  }
}

const fmt = (cents: number): string => `$${(cents / 100).toFixed(2)}`;
