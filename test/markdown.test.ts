import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { render } from '../desk/src/markdown.ts';

/**
 * These assert BEHAVIOUR, not the shape of any one renderer. The hand-rolled
 * version this replaced was wrong twice — a paragraph per source line, then no
 * tables at all — so the tests must survive swapping the engine again.
 */

describe('agent prose can never become markup', () => {
  test('raw HTML in the source renders as text', () => {
    // v-html is only defensible because `html: false` escapes the source.
    // Turning that option on would undo every assertion in this block.
    const html = render([
      '<script>alert(1)</script>',
      '',
      '<img src=x onerror=alert(1)>',
      '',
      '# <iframe src="evil"></iframe>',
      '',
      '`<svg onload=alert(1)>`',
    ].join('\n'));
    assert.ok(!/<script|<img|<svg|<iframe/i.test(html), html);
    assert.match(html, /&lt;script&gt;/);
    assert.match(html, /&lt;iframe/);
  });

  test('a javascript: link never becomes an href', () => {
    const html = render('[click](javascript:alert(1))\n\n[vb](vbscript:x)\n\n[f](file:///etc/passwd)');
    assert.ok(!/href=/i.test(html), html);
  });

  test('a real link opens away from this page and cannot reach back', () => {
    const html = render('[the run](https://github.com/kubernetes/kubernetes/pull/141440)');
    assert.match(html, /href="https:\/\/github\.com\/kubernetes/);
    assert.match(html, /target="_blank"/);
    assert.match(html, /rel="noopener noreferrer nofollow"/);
  });

  test('a fenced block keeps its shape and stays inert', () => {
    const html = render('```\nconst x = 1 < 2;\n</pre><script>x\n```');
    assert.match(html, /<pre><code>const x = 1 &lt; 2;/);
    assert.ok(!/<script/i.test(html));
  });
});

describe('the shapes agents actually write', () => {
  test('tables render as tables, in a box that scrolls on its own', () => {
    // The seats doctrine is a table, and it used to come out as a run-on
    // paragraph of pipes and dashes.
    const html = render([
      '| Seat | Who | Retire it when |',
      '|---|---|---|',
      '| CEO | Vale | (see below) |',
      '| Head of Field | Bede | 60 days with zero scored runs |',
    ].join('\n'));
    assert.match(html, /<div class="tablewrap"><table>/);
    assert.match(html, /<\/table>\n?<\/div>/);
    assert.match(html, /<th>Retire it when<\/th>/);
    assert.equal((html.match(/<tr>/g) ?? []).length, 3);
    assert.ok(!html.includes('|---|'), 'pipes must not survive as text');
  });

  test('hard-wrapped prose is one paragraph, not one per source line', () => {
    const html = render([
      'Agentic organizations will be judged the way human ones are: not by',
      'how much they produce, but by how much of it survives review. Today',
      'almost none of them can tell you which is which.',
      '',
      'A second paragraph.',
    ].join('\n'));
    assert.equal((html.match(/<p>/g) ?? []).length, 2);
    assert.ok(!html.includes('<p>how much they produce'), 'a wrapped line must not open its own paragraph');
  });

  test('a wrapped bullet stays one list item, and nesting survives', () => {
    const html = render([
      '- Evidence over recollection,',
      '  even when recollection is confident',
      '- Removal is first-class',
      '  - and it has a criterion',
    ].join('\n'));
    assert.match(html, /Evidence over recollection,\seven when recollection is confident/);
    assert.match(html, /<ul>[\s\S]*<ul>/, 'a nested list should nest');
  });

  test('headings, rules, quotes and emphasis all come out as structure', () => {
    const html = render('# Title\n\nSome _prose_ and **bold**.\n\n---\n\n> quoted\n\n1. first\n2. second');
    // Demoted: this prose is embedded in a page that owns the h1.
    assert.match(html, /<h2>Title<\/h2>/);
    assert.match(html, /<em>prose<\/em>/);
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<hr>/);
    assert.match(html, /<blockquote>/);
    assert.match(html, /<ol>[\s\S]*<li>second<\/li>/);
  });

  test('headings are demoted, so embedded prose cannot own the page outline', () => {
    // The commons reader printed every document's title twice — once as the
    // page heading and again as the body's own `#` — and a page showing
    // several messages ended up with several h1s.
    assert.match(render('# One'), /<h2>One<\/h2>/);
    assert.match(render('## Two'), /<h3>Two<\/h3>/);
    assert.match(render('##### Five'), /<h6>Five<\/h6>/);
    // h6 is the floor; there is nothing below it to demote into.
    assert.match(render('###### Six'), /<h6>Six<\/h6>/);
    assert.ok(!/<h1>/.test(render('# One\n\n## Two')));
  });

  test('empty and missing input render to nothing rather than throwing', () => {
    assert.equal(render(''), '');
    assert.equal(render(undefined as unknown as string), '');
  });
});
