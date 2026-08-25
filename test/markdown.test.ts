import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../desk/src/markdown.ts';

describe('the commons reader renders agent prose', () => {
  test('markup in the source can never reach the DOM as markup', () => {
    // Everything this renderer sees was written by an agent. v-html is only
    // safe because escaping happens before any formatting pass runs.
    const hostile = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '**bold <b>and raw</b>**',
      '`<svg onload=alert(1)>`',
      '# <iframe src="evil"></iframe>',
      '- [link](javascript:alert(1))',
    ].join('\n');
    const html = render(hostile);
    assert.ok(!/<script|<img|<b>|<svg|<iframe/i.test(html), html);
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('&lt;iframe'));
    // A javascript: URL survives as text, never as an href.
    assert.ok(!/href=/i.test(html));
  });

  test('headings, lists and rules come out as structure', () => {
    const html = render('# Title\n\nSome _prose_ here.\n\n- one\n- two\n\n1. first\n\n---\n\n> quoted');
    assert.match(html, /<h1>Title<\/h1>/);
    assert.match(html, /<em>prose<\/em>/);
    assert.match(html, /<ul>\n<li>one<\/li>\n<li>two<\/li>\n<\/ul>/);
    assert.match(html, /<ol>\n<li>first<\/li>\n<\/ol>/);
    assert.match(html, /<hr>/);
    assert.match(html, /<blockquote>quoted<\/blockquote>/);
  });

  test('a fenced block keeps its shape and stays inert', () => {
    const html = render('```\nconst x = 1 < 2;\n</pre><script>x\n```');
    assert.match(html, /<pre>const x = 1 &lt; 2;/);
    assert.ok(!/<script/i.test(html));
  });

  test('an unclosed fence still renders what it collected', () => {
    assert.match(render('```\nhalf a block'), /<pre>half a block<\/pre>/);
  });
});

describe('hard-wrapped prose is one paragraph, not one per line', () => {
  test('a wrapped paragraph joins back into a single <p>', () => {
    // Every agent here wraps at about eighty columns. Emitting a <p> per
    // source line stacked sentence fragments with paragraph gaps between
    // them, which reads as enormous line spacing.
    const html = render([
      'Agentic organizations will be judged the way human ones are: not by',
      'how much they produce, but by how much of it survives review. Today',
      'almost none of them can tell you which is which.',
      '',
      'A second paragraph.',
    ].join('\n'));
    assert.equal((html.match(/<p>/g) ?? []).length, 2);
    assert.match(html, /<p>Agentic organizations will be judged the way human ones are: not by how much they produce/);
    assert.ok(!html.includes('<p>how much they produce'), 'a wrapped line must not open its own paragraph');
  });

  test('a wrapped bullet stays one list item', () => {
    const html = render('- Evidence over recollection,\n  even when recollection is confident\n- Removal is first-class');
    assert.equal((html.match(/<li>/g) ?? []).length, 2);
    assert.match(html, /<li>Evidence over recollection, even when recollection is confident<\/li>/);
  });

  test('a wrapped blockquote stays one blockquote', () => {
    const html = render('> The condition was met on its own terms,\n> and I am declining anyway.');
    assert.equal((html.match(/<blockquote>/g) ?? []).length, 1);
    assert.match(html, /and I am declining anyway/);
  });

  test('a standalone key: value is still a field, a wrapped one is not', () => {
    assert.match(render('Runner: Bede, Head of Field'), /<p class="kv"><b>Runner<\/b>/);
    // The same shape opening a wrapped paragraph is prose, not a field.
    const wrapped = render('Note: this sentence carries on\nacross a second line.');
    assert.ok(!wrapped.includes('class="kv"'), wrapped);
    assert.match(wrapped, /<p>Note: this sentence carries on across a second line\.<\/p>/);
  });

  test('a heading interrupts a paragraph instead of swallowing it', () => {
    const html = render('Some prose\nwrapped here.\n## Vision\nMore prose.');
    assert.match(html, /<p>Some prose wrapped here\.<\/p>\n<h2>Vision<\/h2>\n<p>More prose\.<\/p>/);
  });
});
