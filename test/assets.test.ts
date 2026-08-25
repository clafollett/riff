import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { World } from '../src/worldfs/world.ts';
import { registerAsset, readManifest, isValidKey, assetsDir } from '../src/village/assets.ts';
import { fixedClock } from '../src/core/clock.ts';

let dir: string;
let world: World;
const clock = fixedClock('2026-08-24T18:00:00.000Z');
const put = (rel: string) => {
  const abs = join(assetsDir(world), rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, 'not really a png, but a real file');
  return abs;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'art-'));
  world = new World(join(dir, 'world'), clock);
  world.ensure();
  mkdirSync(assetsDir(world), { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('asset keys are structural, and validated rather than trusted', () => {
  test('accepts the shapes the renderer asks for', () => {
    for (const k of ['house/the-inn', 'staff/hollis/down', 'prop/oak', 'tile/grass']) {
      assert.equal(isValidKey(k), true, `${k} should be valid`);
    }
  });

  test('rejects traversal, junk and wrong facings', () => {
    for (const k of ['house/../../etc', 'staff/hollis/sideways', '../x', 'house/', 'HOUSE/The-Inn', '']) {
      assert.equal(isValidKey(k), false, `${k} should be rejected`);
    }
  });
});

describe('registering art', () => {
  test('hangs a real file inside assets/', () => {
    put('house-the-inn.png');
    const r = registerAsset(world, {
      key: 'house/the-inn', file: 'house-the-inn.png', w: 256, h: 192,
      by: 'ansel', at: clock.iso(), brief: 'a warm timber inn',
    });
    assert.equal(r.ok, true);
    assert.equal(readManifest(world).assets['house/the-inn']?.by, 'ansel');
  });

  test('refuses a file that does not exist yet', () => {
    const r = registerAsset(world, {
      key: 'house/the-vault', file: 'nope.png', w: 10, h: 10,
      by: 'ansel', at: clock.iso(), brief: '',
    });
    assert.equal(r.ok, false);
  });

  test('refuses a path escaping assets/', () => {
    writeFileSync(join(dir, 'outside.png'), 'x');
    const r = registerAsset(world, {
      key: 'house/the-vault', file: '../../outside.png', w: 10, h: 10,
      by: 'ansel', at: clock.iso(), brief: '',
    });
    assert.equal(r.ok, false);
    assert.match(r.ok === false ? r.reason : '', /inside assets/);
  });

  test('refuses a file type the browser would not treat as an image', () => {
    put('sneaky.html');
    const r = registerAsset(world, {
      key: 'prop/sneaky', file: 'sneaky.html', w: 10, h: 10,
      by: 'ansel', at: clock.iso(), brief: '',
    });
    assert.equal(r.ok, false);
  });

  test('refuses an invalid key even when the file is fine', () => {
    put('ok.png');
    const r = registerAsset(world, {
      key: 'house/../../../etc/passwd', file: 'ok.png', w: 10, h: 10,
      by: 'ansel', at: clock.iso(), brief: '',
    });
    assert.equal(r.ok, false);
  });

  test('a half-written manifest degrades instead of taking the village down', () => {
    writeFileSync(join(assetsDir(world), 'manifest.json'), '{ this is not json');
    assert.deepEqual(readManifest(world).assets, {});
    put('a.png');
    assert.equal(registerAsset(world, {
      key: 'prop/a', file: 'a.png', w: 1, h: 1, by: 'ansel', at: clock.iso(), brief: '',
    }).ok, true, 'must be able to recover by writing a fresh manifest');
  });
});
