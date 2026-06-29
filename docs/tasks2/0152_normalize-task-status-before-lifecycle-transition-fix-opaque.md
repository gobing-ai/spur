---
template: standard
schema_version: 1
name: "Normalize task status before lifecycle transition; fix opaque FSMError on case-drift"
description: ""
status: backlog
type: task
profile: standard
feature_id: null
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: "2026-06-29T06:20:51.500Z"
updated_at: 2026-06-29T06:22:38.687Z
---

## 0152. Normalize task status before lifecycle transition; fix opaque FSMError on case-drift

### Background
A dogfood run of `/sp-dev-refine 0134 --auto --next` (`docs/dogfood/2026-06-29-dev-refine-0134-auto-next-dogfood.md`) surfaced a blocking `FAIL` in the `--next` chain: the `backlog → todo` lifecycle transition crashed with `FSMError: Cannot reseed run … to undeclared state "Backlog"`.

#### Root cause

The lifecycle workflow (`.spur/workflows/task-lifecycle.yaml`) and `TASK_STATUSES` (`packages/domain/src/planning/schema.ts:20`) declare **lowercase-only** states (`backlog`, `todo`, …). Task 0134's frontmatter carried `status: Backlog` (capitalized), while sibling tasks 0129–0133 correctly use lowercase `done`. The write path reads the raw frontmatter status and feeds it unnormalized into the FSM:

- `packages/app/src/services/planning-write-service.ts:326` — `currentStatus = doc.frontmatterData?.status` (raw, unnormalized).
- `:373` — passes it to `lifecycle.requestTransition(ref, currentStatus, newStatus)`.
- `packages/app/src/workflow/lifecycle-adapter.ts:134` — `reseedRun(workflow, runId, currentStatus)` reseed uses the raw value; the engine has no `Backlog` state (only `backlog`) → throws.

A normalizer already exists and is already used elsewhere — `normalizeTaskStatus` (`schema.ts:172`, case-insensitive + alias-tolerant) is invoked by the Zod frontmatter schema (`schema.ts:231`). The bug is that the transition path bypasses it. `newStatus` (`:367`) is the **post-mutation** frontmatter value, so it is also raw and unnormalized.

#### Why this matters

- **Blocks every `--next` chain on any task with a non-canonical status** — legacy/aliased/capitalized statuses (which `normalizeTaskStatus` already handles on input) still break the transition the instant the file SSOT is read back.
- **Opaque error** — `FSMError: Cannot reseed run … to undeclared state "Backlog"` names the run id and bad state but not the file, the expected vocabulary, or the remediation. An operator hitting this on a `--next` chain has no actionable next step.
- **Documented contract violated** — `sp-dev-refine/SKILL.md:78` asserts the `backlog → todo` guard "passes"; it does not for case-drifted tasks.
#### Upstream evaluation

Per AGENTS.md §"Shared-library evolution", the generic portion of R4 was evaluated for `~/xprojects/ts-libs`. The engine's `FSMError` throw at `packages/dual-workflow-engine/src/service.ts:103-110` (`assertReseedTargetDeclared`) hardcodes `Cannot reseed run "${runId}" to undeclared state "${newState}"` and leaves the `details?: unknown` field (`errors.ts:13-21`) unpopulated, despite `workflow.states` being in scope at the throw site.

**Evaluation:** R1 makes this error **unreachable for the reported case-drift bug** — `normalizeTaskStatus` runs first (`packages/domain/src/planning/schema.ts:175-177`), so capitalized/aliased statuses never reach `assertReseedTargetDeclared`, and genuinely invalid statuses already throw a clear message there. The opaque `FSMError` surfaces only on **genuine workflow/config drift** (a canonical `TASK_STATUSES` value absent from `.spur/workflows/task-lifecycle.yaml`), a rarer, separable class. The upstream enrichment (populate `details` + list declared states in the message) is therefore **optional defense-in-depth**, broadly beneficial to all `ts-dual-workflow-engine` consumers but not a blocker for this task. R10 records the explicit decision the implementer must make.

