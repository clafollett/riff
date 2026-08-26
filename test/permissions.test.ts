import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from '../src/ledger/ledger.ts';
import { World } from '../src/worldfs/world.ts';
import { Gate, type CommonsView } from '../src/policy/gate.ts';
import { constitutionFor } from '../src/policy/rules.ts';
import { fixedClock } from '../src/core/clock.ts';
import { makeCanUseTool, shellIsContained } from '../src/runtime/permissions.ts';
import { createTools, TOOL_NAMESPACE, TOOL_PREFIX } from '../src/runtime/tools.ts';
import type { Agent, Tier } from '../src/core/types.ts';
import type { PermissionResult } from '@anthropic-ai/claude-agent-sdk';

/**
 * canUseTool is the chokepoint. Everything else in the policy layer is only
 * as good as this function, and it had no test at all.
 */

const agent = (id: string, tier: Tier, reportsTo: string | null = 'ceo'): Agent => ({
  id, name: id[0]!.toUpperCase() + id.slice(1), tier, role: tier,
  department: '', reportsTo, status: 'active', activity: '', mandate: '',
  hiredAt: '2026-08-01T00:00:00.000Z', hiredBy: null, model: 'claude-opus-5',
});

let dir: string;
let clock: ReturnType<typeof fixedClock>;
let ledger: Ledger;
let world: World;
let gate: Gate;
let capabilities: Record<string, string>;

const can = (opts: { actor?: string; contained?: boolean } = {}) =>
  makeCanUseTool({
    actor: opts.actor ?? 'rae', world, gate,
    toolCapabilities: capabilities as never,
    ...(opts.contained === undefined ? {} : { contained: opts.contained }),
  });

const call = async (tool: string, input: Record<string, unknown> = {}, opts = {}) =>
  can(opts)(tool, input, { signal: AbortSignal.timeout(5_000) } as never);

/** Narrow to the branch under test, and fail loudly with the other one. */
const denied = (r: PermissionResult | null, what = ''): { message: string } => {
  assert.ok(r && r.behavior === 'deny', `${what} expected a deny, got ${JSON.stringify(r)}`);
  return r;
};
const allowed = (r: PermissionResult | null, what = ''): void => {
  assert.ok(r && r.behavior === 'allow', `${what} expected an allow, got ${JSON.stringify(r)}`);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'riff-perm-'));
  clock = fixedClock('2026-08-25T09:00:00.000Z');
  ledger = new Ledger(':memory:', clock);
  ledger.upsertAgent(agent('chair', 'board', null));
  ledger.upsertAgent(agent('ceo', 'executive', 'chair'));
  ledger.upsertAgent(agent('rae', 'lead'));

  world = new World(join(dir, 'world'), clock);
  const commons: CommonsView = { count: () => world.commonsCount(), exists: (p) => world.exists(p) };
  gate = new Gate(ledger, constitutionFor({ ceo: 'ceo', board: ['chair'] }), commons);
  capabilities = createTools({ ledger, world, gate, clock, actor: 'rae' } as never).capabilities;
});

afterEach(() => { ledger.close(); rmSync(dir, { recursive: true, force: true }); });

describe('the chokepoint', () => {
  test('the prefix it matches on is the one the SDK actually produces', async () => {
    // These were two independent strings in two files. When the MCP server was
    // renamed and this was not, every company tool fell through to the
    // default-deny — a whole shift of refusals with no error raised anywhere.
    assert.equal(TOOL_PREFIX, `mcp__${TOOL_NAMESPACE}__`);

    for (const bare of Object.keys(capabilities)) {
      allowed(await call(`${TOOL_PREFIX}${bare}`), bare);
    }
  });

  test('an unrecognised tool is refused, so a new SDK tool is not a new power', async () => {
    denied(await call('SomeToolShippedNextVersion', { anything: true }));
  });

  test('a tool under the right prefix that we never defined is still refused', async () => {
    denied(await call(`${TOOL_PREFIX}drop_the_database`));
  });
});

describe('the shell is decided by where the runtime is', () => {
  test('refused on the operator machine, and the refusal says why', async () => {
    assert.match(denied(await call('Bash', { command: 'ls' }, { contained: false })).message, /container/i);
  });

  test('offered inside the container, because that is what the box is for', async () => {
    allowed(await call('Bash', { command: 'npm test' }, { contained: true }));
  });

  test('every shell tool follows the same decision, not just Bash', async () => {
    for (const t of ['Bash', 'BashOutput', 'KillShell', 'KillTask']) {
      denied(await call(t, {}, { contained: false }), t);
      allowed(await call(t, {}, { contained: true }), t);
    }
  });

  test('the environment variable alone is not enough to open a shell', () => {
    // A mistyped export on someone's laptop must not hand out a terminal.
    // Outside a container the marker file is absent, so this stays false.
    assert.equal(shellIsContained({ RIFF_CONTAINED: '1' } as never), false);
    assert.equal(shellIsContained({} as never), false);
  });
});

describe('paths are classified before they are allowed', () => {
  test('anything outside the world is refused outright', async () => {
    for (const p of ['/etc/passwd', '../../.ssh/id_rsa', join(dir, 'elsewhere.txt')]) {
      assert.match(denied(await call('Read', { file_path: p }), p).message, /outside the company/);
    }
  });

  test('a read tool with no path is refused rather than guessed at', async () => {
    denied(await call('Read', {}));
  });

  test('own files are allowed; a colleague\'s writes escalate', async () => {
    allowed(await call('Write', { file_path: 'staff/rae/notes/x.md' }));

    // Writing on someone else's desk needs the CEO's signature (R2).
    const other = denied(await call('Write', { file_path: 'staff/ceo/notes/x.md' }));
    assert.match(other.message, /approval|queued|pending/i);

    // Reading it is allowed — and logged, which is the point.
    allowed(await call('Read', { file_path: 'staff/ceo/persona.md' }));
  });

  test('an escalation tells the agent to stop, not to try again', async () => {
    assert.match(denied(await call('Write', { file_path: 'staff/ceo/notes/y.md' })).message, /Do not retry/);
  });
});
