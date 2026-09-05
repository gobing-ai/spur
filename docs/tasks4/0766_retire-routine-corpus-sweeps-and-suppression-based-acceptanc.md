---
schema_version: 1
name: "Retire routine corpus sweeps and suppression-based acceptance"
status: todo
template: feature-impl
created_at: 2026-09-05T05:21:56.849Z
updated_at: "2026-09-05T05:42:34.214Z"
feature_id: D61
priority: P1
tags: ["workflow-upgrade", "P2"]
dependencies: ["0765"]
---

## 0766. Retire routine corpus sweeps and suppression-based acceptance

### Background
D61 implementation package P2, approved under ADR-108. Refinement depth: ready. Source inspected at 4801db1bd37422614040eeefcb1afb72d59eede1 with the D61 planning changes in this working tree.

Root corpus-check invokes task check --corpus. runCorpusCheck currently reconciles config/corpus-baseline.json, and loadAcceptedFindings also suppresses individual CLI/fallback task checks. composition-entrypoint-check explicitly requires both regeneration scripts. The accepted audit measured 828 observations against 299 unique baseline keys; these are different counts, not 828 independent waived defects.

Dependencies: 0765. Detailed inputs and handoffs are frozen below.
### Requirements
- [ ] **R1.** Routine work does not scan the whole corpus: remove default sweep invocations from task iteration, wrapup and ordinary corpus-touch commit guidance; retain affected task/feature and completion-boundary checks. Keep corpus-check and spur-check-new as explicit audit entrypoints only. Update constitution T10/T11, AGENTS and their canonical templates in the same change.

- [ ] **R2.** Explicit corpus audits remain useful without suppressions: preserve existing scope and JSON shape; report all observations, exit 1 on essential errors/required-check failure and 0 on warnings alone. Remove accepted-map readers, the corpus snapshot and its regenerator entirely. Repair newly exposed real affected integrity defects through Spur CLI; never erase findings, fabricate proof or bulk-reformat historical prose to obtain green.

Out of scope: new engines/dependencies/public nouns, broad historical-document cleanup, D9 fast activation, release, merge and external deployment. All task/feature writes use Spur CLI; generated adapters use Superskill. Refine does not author implementation evidence.
### Acceptance Criteria

