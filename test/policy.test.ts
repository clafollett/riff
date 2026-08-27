import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_POLICY, readPolicy } from '../src/core/config.ts';

/**
 * Policy arrives from a hand-edited file and from the console, so nothing here
 * may be trusted to be a number, in range, or present at all.
 */
describe('a company can be tuned without being broken', () => {
  test('a company that predates policy reads back at the defaults, not at zero', () => {
    assert.deepEqual(readPolicy(undefined), DEFAULT_POLICY);
    assert.deepEqual(readPolicy({}), DEFAULT_POLICY);
  });

  test('what is written down wins, field by field', () => {
    const p = readPolicy({ maxTurns: 120, concurrency: 6 });
    assert.equal(p.maxTurns, 120);
    assert.equal(p.concurrency, 6);
    assert.equal(p.commonsCeiling, DEFAULT_POLICY.commonsCeiling, 'untouched fields keep the default');
  });

  test('nonsense falls back rather than propagating', () => {
    const p = readPolicy({ maxTurns: 'lots', concurrency: null, baseIntervalMinutes: NaN });
    assert.equal(p.maxTurns, DEFAULT_POLICY.maxTurns);
    assert.equal(p.concurrency, DEFAULT_POLICY.concurrency);
    assert.equal(p.baseIntervalMinutes, DEFAULT_POLICY.baseIntervalMinutes);
  });

  test('a turn ceiling of zero would mean a company that cannot work', () => {
    assert.equal(readPolicy({ maxTurns: 0 }).maxTurns, 1);
    assert.equal(readPolicy({ maxTurns: -5 }).maxTurns, 1);
  });

  test('a thousand concurrent agents is not a configuration, it is an accident', () => {
    assert.equal(readPolicy({ concurrency: 1000 }).concurrency, 16);
  });

  test('stopping below where it slows down would mean it never slows down', () => {
    // Ordered, whichever way round they were written.
    const p = readPolicy({ throttleAboveUtilization: 0.9, pauseAboveUtilization: 0.4 });
    assert.ok(p.pauseAboveUtilization >= p.throttleAboveUtilization,
      `stop ${p.pauseAboveUtilization} is below slow-down ${p.throttleAboveUtilization}`);
  });

  test('a full window is a valid answer: never stop', () => {
    assert.equal(readPolicy({ pauseAboveUtilization: 1 }).pauseAboveUtilization, 1);
  });

  test('turns and headcount are whole things', () => {
    const p = readPolicy({ maxTurns: 60.7, concurrency: 2.4, commonsCeiling: 40.5 });
    assert.equal(p.maxTurns, 61);
    assert.equal(p.concurrency, 2);
    assert.equal(p.commonsCeiling, 41);
  });
});
