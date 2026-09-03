import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { journalEntry, JOURNAL_CHARS } from '../src/runtime/staff.ts';

/**
 * The journal is the handoff — the next shift reads it instead of re-deriving.
 * A hard `slice(0, 600)` cut Fathom's first two entries mid-word, one ending
 * "`projects/sunset" and the other "a command ", with nothing saying so. A
 * record that lies by omission is worse than a short one.
 */
describe('a shift account that outgrows the journal says so', () => {
  test('an account that fits is passed through untouched', () => {
    const account = 'Shipped sunset. Found four defects on the first-run path.';
    assert.equal(journalEntry(account, 12, false), account);
  });

  test('a long account is cut on a boundary, never mid-word', () => {
    const account = 'word '.repeat(1000);
    const entry = journalEntry(account, 12, false);
    const [body] = entry.split('\n\n_Cut at');
    assert.ok(body!.endsWith('word'), `cut mid-word: ${JSON.stringify(body!.slice(-20))}`);
  });

  test('the cut is admitted, with how much is missing', () => {
    const account = 'a'.repeat(50) + '. ' + 'b'.repeat(3000);
    const entry = journalEntry(account, 12, false);
    assert.match(entry, /_Cut at 1200 characters; \d+ more in the shift itself\._/);
  });

  test('a paragraph break is preferred to a sentence break', () => {
    const account = 'x'.repeat(1000) + '\n\n' + 'y'.repeat(50) + '. ' + 'z'.repeat(500);
    const entry = journalEntry(account, 12, false);
    assert.ok(!entry.includes('y'), 'cut should have fallen on the paragraph break');
  });

  test('a run of text with no boundary near the limit still cuts at the limit', () => {
    const account = 'q'.repeat(3000);
    const entry = journalEntry(account, 12, false);
    assert.equal(entry.split('\n\n_Cut at')[0]!.length, JOURNAL_CHARS);
  });

  test('hitting the turn ceiling is reported as well as the cut', () => {
    const entry = journalEntry('short account', 60, true);
    assert.match(entry, /_Cut at the turn ceiling \(60\)\. Resumes next shift\._/);
  });

  test('a long account that also hit the ceiling reports both', () => {
    const entry = journalEntry('word '.repeat(1000), 60, true);
    assert.match(entry, /more in the shift itself\._/);
    assert.match(entry, /turn ceiling \(60\)/);
  });

  test('the budget is big enough for the accounts that exposed the bug', () => {
    // Juno's two day-one entries were 1237 characters of surviving text after
    // a 600-char cut had already taken a bite out of each.
    assert.ok(JOURNAL_CHARS >= 1200, `${JOURNAL_CHARS} is under what one shift writes`);
  });
});
