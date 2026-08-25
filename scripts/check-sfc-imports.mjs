/**
 * Single-file components are not typechecked — tsgo does not parse .vue, and
 * vue-tsc rides on TypeScript 5 internals the Go compiler does not ship. So a
 * composition API call with no matching import compiles fine and throws at
 * setup, rendering nothing at all. That is exactly how the Envelope went blank.
 *
 * This is the cheapest possible guard against that one failure, which is the
 * only one that has actually happened.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const API = ['computed', 'ref', 'shallowRef', 'reactive', 'watch', 'watchEffect',
  'onMounted', 'onUnmounted', 'onBeforeUnmount', 'nextTick', 'provide', 'inject'];

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.vue') ? [p] : [];
});

const problems = [];
for (const file of walk('desk/src')) {
  const src = readFileSync(file, 'utf8');
  const m = /^import \{([^}]*)\} from 'vue';/m.exec(src);
  const imported = new Set((m?.[1] ?? '').split(',').map((s) => s.trim()));
  for (const api of API) {
    if (new RegExp(`(^|[^.\\w])${api}\\(`, 'm').test(src) && !imported.has(api)) {
      problems.push(`${file}: uses ${api}() without importing it from 'vue'`);
    }
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
