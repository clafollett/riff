import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The container's environment is a contract with src/core/config.ts, and
 * nothing was checking it.
 *
 * It had already rotted: the Dockerfile set HELMSTED_HOME=/world from the
 * single-company era, so under the current resolver every company would have
 * been written to the container's own filesystem instead of the mounted
 * volume — and destroyed, silently, on the next restart. These tests are the
 * cheapest thing that would have caught that.
 */
const dockerfile = readFileSync('docker/Dockerfile', 'utf8');
const compose = readFileSync('docker/compose.yaml', 'utf8');
const entrypoint = readFileSync('docker/entrypoint.sh', 'utf8');

/** Every source file, so "does anything read this?" is answered honestly. */
const allSource = ((): string => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
  return walk('src').map((p) => readFileSync(p, 'utf8')).join('\n');
})();

/** The mount target the factory writes to, read from compose. */
const MOUNT = '/data';

/**
 * One service block from compose.
 *
 * Sliced to the NEXT key at service indentation, not to a named one: slicing
 * factory-to-egress silently swallowed the ingress service when it was added
 * between them, and the assertions then described the wrong container.
 * Matching on a bare name is wrong too — 'egress:' also appears inside
 * http://egress:8888.
 */
const service = (name: string): string => {
  const start = compose.indexOf(`\n  ${name}:`);
  assert.ok(start >= 0, `compose must declare a ${name} service`);
  const rest = compose.slice(start + 1);
  const next = /\n {2}[a-z][a-z0-9_-]*:\n/.exec(rest.slice(name.length + 3));
  return next ? rest.slice(0, name.length + 3 + next.index) : rest;
};

const factoryBlock = service('factory');

describe('the container writes where the volume is', () => {
  test('the installation root is set, and set to the mount', () => {
    const m = /HELMSTED_ROOT=(\S+)/.exec(dockerfile);
    assert.ok(m, 'the Dockerfile must set HELMSTED_ROOT');
    assert.ok(m[1]!.startsWith(MOUNT),
      `HELMSTED_ROOT is ${m[1]} — anything outside ${MOUNT} is lost on restart`);
  });

  test('compose agrees with the image about where that is', () => {
    assert.match(compose, /HELMSTED_ROOT:\s*\/data/);
    assert.match(compose, new RegExp(`:${MOUNT}\\b`), 'the volume must be mounted at the root');
  });

  test('the data path is the operator\'s, not root\'s', () => {
    // Compose interpolates ${HOME} client-side, in the process that runs the
    // command — so it is the invoking user's home, never the daemon's.
    assert.match(compose, /\$\{HELMSTED_DATA:-\$\{HOME\}\/helmsted-data\}/);
  });

  test('it checks it can write the mount before doing anything', () => {
    // Docker Desktop maps bind-mount ownership; a rootful Linux daemon does
    // not, and the container's uid then cannot create anything. Unchecked,
    // that surfaces as a confusing crash deep inside a git call.
    assert.match(entrypoint, /touch \/data/);
    assert.match(entrypoint, /Cannot write to \/data/);
    assert.match(entrypoint, /chown/, 'the failure must carry its own fix');
  });

  test('the entrypoint refuses to start if the root escapes the mount', () => {
    // Belt and braces: if someone overrides it at run time, fail loudly rather
    // than writing a whole company somewhere it will not survive.
    assert.match(entrypoint, /HELMSTED_ROOT/);
    assert.match(entrypoint, /exit 1/);
  });

  test('the single-company variable is gone from the image', () => {
    // HELMSTED_HOME means "one company lives here". Setting it installation-wide
    // is what broke this.
    assert.ok(!/ENV[\s\S]*HELMSTED_HOME=/.test(dockerfile), 'HELMSTED_HOME must not be set image-wide');
  });
});

