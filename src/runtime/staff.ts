import { query, type SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';
import type { Agent } from '../core/types.ts';
import type { Ledger } from '../ledger/ledger.ts';
import type { Gate } from '../policy/gate.ts';
import type { World } from '../worldfs/world.ts';
import type { Clock } from '../core/clock.ts';
import { createTools, TOOL_NAMESPACE } from './tools.ts';
import { makeCanUseTool, shellIsContained } from './permissions.ts';
import { RULES_TEXT } from '../policy/rules.ts';

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
   *  subscription this — not dollars — is what actually governs the company. */
  rateLimit?: SDKRateLimitInfo;
  error?: string;
  /** The shift ended at the turn ceiling rather than because the agent
   *  chose to stop. Work happened; there was simply more of it. */
  truncated?: boolean;
};

/**
 * The stable half of the context. Persona and the rules do not change between
 * ticks, so they sit in the system prompt where the cache can hold them; the
 * volatile half (mail, events, tasks) goes in the user prompt below the
 * cache boundary.
 */
/**
 * Whether anything this company writes can actually reach anyone.
 *
 * This exists because it went wrong. Two posts were approved to go out, the
 * approval was recorded, and nothing sent them anywhere — so the company
 * believed it had published, and wrote a first-contact letter telling a
 * stranger its instrument and corrections were public. They were in a private
 * repo on one machine. The board caught it at the last gate, which is one gate
 * too late: nobody in the company had any way to know.
 *
 * An approval means releasable. It does not mean released.
 */
/**
 * What the company can see out, and what it can send out. They are not the
 * same thing and conflating them cost real work.
 *
 * This said only that nothing gets OUT. A reasonable reader concluded nothing
 * gets IN either: across 423 gated actions a company of engineers never once
 * reached for WebSearch or WebFetch, and reasoned about a fast-moving field
 * entirely from training data. Reading out needs nobody's approval and never
 * did.
 */
const READING_OUT = [
  '## Looking things up',
  '',
  'You can read the outside world. WebSearch and WebFetch are yours and need',
  'no approval — this is reading, not publishing. Your training has a cutoff',
  'and this field moves faster than it, so look things up rather than',
  'reasoning from memory, and say which you did.',
  'Network access is an allowlist. A refused host is the wall doing its job,',
  'not a fault to work around — if you need one that is not open, ask.',
  '',
].join('\n');

const outwardState = (d: TickDeps): string => {
  const channels = Object.keys(d.connectors ?? {});
  if (channels.length) {
    return [
      READING_OUT,
      '## Sending things out',
      '',
      `Connected channels: ${channels.join(', ')}. Approved work can reach them.`,
      'Everything still lands as a draft first — approval is what releases it.',
    ].join('\n');
  }
  return [
    READING_OUT,
    '## Sending things out',
    '',
    'There is no connected channel. Nothing this company writes reaches anyone',
    'outside it, and nothing it has written has ever been published.',
    '',
    'An approved draft is APPROVED, not SENT. It sits in your drafts folder.',
    'Do not describe any of our work as public, published, or citable, and do',
    'not promise an outsider that they can check something. They cannot.',
    'If publishing matters to what you are doing, say so — deciding where this',
    'company publishes is a decision the board has to make, and it has not.',
  ].join('\n');
};

const buildSystemPrompt = (d: TickDeps): string => {
  const { agent, world, gate, ledger } = d;
  const r = gate.constitution;
  const persona = world.readPersona(agent.id);
  const memory = world.readMemory(agent.id);

  // Hand them the roster up front. Left to work it out, a cold-started staff
  // member spends ten turns reading ten colleagues' briefs before doing
  // anything — which is exactly how the first CEO shift died at its
  // turn cap having produced nothing. Stable between ticks, so it caches.
  const roster = ledger.listAgents()
    .filter((a) => a.id !== agent.id)
    .map((a) => `- ${a.name} — ${a.role}, ${a.tier}${a.department ? ` · ${a.department}` : ''}`
      + ` (address tools to "${a.id}")`)
    .join('\n');

  return [
    `You are ${agent.name}. Your role is ${agent.role}.`,
    `Your agent id is "${agent.id}"${agent.department ? `, in ${agent.department}` : ''}. ` +
    'Ids are handles for tools. In anything a person reads — documents, ' +
    `messages, commit subjects — write people's names: you are ${agent.name}, ` +
    'and your colleagues are the names on the roster below.',
    agent.reportsTo ? `You report to ${agent.reportsTo}.` : '',
    '',
    '## Who you are',
    persona || '(No brief on file yet. Write one to your own persona.md.)',
    '',
    '## The Rules',
    RULES_TEXT(r),
    '',
    '## Who else works here',
    roster || '(You are the only one here.)',
    '',
    '## What you remember',
    memory || '(Nothing yet. As you learn things worth keeping, use `remember`.)',
    '',
    '## How to work',
    '- Your own files are staff/' + agent.id + '/. Write freely there.',
    '- commons/ is shared ground. It has no fixed format — if the company needs',
    '  something that does not exist yet, invent it there.',
    "- You may read colleagues' briefs and memory. They can see that you did.",
    '- Prefer finishing one real thing over starting three.',
    '',
    outwardState(d),
  ].filter(Boolean).join('\n');
};

