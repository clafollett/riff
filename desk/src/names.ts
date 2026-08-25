import type { State } from './api';

/**
 * Ids address, names read.
 *
 * Only the Staff view used display names; everywhere else showed the raw id,
 * so the console said "dude" and "bede" about people the company itself calls
 * Dude and Bede. An id is a filesystem handle and a tool argument — it has no
 * business being the thing a person reads.
 */
const SYSTEM: Record<string, string> = {
  company: 'The company',
  board: 'The board',
  system: 'The company',
  // Events already written cannot be renamed, and 'inn' is two renames stale.
  // Translating on the way out beats rewriting history.
  inn: 'The company',
};

export const namer = (state: State | null): ((id: string | null | undefined) => string) => {
  const map = new Map((state?.agents ?? []).map((a) => [a.id, a.name]));
  return (id) => {
    if (!id) return '—';
    // A departed colleague is still someone; fall back to the id rather than
    // showing nothing, so history stays readable after someone leaves.
    return map.get(id) ?? SYSTEM[id] ?? id;
  };
};
