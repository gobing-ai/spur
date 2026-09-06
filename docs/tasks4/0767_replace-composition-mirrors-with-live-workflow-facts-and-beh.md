---
schema_version: 1
name: "Replace composition mirrors with live workflow facts and behavior checks"
status: done
template: feature-impl
created_at: 2026-09-05T05:21:56.874Z
updated_at: "2026-09-06T05:13:26.683Z"
feature_id: D61
priority: P1
tags: ["workflow-upgrade", "P3"]
dependencies: ["0775"]
---

## 0767. Replace composition mirrors with live workflow facts and behavior checks

### Background

D61 implementation package P3, approved under ADR-108. Refinement depth: ready. Source inspected at 4801db1bd37422614040eeefcb1afb72d59eede1 with the D61 planning changes in this working tree.

The composition snapshot mirrors 11 workflows and 143 actions with zero dispositions. Its module also owns canonical JSON and proof digests, so deleting the whole module would break useful consumers. composition-entrypoint-check only enforces the two regenerators; it has no remaining useful check after both are removed.

Dependencies: 0775 (which deletes the corpus/composition baselines and the regenerator-only machinery as the third phase of decomposed 0766 R2). Detailed inputs and handoffs are frozen below.

### Requirements

- [x] **R1.** Baseline retirement preserves useful consumers: migrate inventory, pipeline budgets, evaluation, real-run cost and advisory readers to live resolved definitions while preserving proof-digest behavior and the JSON response fixture. Remove the composition snapshot, exact-mirror equality/regeneration machinery and now-empty entrypoint gate after migration. Unknown measured usage stays unknown and actual budget violations remain failures.

Out of scope: new engines/dependencies/public nouns, broad historical-document cleanup, D9 fast activation, release, merge and external deployment. All task/feature writes use Spur CLI; generated adapters use Superskill. Refine does not author implementation evidence.

### Acceptance Criteria

