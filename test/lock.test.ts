import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

/**
 * One writer per installation.
 *
 * The host and the container mount the same ~/.riff on purpose. Two
 * servers on it is not a conflicting file — it is two schedulers waking the
 * same staff, doubling the spend, committing to one git repository from two
 * sessions, and writing both their accounts into one ledger.
 *
 * This module existed and was correct for a while before anything called it,
 * which is the reason for the first test here: a lock nothing takes is a
 * comment.
 */
const cwd = process.cwd();

let home: string;
let root: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'riff-lock-'));
  root = join(home, '.riff');
  mkdirSync(root, { recursive: true });
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const env = () => ({ ...process.env, HOME: home, RIFF_ROOT: root, RIFF_COMPANY_ID: '' });

/** Take the lock in a child, report what happened, and let go. */
const attempt = (): { ok: boolean; message: string } => {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const { takeInstallationLock } = await import('${cwd}/src/core/lock.ts');
    const { isOperatorError } = await import('${cwd}/src/core/config.ts');
    try { takeInstallationLock(); console.log('TOOK'); }
    catch (e) { console.log(isOperatorError(e) ? 'REFUSED ' + e.message : 'THREW ' + e); }
  `], { encoding: 'utf8', env: env(), cwd });
  const out = r.stdout.trim();
  return { ok: out.startsWith('TOOK'), message: out };
};

const writeLock = (beatAgeMs: number, host = 'another-machine') =>
  writeFileSync(join(root, '.lock'), JSON.stringify({
    pid: 99999, host, where: 'a container',
    startedAt: new Date(Date.now() - beatAgeMs).toISOString(),
    beat: Date.now() - beatAgeMs,
  }));

describe('one writer per installation', () => {
  test('the server actually takes it — a lock nothing calls is a comment', () => {
    // This is the whole reason the file exists, and for a while nothing did.
    const server = readFileSync(join(cwd, 'src/gateway/server.ts'), 'utf8');
    assert.match(server, /takeInstallationLock\(\)/,
      'src/gateway/server.ts must take the installation lock');
    assert.match(server, /lock\.release\(\)/,
      'and must let go of it, or the next start is refused by a dead process');
  });

  test('a free installation is taken, and recorded so a person can act on it', () => {
    assert.equal(attempt().ok, true);
    const held = JSON.parse(readFileSync(join(root, '.lock'), 'utf8')) as Record<string, unknown>;
    // The message a second process prints is built from these, so they have to
    // say WHERE, not just that something holds it.
    assert.ok(held['host'], 'the lock should record which machine holds it');
    assert.ok(held['where'], 'and whether that is a container or the host');
    assert.ok(Number(held['beat']) > 0, 'and a heartbeat, which is what liveness means here');
  });

  test('a live lock is refused, with a message that names the other one', () => {
    writeLock(0);
    const { ok, message } = attempt();
    assert.equal(ok, false);
    assert.match(message, /Another Riff is already running/);
    assert.match(message, /another-machine/, 'say which machine');
    assert.match(message, /a container/, 'and where, since that is what you act on');
  });

  test('a lock whose heartbeat stopped is taken over', () => {
    // Liveness is a heartbeat rather than a pid, because a container's pid 7
    // says nothing about the host. A SIGKILLed server leaves its lock behind
    // and must not wedge the installation forever.
    writeLock(60_000);
    assert.equal(attempt().ok, true, 'a stale lock must not block a restart');
  });

  test('a corrupt lock file does not wedge the installation', () => {
    writeFileSync(join(root, '.lock'), 'not json at all');
    assert.equal(attempt().ok, true);
  });

  test('releasing only ever removes your own', () => {
    // A slow shutdown must not delete the lock of whoever legitimately took
    // over after it went stale.
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', `
      const { takeInstallationLock } = await import('${cwd}/src/core/lock.ts');
      const { writeFileSync, existsSync } = await import('node:fs');
      const mine = takeInstallationLock();
      // Somebody else takes over while we are shutting down.
      writeFileSync('${join(root, '.lock')}', JSON.stringify({
        pid: 4242, host: 'the-one-that-took-over', where: 'a container',
        startedAt: new Date().toISOString(), beat: Date.now(),
      }));
      mine.release();
      console.log(existsSync('${join(root, '.lock')}') ? 'KEPT' : 'DELETED');
    `], { encoding: 'utf8', env: env(), cwd }).trim();
    assert.equal(out, 'KEPT', "release() deleted someone else's lock");
  });
});
