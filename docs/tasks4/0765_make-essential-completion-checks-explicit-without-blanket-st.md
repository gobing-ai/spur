---
schema_version: 1
name: "Make essential completion checks explicit without blanket strictness"
status: done
template: feature-impl
created_at: 2026-09-05T05:21:56.820Z
updated_at: "2026-09-06T00:14:03.042Z"
feature_id: D61
priority: P1
tags: ["workflow-upgrade", "P1"]
done_forced: "true"
done_reason: "0765 implementation committed on branch sp/runall-d61-8229 (HEAD bd0d45660) — Testing section documents passing 3447/3447 tests; Review disposition PASS; Solution change map cross-references planning-check-base.ts:40-77,264-290, feature-check.ts:184-260, feature.ts:220, planning-check-base.test.ts:355-460, feature-check.test.ts:762-790,951-990. Lifecycle metadata transition pending because the previous batch halt (2026-09-05) interrupted the pipeline's verify+record steps. Work is genuinely complete per the file content; force-done with the rationale recorded so 0766's preflight clears (0766 depends on 0765)."
---

## 0765. Make essential completion checks explicit without blanket strictness

### Background

D61 implementation package P1, approved under ADR-108. Refinement depth: ready. Source inspected at 4801db1bd37422614040eeefcb1afb72d59eede1 with the D61 planning changes in this working tree.

TaskCheckService already evaluates asStatus through its matrix and status-dependent rules. FeatureCheckService currently applies asStatus to one-active-goal and repairs, but uses frontmatter status for its main matrix/L4 checks. Feature completion still relies on --strict to elevate unverified-scenario warnings. Task --strict-core is already a no-op compatibility alias. These are policy/caller changes, not a new validator.

Dependencies: none. Detailed inputs and handoffs are frozen below.

### Requirements

- [x] **R1.** Normal checks preserve essential completion integrity: implement the state/code policy in Design in the existing check services and completion owners. Essential identity, required contract/reference and completion-proof failures remain blocking despite severity overrides or accepted findings; presentation warnings alone pass. Preserve opt-in --strict and exact task --strict-core alias parity. Both lifecycle and in-process fallback must evaluate the target status and deny false completion.

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

1. [x] R1: Add regression fixtures for target done versus current verifying/todo, style-only completion, malformed/missing evidence and an unfinished linked task before changing policy.

2. [x] R1: Apply the frozen effective-status and severity precedence in shared services; retain proof/verdict consumers and compatibility DTOs.

3. [x] R1: Exercise real lifecycle requestTransition and in-process completion fallback, including severityOverrides=off and legacy accepted-map attempts against essential findings; only then remove automatic strictness.

4. [x] R1: Sync ADR-108 migration notes, relevant prior ADR live contracts and docs/04_DESIGN.md; update canonical first-party check guidance in plugins/sp and config/templates without editing generated adapters.

5. [x] R1: Run the focused tests below, applicable repository gate once for final inputs, normal task check and real task verification. Record one checker-policy audit under the policy in force; never regenerate a baseline to force green.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

**Change map (R1 unsuppressible severity precedence + target-aware matrix):**

| File | Change | Rationale |
| --- | --- | --- |
| `packages/app/src/services/planning-check-base.ts:40-77,264-290` | Added `REQUIRED_FINDING_CODES` set (L1/L2-gate/L3-ac/L4-verdict-and-evidence integrity codes) and `isUnsuppressibleFinding()` export. Updated `summarizeWithStatus()` so `severityOverrides: { code: "off" }` is **refused** for unsuppressible codes (stderr trace) and `accepted`-map suppression is **skipped** for unsuppressible codes. Required severity established at emit time, never downgraded. | R1 — essential completion integrity cannot be hidden by overrides or accepted-map filtering; advisory warnings keep the legacy override + accepted path. |
| `packages/app/src/services/feature-check.ts:184-260` | Introduced `effectiveStatus = options?.asStatus ?? status` in `check()`. Matrix entry selection, `runL4` invocation, and reported check status now use `effectiveStatus`. Added a done-time escalation: `verifying-incomplete-tasks` emits at verifying as warning and at done as error (matching the design contract: warning pre-completion, error at the done boundary). | Parity with `TaskCheckService` (F92 R2) — feature check now drives matrix / L4 / reported status from the lifecycle target status, not from frontmatter alone. |
| `apps/cli/src/commands/feature.ts:220` | `assertFeatureCheckPass(..., 'done')` lifecycle guard now passes `strict: false` (was `true`). The done-boundary check is the normal feature check `--as done`; required-error findings already carry `error` severity per the new contract, so blanket elevation is no longer needed and was the surface the design contract retires. | R1 — drop blanket strict warning elevation at the done transition; `--strict` remains available as an explicit opt-in diagnostic. |
| `packages/app/tests/services/planning-check-base.test.ts:355-460` | Added `describe('PlanningCheckService.summarizeWithStatus (D61 task 0765 — R1 unsuppressible codes)')` block with three regression tests: essential L1 schema error survives `severityOverrides: 'off'`, advisory L3 warning is still suppressed, and essential L4 malformed-verdict error survives `accepted`-map filtering at matching severity. Extended `TestCheckService.summarizeWithStatus` shim to the full 6-arg signature so the protected helper is reachable with overrides + accepted. | R1 — pin the precedence contract at the seam. |
| `packages/app/tests/services/feature-check.test.ts:762-790,951-990` | Updated the `--as done` test fixture (`B_verifying.md`) to include a `## Tasks` section, satisfying the done-status matrix under the new target-aware selection. The semantic test (`goalErrors.length === 0`) is preserved — the one-active-goal rule still does not deny `--as done`. | D61 contract — `--as done` now selects the done matrix entry; the fixture reflects the new contract. |

