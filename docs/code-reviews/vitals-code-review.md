# Code Review: vitals

**Verdict:** ✅ APPROVED

| | |
| - | - |
| **Branch** | `vitals` |
| **PR** | — (local branch review) |
| **Author** | Claude Opus 5 — every line of this branch |
| **Reviewer** | Claude Opus 5 (backend), `pe-vue` subagent (console) |
| **Human review** | None. See *Standing of this review*. |
| **Review Round** | 1 |
| **Reviewed SHA** | `8697cbd97f54e8d3454da660220942137ade3ebe` |
| **Title** | Vitals — read the company back as numbers |
| **Files Changed** | 12 |
| **Lines Changed** | +1919 / -13 |
| **Date** | 2026-09-01 |

---

## Standing of this review

The code was written by a model and reviewed by models. No human has read it.
Commit authorship says `Cali LaFollett` because that is the configured git
identity, not because a person wrote or read these lines.

That matters for how much this document is worth. `pe-vue` was genuine outside
review of the console — a separate agent that pulled its own diff, ran its own
commands, and found four things the author missed, including one the author had
called clean. The backend had no such check: the same model wrote it, reviewed
it, agreed with itself, and recorded the result here.

Two of the twelve findings were caught only because the report was run against
a real ledger and the numbers disagreed with the code's intent. None of the
twelve came from a person.

Treat the verdict as "no model found anything further", which is a weaker claim
than approval.

---

## Summary

Adds an analytics layer that projects the event log, the ledger tables and the
world's git history into a report, exposed three ways: `scripts/vitals.ts`,
`GET /api/vitals`, and a Desk view. No table backs it and nothing is recorded
for it, so the window costs nothing to widen.

Twelve findings, all remediated in three follow-up commits on the branch. One
HIGH, five MEDIUM, six LOW/INFO, no CRITICAL and no blockers. The two that
mattered are both cases of a metric that fails in the direction of comfort: a
board backlog that vanished from the figure reporting it as it got worse, and a
refusals table that would empty itself on exactly the busy company that needed
it. Both were latent — neither shows on the current dataset.

Dispatch: `pe-vue` for `desk/` and `e2e/`; generic three-pass by the primary for
the Node/TS backend, which no built-in PE covers.

---

## Findings Overview

| Severity | In Scope | Out of Scope |
| - | - | - |
| 🔴 CRITICAL | 0 | 0 |
| 🟠 HIGH | 1 | 0 |
| 🟡 MEDIUM | 5 | 0 |
| 🟢 LOW | 6 | 2 |
| ℹ️ INFO | 0 | 0 |

All in-scope findings are fixed at the reviewed SHA.

---

## In Scope Findings

### 🟠 HIGH-001: "Still pending" was read out of the window, so the oldest drafts vanished from it

**Domains:** [Correctness]
**Location:** `src/analytics/vitals.ts:412` (at time of finding)
**Status:** ✅ Fixed in `7d34617`

`envelope.pending` and `oldestPendingHours` were filtered from
`approvalsBetween(since, until)`, which returns approvals whose `requested_at`
OR `decided_at` falls inside the window. A draft nobody has answered has
neither: it was filed once, before the window, and nothing has happened to it
since.

So the drafts that had waited longest fell out of the exact figure that exists
to name them, and the longer the board left one, the more certain it was to
disappear. A worsening backlog made the report look healthier.

**Recommendation (applied):** pending is a current state, not a windowed event.
Read it with `ledger.listApprovals('pending')`. Regression test:
`the oldest draft on the board is visible however long ago it was filed`.

---

### 🟡 MEDIUM-001: The refusals table would empty itself on a busy company

**Domains:** [Correctness]
**Location:** `src/analytics/vitals.ts:568`, `desk/src/views/Vitals.vue:229`
**Status:** ✅ Fixed in `3b50933`
**Found by:** pe-vue (M2)

The server returned `rules: gateRows.slice(0, 20)` ordered by count descending,
and the console filtered `allow` rows out client-side. Allows outnumber refusals
by orders of magnitude and sort to the head of that same list — **2966 to 11**
over a real 30-day window on `lafollett-labs`. Once distinct allow combinations
exceed twenty, every refusal falls outside the slice and the section `v-if`s
itself away, with no error and nothing visibly missing.

