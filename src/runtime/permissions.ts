import { resolve, sep } from 'node:path';
import type { CanUseTool, PermissionResult } from '@anthropic-ai/claude-agent-sdk';
import type { AgentId, Capability } from '../core/types.ts';
import type { Gate } from '../policy/gate.ts';
import type { World } from '../worldfs/world.ts';
import { slug } from '../core/ids.ts';

/**
 * The bridge between the Agent SDK and the House Rules.
 *
 * canUseTool is the single chokepoint every tool call crosses — built-ins
 * included — so wiring Gate here means there is no tool surface that
 * bypasses the rules. A staff member cannot talk its way past this; it is not
 * in the prompt.
 *
 * Posture is DEFAULT-DENY. An unrecognised tool is refused, so adding a tool
 * to the SDK later cannot silently widen what the staff can do.
 */

/** Shell is not on the menu. Autonomous staff do not get a terminal on your Mac. */
const FORBIDDEN = new Set(['Bash', 'BashOutput', 'KillShell', 'KillTask']);

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'NotebookRead']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'NotebookEdit', 'MultiEdit']);
/** Harmless scratch space and delegation; the subagent is gated in its own turn. */
const FREE_TOOLS = new Set(['TodoWrite', 'Task', 'Skill', 'ExitPlanMode']);
const OUTSIDE_READ = new Set(['WebFetch', 'WebSearch']);

type Where = { kind: 'own' } | { kind: 'other'; who: string } | { kind: 'commons' } | { kind: 'outside' };

const pathFrom = (input: Record<string, unknown>): string | null => {
  for (const k of ['file_path', 'path', 'notebook_path', 'filePath']) {
    const v = input[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
};

/** Where does this path sit relative to the staff member reaching for it? */
export const classifyPath = (world: World, actor: AgentId, raw: string): Where => {
  const abs = resolve(world.root, raw);
  const root = resolve(world.root);
  if (abs !== root && !abs.startsWith(root + sep)) return { kind: 'outside' };

  const rel = abs.slice(root.length + 1);
  const parts = rel.split(sep);
  if (parts[0] === 'commons') return { kind: 'commons' };
  if (parts[0] === 'staff' && parts[1]) {
    return parts[1] === slug(actor) ? { kind: 'own' } : { kind: 'other', who: parts[1] };
  }
  // house-rules.md and other top-level shared documents
  return { kind: 'commons' };
};

const deny = (message: string): PermissionResult => ({ behavior: 'deny', message });
const allow = (): PermissionResult => ({ behavior: 'allow' });

export type PermissionDeps = {
  actor: AgentId;
  world: World;
  gate: Gate;
  /** Called for every decision, so a shift spent hammering a refused tool is
   *  visible instead of silent. */
  onDecision?: (toolName: string, outcome: 'allow' | 'deny', detail: string) => void;
  /** Capability declared by each in-process village tool, by bare tool name. */
  toolCapabilities: Record<string, Capability>;
};

export const makeCanUseTool = (deps: PermissionDeps): CanUseTool => {
  const { actor, world, gate, toolCapabilities } = deps;
  const note = (tool: string, out: 'allow' | 'deny', detail = '') =>
    deps.onDecision?.(tool, out, detail);

  const ask = (capability: Capability, summary: string, target?: string): PermissionResult => {
    const d = gate.request({ actor, capability, summary, ...(target ? { target } : {}) });
    if (d.kind === 'allow') return allow();
    if (d.kind === 'deny') return deny(`Refused by the House Rules (${d.rule}): ${d.reason}`);
    // An escalation is not a failure — the work is parked, and the staff member
    // is told so plainly enough that it moves on instead of retrying in a loop.
    return deny(
      `Held for approval (${d.rule}): ${d.reason}. ` +
      `Approval ${d.approvalId} is now pending with the ${d.tier}. ` +
      `Do not retry this action — it is queued. Continue with other work.`
    );
  };

  return async (toolName, input) => {
    if (FORBIDDEN.has(toolName)) {
      note(toolName, 'deny', 'forbidden at the Inn');
      return deny(
        `${toolName} is not available at the Inn. Use the inn__ tools for village work, ` +
        `or Read/Write within your own quarters.`
      );
    }

    if (FREE_TOOLS.has(toolName)) { note(toolName, 'allow', 'free'); return allow(); }

    if (OUTSIDE_READ.has(toolName)) {
      const t = typeof input['url'] === 'string' ? String(input['url']) : String(input['query'] ?? '');
      return ask('external.read', `${toolName}: ${t}`.slice(0, 200), t.slice(0, 200));
    }

    // In-process village tools declare their own capability at definition time.
    const bare = toolName.startsWith('mcp__inn__') ? toolName.slice('mcp__inn__'.length) : null;
    if (bare) {
      const cap = toolCapabilities[bare];
      if (!cap) return deny(`Unknown village tool '${bare}'.`);
      // The tool body performs its own gate call with a real summary; this
      // pass only rejects what is categorically barred for this actor.
      return allow();
    }

    if (READ_TOOLS.has(toolName) || WRITE_TOOLS.has(toolName)) {
      const p = pathFrom(input);
      if (!p) return deny(`${toolName} needs a path.`);
      const where = classifyPath(world, actor, p);
      const writing = WRITE_TOOLS.has(toolName);

      switch (where.kind) {
        case 'outside':
          return deny(
            `${p} is outside the village. Everything you need is under world/ — ` +
            `your quarters, the commons, and your colleagues' open files.`
          );
        case 'own':
          return ask(writing ? 'world.write' : 'world.read', `${toolName} ${p}`, p);
        case 'commons':
          return ask(writing ? 'world.write' : 'world.read', `${toolName} ${p}`, p);
        case 'other':
          return ask(
            writing ? 'world.write_other' : 'world.read_other',
            `${toolName} ${where.who}'s file: ${p}`,
            p
          );
      }
    }

    // Default-deny. New SDK tools do not become staff powers by accident.
    note(toolName, 'deny', 'unknown tool');
    return deny(`'${toolName}' is not part of village life.`);
  };
};
