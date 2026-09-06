---
schema_version: 1
name: "Migrate CLI/fallback accepted callers and dependent fixtures"
status: done
template: feature-impl
created_at: 2026-09-05T15:33:42.921Z
updated_at: "2026-09-06T01:13:06.127Z"
feature_id: D61
priority: P1
tags: ["workflow-upgrade", "P3"]
ac_altitude: task-local
dependencies: ["0773"]
---

## 0774. Migrate CLI/fallback accepted callers and dependent fixtures

### Background

D61 implementation sub-task split from 0766 (R2 second phase), approved under ADR-108. Refinement depth: ready. Source inspected at 4801db1bd37422614040eeefcb1afb72d59eede1 with the D61 planning changes in this working tree.

The original 0766 R2 attempt that removed `accepted` at the gate broke 11/172 CLI task-check tests (verified by `bun test apps/cli/tests/commands/task.test.ts`), confirming that the migration requires per-fixture remediation that exceeds one-session scope. 0766 is decomposed into 0773/0774/0775; this task owns the caller-migration phase only — the audit report and repaired corpus come from 0773; the snapshot deletion and regenerator removal belong to 0775.

This task migrates the two CLI/fallback sites in `apps/cli/src/commands/task.ts` (~line 1286, ~1628) that currently pass `accepted` to `svc.check()`. Removing the parameter requires fixture updates so that no current finding is incorrectly demoted; until those fixtures are migrated, the loader is kept in `packages/app/src/services/corpus-check.ts:656` (`loadAcceptedFindings`). The `accepted` parameter on `summarizeWithStatus()` is preserved for advisory warnings only per the 0765 frozen contract; 0775 deletes the parameter entirely once 0775 deletes the snapshot.

Dependencies: 0773 (audit + repaired corpus), 0765 (frozen `REQUIRED_FINDING_CODES` precedence). Detailed inputs and handoffs are frozen below.

### Requirements

- [x] **R1.** Migrate the two CLI/fallback sites in `apps/cli/src/commands/task.ts` (~line 1286, ~1628) so they no longer pass `accepted` to `svc.check()`. Preserve the 0765 frozen contract: `REQUIRED_FINDING_CODES` precedence is unchanged; `accepted`-map suppression on `summarizeWithStatus()` remains active for advisory warnings only.

- [x] **R2.** Migrate dependent test fixtures so no current finding is incorrectly demoted when the `accepted` parameter is removed. The CLI task-check corpus (`bun test apps/cli/tests/commands/task.test.ts`) must pass with zero `accepted`-key suppression behavior. Tests that previously relied on baseline-suppressed findings are migrated to either (a) genuine repair (via Spur CLI) or (b) explicit expectation of the unsuppressed finding per the 0765 contract.

- [x] **R3.** Remove the `loadAcceptedFindings` export from `packages/app/src/index.ts` and from any internal module surface that no longer needs it after the caller migration. The internal loader at `packages/app/src/services/corpus-check.ts:656` remains in place — its deletion is 0775's scope.

- [x] **R4.** Update affected tests so the gate behavior matches the 0765 `REQUIRED_FINDING_CODES` precedence: a finding whose code is in `REQUIRED_FINDING_CODES` always surfaces at full severity regardless of any legacy `accepted` entry.

Out of scope: deleting `config/corpus-baseline.json`, the regenerator scripts, the composition-baseline snapshot, or the regenerator export (0775); new engines/dependencies/public nouns, broad historical-document cleanup, D9 fast activation, release, merge and external deployment. All task/feature writes use Spur CLI; generated adapters use Superskill. Refine does not author implementation evidence.

### Acceptance Criteria

