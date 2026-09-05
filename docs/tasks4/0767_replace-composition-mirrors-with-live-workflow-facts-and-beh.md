---
schema_version: 1
name: "Replace composition mirrors with live workflow facts and behavior checks"
status: todo
template: feature-impl
created_at: 2026-09-05T05:21:56.874Z
updated_at: "2026-09-05T05:42:36.003Z"
feature_id: D61
priority: P1
tags: ["workflow-upgrade", "P3"]
dependencies: ["0766"]
---

## 0767. Replace composition mirrors with live workflow facts and behavior checks

### Background
D61 implementation package P3, approved under ADR-108. Refinement depth: ready. Source inspected at 4801db1bd37422614040eeefcb1afb72d59eede1 with the D61 planning changes in this working tree.

The composition snapshot mirrors 11 workflows and 143 actions with zero dispositions. Its module also owns canonical JSON and proof digests, so deleting the whole module would break useful consumers. composition-entrypoint-check only enforces the two regenerators; it has no remaining useful check after both are removed.

Dependencies: 0766. Detailed inputs and handoffs are frozen below.
### Requirements
- [ ] **R1.** Baseline retirement preserves useful consumers: migrate inventory, pipeline budgets, evaluation, real-run cost and advisory readers to live resolved definitions while preserving proof-digest behavior and the JSON response fixture. Remove the composition snapshot, exact-mirror equality/regeneration machinery and now-empty entrypoint gate after migration. Unknown measured usage stays unknown and actual budget violations remain failures.

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

<!-- Filled during implementation: file:line change map and concise rationale. -->

**Status (batch halt, 2026-09-05):** task 0767 is **not-attempted** at the batch level — the batch halted at task 0766 (deferred) with stop-the-batch default. The remaining 6 tasks (0767-0772) inherit the halted-batch state and require a follow-up session to drive per the topo order (0767/0768 after 0766, 0769/0770 after 0766/0767/0768, 0771 after 0767/0768, 0772 last).

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
- Upstream task contracts: spur task show 0766 --json.
- Surface/process authority: docs/04_DESIGN.md and docs/99_PROJECT_CONSTITUTION.md; local source/test paths are named in Design.

### History
