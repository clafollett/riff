import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Ledger } from '../src/ledger/ledger.ts';
import { Gate, type CommonsView } from '../src/policy/gate.ts';
import { constitutionFor, type Constitution } from '../src/policy/rules.ts';
import { fixedClock } from '../src/core/clock.ts';
import type { Agent, Tier } from '../src/core/types.ts';

const agent = (id: string, tier: Tier, reportsTo: string | null = 'ceo'): Agent => ({
  id, name: id[0]!.toUpperCase() + id.slice(1), tier, role: tier,
  department: '', reportsTo, status: 'active', activity: '', mandate: '',
  hiredAt: '2026-08-01T00:00:00.000Z', hiredBy: null, model: 'claude-opus-5',
});

let clock: ReturnType<typeof fixedClock>;
let ledger: Ledger;
let gate: Gate;
let commons: { docs: Set<string> } & CommonsView;
const constitution: Constitution = constitutionFor({
  ceo: 'ceo', board: ['chair'], treasurers: ['ceo'], commonsCeiling: 3,
});

beforeEach(() => {
  clock = fixedClock('2026-08-25T09:00:00.000Z');
  ledger = new Ledger(':memory:', clock);
  ledger.upsertAgent(agent('chair', 'board', null));
  ledger.upsertAgent(agent('ceo', 'executive', 'chair'));
  ledger.upsertAgent(agent('rae', 'lead'));
  ledger.upsertAgent(agent('vim', 'member'));

  const docs = new Set<string>();
  commons = { docs, count: () => docs.size, exists: (p) => docs.has(p) };
  gate = new Gate(ledger, constitution, commons);
});

describe('R3 — the outside world is always a draft', () => {
  test('external.write escalates to the board, never allows', () => {
    const d = gate.request({ actor: 'rae', capability: 'external.write', summary: 'publish the launch post' });
    assert.equal(d.kind, 'escalate');
    assert.equal(d.kind === 'escalate' && d.tier, 'board');
    assert.equal(d.rule, 'R3.drafts_only');
  });

  test('holds for the CEO too — nobody self-authorises going outside', () => {
    const d = gate.request({ actor: 'ceo', capability: 'external.write', summary: 'send investor update' });
    assert.equal(d.kind, 'escalate');
    assert.equal(d.kind === 'escalate' && d.tier, 'board');
  });
});

describe('R4 — money', () => {
  test('a non-treasurer is refused outright', () => {
    const d = gate.request({ actor: 'rae', capability: 'spend', amountCents: 100, summary: 'credits' });
    assert.equal(d.kind, 'deny');
    assert.equal(ledger.spentTodayCents('rae'), 0);
  });

  test('the cap holds across many small spends', () => {
    for (let i = 0; i < 5; i++) {
      gate.request({ actor: 'ceo', capability: 'spend', amountCents: 100, summary: `batch ${i}` });
    }
    assert.equal(ledger.spentTodayCents('ceo'), 500);
    const d = gate.request({ actor: 'ceo', capability: 'spend', amountCents: 100, summary: 'one more' });
    assert.equal(d.kind, 'escalate');
    assert.equal(ledger.spentTodayCents('ceo'), 500, 'cap leaked — money moved past the ceiling');
  });

  test('fractional and negative amounts are refused, not rounded', () => {
    assert.equal(gate.request({ actor: 'ceo', capability: 'spend', amountCents: 10.5, summary: 'x' }).kind, 'deny');
    assert.equal(gate.request({ actor: 'ceo', capability: 'spend', amountCents: -100, summary: 'x' }).kind, 'deny');
    assert.equal(ledger.spentTodayCents('ceo'), 0);
  });

  test('the cap resets on the next local day', () => {
    gate.request({ actor: 'ceo', capability: 'spend', amountCents: 500, summary: 'day one' });
    clock.advance(24 * 60 * 60 * 1000);
    assert.equal(ledger.spentTodayCents('ceo'), 0);
    assert.equal(gate.request({ actor: 'ceo', capability: 'spend', amountCents: 500, summary: 'day two' }).kind, 'allow');
  });
});

