import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { selectDue } from '../src/runtime/scheduler.ts';
import { roundIsDue } from '../src/runtime/cadence.ts';
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

describe('the interval paces the company, not one person at a time', () => {
  /**
   * Replay an hour of the loop's gating, in minutes.
   *
   * Only what decides WHEN work starts: the company gate, selectDue, and each
   * agent's own next-due. Shift length is fixed rather than modelled — the
   * question is how much of the hour the company is working, and a real run
   * answered 100% of it.
   */
  const run = (opts: { minutes: number; interval: number; slots: number; shift: number }) => {
    const nextDue = new Map<AgentId, number>();
    const busyUntil = new Map<AgentId, number>();
    let lastRound = 0;
    let started = 0;
    let workingMinutes = 0;

    for (let now = 1; now <= opts.minutes; now++) {
      const inFlight = new Set([...busyUntil].filter(([, until]) => until > now).map(([id]) => id));
      if (inFlight.size) workingMinutes++;
      if (!roundIsDue(now, lastRound, opts.interval)) continue;

      const due = selectDue(TEN.slice(0, 4), {
        now, nextDue, inFlight, slots: opts.slots - inFlight.size,
      });
      if (!due.length) continue;
      lastRound = now;
      for (const a of due) {
        started++;
        busyUntil.set(a.id, now + opts.shift);
        // Rank still staggers an individual; it no longer sets the rate.
        nextDue.set(a.id, now + opts.interval);
      }
    }
    return { started, workingMinutes };
  };

  test('four staff on a fifteen-minute interval do not work the whole hour', () => {
    // The bug this exists for: the gap applied to each person, so with four on
    // the roster somebody was always due. A real 70-minute run logged 69.9
    // minutes of shifts.
    const { started, workingMinutes } = run({ minutes: 60, interval: 15, slots: 2, shift: 4 });
    assert.ok(started <= 8, `at most one round of 2 every 15 minutes, got ${started} shifts`);
    assert.ok(workingMinutes < 40, `the company should rest; it worked ${workingMinutes} of 60 minutes`);
  });

  test('concurrency sets how many wake together, not how often', () => {
    const one = run({ minutes: 60, interval: 15, slots: 1, shift: 4 });
    const two = run({ minutes: 60, interval: 15, slots: 2, shift: 4 });
    assert.ok(two.started > one.started, 'two slots should do more work per round');
    // Rounds are gated the same either way — more hands, not more often.
    assert.ok(two.started <= one.started * 2 + 1,
      `two slots must not start more than twice the rounds: ${one.started} vs ${two.started}`);
  });

  test('a throttled company starts its rounds further apart', () => {
    // Throttling stretches the company cadence for the same reason it stretches
    // an individual's: pacing against a filling window means fewer rounds, not
    // the same number staggered differently.
    assert.equal(roundIsDue(10 * 60_000, 0, 10 * 60_000, 1), true);
    assert.equal(roundIsDue(10 * 60_000, 0, 10 * 60_000, 3), false);
    assert.equal(roundIsDue(30 * 60_000, 0, 10 * 60_000, 3), true);
  });

  test('the first round fires at once rather than waiting out an interval', () => {
    // lastRound starts at zero, so starting a company does not buy silence —
    // the operator who pressed Start should see a shift, not a quarter hour of
    // nothing. Any real clock is further from zero than any interval.
    assert.ok(roundIsDue(Date.now(), 0, 15 * 60_000), 'a fresh company works immediately');
    // And the round after it waits the full interval.
    const t0 = Date.now();
    assert.equal(roundIsDue(t0 + 60_000, t0, 15 * 60_000), false);
    assert.equal(roundIsDue(t0 + 15 * 60_000, t0, 15 * 60_000), true);
  });
});
