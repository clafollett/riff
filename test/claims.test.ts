import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The README states how many tests there are. That number went stale three
 * times in the session that added this file — each time in a commit whose own
 * message quoted the correct figure, which is how little attention a
 * hand-maintained count survives.
 *
 * The house rule is that a claim in a document has to be checkable. A count
 * nothing counts is not a claim, it is a decoration that was true once, and
 * this repo has exactly one defence against a document drifting away from the
 * code it describes: making the document fail the build.
 */
const root = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * Declarations, counted where they are written rather than where they run.
 * `node --test` would give the true figure, but a test suite cannot run itself
 * to find out how big it is. The two agree today, and this test failing
 * because they stopped agreeing is a useful thing to be told.
 */
const declared = (dir: string, suffix: string): number => {
  const files = readdirSync(join(root, dir)).filter((f) => f.endsWith(suffix));
  return files.reduce((n, f) => {
    const body = readFileSync(join(root, dir, f), 'utf8');
    return n + (body.match(/^[ \t]*test\(/gm)?.length ?? 0);
  }, 0);
};

const readme = readFileSync(join(root, 'README.md'), 'utf8');

/** The figure the README gives, or null when it has stopped giving one. */
const claimed = (pattern: RegExp): number | null => {
  const m = pattern.exec(readme);
  return m?.[1] == null ? null : Number(m[1]);
};

describe('the README describes this repository, and not a previous one', () => {
  test('it says how many unit tests there are, and is right', () => {
    const said = claimed(/\|\s*`npm test`\s*\|\s*(\d+) unit tests/);
    assert.notEqual(said, null, 'the README no longer states a unit test count');
    assert.equal(said, declared('test', '.test.ts'));
  });

  test('it says how many browser tests there are, and is right', () => {
    const said = claimed(/\|\s*`npm run test:ui`\s*\|\s*(\d+) Playwright tests/);
    assert.notEqual(said, null, 'the README no longer states a Playwright test count');
    assert.equal(said, declared('e2e', '.spec.ts'));
  });

  // Four runtime dependencies is an argument the README makes, not an
  // observation it reports — so it is worth being told the moment a fifth
  // arrives, rather than reading the sentence again a year later.
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
  });
});
