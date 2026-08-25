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