describe('the container only sets variables the code reads', () => {
  test('every HELMSTED_* it sets is one config.ts looks up', () => {
    const set = new Set<string>();
    for (const src of [dockerfile, compose]) {
      for (const m of src.matchAll(/\b(HELMSTED_[A-Z_]+)\b/g)) set.add(m[1]!);
    }
    // Consumed by compose itself, before the container exists.
    const composeOnly = new Set(['HELMSTED_DATA']);
    for (const name of set) {
      if (composeOnly.has(name)) continue;
      assert.ok(allSource.includes(`'${name}'`),
        `${name} is set for the container but nothing under src/ reads it`);
    }
  });
});

describe('the shell is only open inside the box', () => {
  test('the image declares itself contained', () => {
    assert.match(dockerfile, /HELMSTED_CONTAINED=1/);
  });

  test('and the runtime still demands a container marker as well', () => {
    // The variable alone must never be enough — a mistyped export on someone's
    // laptop would otherwise hand an agent a terminal.
    const perms = readFileSync('src/runtime/permissions.ts', 'utf8');
    assert.match(perms, /HELMSTED_CONTAINED/);
    assert.match(perms, /dockerenv|containerenv/);
  });
});

describe('what the factory can reach', () => {
  test('the console is carried out by a forwarder, not by the factory', () => {
    // A container on an internal network cannot publish a port — no gateway
    // means no ingress either, and Docker publishes nothing without saying so.
    assert.ok(!/ports:/.test(factoryBlock), 'the factory must not try to publish a port');
    const ingress = service('ingress');
    assert.match(ingress, /ports:\s*\['127\.0\.0\.1:/, 'ingress publishes on loopback only');
    assert.match(ingress, /networks:\s*\[walled, outside\]/);
    // It must stay a forwarder: no build context, no token, nothing to run.
    assert.ok(!ingress.includes('CLAUDE_CODE_OAUTH_TOKEN'), 'ingress must never see the token');
    assert.ok(!ingress.includes('build:'), 'ingress runs a stock image, not ours');
  });

  test('its network has no route off the machine', () => {
    assert.match(compose, /walled:\s*\n\s*internal:\s*true/);
    // The factory is on the walled network only; the proxy bridges out.
    assert.match(factoryBlock, /networks:\s*\[walled\]/);
    assert.ok(!factoryBlock.includes('outside'),
      'the factory must not be attached to the outside network');
  });

  test('the allowlist is anchored, so a lookalike host cannot pass', () => {
    // "github.com" unanchored also matches "github.com.evil.example".
    const compile = readFileSync('docker/proxy/compile-allowlist.sh', 'utf8');
    assert.match(compile, /\^%s\$/);
  });

  test('nothing is denied by default being off', () => {
    const conf = readFileSync('docker/proxy/tinyproxy.conf', 'utf8');
    assert.match(conf, /FilterDefaultDeny\s+Yes/);
  });

  test('the proxy writes nothing at start, so it can run read-only', () => {
    // It used to compile its own filter on every boot, which crash-looped
    // against a read-only filesystem — eight restarts before anyone noticed,
    // and a factory with no way out at all.
    const entry = readFileSync('docker/proxy/entrypoint.sh', 'utf8');
    assert.ok(!/>\s*\/etc|>>\s*\/etc|:\s*>\s*\/etc/.test(entry),
      'the proxy entrypoint must not write into /etc at run time');
    // The filter is baked in instead.
    assert.match(readFileSync('docker/proxy/Dockerfile', 'utf8'), /RUN[\s\S]*compile-allowlist\.sh/);
    const conf = readFileSync('docker/proxy/tinyproxy.conf', 'utf8');
    assert.match(conf, /LogFile\s+"\/dev\/stdout"/, 'logging to a file needs a writable disk');
  });

  test('the filesystem is read-only apart from the volume and scratch', () => {
    assert.match(factoryBlock, /read_only:\s*true/);
    assert.match(factoryBlock, /cap_drop:\s*\[ALL\]/);
    assert.match(factoryBlock, /no-new-privileges:true/);
  });
});
