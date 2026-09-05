---
schema_version: 1
name: "Upgrade planning and evidence workflows without structural ceremony"
status: todo
template: feature-impl
created_at: 2026-09-05T05:21:56.922Z
updated_at: "2026-09-05T05:42:39.576Z"
feature_id: D61
priority: P1
tags: ["workflow-upgrade", "P5"]
dependencies: ["0766", "0767", "0768"]
---

## 0769. Upgrade planning and evidence workflows without structural ceremony

### Background
D61 implementation package P5, approved under ADR-108. Refinement depth: ready. Source inspected at 4801db1bd37422614040eeefcb1afb72d59eede1 with the D61 planning changes in this working tree.

Own exactly idea-pipeline.yaml, docs-pipeline.yaml and wayfinder-resolution.yaml. Idea repeatedly invokes feature check in sibling guards and its prose understates batch schema fields. Wayfinder already searches the correct canonical ### Testing heading; its defect is repeated task reads and >5-line/>60-word proof, plus a standalone verdict word. Docs already has measured verification and a proof bracket; preserve those owners.

Dependencies: 0766, 0767, 0768. Detailed inputs and handoffs are frozen below.
### Requirements
- [ ] **R1.** Planning and document workflows use evidence instead of ceremony: refine the three owned definitions as specified below, preserve approval/revision bounds and atomic handoff-only task creation, replace word-count proof with run-bound measured evidence and normal guarded completion, isolate temporary captures by run, and set version: "1" on each definition only after its success/failure checks pass.

Out of scope: new engines/dependencies/public nouns, broad historical-document cleanup, D9 fast activation, release, merge and external deployment. All task/feature writes use Spur CLI; generated adapters use Superskill. Refine does not author implementation evidence.
### Acceptance Criteria

```gherkin
Feature: Upgrade planning and evidence workflows without structural ceremony

  @core
  Scenario: R1 — Planning and document workflows use evidence instead of ceremony
    Given the upgraded idea-pipeline, docs-pipeline, and wayfinder-resolution definitions
    When their success, revision, and failed-evidence paths execute
    Then repeated structural checks and word-count proof proxies are eliminated
    And atomic task creation, design approval, run-bound evidence, and normal completion guards still hold
    And the idea pipeline ends at handoff without implementing tasks

```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-05T05:42:39.365Z

Closed: ### Testing is correct; eliminate scraping, not change heading level. Research evidence uses existing standard verdict/proof owners. The verifier is read-only and approval cannot waive failed proof. Task implementation remains outside idea/research handoff.

No unresolved design question. Mechanical implementation choices stay within these frozen contracts; an actual upstream contract failure is reported with evidence, not silently redesigned.
### Design
No new API or research implementation pipeline. Consume 0766 audit policy, 0767 live composition facts and 0768 identity/progress. Use existing command.gate, proof.fingerprint, run.artifact, task verdict/record and idea-handoff-cli.ts. Write only the three owned YAMLs plus their existing deterministic owners/tests and canonical skill contracts.

Idea: at AC author/revise boundary run one command.gate with executable=${vars.spurBin}, args=[feature, check, ${vars.featureId}, --json], softFail=true, id=idea-ac-check and resultFile=.spur/run/${vars.__runId}-idea-ac-check.status (the existing PASS/FAIL text contract); all sibling routing guards consume that result. At the separate design author/revise boundary run one new check using id=idea-design-check and its corresponding run-scoped resultFile; do not use the rejected command option. Repeat only after relevant writes or resumed HITL where edits may have occurred; never reuse pre-edit evidence. Keep human feature-check as approval, auto/standard routing, design_approved, retry cap=3, cancellation, needs-design decision and atomic batch creation/dependency/topological handoff. Correct allowed-field prose to the actual batch schema: design, plan and acceptance_criteria are supported and normal default planning fills them. No task implementation or nested task pipeline at the handoff terminal.

