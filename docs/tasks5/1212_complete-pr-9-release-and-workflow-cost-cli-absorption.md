---
schema_version: 1
name: Complete PR-9 release and workflow-cost CLI absorption
status: done
template: standard
created_at: 2026-10-15T17:50:40.221Z
updated_at: "2026-10-15T20:20:11.146Z"
ac_altitude: task-local
ac_numbering: task-local
parent_wbs: "1211"
priority: P1
tags:
  - script-absorption
  - pr9
estimate_hours: 6

feature_id: A91
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1212-verdict.json
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

- [x] R1. Complete only the existing approved workflow cost, builder publish, builder bump-ver --check and self migrate --check implementations in #26. Preserve measurement/cohort/null semantics, existing normal bump/migration behavior, and manifest restoration on publish success/failure; verification never performs a real publish or tag push.
- [x] R2. Resolve the recorded help/reference/shared-option parity failures against the reconciled source: use the existing shared option registry and document every actual workflow cost and self migrate --check flag in both help trees and the spur-cli references. Preserve all existing source-scan assertions.
- [x] R3. Remove live callers of scripts/commands/{publish,real-run-cost,pipeline-budgets,importer-schema-check,check-marketplace-version}.ts and obsolete corresponding tests. Keep repository workflow-promotion policy and its selected-run domain query intact; do not substitute aggregate cost JSON for its per-run data.
- [x] R4. Reconcile package exports/scripts, root/workspace manifests, CLI matrix, surface/runtime rules, existing publish.yml caller and owning design contracts. Preserve accepted commands/hooks, root/scripts bunfig.toml and gate scope; no new noun, verb or compatibility layer beyond #26's approved delta.
- [x] R5. Submit a ready #26 with fresh focused/parity/full-gate evidence and at least 90% function AND line coverage for every changed measured executable file, exact tested head, documented historical skips, and no new skips or weakened assertions. Root reviewer accepts and lands the result before 1213 begins.

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

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `.github/workflows/publish.yml:85` |
| `apps/cli/package.json:56` |
| `apps/cli/src/commands/builder.ts:10` |
| `apps/cli/src/commands/builder.ts:142` |
| `apps/cli/src/commands/builder.ts:24` |
| `apps/cli/src/commands/builder.ts:29` |
| `apps/cli/src/commands/builder.ts:4` |
| `apps/cli/src/commands/builder.ts:41` |
| `apps/cli/src/commands/migrate.ts:1` |
| `apps/cli/src/commands/migrate.ts:15` |
| `apps/cli/src/commands/migrate.ts:3` |
| `apps/cli/src/commands/migrate.ts:68` |
| `apps/cli/src/commands/migrate.ts:81` |
| `apps/cli/src/commands/migrate.ts:95` |
| `apps/cli/src/commands/workflow/cost.ts:1` |
| `apps/cli/src/commands/workflow/index.ts:37` |
| `apps/cli/src/commands/workflow/index.ts:7` |
| `apps/cli/src/context.ts:198` |
| `apps/cli/src/context.ts:209` |
| `apps/cli/src/release-ops.ts:828` |
| `apps/cli/tests/commands/builder.test.ts:141` |
| `apps/cli/tests/commands/builder.test.ts:65` |
| `apps/cli/tests/commands/builder.test.ts:75` |
| `apps/cli/tests/commands/builder.test.ts:77` |
| `apps/cli/tests/commands/self-migrate-check.test.ts:1` |
| `apps/cli/tests/commands/workflow/cost.test.ts:1` |
| `apps/cli/tests/fixtures/script-absorption-pr9-golden.json:1` |
| `apps/cli/tests/fixtures/script-absorption-pr9/measured-over.json:1` |
| `apps/cli/tests/fixtures/script-absorption-pr9/pipeline-budgets.json:1` |
| `apps/cli/tests/fixtures/script-absorption-pr9/seed.sql:1` |
| `apps/cli/tests/fixtures/script-absorption-pr9/workflows/pr-review.yaml:1` |
| `apps/cli/tests/fixtures/script-absorption-pr9/workflows/task-lifecycle.yaml:1` |
| `apps/cli/tests/fixtures/script-absorption-pr9/workflows/wrapup-pipeline.yaml:1` |
| `apps/cli/tests/fixtures/script-absorption-pr9/workflows/zz-unbudgeted.yaml:1` |
| `apps/cli/tests/release-ops-publish.test.ts:1` |
| `apps/cli/tests/script-absorption-pr9-parity.test.ts:1` |
| `apps/cli/tests/script-absorption-pr9/capture.ts:1` |
| `apps/cli/tests/script-absorption-pr9/cases.ts:1` |
| `config/pipeline-budgets.json:4` |
| `docs/design/cli-contracts.md:165` |
| `docs/design/cli-contracts.md:48` |
| `docs/design/harness-surface-governance.md:168` |
| `docs/help/cmd_builder.md:20` |
| `docs/help/cmd_builder.md:35` |
| `docs/help/cmd_builder.md:47` |
| `docs/help/cmd_builder.md:6` |
| `docs/help/cmd_migrate.md:12` |
| `docs/help/cmd_migrate.md:17` |
| `docs/help/cmd_migrate.md:27` |
| `docs/help/cmd_migrate.md:39` |
| `docs/help/cmd_workflow.md:22` |
| `docs/help/cmd_workflow.md:378` |
| `docs/help/spur-cli-matrix.md:114` |
| `docs/help/spur-cli-matrix.md:118` |
| `docs/help/spur-cli-matrix.md:33` |
| `docs/help/spur-cli-matrix.md:59` |
| `docs/help/spur-cli-matrix.md:92` |
| `docs/help2/builder.md:11` |
| `docs/help2/builder.md:3` |
| `docs/help2/builder.md:41` |
| `docs/help2/migrate.md:10` |
| `docs/help2/migrate.md:18` |
| `docs/help2/migrate.md:28` |
| `docs/help2/workflow.md:159` |
| `docs/help2/workflow.md:21` |
| `package.json:112` |
| `packages/app/package.json:28` |
| `packages/app/src/workflow/run-cost.ts:1` |
| `packages/app/src/workflow/run-measurements.ts:13` |
| `packages/app/tests/workflow/run-cost-budget.test.ts:1` |
| `packages/app/tests/workflow/run-cost.test.ts:1` |
| `packages/app/tests/workflow/run-measurements.test.ts:4` |
| `packages/app/tests/workflow/run-measurements.test.ts:8` |
| `packages/domain/src/analytics/workflow-measurements.ts:5` |
| `plugins/sp/skills/spur-cli/references/builder.md:18` |
| `plugins/sp/skills/spur-cli/references/builder.md:25` |
| `plugins/sp/skills/spur-cli/references/builder.md:27` |
| `plugins/sp/skills/spur-cli/references/builder.md:3` |
| `plugins/sp/skills/spur-cli/references/self.md:22` |
| `plugins/sp/skills/spur-cli/references/self.md:66` |
| `plugins/sp/skills/spur-cli/references/self.md:69` |
| `plugins/sp/skills/spur-cli/references/workflows.md:0` |
| `plugins/sp/skills/spur-cli/references/workflows.md:100` |
| `plugins/sp/skills/spur-cli/references/workflows.md:275` |
| `scripts/commands/fleet-e2e.ts:0` |
| `scripts/commands/fleet-e2e.ts:47` |
| `scripts/commands/verify-pack.test.ts:0` |
| `scripts/commands/verify-pack.test.ts:2` |
| `scripts/commands/verify-pack.test.ts:5` |
| `scripts/spur-dev.ts:102` |
| `scripts/spur-dev.ts:13` |
| `scripts/spur-dev.ts:22` |
| `scripts/spur-dev.ts:24` |
| `scripts/spur-dev.ts:34` |
| `scripts/spur-dev.ts:39` |
| `scripts/spur-dev.ts:45` |
| `scripts/spur-dev.ts:53` |
| `scripts/spur-dev.ts:75` |
| `scripts/spur-dev.ts:9` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | All four absorbed surfaces in the diff: `apps/cli/src/commands/workflow/cost.ts:43-49` (all seven cost flags declared over the shared registry), `apps/cli/src/commands/builder.ts:41-53` (--check guard rejects --push/--all and a version arg before any write, then calls the read-only drift check) and `apps/cli/src/commands/builder.ts:142` (publish verb), `apps/cli/src/commands/migrate.ts:81-91` (--check branch reports and returns before the boot-migration path), `apps/cli/src/release-ops.ts:867` (checkVersionDrift, read-only drift guard) and `apps/cli/src/release-ops.ts:1017-1030` (publishPackage restores original manifest bytes in finally on every exit path); behavior tests: `apps/cli/tests/release-ops-publish.test.ts:186-237` (success, build failure, publish failure, CLI failure rendering — fake runner, temporary workspace, no real publication), `apps/cli/tests/commands/self-migrate-check.test.ts:77-128` (absent DB not created, matching OK, stale stamp exit 1 without write), `apps/cli/tests/commands/workflow/cost.test.ts:35-56` and `packages/app/tests/workflow/run-cost.test.ts:189-226` (measured/null semantics). No publish or tag push was executed during verification (read-only spot runs only). |
| R2 | MET | Owning help trees document every actual flag: `docs/help/cmd_workflow.md:378-391` (all seven cost flags: --workflow, --by-state, --include-bookkeeping, --since, --budget, --measured-file, --json), `docs/help/cmd_migrate.md:12-17` (--check read-only, exit 1 on drift) and `docs/help/cmd_builder.md:35,56-65` (bump-ver --check and publish --otp); help2 mirrors updated: `docs/help2/workflow.md:159-162`, `docs/help2/migrate.md:10-18`; spur-cli noun references updated: `plugins/sp/skills/spur-cli/references/workflows.md:275`, `plugins/sp/skills/spur-cli/references/self.md:22`, `plugins/sp/skills/spur-cli/references/builder.md:27`; cost.ts declares --json through the existing shared option registry (`apps/cli/src/commands/workflow/cost.ts:49`), no scanner weakening (`apps/cli/tests/command-modules.ts:25` per-noun folder scanner unchanged); live match confirmed this session: `workflow cost --help` exited 0 listing all seven registered flags, `self migrate --check --help` and `builder --help` show --check/publish as documented. |
| R3 | MET | All five retired scripts are deleted in the diff (git diff --name-status 604afe09..42ced0f68: D scripts/commands/publish.ts, real-run-cost.ts, pipeline-budgets.ts, importer-schema-check.ts plus its test, check-marketplace-version.ts); dispatcher entries removed from `scripts/spur-dev.ts:25,45`; a grep over apps/packages/scripts/config/.github for imports of the retired paths finds only provenance comments, zero live callers; obsolete tests retired by rename: real-run-cost.test.ts and pipeline-budgets.test.ts became `packages/app/tests/workflow/run-cost.test.ts` and `packages/app/tests/workflow/run-cost-budget.test.ts` (R059/R089 in the diff); promotion policy intact: `scripts/commands/workflow-promotion.ts` is untouched by the diff (empty diff-stat) and keeps the selected-run domain query at `scripts/commands/workflow-promotion.ts:242`, with its guard still wired in root scripts (`package.json:95` workflow-promotion-check). |
| R4 | MET | Manifests and scripts reconciled: `apps/cli/package.json:56` repoints prepublishOnly to `builder bump-ver --check spur`, `package.json:112` repoints importer-schema-check to `self migrate` plus `self migrate --check`, `packages/app/package.json:29` exports `./run-cost`; CLI matrix recomputed with cost and publish rows (`docs/help/spur-cli-matrix.md:33,59`; unique verbs 69 to 71, noun-verb cells 96 to 98); the approved publish.yml caller change is in (`.github/workflows/publish.yml:85` runs `builder publish apps/cli --no-logo`, a registered global flag per `apps/cli/src/index.ts:239`); owning design contracts updated (`docs/design/harness-surface-governance.md:169-174` builder publish consent-gate entry; docs/design/cli-contracts.md modified in the same diff); surface/runtime rule consistency proven by the gate itself: 51 pre-check and 2 post-check rules pass with no violations (`.spur/run/1212-test-gate.log:26`, `.spur/run/1212-test-gate.log:596`); no new noun/verb beyond the approved delta (matrix delta is exactly cost and publish). |
| R5 | MET | Fresh full-gate evidence at this exact head: `.spur/run/1212-test-gate.status` = PASS with 11135 pass / 0 fail across 707 files (`.spur/run/1212-test-gate.log:591-593`), zero skip occurrences in the entire run log (so no new skips); coverage for every changed measured executable file is at least 93.60 percent line and 100 percent function: `apps/cli/src/commands/builder.ts` 100/100 (`.spur/run/1212-test-gate.log:59`), `apps/cli/src/commands/migrate.ts` 100/100 (`:72`), `apps/cli/src/commands/workflow/cost.ts` 100/100 (`:110`), `apps/cli/src/release-ops.ts` 100/93.60 (`:132`), `packages/app/src/workflow/run-cost.ts` 100/99.53 (`:436`), all-files 99.18/99.10 (`:39`); exact tested head re-verified this session: git rev-parse HEAD = 42ced0f682512df943945662f3329a16a2265bf5; certified proof digest sha256:3da6d8ccb29fa3e5989bbe8c3d5fc5c5bc9e3fb127ce7dc76515fb8922c3d888 matches `.spur/run/59e711b6-0e5e-4caa-8f02-f41621abc65b-review-proof.digest:1` and the event trace bracket MATCH (`.spur/run/59e711b6-0e5e-4caa-8f02-f41621abc65b-event-trace.md:48-56`, review answer PASS, 0 open P1-P3); root-reviewer acceptance and landing remain parent 1211's ownership per the task Background. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: AC1 — PR-9 is complete and green (req: R1, R2, R3, R4, R5) | MET | test | Merged baseline without losing commands/safeguards: merge commit 3b01cf777 in this worktree (git log this session), gate-fix ae5a4158d routes absorbed surfaces through the domain DB facade and .spur runtime paths, matrix recomputed (`docs/help/spur-cli-matrix.md:33,59`); cost measured/null/cohort semantics: `packages/app/tests/workflow/run-cost.test.ts:189-226` (null-USD token rows, no-cost runs report nulls never 0, empty cohort nulls) and `apps/cli/tests/commands/workflow/cost.test.ts:35-56`, frozen golden parity `apps/cli/tests/script-absorption-pr9-parity.test.ts:53-58` over `apps/cli/tests/fixtures/script-absorption-pr9-golden.json`; documented flags match live registrations (this session `workflow cost --help` exit 0 vs `docs/help/cmd_workflow.md:378-391`); publish restoration on success, returned failures and thrown errors without real publication: `apps/cli/tests/release-ops-publish.test.ts:186,203,216,237`; check-only paths have no side effects: `apps/cli/tests/commands/builder.test.ts:141` (rejection, exit 1 — reproduced live this session: `builder bump-ver --check --push` exited 1 with the guard message, no manifest/tag mutation observed) and `apps/cli/tests/commands/self-migrate-check.test.ts:77,104` (absent DB not created; stale stamp exit 1 without write); retired script paths caller-free while promotion keeps selected-run replay: grep clean plus `scripts/commands/workflow-promotion.ts:242`; required full gate passes with coverage: `.spur/run/1212-test-gate.log:591` (11135 pass / 0 fail) and `.spur/run/1212-test-gate.log:59,72,110,132,436-437` (min 93.60 line / 100 function); exact head and receipts recorded: HEAD 42ced0f68 verified this session, digest match `.spur/run/59e711b6-0e5e-4caa-8f02-f41621abc65b-review-proof.digest:1`. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | reconciliation: merge-commit strategy | — | Merge commit 3b01cf777 (no rebase/force-push), followed by fix commits ae5a4158d, a2f815913, 42ced0f68 on the absorption chain. |
| P4 | reconciliation: main transports/security win | — | ae5a4158d routes the absorbed PR-9 surfaces through the domain DB facade and .spur runtime paths (commit subject verified this session via git log). |
| P4 | reconciliation: SHARED_OPTIONS.json static-test path | — | cost.ts declares --json via the shared registry (`apps/cli/src/commands/workflow/cost.ts:49`); the per-noun scanner `apps/cli/tests/command-modules.ts:25` is preserved and all source-scan assertions pass at the gate. |
| P4 | P4 deferral to 1213 | — | Recorded in the certified review answer; not counted as a gap for 1212. |

### References

- Parent task 1211 and dependent task 1213; existing active feature A91.
- PR https://github.com/gobing-ai/spur/pull/26 (audited head 05963c3ff); historical CI https://github.com/gobing-ai/spur/actions/runs/38776447947.
- Accepted integration https://github.com/gobing-ai/spur/pull/28; refinement main bfdb9d6e6.
- docs/plans/2026-10-14-spur-script-absorption.md, landing revision; ADR-021/ADR-076/ADR-130; docs/design/harness-surface-governance.md.
- Current apps/cli/tests/command-modules.ts:25 supports per-noun modules; scripts/commands/workflow-promotion.ts:235 owns selected-run DB opening and delegates to the domain query; packages/app/src/workflow/run-measurements.ts:53 defines aggregate agent count median, not promotion's distribution.
- One main worktree and only parent 1211 at wip were observed at freeze; recheck immediately before implementation.

### History

- 2026-10-15T19:28:20.304Z todo → wip (system)
- 2026-10-15T20:20:08.803Z wip → testing (system)
- 2026-10-15T20:20:11.139Z testing → done (system)

