# Architecture

How Riff actually works, and why the awkward decisions are the way they are.

---

## The shape

```
desk/            Vue 3 — a projection of the ledger, not a source of truth
   │ SSE + POST
gateway/         node:http · /api/state · /api/stream · the envelope · the record
   │
runtime/         one Agent SDK session per staff member
   ├ staff.ts       assembles context, runs a shift, journals it
   ├ scheduler.ts   Rule 5 — wakes people, paced by the rate limiter
   ├ permissions.ts canUseTool → Gate  (the chokepoint)
   ├ tools.ts       the company toolset
   └ executor.ts    applies approvals AFTER a decision
   │
policy/          the six rules, as code
ledger/          node:sqlite — events, tasks, approvals, spend, mail, positions
worldfs/         markdown + git, attributed per staff member
```

---

## The gate is a chokepoint, not a request

The Agent SDK routes **every** tool call — built-ins included — through one
`canUseTool` callback. `PolicyGate` sits there. There is no tool surface that
bypasses it, which is the difference between a rule and a suggestion.

Posture is **default-deny**: an unrecognised tool is refused, so a tool the SDK
adds in a future version cannot silently become a staff power.

### The shell is decided by where the runtime is

Autonomous agents with a terminal on the operator's Mac is a bad trade for no
gain, so on the host `Bash`, `BashOutput`, `KillShell` and `KillTask` are
refused outright — and they are also kept out of the tool list the model is
shown, so no turn is spent reaching for something that cannot be granted.

Inside the container the shell is the entire point. Nothing worth reviewing
gets built without a compiler and a package manager, and the answer to that is
not an allowlist that shrinks forever — it is a box with no route to the
internet.

Opening it requires **both** an explicit `RIFF_CONTAINED=1` and a container
marker file on disk. The variable alone would let a mistyped export on a laptop
hand out a terminal; the marker alone would open one in any container at all.
Either missing means no shell.

A gate escalation is returned to the agent as a *deny carrying the approval id*
and an explicit "this is queued, do not retry." Without that, a held draft
becomes a retry loop that burns turns against a wall.

### Two passes, because they know different things

`canUseTool` sees a tool name and raw input. The tool body knows the *amount*,
the *target*, and the one-line summary that lands in your envelope. So the gate
runs twice: once categorically at the chokepoint, once meaningfully in the tool.

### `spend` is not advisory

For every other capability, the gate decides and the caller then acts. For money
those must be one atomic step, so **an `allow` for `spend` means the money has
already been recorded.** There is deliberately no way to ask "would this be
allowed?" for money — that question *is* the race.

```sql
BEGIN IMMEDIATE            -- write lock BEFORE the read
  SELECT SUM(amount_cents) WHERE agent_id=? AND spend_day=?
  -- refuse, or insert
COMMIT
```

Without `IMMEDIATE`, two staff spending concurrently both observe the same
"remaining" and both pass. The cap leaks real money.

Approvals are exactly-once via a conditional `UPDATE ... WHERE state='pending'`,
so a double-click in your envelope cannot publish a draft twice.

---

## Files vs rows

**If an agent invents it, it is a file. If breaking it breaks a rule or a
render, it is a row.**

Emergence needs an unschematised place to live. A scoring rubric nobody designed
can only appear if inventing new state costs no migration — so `commons/` has no
schema at all. Meanwhile the spend cap must be transactional and approvals must
be exactly-once, so those are rows.

`notes_index` is the one table that is **derived**. The markdown files are the
truth; the index only exists so the UI can count and sort. Delete it and rebuild
it any time.

### Why `world/` is its own git repo

Git does three jobs here: attributed append-only log, diff engine, and time
travel. Commits are authored *as the staff member*, so `git log` answers "what
happened while I was gone" better than any query, and `contributionsSince()` is a
**computed** "who actually did the work" — not self-reported.

