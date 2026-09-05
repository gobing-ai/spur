---
schema_version: 1
name: "Make essential completion checks explicit without blanket strictness"
status: todo
template: feature-impl
created_at: 2026-09-05T05:21:56.820Z
updated_at: "2026-09-05T05:42:32.242Z"
feature_id: D61
priority: P1
tags: ["workflow-upgrade", "P1"]
---

## 0765. Make essential completion checks explicit without blanket strictness

### Background
D61 implementation package P1, approved under ADR-108. Refinement depth: ready. Source inspected at 4801db1bd37422614040eeefcb1afb72d59eede1 with the D61 planning changes in this working tree.

TaskCheckService already evaluates asStatus through its matrix and status-dependent rules. FeatureCheckService currently applies asStatus to one-active-goal and repairs, but uses frontmatter status for its main matrix/L4 checks. Feature completion still relies on --strict to elevate unverified-scenario warnings. Task --strict-core is already a no-op compatibility alias. These are policy/caller changes, not a new validator.

Dependencies: none. Detailed inputs and handoffs are frozen below.
### Requirements
- [ ] **R1.** Normal checks preserve essential completion integrity: implement the state/code policy in Design in the existing check services and completion owners. Essential identity, required contract/reference and completion-proof failures remain blocking despite severity overrides or accepted findings; presentation warnings alone pass. Preserve opt-in --strict and exact task --strict-core alias parity. Both lifecycle and in-process fallback must evaluate the target status and deny false completion.

Out of scope: new engines/dependencies/public nouns, broad historical-document cleanup, D9 fast activation, release, merge and external deployment. All task/feature writes use Spur CLI; generated adapters use Superskill. Refine does not author implementation evidence.
### Acceptance Criteria