Verified against the real ledger: that company currently has 9 distinct
`(kind, rule, capability)` rows, so the `R3.drafts_only` escalate row survives
today. Nothing bounds that number as capabilities and rules multiply.

**Recommendation (applied):** cut server-side and carry refusals only, which
also makes the client filter redundant (folds in INFO-002). Regression test:
`the listed rules are refusals, however many allows are ahead of them` floods
40 allow combinations and asserts the single deny survives.

---

### 🟡 MEDIUM-002: A document removed and put back counted as a rewrite

**Domains:** [Correctness]
**Location:** `src/analytics/vitals.ts:391`
**Status:** ✅ Fixed in `7d34617`

First appearance was measured with `commonsHistory()`, which is `MIN(at)` over
all history. A document posted, removed, then posted again therefore scored as a
revision rather than an addition.

Remove one to add one is the single act Rule 6 exists to encourage, so the
company doing the right thing scored as having done nothing.

**Recommendation (applied):** a posting adds when the shelf was not already
holding it — never seen before, or removed before this posting put it back.
Added `Ledger.commonsRemovals()`. Two regression tests, including the inverse
case (removed *after* its last posting stays a rewrite).

---

### 🟡 MEDIUM-003: Trend arrows coloured direction, not judgement

**Domains:** [Correctness, UX]
**Location:** `desk/src/views/Vitals.vue:40,302-303`
**Status:** ✅ Fixed in `3b50933`
**Found by:** pe-vue (M1)

`delta()` mapped `d > 0` to `'up'`, and `.tsub em.up` is `var(--ok)`. Two of the
four tiles are figures where up is bad news, so a week that cost $40 more than
the last one rendered "▲ $40.00" in the success colour, as did a week with more
barren shifts.

**Recommendation (applied):** the arrow says which way the figure moved; the
colour says whether that is good. Each tile declares polarity. Regression test
added — see LOW-005, nothing asserted on the arrows at all, which is how this
survived being written.

---

### 🟡 MEDIUM-004: Nine-column tables scrolled the document, not themselves

**Domains:** [Accessibility (WCAG 1.4.10 Reflow), Responsive]
**Location:** `desk/src/views/Vitals.vue:280,320`
**Status:** ✅ Fixed in `3b50933`
**Found by:** pe-vue (M3)

`.grid` was `width: 100%` with no scroll container. Measured document overflow
on the unmodified fixture: **0px at 900px, 0px at 700px, 87px at 560px, 227px at
420px**. `style.css` already carries `.body .tablewrap { overflow-x: auto }` and
`Commons.vue` already has a narrow-window media query.

**Recommendation (applied):** wrap both tables in `.tablewrap`. Extended the
existing `the console holds together on a narrow window` test — which already
enforced this invariant, but only against Staff — to visit Vitals.

---

### 🟡 MEDIUM-005: Window picker announced selection in colour alone

**Domains:** [Accessibility (WCAG 4.1.2 Name, Role, Value)]
**Location:** `desk/src/views/Vitals.vue:119`
**Status:** ✅ Fixed in `3b50933`
**Found by:** pe-vue (M4)

Selection was `:class="{ on: spec === w }"` only. Confirmed empirically, not by
inspection: `getByRole('button', {name: '7 days'}).getAttribute('aria-pressed')`
returned `null`. `Toolbar.vue:45` already solved the identical widget.

**Recommendation (applied):** `:aria-pressed="spec === w"`, plus an e2e
assertion by accessible role and pressed state.

---

### 🟢 LOW findings (all fixed)

| ID | Location | Finding |
| - | - | - |
| LOW-001 | `vitals.ts:213` | A window of `0.days` was accepted, silently read as a week, and labelled with the zero the caller typed. |
| LOW-002 | `Vitals.vue:13-22` | `load()` had no request sequencing — a slow answer to a window the reader had moved off could overwrite the one on screen. |
| LOW-003 | `Vitals.vue:272` | Footer printed a UTC instant formatted as local; measured 4h out in `America/New_York`. |
| LOW-004 | `Vitals.vue:124-127` | A transient refresh failure blanked a report that had already loaded, rather than showing a banner above figures that were true when read. |
| LOW-005 | `desk.spec.ts:941-975` | Tables located by position, and nothing asserted on the arrows. With refusals cut server-side, an empty section would slide `.first()` onto the people table and fail with the wrong explanation. |
| LOW-006 | `Vitals.vue:231,247` | The console's first hand-written tables shipped without `th scope="col"` or an accessible name. No sibling precedent — this sets the pattern. |

