import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A scoped style still reaches a child component's root element.
 *
 * Vue stamps the parent's scope attribute on the root node of every child it
 * renders, so `.bar { height: 5px; overflow: hidden }` written for the Commons
 * gauge also matched <Toolbar>'s own `<div class="bar">` and clipped the whole
 * filter-and-sort row to a five-pixel sliver. Two more views had kept a `.bar`
 * rule from before Toolbar was extracted, and both were silently re-spacing
 * it — the one thing Toolbar exists to prevent.
 *
 * Nothing in the type check or the browser suite sees this: the markup is
 * valid, the component mounts, the test clicks a chip it cannot see.
 */
const DESK = new URL('../desk/', import.meta.url).pathname;

/** Every .vue file under desk/src, with its path. */
const sfcs = (dir: string): Array<{ path: string; src: string }> => {
  const out: Array<{ path: string; src: string }> = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sfcs(p));
    else if (e.name.endsWith('.vue')) out.push({ path: p, src: readFileSync(p, 'utf8') });
  }
  return out;
};

/** The class on a component's outermost element — the one a parent can reach. */
const rootClass = (src: string): string | null => {
  const tpl = src.slice(src.indexOf('<template>') + 10, src.lastIndexOf('</template>'));
  return tpl.trim().match(/^<[a-zA-Z][\w-]*[^>]*?\sclass="([a-z][\w-]*)/)?.[1] ?? null;
};

/** Class selectors this file's own <style scoped> block defines. */
const scopedClasses = (src: string): Set<string> => {
  const at = src.indexOf('<style scoped>');
  if (at < 0) return new Set();
  const css = src.slice(at, src.lastIndexOf('</style>'));
  return new Set([...css.matchAll(/^\.([a-z][\w-]*)\s*(?:,|\{)/gm)].map((m) => m[1]!));
};

describe('a view cannot restyle a shared component by naming its root class', () => {
  const files = sfcs(join(DESK, 'src'));
  const shared = files.filter((f) => !f.path.includes('/views/'));

  test('the desk has components to check, so a broken walk cannot pass silently', () => {
    assert.ok(files.length >= 10, `expected the desk's SFCs, found ${files.length}`);
    assert.ok(shared.some((f) => f.path.endsWith('Toolbar.vue')), 'Toolbar is the one that broke');
  });

  test('no view defines a rule matching the root of a component it mounts', () => {
    const roots = new Map<string, string>();
    for (const f of shared) {
      const c = rootClass(f.src);
      if (c) roots.set(c, f.path.slice(f.path.indexOf('desk/')));
    }
    assert.ok(roots.size > 0, 'no component roots found — the parser is wrong, not the desk');

    const clashes: string[] = [];
    for (const f of files) {
      const mine = f.path.slice(f.path.indexOf('desk/'));
      for (const c of scopedClasses(f.src)) {
        const owner = roots.get(c);
        // A component may of course style its own root.
        if (owner && owner !== mine) clashes.push(`${mine} defines .${c}, the root of ${owner}`);
      }
    }
    assert.deepEqual(clashes, [], clashes.join('\n'));
  });

  test('Toolbar keeps a root name a view has no reason to reach for', () => {
    const bar = shared.find((f) => f.path.endsWith('Toolbar.vue'))!;
    assert.equal(rootClass(bar.src), 'toolbar',
      'a generic root class is how the filter row got clipped to five pixels');
  });
});
