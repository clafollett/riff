import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { tagline } from '../desk/src/text.ts';

/**
 * The line of business grew from three words to a founder's whole brief, and
 * two places render it on one line. A paragraph landed under the company name
 * and pushed the rail around.
 */
describe('a line of business that is a paragraph still fits on one line', () => {
  test('a short one is left exactly alone', () => {
    assert.equal(tagline('marine sensing'), 'marine sensing');
  });

  test('only the first line of a paragraph is offered', () => {
    const brief = 'LaFollett Labs builds agentic systems.\n\nWe ship things people run.';
    assert.equal(tagline(brief), 'LaFollett Labs builds agentic systems.');
  });

  test('a long first line is cut on a word, never mid-word', () => {
    const line = 'LaFollett Labs builds agentic systems and the tools that make them work today';
    const out = tagline(line, 40);
    assert.ok(out.length <= 41, `too long: ${out.length}`);
    assert.ok(out.endsWith('…'));
    // The last thing before the ellipsis is a whole word from the source.
    const word = out.slice(0, -1).split(' ').at(-1)!;
    assert.ok(line.split(' ').includes(word), `"${word}" is a fragment`);
  });

  test('no dangling punctuation is left in front of the ellipsis', () => {
    // The cut lands just past the comma; ", …" reads as a typo.
    assert.equal(tagline('Instruments for boats, and nothing else at all here', 23),
                 'Instruments for boats…');
  });

  test('leading blank lines do not become an empty tagline', () => {
    assert.equal(tagline('\n\n   \nmarine sensing'), 'marine sensing');
  });

  test('nothing recorded is empty, so the caller can offer its own words', () => {
    assert.equal(tagline(''), '');
    assert.equal(tagline(null), '');
    assert.equal(tagline(undefined), '');
  });
});
