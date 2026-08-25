import MarkdownIt, { type RendererRule } from 'markdown-it';

/**
 * Rendering for prose written by agents.
 *
 * This was a hand-rolled renderer and it kept being wrong — one <p> per source
 * line, then no tables. Agents write ordinary Markdown, including tables,
 * nested lists and reference links, so this is a real parser now.
 *
 * The safety property is unchanged and it is the reason for `html: false`:
 * raw HTML in the source is ESCAPED rather than passed through. Everything on
 * these pages was written by a model, so nothing it writes may become markup.
 * Turning `html` on would undo that in one character.
 */
const md = new MarkdownIt({
  html: false,        // agent markup renders as text — do not turn this on
  linkify: false,     // only explicit [text](url) becomes a link
  breaks: false,      // hard-wrapped prose joins into paragraphs
  typographer: true,
});

/**
 * Links open in a new tab and cannot reach back into this page.
 * markdown-it's own validateLink already refuses javascript:, vbscript: and
 * file: URLs; this covers what happens once a permitted link is followed.
 */
const openLink = md.renderer.rules.link_open;
const linkOpen: RendererRule = (tokens, idx, options, env, self) => {
  const t = tokens[idx]!;
  t.attrSet('target', '_blank');
  t.attrSet('rel', 'noopener noreferrer nofollow');
  return openLink ? openLink(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options);
};
md.renderer.rules.link_open = linkOpen;

/**
 * Agent prose is embedded INSIDE a page that already has its own heading, so
 * its top level is h2, not h1. Two consequences, both visible: the commons
 * reader was printing every document's title twice — once as the page heading
 * and again as the body's own `#` — and a page showing several messages ended
 * up with several h1s, which is a broken outline for anyone navigating by
 * headings.
 */
const openHeading = md.renderer.rules.heading_open;
const closeHeading = md.renderer.rules.heading_close;
const demote = (tag: string): string => {
  const level = Number(tag.slice(1));
  return `h${Math.min(6, level + 1)}`;
};
const shift: RendererRule = (tokens, idx, options, env, self) => {
  tokens[idx]!.tag = demote(tokens[idx]!.tag);
  return self.renderToken(tokens, idx, options);
};
md.renderer.rules.heading_open = openHeading ?? shift;
md.renderer.rules.heading_close = closeHeading ?? shift;

/** Wide tables scroll inside their own box rather than widening the page. */
const openTable = md.renderer.rules.table_open;
const tableOpen: RendererRule = (tokens, idx, options, env, self) =>
  '<div class="tablewrap">' +
  (openTable ? openTable(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options));
md.renderer.rules.table_open = tableOpen;

const closeTable = md.renderer.rules.table_close;
const tableClose: RendererRule = (tokens, idx, options, env, self) =>
  (closeTable ? closeTable(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)) +
  '</div>';
md.renderer.rules.table_close = tableClose;

export const render = (src: string): string => md.render(src ?? '');
