import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { selectDue } from '../src/runtime/scheduler.ts';
import type { Agent, AgentId, Tier } from '../src/core/types.ts';

const staff = (id: string, tier: Tier): Agent => ({
  id, name: id, tier, role: tier, department: '', reportsTo: 'ceo',
  status: 'active', activity: '', mandate: '',
  hiredAt: '2026-08-01T00:00:00.000Z', hiredBy: null, model: 'claude-opus-5',
});

/** One executive, three leads, six members — the shape that exposes the bug. */
const TEN: Agent[] = [
  staff('ceo', 'executive'),
  ...['lead1', 'lead2', 'lead3'].map((i) => staff(i, 'lead')),
  ...['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map((i) => staff(i, 'member')),
];

describe('ten staff and three slots: everybody works', () => {
  test('nobody is starved over a long run of contested rounds', () => {
    // Rank used to decide this, and rank already decides how often each
    // person comes due. Spent twice, the same seniors won every contest and
    // a member could be due, passed over, and still due, indefinitely.
    const nextDue = new Map<AgentId, number>();
    const shifts = new Map<AgentId, number>(TEN.map((a) => [a.id, 0]));
    // Seniors legitimately come due more often; that is #intervalFor's job.
    const gap = (a: Agent) => (a.tier === 'executive' ? 2 : a.tier === 'lead' ? 3 : 4);

    // Demand must exceed supply or the test proves nothing: ten staff on those
    // gaps want ~4.4 slots a round and there are 2. Under real contention,
    // sorting by rank starves the bottom of the roster.
    let now = 0;
    for (let round = 0; round < 300; round++) {
      now += 1;
      for (const a of selectDue(TEN, { now, nextDue, inFlight: new Set(), slots: 2 })) {
        shifts.set(a.id, shifts.get(a.id)! + 1);
        nextDue.set(a.id, now + gap(a));
      }
    }

    const counts = [...shifts.values()];
    assert.ok(Math.min(...counts) > 0, `somebody never worked: ${JSON.stringify([...shifts])}`);
    // Seniors do run more often — but not to the exclusion of anyone.
    const ceo = shifts.get('ceo')!, worst = Math.min(...counts);
    assert.ok(ceo / worst < 4, `the CEO ran ${ceo} to somebody's ${worst}; that is starvation`);
  });

  test('the longest wait is served first', () => {
    const nextDue = new Map<AgentId, number>([
      ['ceo', 90],      // due 10 ago
      ['lead1', 50],    // due 50 ago
      ['m1', 10],       // due 90 ago — waited longest
      ['m2', 95],       // due 5 ago
    ]);
    const picked = selectDue(TEN.filter((a) => nextDue.has(a.id)),
      { now: 100, nextDue, inFlight: new Set(), slots: 2 }).map((a) => a.id);
    assert.deepEqual(picked, ['m1', 'lead1'], 'lateness decides, not rank');
  });

  test('rank breaks the tie, so a fresh company is deterministic', () => {
    // Nobody has run: everyone is equally overdue. Order must not be arbitrary.
    const picked = selectDue(TEN, { now: 1, nextDue: new Map(), inFlight: new Set(), slots: 3 })
      .map((a) => a.id);
    assert.deepEqual(picked, ['ceo', 'lead1', 'lead2']);
  });

  test('nobody in flight is woken twice, and the board never works', () => {
    const inFlight = new Set<AgentId>(['ceo', 'lead1']);
    const picked = selectDue([...TEN, staff('cali', 'board')],
      { now: 1, nextDue: new Map(), inFlight, slots: 3 }).map((a) => a.id);
    assert.ok(!picked.includes('ceo') && !picked.includes('lead1'));
    assert.ok(!picked.includes('cali'), 'the board is not staff');
  });

  test('no slots means no wakeups, not a negative slice', () => {
    assert.deepEqual(selectDue(TEN, { now: 1, nextDue: new Map(), inFlight: new Set(), slots: -2 }), []);
  });
});
