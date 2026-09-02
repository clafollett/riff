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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(join(root, 'package.json'));

process.argv = [process.argv[0], 'vue-tsc', '--noEmit', '-p', join(root, 'desk/tsconfig.json')];
require('vue-tsc').run(require.resolve('ts5/lib/tsc.js'));
