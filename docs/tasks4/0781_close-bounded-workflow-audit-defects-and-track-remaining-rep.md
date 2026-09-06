---
schema_version: 1
name: "Close bounded workflow audit defects and track remaining repairs"
status: done
template: review
created_at: 2026-09-06T18:21:26.043Z
updated_at: "2026-09-06T18:42:26.502Z"
feature_id: D6
---

## 0781. Close bounded workflow audit defects and track remaining repairs

### Background

#### Review Findings

| Priority | Finding | Repair |
| --- | --- | --- |
| P1 | F-01: command.gate and run.artifact accepted sibling prefixes outside the declared run directory | Reject lexical non-descendants before effects |
| P1 | F-02: source CLI truncated large piped JSON (65536 of 77158 bytes) | Preserve exitCode and allow natural shutdown after runtime cleanup |
| P2 | F-06: current delivery docs lagged shipped D61 and measured docs verification | Correct ADR, roadmap and architecture projections |

Operator requested full inline workflow audit, direct simple repairs, and tasks for larger fixes on 2026-09-06. D8/D9/D61 evidence is context; this task does not certify their missing behavior.

### Requirements

- [x] R1. Reject sibling-prefix, traversal and root-directory artifact paths in command.gate and run.artifact before command execution or ledger writes; retain valid descendants.
- [x] R2. Source CLI completes piped stdout/stderr before shutdown, preserving command exit status; a payload larger than pipe capacity stays valid JSON.
- [x] R3. Publish an evidence-backed workflow conflict report, correct stale D61 delivery projections, and create executable follow-up tasks for larger confirmed defects without claiming them fixed.

### Acceptance Criteria

```gherkin
Feature: Bounded workflow audit repairs
  Scenario: R1 — Artifact paths stay beneath the run directory
    Given an action path pointing at a sibling prefix or the run directory itself
    When command.gate or run.artifact executes
    Then the action refuses before executing a command or recording an artifact
    And valid descendant paths remain supported
  Scenario: R2 — Large CLI output survives a pipe
    Given a CLI JSON response larger than 65536 bytes
    When a subprocess consumer reads stdout to completion
    Then the response parses as the complete JSON value
    And the command exit code is preserved
  Scenario: R3 — Findings remain actionable and truthful
    Given the current workflow definitions and D8 D9 D61 obligations
    When the audit is recorded
    Then simple repairs carry fresh checks and larger repairs have scoped tasks
    And delivery projections distinguish shipped work from newly discovered gaps
```

### Q&A

<!-- Clarifications, false positives, accepted risk, and triage decisions. -->

### Design

Use existing path normalization and a separator-qualified descendant check at the two action owners; no new abstraction. Physical symlink confinement remains separate task 0785, not a sandbox claim. Let the CLI exit naturally after main closes its runtime and DB, setting process.exitCode to preserve failure status without truncating buffered pipe output. This replaces the initial explicit-exit drain proposal: Bun's write callbacks did not guarantee complete pipe output in the reproducer. Add focused executable regressions in existing workspace test locations. Documentation edits follow sp-doc-evolve and constitution dated-amendment rules. Larger feature/wrapup, resume/checkpoint and proof-input fixes remain separate tasks. No workflow YAML edits, new dependencies, public verbs, external messages or release.

### Plan

- [x] Reproduce boundary and pipe failures; add focused regressions.
- [x] Apply small owner fixes and delivery documentation corrections.
- [x] Create scoped follow-ups and record audit coverage.
- [x] Run targeted tests, final repository gate and build; prepare standalone verification evidence.

### Solution

Task 0781 repairs the bounded defects and records larger open work; it does not certify the entire workflow upgrade.

