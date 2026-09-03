import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Pausing a company killed whoever was mid-shift.
 *
 * `stop()` aborts the controller the SDK is holding, so the shift dies where
 * it stands and the ledger records `Claude Code process aborted by user` —
 * three of those in Fathom's log on 2026-09-03 are the operator pressing
 * Pause, not anything going wrong. up.sh called that same endpoint before a
 * rebuild under the comment "so its shift is not killed by the rebuild", and
 * then waited for shifts it had already killed.
 *
 * Draining is the version that waits: stop waking anybody, leave the abort
 * alone, and let the shifts in flight write their journals.
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

describe('a drain waits for the shift; a pause kills it', () => {
  test('draining does not touch the abort controller the SDK is holding', () => {
    const src = read('src/runtime/scheduler.ts');
    assert.match(src, /if \(!opts\?\.drain\) this\.#abort\.abort\(\);/,
      'an unconditional abort is the shift-killing pause');
    // Both paths still wait. Returning early lets the caller close the ledger
    // under a live shift, which crashes it on its closing agent.slept.
    assert.match(src, /if \(this\.#flights\.size\) await Promise\.allSettled/);
  });

  test('a drain overtaken by Start does not announce a pause that did not happen', () => {
    // The operator waits out a long shift, changes their mind, presses Start.
    // work.paused would then land after the work.started that is now true.
    assert.match(read('src/runtime/scheduler.ts'), /if \(wasRunning && !this\.#running\)/);
  });

  test('the company reports draining, which is neither running nor paused', () => {
    assert.match(read('src/runtime/scheduler.ts'), /get draining\(\): boolean/);
    assert.match(read('src/company/registry.ts'), /draining: open\?\.scheduler\.draining \?\? false/);
    assert.match(read('src/gateway/server.ts'), /draining: scheduler\.draining/);
  });

  test('the request answers at once instead of holding open for a whole shift', () => {
    // A 30-turn shift runs for minutes. A POST held that long is a POST that
    // times out somewhere between the console and the server.
    assert.match(read('src/company/registry.ts'),
      /void c\.scheduler\.stop\(\{ drain: true \}\)/);
  });

  test('the immediate pause stays the default, so existing callers still mean it', () => {
    const src = read('src/gateway/server.ts');
    assert.match(src, /const drain = !run && b\['drain'\] === true;/,
      'drain must be asked for, and only makes sense when stopping');
  });

  test('up.sh asks for the drain it says it wants', () => {
    const sh = read('docker/up.sh');
    assert.match(sh, /"running":false,"drain":true/,
      'without this the rebuild guard is the thing that kills the shift');
    // And it still waits, because the endpoint now returns before the shifts do.
    assert.match(sh, /waiting for shifts to finish/);
  });

  test('the console offers both, and says which is which', () => {
    const vue = read('desk/src/views/Companies.vue');
    assert.match(vue, /setRunning\(c, false, true\)/, 'Pause drains');
    assert.match(vue, /Stop now/, 'and a kill is still reachable while it drains');
    assert.match(vue, /setRunning\(c, false\)"/, 'which is the abort, not a second drain');
    assert.match(vue, /finishing \$\{c\.awake\.length\}/, 'the state says the shifts are landing');
  });

  test('a company mid-drain cannot be handed a deadline for a run it is ending', () => {
    assert.match(read('desk/src/views/Companies.vue'), /v-if="!c\.running && !c\.draining"/);
  });
});
