# Helmsted

Give it a company name, a line of business, and two names — yours and your
CEO's. It founds the company, and the CEO hires the rest.

There is no roster in this repo. Nothing here knows what departments your
company should have, what its staff should be called, or what it should build.
One agent starts work, and everything after that is a decision somebody in the
company made and can be read back.

```
npm install
node scripts/init.ts     # asks four questions, founds a company
npm run desk:build
npm run desk             # http://localhost:4173
node scripts/tick.ts <ceo>   # wake the CEO for one shift
```

---

## The six rules

1. Work well together.
2. Work however you see fit inside your mandate — the CEO approves what needs approving.
3. You may take work all the way to the outside world, but it always lands as a draft.
4. Only the treasurer may spend, up to $5.00 a day.
5. If the board is not around, do not stop.
6. The commons holds 40 documents. To add one past that, remove one.

**Rules 2, 3, 4 and 6 are code.** Every action an agent attempts crosses one
gate before it happens, and no tool bypasses it. Rule 3 has exactly one member
and no configuration to loosen it: there is one door to the outside world and
it opens onto your desk as a draft.

Rules 1 and 5 are deliberately not enforced. One is a disposition, the other is
a property of the scheduler.

**Rule 6 is the load-bearing one**, and it is there for an empirical reason. A
previous system of ours became unmanageable because agents accrete structure
and never remove any. Each addition is individually defensible; together they
are sediment. A human team simplifies because complexity hurts them daily —
agents feel nothing, so the pressure has to be structural. Variation without
selection is not emergence, it is a pile.

---

## Four tiers, and nothing else fixed

| tier | who | what the gate does |
| - | - | - |
| `board` | humans | terminal authority; bypasses the gate because it *is* the gate |
| `executive` | the CEO | signs hires and cross-desk writes |
| `lead` | whoever the CEO hires | may hire, with the CEO's signature |
| `member` | whoever the leads hire | works inside a mandate |

Roles and departments are free text an agent invents. Tiers are the only thing
the gate switches on, so the org chart can become anything without the policy
code learning a new shape.

The board governs; it does not manage. A seat proposed to report to a board
member is redirected to the requester, and the redirect is logged rather than
silent.

---

## Two kinds of storage, one rule

```
~/.helmsted/                     outside this repo — it is data, not source
  companies/<slug>/              one company, entirely self-contained
    world/                       a git repo of its own
      staff/<id>/                persona · memory · journal · notes · drafts
      commons/                   shared ground, no schema
    ledger.db                    node:sqlite
    config.json                  who this company is, and its connectors
  archive/<slug>-<stamp>/        removed companies, moved not deleted
```

One installation holds many companies. Nothing about one reaches into another —
separate ledgers, separate git repositories, separate schedulers — so founding
a second cannot disturb the first. Found, rename and archive them from the
console, or name one on the command line:

```bash
node scripts/status.ts --company lafollett-labs-llc
```

With one company, nothing needs naming. With several and no name given, every
script refuses rather than guessing which world to write to.

**If an agent invents it, it is a file. If breaking it breaks a rule or a
render, it is a row.**

That split is the point. `commons/` has no schema, so the staff can invent
structure nobody designed. Meanwhile the daily spend cap lives inside a
`BEGIN IMMEDIATE` transaction, because "check, then spend" across concurrent
agents is a race that leaks real money.

`world/` is its own git repo and is never pushed. Git does three jobs at once:
an attributed append-only log, a diff engine, and free time travel. Every
commit is authored **as the agent who made the change**, so

```bash
git -C ~/.helmsted/world log --since=3.days
```

answers *"what did they do while I was gone?"* — with diffs. The Desk's Record
view is that command with a reader attached.

---

## The Desk

A console at `http://localhost:4173`, because the work has to be reachable to
be reviewable.

| | |
| - | - |
| **Envelope** | everything waiting on the board, each draft rendered in full |
| **Record** | what actually landed in the world, by author, over a window |
| **Staff** | the report tree, each persona, and a way to leave word |
| **Commons** | the shelf, under the titles the authors chose |
| **Feed** | live events over SSE, newest first |

The Envelope shows the whole draft inline and asks for a reason. That reason is
not decoration: it opens the author's next shift. A gate whose rejections never
reach the person who could act on them terminates one step short of the point.

---

## Your company is yours

The repo holds code. The company holds history, and lives outside it. Two
people can clone this and run completely independent companies that share
nothing. Move or rename the project folder and a running company does not
notice.

Location resolves, never hardcoded:

```
HELMSTED_WORLD / HELMSTED_LEDGER  →  HELMSTED_HOME  →  HELMSTED_COMPANY_ID
                                  →  ./helmsted.config.json  →  the only company
                                  →  built-in defaults
```

`HELMSTED_ROOT` moves the whole installation, which is how the test suite keeps
its hands off yours.

Identity — `HELMSTED_COMPANY`, `HELMSTED_BUSINESS`, `HELMSTED_CHAIR`,
`HELMSTED_CEO` — overrides the stored config on every read, which is what makes
a container run reproducible from environment alone.

---

## Running it in a box

Agents need bash, git, a compiler and a package manager to build anything worth
reviewing. Handing them that on your own machine is not the deal, and shrinking
the tool allowlist just turns into a blocklist you maintain forever. So the
boundary is structural:

```bash
cp docker/.env.example docker/.env    # put your token in it
docker compose -f docker/compose.yaml up --build
```

Two containers. `factory` has the real tools and your token, and sits on a
network with **no route off the machine**. `egress` is the only door, forwarding
to an anchored-regex allowlist. An agent that talks its way past every check
still has nowhere to send anything.

The token is yours to generate and yours alone to see:

```bash
claude setup-token
```

It goes in `docker/.env`, which is gitignored. Compose refuses to start without
it and says so.

---

## Commands

| | |
| - | - |
| `npm run desk` | serve the console |
| `npm run desk:build` | build it first |
| `npm test` | 77 unit tests |
| `npm run test:ui` | 21 Playwright tests against a throwaway installation |
| `npm run check` | typecheck all three projects (TypeScript 7, native) |
| `node scripts/init.ts` | found a company |
| `--company <slug>` | any script, when more than one company exists |
| `node scripts/tick.ts <who> [turns]` | wake one person, once, and trace the shift |
| `node scripts/status.ts` | headcount, tasks, commons, what is pending |
| `node scripts/review.ts [id]` | read what is waiting on the board, in full |
| `node scripts/decide.ts <id> yes\|no "reason"` | answer it from a terminal |
| `node scripts/board-note.ts <who> "..."` | leave word for someone |
| `node scripts/run-overnight.ts [hours] [shifts]` | unattended, with hard stops |

`tick.ts` is how you prove a change before letting a company loose. It traces
every tool call and every gate decision.

---

## Connecting the outside world

`config.json` takes MCP servers, handed to every staff session:

```json
{
  "connectors": {
    "images": { "type": "http", "url": "https://example.com/mcp" }
  }
}
```

Helmsted knows nothing about any provider. Anything a connector reaches still
crosses the gate: touching the outside world is `external.write`, which always
lands as a draft. Credentials go in that file, which is gitignored.

---

## What runs where

| | |
| - | - |
| Node | 26 — native TypeScript, no build step on the server |
| TypeScript | 7 (Go-native), typechecking only |
| Database | `node:sqlite`, built into the runtime |
| Server | `node:http` + SSE |
| Console | Vue 3 + Vite |
| Agents | `@anthropic-ai/claude-agent-sdk` |

Runtime dependencies: the Agent SDK, `zod`, and Vue. That is the whole list.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the gate, the ledger
and the tick loop actually work.
