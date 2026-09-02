import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A document drifts away from the code it describes unless something makes it
 * fail. This checks the claims the README makes that are worth making — the
 * ones that are arguments about the design rather than tallies of things that
 * grow every week. Tallies belong in neither: the test counts that used to sit
 * here went stale three times in one session and were removed rather than
 * automated.
 */
const root = dirname(dirname(fileURLToPath(import.meta.url)));

const readme = readFileSync(join(root, 'README.md'), 'utf8');
const contributing = readFileSync(join(root, 'CONTRIBUTING.md'), 'utf8');

describe('the README describes this repository, and not a previous one', () => {
  // Four runtime dependencies is an argument the README makes, not a tally it
  // reports, so it is worth being told the moment a fifth arrives rather than
  // reading the sentence again a year later. Counts of things that grow every
  // week are not claims worth writing down at all — they were in this README,
  // went stale three times in one session, and are gone.
  test('it names every runtime dependency, and there are no others', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as
      { dependencies: Record<string, string> };
    const real = Object.keys(pkg.dependencies);
    assert.equal(real.length, 4, `runtime dependencies are now: ${real.join(', ')}`);
    for (const [dep, called] of [
      ['@anthropic-ai/claude-agent-sdk', 'Agent SDK'],
      ['zod', '`zod`'],
      ['markdown-it', '`markdown-it`'],
      ['vue', 'Vue'],
    ] as const) {
      assert.ok(real.includes(dep), `${dep} is no longer a dependency`);
      assert.ok(readme.includes(called), `the README stopped naming ${dep}`);
    }
    // CONTRIBUTING.md argues the same four, and is where the rule that gates a
    // fifth actually lives. Three documents making one claim is three places
    // for it to stop being true.
    assert.ok(/There are four\b/.test(contributing),
      'CONTRIBUTING.md no longer says how many runtime dependencies there are');
  });
});