### Requirements

- R1 — The lifecycle transition path normalizes the status string through `normalizeTaskStatus` before it reaches the FSM, so a task whose frontmatter `status` is capitalized (`Backlog`), an alias (`completed`), or otherwise non-canonical still transitions through its canonical equivalent. Applies to **both** `currentStatus` (pre-transition) and `newStatus` (post-mutation).
- R2 — The normalization is the single boundary fix: `planning-write-service.ts` (or the lifecycle-adapter port boundary) normalizes once, not scattered across callers. No engine-side change; the engine continues to receive only lowercase canonical states.
- R3 — `normalizeTaskStatus`'s throw-on-unknown behavior is preserved for genuinely invalid statuses (e.g. `status: frobnicate`) — the transition fails fast with a clear message rather than silently passing or crashing with an opaque engine error.
- R4 — The `FSMError`/engine denial surfaced to the operator is actionable: it names the task (wbs/file), the rejected value, and the expected vocabulary, and points at the one-line remediation (set `status:` to a canonical lowercase value or run `spur task migrate`). Not just the raw run id.
- R5 — Task 0134's frontmatter `status: Backlog` is normalized to `status: backlog` (data fix) so the dogfood chain can be re-run cleanly; OR the read-time normalization makes the data fix unnecessary. Either way, `spur task update 0134 todo` succeeds after this task.
- R6 — A regression test reproduces the original failure (capitalized `status` frontmatter) and asserts the transition succeeds post-fix; the test covers the `currentStatus` and `newStatus` normalization paths.
- R7 — Code change is surgical: the lifecycle-transition branch in `planning-write-service.ts` (and, if the fix is placed at the port boundary, the `lifecycle-adapter.ts` reseed call) is the only executable surface touched. No new abstraction, no engine change, no schema change.
- R8 — Verification gate stays green: `bun run lint` clean, `bun run test` passes with the new regression test included, `git status` shows only intentional changes.
- R9 — SSOT docs updated in the same change if the error-message contract or the normalization boundary is documented anywhere (e.g. `04_DESIGN.md` §7 lifecycle section, `03_ARCHITECTURE.md §12`); no doc drift.
- R10 — The R4 error-enrichment is **co-located with the normalization** (both in `planning-write-service.ts`, Design Option A), and the decision is recorded in the task's Solution section. Rationale: post-normalization the only new error path is `normalizeTaskStatus` throwing on a genuinely-unknown status (e.g. `frobnicate`); that throw is caught where the normalize call lives — `planning-write-service.ts:326/:367` — which already holds `ref.id` (wbs) and the raw value. Splitting the enrichment across the adapter boundary (enrich at `lifecycle-adapter.ts` but throw originates in `planning-write-service`) is a worse design and is rejected. The existing `Lifecycle transition denied` throw (`planning-write-service.ts:377-379`) already covers the valid-states/invalid-direction case with wbs + report, so no second enrichment site is needed. (b) If the implementer *also* enriches the generic `FSMError` upstream in `~/xprojects/ts-libs/packages/dual-workflow-engine` (populate `details` + list declared states), that change is verified in `ts-libs` with its own gates, consumed via semver (or a documented temporary `bun link`), and recorded — but this upstream enhancement is **optional** and not blocking (see _Upstream evaluation_). The task is done with (a) alone; (b) is a follow-up.