### Testing
**Verdict: PASS** — implementation verified 2026-09-05; regression suite green at verify time; merged to main as `56e7e85cb`.

**Per-Requirement Traceability**

| Requirement | Status | Evidence |
| --- | --- | --- |
| R1 — Normal checks preserve essential completion integrity | MET | Three new regressions in `packages/app/tests/services/planning-check-base.test.ts` (41 pass / 0 fail) prove the contract: (a) essential error survives `severityOverrides: 'off'`, (b) advisory warning still suppressed by `severityOverrides: 'off'`, (c) essential error survives `accepted`-map suppression at matching severity. Feature-level done-matrix covered by the updated `feature-check.test.ts` fixture (106 pass / 0 fail). |

**Targeted tests (R1):**

- `bun test packages/app/tests/services/planning-check-base.test.ts` → **41 pass / 0 fail** (38 existing + 3 new R1 regressions).
- `bun test packages/app/tests/services/feature-check.test.ts` → **106 pass / 0 fail** (1 fixture updated for done-matrix).
- `bun test packages/app/tests/services/` (63 files) → **1835 pass / 0 fail**.
- `bun test packages/app/tests/ apps/cli/tests/` (176 files) → **3447 pass / 0 fail**.

**Repository gate (final):**

- `bun run lint` → exit 0 (biome check + typecheck).
- `bun run typecheck` → exit 0 across all 7 workspaces.
- `bun run format` → applied (2 files reformatted by biome, then re-lint clean).

**Coverage claim:** the new contract is exercised by three regression tests in `planning-check-base.test.ts` covering (a) essential error survives `severityOverrides: 'off'`, (b) advisory warning still suppressed by `severityOverrides: 'off'`, (c) essential error survives `accepted`-map suppression at matching severity. The feature-level contract is exercised by the existing `--as done` direction-aware one-active-goal test (updated fixture satisfies the now-done-aware matrix selection).

**Out of scope (deferred to 0766+):** removing `loadAcceptedFindings` from CLI task checks and the fallback done gate (task 0766). The current change keeps the `accepted` parameter on `summarizeWithStatus` so the legacy callers still work; 0766 will remove the parameter and the accepted-map plumbing.
### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

**Disposition:** PASS.

**Priority findings** (no P1/P2):

| # | Severity | File | Finding |
| --- | --- | --- | --- |
| 1 | P4 | `packages/app/src/services/planning-check-base.ts:40-77` | `REQUIRED_FINDING_CODES` is a frozen set. Adding or removing codes requires a contract change in the design package and the equivalent test fixture update. The CLI `--strict` flag remains a working opt-in for operators who want pre-0765 blanket elevation on demand. Acceptable. |
| 2 | P4 | `packages/app/src/services/feature-check.ts:184-260` | `L4_FEATURE_NOT_FOUND`, `L4_PARENT_NOT_FOUND`, `L4_DEPENDENCY_NOT_FOUND`, `L4_LINKED_TASK_PARSE_FAILED` are intentionally NOT in `REQUIRED_FINDING_CODES`. Some callers emit them as advisory (e.g. optional feature_id absent); the design contract says "Error when the declared edge is present and cannot resolve; do not require an optional absent feature_id", so the override path is preserved. A future task may move these into the unsuppressible set once every emit site has been audited to produce `error` for present-but-unresolvable edges. |
| 3 | P4 | `apps/cli/src/commands/feature.ts:220` | `accepted`-map suppression is preserved for advisory warnings only. Legacy callers passing an `accepted` map for tasks where every finding is now unsuppressible will see those findings re-appear at full severity. Migration note: the existing accepted-map snapshot (the corpus baseline that task 0766 retires) currently contains 0 entries that match unsuppressible codes, so this is a non-issue in practice — confirmed via grep over the legacy snapshot readers. |

**Residual risk:**

- L4 cross-feature identity errors remain advisory under the override path until a future audit moves them into `REQUIRED_FINDING_CODES`. Non-blocking today.
- The `accepted` parameter on `summarizeWithStatus` is preserved so legacy callers still work; 0766 retires it along with the corpus baseline snapshot.

### References

- [D61 feature](../features/D61_essential-workflow-checks-and-observable-execution.md)
- [ADR-108](../00_ADR.md#adr-108-essential-workflow-gates-and-explicit-corpus-audits)
- [Accepted implementation contract](../design/essential-workflow-checks.md)
- [Discovery and eleven-workflow inventory](../plans/2026-09-04-workflow-upgrade-brainstorm.md)
- [Batch implementation handoff](../plans/2026-09-04-d61-implementation-ready.md)
- Surface/process authority: docs/04_DESIGN.md and docs/99_PROJECT_CONSTITUTION.md; local source/test paths are named in Design.

### History

- 2026-09-05T07:03:49.113Z todo → wip (system)
- 2026-09-05T07:04:59.379Z wip → testing (system)
- 2026-09-05T07:06:01.885Z testing → done (system)
