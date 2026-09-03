import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from '../src/ledger/ledger.ts';
import { World } from '../src/worldfs/world.ts';
import { Gate } from '../src/policy/gate.ts';
import { constitutionFor } from '../src/policy/rules.ts';
import { fixedClock } from '../src/core/clock.ts';
import { buildTickPrompt } from '../src/runtime/staff.ts';
import type { Agent, Tier } from '../src/core/types.ts';

/**
 * A brief edit that reaches nobody is a control that does not work.
 *
 * The operator of a real company widened its founding premise 1h47m after
 * founding. No shift was ever told. By then the CEO had already copied the
 * original wording into the commons as the company's own charter, and the
 * company went on building inside the old boundary for a fortnight — the
 * edit had changed a document that nothing read twice.
 */
const NOW = '2026-08-25T12:00:00.000Z';

const person = (id: string, tier: Tier = 'member'): Agent => ({
  id, name: id[0]!.toUpperCase() + id.slice(1), tier, role: 'engineer',
  department: '', reportsTo: 'ceo', status: 'active', activity: '', mandate: '',
  hiredAt: '2026-08-01T00:00:00.000Z', hiredBy: null, model: 'claude-opus-5',
});

let clock: ReturnType<typeof fixedClock>;
let ledger: Ledger;
let world: World;
let gate: Gate;
let root: string;

const wake = (id: string): string =>
  buildTickPrompt({ agent: person(id), ledger, world, gate, clock });

beforeEach(() => {
  clock = fixedClock(NOW);
  root = mkdtempSync(join(tmpdir(), 'riff-brief-'));
  ledger = new Ledger(':memory:', clock);
  world = new World(root, clock);
  world.ensure();
  gate = new Gate(ledger, constitutionFor({ ceo: 'ceo', board: ['cali'] }),
    { count: () => 0, exists: () => false });
  for (const id of ['ceo', 'rae', 'vim']) ledger.upsertAgent(person(id));
});

afterEach(() => {
  ledger.close();
  rmSync(root, { recursive: true, force: true });
});

describe('a change to the brief reaches the people working under it', () => {
  test('both wordings arrive, because what moved is the point', () => {
    ledger.emit('cali', 'company.brief', null, {
      was: 'Assume Claude, MCP, Rust and TypeScript.',
      now: 'The domain is yours to find.',
    });
    const p = wake('rae');
    assert.match(p, /The brief for this company has changed/);
    assert.match(p, /The domain is yours to find\./);
    // Without the old wording there is no way to tell what actually changed.
    assert.match(p, /Assume Claude, MCP, Rust and TypeScript\./);
  });

  test('it says the charter is now a claim, not a settled decision', () => {
    // The specific failure: the premise moved but the company had already
    // written the old one down as its own, where an edit cannot reach it.
    ledger.emit('cali', 'company.brief', null, { was: 'a', now: 'b' });
    assert.match(wake('rae'), /charter/i);
  });

  test('it arrives once, not at every wake-up forever', () => {
    ledger.emit('cali', 'company.brief', null, { was: 'a', now: 'b' });
    assert.match(wake('rae'), /brief for this company has changed/);
    assert.doesNotMatch(wake('rae'), /brief for this company has changed/);
  });

  test('everyone is told, not only whoever happened to wake first', () => {
    ledger.emit('cali', 'company.brief', null, { was: 'a', now: 'b' });
    wake('rae');
    assert.match(wake('vim'), /brief for this company has changed/);
  });

  test('a second change reaches somebody who already saw the first', () => {
    ledger.emit('cali', 'company.brief', null, { was: 'a', now: 'b' });
    wake('rae');
    clock.advance(60_000);
    ledger.emit('cali', 'company.brief', null, { was: 'b', now: 'c' });
    assert.match(wake('rae'), /brief for this company has changed/);
  });

  test('a company whose brief has never changed is told nothing', () => {
    assert.doesNotMatch(wake('rae'), /brief for this company has changed/);
  });

  test('a malformed record costs nobody their shift', () => {
    ledger.emit('cali', 'company.brief', null, undefined);
    const p = wake('rae');
    assert.match(p, /You have woken up/);
    assert.doesNotMatch(p, /brief for this company has changed/);
  });
});
