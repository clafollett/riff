import { randomBytes } from 'node:crypto';

/**
 * Sortable, readable ids: `evt_01k2m9x4_7f3a9c2b1d`.
 * Time prefix so a raw `ORDER BY id` in sqlite3 still reads chronologically
 * when you are poking at the db by hand at 2am.
 *
 * Five random bytes, not three. The prefix only separates ids that fall in
 * different milliseconds, so everything written inside one is riding on the
 * random half alone — and three bytes is 16.7M values, which is a coin flip
 * at about 4,800 ids. A test on a frozen clock, where every id shares one
 * prefix, hit `UNIQUE constraint failed: events.id` intermittently.
 */
export const newId = (prefix: string, now: Date = new Date()): string =>
  `${prefix}_${now.getTime().toString(36)}_${randomBytes(5).toString('hex')}`;

/** Stable, filesystem-safe slug. Staff names become directory names. */
export const slug = (s: string): string =>
  s.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
