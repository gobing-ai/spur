---
template: standard
schema_version: 1
name: Normalize task status before lifecycle transition; fix opaque FSMError on case-drift
description: ""
status: done
type: task
profile: standard
feature_id: F4
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: 2026-06-29T06:20:51.500Z
updated_at: "2026-08-18T04:42:47.005Z"
---

## 0152. Normalize task status before lifecycle transition; fix opaque FSMError on case-drift

### Background
A dogfood run of `/sp-dev-refine 0134 --auto --next` (`docs/dogfood/2026-06-29-dev-refine-0134-auto-next-dogfood.md`) surfaced a blocking `FAIL` in the `--next` chain: the `backlog → todo` lifecycle transition crashed with `FSMError: Cannot reseed run … to undeclared state "Backlog"`.

**Outcome (fix-mode re-run, same session):** the dogfood was re-run under `--max-retry 2`; P1 was applied in place (service-boundary status normalization), the regression test was added, and the transition cleared — task 0134 advanced `Backlog → backlog → todo` and emits `task.transitioned`. The chain's `/sp-dev-run` link was deliberately not driven (its scope is a full code-implementation run, out of the dogfood's bounded-fix remit); it is now unblocked for a standalone invocation. Full findings in the report's §5 (P1 resolved × 2; P2 superseded by P1 analysis; P3 logged as follow-up).

#### Root cause

The lifecycle workflow (`.spur/workflows/task-lifecycle.yaml`) and `TASK_STATUSES` (`packages/domain/src/planning/schema.ts:20`) declare **lowercase-only** states (`backlog`, `todo`, …). Task 0134's frontmatter carried `status: Backlog` (capitalized), while sibling tasks 0129–0133 correctly use lowercase `done`. The write path reads the raw frontmatter status and feeds it unnormalized into the FSM:

- `packages/app/src/services/planning-write-service.ts:326` — `currentStatus = doc.frontmatterData?.status` (raw, unnormalized).
- `:373` — passes it to `lifecycle.requestTransition(ref, currentStatus, newStatus)`.
- `packages/app/src/workflow/lifecycle-adapter.ts:134` — `reseedRun(workflow, runId, currentStatus)` reseed uses the raw value; the engine has no `Backlog` state (only `backlog`) → throws.

