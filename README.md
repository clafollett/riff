# The LaFollett Bed & Breakfast

A village where AI staff live and work, running real parts of your life — under
rules enforced in code, not requested in prompts.

You are the **Inn Keeper**: the only human on the property, and a resident of the
world rather than an admin above it. You walk around, talk to people, and hand
them work. Everyone else is an agent with a persona, a house, a memory, and a
job. They keep working when you close the laptop.

```
npm install
node scripts/init.ts     # asks who keeps the Inn, builds it
npm run inn              # http://localhost:4173
```

That is the whole install. The Inn builds itself on first boot, so `npm run inn`
alone works too.

---

## The five House Rules

1. Work well together.
2. Get work done however you see fit — so long as the Steward approves what needs approving.
3. You may take work all the way out into the real world, but it always lands as a draft.
4. Only the treasurer may spend money, up to $5.00 a day.
5. If the Inn Keeper is not around, do not stop.

**Rules 2, 3 and 4 are code.** Every action a staff member attempts crosses a
policy gate before it happens, and there is no tool surface that bypasses it.
Rule 3 has no override and no config to loosen it: there is exactly one door to
the outside world, and it opens onto your desk as a draft.

Rules 1 and 5 are deliberately *not* enforced. One is a disposition, the other is
a property of the scheduler. Nothing checks them but each other.

---

## Who lives here

| role | title | |
| - | - | - |
| `innkeeper` | Inn Keeper | you — the only human |
| `steward` | Steward | runs the Inn on your behalf; the only one who may spend |
| `house_manager` | *&lt;House&gt;* Manager | ten of them, one per house |
| `house_assistant` | *&lt;House&gt;* Assistant | hired by the managers, with your Steward's approval |

Titles always contain their role, so you can never read one and guess wrong.

---

## Two kinds of storage, one rule

```
~/.lafollett-bnb/            outside this repo — it is data, not source
  world/                     a git repo of its own
    house-rules.md
    staff/<id>/              persona · memory · journal · notes · drafts
    commons/                 shared ground, no schema
    assets/                  art the village made for itself
  ledger.db                  node:sqlite
  config.json                who keeps the Inn, where things live, connectors
```

**If a staff member invents it, it is a file. If breaking it breaks a House Rule
or a render frame, it is a row.**

That split is the point. `commons/` has no schema, so the staff can invent state
nobody designed — which is the only way a thing like a morale meter can appear on
its own. Meanwhile the daily spend cap lives in a `BEGIN IMMEDIATE` transaction,
because "check then spend" across concurrent staff is a race that leaks real money.

`world/` is its own git repo and is never pushed anywhere. Git is doing three jobs
at once here: an attributed append-only log, a diff engine, and free time travel.
Every commit is authored **as the staff member who made the change**, so:

```bash
git -C ~/.lafollett-bnb/world log --since=3.days
```

...is the answer to *"what did they do while I was gone?"* — with diffs.

---

## Your Inn is yours

The repo holds code. The Inn holds history, and lives outside it. Two people can
clone this and run completely independent villages that share nothing — same
opening staff, zero shared memories. Move or rename the project folder and a
running Inn does not notice.

Location resolves, never hardcoded:

```
INN_WORLD / INN_LEDGER  →  INN_HOME  →  ./inn.config.json
                        →  ~/.lafollett-bnb/config.json  →  built-in defaults
```

---

## Commands

| | |
| - | - |
| `npm run inn` | serve the village |
| `npm test` | the suite (48 tests) |
| `npm run check` | typecheck (TypeScript 7, native) |
| `node scripts/init.ts` | build the Inn, ask who keeps it |
| `node scripts/roster.ts` | who works here |
| `node scripts/status.ts` | tasks, notes, contributions, morale |
| `node scripts/tick.ts <who> [turns]` | wake one person, once, and trace the shift |

`tick.ts` is how you prove a change before letting a village loose. It traces
every tool call and every gate decision.

---

## Connecting the outside world

`config.json` takes MCP servers, handed to every staff session:

```json
{
  "connectors": {
    "higgsfield": { "type": "http", "url": "https://mcp.higgsfield.ai" }
  }
}
```

The Inn knows nothing about any provider. With an image generator connected, the
Workshop can `commission_art` and hang its own sprites — the renderer asks for an
asset key and falls back to drawn geometry, so the village improves piece by piece
with no rebuild. Generating costs credits, so it crosses the money gate first.

Credentials go in that file, which is gitignored.

---

## What runs where

| | |
| - | - |
| Node | 26 — native TypeScript, no build step on the server |
| TypeScript | 7 (Go-native), typechecking only |
| Database | `node:sqlite`, built into the runtime |
| Server | `node:http` + SSE |
| Client | plain canvas, no engine, no bundler |
| Agents | `@anthropic-ai/claude-agent-sdk` |

Runtime dependencies: the Agent SDK and `zod`. That is the whole list.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the gate, the ledger and
the tick loop actually work.