| File / anchor | Change |
| --- | --- |
| packages/app/src/workflow/actions/command-gate.ts:118 | Separator-qualified descendant guard before dispatch/write |
| packages/app/src/workflow/actions/run-artifact.ts:68 | Matching ledger boundary; physical symlinks remain 0785 |
| apps/cli/src/index.ts:217 | Natural shutdown with preserved exitCode after runtime/DB cleanup |
| packages/app/tests/workflow/actions/command-gate.test.ts:8 | Rejected sibling/root paths cannot execute or write |
| packages/app/tests/workflow/actions/run-artifact.test.ts:10 | Rejected sibling/root paths with existence probing disabled |
| apps/cli/tests/cli-pipe.test.ts:6 | Delayed real OS pipe proves complete large JSON and nonzero error status |
| docs/00_ADR.md:2244 | ADR-108 dated delivery correction; operator correction and Option B retained |
| docs/02_ROADMAP.md:1 | D61 delivered projection with follow-up qualification |
| docs/03_ARCHITECTURE.md:1139 | Measured docs verification and live effect facts replace stale current-state claims |
| docs/plans/2026-09-06-workflow-conflict-audit.md:1 | Eight findings, all four pillars/six boundaries, explicit incomplete coverage |
| docs/plans/2026-09-06-workflow-conflict-audit.json:1 | Matching machine envelope with anchored findings and fingerprints |
| docs/features/D6_workflow-cost-deterministic-ownership-surface-and-role-addressed-coordination.md:1 | CLI-owned follow-up AC and task roster |
| docs/tasks4/0782_reuse-existing-feature-plans-and-rosters-before-workflow-dis.md:1 | CLI-created planning reuse follow-up |
| docs/tasks4/0783_make-wrapup-consume-validated-inputs-and-fail-on-incomplete-.md:1 | CLI-created false-success wrapup follow-up |
| docs/tasks4/0784_align-workflow-resume-identity-and-checkpoint-freshness-with.md:1 | CLI-created resume identity/freshness follow-up |
| docs/tasks4/0785_close-remaining-proof-input-and-physical-artifact-confinemen.md:1 | CLI-created proof/symlink follow-up |
| docs/tasks4/0786_remove-stale-corpus-sweep-and-task-record-instructions-from-.md:1 | CLI-created canonical guidance follow-up |

Design adjustment: stream callbacks did not repair Bun's explicit-exit truncation; main already closes app and DB, so assigning process.exitCode is smaller and correct. No new dependency, abstraction, workflow YAML change, fast-route activation or host installation.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | command-gate.ts:118 and run-artifact.ts:68 reject lexical sibling/traversal/root paths; both action suites pass 22 tests, including valid descendant ledger and command paths. Physical symlinks remain explicitly separate 0785. |
| R2 | MET | index.ts:217 uses natural shutdown after runtime/DB cleanup. cli-pipe.test.ts:6 proves complete delayed OS-pipe JSON over 64 KiB and missing-feature exit 1. Source and bundled feature-list pipes parse 127 records. |
| R3 | MET | Audit JSON executable validation passed: 8 anchored findings, 3 repaired, 5 open follow-ups and incomplete coverage. Tasks 0782–0786 each pass source-local task check; ADR/roadmap/architecture delivery projections corrected. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| R1 — Artifact paths stay beneath the run directory | MET | test | cd packages/app && bun test tests/workflow/actions/command-gate.test.ts tests/workflow/actions/run-artifact.test.ts: 22 PASS, 70 assertions, zero failures. |
| R2 — Large CLI output survives a pipe | MET | test | apps/cli/tests/cli-pipe.test.ts:6 PASS with a delayed OS pipe and >64 KiB response; missing feature still exits 1. |
| R3 — Findings remain actionable and truthful | MET | command | Executable audit-envelope/path/status validation PASS; source-local task check 0782 through 0786 PASS. docs/plans/2026-09-06-workflow-conflict-audit.json records 8 findings, 3 repairs, 5 filed issues and coverage.complete=false. |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

Inline review coordinator: all five SECUA dimensions reviewed against the final source diff and executable regressions. No new unresolved defect in the bounded 0781 change; this is not an independent reviewer or full-workflow signoff.

| Priority | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P1 | command-gate.ts:118; run-artifact.ts:68; index.ts:217 | Lexical escapes and output truncation repaired with red-to-green regressions | Resolved in 0781 |
| P1 | Workflow/proof owners in audit F-03/F-04/F-05/F-07 | Larger existing planning, wrapup, resume and physical proof gaps remain | Open tasks 0782–0785; do not claim release readiness |
| P2 | Canonical capability sources in F-08 | Retired sweep, record and docs-stub instructions remain | Open task 0786 |
| P3 | Changed production code | No added type assertions, suppressions, logging, dependency or abstraction | No action |
| P4 | Audit evidence | Real model-run/token-cost coverage remains unavailable | Coverage explicitly incomplete; no savings estimate |

Security: both lexical owners reject before side effects; symlink limits remain explicit. Efficiency: one native prefix check, natural output drain, no repeated buffering layer. Correctness: negative and valid-path suites, large pipe and failure exit, full type/test gate. Usability: original actionable path errors and JSON shapes preserved. Architecture: app action owners and CLI composition root retain responsibility; no new interface.

### References

- `packages/app/src/workflow/actions/command-gate.ts`
- `packages/app/src/workflow/actions/run-artifact.ts`
- `apps/cli/src/index.ts`
- `apps/cli/src/output.ts`
- `docs/00_ADR.md` ADR-108
- `docs/02_ROADMAP.md`
- Feature D6; D8/D9/D61 audit scope.

### History

- 2026-09-06T18:22:18.013Z todo → wip (system)
- 2026-09-06T18:42:26.118Z wip → testing (system)
- 2026-09-06T18:42:26.502Z testing → done (system)
