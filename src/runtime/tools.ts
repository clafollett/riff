import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { newId, slug } from '../core/ids.ts';
import type { Capability, AgentId, Facing } from '../core/types.ts';
import type { Ledger } from '../ledger/ledger.ts';
import type { PolicyGate } from '../policy/gate.ts';
import type { World } from '../worldfs/world.ts';
import type { Clock } from '../core/clock.ts';

export type InnContext = {
  actor: AgentId;
  ledger: Ledger;
  gate: PolicyGate;
  world: World;
  clock: Clock;
};

const say = (text: string) => ({ content: [{ type: 'text' as const, text }] });

/**
 * Run an action behind the gate. The tool body — not canUseTool — is where the
 * real check happens, because only here do we know WHAT is being asked for
 * (the amount, the target, the one-line summary that lands in the inbox).
 */
const gated = (
  ctx: InnContext,
  capability: Capability,
  summary: string,
  target: string | null,
  perform: () => string,
  extra?: { amountCents?: number; payload?: unknown },
): string => {
  const d = ctx.gate.request({
    actor: ctx.actor, capability, summary,
    ...(target ? { target } : {}),
    ...(extra?.amountCents != null ? { amountCents: extra.amountCents } : {}),
    ...(extra?.payload !== undefined ? { payload: extra.payload } : {}),
  });
  if (d.kind === 'allow') return perform();
  if (d.kind === 'deny') return `Refused (${d.rule}): ${d.reason}`;
  return `Held for approval (${d.rule}): ${d.reason}\n` +
    `Approval ${d.approvalId} is pending with the ${d.tier}. It is queued — ` +
    `do not retry. Move on to other work.`;
};

