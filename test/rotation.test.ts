import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRotate, cacheEnv } from '../src/runtime/staff.ts';
import { readPolicy, DEFAULT_POLICY } from '../src/core/config.ts';

/** Half of a one-million window, which is where the default fires. */
const AT_HALF = {
  contextTokens: 500_000,
  contextWindow: 1_000_000,
  rotateAtPct: 50,
  turnsLeft: 40,
  rotations: 0,
};

describe('deciding to replace a conversation mid-shift', () => {
  test('a conversation past the threshold is handed over', () => {
    assert.equal(shouldRotate(AT_HALF), true);
  });

  test('a conversation short of the threshold is left alone', () => {
    assert.equal(shouldRotate({ ...AT_HALF, contextTokens: 499_999 }), false);
  });

  /**
   * The reason the dial is a percentage. Staff run whatever model the company
   * gave them, and the same token count is half a window on one and three
   * times the whole of another.
   */
  test('the same token count rotates on a small window and not on a large one', () => {
    const tokens = 150_000;
    assert.equal(shouldRotate({ ...AT_HALF, contextTokens: tokens, contextWindow: 200_000 }), true);
    assert.equal(shouldRotate({ ...AT_HALF, contextTokens: tokens, contextWindow: 1_000_000 }), false);
  });

  /**
   * A shift that reports no window has no denominator. Rotating on that guess
   * would throw away a conversation that might be nearly empty — the one thing
   * rotation must never do.
   */
  test('an unreported window never rotates', () => {
    assert.equal(shouldRotate({ ...AT_HALF, contextWindow: 0 }), false);
  });

  test('a shift that produced no assistant turn never rotates', () => {
    assert.equal(shouldRotate({ ...AT_HALF, contextTokens: 0 }), false);
  });

  test('zero turns it off outright, however full the conversation is', () => {
    assert.equal(shouldRotate({ ...AT_HALF, contextTokens: 999_999, rotateAtPct: 0 }), false);
  });

  /**
   * Rotating on the last few turns spends them all writing a note for a shift
   * that then ends — the cost of the hand-over with none of the benefit.
   */
  test('there must be room to hand over and still do something afterwards', () => {
    assert.equal(shouldRotate({ ...AT_HALF, turnsLeft: 12 }), true);
    assert.equal(shouldRotate({ ...AT_HALF, turnsLeft: 11 }), false);
  });

  test('a shift stops rotating after the second time', () => {
    assert.equal(shouldRotate({ ...AT_HALF, rotations: 1 }), true);
    assert.equal(shouldRotate({ ...AT_HALF, rotations: 2 }), false);
  });
});

describe('configuring the threshold', () => {
  test('an absent setting means the default, not never', () => {
    assert.equal(readPolicy({}).rotateAtContextPct, DEFAULT_POLICY.rotateAtContextPct);
    assert.ok(DEFAULT_POLICY.rotateAtContextPct > 0);
  });

  test('zero is honoured — it is the way to turn rotation off', () => {
    assert.equal(readPolicy({ rotateAtContextPct: 0 }).rotateAtContextPct, 0);
  });

  /**
   * Above the runtime's own compaction point the threshold can never be
   * reached, because compaction is what it exists to pre-empt.
   */
  test('a threshold too high to ever fire is clamped to one that can', () => {
    assert.equal(readPolicy({ rotateAtContextPct: 99 }).rotateAtContextPct, 90);
  });
});

describe('where a toolchain is told to put its cache', () => {
  /**
   * $HOME in the container is a 256M tmpfs that is also the CLI's session
   * store. A cache left on its default fills it, and what breaks is not the
   * build — it is every resume after it, silently.
   */
  test('nothing is left pointing at $HOME', () => {
    const env = cacheEnv('/data/companies/acme/scratch/cache');
    assert.ok(Object.values(env).length > 0);
    for (const [k, v] of Object.entries(env)) {
      assert.ok(v.startsWith('/data/companies/acme/scratch/cache'), `${k} escaped: ${v}`);
    }
  });

  test('the languages this company was told it may choose are covered', () => {
    // The charter says language is their call, so npm alone is not an answer.
    const env = cacheEnv('/cache');
    for (const k of ['npm_config_cache', 'GOMODCACHE', 'GOCACHE', 'CARGO_HOME', 'XDG_CACHE_HOME']) {
      assert.ok(k in env, `nothing set for ${k}`);
    }
  });

  test('caches are per company, like everything else a company touches', () => {
    assert.notEqual(cacheEnv('/a/scratch/cache')['npm_config_cache'],
                    cacheEnv('/b/scratch/cache')['npm_config_cache']);
  });
});
