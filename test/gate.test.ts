import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Ledger } from '../src/ledger/ledger.ts';
import { PolicyGate } from '../src/policy/gate.ts';
import { DEFAULT_HOUSE_RULES, type HouseRules } from '../src/policy/rules.ts';
import { fixedClock } from '../src/core/clock.ts';
import type { Agent } from '../src/core/types.ts';

const staff = (id: string, role: Agent['role'], reportsTo: string | null = 'matt'): Agent => ({
  id, name: id[0]!.toUpperCase() + id.slice(1), role, title: role,
  reportsTo, building: 'the-study', department: 'ops', status: 'active',
  hiredAt: '2026-08-01T00:00:00.000Z', hiredBy: null, model: 'claude-sonnet-5',
});

let clock: ReturnType<typeof fixedClock>;
let ledger: Ledger;
let gate: PolicyGate;
const rules: HouseRules = { ...DEFAULT_HOUSE_RULES, innkeeper: 'cali', chiefOfStaff: 'matt' };

beforeEach(() => {
  clock = fixedClock('2026-08-24T09:00:00.000Z');
  ledger = new Ledger(':memory:', clock);
  // The Innkeeper is a resident of the world, not an admin outside it —
  // they occupy a row, stand on the map, and can be referenced by approvals.
  ledger.upsertAgent({ ...staff('cali', 'innkeeper', null), building: 'the-house' });
  ledger.upsertAgent(staff('matt', 'chief_of_staff', 'cali'));
  ledger.upsertAgent(staff('greg', 'director'));
  ledger.upsertAgent(staff('dennis', 'director'));
  gate = new PolicyGate(ledger, rules);
});

describe('R3 — the outside world always lands as a draft', () => {
  test('external.write escalates to the Innkeeper, never allows', () => {
    const d = gate.request({
      actor: 'greg', capability: 'external.write',
      target: 'etsy:listing', summary: 'publish 3 Etsy listings',
    });
    assert.equal(d.kind, 'escalate');
    assert.equal(d.kind === 'escalate' && d.tier, 'innkeeper');
    assert.equal(d.rule, 'R3.drafts_only');
  });

  test('holds even for the Chief of Staff — nobody self-authorises going live', () => {
    const d = gate.request({ actor: 'matt', capability: 'external.write', summary: 'send outreach email' });
    assert.equal(d.kind, 'escalate');
    assert.equal(d.kind === 'escalate' && d.tier, 'innkeeper');
  });

  test('the draft is parked as a pending approval, not performed', () => {
    gate.request({ actor: 'greg', capability: 'external.write', summary: 'publish listing' });
    const pending = ledger.listApprovals('pending', 'innkeeper');
    assert.equal(pending.length, 1);
    assert.equal(pending[0]!.requestedBy, 'greg');
    assert.equal(pending[0]!.state, 'pending');
  });
});

describe('R4 — money', () => {
  test('a non-treasurer is denied outright', () => {
    const d = gate.request({ actor: 'greg', capability: 'spend', amountCents: 100, summary: 'buy credits' });
    assert.equal(d.kind, 'deny');
    assert.equal(d.rule, 'R4.not_treasurer');
    assert.equal(ledger.spentTodayCents('greg'), 0);
  });

  test('the treasurer may spend under the cap, and it is recorded', () => {
    const d = gate.request({ actor: 'matt', capability: 'spend', amountCents: 250, summary: 'Higgsfield credits' });
    assert.equal(d.kind, 'allow');
    assert.equal(ledger.spentTodayCents('matt'), 250);
  });

  test('the cap holds across many small spends — no leak', () => {
    for (let i = 0; i < 5; i++) {
      gate.request({ actor: 'matt', capability: 'spend', amountCents: 100, summary: `sprite batch ${i}` });
    }
    assert.equal(ledger.spentTodayCents('matt'), 500);

    // The 6th dollar must not land.
    const d = gate.request({ actor: 'matt', capability: 'spend', amountCents: 100, summary: 'one more' });
    assert.equal(d.kind, 'escalate');
    assert.equal(d.rule, 'R4.over_cap');
    assert.equal(ledger.spentTodayCents('matt'), 500, 'cap leaked — money moved past $5.00');
  });

  test('a single oversized spend cannot vault the cap', () => {
    const d = gate.request({ actor: 'matt', capability: 'spend', amountCents: 50_000, summary: 'a very good idea' });
    assert.equal(d.kind, 'escalate');
    assert.equal(ledger.spentTodayCents('matt'), 0);
  });

  test('the cap resets on the next local day', () => {
    gate.request({ actor: 'matt', capability: 'spend', amountCents: 500, summary: 'day one' });
    assert.equal(ledger.spentTodayCents('matt'), 500);

    clock.advance(24 * 60 * 60 * 1000);
    assert.equal(ledger.spentTodayCents('matt'), 0, 'new day should start fresh');
    const d = gate.request({ actor: 'matt', capability: 'spend', amountCents: 500, summary: 'day two' });
    assert.equal(d.kind, 'allow');
  });

  test('fractional and negative amounts are refused, not rounded', () => {
    const frac = gate.request({ actor: 'matt', capability: 'spend', amountCents: 10.5, summary: 'half a cent' });
    assert.equal(frac.kind, 'deny');
    const neg = gate.request({ actor: 'matt', capability: 'spend', amountCents: -100, summary: 'refund myself' });
    assert.equal(neg.kind, 'deny');
    assert.equal(ledger.spentTodayCents('matt'), 0);
  });

  test('overCap:deny is a hard wall with no appeal', () => {
    const strict = new PolicyGate(ledger, { ...rules, overCap: 'deny' });
    strict.request({ actor: 'matt', capability: 'spend', amountCents: 500, summary: 'cap it' });
    const d = strict.request({ actor: 'matt', capability: 'spend', amountCents: 1, summary: 'one cent more' });
    assert.equal(d.kind, 'deny');
    assert.equal(ledger.listApprovals('pending').length, 0, 'deny must not open an appeal');
  });
});

