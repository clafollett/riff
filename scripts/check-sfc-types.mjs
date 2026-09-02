/**
 * Typecheck the console, `.vue` files included.
 *
 * tsgo does not parse single-file components, and it cannot: TypeScript 7's
 * `tsc` is a launcher that hands off to a Go binary, so the JavaScript compiler
 * internals vue-tsc patches to teach it about `.vue` are simply not there. The
 * peer range says `typescript >= 5.0.0` and TS 7 satisfies it, which makes this
 * look workable right up until `typescript/lib/tsc` fails to resolve.
 *
 * So the SFCs are checked against their own TypeScript. It is a second copy of
 * the compiler and it is only ever used here — the repo's own sources are
 * checked by tsgo, which stays the source of truth on a disagreement. Both it
 * and vue-tsc are pinned exactly: a sidecar exists to be stable rather than
 * current, and a floating second opinion can only ever disagree by surprise.
 *
 * `desk/tsconfig.json` includes the components alongside the `.ts` files, so
 * this walks every one on disk rather than only those something already
 * imports; tsgo ignores them. Without that, a component nobody has wired up
 * yet goes unchecked — which is exactly when it is most likely to be broken.
 */
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'package.json'));

/**
 * The console reaches into `src/` for exactly one thing: the declared shape of
 * what the server answers with. That reach has to stay type-only, and nothing
 * else in the toolchain will say so — a value import of the same path
 * typechecks, and vite externalises the node builtins under it with a warning
 * in a build that exits 0. The console then ships a module that dies in the
 * browser.
 *
 * The bare `import type` form is required rather than inline `{ type X }`,
 * which leaves a real module edge in the graph even when every binding is
 * erased.
 */
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p)
    : /\.(ts|vue)$/.test(p) ? [p] : [];
});

const crossings = [];
for (const file of walk(join(root, 'desk/src'))) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!/from\s+'(\.\.\/)+src\//.test(line)) return;
    if (/^\s*import type\s/.test(line)) return;
    crossings.push(`${file.slice(root.length + 1)}:${i + 1}: ${line.trim()}`);
  });
}

if (crossings.length) {
  console.error('the console may only reach into src/ with a bare `import type`:\n'
    + crossings.join('\n'));
  process.exit(1);
}

process.argv = [process.argv[0], 'vue-tsc', '--noEmit', '-p', join(root, 'desk/tsconfig.json')];
require('vue-tsc').run(require.resolve('ts5/lib/tsc.js'));
