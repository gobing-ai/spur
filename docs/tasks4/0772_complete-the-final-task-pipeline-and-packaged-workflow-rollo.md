---
schema_version: 1
name: "Complete the final task-pipeline and packaged workflow rollout"
status: todo
template: feature-impl
created_at: 2026-09-05T05:21:57.000Z
updated_at: "2026-09-05T05:42:44.915Z"
feature_id: D61
priority: P1
tags: ["workflow-upgrade", "P8"]
dependencies: ["0769", "0770", "0771"]
---

## 0772. Complete the final task-pipeline and packaged workflow rollout

### Background
D61 implementation package P8, approved under ADR-108. Refinement depth: ready. Source inspected at 4801db1bd37422614040eeefcb1afb72d59eede1 with the D61 planning changes in this working tree.

Own task-pipeline.yaml last, after 0769/0770/0771. Task 0723 is done and the current precheck has no doctor action; task-size-precheck.ts is count-only with default ten Requirements/sixteen Plan items. Current pipeline still echoes full gate logs in initial/recheck stages. D9 Option B retains empty mode defaults and requires at least five real terminal runs plus at least 80% mapped coverage per workflow before production fast activation.

Dependencies: 0769, 0770, 0771. Detailed inputs and handoffs are frozen below.
### Requirements
- [ ] **R1.** The task pipeline is upgraded last without weakening proof: consume completed 0723 precheck and preceding D61 contracts; reduce redundant checks/log echoes while preserving quality gate, review, read-only verification, task-spec-inclusive fingerprints and run/definition-bound PASS evidence. Keep fast mode dormant under D9 coverage rules.

- [ ] **R2.** All shipped definitions and generated assets complete the migration: tag task-pipeline version: "1", verify all eleven canonical and bundled versions match, remove retired assets through bundle generation, and synchronize canonical skills/templates/authority. Unversioned external definitions remain supported.

- [ ] **R3.** Savings are measured against comparable verified outcomes: assemble matched before/after invocation, elapsed-time and output-volume evidence with source/run provenance. Unknown tokens/cost stay unknown; simulated branch tests and static counts never count as real terminal outcomes. Complete applicable repository gates and real task verification.

Out of scope: new engines/dependencies/public nouns, broad historical-document cleanup, D9 fast activation, release, merge and external deployment. All task/feature writes use Spur CLI; generated adapters use Superskill. Refine does not author implementation evidence.
### Acceptance Criteria

