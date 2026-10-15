---
schema_version: 1
name: Complete PR-9 release and workflow-cost CLI absorption
status: todo
template: standard
created_at: 2026-10-15T17:50:40.221Z
updated_at: "2026-10-15T18:32:35.518Z"
ac_altitude: task-local
ac_numbering: task-local
parent_wbs: "1211"
priority: P1
tags:
  - script-absorption
  - pr9
estimate_hours: 6

feature_id: A91
---

## 1212. Complete PR-9 release and workflow-cost CLI absorption

### Background

Complete the unfinished PR-9 absorption in draft PR #26, not the already-landed PR #24 delta. Current main is bfdb9d6e6; PR #26 head is 05963c3ff and GitHub reports CONFLICTING. Its two unique commits implement `workflow cost`, `builder publish`, `builder bump-ver --check` and `self migrate --check`. Reconcile that branch with current main using a merge commit, preserving the accepted CLI transports, security/argv fixes, hooks and matrix entries. Task 1213 consumes the accepted migration and retires the final script infrastructure; parent 1211 owns acceptance and landing.

The recorded CI run https://github.com/gobing-ai/spur/actions/runs/38776447947 is historical evidence (11026 pass, 26 existing skips, four contract failures), not validation of a reconciled branch. Current branch source confirms literal `--json` in workflow/cost.ts and missing owning workflow/self help updates in its unique diff. No implementation tests were run during this refinement.

**Refine corrections (2026-10-15)**
- Wording “PR-9 is complete and green” → that was the target AC, not current state → explicitly retain draft completion scope.
- “Incorporate PR #24” → #24 and the ready stack are already in main; #26 now conflicts → merge current main and retain only the two unique PR-9 commits plus reconciliation fixes.
- Static-test path repair → current shared-option scanner already reads per-noun folders through apps/cli/tests/command-modules.ts → use SHARED_OPTIONS.json in cost.ts; do not weaken or unnecessarily rewrite the scanner.
- Force workflow-promotion through workflow cost JSON → invalid replacement: promotion requires selected runIds and per-run count/duration distributions; cost JSON exposes aggregate workflow/state rows → retain its existing domain-owned readAgentRunHistoryRows query and repo-owned policy (ADR-076), with no lossy adapter or new public flags.
- “Refresh golden evidence” → preserve the committed PR-9 capture and normalize only demonstrated environment differences → do not regenerate expected behavior from the candidate implementation.

### Requirements

- [ ] R1. Complete only the existing approved workflow cost, builder publish, builder bump-ver --check and self migrate --check implementations in #26. Preserve measurement/cohort/null semantics, existing normal bump/migration behavior, and manifest restoration on publish success/failure; verification never performs a real publish or tag push.
- [ ] R2. Resolve the recorded help/reference/shared-option parity failures against the reconciled source: use the existing shared option registry and document every actual workflow cost and self migrate --check flag in both help trees and the spur-cli references. Preserve all existing source-scan assertions.
- [ ] R3. Remove live callers of scripts/commands/{publish,real-run-cost,pipeline-budgets,importer-schema-check,check-marketplace-version}.ts and obsolete corresponding tests. Keep repository workflow-promotion policy and its selected-run domain query intact; do not substitute aggregate cost JSON for its per-run data.
- [ ] R4. Reconcile package exports/scripts, root/workspace manifests, CLI matrix, surface/runtime rules, existing publish.yml caller and owning design contracts. Preserve accepted commands/hooks, root/scripts bunfig.toml and gate scope; no new noun, verb or compatibility layer beyond #26's approved delta.
- [ ] R5. Submit a ready #26 with fresh focused/parity/full-gate evidence and at least 90% function AND line coverage for every changed measured executable file, exact tested head, documented historical skips, and no new skips or weakened assertions. Root reviewer accepts and lands the result before 1213 begins.

### Acceptance Criteria

