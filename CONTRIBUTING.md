# Contributing

Thanks for looking. Riff is small on purpose and the bar for adding to it
is deliberately high, so this is mostly about what *not* to send.

## Before you write code

Open an issue first for anything that adds a dependency, a configuration
option, a tool the staff can call, or a view in the console. Those four are
where this project accretes weight, and weight is the failure mode it is
built to resist — the whole reason the commons has a ceiling is that a previous
system of ours became unmanageable by adding individually defensible things.

Bug fixes, tests, and documentation need no permission at all. Send them.

## Getting set up

Node **26 or newer**. There is no build step for the server: Node runs the
TypeScript directly by stripping types, which is why `erasableSyntaxOnly` is
on and why you will not find an `enum` or a parameter property anywhere.

```bash
npm install
npm run check    # types: src, desk and e2e
npm test         # unit
npm run test:ui  # browser, against a throwaway installation
```

`npm run check` runs `tsgo`. Note that **`.vue` files are not typechecked** —
`vue-tsc` needs TypeScript 5 and this repo is on 7. `scripts/check-sfc-imports.mjs`
covers the one failure that kept biting: a component calling `computed()` or
`ref()` without importing it, which throws at setup and renders nothing while
every type check passes.

To run the console against real companies:

```bash
npm run desk:build && npm run desk
```

## What good looks like here

**Prove it, do not assert it.** Every claim in a commit message should be one
someone could check. "Two thirds of a busy company's log is machinery" is a
claim; `359 gate.allow out of 787` is the same claim with the receipt attached.
If you fixed a bug, the commit should say what the bug actually did to someone.

**Comments explain why, and only where why is not obvious.** The codebase has
a lot of them and they are almost all about a decision or a failure — what
broke, what was tried, what the constraint is. A comment restating the line
below it is noise; delete it if you find one.

**Tests describe behaviour, not methods.** `test('an imported company arrives
paused, whatever it was doing when it left')` is the style. A test name should
survive a refactor of the thing it tests.

**Do not add a runtime dependency without a very good reason.** There are four,
and each earns its place. `tar` is shelled out to rather than added as a
package because tar is already on every machine that can run this.

## Security work

If you have found something that lets a staff member reach outside its company,
its container, or its spend cap, **do not open a public issue** — see
[SECURITY.md](SECURITY.md).

If you are hardening something, the tests in `test/permissions.test.ts`,
`test/container.test.ts` and `test/transfer.test.ts` are the pattern: assert
against what the code actually reads, not against what the documentation says
it reads. `container.test.ts` exists specifically so the compose file and the
source cannot drift apart quietly.

## Branches

Work starts from an issue, and the branch carries its number:

```
feat/<issue>-short-slug     fix/<issue>-short-slug
docs/<issue>-short-slug     chore/<issue>-short-slug
```

`feat/1-vitals-and-analytics`, not `vitals`. The number is the part that
survives — it is what lets a branch, a PR and a commit find the argument that
produced them a year later. If there is no issue yet, open one first: it is
where the *why* goes, and the diff cannot hold that.

## Commit messages

Sentence-case subject line, no prefix tags, present tense, and a body that
explains the problem rather than the patch. Look at `git log` — that is the
house style, and it is not negotiable in the sense that a PR written in a
different one will just get rewritten before merge.

## Licence

By contributing you agree your work is licensed under Apache-2.0, matching
[LICENSE](LICENSE). There is no CLA.