### Acceptance Criteria
```gherkin
Feature: Normalize task status before lifecycle transition; fix opaque FSMError on case-drift

  Background:
    Given a task file exists with frontmatter `status: Backlog` (capitalized, non-canonical)
    And the task-lifecycle workflow declares lowercase-only states (backlog, todo, wip, testing, blocked, done, cancelled)
    And the write path previously read the raw frontmatter status and passed it unnormalized to the FSM reseed

  Scenario: Capitalized status transitions through its canonical equivalent
    Given task 0134 has frontmatter `status: Backlog`
    When the operator runs `spur task update 0134 todo`
    Then the transition succeeds (no FSMError)
    And the task's status becomes `todo` (canonical lowercase) in the written frontmatter
    And the history line records `backlog → todo`

  Scenario: Alias status resolves before transition
    Given a task has frontmatter `status: completed`
    When the operator runs `spur task update <wbs> wip`
    Then the transition is evaluated against `done` (the canonical form of `completed`)
    And the engine never sees the raw `completed` string

  Scenario: Genuinely invalid status fails fast with an actionable message
    Given a task has frontmatter `status: frobnicate`
    When the operator runs `spur task update <wbs> todo`
    Then the transition fails (does not silently proceed)
    And the error message names the task (wbs or file), the rejected value, and the allowed vocabulary
    And the error message does not surface an opaque run id without context

  Scenario: Regression coverage
    When `bun run test` runs
    Then a test exercising the capitalized-status frontmatter transition passes
    And the test asserts both the currentStatus (pre) and newStatus (post) normalization paths

  Scenario: Dogfood re-run is clean
    When the operator re-runs `/sp-dev-refine 0134 --auto --next` (or `spur task update 0134 todo`)
    Then the `backlog → todo` transition succeeds
    And the chain proceeds to the next step (dev-run) without an FSMError

  Scenario: Verification gate green
    When `bun run lint` and `bun run test` run
    Then both pass
    And `git status` shows only intentional changes (the fix + the new test + any doc sync)
  Scenario: Error-enrichment is co-located with normalization and recorded in Solution
    When the Solution section of this task is reviewed
    Then it records that the R4 error-enrichment is co-located with `normalizeTaskStatus` in `planning-write-service.ts` (Design Option A), not split across the adapter boundary
    And it records that the existing `Lifecycle transition denied` throw covers the valid-states/invalid-direction case, so no second enrichment site exists
    And it records that any upstream `FSMError` enrichment in `ts-libs` is optional, non-blocking follow-up
    And the enrichment is not scattered into the engine or duplicated across callers
```
### Design

**Fix location: `planning-write-service.ts` (single boundary, lowest risk).**

The normalizer already exists (`normalizeTaskStatus`, `schema.ts:172`) and is already used by the Zod frontmatter schema. The transition path simply bypasses it. Two callsites in `planning-write-service.ts` read raw frontmatter status:

- `:326` — `currentStatus = doc.frontmatterData?.status` (pre-transition value)
- `:367` — `newStatus = doc.frontmatterData?.status` (post-mutation value)

Both feed `lifecycle.requestTransition(ref, currentStatus, newStatus)` at `:373`, which reseed-passes `currentStatus` to the engine (`lifecycle-adapter.ts:134`).

**Change:** wrap both reads in `normalizeTaskStatus(...)`. Since `newStatus` is the post-mutation frontmatter value (after `applyMutation` at `:336`), it must also be normalized — a `--transition` mutation that sets a capitalized status string would otherwise re-introduce the bug on the outbound write.

```ts
// :326 — normalize the pre-transition status so the reseed sees a canonical state
const currentStatus = normalizeTaskStatus(
    (doc.frontmatterData?.status as string | undefined) ?? 'backlog',
);

// :367 — normalize the post-mutation status (mutation may have written a non-canonical value)
const newStatus = normalizeTaskStatus(
    (doc.frontmatterData?.status as string | undefined) ?? 'backlog',
);
```

**Why this beats the alternatives:**

| Option | Location | Verdict |
|---|---|---|
| **A (chosen)** | Normalize both reads in `planning-write-service.ts` before `requestTransition` | ✓ Single boundary; the file-wins reseed + the transition request both see canonical states; uses an existing, already-tested normalizer; no engine or schema change. |
| B | Normalize inside `lifecycle-adapter.ts:134` before `reseedRun` | Only fixes `currentStatus` (the reseed), not `newStatus` (the outbound transition value); leaves the write path writing a non-canonical value. Half a fix. |
| C | Normalize at read time in `MarkdownDocument.parse` | Broad blast radius — every frontmatter consumer would see normalized values, changing semantics for display, check, history. Out of scope for this bug. |