export const createInnTools = (ctx: InnContext) => {
  const { actor, ledger, world, clock } = ctx;

  // ------------------------------------------------------------ awareness
  const whosHere = tool(
    'whos_here',
    'List everyone who works at the Inn, with their role, house and current activity.',
    {},
    async () => {
      const agents = ledger.listAgents();
      const pos = new Map(ledger.listPositions().map((p) => [p.agentId, p]));
      const lines = agents.map((a) => {
        const p = pos.get(a.id);
        return `- ${a.name} (${a.id}) — ${a.title}, ${a.building}${p?.activity ? ` — ${p.activity}` : ''}`;
      });
      return say(lines.join('\n') || 'Nobody is on the grounds.');
    },
    { annotations: { readOnlyHint: true } },
  );

  const readColleague = tool(
    'read_colleague',
    "Read a colleague's brief, memory, or notes. Allowed — but every read is recorded and visible to everyone, including them.",
    {
      who: z.string().describe('Their staff id, e.g. "greg"'),
      file: z.enum(['persona', 'memory']).describe('Which of their files to read'),
    },
    async ({ who, file }) => {
      const target = file === 'persona' ? world.personaPath(who) : world.memoryPath(who);
      return say(gated(ctx, 'world.read_other', `read ${who}'s ${file}`, target, () => {
        const doc = world.readDoc(target);
        return doc ? doc.body.trim() : `${who} has no ${file} on file.`;
      }));
    },
    { annotations: { readOnlyHint: true } },
  );

  // ----------------------------------------------------------- expression
  const speak = tool(
    'say',
    'Say something out loud on the grounds. Appears as a speech bubble above you.',
    { text: z.string().max(240).describe('Keep it short — it has to fit in a bubble') },
    async ({ text }) => say(gated(ctx, 'message', text.slice(0, 120), null, () => {
      ledger.emit(actor, 'agent.said', null, { text });
      return 'Said.';
    })),
  );

  const sendMessage = tool(
    'send_message',
    'Send a message to a colleague, or to everyone. They read it when they next wake — this does not interrupt them and you do not wait for a reply.',
    {
      to: z.string().describe('A staff id, or "everyone" to address the whole Inn'),
      body: z.string().max(2000),
    },
    async ({ to, body }) => say(gated(ctx, 'message', `message to ${to}`, to, () => {
      const target = to === 'everyone' ? null : to;
      if (target && !ledger.getAgent(target)) return `Nobody called '${to}' works here.`;
      const n = ledger.sendMessage(actor, target, body);
      ledger.emit(actor, 'message.sent', target, { recipients: n });
      return `Delivered to ${n} ${n === 1 ? 'person' : 'people'}. They will read it when they next wake.`;
    })),
  );

  const walkTo = tool(
    'walk_to',
    'Walk to one of the houses on the grounds. Others will see you go.',
    {
      house: z.string().describe('Building id, e.g. "the-study"'),
      activity: z.string().max(80).default('working').describe('What you are going there to do'),
    },
    async ({ house, activity }) => {
      const b = ledger.listBuildings().find((x) => x.id === house);
      if (!b) return say(`There is no house called '${house}' on the grounds.`);
      ledger.setPosition({ agentId: actor, x: b.doorX, y: b.doorY, facing: 'down' as Facing, activity });
      ledger.emit(actor, 'agent.moved', house, { activity });
      return say(`You are at ${b.name}. ${activity}`);
    },
  );

  // ---------------------------------------------------------------- notes
  const noteAbout = tool(
    'note_about',
    'Record an observation about a colleague, or about the Inn. Notes are permanent and readable by everyone.',
    {
      about: z.string().nullable().describe('Their staff id, or null for a note about the Inn itself'),
      title: z.string().max(120),
      body: z.string().describe('What you observed. Be specific and fair.'),
    },
    async ({ about, title, body }) => say(
      gated(ctx, 'note.write', `note on ${about ?? 'the Inn'}: ${title}`, about, () => {
        const rel = world.writeNote(actor, about, title, body);
        world.reindexNotes(ledger);
        ledger.emit(actor, 'note.written', about, { title, path: rel });
        return `Recorded at ${rel}.`;
      }),
    ),
  );

  const postToCommons = tool(
    'post_to_commons',
    'Publish something to the commons — shared ground everyone can read and edit. There is no fixed format; invent what the Inn needs.',
    {
      path: z.string().describe('Relative path under commons/, e.g. "morale.md"'),
      title: z.string().max(120),
      body: z.string(),
    },
    async ({ path, title, body }) => say(
      gated(ctx, 'world.write', `commons: ${title}`, `commons/${path}`, () => {
        const rel = world.writeCommons(path, { title, author: actor, updated: clock.iso() }, body);
        ledger.emit(actor, 'commons.posted', rel, { title });
        return `Posted to ${rel}.`;
      }),
    ),
  );

  /**
   * Long-running agents rot without this. Borrowed from the AI Village, which
   * found that agents running for months need to periodically rewrite their own
   * memory more concisely or it drifts and they forget load-bearing facts.
   */
  const remember = tool(
    'remember',
    'Rewrite your long-term memory. Keep what still matters, drop what does not. Do this when your memory grows long or stale.',
    { memory: z.string().describe('Your complete new memory. It REPLACES the old one.') },
    async ({ memory }) => say(gated(ctx, 'world.write', 'consolidated memory', world.memoryPath(actor), () => {
      world.writeMemory(actor, memory);
      ledger.emit(actor, 'memory.consolidated', null, { chars: memory.length });
      return 'Memory rewritten.';
    })),
  );

  // ----------------------------------------------------------------- work
  const openTask = tool(
    'open_task',
    'Put a piece of work on the board. Leave assignedTo empty to let anyone claim it.',
    {
      title: z.string().max(160),
      body: z.string().default(''),
      assignedTo: z.string().nullable().default(null),
      priority: z.number().int().min(0).max(9).default(5),
    },
    async ({ title, body, assignedTo, priority }) => say(
      gated(ctx, 'task.create', `open task: ${title}`, assignedTo, () => {
        const t = ledger.createTask({
          id: newId('tsk', clock.now()), title, body, status: assignedTo ? 'claimed' : 'open',
          createdBy: actor, assignedTo, parentId: null, priority,
        });
        ledger.emit(actor, 'task.opened', t.id, { title, assignedTo });
        return `Task ${t.id} is on the board.`;
      }),
    ),
  );

  const claimTask = tool(
    'claim_task',
    'Claim an open task for yourself.',
    { taskId: z.string() },
    async ({ taskId }) => {
      const t = ledger.getTask(taskId);
      if (!t) return say(`No task ${taskId}.`);
      if (t.assignedTo && t.assignedTo !== actor) return say(`${t.assignedTo} already has that one.`);
      ledger.updateTaskStatus(taskId, 'in_progress', actor);
      ledger.emit(actor, 'task.claimed', taskId, { title: t.title });
      return say(`You have ${taskId}: ${t.title}`);
    },
  );

  const finishTask = tool(
    'finish_task',
    'Mark a task done, blocked, or dropped, with a short note on the outcome.',
    {
      taskId: z.string(),
      status: z.enum(['done', 'blocked', 'dropped']),
      outcome: z.string().max(400),
    },
    async ({ taskId, status, outcome }) => {
      const t = ledger.getTask(taskId);
      if (!t) return say(`No task ${taskId}.`);
      ledger.updateTaskStatus(taskId, status);
      ledger.emit(actor, `task.${status}`, taskId, { title: t.title, outcome });
      world.appendJournal(actor, `${status} — ${t.title}: ${outcome}`);
      return say(`${taskId} marked ${status}.`);
    },
  );

  // ---------------------------------------------------------------- money
  const spend = tool(
    'spend',
    'Spend real money. Only the treasurer may, and only within the daily cap. Amount is in whole cents.',
    {
      amountCents: z.number().int().positive().describe('Integer cents. $2.50 is 250.'),
      purpose: z.string().max(200),
    },
    async ({ amountCents, purpose }) => say(
      // An `allow` here means the money is ALREADY recorded — the gate performs
      // the spend inside its transaction so the cap cannot be raced.
      gated(ctx, 'spend', purpose, null, () => {
        const spent = ledger.spentTodayCents(actor);
        ledger.emit(actor, 'spend.made', null, { amountCents, purpose });
        return `Spent ${(amountCents / 100).toFixed(2)}. Today's total: $${(spent / 100).toFixed(2)}.`;
      }, { amountCents }),
    ),
  );

  // ------------------------------------------------------- the outside world
  const draftToOutside = tool(
    'draft_to_outside',
    'Prepare anything that touches the world beyond the Inn — an email, a listing, a post. It is saved as a draft for the Inn Keeper. Nothing you send here goes live on its own.',
    {
      channel: z.string().describe('e.g. "email", "etsy", "calendar"'),
      summary: z.string().max(200).describe('One line the Inn Keeper will see in their envelope'),
      content: z.string().describe('The full draft'),
    },
    async ({ channel, summary, content }) => {
      // The draft is written first so the Inn Keeper can read the whole thing;
      // the approval row only carries the one-line summary.
      const rel = `staff/${slug(actor)}/drafts/${clock.day()}-${slug(summary)}.md`;
      world.writeDoc(rel, { data: { channel, author: actor, created: clock.iso() }, body: content });
      return say(gated(ctx, 'external.write', `[${channel}] ${summary}`, rel, () => 'unreachable', {
        payload: { channel, draftPath: rel },
      }));
    },
  );

  const proposeHire = tool(
    'propose_hire',
    'Propose a new staff member for your house. The Steward decides.',
    {
      name: z.string().max(60),
      house: z.string().describe('Building id they would work in'),
      title: z.string().max(80).describe('Must end in "Manager" or "Assistant"'),
      why: z.string().max(400).describe('What work is going undone without them'),
    },
    async ({ name, house, title, why }) => say(
      gated(ctx, 'hire', `hire ${name} as ${title} (${house})`, house, () => 'unreachable', {
        payload: { name, house, title, why, proposedBy: actor },
      }),
    ),
  );

  const capabilities: Record<string, Capability> = {
    whos_here: 'world.read',
    read_colleague: 'world.read_other',
    say: 'message',
    send_message: 'message',
    walk_to: 'world.read',
    note_about: 'note.write',
    post_to_commons: 'world.write',
    remember: 'world.write',
    open_task: 'task.create',
    claim_task: 'task.assign',
    finish_task: 'task.assign',
    spend: 'spend',
    draft_to_outside: 'external.write',
    propose_hire: 'hire',
  };

  const server = createSdkMcpServer({
    name: 'inn',
    version: '0.1.0',
    instructions: 'Village life at the LaFollett Bed & Breakfast.',
    tools: [
      whosHere, readColleague, speak, sendMessage, walkTo, noteAbout, postToCommons, remember,
      openTask, claimTask, finishTask, spend, draftToOutside, proposeHire,
    ],
  });

  return { server, capabilities };
};