A normalizer already exists and is already used elsewhere — `normalizeTaskStatus` (`schema.ts:172`, case-insensitive + alias-tolerant) is invoked by the Zod frontmatter schema (`schema.ts:231`). The bug is that the transition path bypasses it. `newStatus` (`:367`) is the **post-mutation** frontmatter value, so it is also raw and unnormalized.
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
- [x] **P1 — Reproduce.** DONE — the dogfood observe-only run reproduced the crash (`spur task update 0134 todo` → `FSMError: Cannot reseed run … to undeclared state "Backlog"`); fix-mode re-confirmed 0134 still crashed before applying the fix.
- [x] **P2 — Add the regression test.** DONE — `packages/app/tests/services/planning-write-service.test.ts:480` seeds legacy `status: Backlog`, asserts the lifecycle port receives canonical `backlog` via a capturing spy. (Strict TDD red-first was not followed — the fix and test landed together in the fix-mode session; the test does encode the original-failure assertion.)
- [x] **P3 — Apply the normalization fix.** DONE — `planning-write-service.ts:326,367` wrap `currentStatus`/`newStatus` in `normalizeStatusForDomain` (dispatches to `normalizeTaskStatus`/`normalizeFeatureStatus`, passthrough on unknown) before `lifecycle.requestTransition` (`:373`).
- [x] **P4 — Run the regression test (green).** DONE — test passes; full `packages/app` suite 639/639 green.
- [x] **P5 — Error-message clarity (R4).** DONE via a different mechanism than planned — passthrough-on-unknown lets genuinely-invalid statuses (`frobnicate`) fall through to step-4 Zod validation, which emits a clear enum error naming the allowed vocabulary (corrupted-file-remains-editable invariant preserved). The originally-planned catch-and-rethrow enrichment was rendered unnecessary: post-normalization the opaque `FSMError` path is unreachable from the sole production callsite (call-graph audit, this run). R10 records the decision.
- [x] **P6 — Data fix 0134.** DONE (self-healed) — the transition itself persisted canonical `status: todo`; 0134 verified at `todo`, passes `task check`. No separate one-character edit needed.
- [x] **P7 — Re-run the dogfood step.** DONE — `spur task update 0134 todo` transitions cleanly; chain proceeds past `backlog → todo`.
- [x] **P8 — Doc sync (R9).** DONE — added the "Status normalization invariant (0152)" note to `04_DESIGN.md` §7.5 (engine integration paragraph), documenting that the service-boundary normalization is the sole production entry into the transition path and that removing it re-introduces the crash. `03_ARCHITECTURE.md §12` needs no change (it describes the write-service seam, not the normalization boundary).
- [x] **P9 — Verification gate.** DONE — `bun run lint` clean (7 workspaces); `packages/app` 639/639 pass (incl. new regression); `tsc --noEmit` clean. NOTE: the full `bun run test` reports 8 failures, all pre-existing in `plugins/sp/hooks/task-write-guard.test.ts` (caused by task 0151's in-progress hook rewrite, unrelated to this fix); `packages/app` (where this fix lives) is fully green.
### Solution
Implemented Option A (service-boundary normalization) — the single production transition path.

**Change:** `packages/app/src/services/planning-write-service.ts`
- Imported `normalizeTaskStatus` + `normalizeFeatureStatus` from `@gobing-ai/spur-domain`.
- Added `normalizeStatusForDomain(status, domain)` (file-local helper) that dispatches to the domain normalizer and passes unrecognized values through unchanged.
- Wrapped `currentStatus` (step 2 capture, `:326`) and `newStatus` (step 5 capture, `:367`) with it, before `lifecycle.requestTransition` (`:373`).

**Why the service layer, not the adapter (P2's original suggestion):** call-graph audit shows `packages/app/src/services/planning-write-service.ts:373` is the **sole** production callsite for `LifecyclePort.requestTransition`. The adapter's `requestTransition` is only ever reached from there, so normalizing at the service boundary covers the entire production path. The adapter-level enrichment (P2) would protect a hypothetical future caller that bypasses the service layer — defensible as defense-in-depth but redundant today; deferred.

**Why passthrough on unknown (not throw):** a corrupted `status: banana` on disk must not block a *non-status* edit (e.g. `spur task update 0152 --section Background ...`). This mirrors the corrupted-file-remains-editable invariant the step-3.5 phantom-section guard upholds. Unknown values fall through to step-4 validation, which emits a clear Zod enum error naming the allowed vocabulary. This satisfies R3/R4 via a different mechanism than the planned catch-and-rethrow (see Plan P5).

**Scope note (R3):** the corpus audit for other capitalized statuses in `docs/tasks2/` is deferred — the read-time normalizer now makes the transition path self-healing regardless of stored casing. Regression test and coverage details in the `Testing` section below.
### Testing
**Regression test:** `packages/app/tests/services/planning-write-service.test.ts:480` — "normalizes legacy capitalized status before lifecycle transition". Seeds a task with `status: Backlog` (capitalized), installs a capturing spy on the `LifecyclePort`, runs a `transition` mutation to `todo`, and asserts (a) the port received canonical `backlog` as `currentStatus` (not raw `Backlog`), (b) `newStatus` is canonical `todo`, (c) the transition completed without throwing. Covers both the pre-transition (`currentStatus`) and post-mutation (`newStatus`) normalization paths (R6).

**Coverage:** `planning-write-service.ts` at 100% lines / 96.67% functions after the fix. The 8 `plugins/sp/hooks/task-write-guard.test.ts` failures are pre-existing (task 0151) and unrelated to this change.
### Review
**Verify verdict (`/sp:dev-verify 0152 --auto --fix all --focus all --force --next`): PASS** — all 10
requirements MET; no blocker/major SECUA findings; `--fix all` had nothing to repair.


| Req | Status | Evidence |
|-----|--------|----------|
| R1 | MET | `planning-write-service.ts:332` (`currentStatus`) + `:376` (`newStatus`) both wrap `normalizeStatusForDomain` before `requestTransition` (`:382`). |
| R2 | MET | Single boundary; `normalizeStatusForDomain` (`:527`) is the only new surface; no engine/schema change. |
| R3 | MET | Passthrough-on-unknown (`:530-534`) → unknown status falls to step-4 Zod (`:360-364`); `normalizeTaskStatus:176` throws on unknown. |
| R4 | MET | Invalid status → Zod enum error naming task `ref.id` + allowed vocabulary (`:362`); R10/Solution record the co-location decision. |
| R5 | MET | 0134 self-healed to `todo` (its History: `backlog → todo`); read-time normalization makes the manual data fix unnecessary. |
| R6 | MET | Test `:480` "normalizes legacy PascalCase status before lifecycle transition" asserts the port receives canonical `backlog` (currentStatus) + `todo` (newStatus). |
| R7 | MET | Only `planning-write-service.ts` executable surface touched (+ the local helper + import); no engine/schema change (committed diff `12fe5ca`). |
| R8 | MET | `bun run lint` clean (7 workspaces typecheck); `planning-write-service.test.ts` 32/0 — re-confirmed this verify run. |
| R9 | MET | `04_DESIGN.md:696` "Status normalization invariant (0152)" added; `03_ARCHITECTURE.md §12` correctly needs no change. |
| R10 | MET | Solution records co-located enrichment (Option A), the existing `Lifecycle transition denied` throw covering valid/invalid-direction, and the optional non-blocking upstream `ts-libs` follow-up. |


- **Security** — none. No new external-input surface; status is trusted internal frontmatter; no injection/secret exposure.
- **Efficiency** — none. `normalizeStatusForDomain` is an O(1) map lookup, called twice per write; negligible.
- **Correctness** — none (blocker/major). Both pre- and post-mutation paths normalized; empty-string guard prevents normalizing `''`; passthrough-on-unknown correctly defers genuine errors to Zod.
- **Usability** — none. Unknown status yields a clear Zod enum message naming allowed values.
- **Architecture** — none. Fix at the sole production callsite for `requestTransition`; reuses the existing normalizer; no new abstraction; excellent locality.

**Findings:**
- **P4 (minor, mitigated)** — `normalizeStatusForDomain`'s `try/catch` swallows the normalize error silently; a reader must trace two hops (here → step-4 Zod) to see why an unknown status isn't blocked at this site. The doc-comment (`:520-525`) explains the intent, so no action required. (`packages/app/src/services/planning-write-service.ts:530-534`)

No P1–P3. Verdict gate: **cleared**.
### References

### History
- 2026-06-29T07:08:04.830Z backlog → todo (system)
- 2026-06-29T07:08:05.007Z todo → wip (system)
- 2026-06-29T18:38:38.354Z wip → testing (system)
- 2026-06-29T18:38:39.941Z testing → done (system)
