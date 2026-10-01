---
schema_version: 1
name: Reject foreign-task verdict artifacts in shared completion and feature gates
status: done
template: issue
created_at: 2026-10-01T20:09:26.527Z
updated_at: "2026-10-01T21:39:50.063Z"
feature_id: F91

ac_altitude: task-local
ac_numbering: task-local
priority: P1
estimate_hours: 1
---

## 1042. Reject foreign-task verdict artifacts in shared completion and feature gates

### Background

**Finding.** An explicit foreign-task PASS is accepted by the shared completion reader. A read-only in-memory call to transitionTaskGuarded requested WBS 0001 while .spur/run/0001-verdict.json contained wbs: 9999, verdict: PASS and one MET requirement. The actual result was transitioned with a status write for 0001 → done. This is executable evidence of cross-task proof attribution, not a hypothetical root cause.

**Root seam and callers.** packages/app/src/services/done-transition-guard.ts:101 reads the requested filename but packages/app/src/services/done-transition-guard.ts:133 returns the parsed artifact without checking its explicit WBS. packages/app/src/services/task-transition.ts:189 consumes it for completion. packages/app/src/services/feature-check.ts:1000 uses the same reader for feature evidence, so artifact identity must be repaired once at that seam and exercised through both callers.

**Owner and deduplication.** F91 owns truthful task-corpus evidence and completion integrity. Existing task 1040 covers record-reader identity, diagnostics and stale close metadata, and explicitly excludes this shared done/feature guard. This task does not duplicate 1040.

**Direct fixes already resolved.** Session triage corrected the driver/reference statements about verdict-first ordering, authored Testing preservation, record's done support and session-review --triage. Do not reimplement those prose fixes.

**Scope.** Reject explicit foreign or invalid WBS identity before interpreting its rows. Keep matching artifacts and legacy artifacts omitting WBS compatible. Preserve the explicit operator force override as UNKNOWN/no valid task proof, not as acceptance of the foreign PASS. No new public noun, verb or flag, aggregation change, gate suppression, live task rewrite or corpus baseline change.

### Requirements

- [x] R1. The shared readVerdictArtifact rejects a present WBS field unless it equals the requested WBS; foreign, empty, null or non-string identity yields no usable artifact and a readError naming the selected path, expected WBS and actual value. Artifacts omitting WBS retain current compatibility.
- [x] R2. An unforced guarded done transition using such an artifact is denied before any task/audit write, and its diagnostic retains the identity error. Explicit force-done behavior remains available with normal override audit, but it treats the rejected artifact as UNKNOWN instead of crediting its foreign PASS.
- [x] R3. Feature verification cannot derive scenario credit from rejected foreign rows or relabel the identity error as an absent artifact eligible for tracked-Testing fallback. Matching/omitted-WBS and genuinely absent-artifact fallback behavior stay unchanged.
- [x] R4. Regression tests exercise the shared reader and actual guarded/feature callers; all targeted tests and bun run spur-check pass without relaxing existing gates or adding a duplicate reader.

### Acceptance Criteria

- [x] AC1 — The shared reader binds an explicit artifact identity to its requested task (req: R1)
  Given a requested 0001 artifact with explicit wbs 9999, empty, null or a non-string value
  When readVerdictArtifact reads it
  Then artifact is undefined and the existing readError/path fields name expected and actual identity
  And a matching 0001 artifact and a legacy artifact omitting WBS keep their valid behavior
  Verify in packages/app/tests/services/done-transition-guard.test.ts.

- [x] AC2 — Completion rejects foreign proof before writing task state (req: R2)
  Given a testing task 0001 and a PASS artifact explicitly tagged 9999
  When transitionTaskGuarded requests unforced done
  Then it raises GuardDeniedError naming 0001, 9999 and the selected path and writes no status/audit field
  When an explicit force override is requested
  Then existing override behavior remains, with UNKNOWN proof attribution rather than foreign PASS
  Verify in packages/app/tests/services/task-transition.test.ts with the real reader.

