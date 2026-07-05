---
template: standard
schema_version: 1
name: "feature_id done-gate friction: confirm 0147 unblock + add opt-in feature-link healing (not auto, not gate-time)"
description: ""
status: done
type: task
profile: standard
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: 2026-06-28T23:29:00.250Z
updated_at: 2026-06-29T00:45:25.001Z
---

## 0148. feature_id done-gate friction: confirm 0147 unblock + add opt-in feature-link healing (not auto, not gate-time)

### Background
**Operator observation.** Across `/sp:dev-verify`, the done-gate, and `sp:super-coder` runs, a
blank/missing `feature_id` repeatedly blocked tasks from reaching `done`. Proposed fix: an
LLM-as-judge mechanism in `sp:spur-dev` that heals the missing `feature_id` via `spur feature`,
wired into the agent + `dev-*` commands.

**Evaluation (2026-06-28), reconciled after operator pushback — auto-healing is NOT a design breach;
the right trigger is operator-chosen strictness, not gate-time automation.**

Verified behavior of `feature_id: null` (live, post-0147):

| Mode | feature_id finding | pass? | Used by |
|------|--------------------|-------|---------|
| plain `spur task check` | warning | True | ad-hoc |
| `--strict-core` | **warning** | **True** | the **real** done-gate (both lifecycle guards, `task.ts:651`) |
| `--strict` | **error** | **False** | **manual audit only** (`task.ts:411`); no lifecycle/dev-* path invokes it |

**Reconciled conclusions:**

1. **Nullable `feature_id` = deferral, not "permanently standalone."** Tasks may be created with a
   blank edge to postpone the feature decision; the warning is the standing TODO. (Operator's framing
   — correct; supersedes the earlier "benign/optional steady-state" read.)
2. **The default done-gate (`--strict-core`) does NOT require `feature_id`** — verified twice; a
   parentless task reaches `done` cleanly post-0147. So the *automated* flow never forces it, and the
   original blocker (the `--strict` fallback bug + unavailable adapter) is genuinely **closed by 0147**.
3. **`--strict` mode legitimately DOES require `feature_id`** — and when an operator opts into that
   rigor, filling the deferred edge is the natural consequence and deserves an assist. Today there is
   **no** assist: the operator hits a bare error with no help resolving it.
4. **Therefore healing is sound — scoped to the operator's strictness choice, not the gate.** The
   thing to reject is *silent, always-on, gate-time auto-create* (it would fight the `--strict-core`
   design and explode the 19-feature tree with synthetic single-task nodes vs. 17 parentless tasks).
   The thing to build is a **strictness-triggered, prefer-existing, confirm-before-apply link helper.**

**Refined trigger model:**

| When | Behavior |
|------|----------|
| plain / `--strict-core` (default) | warning + actionable hint; deferral allowed; no healing |
| operator runs/intends `--strict` rigor, OR explicitly asks to link | offer the LLM-judge link helper: match an EXISTING feature first, create only if none fits, confirm before applying |
| deliberate traceability audit (`spur task check --strict` across the corpus) | helper supports a **batch sweep**: list the N orphan tasks, propose a best-fit existing feature per orphan, apply confirmed links in one pass |

`spur feature {list,show,create}`, `spur task list --feature`, and `spur task update --feature <id>`
provide the primitives.

**Net effect (the design intent, operator-confirmed).** By the original design, `feature_id` is the
*only* thing standing between a task and a `--strict` PASS during a deliberate traceability audit.
This enhancement makes that an explicit operator **choice** at audit time — keep the edge blank
(accept the `--strict` finding; deferral is legitimate) **or** heal it via the assisted helper. The
default flow never forces the choice; strict rigor surfaces it with an assist instead of a wall.

Source: this session's 0143→0147 dogfood campaign; live re-verification + operator reconciliation 2026-06-28.
### Acceptance Criteria
```gherkin
Feature: strictness-triggered, opt-in feature_id link healing (never silent/gate-time)

  Scenario: Default gate keeps deferral legal (regression guard)
    Given a task with feature_id = null and a done-ready body
    When it transitions testing → done via the real --strict-core guard
    Then the transition succeeds (feature_id stays a warning, deferral allowed)

  Scenario: Actionable warning instead of a bare one
    Given spur task check reports L4 "Missing feature_id"
    When the operator reads it
    Then the message names the fix: spur task update <wbs> --feature <id> (or the heal helper)

  Scenario: Strict rigor triggers the link helper (single task)
    Given an operator runs (or intends) --strict-level traceability rigor on a parentless task
    When the feature_id error surfaces
    Then the sp:spur-dev link helper is offered (not silently applied)
    And it proposes the best-fit EXISTING feature first (create only if none fits)
    And it applies via spur task update --feature / spur feature ONLY on confirmation

  Scenario: Batch audit sweep across the corpus
    Given a deliberate traceability audit (spur task check --strict over all tasks) lists N orphans
    When the operator invokes the link helper in sweep mode
    Then it proposes a best-fit existing feature per orphan in one pass
    And the operator can confirm/skip/override per orphan before any link is applied
    And declining an orphan leaves its feature_id blank (deferral remains a valid choice)

  Scenario: The default done-gate never auto-heals
    Given any task transitioning through the default (--strict-core) done-gate or a --next chain
    When feature_id is null
    Then no feature is auto-created and no link is auto-applied
    And the contract treats feature_id as a warning, unchanged
```