```gherkin
Feature: Retire routine corpus sweeps and suppression-based acceptance

  @core
  Scenario: R1 — Routine work does not scan the whole corpus
    Given a task iteration, feature batch wrapup, or commit preparation that does not change checker policy
    When its applicable validation runs
    Then no automatic command invokes a whole-corpus sweep
    And the affected task, feature, and required linked evidence remain checked
    And adjacent guards reuse one result only until a relevant input changes


  @core
  Scenario: R2 — Explicit corpus audits remain useful without suppressions
    Given a corpus with essential integrity errors and historical document-quality warnings
    When the operator invokes bun run corpus-check
    Then the command reports both categories and exits non-zero for essential errors
    And warnings alone do not fail the audit
    And no corpus-baseline file suppresses a finding
    And checker-policy changes retain a documented one-time audit obligation

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-05T05:42:33.982Z

Closed: delete corpus acceptance and regeneration; do not build transitional pruning/expiry/waiver metadata. corpus-check remains an operator audit. A real unresolved evidence failure requires truthful repair/re-verification, never an accepted key or fabricated PASS.

No unresolved design question. Mechanical implementation choices stay within these frozen contracts; an actual upstream contract failure is reported with evidence, not silently redesigned.
### Design
No new API or waiver/pruning tool. Reuse collectObservedFindings and existing structuralSweep/duplicateIds/ungraduatedFog/resolveFogRange in packages/app/src/services/corpus-check.ts. Consume 0765 classification; retain active task-folder scans, feature checks, cross-folder identity/reference resolution and existing --since comparison semantics. An unavailable optional comparison must be explicitly reported as skipped; a failed required check cannot become an empty successful audit.

Replace baseline reconciliation with an unsuppressed result using the existing DTO: observed = all observed findings; baselined = 0; newErrors = all errors; newWarnings = all warnings; bySeverity entries have baselined=0 and newCount equal their unsuppressed count; duplicateKeys=[] (legacy baseline-key diagnostics, NOT corpus duplicate IDs); ok = no essential errors and no required-check failure. Duplicate corpus IDs remain real findings. Preserve other existing scope/result fields and JSON envelope behavior. Human output says errors/warnings rather than NEW/accepted debt; print counts and a saved detail path in agent guidance.

Remove loadAcceptedFindings calls from apps/cli/src/commands/task.ts normal check and runDoneGateCheck, its export from packages/app/src/index.ts, then unused accepted options/filtering in TaskCheckService/PlanningCheckService. Preserve 0765 essential-error precedence for configured overrides. Delete config/corpus-baseline.json, scripts/commands/regen-corpus-baseline.ts, its package.json script and regeneration-only tests. Remove only the corpus entry from composition-entrypoint-check in this task; 0767 deletes that now-redundant checker after composition retirement. Do not delete json-raw-baseline.json or history cache input snapshots.

In wrapup-pipeline replace the default featureGateCmd with the trusted-config command '$spurBin feature check "$feature"'; keep the variable override contract and existing execution seam. 0770 owns truthful sync terminal outcomes and run isolation. All automatic callers/guidance found by corpus-check, --corpus, spur-check-new and regen-corpus-baseline search in live source/config/plugins must use affected-input checks, except the explicit audit entrypoints and T10 checker-change obligation. Historical task evidence is not a live caller. Do not edit .github workflows without a specific authorized change.

T10: one explicit unsuppressed audit when checker policy changes; record/reconcile exposed essential failures without waivers. T11: ordinary commit prep checks changed task/feature documents and their required linked evidence, not the corpus. Mirror into config/templates/AGENTS.md and config/templates/docs/99_PROJECT_CONSTITUTION.md plus live plugin lifecycle guidance. Removal takes effect with this implementation, not retroactively during refinement.

Input: 0765 policy and completion regression coverage. Output to 0767/0769/0770: no corpus acceptance reader/snapshot and no routine sweep. Final generated stale-asset removal belongs to 0772 via build:bundle.

Verification targets: From packages/app: bun test tests/services/corpus-check.test.ts tests/services/corpus-sweep.test.ts tests/services/task-check.test.ts tests/services/done-transition-guard.test.ts. Extend CLI task-check corpus cases and script entrypoint cases; root bun run test covers scripts. Explicit audit command: bun run apps/cli/src/index.ts task check --corpus --json (save stdout once). Test that changing only a legacy baseline file changes neither findings nor exit code.

Execution evidence handoff: before changing an owned checker/workflow, save a bounded matched-input measurement under .spur/run/d61-<wbs>-before.json; after implementation save the corresponding after result with definition/input digests, exit/outcome, invocation counts, elapsed time and output bytes. Unknown token/cost values remain null. 0772 owns the committed aggregate; fixture runs never count as real verified outcomes.
### Plan
1. [ ] R1/R2: Before deletion, capture one audit artifact and classify observed essential errors under 0765; distinguish observation counts from keys. Fix concrete affected identity/reference defects with Spur CLI and preserve truthful unresolved evidence.

2. [ ] R2: Implement unsuppressed aggregation and CLI error/warning output with unchanged result fields; remove every accepted-map consumer before deleting its snapshot and regenerator.

3. [ ] R1: Remove routine sweep calls and corpus regeneration package/checker requirements; apply T10/T11 and template/plugin guidance changes plus the wrapup affected-feature default.

4. [ ] R2: Test warning-only, essential-error, duplicate-ID, required-reader failure, --since scope and malformed/missing legacy-baseline cases; prove legacy snapshots cannot influence individual or corpus results.

5. [ ] R1/R2: Run final focused tests, normal affected task/feature checks and exactly one final checker-policy audit; capture its exit/status/counts and any genuine unresolved failure. Run real task verification; never certify a nonzero audit as PASS.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- [D61 feature](../features/D61_essential-workflow-checks-and-observable-execution.md)
- [ADR-108](../00_ADR.md#adr-108-essential-workflow-gates-and-explicit-corpus-audits)
- [Accepted implementation contract](../design/essential-workflow-checks.md)
- [Discovery and eleven-workflow inventory](../plans/2026-09-04-workflow-upgrade-brainstorm.md)
- [Batch implementation handoff](../plans/2026-09-04-d61-implementation-ready.md)
- Upstream task contracts: spur task show 0765 --json.
- Surface/process authority: docs/04_DESIGN.md and docs/99_PROJECT_CONSTITUTION.md; local source/test paths are named in Design.

### History
