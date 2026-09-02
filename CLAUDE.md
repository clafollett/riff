# Riff

Agentic company runner. One installation holds many companies; each is a
directory with its own world, ledger and scheduler.

## Read the repo, not this file, for anything the repo states

This file has asserted things the repo disproves in ninety seconds. Facts that
live in a file are read from that file:

| what | where |
| - | - |
| commands, scripts, dependencies | `package.json` |
| compiler flags and what they forbid | `tsconfig.json`, `desk/tsconfig.json`, `e2e/tsconfig.json` |
| directory layout of an installation | `src/core/config.ts`, `src/core/lock.ts` |
| what the gate allows | `src/policy/gate.ts`, `src/runtime/permissions.ts` |

## Runtime

```bash
nvm use 26     # REQUIRED FIRST. The default shell node is often older, and
               # every command fails on it with a syntax error.
```

The server runs `.ts` directly by type stripping — no build step, no emit.
That is why imports carry `.ts` extensions and why the compiler flags are
strict about erasable syntax. Read `tsconfig.json` before writing anything
unusual; `npm run check` is the arbiter.

Run `npm run check` and `npm test` before claiming a change works. Run
`npm run test:ui` when anything under `desk/` or `src/gateway/` changed.

## `.vue` is typechecked by a second compiler

`scripts/check-sfc-types.mjs` explains why, and running it is faster than
arguing with it. tsgo wins on any disagreement.

Desk types are imported from `src/`, never restated — one half of a pair with
SFC checking, and dropping either lets a renamed field render `undefined` while
passing every test.

## Data lives outside the repo

`~/.riff/`, never in the working tree. Each company is a self-contained
directory: its own ledger, its own `world/` git repo, its own config.

`config.json` stores identity only and never its own paths — those are derived
from the directory it sits in. `persisted()` in `src/core/config.ts` strips
them; write through it.

Any test touching config, registry, transfer or the gateway **must** run
against a throwaway root, or it reads and writes the operator's real companies:

```ts
env: { ...process.env, HOME: tmp, RIFF_ROOT: join(tmp, '.riff'),
       RIFF_COMPANY_ID: '' }
```

`HOME` alone is not enough. See `test/registry.test.ts`.

## The gate is the security boundary

`makeCanUseTool` in `src/runtime/permissions.ts` is the single chokepoint every
tool call crosses, built-ins included. It is **default-deny**.

```
if adding a tool, a capability, or a path classification:
    it must be refused by default and allowed explicitly
```

A control that could be argued with in a prompt is not a control. It goes in
the gate.

Shell requires both `RIFF_CONTAINED=1` and a container marker, and fails
closed. Do not relax either signal, and never weaken any of this to make a test
pass. Read `SECURITY.md` before touching `src/runtime/permissions.ts`,
`src/policy/gate.ts`, `src/company/transfer.ts`, or anything under `docker/`.

## Docker

Use `docker/up.sh`, never raw `docker compose` — compose interpolates the token
variable on every subcommand, so plain `docker compose logs` fails before it
prints a line.

`docker/.env` holds `RIFF_TOKEN_CMD`, a command that prints the token. It must
never hold the token itself, and nothing may write the resolved value to disk
or to a log.

## House style

Comments explain **why**, and carry the failure that motivated them. A comment
restating the line below it is noise — delete it.

Test names describe behaviour and survive refactors:
`test('an imported company arrives paused, whatever it was doing when it left')`.

Commit messages: sentence-case subject, no prefix tags, present tense, body
explaining the problem rather than the patch. Match `git log`.

A runtime dependency needs an issue first, per `CONTRIBUTING.md`;
`test/claims.test.ts` fails when a fifth arrives.

Claims in commits and docs must be checkable. `359 gate.allow out of 787` beats
"most of the log is noise" — and a claim that cannot check itself will go
stale, so prefer pointing at the thing over restating it.

`str.replace` and `sed` fail silently on no match. After any scripted edit,
grep for the new text and confirm it landed before reporting the change done.

## Note on this file

Staff agents never read it — sessions are created with `settingSources: []`,
and their file access is confined to their own world. This is for people
working on Riff.