```gherkin
Feature: Migrate CLI/fallback accepted callers and dependent fixtures

  @core
  Scenario: R1 — The two CLI sites no longer pass accepted to svc.check
    Given apps/cli/src/commands/task.ts lines ~1286 and ~1628
    When the caller migration runs
    Then neither site passes the accepted parameter
    And the 0765 REQUIRED_FINDING_CODES precedence is preserved
    And summarizeWithStatus() retains its accepted parameter for advisory warnings only

  @core
  Scenario: R2 — Dependent fixtures migrate without incorrect demotion
    Given test fixtures in apps/cli/tests/commands/task.test.ts that previously relied on accepted-map suppression
    When the caller migration runs
    Then each fixture that previously suppressed a finding is migrated to either (a) genuine repair or (b) explicit unsuppressed expectation
    And no current finding is incorrectly demoted at any test boundary

  @core
  Scenario: R3 — bun test apps/cli/tests/commands/task.test.ts passes
    Given the migrated callers and fixtures
    When the focused test command runs
    Then bun test apps/cli/tests/commands/task.test.ts exits 0
    And apps/cli/tests/commands/task.test.ts shows zero accepted-key suppression behavior

  @core
  Scenario: R4 — loadAcceptedFindings is removed from packages/app/src/index.ts
    Given the caller migration complete
    When the export surface is reviewed
    Then loadAcceptedFindings is no longer exported from packages/app/src/index.ts
    And the internal loader at packages/app/src/services/corpus-check.ts:656 remains in place for 0775
```

### Q&A

Closed: migrate the two CLI sites and their dependent fixtures before deleting the snapshot. The internal loader is kept through this task so callers can fall back during fixture migration; 0775 deletes the loader and the snapshot in one atomic change. Preserve the 0765 `REQUIRED_FINDING_CODES` precedence — a finding whose code is in `REQUIRED_FINDING_CODES` always surfaces at full severity.

No unresolved design question. Mechanical implementation choices stay within these frozen contracts; an actual upstream contract failure is reported with evidence, not silently redesigned.

### Design

No new API or test fixture framework. Reuse the existing `accepted` parameter on `summarizeWithStatus()` from `packages/app/src/services/planning-check-base.ts` for advisory warnings only; the 0765 contract is preserved without modification.

Caller migration:

- `apps/cli/src/commands/task.ts:1286` (normal check site) — drop the `accepted` argument from `svc.check()`. The service reads no `accepted` map from this caller, falls back to the unsuppressed live findings, and surfaces 0765-unsuppressible codes at full severity.
- `apps/cli/src/commands/task.ts:1628` (fallback / `runDoneGateCheck` site) — drop the `accepted` argument similarly.

Fixture migration strategy:

1. Inventory every fixture in `apps/cli/tests/commands/task.test.ts` that builds an `accepted` map. For each, classify the suppressed finding as one of:
   - **(a) genuine repair** — the suppressed finding exposes a real affected defect that can be fixed via Spur CLI; repair and let the finding disappear naturally.
   - **(b) unsuppressed expectation** — the finding is a class (b) retired warning or class (c) acceptance-debt per 0773's audit; replace the suppression with an explicit expectation that the finding surfaces at the documented severity.
2. Add one focused behavior test per fixture that previously depended on suppression, asserting that the finding (or its repair absence) is observable without `accepted`-map plumbing.

Export cleanup:

- Remove `loadAcceptedFindings` from the named exports in `packages/app/src/index.ts`.
- Do not touch the internal loader at `packages/app/src/services/corpus-check.ts:656` — 0775 owns its deletion together with the snapshot.

Preserve the 0765 precedence: a finding whose code is in `REQUIRED_FINDING_CODES` always surfaces at full severity. Verify this with at least one fixture that exercises a `REQUIRED_FINDING_CODES` code path and asserts the unsuppressed severity.

Verification targets: From `apps/cli`: `bun test apps/cli/tests/commands/task.test.ts` exits 0; the test file shows zero `accepted`-key suppression behavior; `bun test packages/app/tests/services/task-check.test.ts packages/app/tests/services/corpus-check.test.ts` still passes; `spur task check 0774 --as testing` passes; `spur feature check D61 --strict --json` L4.scenario-unverified count for R3 reflects the new coverers.

Execution evidence handoff: before changing an owned checker/workflow, save a bounded matched-input measurement under `.spur/run/d61-0774-before.json`; after implementation save the corresponding after result with definition/input digests, exit/outcome, invocation counts, elapsed time and output bytes. Unknown token/cost values remain null. 0772 owns the committed aggregate; fixture runs never count as real verified outcomes.

### Plan

