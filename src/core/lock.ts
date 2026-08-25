import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { installRoot, operatorError } from './config.ts';

/**
 * One writer per installation.
 *
 * The host and the container mount the same ~/.helmsted, which is the point —
 * a company founded one way is there the other way. But two servers on it
 * means two schedulers waking the same agents: doubled token spend, two
 * sessions writing one git repository, and a ledger taking both their words
 * for what happened.
 *
 * Liveness is a heartbeat rather than a pid, because pids are not comparable
 * across a container boundary — the container's pid 7 says nothing about the
 * host. A lock whose heartbeat has stopped is stale and may be taken.
 */
const BEAT_MS = 10_000;
const STALE_MS = BEAT_MS * 3;

type Held = { pid: number; host: string; where: string; startedAt: string; beat: number };

const lockPath = (): string => join(installRoot(), '.lock');

const read = (path: string): Held | null => {
  try { return JSON.parse(readFileSync(path, 'utf8')) as Held; }
  catch { return null; }
};

/** Where this process is running, for a message the reader can act on. */
const whereAmI = (): string =>
  existsSync('/.dockerenv') || existsSync('/run/.containerenv') ? 'a container' : 'this machine';

export type Lock = { release: () => void };

export const takeInstallationLock = (): Lock => {
  const path = lockPath();
  mkdirSync(installRoot(), { recursive: true });

  const held = read(path);
  const age = held ? Date.now() - held.beat : Infinity;
  if (held && age < STALE_MS) {
    throw operatorError(
      `Another Helmsted is already running against ${installRoot()}.\n` +
      `  Started ${held.startedAt} on ${held.host}, in ${held.where}.\n` +
      `  Two servers here would wake every agent twice — stop that one first.`,
    );
  }

  const mine: Held = {
    pid: process.pid, host: hostname(), where: whereAmI(),
    startedAt: new Date().toISOString(), beat: Date.now(),
  };
  writeFileSync(path, JSON.stringify(mine, null, 2) + '\n', 'utf8');

  const timer = setInterval(() => {
    try { writeFileSync(path, JSON.stringify({ ...mine, beat: Date.now() }, null, 2) + '\n', 'utf8'); }
    catch { /* the directory went away; nothing useful to do */ }
  }, BEAT_MS);
  timer.unref();

  return {
    release: () => {
      clearInterval(timer);
      // Only ever remove our own lock — a slow shutdown must not delete the
      // lock of whoever legitimately took over after we went stale.
      const now = read(path);
      if (now?.pid === mine.pid && now.host === mine.host) {
        try { unlinkSync(path); } catch { /* already gone */ }
      }
    },
  };
};
