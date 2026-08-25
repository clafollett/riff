import { query, type SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';
import type { Agent } from '../core/types.ts';
import type { Ledger } from '../ledger/ledger.ts';
import type { Gate } from '../policy/gate.ts';
import type { World } from '../worldfs/world.ts';
import type { Clock } from '../core/clock.ts';
import { createTools } from './tools.ts';
import { makeCanUseTool } from './permissions.ts';

export type TickDeps = {
  agent: Agent;
  ledger: Ledger;
  gate: Gate;
  world: World;
  clock: Clock;
  /** Hard ceiling on what one wake-up may cost, independent of the spend cap.
   *  The spend cap governs the staff's money; this governs yours. */
  maxBudgetUsd?: number;
  maxTurns?: number;
  /** External MCP servers (image generation, calendar, inbox). Everything they
   *  reach still crosses the gate — canUseTool sees these calls too. */
  connectors?: Record<string, { type: 'http' | 'sse'; url: string; headers?: Record<string, string> }>;
  /** Observe the shift: every tool the staff member reaches for, and why it
   *  was allowed or refused. Used by scripts/tick.ts to diagnose a shift. */
  trace?: (line: string) => void;
  signal?: AbortSignal;
};

export type TickResult = {
  agentId: string;
  ok: boolean;
  summary: string;
  costUsd: number;
  turns: number;
  /** Subscription rate-limit state, when the run reported any. On a Claude
   *  subscription this — not dollars — is what actually governs the village. */
  rateLimit?: SDKRateLimitInfo;
  error?: string;
};

/**
 * The stable half of the context. Persona and House Rules do not change between
 * ticks, so they sit in the system prompt where the cache can hold them; the
 * volatile half (mail, events, tasks) goes in the user prompt below the
 * cache boundary.
 */
const buildSystemPrompt = (d: TickDeps): string => {
  const { agent, world, gate, ledger } = d;
  const r = gate.constitution;
  const persona = world.readPersona(agent.id);
  const memory = world.readMemory(agent.id);

  // Hand them the roster up front. Left to work it out, a cold-started staff
  // member spends ten turns reading ten colleagues' briefs before doing
  // anything — which is exactly how the Steward's first shift died at its
  // turn cap having produced nothing. Stable between ticks, so it caches.
  const roster = ledger.listAgents()
    .filter((a) => a.id !== agent.id)
    .map((a) => `- ${a.name} (${a.id}) — ${a.role}, ${a.tier}${a.department ? ` · ${a.department}` : ''}`)
    .join('\n');

  return [
    `You are ${agent.name}. Your role is ${agent.role}.`,
    `Your agent id is "${agent.id}"${agent.department ? `, in ${agent.department}` : ''}.`,
    agent.reportsTo ? `You report to ${agent.reportsTo}.` : '',
    '',
    '## Who you are',
    persona || '(No brief on file yet. Write one to your own persona.md.)',
    '',
    '## The House Rules',
    '1. Work well together.',
    '2. Get work done however you see fit, so long as the Steward approves what needs approving.',
    '3. You may take work all the way out into the real world, but it always lands as a draft.',
    `   Nothing goes live without the Inn Keeper. Use draft_to_outside — there is no other door.`,
    `4. Only ${r.treasurers.join(' and ')} may spend, up to $${(r.dailyCapCents / 100).toFixed(2)} a day.`,
    `5. If the Inn Keeper is not around, do not stop. Keep the work moving.`,
    '',
    'These rules are enforced by the Inn itself, not by your good intentions.',
    'If a tool tells you something is held for approval, it is queued — do not retry it.',
    'Move on to other work and let the approval land.',
    '',
    '## Who else works here',
    roster || '(You are the only one here.)',
    '',
    '## What you remember',
    memory || '(Nothing yet. As you learn things worth keeping, use `remember`.)',
    '',
    '## How to work',
    '- Your quarters are staff/' + agent.id + '/. Write freely there.',
    '- commons/ is shared ground. It has no fixed format — if the Inn needs something',
    '  that does not exist yet, invent it there.',
    "- You may read colleagues' briefs and memory. They can see that you did.",
    '- Prefer finishing one real thing over starting three.',
  ].filter(Boolean).join('\n');
};

/** The volatile half — what changed since this staff member last woke. */
const buildTickPrompt = (d: TickDeps): string => {
  const { agent, ledger, clock } = d;
  const parts: string[] = [`It is ${clock.now().toLocaleString()}. You have woken up.`];

  // Mail is marked read here: it has been handed over, and re-delivering it
  // every tick would make the staff answer the same message forever.
  const mail = ledger.inbox(agent.id, true);
  if (mail.length) {
    parts.push('', '## Messages for you', ...mail.map(
      (m) => `- **${m.from}**${m.broadcast ? ' (to everyone)' : ''}: ${m.body}`,
    ));
  }

  const mine = ledger.listTasks({ assignedTo: agent.id }).filter((t) =>
    t.status === 'claimed' || t.status === 'in_progress' || t.status === 'blocked');
  if (mine.length) {
    parts.push('', '## Your work in progress', ...mine.map((t) => `- [${t.id}] ${t.title} (${t.status})`));
  }

  const open = ledger.listTasks({ status: 'open' }).slice(0, 8);
  if (open.length) {
    parts.push('', '## Unclaimed on the board', ...open.map((t) => `- [${t.id}] ${t.title}`));
  }

  const recent = ledger.eventsSince(Math.max(0, ledger.latestSeq() - 25))
    .filter((e) => e.actor !== agent.id && !e.kind.startsWith('gate.'));
  if (recent.length) {
    parts.push('', '## Around the grounds', ...recent.slice(-12).map(
      (e) => `- ${e.actor} ${e.kind.replace(/\./g, ' ')}${e.subject ? ` (${e.subject})` : ''}`,
    ));
  }

  parts.push('', 'Do what the Inn needs from you now. Be concrete and finish something.');
  return parts.join('\n');
};

/**
 * Wake one staff member, let them work, and put them back to sleep.
 *
 * Isolation is the important part of the options below. The SDK loads the
 * operator's ~/.claude settings AND their CLAUDE.md by default — which would
 * give all 22 staff the same borrowed personality and leak private operator
 * instructions into every session. `settingSources: []` is the documented
 * isolation mode, and a plain-string systemPrompt (rather than the
 * `{type:'preset'}` form) keeps the Claude Code preset prompt out of a persona
 * that is supposed to be their own.
 */
export const tick = async (d: TickDeps): Promise<TickResult> => {
  const { agent, ledger, gate, world, clock } = d;
  const { server, capabilities } = createTools({
    actor: agent.id, ledger, gate, world, clock,
  });

  const resume = ledger.getMeta(`session:${agent.id}`);
  ledger.emit(agent.id, 'agent.woke', null, { resumed: Boolean(resume) });

  let costUsd = 0;
  let turns = 0;
  let summary = '';
  let rateLimit: SDKRateLimitInfo | undefined;

  try {
    const q = query({
      prompt: buildTickPrompt(d),
      options: {
        cwd: world.root,
        model: agent.model,
        systemPrompt: buildSystemPrompt(d),

        // ---- isolation ----
        settingSources: [],          // no ~/.claude/settings.json, no CLAUDE.md
        strictMcpConfig: true,       // only the tools we hand them
        mcpServers: { inn: server, ...(d.connectors ?? {}) },
        canUseTool: makeCanUseTool({
          actor: agent.id, world, gate, toolCapabilities: capabilities,
          ...(d.trace ? { onDecision: (t, o, why) => d.trace!(`  gate  ${o.padEnd(5)} ${t} ${why}`) } : {}),
        }),
        disallowedTools: ['Bash', 'BashOutput', 'KillShell'],
        permissionMode: 'default',   // 'default' is what consults canUseTool

        // ---- limits ----
        maxTurns: d.maxTurns ?? 24,
        ...(d.maxBudgetUsd != null ? { maxBudgetUsd: d.maxBudgetUsd } : {}),
        effort: 'medium',
        thinking: { type: 'adaptive' },

        // ---- continuity ----
        ...(resume ? { resume } : {}),
        persistSession: true,
        ...(d.signal ? { abortController: abortFrom(d.signal) } : {}),
      },
    });

    for await (const m of q) {
      if (d.trace && m.type === 'assistant') {
        for (const b of m.message.content) {
          if (b.type === 'tool_use') {
            d.trace(`  call  ${b.name} ${JSON.stringify(b.input).slice(0, 110)}`);
          } else if (b.type === 'text' && b.text.trim()) {
            d.trace(`  says  ${b.text.trim().split('\n')[0]!.slice(0, 110)}`);
          }
        }
      }
      if (m.type === 'system' && 'session_id' in m && typeof m.session_id === 'string') {
        ledger.setMeta(`session:${agent.id}`, m.session_id);
      }
      if (m.type === 'rate_limit_event') {
        rateLimit = m.rate_limit_info;
      }
      if (m.type === 'result') {
        turns = m.num_turns;
        costUsd = m.total_cost_usd;
        summary = m.subtype === 'success' ? m.result : `ended: ${m.subtype}`;
      }
    }

    // Their own account of the shift, in their own hand, in the world's git log.
    if (summary) world.appendJournal(agent.id, summary.slice(0, 600));
    world.git.commitAs({ id: agent.id, name: agent.name }, `${agent.id}: ${firstLine(summary)}`);

    ledger.emit(agent.id, 'agent.slept', null, { turns, costUsd });
    return { agentId: agent.id, ok: true, summary, costUsd, turns, ...(rateLimit ? { rateLimit } : {}) };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    ledger.emit(agent.id, 'agent.failed', null, { error });
    return { agentId: agent.id, ok: false, summary: '', costUsd, turns, error };
  }
};

const firstLine = (s: string): string =>
  (s.split('\n').find((l) => l.trim()) ?? 'worked a shift').slice(0, 72);

const abortFrom = (signal: AbortSignal): AbortController => {
  const c = new AbortController();
  if (signal.aborted) c.abort();
  else signal.addEventListener('abort', () => c.abort(), { once: true });
  return c;
};