It lives outside the project because it is data. It shares no history with your
source, and a fresh clone gets a fresh company.

> A repo nested inside another repo bit us once: `rev-parse --git-dir` walks
> **up**, so "am I a repo?" answers yes for a directory that has never been
> initialised, and every world commit lands in the parent. `init()` now compares
> `--show-toplevel` against its own realpath. The regression test builds the real
> nested shape, because a tmpdir with no parent repo hides the bug entirely.

---

## A shift

```
wake → assemble context → run the SDK session → journal it → commit as them → sleep
```

Context is split along the cache boundary:

- **System prompt (stable):** persona · the six rules · memory · **the roster**
- **User prompt (volatile):** mail · your tasks · the open board · recent events

The roster is in the system prompt for a measured reason. Cold-started against
a ten-person roster, the senior agent spent ten turns reading colleagues' briefs
before doing anything — its first shift hit the turn cap having produced nothing
at all. Handing it the roster cut the next shift from 27 turns to 12.

### Isolation

The SDK loads the operator's `~/.claude/settings.json` **and their `CLAUDE.md`**
when `settingSources` is omitted. Every staff member would boot with the same
borrowed personality, and private operator instructions would leak into all of
them.

```ts
settingSources: [],        // documented isolation mode
systemPrompt: <string>,    // a plain string; the {type:'preset'} form would
                           // inject the Claude Code prompt over their persona
strictMcpConfig: true,
```

### Memory

Long-running agents rot. Borrowed from the AI Village: staff periodically rewrite
their own memory more concisely via `remember`, keeping what still matters. The
memory file *replaces*, never appends.

---

## Mail is asynchronous on purpose

A message is a row the recipient picks up on their **next tick** — never a
blocking call into another agent. Synchronous messaging across twenty-two staff
deadlocks (A waits on B waits on A) and bills a full turn per message. Broadcasts
fan out to one row per recipient at send time, which keeps read-tracking
per-person trivial.

---

## Pacing (Rule 5)

The scheduler wakes staff on a stagger — jittered so ticks never phase-lock, and
scaled by tier so the CEO keeps a closer eye on things than a member.

On a Claude subscription, inference is covered and **dollars are the wrong
governor**. The SDK reports `SDKRateLimitInfo` (`five_hour`, `seven_day_opus`,
utilization), so:

| signal | response |
| - | - |
| `rejected` | rest until the window resets — hammering it burns the next one |
| `allowed_warning` | stretch every interval 3× |
| high `utilization` | throttle proportionally |

Dollar caps remain for metered API billing, defaulted off.

> This is separate from Rule 4. Rule 4 governs the *staff's real-world spending*;
> this governs *your inference*. Conflating them would be a bug.

---

## Approvals are applied by the company, not the requester

`executor.ts` runs after a decision, in code that never executed inside the
requester's session — so "get it approved" and "do it" cannot collapse into one
step an agent drives alone. Idempotent via `applied:<id>` keys.

---

## The Desk is a projection

It draws from `/api/state`, an SSE tail of the event log, and `git log`. It
holds no authority: every surface is a read of something the company already
did, and the only writes it can perform are a board decision and a note.

It exists because the previous UI made the work unreachable. So the design rule
is that nothing is summarised where it could be shown — the Envelope renders
each draft in full, the Commons opens documents under their authors' titles
with the frontmatter stripped off, and the Record is `git log` with a reader
attached rather than a retelling of the event stream.

Agent prose is rendered through a deliberately small Markdown pass that
**escapes before it formats**. Everything on those pages was written by a model,
so `v-html` is only defensible because markup can no longer become markup by the
time any formatting rule runs.

> A rendering bug worth remembering, found by measuring rather than looking: a
> `<span>` fill is `display:inline`, and inline boxes **ignore width and
> height**, so a progress bar silently measured 0×0 while looking plausible in
> a screenshot. Read `getBoundingClientRect` off the live DOM.