```gherkin
Feature: Make essential completion checks explicit without blanket strictness

  @core
  Scenario: R1 — Normal checks preserve essential completion integrity
    Given a task or feature with missing required evidence, a stale verdict, a broken required reference, or an illegal completion transition
    When its affected write or completion boundary is checked without blanket strict warning elevation
    Then the operation fails with the essential finding
    And document-style warnings alone do not block otherwise valid completion
    And the legacy task strict-core alias produces the same result as the normal task check

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-05T05:42:31.992Z

Closed: keep compatibility flags; no blanket warning elevation; feature asStatus applies across its entire check. Preserve review-priority/file-citation consumer contracts rather than deleting parsers in this task. Corpus suppression removal is 0766; D9 fast activation is excluded.

No unresolved design question. Mechanical implementation choices stay within these frozen contracts; an actual upstream contract failure is reported with evidence, not silently redesigned.
### Design
No new public API, finding-code namespace, validator or policy configuration. Reuse FINDING_CODES from packages/config/src/finding-codes.ts and the existing finding DTO. Change packages/app/src/services/{planning-check-base,task-check,feature-check,done-transition-guard}.ts and affected apps/cli/src/commands/{task,feature}.ts callers.

Freeze the policy below at the emit/shared-summary seams; do not infer policy from the L3/L4 prefix:

| Existing finding/condition | Normal disposition |
| --- | --- |
| L1.markdown-parse, L1.schema-validation; missing required section with matrix gate=true; requirements-empty, ac-empty, ac-bdd-error/invalid; required-section-placeholder | Error whenever the existing consumer requires that contract; preserve template/group exemptions |
| feature-not-found, parent-not-found, dependency-not-found, linked-task-parse-failed, prerequisite-cycle | Error when the declared edge is present and cannot resolve; do not require an optional absent feature_id |
| Feature orphan-scenarios, uncovered-feature-scenario, scenario-unverified, verifying-incomplete-tasks, verdict-rows-match-no-scenario, malformed-verdict-artifact, evidence-not-recoverable, dogfood-missing | Error at effective done; keep pre-completion advisory behavior. Emit incomplete-task diagnostics for done as well as verifying, counting non-done/non-cancelled linked tasks |
| Task malformed-verdict-artifact, testing-verdict-stub, uncovered-task-scenario, review-testing-contradiction; rollup-subtasks-open, rollup-missing-roster, rollup-roster-not-declared-dependency | Error at effective done when applicable; preserve already-blocking earlier evidence checks and existing template exemptions |
| one-active-goal, children-limit, feature-terminal and explicit readiness/prerequisite-not-done checks | Preserve existing stage/transition semantics; do not broaden them into a new corpus policy |
| heading-level/order, forbidden/disallowed-section, requirements-format/checkbox, plan-format, unchecked-checklist, ac-bdd-warning, gate-language, prose-prerequisite-unlisted, stale-line-anchor, anchor-subject-mismatch, design-placeholder | Advisory where required semantic data remains parseable; required substance still checked independently |
| solution-file-line and review-priority-table | Preserve actual done-guard consumer requirements in this task; do not remove review evidence or its parser while calling it presentation |

All other codes retain existing behavior. Unsuppressible means the required error cannot be dropped or demoted by severityOverrides or accepted-map filtering: establish required severity before overrides and preserve that error through summary. Explicit strict still elevates remaining warnings; default callers never enable it. Do not globally ignore every override or harden every warning.

Feature effectiveStatus = options.asStatus ?? frontmatter.status must drive matrix selection, status-dependent rules, L4 and reported check status, matching TaskCheckService. Preserve group-feature exemptions, cross-folder task discovery and one-active-goal directionality. A malformed existing verdict must never fall back to tracked Testing; preserve existing aggregate/MET-row consistency, tracked-evidence recovery and run/proof provenance checks.

Update feature-lifecycle done guard to normal feature check --as done only alongside negative tests. Preserve task --as testing/done in every lifecycle/fallback path; remove first-party strict-core usage but retain the CLI flag and alias tests. Later YAML refinements belong to 0769/0770/0772; do not tag versions here.

Input: ADR-108 approved direction, existing proof guards. Output: tested normal target-state policy consumed by 0766, 0768 and lifecycle tasks. Record the disposition table with implementation evidence so 0766 can classify its audit without rediscovering policy.

Verification targets: From packages/app: bun test tests/services/planning-check-base.test.ts tests/services/task-check.test.ts tests/services/feature-check.test.ts tests/services/done-transition-guard.test.ts tests/workflow/lifecycle-adapter.test.ts tests/workflow/feature-lifecycle-adapter.test.ts. Extend apps/cli/tests/commands/task.test.ts for normal/strict-core payload parity. Tests must include both allowed valid completion and denied false completion, not just severity snapshots.

Execution evidence handoff: before changing an owned checker/workflow, save a bounded matched-input measurement under .spur/run/d61-<wbs>-before.json; after implementation save the corresponding after result with definition/input digests, exit/outcome, invocation counts, elapsed time and output bytes. Unknown token/cost values remain null. 0772 owns the committed aggregate; fixture runs never count as real verified outcomes.
### Plan
1. [ ] R1: Add regression fixtures for target done versus current verifying/todo, style-only completion, malformed/missing evidence and an unfinished linked task before changing policy.

2. [ ] R1: Apply the frozen effective-status and severity precedence in shared services; retain proof/verdict consumers and compatibility DTOs.

3. [ ] R1: Exercise real lifecycle requestTransition and in-process completion fallback, including severityOverrides=off and legacy accepted-map attempts against essential findings; only then remove automatic strictness.

4. [ ] R1: Sync ADR-108 migration notes, relevant prior ADR live contracts and docs/04_DESIGN.md; update canonical first-party check guidance in plugins/sp and config/templates without editing generated adapters.

5. [ ] R1: Run the focused tests below, applicable repository gate once for final inputs, normal task check and real task verification. Record one checker-policy audit under the policy in force; never regenerate a baseline to force green.
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
- Surface/process authority: docs/04_DESIGN.md and docs/99_PROJECT_CONSTITUTION.md; local source/test paths are named in Design.

### History
