import { slug } from '../core/ids.ts';
import type { Ledger } from '../ledger/ledger.ts';
import type { World } from '../worldfs/world.ts';
import type { Clock } from '../core/clock.ts';

/**
 * Applies approvals that have been said yes to.
 *
 * Deliberately separate from the staff member who asked. An escalation is
 * enacted by the Inn, after a decision, by code that never ran inside the
 * requester's session — so "get it approved" and "do it" cannot collapse into
 * one step that an agent could drive on its own.
 *
 * Idempotent: each approval is stamped applied in the event log, and already
 * applied ones are skipped.
 */
export const applyApproved = (ledger: Ledger, world: World, clock: Clock): number => {
  const approved = ledger.listApprovals('approved');
  let applied = 0;

  for (const ap of approved) {
    if (ledger.getMeta(`applied:${ap.id}`)) continue;

    try {
      switch (ap.capability) {
        case 'hire': {
          const p = JSON.parse(ap.payloadJson ?? '{}') as Record<string, string>;
          if (p['retire']) {                       // a retirement, not a hire
            const gone = ledger.getAgent(p['retire']);
            if (gone) ledger.upsertAgent({ ...gone, status: 'departed' });
            ledger.emit('company', 'role.retired', p['retire'] ?? null, { why: p['why'] });
            applied++;
            break;
          }
          if (!p['name'] || !p['role']) break;
          const id = slug(p['name']);
          if (ledger.getAgent(id)) break;
          ledger.upsertAgent({
            id, name: p['name'], tier: (p['tier'] ?? 'member') as 'executive' | 'lead' | 'member',
            role: p['role'], department: p['department'] ?? '',
            reportsTo: p['reportsTo'] ?? ap.requestedBy, status: 'active',
            activity: 'just arrived', mandate: p['mandate'] ?? '',
            hiredAt: clock.iso(), hiredBy: ap.requestedBy, model: 'claude-opus-5',
          });
          world.ensureStaff(id);
          world.writeDoc(world.personaPath(id), {
            data: { agent: id, tier: p['tier'] ?? 'member', role: p['role'] },
            body: `# ${p['name']}

**${p['role']}**

## Your mandate

${p['mandate'] ?? ''}
`,
          });
          ledger.emit('company', 'role.filled', id, { by: ap.requestedBy, role: p['role'] });
          applied++;
          break;
        }

        case 'external.write': {
          // Rule 3's landing point. Approval marks the draft releasable; the
          // connector that actually sends it reads from here. Until one is
          // wired up, an approved draft is exactly that — approved, and still
          // sitting in the staff member's drafts folder.
          const p = JSON.parse(ap.payloadJson ?? '{}') as { channel?: string; draftPath?: string };
          ledger.emit('inn', 'external.released', ap.requestedBy, {
            channel: p.channel, draftPath: p.draftPath, approvalId: ap.id,
          });
          applied++;
          break;
        }

        case 'spend': {
          // An over-cap spend the Inn Keeper allowed as an exception.
          if (ap.amountCents != null) {
            ledger.trySpend({
              agentId: ap.requestedBy, amountCents: ap.amountCents,
              purpose: `[approved exception] ${ap.summary}`,
              capCents: Number.MAX_SAFE_INTEGER, approvalId: ap.id,
            });
            ledger.emit('inn', 'spend.exception', ap.requestedBy, {
              amountCents: ap.amountCents, approvalId: ap.id,
            });
            applied++;
          }
          break;
        }

        default:
          ledger.emit('inn', 'approval.applied_noop', ap.id, { capability: ap.capability });
      }
      ledger.setMeta(`applied:${ap.id}`, clock.iso());
    } catch (err) {
      ledger.emit('inn', 'approval.apply_failed', ap.id, {
        error: err instanceof Error ? err.message : String(err),
      });
      ledger.setMeta(`applied:${ap.id}`, `failed:${clock.iso()}`);
    }
  }
  return applied;
};