/** The volatile half — what changed since this staff member last woke. */
const buildTickPrompt = (d: TickDeps): string => {
  const { agent, ledger, clock } = d;
  const parts: string[] = [`It is ${clock.now().toLocaleString()}. You have woken up.`];

  // Decisions come FIRST. A rejection you have to go looking for is a
  // rejection that changes nothing.
  const decisions = ledger.decisionsFor(agent.id, 3);
  if (decisions.length) {
    parts.push('', '## Decisions on your requests');
    for (const d of decisions) {
      parts.push(
        '',
        `**${d.state.toUpperCase()}** — ${d.summary}`,
        `Decided by ${d.decidedBy ?? 'unknown'}.`,
        ...(d.decisionReason ? ['', d.decisionReason] : ['', '(no reason given)']),
      );
    }
    parts.push('', 'Answer what you agree with by changing the work, and say plainly where you disagree.');
  }

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

  parts.push('', 'Do what the company needs from you now. Be concrete and finish something.');
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
/**
 * Errors that mean "the transcript you asked me to continue is gone", as
 * opposed to anything about the work. Matched on the message because the SDK
 * surfaces it as a result string rather than a typed error.
 */
const LOST_SESSION = /No conversation found with session ID|session .* not found/i;

/** The turn ceiling, which ends a shift rather than breaking one. */
const OUT_OF_TURNS = /Reached maximum number of turns/i;

export const tick = async (
  d: TickDeps,
  opts?: { withoutResume?: boolean },
): Promise<TickResult> => {
  const { agent, ledger, gate, world, clock } = d;
  const { server, capabilities } = createTools({
    actor: agent.id, ledger, gate, world, clock,
  });

  const resume = opts?.withoutResume ? null : ledger.getMeta(`session:${agent.id}`);
  ledger.emit(agent.id, 'agent.woke', null, { resumed: Boolean(resume) });

  let costUsd = 0;
  let turns = 0;
  let summary = '';
  /** The last thing the agent said out loud, whether or not it got to finish. */
  let said = '';
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
        mcpServers: { [TOOL_NAMESPACE]: server, ...(d.connectors ?? {}) },
        canUseTool: makeCanUseTool({
          actor: agent.id, world, gate, toolCapabilities: capabilities,
          ...(d.trace ? { onDecision: (t, o, why) => d.trace!(`  gate  ${o.padEnd(5)} ${t} ${why}`) } : {}),
        }),
        // Belt and braces on the host: canUseTool already refuses these, but
        // disallowedTools keeps them out of the tool list the model is shown,
        // so no turn is spent reaching for something that cannot be granted.
        // Inside the container the shell is the point, so it is offered.
        ...(shellIsContained() ? {} : { disallowedTools: ['Bash', 'BashOutput', 'KillShell'] }),
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
      if (m.type === 'assistant') {
        for (const b of m.message.content) {
          // Kept whether or not anyone is tracing: when a shift is cut at the
          // turn ceiling there is no result text, and this is the only record
          // of what the agent was actually doing when the lights went out.
          if (b.type === 'text' && b.text.trim()) said = b.text.trim();
          if (!d.trace) continue;
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
        // "ended: error_max_turns" was going into the journal and the commit
        // message — an error code standing in for the agent's own account of
        // its shift. Their last words are a truer record than the subtype.
        summary = m.subtype === 'success' ? m.result : (said || `ended: ${m.subtype}`);
      }
    }

    // Their own account of the shift, in their own hand, in the world's git log.
    if (summary) world.appendJournal(agent.id, summary.slice(0, 600));
    world.git.commitAs({ id: agent.id, name: agent.name }, `${agent.id}: ${firstLine(summary)}`);

    ledger.emit(agent.id, 'agent.slept', null, { turns, costUsd });
    return { agentId: agent.id, ok: true, summary, costUsd, turns, ...(rateLimit ? { rateLimit } : {}) };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);

    // A conversation the runtime no longer has is not a failed shift.
    //
    // The session id lives in the ledger, on the durable volume. The
    // conversation lives wherever the runtime keeps it, which in the container
    // is a tmpfs — so every restart wipes the transcripts while the ids
    // survive, and every agent asks to resume something that is gone. Nothing
    // cleared the id, so it repeated forever rather than healing. Forget it and
    // take the shift again cold; the persona, memory and world are the durable
    // context, and resume was only ever an optimisation on top of them.
    //
    // Checked BEFORE anything is recorded as a failure, because a shift that
    // recovers did not fail, and saying so puts a red line in the console for
    // something nobody needs to act on.
    if (resume && LOST_SESSION.test(error)) {
      ledger.setMeta(`session:${agent.id}`, '');
      ledger.emit(agent.id, 'session.reset', null, { was: resume });
      return tick(d, { withoutResume: true });
    }

    // Running out of turns is a shift ending, not a shift failing. The agent
    // worked, spent real money and usually wrote something down; it simply hit
    // the ceiling before it chose to stop. Recording that as a failure made a
    // busy company look broken and buried the errors that actually matter.
    if (OUT_OF_TURNS.test(error)) {
      const cut = summary || said;
      if (cut) world.appendJournal(agent.id, `${cut.slice(0, 600)}\n\n_Cut at the turn ceiling (${turns}). Resumes next shift._`);
      world.git.commitAs({ id: agent.id, name: agent.name }, `${agent.id}: ${firstLine(cut)}`);
      ledger.emit(agent.id, 'agent.slept', null, { turns, costUsd, truncated: true });
      return { agentId: agent.id, ok: true, summary: cut, costUsd, turns, truncated: true,
               ...(rateLimit ? { rateLimit } : {}) };
    }

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
