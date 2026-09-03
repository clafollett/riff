import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { newId } from '../src/core/ids.ts';

/**
 * An id's time prefix only separates ids from different milliseconds, so
 * everything written inside one millisecond is distinguished by the random
 * half alone. Three bytes is 16.7M values — even odds of a collision at about
 * 4,800 ids — and the vitals suite, which emits on a frozen clock so every id
 * shares one prefix, failed intermittently with
 * `UNIQUE constraint failed: events.id`.
 */
describe('ids do not collide inside a single millisecond', () => {
  test('twenty thousand ids from one instant are all distinct', () => {
    const frozen = new Date('2026-09-03T05:00:00.000Z');
    const ids = new Set<string>();
    for (let i = 0; i < 20_000; i++) ids.add(newId('evt', frozen));
    assert.equal(ids.size, 20_000);
  });

  test('the time prefix still sorts chronologically', () => {
    const a = newId('evt', new Date('2026-09-03T05:00:00.000Z'));
    const b = newId('evt', new Date('2026-09-03T05:00:00.001Z'));
    assert.ok(a < b, `${a} should sort before ${b}`);
  });
});