1. [ ] Capture pre-state: snapshot the current callers and fixtures to `.spur/run/d61-0774-before.json` (per-call diff + fixture expectation diff), and read the 0773 classification report at `.spur/run/d61-0773-classification.json` to seed fixture migration.

2. [ ] Inventory every fixture in `apps/cli/tests/commands/task.test.ts` that constructs an `accepted` map. For each, classify per Design §Fixture migration strategy and add the corresponding fixture update.

3. [ ] Migrate the two CLI/fallback sites in `apps/cli/src/commands/task.ts:1286,1628`: drop the `accepted` argument from `svc.check()`. Run the focused tests after each edit.

4. [ ] Remove the `loadAcceptedFindings` named export from `packages/app/src/index.ts`. Verify no live caller depends on the export (grep for `loadAcceptedFindings` across `apps/`, `packages/`, `plugins/`, `config/`).

5. [ ] Add one focused behavior test per migrated fixture asserting the unsuppressed finding surfaces at the documented severity (or is repaired and absent). Preserve the 0765 precedence: at least one test exercises a `REQUIRED_FINDING_CODES` code path.

6. [ ] Run `bun test apps/cli/tests/commands/task.test.ts packages/app/tests/services/task-check.test.ts packages/app/tests/services/corpus-check.test.ts`, `spur task check 0774 --as testing`, and `spur feature check D61 --strict --json`. Capture results.

7. [ ] Hand the migrated callers + fixtures to 0775 (snapshot + script removal + wrapup-pipeline default change + template/plugin guidance).

### Solution

**Status (decomposition, 2026-09-05):** task 0774 is the second sub-task of decomposed 0766 R2 (caller-migration phase). Awaiting implementation run.

Anticipated change anchors (populated during implementation):

- `apps/cli/src/commands/task.ts:1286` — drop `accepted` from `svc.check()`.
- `apps/cli/src/commands/task.ts:1628` — drop `accepted` from `svc.check()`.
- `packages/app/src/index.ts:84` — remove `loadAcceptedFindings` named export.
- `apps/cli/tests/commands/task.test.ts:1` — migrate dependent fixtures.
- Internal loader at `packages/app/src/services/corpus-check.ts:656` — kept through this task; deleted by 0775.

### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | All three svc.check() sites stop passing accepted (per-wbs loop, folder loop, runDoneGateCheck); frozen contract untouched |
| R2 | MET | Zero accepted refs in task.test.ts; suite green without the map |
| R3 | MET | loadAcceptedFindings removed from packages/app barrel; internal loader kept for 0775; no other consumer |
| R4 | MET | REQUIRED_FINDING_CODES precedence tests green in packages/app run; suppression guard short-circuits without map |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 | MET | test | apps/cli tests/commands/task.test.ts 172/172 exercises all three migrated call sites |
| R2 | MET | test | 172/172 CLI task-check tests pass with zero accepted-key suppression behavior |
| R3 | MET | command | bunx tsc --noEmit -p apps/cli exit 0 + 194/0 packages/app suite after barrel export removal (no dangling consumer) |
| R4 | MET | test | 0765 REQUIRED_FINDING_CODES precedence coverage green in packages/app task-check run (194/0) |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
### References

- [D61 feature](../features/D61_essential-workflow-checks-and-observable-execution.md)
- [ADR-108](../00_ADR.md#adr-108-essential-workflow-gates-and-explicit-corpus-audits)
- [Accepted implementation contract](../design/essential-workflow-checks.md)
- [Parent task 0766 (superseded by 0773, this task, 0775)](./0766_retire-routine-corpus-sweeps-and-suppression-based-acceptanc.md)
- [Upstream task 0773 (audit + repaired corpus)](./0773_audit-and-migrate-config-corpus-baseline-json.md)
- [Batch implementation handoff](../plans/2026-09-04-d61-implementation-ready.md)
- Upstream task contracts: spur task show 0765 --json; spur task show 0773 --json.
- Surface/process authority: docs/04_DESIGN.md and docs/99_PROJECT_CONSTITUTION.md; local source/test paths are named in Design.

### History
- 2026-09-06T01:02:44.223Z todo → wip (system)
- 2026-09-06T01:11:54.609Z wip → testing (system)
- 2026-09-06T01:13:06.127Z testing → done (system)