- [x] AC3 — Feature evidence cannot borrow another task's verdict (req: R3)
  Given a done coverer whose selected artifact names a different WBS with MET scenario rows
  When FeatureCheckService checks the feature
  Then those foreign rows provide no verified scenario credit and the identity diagnostic remains distinct from artifact absence
  And matching/omitted identity plus genuine missing-artifact tracked-Testing controls retain their previous results
  Verify in packages/app/tests/services/feature-check.test.ts.

- [x] AC4 — Existing valid gates and compatibility paths remain green (req: R1, R2, R3, R4)
  Given the existing service suites and project lint, coverage and rule configuration
  When the extended targeted suites and bun run spur-check run
  Then all applicable checks pass with unchanged aggregation, force-override policy and public CLI surface

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

**WHAT / WHY.** Bind a supplied artifact identity to the task whose filename selected it. The current shared reader verifies only JSON root/verdict presence, so a foreign PASS can authorize task completion.

**WHERE.** Change packages/app/src/services/done-transition-guard.ts:101 at readVerdictArtifact, which already receives requested wbs, runDir and the selected path. Propagate its existing readError/path through the denial path in packages/app/src/services/task-transition.ts:189. FeatureCheckService already consumes that reader at packages/app/src/services/feature-check.ts:1000; verify the existing diagnostic path without adding a parallel identity parser.

**Algorithm / frozen names.** After root validation and before returning an artifact, inspect only a present wbs field. Exact equality with the requested WBS is required; absent WBS retains compatibility. Return artifact: undefined with a bounded readError containing path, expected WBS and JSON-rendered actual value on rejection. Reuse the existing result shape; do not add a state registry or new public option.

The guarded transition must include readError/path when it denies. Existing force-done remains an operator override; its loaded artifact is undefined, so forced proof attribution is UNKNOWN. Never allow foreign rows to contribute a PASS. Feature checks retain identity readError as artifactError, which must not equal the literal artifact-is-missing sentinel that activates tracked-Testing fallback.

**Tests.** Extend done-transition-guard.test.ts for reader identity/control cases. Extend task-transition.test.ts through the real reader, asserting no unforced status/audit writes and truthful forced UNKNOWN. Extend feature-check.test.ts using its real shared reader, asserting no foreign scenario credit and preserving genuine missing-artifact fallback. Do not mock the reader carrying the bug.

**Anti-patterns / out of scope.** No changes to aggregateVerifyVerdict, verdict lint, task-pipeline.yaml, arbitrary historical task metadata, public nouns/verbs/flags or baseline/severity policy. Do not implement 1040's record reader or close-audit reconciliation here. Do not require WBS on legacy artifacts that currently omit it.

**Concurrency / handoff.** Task 1040 is todo and also targets task-transition.ts for audit reconciliation. Run the tasks serially or use isolated trees; retain the other task's changes. The existing E71 worktree is unrelated and was not changed by this triage. This task assumes only current existing reader fields, not an API that 1040 has yet to implement.

### Plan

- [x] 1. Reproduce the read-only 0001/9999 guarded-close case as a regression in the existing service test fixture; it must fail before the production change.
- [x] 2. Add present-WBS validation at the shared readVerdictArtifact seam, preserving omitted-WBS compatibility and existing result fields.
- [x] 3. Surface readError/path on guarded denial. Verify no unforced status/audit write; preserve explicit force override with UNKNOWN proof attribution.
- [x] 4. Add the feature-check caller regression and matching/omitted/absent controls; identity rejection must not activate the missing-artifact fallback.
- [x] 5. Run targeted done-transition-guard, task-transition and feature-check suites inside packages/app; then run bun run spur-check once.
- [x] 6. Verify requirements/AC and record the final task verdict before any done transition. No live-task force close or baseline change is a fix for the regression.

### Root Cause

