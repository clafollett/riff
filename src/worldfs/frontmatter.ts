/**
 * A deliberately small frontmatter reader.
 *
 * These files are written BY the staff, so parsing has to be total: a director
 * fumbling its YAML must not crash the indexer and take the village down.
 * Reading therefore never throws — anything it cannot confidently interpret
 * stays a string. Writing is strict, because that side we control.
 *
 * Not a YAML implementation and not trying to be. Scalars, simple arrays,
 * that is the contract.
 */

export type Frontmatter = Record<string, string | number | boolean | string[]>;

export type Doc = {
  data: Frontmatter;
  body: string;
};

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

const scalar = (raw: string): string | number | boolean => {
  const v = raw.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  if (v === 'true') return true;
  if (v === 'false') return false;
  // Only treat as a number when it round-trips exactly. '2026-08-24' and
  // '007' must stay strings or dates and ids quietly corrupt.
  if (v !== '' && String(Number(v)) === v) return Number(v);
  return v;
};

export const parse = (raw: string): Doc => {
  const m = FENCE.exec(raw);
  if (!m) return { data: {}, body: raw };

  const data: Frontmatter = {};
  for (const line of (m[1] ?? '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf(':');
    if (idx === -1) continue; // not a pair — ignore rather than guess
    const key = trimmed.slice(0, idx).trim();
    const rest = trimmed.slice(idx + 1).trim();
    if (!key) continue;

    if (rest.startsWith('[') && rest.endsWith(']')) {
      const inner = rest.slice(1, -1).trim();
      data[key] = inner === '' ? [] : inner.split(',').map((s) => String(scalar(s)));
    } else {
      data[key] = scalar(rest);
    }
  }
  return { data, body: raw.slice(m[0].length) };
};

const emit = (v: Frontmatter[string]): string => {
  if (Array.isArray(v)) return `[${v.join(', ')}]`;
  if (typeof v === 'string') {
    // Quote anything that would otherwise re-read as a different type.
    const needsQuotes = v === '' || v !== v.trim() || /^[[\]{}#&*!|>'"%@`]/.test(v)
      || v === 'true' || v === 'false' || String(Number(v)) === v;
    return needsQuotes ? JSON.stringify(v) : v;
  }
  return String(v);
};

export const stringify = (doc: Doc): string => {
  const keys = Object.keys(doc.data);
  if (keys.length === 0) return doc.body;
  const lines = keys.map((k) => `${k}: ${emit(doc.data[k]!)}`);
  return `---\n${lines.join('\n')}\n---\n${doc.body}`;
};

/** Read a frontmatter field as a string, or null when absent/wrong-typed. */
export const field = (d: Frontmatter, key: string): string | null => {
  const v = d[key];
  if (v == null || Array.isArray(v)) return null;
  return String(v);
};
