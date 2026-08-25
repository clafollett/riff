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

  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  const openList = (kind: 'ul' | 'ol') => { if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; } };

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
    if (ul) { openList('ul'); out.push(`<li>${inline(ul[1]!)}</li>`); continue; }

    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ol) { openList('ol'); out.push(`<li>${inline(ol[1]!)}</li>`); continue; }

    const qt = /^\s*&gt;\s?(.*)$/.exec(line);
    if (qt) { closeList(); out.push(`<blockquote>${inline(qt[1]!)}</blockquote>`); continue; }

    if (!line.trim()) { closeList(); continue; }

    // A line that is only a `key: value` pair reads as a field, not a sentence.
    const kv = /^([A-Za-z][\w .-]{0,40}):\s+(.+)$/.exec(line);
    if (kv && !list) { out.push(`<p class="kv"><b>${kv[1]!}</b> ${inline(kv[2]!)}</p>`); continue; }

    out.push(`<p>${inline(line)}</p>`);
  }
  if (fence && code.length) out.push(`<pre>${code.join('\n')}</pre>`);
  closeList();
  return out.join('\n');
};
