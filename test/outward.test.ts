import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { outwardState } from '../src/runtime/staff.ts';
import type { TickDeps } from '../src/runtime/staff.ts';

/**
 * A company with no connector wrote to a stranger claiming its work was
 * public, on the strength of an approval. What staff may honestly claim
 * depends on how work physically leaves, so that is configuration rather
 * than a sentence in a brief a session can talk itself out of.
 */
const state = (over: Partial<TickDeps>): string => outwardState(over as TickDeps);

describe('what staff are told about getting work out', () => {
  test('with no connector and no release route, nothing leaves and nothing is public', () => {
    const s = state({});
    assert.match(s, /There is no connected channel/);
    assert.match(s, /An approved draft is APPROVED, not SENT/);
  });

  test('a bundle route gives them somewhere to build to', () => {
    const s = state({ release: 'bundle' });
    assert.match(s, /the board collects releases by hand/);
    assert.match(s, /dist\//);
    assert.doesNotMatch(s, /An approved draft is APPROVED, not SENT/);
  });

  test('a bundle route still forbids calling the work published', () => {
    const s = state({ release: 'bundle' });
    assert.match(s, /Do not describe our work[\s\S]*as public, published or citable/);
    assert.match(s, /Until the board says it went out, it has not/);
  });

  test('a live connector outranks the bundle route', () => {
    const s = state({
      release: 'bundle',
      connectors: { blog: { type: 'http', url: 'https://example.invalid' } },
    });
    assert.match(s, /Connected channels: blog/);
    assert.doesNotMatch(s, /collects releases by hand/);
  });
});