Docs: retain requireDiff draft, task-path fail-closed lookup, observe-only fresh-session verifier, canonical proof fingerprint before/after and standard verdict derivation. Change temporary precheck/taskpath/answer captures to .spur/run/<runId>-docs-* (including every reader/prompt), clearing or replacing current-run answers before use. Keep .spur/run/<wbs>-verdict.json as the standard compatibility artifact only after current-run derivation; stamp/validate runId and definitionDigest through the existing proof/run-artifact contract, not a new assurance class. Correct stale-record ordering: draft/approval -> verify -> record -> done. The current pre-verification task record can write UNKNOWN/old Testing; instead derive and bind the current verdict first, compare proof before record, then task record --solution-from-diff --transition testing writes current evidence. Use the existing fingerprint normalization that excludes derived Testing/Review/Solution but includes semantic task inputs. A failed verifier cannot enter record; subsequent semantic edits invalidate proof.

Wayfinder: reuse successful precheck task-show capture as the collect input because no write intervenes; remove self workflow validation and repeated task check in collect. Remove the length guards and requirement to pad research evidence. Let an independent fresh-session read-only verifier evaluate actual R/AC evidence, including a short valid answer and a long hollow one. Use the same task verdict --from-answer, proof.fingerprint and run.artifact verify-verdict contract as docs/task pipelines; retire the standalone resolution-verdict.txt PASS word as authority. Temporary artifacts use .spur/run/<runId>-wayfinder-*; never share a WBS-only answer across runs. Correct prompts to use canonical section APIs/parser, not awk heading/word counts.

Wayfinder lifecycle order: author research sections via task CLI, move todo to wip when needed, independently verify the authored input, approve if required, compare the unchanged proof, record the current verdict to testing through task record, then guarded testing-to-done. Derived record sections use the existing proof normalization, never a new fingerprint exclusion. Approval yes never overrides non-PASS/missing/stale proof; record/done denial reaches failed through a captured result and must not be converted to success by exit 0. Verify final persisted task status after a successful transition, reusing that result for sibling guards. Retain local-research-only scope: no network/model-generated code implementation, no /sp:dev-run recursion, and no force-done.

Add quoted version: "1" separately to each verified upgrade. Output: three tested/tagged definitions for 0772. Keep proof artifact compatibility and active-run definitions immutable; changes apply to new runs.

Verification targets: From packages/app: bun test tests/workflow/idea-pipeline-definition.test.ts tests/workflow/idea-handoff.test.ts tests/workflow/idea-handoff-cli.test.ts tests/workflow/docs-pipeline-proof-chain.test.ts tests/workflow/docs-pipeline-measured-verdict.test.ts tests/workflow/actions/command-gate.test.ts. Add tests/workflow/wayfinder-resolution.test.ts for executed deterministic gates with model stages mocked. Use workflow validate <owned-file> --json on final files; a validate/dry-run PASS alone is not behavior evidence.

Execution evidence handoff: before changing an owned checker/workflow, save a bounded matched-input measurement under .spur/run/d61-<wbs>-before.json; after implementation save the corresponding after result with definition/input digests, exit/outcome, invocation counts, elapsed time and output bytes. Unknown token/cost values remain null. 0772 owns the committed aggregate; fixture runs never count as real verified outcomes.
### Plan
1. [ ] R1: Capture each owned definition digest and matched fixture invocation/output counts before editing; preserve the data for 0772.

2. [ ] R1: Refine idea boundary checks and batch field prose using existing command.gate/handoff owners; test approval/revise/exhaustion and invalid atomic batch.

3. [ ] R1: Isolate docs captures and verify current run/digest provenance without weakening measured proof or fresh-session verification.

4. [ ] R1: Replace wayfinder length/standalone-word evidence with canonical record/verify/done ordering; test short valid, long hollow, stale answer and denied transition paths.

5. [ ] R1: Run positive/negative fixtures for each workflow, then tag each version and validate its final YAML once; update canonical planning/research/docs contracts and 04.

6. [ ] R1: Run applicable final gate and real task verification; record three upgrade outcomes and before/after evidence for 0772.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

**Status (batch halt, 2026-09-05):** task 0769 is **not-attempted** at the batch level — the batch halted at task 0766 (deferred) with stop-the-batch default. The remaining 6 tasks (0767-0772) inherit the halted-batch state and require a follow-up session to drive per the topo order (0767/0768 after 0766, 0769/0770 after 0766/0767/0768, 0771 after 0767/0768, 0772 last).

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
- Upstream task contracts: spur task show 0766 --json; spur task show 0767 --json; spur task show 0768 --json.
- Surface/process authority: docs/04_DESIGN.md and docs/99_PROJECT_CONSTITUTION.md; local source/test paths are named in Design.

### History
