import type { Ledger } from '../ledger/ledger.ts';
import type { Clock } from '../core/clock.ts';
import type { AgentId } from '../core/types.ts';

export type Morale = {
  agentId: AgentId;
  name: string;
  score: number;        // 0..100
  approved: number;
  dropped: number;
  refused: number;
  notesAbout: number;
  daysSinceSpokenTo: number | null;
  why: string;
};

/**
 * Morale is DERIVED, never stored.
 *
 * Nobody here has feelings — these are language models following instructions.
 * What this actually measures is neglect and friction: work that got dropped,
 * requests that got refused, and how long since a human said anything to them.
 * Those are real signals about the Inn, and they read as morale because that
 * is genuinely what low morale is made of.
 *
 * Recomputed from the event log on every request, so it can never drift from
 * what actually happened.
 */
export const computeMorale = (ledger: Ledger, clock: Clock, innkeeper: AgentId): Morale[] => {
  const events = ledger.eventsSince(0, 100_000);
  const now = clock.now().getTime();

  const tally = new Map<AgentId, { approved: number; dropped: number; refused: number; lastAddressed: number | null }>();
  const get = (id: AgentId) => {
    let t = tally.get(id);
    if (!t) { t = { approved: 0, dropped: 0, refused: 0, lastAddressed: null }; tally.set(id, t); }
    return t;
  };

  for (const e of events) {
    const data = e.dataJson ? JSON.parse(e.dataJson) as Record<string, unknown> : {};
    if (e.kind === 'task.done') get(e.actor).approved++;
    if (e.kind === 'task.dropped') get(e.actor).dropped++;
    if (e.kind === 'gate.deny') get(e.actor).refused++;
    if (e.kind === 'approval.approved' && typeof data['requestedBy'] === 'string') {
      get(String(data['requestedBy'])).approved++;
    }
    // Being spoken to by the Inn Keeper is the strongest signal here.
    if (e.actor === innkeeper && e.subject) {
      get(e.subject).lastAddressed = new Date(e.at).getTime();
    }
    if (e.kind === 'message.sent' && e.actor === innkeeper && e.subject) {
      get(e.subject).lastAddressed = new Date(e.at).getTime();
    }
  }

  return ledger.listAgents()
    .filter((a) => a.id !== innkeeper)
    .map((a) => {
      const t = get(a.id);
      const notesAbout = ledger.notesAbout(a.id).length;
      const days = t.lastAddressed == null ? null : (now - t.lastAddressed) / 86_400_000;

      // Start neutral. Finished work lifts; dropped and refused work bites;
      // silence from the Inn Keeper bites hardest, which is the point.
      let score = 55;
      score += Math.min(30, t.approved * 4);
      score -= Math.min(25, t.dropped * 5);
      score -= Math.min(20, t.refused * 3);
      if (days == null) score -= 20;
      else if (days > 7) score -= 18;
      else if (days > 3) score -= 8;
      else score += 8;
      score = Math.max(0, Math.min(100, Math.round(score)));

      const why = days == null
        ? 'the Inn Keeper has never spoken to them'
        : days > 7 ? `nobody has spoken to them in ${Math.floor(days)} days`
        : t.dropped > t.approved ? 'more work dropped than finished'
        : t.refused > 3 ? 'keeps running into refusals'
        : t.approved > 0 ? 'work is landing'
        : 'nothing much has happened to them yet';

      return {
        agentId: a.id, name: a.name, score,
        approved: t.approved, dropped: t.dropped, refused: t.refused,
        notesAbout, daysSinceSpokenTo: days == null ? null : Math.floor(days), why,
      };
    })
    .sort((x, y) => x.score - y.score);
};
