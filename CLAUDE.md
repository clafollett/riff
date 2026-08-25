# Helmsted

Agentic company runner. One installation holds many companies; each is a
directory with its own world, ledger and scheduler.

## Runtime

```bash
nvm use 26     # REQUIRED FIRST. The default shell node is often older, and
               # every command below fails on it with a syntax error.
```

Node ≥26. The server runs `.ts` directly by type stripping — no build step, no
emit. Consequences that change what you may write:

| Constraint | Effect on source |
| - | - |
| `erasableSyntaxOnly` | no `enum`, no parameter properties, no `namespace` |
| `verbatimModuleSyntax` | `import type` for every type-only import |
| `noUncheckedIndexedAccess` | `arr[0]` is `T \| undefined`; `!` or narrow |
| `exactOptionalPropertyTypes` | spread conditionally: `...(x ? { k: x } : {})` |
| `.ts` extensions in imports | `from './gate.ts'`, never `./gate` |

## Commands

| | |
| - | - |
| `npm run check` | tsgo over src, desk and e2e + the SFC import check |
| `npm test` | unit (`node --test`) |
| `npm run test:ui` | Playwright; builds the console first |
| `npm run desk:build && npm run desk` | console at `http://localhost:4173` |
| `node scripts/tick.ts <who>` | wake one agent once, tracing every gate decision |
| `docker/up.sh check` | prove the token wiring, start nothing |
| `docker/up.sh up --build` | run the contained stack |

Run `npm run check` and `npm test` before claiming a change works. Run
`npm run test:ui` when anything under `desk/` or `src/gateway/` changed.

## `.vue` files are NOT typechecked

`vue-tsc` needs TypeScript 5; this repo is on 7. tsgo does not parse SFCs.

The failure this permits: a component calling `computed()`/`ref()`/`watch()`
without importing it throws at setup and renders **nothing**, while every type
check passes and the build succeeds. `scripts/check-sfc-imports.mjs` catches
exactly that and runs inside `npm run check`.

After editing a `.vue` file, verify it renders — do not rely on the typechecker.

## Data lives outside the repo

```
~/.helmsted/                    the installation. NEVER in the working tree.
  .lock                         one writer; heartbeat, not pid
  companies/<slug>/
    config.json                 identity only — never its own paths
    ledger.db                   node:sqlite
    world/                      a git repo; staff/<id>/ and commons/
  archive/<slug>-<stamp>/
```

`config.json` must not store `home`, `worldDir` or `ledgerPath`. They are
derived from the directory. `persisted()` in `src/core/config.ts` strips them;
write through it.

Any test that touches config, registry, transfer or the gateway **must** run
against a throwaway root, or it reads and writes the operator's real companies:

```ts
env: { ...process.env, HOME: tmp, HELMSTED_ROOT: join(tmp, '.helmsted'),
       HELMSTED_COMPANY_ID: '' }
```

`HOME` alone is not enough. See `test/registry.test.ts` for the pattern.

## The gate is the security boundary

`makeCanUseTool` in `src/runtime/permissions.ts` is the single chokepoint every
tool call crosses, built-ins included. It is **default-deny**: an unrecognised
tool is refused.

```
if adding a tool, a capability, or a path classification:
    it must be refused by default and allowed explicitly
if a control could be argued with in a prompt:
    it is not a control — put it in the gate
```

Shell is decided by `shellIsContained()`, which requires both
`HELMSTED_CONTAINED=1` and a container marker, and fails closed. Do not relax
either signal.

Never weaken these to make a test pass. Read `SECURITY.md` before touching
`src/runtime/permissions.ts`, `src/policy/gate.ts`,
`src/company/transfer.ts`, or anything under `docker/`.

## Dependencies

Four at runtime: the Agent SDK, `zod`, `markdown-it`, `vue`. Adding a fifth
needs a discussion first, per `CONTRIBUTING.md`. Archives shell out to `tar`,
which the base image already carries.

## House style

Comments explain **why**, and carry the failure that motivated them. A comment
restating the line below it is noise — delete it.

Test names describe behaviour and survive refactors:
`test('an imported company arrives paused, whatever it was doing when it left')`.

Commit messages: sentence-case subject, no prefix tags, present tense, body
explaining the problem rather than the patch, ending with the test counts.
Match `git log` — that is the house style.

Claims in commits and docs must be checkable. `359 gate.allow out of 787` beats
"most of the log is noise".

## Verifying edits

`str.replace` and `sed` fail silently on no match. After any scripted edit,
grep for the new text and confirm it landed before reporting the change done.

## Docker

Use `docker/up.sh`, never raw `docker compose` — compose interpolates the token
variable on every subcommand, so plain `docker compose logs` fails before it
prints a line.

`docker/.env` holds `HELMSTED_TOKEN_CMD`, a command that prints the token. It
must never hold the token itself, and nothing may write the resolved value to
disk or to a log.

## Note on this file

Staff agents never read it. Sessions are created with `settingSources: []`,
which disables project and user `CLAUDE.md` loading, and their file access is
confined to their own world. This file is for people working on Helmsted.