- [x] AC1 — Regression: a `feature_id: null` task transitions `testing → done` under `--strict-core` (deferral stays legal; the 0147 unblock is locked by a test).
- [x] AC2 — The L4 "Missing feature_id" warning message is actionable (names `spur task update <wbs> --feature <id>` and the heal helper).
- [x] AC3 — A **strictness-triggered, opt-in** LLM-judge link helper exists in `sp:spur-dev` (single-task): fires when the operator invokes/intends `--strict` rigor OR explicitly asks to link; matches an EXISTING feature first; creates only if none fits; confirms before applying via `spur feature` / `spur task update --feature`.
- [x] AC4 — A **batch sweep** mode of the helper supports a deliberate audit: enumerate orphan tasks (`spur task list` / `--strict` audit set), propose a best-fit existing feature per orphan, apply per-orphan confirmed links in one pass; declining leaves the edge blank (deferral preserved).
- [x] AC5 — The default `--strict-core` done-gate and all `--next` chains are unchanged — NEVER auto-heal, NEVER auto-create. `super-coder.md` + `dev-verify.md` reference the helper for discoverability only.
### Plan
Scoped to the **reconciled** design: deferral legal by default; healing triggered by the operator's
strictness choice; prefer-existing + confirm; never gate-time/automatic; single-task + batch-sweep.

- [x] P1 (AC1) — Regression test in `apps/cli/tests/commands/task.test.ts` (next to the 0147 done-gate
      tests): a `feature_id: null` done-ready task passes the `--strict-core` `testing→done` gate.
      Locks the 0147 unblock so feature_id is never silently re-elevated into the default gate.
- [x] P2 (AC2) — Made the L4 warning actionable in `packages/app/src/services/task-check.ts:242`:
      appended the corrective path (`spur task update <wbs> --feature <id>`, and reference to the
      feature-link helper). Kept severity `warning`; updated the message test. No DD-07 change.
- [x] P3 (AC3) — Added the **strictness-triggered, opt-in single-task** feature-link helper to
      `sp:spur-dev` as `plugins/sp/skills/spur-dev/references/feature-link-helper.md`.
      Steps a–f: read task → list features (prefer existing) → LLM-judge match → propose → create
      only if none fits AND confirmed → apply via `spur task update <wbs> --feature <id>`. Added
      reference entry to SKILL.md Supporting detail section. NOT in `--strict-core` gate, NOT automatic.
- [x] P4 (AC4) — Added the **batch sweep** mode to the helper in the same reference file: enumerate
      orphans (`spur task list --json` filtered to `feature_id: null`), propose a best-fit existing
      feature per orphan, present per-orphan confirm/skip/override before applying any link. Declining
      leaves `feature_id` blank. Apply via `spur task update <wbs> --feature <id>` per confirmed orphan.
- [x] P5 (AC5) — Added one-line discoverability note to `plugins/sp/agents/super-coder.md` (Rules/Always
      section: references the helper, explicitly states it NEVER runs automatically from a batch run).
      Added opt-in callout block to `plugins/sp/commands/dev-verify.md` (after the `--next` chain
      section; clarifies `--strict-core` keeps feature_id a warning; marks the helper opt-in only,
      NEVER from `--next` or any gate).
- [x] P6 — Gate green: `bun run lint` (377 files clean) + `bun run test` (1965 pass / 0 fail) +
      `bun run test-cf` (1 passed) + `bun run build` (all workspaces succeeded). Only done-gate-adjacent
      change is the warning-message text — no severity/behavior change confirmed.

**Dependency:** P1 builds on 0147 (done). P2–P5 are independent doc/skill + one message edit.
**Out of scope:** changing DD-07 severity, making `--strict` a lifecycle gate, or any automatic
gate-time feature creation.
### Solution
Five deliverables shipped across two code files, two test files, and four skill/agent files:

**P1 — Regression test** (`apps/cli/tests/commands/task.test.ts`)
Added test `'0147 regression: feature_id=null task passes --strict-core done-gate (deferral preserved)'`. Creates a fresh task, runs `task check <wbs> --strict-core --json`, asserts exit code 0, `pass: true`, and that all `feature_id` findings are `warning` severity. Locks the 0147 unblock so feature_id never silently re-enters the hard-blocking set.

**P2 — Actionable warning message** (`packages/app/src/services/task-check.ts:242`)
Updated the L4 "Missing feature_id" message from a bare observation to an actionable one: appends `spur task update <wbs> --feature <id>` and a reference to the feature-link helper. Severity stays `warning`; DD-07 unchanged.

**P2 test update** (`packages/app/tests/services/task-check.test.ts`)
Extended the `'L4: missing feature_id warns (one direction)'` test with `expect(missingWarnings.some((f) => f.message.includes('spur task update'))).toBe(true)` — verifies the corrective hint is present.

**P3+P4 — Feature-link helper reference** (`plugins/sp/skills/spur-dev/references/feature-link-helper.md`)
New file documenting the opt-in, strictness-triggered helper:
- Single-task mode (Steps a–f): read task → list features → LLM-judge match → propose to operator → create only if none fits and confirmed → apply via `spur task update --feature`.
- Batch-sweep mode (Steps 1–6): enumerate orphans → list features once → propose per-orphan → per-orphan confirm/skip/override → apply confirmed only → report.
- Design boundaries block: never gate-time, never automatic, always prefer existing features, always confirm before apply.

**P3 (SKILL.md)** (`plugins/sp/skills/spur-dev/SKILL.md`)
Added `feature-link-helper.md` to the Supporting detail section with a one-line description of the helper's trigger and behavior.

**P5a — super-coder.md** (`plugins/sp/agents/super-coder.md`)
Added discoverability note in the Rules/Always section: references the feature-link helper for strict-rigor resolution, explicitly states it NEVER runs automatically from a batch run.

**P5b — dev-verify.md** (`plugins/sp/commands/dev-verify.md`)
Added a callout block after the `--next` chain section: explains that `--strict-core` keeps feature_id as a warning, that strict rigor surfaces it, and that the feature-link helper is the resolution path — explicitly marked opt-in only, NEVER from `--next` or any gate.

**P6 — Gate** (all green):
- `bun run lint`: clean (377 files, no issues)
- `bun run test`: 1965 pass / 0 fail across 147 files
- `bun run test-cf`: 1 passed
- `bun run build`: all workspaces succeeded
### Testing
**Gate results (P6):**

- `bun run lint`: Biome + tsc/noEmit clean across all workspaces (377 files, 0 issues)
- `bun run test`: 1965 pass / 0 fail / 0 skip across 147 files (19.66s)
- `bun run test-cf`: 1 file / 1 test passed (server Workers runtime)
- `bun run build`: all workspaces built successfully

**Test coverage for this task's changes:**

P1 regression test (`apps/cli/tests/commands/task.test.ts`): `'0147 regression: feature_id=null task passes --strict-core done-gate (deferral preserved)'` — exercises the real `--strict-core` CLI flag end-to-end, asserts `pass: true` and all feature_id findings are `warning` severity. Locks DD-07 contract at the integration level.

P2 message test (`packages/app/tests/services/task-check.test.ts`): `'L4: missing feature_id warns (one direction)'` — extended with `expect(missingWarnings.some((f) => f.message.includes('spur task update'))).toBe(true)`. Verifies the corrective command is present in the warning text.

All other deliverables (P3+P4 feature-link-helper.md, P3 SKILL.md, P5a super-coder.md, P5b dev-verify.md) are documentation/skill files with no executable logic — the gate is the lint/build pass.
### Review
**Self-review (design boundary compliance):**

- DD-07 severity unchanged: `warning` in task-check.ts, `warning` in all test assertions.
- `--strict-core` gate unchanged: no code change to `runDoneGateCheck()` or `task-lifecycle.yaml`.
- `--strict` is not wired to any lifecycle transition — remains manual audit only.
- Feature-link helper is reference-only (Markdown in `plugins/sp/skills/spur-dev/references/`): no executable logic, no CLI integration, no automatic trigger.
- Discoverability notes in super-coder.md and dev-verify.md explicitly state "NEVER automatic / NEVER from gate / NEVER from `--next`."
- The only code changes: one new integration test (P1), one warning-message string edit (P2a), one test assertion (P2b). All surgical, no adjacent changes.

**Verdict: PASS** — all five plan items delivered; design boundaries intact; full gate green.
### References

### History
- 2026-06-29T00:10:39.989Z backlog → wip (system)
- 2026-06-29T00:45:15.907Z wip → testing (system)
- 2026-06-29T00:45:25.001Z testing → done (system)