describe('R6 — the complexity budget', () => {
  // The rule exists because agents accrete structure and never remove any.
  // Refusing the addition is what turns variation into selection.
  test('adding is allowed while there is room', () => {
    const d = gate.request({ actor: 'rae', capability: 'world.write', target: 'commons/vision.md', summary: 'vision' });
    assert.equal(d.kind, 'allow');
  });

  test('adding past the ceiling is refused, and says what to do instead', () => {
    commons.docs.add('commons/a.md');
    commons.docs.add('commons/b.md');
    commons.docs.add('commons/c.md');
    const d = gate.request({ actor: 'rae', capability: 'world.write', target: 'commons/d.md', summary: 'another' });
    assert.equal(d.kind, 'deny');
    assert.equal(d.rule, 'R6.commons_full');
    assert.match(d.kind === 'deny' ? d.reason : '', /remove one/i);
  });

  test('EDITING an existing document is always free, even when full', () => {
    commons.docs.add('commons/a.md');
    commons.docs.add('commons/b.md');
    commons.docs.add('commons/c.md');
    const d = gate.request({ actor: 'rae', capability: 'world.write', target: 'commons/b.md', summary: 'revise' });
    assert.equal(d.kind, 'allow', 'a ceiling that blocks revision would freeze the company');
  });

  test('the budget does not apply outside the commons', () => {
    commons.docs.add('commons/a.md');
    commons.docs.add('commons/b.md');
    commons.docs.add('commons/c.md');
    const d = gate.request({ actor: 'rae', capability: 'world.write', target: 'staff/rae/memory.md', summary: 'memory' });
    assert.equal(d.kind, 'allow', 'private notes are not shared complexity');
  });

  test('the board is never blocked by it', () => {
    commons.docs.add('commons/a.md');
    commons.docs.add('commons/b.md');
    commons.docs.add('commons/c.md');
    const d = gate.request({ actor: 'chair', capability: 'world.write', target: 'commons/d.md', summary: 'x' });
    assert.equal(d.kind, 'allow');
  });
});

describe('R2 — the CEO signs', () => {
  test('a lead proposing a role escalates to the CEO', () => {
    const d = gate.request({ actor: 'rae', capability: 'hire', summary: 'Head of Research' });
    assert.equal(d.kind, 'escalate');
    assert.equal(d.kind === 'escalate' && d.tier, 'executive');
  });

  test('the CEO does not need their own signature', () => {
    const d = gate.request({ actor: 'ceo', capability: 'hire', summary: 'Head of Research' });
    assert.equal(d.kind, 'allow');
    assert.equal(d.rule, 'R2.ceo_self');
  });
});

describe('standing', () => {
  test('the board bypasses the gate', () => {
    const d = gate.request({ actor: 'chair', capability: 'external.write', summary: 'I will send this myself' });
    assert.equal(d.kind, 'allow');
    assert.equal(d.rule, 'board.bypass');
  });

  test('an unknown actor is refused', () => {
    assert.equal(gate.request({ actor: 'ghost', capability: 'task.create', summary: 'hi' }).kind, 'deny');
  });

  test('a departed agent cannot act', () => {
    ledger.upsertAgent({ ...agent('rae', 'lead'), status: 'departed' });
    const d = gate.request({ actor: 'rae', capability: 'task.create', summary: 'still here' });
    assert.equal(d.rule, 'departed');
  });

  test('reading a colleague is allowed, and leaves a trace', () => {
    const before = ledger.latestSeq();
    const d = gate.request({
      actor: 'vim', capability: 'world.read_other',
      target: 'staff/rae/persona.md', summary: 'check what Rae was told',
    });
    assert.equal(d.kind, 'allow');
    const events = ledger.eventsSince(before);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.subject, 'staff/rae/persona.md');
  });
});

describe('approvals are exactly-once', () => {
  test('a draft cannot be approved twice', () => {
    const d = gate.request({ actor: 'rae', capability: 'external.write', summary: 'publish' });
    const id = d.kind === 'escalate' ? d.approvalId : '';
    assert.equal(gate.decide(id, 'chair', true, 'ok'), true);
    assert.equal(gate.decide(id, 'chair', true, 'ok again'), false);
    assert.equal(ledger.getApproval(id)!.state, 'approved');
  });

  test('the CEO cannot sign something addressed to the board', () => {
    const d = gate.request({ actor: 'rae', capability: 'external.write', summary: 'publish' });
    const id = d.kind === 'escalate' ? d.approvalId : '';
    assert.equal(gate.decide(id, 'ceo', true, 'I got this'), false);
    assert.equal(ledger.getApproval(id)!.state, 'pending');
  });

  test('a member cannot approve anything', () => {
    const d = gate.request({ actor: 'rae', capability: 'hire', summary: 'a seat' });
    const id = d.kind === 'escalate' ? d.approvalId : '';
    assert.equal(gate.decide(id, 'vim', true, 'sure'), false);
  });
});