readVerdictArtifact receives the requested WBS but returns the parsed object after JSON root/verdict validation without comparing parsed.wbs (packages/app/src/services/done-transition-guard.ts:133). transitionTaskGuarded then evaluates that object's aggregate for the requested task (packages/app/src/services/task-transition.ts:189). A read-only in-memory probe actually wrote 0001 → done from an artifact tagged 9999. FeatureCheckService reuses the same reader (packages/app/src/services/feature-check.ts:1000), exposing the same source identity gap to feature evidence consumption.

This is separate from 1040's record parsing and close-audit metadata. Repair the shared artifact identity seam; do not add caller-specific copies of the validation.

### Solution

Shared-reader identity binding (no public surface change; both gates inherit it):

- `packages/app/src/services/done-transition-guard.ts:133-149` — `readVerdictArtifact`: a present `wbs` field must string-equal the requested WBS; foreign/empty/null/non-string identity returns `{artifact: undefined, readError: "artifact identity mismatch at <path>: expected wbs '<wbs>', actual <json>"}` (omitted `wbs` keeps legacy compatibility). `GuardInput` gains (guard :85-89)  `readError?: string`; `evaluateDoneTransition`'s no-artifact deny branch emits an "artifact is unusable" denial carrying the reader error (path, expected/actual WBS, remediation) instead of the misleading "missing verify verdict artifact" text; verdict stays UNKNOWN so forced overrides attribute UNKNOWN, never the foreign PASS. `packages/app/src/services/task-transition.ts:189-203` passes `loaded.readError` through.
- `packages/app/src/services/feature-check.ts:847-1007` needs no production change: the identity readError is not the literal `'artifact is missing'` sentinel, so the tracked-Testing fallback (0672) does not fire; it lands in `L4.malformed-verdict-artifact`, rows stay empty → no scenario credit in `isScenarioVerified`.

Red-first: 7 new tests in `done-transition-guard.test.ts` (5 failed pre-fix), then AC2 (`task-transition.test.ts`: unforced foreign → GuardDeniedError naming both WBS + artifact path, no writes; forced foreign → transitioned with `forced.verdict === 'UNKNOWN'` + audit fields) and AC3 (`feature-check.test.ts` via setup0410: foreign → `L4.scenario-unverified` + malformed finding naming the identity error, no `L4.evidence-not-recoverable`; matching + omitted controls verified).

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | packages/app/tests/services/done-transition-guard.test.ts:466-562 (foreign/empty/null/non-string rejected; matching + omitted verified) |
| R2 | MET | packages/app/tests/services/task-transition.test.ts:238-275 (unforced deny names both WBS + path, no writes; forced → UNKNOWN attribution) |
| R3 | MET | packages/app/tests/services/feature-check.test.ts:3044-3090 (foreign no scenario credit + malformed finding; matching/omitted controls verify) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Active session-review --triage, 2026-10-01: actual in-memory result requestedWbs=0001, artifactWbs=9999, result=transitioned, statusWrites=[{wbs:0001,status:done}]. No live task was mutated by the probe.
- Shared reader: packages/app/src/services/done-transition-guard.ts:101.
- Guarded completion caller: packages/app/src/services/task-transition.ts:189.
- Feature evidence caller: packages/app/src/services/feature-check.ts:1000.
- Missing-only tracked Testing fallback: packages/app/src/services/feature-check.ts:849.
- Existing task 1040 (F91): record diagnostics/record identity and close-audit reconciliation; serialize task-transition.ts edits.
- Feature F91: truthful corpus evidence; existing completed task 0958 also owns completion-gate integrity.
- Verification targets: packages/app/tests/services/done-transition-guard.test.ts; packages/app/tests/services/task-transition.test.ts; packages/app/tests/services/feature-check.test.ts.

### History

- 2026-10-01T21:32:15.693Z todo → wip (system)
- 2026-10-01T21:39:31.387Z wip → testing (system)
- 2026-10-01T21:39:50.063Z testing → done (system)