INFO-001 (`.warn` class collision between the error box and a finding) and
INFO-003 (`delta(key, now)` paired a `Trend` key with a hand-passed value —
`Trend.posted` is the server's `commons.added`, so a mismatch would read
correctly and be wrong, with no typechecker to catch it since `.vue` never
reaches one) were also fixed, in `8697cbd`.

---

## Verified Clean

Attacked and held up — recorded so a later round need not re-derive them.

| Claim | Result |
| - | - |
| Missing composable imports in the SFC | None. All four (`ref`, `onMounted`, `computed`, `watch`) imported; `check-sfc-imports.mjs` passes. This is the one failure class the toolchain cannot catch. |
| Type drift `desk/src/api.ts` ↔ `src/analytics/vitals.ts` | Zero. ~90 fields checked field-by-field across 13 sub-objects and the 15-field `Trend`. Hand-mirrored with no shared source, so worth re-checking each round. |
| Injection via `?window=` | No path. Regex-anchored `^\d+[.\s_-]*(hour\|day\|week\|month)s?$`; `since`/`until` derive from a *number* via `toISOString()`, never from the raw string. `IN (...)` placeholders are generated from a module constant. `git.since()` takes an args array. |
| XSS in the new view | Clean. All `{{ }}` interpolation, no `v-html`, so agent-authored rule/capability/role text is escaped. |
| Cross-company staleness on switch | Not a bug. `App.vue` nulls `state`, the view unmounts, `onMounted(load)` refetches. |
| `onEvents` regex misses `shift.blind` | Not a bug. `staff.ts:605` emits `shift.blind` then falls through to `:751` `agent.slept`, which the regex matches. |

---

## Out of Scope

Pre-existing, not introduced here. Logged, not blocking.

| Severity | Issue | Location |
| - | - | - |
| 🟢 LOW | `Commons.vue` and `Work.vue` render agent-authored markdown through `v-html` via `render()`. Deliberate and pre-existing; noted only because the new view deliberately does not. | `desk/src/views/Commons.vue`, `Work.vue` |
| 🟢 LOW | `the sidebar can be dragged wider` is timing-sensitive and fails under machine load (observed once at 1.3m suite runtime, passed in isolation and on every subsequent clean run). | `e2e/desk.spec.ts:738` |

---

## Action Items

### Must Fix (blocks merge)

- [x] HIGH-001 — read pending as a current state

### Required

- [x] MEDIUM-001 — cut refusals server-side
- [x] MEDIUM-002 — separate additions from revisions
- [x] MEDIUM-003 — colour arrows by judgement
- [x] MEDIUM-004 — scroll tables inside their own container
- [x] MEDIUM-005 — `aria-pressed` on the window picker

### Optional

- [x] LOW-001 … LOW-006, INFO-001, INFO-003

---

## Files Reviewed

| File | Findings |
| - | - |
| `src/analytics/vitals.ts` | 3 |
| `desk/src/views/Vitals.vue` | 7 |
| `e2e/desk.spec.ts` | 1 |
| `src/ledger/ledger.ts` | 0 |
| `src/worldfs/git.ts` | 0 |
| `src/gateway/server.ts` | 0 |
| `desk/src/api.ts` | 0 |
| `scripts/vitals.ts` | 0 |
| `test/vitals.test.ts` | 0 |
| `e2e/setup.ts` | 0 |
| `desk/src/App.vue` | 0 |
| `README.md` | 0 |

---

## Verification

| Command | Result |
| - | - |
| `npm run check` | PASS (exit 0) — SFC import check + tsgo over src, desk, e2e |
| `npm test` | PASS — 229/229 |
| `npm run test:ui` | PASS — 47/47 (29.5s) |
| `node scripts/vitals.ts 30.days --company lafollett-labs` | Ran against a real 30-day ledger; every finding above was confirmed against it rather than argued from the diff |

---

## Merge Eligibility

**Locked to SHA:** `8697cbd97f54e8d3454da660220942137ade3ebe`
**Status:** ✅ Mergeable IF `git rev-parse HEAD == 8697cbd97f54e8d3454da660220942137ade3ebe`. Any commit after this SHA invalidates this round and requires re-review.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)
