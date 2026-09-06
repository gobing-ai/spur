---
schema_version: 1
name: "Complete the final task-pipeline and packaged workflow rollout"
status: done
template: feature-impl
created_at: 2026-09-05T05:21:57.000Z
updated_at: "2026-09-06T16:58:46.270Z"
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
- [x] **R1.** The task pipeline is upgraded last without weakening proof: consume completed 0723 precheck and preceding D61 contracts; reduce redundant checks/log echoes while preserving quality gate, review, read-only verification, task-spec-inclusive fingerprints and run/definition-bound PASS evidence. Keep fast mode dormant under D9 coverage rules.

- [x] **R2.** All shipped definitions and generated assets complete the migration: tag task-pipeline version: "1", verify all eleven canonical and bundled versions match, remove retired assets through bundle generation, and synchronize canonical skills/templates/authority. Unversioned external definitions remain supported.

- [x] **R3.** Savings are measured against comparable verified outcomes: assemble matched before/after invocation, elapsed-time and output-volume evidence with source/run provenance. Unknown tokens/cost stay unknown; simulated branch tests and static counts never count as real terminal outcomes. Complete applicable repository gates and real task verification.

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
**Final rollout of the D61 task-pipeline and packaged workflows (0772).**

- `config/workflows/task-pipeline.yaml` — `version: "1"` identity tag (config/workflows/task-pipeline.yaml:32); `test` and `test-recheck` gate shells now emit a bounded summary instead of echoing the full gate log: green gates print `quality gate PASS (attempts: N; log: path; bytes: M)`, red gates print at most the last 40 lines plus the log path (`tail -n 40`). The durable full log at `.spur/run/<wbs>-test-gate.log` is never truncated and stays the `test-fix` input. Guards, proof chain, 0723 precheck, fix/recheck bounds, and SQLite retry are untouched; fast mode stays dormant (`mode: ""`, no production fast caller).
- `plugins/sp/tests/task-pipeline-resilience.test.ts` — new pin "quality gate output is a bounded summary; full log stays on disk (0772 R1)": structural (no `cat "$LOG_FILE"` echo, `tail -n 40` present in both gate shells) plus behavioral red/green gate runs asserting the summary lines, the 40-line window, and intact on-disk logs.
- Bundle migration (R2): rebuilt via `bun run --filter @gobing-ai/spur build:bundle`; all eleven canonical definitions (basic, docs-pipeline, feature-dev, feature-lifecycle, history-anatomy, idea-pipeline, pr-review, task-lifecycle, task-pipeline, wayfinder-resolution, wrapup-pipeline) carry quoted `version: "1"` and are byte-identical to `apps/cli/config/workflows/`; bundled workflows dir contains exactly 11 files — no retired corpus/composition asset. Unversioned external definitions remain supported (workflow-version suite).
- Docs (same commit): `docs/04_DESIGN.md` documents the bounded gate output; `docs/design/essential-workflow-checks.md` records P8 implemented status.
- Evidence (R3): `docs/plans/2026-09-04-d61-rollout-evidence.md` aggregates the sixteen `.spur/run/d61-*-{before,after}.json` fixtures with source/run provenance; token/cost are null with recorded reason; static and fixture evidence is labeled and excluded from real-run coverage; D9 activation thresholds are honestly unmet and no runs were manufactured.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Full closure gate exits 0: 7457 tests, including proof-chain/fingerprint/inline parity and bounded-output behavior; D9 fast mode remains dormant. Real matched gate-shell replay preserves PASS/FAIL outcomes, full logs and one invocation on both sides. Fix-pass artifacts: verification run `.spur/run/0772-verify-answer.txt` lines 1-40 replaced; CLI derives `.spur/run/0772-verdict.json` and records Testing. |
| R2 | MET | Final CLI build:bundle exits 0; 11/11 canonical/bundled quoted version 1 definitions byte-match; retired production baselines/regenerators absent, JSON compatibility fixture retained. ADR-108, design, T10/T11 and live guidance synchronized. |
| R3 | MET | Task Design's allowed isolated reconstruction executed: .spur/run/d61-measure.ts and .spur/run/d61-matched-measurements.json; tracked docs/plans/2026-09-06-d61-matched-measurements.md. Eleven historical/current plan projections measured; successful gate-shell stdout 6090→80 bytes, failure 6090→1324, full log 6127 bytes unchanged, one gate invocation each. Source/digest/input hash/exit/time/bytes recorded. Fixture/projection runs explicitly excluded from real-terminal coverage; tokens/cost null, no claimed time or model savings. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — The task pipeline is upgraded last without weakening proof | MET | command | Full closure gate exits 0: 7457 tests, including proof-chain/fingerprint/inline parity and bounded-output behavior; D9 fast mode remains dormant. Real matched gate-shell replay preserves PASS/FAIL outcomes, full logs and one invocation on both sides. |
| R2 — All shipped definitions and generated assets complete the migration | MET | command | Final CLI build:bundle exits 0; 11/11 canonical/bundled quoted version 1 definitions byte-match; retired production baselines/regenerators absent, JSON compatibility fixture retained. ADR-108, design, T10/T11 and live guidance synchronized. |
| R3 — Savings are measured against comparable verified outcomes | MET | command | Task Design's allowed isolated reconstruction executed: .spur/run/d61-measure.ts and .spur/run/d61-matched-measurements.json; tracked docs/plans/2026-09-06-d61-matched-measurements.md. Eleven historical/current plan projections measured; successful gate-shell stdout 6090→80 bytes, failure 6090→1324, full log 6127 bytes unchanged, one gate invocation each. Source/digest/input hash/exit/time/bytes recorded. Fixture/projection runs explicitly excluded from real-terminal coverage; tokens/cost null, no claimed time or model savings. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)
### Review
<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | spur task check | — | task check passed |
| P4 | tests-pass | — | bun run spur-check exits 0: 7457 pass, 0 fail, 416 files; lint/typechecks and 44+2 rules pass. Verification run .spur/run/d61-closure-gate-final.log. |
| P4 | design-conformance | — | Original ADR-108 intent restored; isolated historical reconstruction explicitly permitted by task Design and labeled without real-run claims. |
| P4 | evidence-rule-pass | — | All behavior-bearing AC rows have executable evidence or are explicitly non-behavioral. |
### References
- [D61 feature](../features/D61_essential-workflow-checks-and-observable-execution.md)
- [ADR-108](../00_ADR.md#adr-108-essential-workflow-gates-and-explicit-corpus-audits)
- [Accepted implementation contract](../design/essential-workflow-checks.md)
- [Discovery and eleven-workflow inventory](../plans/2026-09-04-workflow-upgrade-brainstorm.md)
- [Batch implementation handoff](../plans/2026-09-04-d61-implementation-ready.md)
- Upstream task contracts: spur task show 0769 --json; spur task show 0770 --json; spur task show 0771 --json.
- Surface/process authority: docs/04_DESIGN.md and docs/99_PROJECT_CONSTITUTION.md; local source/test paths are named in Design.

### History
- 2026-09-06T07:46:40.065Z todo → wip (system)
- 2026-09-06T07:46:45.349Z wip → testing (system)
- 2026-09-06T07:49:27.752Z testing → done (system)
