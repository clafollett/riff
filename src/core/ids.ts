import { randomBytes } from 'node:crypto';

/**
 * Sortable, readable ids: `evt_01k2m9x4_7f3a`.
 * Time prefix so a raw `ORDER BY id` in sqlite3 still reads chronologically
 * when you are poking at the db by hand at 2am.
 */
export const newId = (prefix: string, now: Date = new Date()): string =>
  `${prefix}_${now.getTime().toString(36)}_${randomBytes(3).toString('hex')}`;

/** Stable, filesystem-safe slug. Staff names become directory names. */
export const slug = (s: string): string =>
  s.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