```gherkin
Feature: Complete the final task-pipeline and packaged workflow rollout

  @core
  Scenario: R1 — The task pipeline is upgraded last without weakening proof
    Given the surrounding workflow upgrades have passed and task-pipeline uses its normal safety route
    When quality checking, review, verification, and record complete or fail
    Then the exact certified inputs and run-bound verdict govern completion
    And changed inputs or missing, stale, or non-PASS evidence deny done
    And redundant structural work and full-log echoing are reduced
    And no production caller enables fast mode without D9's existing coverage conditions


  @core
  Scenario: R2 — All shipped definitions and generated assets complete the migration
    Given all eleven canonical workflow upgrade packages have passed their focused checks
    When the CLI bundle is rebuilt and checked
    Then every canonical definition has a quoted non-empty version and a recorded upgrade outcome
    And unversioned external definitions remain supported
    And retired baseline assets are absent from generated package output
    And canonical skills, templates, authority, and derived contracts describe the implemented behavior


  @core
  Scenario: R3 — Savings are measured against comparable verified outcomes
    Given matched before and after inputs for the affected workflows
    When rollout evidence is collected
    Then invocation counts, elapsed time, and output volume are recorded with source provenance
    And measured tokens and costs remain unknown where unavailable
    And no dry run is counted as a real verified outcome
    And applicable lint, type, test, rule, and task verification results remain explicit
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-05T05:42:44.686Z

Closed: 0723 is done, no outstanding external prerequisite. Final rollout remains a source-local verified bundle, not release. Measurement captures are required before each owned YAML changes; missing model usage is null, not zero or a claimed saving.

No unresolved design question. Mechanical implementation choices stay within these frozen contracts; an actual upstream contract failure is reported with evidence, not silently redesigned.
### Design
No new engine, public CLI, fast-mode activation, doctor probe or prerequisite task. 0723 is already done; consume its existing precheck and size/evidence safeguards rather than reopening or duplicating them. Assume 0769/0770/0771 each leave passing versioned definitions and measurement artifacts; verify their final inputs are present before touching task-pipeline. Other YAML semantics are owned by those tasks, not reimplemented here.

Task-pipeline: keep one successful-precheck task check, deterministic size/evidence checks, auto feature reactivation and dirty-tree visibility from 0723. Preserve full-gate-before-review, bounded fix/recheck and SQLite retry behavior. Replace cat of full successful gate logs with a bounded status/attempt/path summary; on failure show a bounded tail (last 40 lines maximum) and path, preserving full redacted existing logs. Do not truncate durable evidence. Keep command.gate/captured result reuse only across unchanged sibling guards; record/verify writes require fresh checks where inputs change. Explicit task --as done and run-bound verdict/proof guard remain authoritative.

Preserve proof-input-fingerprint owner and task-spec inclusion, immutable captured digest across review/verify, fresh read-only verifier, recomputed PASS + matching MET rows, runId and definitionDigest, and current tree/spec equality at record/done. Missing/empty/stale/non-PASS proof or changed input must reach failed. No forced PASS, baseline acceptance, proof reuse after edits or skip-review optimization. Set version: "1" only after proof failure-path tests pass. Keep mode: "" in task-lifecycle/wrapup/task-pipeline and no first-party production mode=fast caller. D9's real-run threshold is not permission to manufacture five runs; fast activation remains a separate operator decision.

Bundle: use bun run --filter @gobing-ai/spur build:bundle, then verify config/workflows against apps/cli/config/workflows and packaged file inventory. scripts/commands/bundle-config.ts owns replacement/pruning: if its copy leaves deleted config assets, fix the generator narrowly and prove stale corpus/composition files disappear. Never hand-edit generated apps/cli/config. Verify all eleven names: basic, docs-pipeline, feature-dev, feature-lifecycle, history-anatomy, idea-pipeline, pr-review, task-lifecycle, task-pipeline, wayfinder-resolution, wrapup-pipeline. Preserve JSON compatibility fixture. Canonical plugin script changes generate via existing build:scripts/Superskill path; install adapters only through Superskill.

Evidence report: docs/plans/2026-09-04-d61-rollout-evidence.md. Reuse per-task pre-change measurements rather than trying to reconstruct them after deletion. If a comparison is missing, reproduce the source revision in an isolated read-only fixture/worktree with identical inputs; never mutate completed task status to manufacture a run. Record source commit plus dirty definition digest, CLI importer/binary path, fixture/input hash, command, exit/terminal verdict, invocation counts by action kind, elapsedMs, stdout/stderr bytes, token/cost or null with reason, and artifact/run IDs. Compare successful outcomes to successful outcomes and matching failure branches separately; static/dry-run results are explicitly labeled and excluded from real-run coverage. The old 39.586-second corpus sample is historical context, not a statistically supported savings claim. Do not claim a token/cost percentage without actual usage data.

Input: all prior D61 packages. Output: tested source-local bundle, eleven-row outcome/version matrix, measured limitations, docs synchronization and verification evidence for D61 closure. No release, publish, PR merge, external review message or branch deletion.

Verification targets: From packages/app: bun test tests/workflow/task-pipeline-proof-chain.test.ts tests/workflow/task-pipeline-proportional-routing.test.ts tests/workflow/proof-input-fingerprint.test.ts tests/services/done-transition-guard.test.ts. Extend plugins/sp/tests/task-pipeline-resilience.test.ts and inline-pipeline parity coverage. Root tests include scripts/commands/bundle-config.test.ts and verify-pack.test.ts. Rebuilt source-local CLI must show versioned bundled workflows and still validate an unversioned external fixture.

Execution evidence handoff: before changing an owned checker/workflow, save a bounded matched-input measurement under .spur/run/d61-<wbs>-before.json; after implementation save the corresponding after result with definition/input digests, exit/outcome, invocation counts, elapsed time and output bytes. Unknown token/cost values remain null. 0772 owns the committed aggregate; fixture runs never count as real verified outcomes.
### Plan
1. [ ] R1/R3: Confirm prerequisite task outputs and collect their before/after artifacts; capture task-pipeline pre-change digest and matched branch measurements before editing.

2. [ ] R1: Refine final pipeline result reuse/log output while preserving 0723 precheck, full review/verify/proof chain and dormant fast policy.

3. [ ] R1: Run adverse proof fixtures: failed gate, fix exhaustion, stale/missing/non-PASS verdict, changed task spec/tree, run/definition mismatch and current PASS positive path.

4. [ ] R2: Tag task-pipeline; rebuild through build:bundle and test all eleven canonical/bundle identities plus absence of retired assets, fixing generator pruning only if required.

5. [ ] R2/R3: Synchronize ADR/PRD/architecture/04, canonical skills/templates and generated scripts; assemble the committed rollout evidence matrix and source-provenance measurements.

6. [ ] R1/R2/R3: Run bun run spur-check, bun run test-cf and required build/package checks for final inputs; avoid duplicating lint/type/tests already covered by spur-check. Follow current checker-policy audit obligations, normal task/feature checks and real task verification; report unavailable usage honestly.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

**Status (corpus fix, 2026-09-05):** task 0772 Solution is **planned**, awaiting implementation run. The 2026-09-05 batch halted at the precheck of 0772 because the Solution section lacked `path:line` citations; the corpus fix below restores precheck-pass before implementation.

Anticipated change anchors (populated during implementation):

- `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:1` — proof failure-path tests (required for `version: "1"`).
- `packages/app/tests/workflow/task-pipeline-proportional-routing.test.ts:1` — proportional routing tests.
- `packages/app/tests/workflow/proof-input-fingerprint.test.ts:1` — proof-input-fingerprint owner tests.
- `packages/app/tests/services/done-transition-guard.test.ts:1` — extended for bounded status/attempt/path summary.
- `plugins/sp/tests/task-pipeline-resilience.test.ts:1` — extended for inline-pipeline parity.
- `scripts/commands/bundle-config.ts:1` — narrow fix if its copy leaves deleted config assets; verify stale corpus/composition files disappear from generated output.
- `apps/cli/config/workflows/<each>.yaml:1` (11 names: basic, docs-pipeline, feature-dev, feature-lifecycle, history-anatomy, idea-pipeline, pr-review, task-lifecycle, task-pipeline, wayfinder-resolution, wrapup-pipeline) — bundle-rebuilt comparison vs `config/workflows/`.
- `docs/plans/2026-09-04-d61-rollout-evidence.md:1` — committed aggregate of per-task measurements.

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
- Upstream task contracts: spur task show 0769 --json; spur task show 0770 --json; spur task show 0771 --json.
- Surface/process authority: docs/04_DESIGN.md and docs/99_PROJECT_CONSTITUTION.md; local source/test paths are named in Design.

### History