```gherkin
Scenario: AC1 — PR-9 is complete and green (req: R1, R2, R3, R4, R5)
Given draft PR #26 has merged the accepted current main baseline without losing its commands or safeguards
When CLI/app cost, budget, release, migration, frozen golden parity and help/shared-option suites run against temporary data and fake publishing
Then workflow cost preserves measured/null/cohort semantics and all documented flags match live registrations
And publish restoration is proven on success, returned failures and thrown runner errors without a real publication
And check-only release/migration paths have no manifest, tag, migration or absent-database creation side effects
And retired script paths have no live callers while workflow-promotion retains selected-run replay and domain-owned query semantics
And the required full gate passes with at least 90% function and line coverage for every changed measured executable file
And the ready PR records the exact tested head and receipts for root reviewer acceptance before task 1213 starts
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-15T18:32:34.397Z

Closed by ready audit: preserve and finish #26; merge current main with no rebase or force push. Four historical CI failures are audit inputs, not presumed the complete failure set. Preserve the golden capture. Shared-option source scanning already supports command folders; fix declarations and actual docs rather than weaken tests. Preserve workflow-promotion's selected-run query: the proposed aggregate workflow cost substitution is invalid for its cohort and statistics, so no new CLI flag/schema is invented. Parent 1211's historical substitution wording is reconciled during its final acceptance. PR-8 infrastructure retirement stays exclusively with 1213. Existing approved publish.yml caller change is in scope; unrelated CI changes and real publication are out of scope.

### Design

No new API beyond the already-approved PR-9 surface. Continue branch feat/builder-publish-cost-migrate-absorb in its own worktree and merge origin/main (no rebase/force/no-verify). The frozen read-only/write boundaries are:

| Surface | Existing owner / behavior to preserve | Observable tests |
| --- | --- | --- |
| workflow cost: --workflow (repeatable), --by-state, --include-bookkeeping, --since, --budget, --measured-file, --json | apps/cli/src/commands/workflow/cost.ts over packages/app/src/workflow/run-cost.ts; measured-file requires budget; stable JSON, real terminal non-dry cohorts, null for unknown measurements, budget exit 1 on violations | apps/cli/tests/commands/workflow/cost.test.ts; packages/app/tests/workflow/run-cost.test.ts and run-cost-budget.test.ts; script-absorption-pr9-parity.test.ts |
| builder publish <dir> [--otp] | apps/cli/src/commands/builder.ts and apps/cli/src/release-ops.ts; native argv process seam, workspace/catalog range resolution, build before npm publish, restore original manifest bytes in finally | apps/cli/tests/release-ops-publish.test.ts with fake runner and temporary workspace, including thrown runner/build/publish failures |
| builder bump-ver --check [target] | existing release-ops checkVersionDrift; target defaults to configured aggregate; read-only, nonzero on drift; reject incompatible write flags (--push/--all) instead of silently ignoring them | release-ops-publish.test.ts and commands/builder.test.ts; assert no process, tag or manifest mutation |
| self migrate --check | apps/cli/src/commands/migrate.ts and context.ts; check the selected database without boot-time migration, absent DB stays absent, report importer drift without repair | apps/cli/tests/commands/self-migrate-check.test.ts; temporary absent/matching/drifting DBs and existing normal migration tests |

Retain scripts/commands/workflow-promotion.ts's repository policy and readAgentRunHistoryRows seam: selected-run replay and full agent-run statistics are not represented by workflow cost's aggregate payload. No workflow cost flag/schema extension is authorized to make those unlike cohorts interchangeable. The older parent wording requiring that substitution needs reconciliation at final 1211 acceptance.

Additional targets: apps/cli/package.json, package.json/bun.lock only when required, packages/app/package.json, scripts/spur-dev.ts, fleet-e2e/verify-pack callers, docs/help/{cmd_builder,cmd_workflow,cmd_self}.md, matching help2 and spur-cli noun references, docs/design/{cli-contracts,harness-surface-governance}.md, config/rules/{surface/check-cli-surface,strict/runtime-boundaries}.yaml and .github/workflows/publish.yml's existing approved caller change. Preserve unrelated rule edits only if justified by this migration; remove accidental drift.

Dependency handoff: no upstream WBS dependency; main already contains #24. Leave 1213 a CLI-only non-hook caller set plus the intentionally surviving script-root infrastructure. Do not retire its manifests/checker in this task. Only task 1211 is wip, as the orchestration parent; one worktree exists at refinement, no competing implementation writer was observed. Before implementation verify installed workspace versions match the lockfile and use the project's safe worktree setup; source CLI for new commands until bundle/link is rebuilt.

Non-goals: PR-8 cleanup, new public surfaces, changing promotion statistics, live publication, dependency upgrades unrelated to this delta, editing bunfig, suppressing gates. Use the existing process/DB/FS seams and native argv; preserve artifact-ID guards and space-path handling when resolving shared files.

### Plan

1. (R1,R4) Start from a clean task worktree on the existing #26 branch; confirm head/CI, lockfile installation and ownership. Merge current origin/main with a conventional merge commit and preserve both sides of additive registrations/exports/rules; recompute matrix counts from live help.
2. (R1,R2) Audit the reconciled command flags and migrate --check boot path; finish the read-only and publish restoration guarantees using the existing seams. Fix cost.ts shared JSON declaration and all owning help/reference flags, retaining current scanner assertions.
3. (R3,R4) Remove retired script callers and dispatcher cases; keep workflow-promotion selected-run replay unchanged. Update only the approved publish.yml caller and matching scripts/config/design contracts; preserve frozen golden fixtures.
4. (R1,R5) Run focused CLI/app tests in their workspaces: cost/budget/parity, publish success/build failure/publish failure/thrown runner restoration, check-only no-mutation and migration absent/drift cases. Add only missing behavioral protection; no real network publishing or tag pushes.
5. (R2,R4,R5) Run help/shared-option/CLI-surface parity and relevant release/pack caller tests. Link and bundle the CLI after source changes; run the serialized required task gate with configuration restored afterward. Record exact head and per-file function/line coverage >=90%.
6. (R5) Update #26 body and mark ready only when fresh checks pass. Submit to root review/acceptance; after landing hand the exact baseline and retired caller inventory to 1213. No automatic implementation or landing follows this refinement.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Parent task 1211 and dependent task 1213; existing active feature A91.
- PR https://github.com/gobing-ai/spur/pull/26 (audited head 05963c3ff); historical CI https://github.com/gobing-ai/spur/actions/runs/38776447947.
- Accepted integration https://github.com/gobing-ai/spur/pull/28; refinement main bfdb9d6e6.
- docs/plans/2026-10-14-spur-script-absorption.md, landing revision; ADR-021/ADR-076/ADR-130; docs/design/harness-surface-governance.md.
- Current apps/cli/tests/command-modules.ts:25 supports per-noun modules; scripts/commands/workflow-promotion.ts:235 owns selected-run DB opening and delegates to the domain query; packages/app/src/workflow/run-measurements.ts:53 defines aggregate agent count median, not promotion's distribution.
- One main worktree and only parent 1211 at wip were observed at freeze; recheck immediately before implementation.

### History