```gherkin
Feature: Replace composition mirrors with live workflow facts and behavior checks

  @core
  Scenario: R1 — Baseline retirement preserves useful consumers
    Given the corpus and composition snapshot readers and the JSON response compatibility fixture
    When the baseline migration completes
    Then corpus and composition snapshots and their regeneration-only machinery are removed
    And budgets, inventory, evaluation, advisory, and proof digest consumers retain their useful behavior using live definitions or focused behavior checks
    And the JSON compatibility fixture still verifies its response contract
    And no automatic regeneration accepts new debt during migration

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-05T05:42:35.781Z

Closed: keep digest helper location for import compatibility; no replacement snapshot/disposition store. Delete composition-entrypoint-check because its only two subjects are gone. Static definitions and measured runs stay distinct.

No unresolved design question. Mechanical implementation choices stay within these frozen contracts; an actual upstream contract failure is reported with evidence, not silently redesigned.

### Design

No new public API, inventory daemon or waiver ledger. Keep canonicalJsonStringify, computeDefinitionDigest and extractResolvedWorkflowFacts in packages/app/src/workflow/composition-baseline.ts initially to preserve imports; remove its snapshot types/readers/checkWorkflowComposition only after callers migrate. A cosmetic module rename is out of scope. The digest algorithm and canonical ordering must remain byte-compatible for the same definition, including before/after migration tests.

| Consumer | Frozen replacement |
| --- | --- |
| scripts/commands/pipeline-budgets.ts | Read config/workflows through the existing resolver/fact extractor; retain budget policy values and observed run evaluation separately |
| scripts/commands/eval-pipeline.ts | Resolve the same live definitions for action/model-state facts; missing/invalid definition is explicit error/unknown, never an empty successful map |
| scripts/commands/real-run-cost.ts | Use live directory definitions for inventory scope; runtime invocation/timing/usage remains DAO-derived, never inferred from static action count |
| packages/app/src/services/workflow-service.ts composition advisory | Pass live facts without loading dispositions; keep advisory output compatibility and non-blocking behavior |
| Composition equality/proof tests | Retain digest fixtures and tests of required proof/terminal behavior; delete literal prompt/action mirrors |

Load definitions once per command invocation, using existing directory enumeration/resolver; reuse the existing extractor instead of parallel YAML parsing. Cover all 11 shipped files including idea-pipeline. Preserve static model-state semantics as static inventory; do not silently change them to run counts. Measured tokens/cost and missing actual runs are null/unknown with an explicit reason, never 0. Known budget overrun remains detectable. No persistent cache.

Delete config/workflow-composition-baseline.json and scripts/commands/regen-composition-baseline.ts with package script, then delete composition-entrypoint-check.ts and its regeneration-only tests/package script/calls in spur-check variants. The latter guards only removed scripts; no replacement empty gate. Keep script-contract-check, link-check, actual workflow validation and packages/app/tests/fixtures/json-raw-baseline.json with json-envelope-adoption.test.ts. Retire snapshot-only references, not history-anatomy current/baseline evidence.

Input: 0766 removed corpus acceptance and its entrypoint requirement. Output: live inventory/budget/advisory seams and unchanged digests for 0769–0771; 0772 verifies generated removal. Update ADR-069 only for exact mirroring retirement, retaining ownership/advisory contracts; synchronize docs/03_ARCHITECTURE.md and docs/04_DESIGN.md.

Verification targets: From packages/app: bun test tests/workflow/composition-baseline.test.ts tests/workflow/composition-advisory.test.ts tests/workflow/task-pipeline-proof-chain.test.ts tests/services/json-envelope-adoption.test.ts (retain/rename the digest test file deliberately if its snapshot tests disappear). Root bun run test includes scripts/commands/{pipeline-budgets,eval-pipeline,real-run-cost}.test.ts. Assert an ordinary prompt edit needs no regeneration, proof-path removal fails its behavior test, and absent measured runs never read as zero-cost success.

Execution evidence handoff: before changing an owned checker/workflow, save a bounded matched-input measurement under .spur/run/d61-<wbs>-before.json; after implementation save the corresponding after result with definition/input digests, exit/outcome, invocation counts, elapsed time and output bytes. Unknown token/cost values remain null. 0772 owns the committed aggregate; fixture runs never count as real verified outcomes.

### Plan

1. [ ] R1: Capture digest results and budget behavior from current test fixtures before editing; map the five consumer rows to existing exports/imports.

2. [ ] R1: Migrate scripts/advisory to resolved live facts, covering missing definitions and unknown measurements without zero substitution.

3. [ ] R1: Convert equality tests into focused safety/proof expectations, preserving digest and JSON compatibility fixtures.

4. [ ] R1: Delete composition snapshot/regenerator and the now-empty entrypoint checker; update package script compositions and authority docs atomically.

5. [ ] R1: Run consumer, digest, budget and JSON tests plus applicable final gate; normal task check and real verification must pass. Hand live-definition measurements to 0772.

### Solution
- Consumers already on live facts (0775 slice, verified this task): `scripts/commands/pipeline-budgets.ts:187`, `eval-pipeline.ts:128/:629` (loadWorkflowFacts sweep over all 11 shipped files incl. idea-pipeline), `real-run-cost.ts:35/:251` (directory inventory; usage stays DAO-derived). No snapshot or disposition reads remain.
- `packages/app/src/workflow/composition-baseline.ts` retains exactly the three import-compatible helpers: `canonicalJsonStringify`, `computeDefinitionDigest`, `extractResolvedWorkflowFacts`; digest byte-compat covered by the key-order-invariance fixture (composition-baseline.test.ts:26).
- Deleted `scripts/commands/composition-entrypoint-check.ts` (guarded only the retired regenerators); removed its package.json script entry and both spur-check/spur-check-new chain references — no replacement empty gate.
- Docs synced in same change: ADR-069 amendment (2026-09-05, 0767 — exact-mirroring portion retired; ownership/advisory contracts R1/R2/R3 unchanged), `docs/03_ARCHITECTURE.md` §20.2 ownership topology (facts read live via extractResolvedWorkflowFacts), `docs/04_DESIGN.md` composition references (retired, task 0767).
- Evidence handoff: `.spur/run/d61-0767-before.json` / `d61-0767-after.json` — matched-input captures (task-pipeline.yaml + pipeline-budgets.json digests, invocation exits, output bytes, outcome lines); token/cost null with explicit unknown-reason; absent terminal runs report n/a, never 0.
- Verification: `bun run spur-check` rc=0 (/tmp/d61-0767-gate.txt); app targets 48 pass (composition-baseline, composition-advisory, task-pipeline-proof-chain, json-envelope-adoption); scripts tests 41 pass (pipeline-budgets, eval-pipeline, real-run-cost).
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Consumers already migrated to live facts (0775 slice): pipeline-budgets.ts:187, eval-pipeline.ts:128/:629 and real-run-cost.ts:35/:251 read config/workflows through the resolver plus extractResolvedWorkflowFacts — no snapshot/disposition loads remain (rg: 0 hits). Digest behavior byte-compatible: computeDefinitionDigest key-order-invariance test retained (composition-baseline.test.ts:26). JSON response fixture kept: json-envelope-adoption.test.ts green. Entry point gate deleted (scripts/commands/composition-entrypoint-check.ts removed; package.json 0 references). Unknown measured usage stays unknown: real-run-cost reports n/a with explicit reason, never 0; budget violations still fail (check-pipeline-budgets PASS, 5 pipelines, 0 violations = policy live). |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R4 — Baseline retirement preserves useful consumers | MET | test | Budgets/eval/cost consume live extractResolvedWorkflowFacts over all 11 shipped files incl. idea-pipeline (eval-pipeline loadWorkflowFacts sweep); composition-baseline.test.ts 48 tests across the 4 app targets green; digest byte-compat fixture retained; json-envelope-adoption response contract green |
| Snapshots and regeneration-only machinery removed | MET | command | rg composition-entrypoint/workflow-composition-baseline.json over live surfaces: 0 hits in scripts/config/package.json (history docs only); scripts/commands/composition-entrypoint-check.ts deleted; spur-check chains shrunk (package.json:80-81); spur-check rc=0 |
| No automatic regeneration accepts new debt during migration | MET | command | Both regenerator entrypoints stay absent; no replacement snapshot or disposition store exists (ADR-069 0767 amendment; design forbids one); ordinary prompt edits need no regeneration step — none exists |
| Measured usage unknown stays unknown; violations remain failures | MET | command | d61-0767-before.json / after.json matched-input captures: budgets PASS (5 pipelines, 0 violations) before and after; real-run-cost absent terminal runs report n/a with explicit reason, never 0 |
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
- [Discovery and eleven-workflow inventory](../plans/2026-09-04-workflow-upgrade-brainstorm.md)
- [Batch implementation handoff](../plans/2026-09-04-d61-implementation-ready.md)
- Upstream task contracts: spur task show 0766 --json.
- Surface/process authority: docs/04_DESIGN.md and docs/99_PROJECT_CONSTITUTION.md; local source/test paths are named in Design.

### History
- 2026-09-06T05:12:45.217Z todo → wip (system)
- 2026-09-06T05:13:26.683Z wip → done (system)