describe('R2 — the Chief of Staff signs', () => {
  test('a director hiring escalates to the Chief', () => {
    const d = gate.request({ actor: 'greg', capability: 'hire', summary: 'hire a listings assistant' });
    assert.equal(d.kind, 'escalate');
    assert.equal(d.kind === 'escalate' && d.tier, 'chief_of_staff');
  });

  test('the Chief does not need their own signature', () => {
    const d = gate.request({ actor: 'matt', capability: 'hire', summary: 'hire a listings assistant' });
    assert.equal(d.kind, 'allow');
    assert.equal(d.rule, 'R2.chief_self');
  });

  test('tampering with a colleague&apos;s files escalates', () => {
    const d = gate.request({
      actor: 'dennis', capability: 'world.write_other',
      target: 'agents/greg/persona.md', summary: 'correct Greg&apos;s brief',
    });
    assert.equal(d.kind, 'escalate');
    assert.equal(d.kind === 'escalate' && d.tier, 'chief_of_staff');
  });
});

describe('transparency — reading a colleague is allowed but never quiet', () => {
  test('read_other is allowed and leaves a trace in the log', () => {
    const before = ledger.latestSeq();
    const d = gate.request({
      actor: 'dennis', capability: 'world.read_other',
      target: 'agents/greg/persona.md', summary: 'check what Greg was told to do',
    });
    assert.equal(d.kind, 'allow');
    const events = ledger.eventsSince(before);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.actor, 'dennis');
    assert.equal(events[0]!.subject, 'agents/greg/persona.md');
  });
});

describe('standing', () => {
  test('the Innkeeper bypasses the gate entirely', () => {
    const d = gate.request({ actor: 'cali', capability: 'external.write', summary: 'I will publish this myself' });
    assert.equal(d.kind, 'allow');
    assert.equal(d.rule, 'innkeeper.bypass');
  });

  test('an unknown actor is denied', () => {
    const d = gate.request({ actor: 'ghost', capability: 'task.create', summary: 'hello' });
    assert.equal(d.kind, 'deny');
    assert.equal(d.rule, 'staff.unknown');
  });

  test('a dismissed staff member cannot act', () => {
    ledger.upsertAgent({ ...staff('greg', 'director'), status: 'dismissed' });
    const d = gate.request({ actor: 'greg', capability: 'task.create', summary: 'still here' });
    assert.equal(d.kind, 'deny');
    assert.equal(d.rule, 'staff.dismissed');
  });
});

describe('approvals are exactly-once', () => {
  test('a draft cannot be approved twice', () => {
    const d = gate.request({ actor: 'greg', capability: 'external.write', summary: 'publish listing' });
    assert.equal(d.kind, 'escalate');
    const id = d.kind === 'escalate' ? d.approvalId : '';

    assert.equal(gate.decide(id, 'cali', true, 'looks good'), true);
    assert.equal(gate.decide(id, 'cali', true, 'looks good again'), false, 'double-approve must be refused');
    assert.equal(ledger.getApproval(id)!.state, 'approved');
  });

  test('rejection is equally final', () => {
    const d = gate.request({ actor: 'greg', capability: 'external.write', summary: 'publish listing' });
    const id = d.kind === 'escalate' ? d.approvalId : '';
    assert.equal(gate.decide(id, 'cali', false, 'no'), true);
    assert.equal(gate.decide(id, 'cali', true, 'actually yes'), false, 'cannot flip a decided approval');
    assert.equal(ledger.getApproval(id)!.state, 'rejected');
  });

  test('the Chief cannot sign off on something addressed to the Innkeeper', () => {
    const d = gate.request({ actor: 'greg', capability: 'external.write', summary: 'publish listing' });
    const id = d.kind === 'escalate' ? d.approvalId : '';
    assert.equal(gate.decide(id, 'matt', true, 'I got this'), false);
    assert.equal(ledger.getApproval(id)!.state, 'pending', 'must still be waiting for the Innkeeper');
  });

  test('the Chief can sign off on Chief-tier work', () => {
    const d = gate.request({ actor: 'greg', capability: 'hire', summary: 'hire an assistant' });
    const id = d.kind === 'escalate' ? d.approvalId : '';
    assert.equal(gate.decide(id, 'matt', true, 'approved'), true);
  });

  test('a random staff member cannot approve anything', () => {
    const d = gate.request({ actor: 'greg', capability: 'hire', summary: 'hire an assistant' });
    const id = d.kind === 'escalate' ? d.approvalId : '';
    assert.equal(gate.decide(id, 'dennis', true, 'sure why not'), false);
    assert.equal(ledger.getApproval(id)!.state, 'pending');
  });
});
