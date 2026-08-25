/**
 * A deliberately small Markdown renderer.
 *
 * Everything here was written by an agent, so the first thing that happens to
 * any input is HTML escaping — the formatting pass only ever runs over text
 * that can no longer become markup. Adding a feature means adding it AFTER
 * that escape, never before it.
 */
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const inline = (s: string): string =>
  s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])_([^_]+)_(?=[\s.,;:)!?]|$)/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<span class="link">$1</span> <span class="href">$2</span>');

export const render = (src: string): string => {
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let fence = false;
  let code: string[] = [];

  /**
   * Everyone here hard-wraps their prose at about eighty columns, so a single
   * paragraph arrives as five or six source lines. Emitting one <p> per line
   * turned every sentence into a stack of fragments separated by paragraph
   * gaps — which reads as absurdly tall line spacing, because that is exactly
   * what it is. Consecutive lines accumulate here and flush as one block.
   */
  let buf: string[] = [];
  let mode: 'p' | 'li' | 'quote' | null = null;

  const flush = () => {
    if (!buf.length) { mode = null; return; }
    const text = buf.join(' ').trim();
    const single = buf.length === 1;
    buf = [];
    const m = mode;
    mode = null;
    if (!text) return;
    if (m === 'li') { out.push(`<li>${inline(text)}</li>`); return; }
    if (m === 'quote') { out.push(`<blockquote>${inline(text)}</blockquote>`); return; }
    // A line that is only a `key: value` pair reads as a field, not a sentence
    // — but only when it stood alone, never when it opened a wrapped paragraph.
    const kv = single ? /^([A-Za-z][\w .-]{0,40}):\s+(.+)$/.exec(text) : null;
    if (kv) { out.push(`<p class="kv"><b>${kv[1]!}</b> ${inline(kv[2]!)}</p>`); return; }
    out.push(`<p>${inline(text)}</p>`);
  };

  const closeList = () => { flush(); if (list) { out.push(`</${list}>`); list = null; } };
  const openList = (kind: 'ul' | 'ol') => {
    flush();
    if (list !== kind) { if (list) out.push(`</${list}>`); out.push(`<${kind}>`); list = kind; }
  };

  for (const line of esc(src).split('\n')) {
    if (/^\s*```/.test(line)) {
      if (fence) { out.push(`<pre>${code.join('\n')}</pre>`); code = []; }
      else closeList();
      fence = !fence;
      continue;
    }
    if (fence) { code.push(line); continue; }

    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) { closeList(); out.push(`<h${h[1]!.length}>${inline(h[2]!)}</h${h[1]!.length}>`); continue; }

    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { closeList(); out.push('<hr>'); continue; }

    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (ul) { openList('ul'); mode = 'li'; buf = [ul[1]!]; continue; }

    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ol) { openList('ol'); mode = 'li'; buf = [ol[1]!]; continue; }

    const qt = /^\s*&gt;\s?(.*)$/.exec(line);
    if (qt) {
      if (mode !== 'quote') { closeList(); mode = 'quote'; }
      buf.push(qt[1]!);
      continue;
    }

    if (!line.trim()) { closeList(); continue; }

    // A plain line continues whatever is open — a wrapped bullet, a wrapped
    // quote, or a wrapped paragraph.
    if (mode === null) mode = 'p';
    buf.push(line.trim());
  }
  if (fence && code.length) out.push(`<pre>${code.join('\n')}</pre>`);
  closeList();
  return out.join('\n');
};