Option A is surgical and uses existing infrastructure. `normalizeTaskStatus` throws on unknown values (`schema.ts:175-177`), so R3's fail-fast is automatic.

**Error message (R4):** the current `Lifecycle transition denied` throw at `:377-379` already includes `ref.id`, `currentStatus`, `newStatus`, and the denial `report`. After normalization, `currentStatus`/`newStatus` will be canonical — but the **raw** value is lost. Augment the unknown-status branch: when `normalizeTaskStatus` throws (caught at the boundary), rethrow with `Task <wbs> (<file>) has status "<raw>"; expected one of backlog|todo|wip|testing|blocked|done|cancelled. Edit the frontmatter or run spur task migrate.` The opaque `FSMError` path disappears because the reseed never receives a non-canonical value post-fix.

**Data fix for 0134 (R5):** the read-time/output normalization means 0134's `status: Backlog` does not need a manual edit — the transition will normalize it. But for corpus hygiene, normalize 0134's frontmatter to `status: backlog` as part of this task (one-character data fix), and note the broader audit as a follow-up (the reserved `spur task migrate` A17 verb is the right vehicle for a corpus sweep, but wiring it is out of scope here).

**Regression test (R6):** in `packages/app/tests/`, add a test that (1) creates a task with capitalized `status: Backlog` frontmatter, (2) runs a `transition` mutation to `todo`, (3) asserts no throw + the written frontmatter is lowercase `todo` + the history line is `backlog → todo`. Use the in-memory SQLite + fresh-adapter pattern already used by the DAO tests.

**Out of scope:** the corpus-wide status audit (`spur task migrate` A17), engine-side changes, and any change to `MarkdownDocument.parse` normalization semantics.

### Plan
- [ ] **P1 — Reproduce.** Hand-create (or script) a task frontmatter with `status: Backlog`; confirm `spur task update <wbs> todo` throws `FSMError: Cannot reseed run … to undeclared state "Backlog"`. Capture the exact error as the pre-fix baseline.
- [ ] **P2 — Add the regression test (red).** In `packages/app/tests/`, add a test exercising the capitalized-status transition (Design §"Regression test"). Run it — it must fail with the original `FSMError` (TDD red).
- [ ] **P3 — Apply the normalization fix.** Edit `planning-write-service.ts:326` and `:367` to wrap both status reads in `normalizeTaskStatus(...)`. Default the raw value to `'backlog'` when frontmatter `status` is absent. Import `normalizeTaskStatus` from `@gobing-ai/spur-domain`.
- [ ] **P4 — Run the regression test (green).** Re-run the P2 test; it must now pass (TDD green). Run the broader planning-write test suite to confirm no regression.
- [ ] **P5 — Error-message clarity (R4).** Wrap the transition call so a `normalizeTaskStatus` throw surfaces as the actionable message (task wbs + file + raw value + allowed vocabulary + remediation), not an opaque stack. Verify with a `status: frobnicate` case.
- [ ] **P6 — Data fix 0134.** Normalize task 0134's frontmatter `status: Backlog` → `status: backlog` (one-character data fix for corpus hygiene; the transition fix already makes this non-blocking).
- [ ] **P7 — Re-run the dogfood step.** `spur task update 0134 todo` (or `/sp-dev-refine 0134 --auto --next`) must transition cleanly; chain proceeds past the `backlog → todo` step.
- [ ] **P8 — Doc sync (R9).** If `04_DESIGN.md` §7 or `03_ARCHITECTURE.md §12` documents the lifecycle transition boundary or the error contract, update in the same change. Check `docs/dogfood/2026-06-29-dev-refine-0134-auto-next-dogfood.md` is referenced as the source dogfood.
- [ ] **P9 — Verification gate.** `bun run lint` clean; `bun run test` passes (incl. new regression test); `git status` shows only the fix + test + 0134 data fix + any doc sync.
### Solution

### Testing

### Review

### References

### History
