---
schema_version: 1
name: "Upgrade planning and evidence workflows without structural ceremony"
status: done
template: feature-impl
created_at: 2026-09-05T05:21:56.922Z
updated_at: "2026-09-06T06:53:29.052Z"
feature_id: D61
priority: P1
tags: ["workflow-upgrade", "P5"]
dependencies: ["0775", "0767", "0768"]
---

## 0769. Upgrade planning and evidence workflows without structural ceremony

### Background

D61 implementation package P5, approved under ADR-108. Refinement depth: ready. Source inspected at 4801db1bd37422614040eeefcb1afb72d59eede1 with the D61 planning changes in this working tree.

Own exactly idea-pipeline.yaml, docs-pipeline.yaml and wayfinder-resolution.yaml. Idea repeatedly invokes feature check in sibling guards and its prose understates batch schema fields. Wayfinder already searches the correct canonical ### Testing heading; its defect is repeated task reads and >5-line/>60-word proof, plus a standalone verdict word. Docs already has measured verification and a proof bracket; preserve those owners.

Dependencies: 0775, 0767, 0768 (0775 retires the corpus/composition baselines and the regenerator-only machinery as the third phase of decomposed 0766 R2). Detailed inputs and handoffs are frozen below.

### Requirements

- [x] **R1.** Planning and document workflows use evidence instead of ceremony: refine the three owned definitions as specified below, preserve approval/revision bounds and atomic handoff-only task creation, replace word-count proof with run-bound measured evidence and normal guarded completion, isolate temporary captures by run, and set version: "1" on each definition only after its success/failure checks pass.

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
Retired write-shell ceremony across the three example pipelines while keeping every
contract frozen (REQUIRED_FINDING_CODES unsuppressible; `key` stays in
planning-check-base; byte budgets untouched — R44-checked).

**idea-pipeline** (config/workflows/idea-pipeline.yaml:216-224): author/revise boundaries
now measure the persisted state through deterministic `command.gate` steps
(`idea-ac-check`, `idea-design-check`, result files under `.spur/run/<runId>-…`, softFail
so a failing measure routes through guards instead of aborting); all eleven guards consume
the recorded result files (`= PASS` / `!= PASS`), re-entry after refine re-measures.

**docs-pipeline** (config/workflows/docs-pipeline.yaml:154,190,210-214,317): run-scoped
artifacts (`.spur/run/<runId>-docs-*`), verify→record reorder (0769 ordering: record can
no longer precede verification), proof.fingerprint bracket around the verifier
(:154 canonical, :190 re-capture), captured record (:210-214 writes the PASS/FAIL status
file) and record→done guard re-asserting the captured result plus the persisted verdict
(:317). Temporary captures are run-scoped; the verdict keeps its wbs-compat path with
`runId` stamped inside.

**wayfinder-resolution** (full rewrite, config/workflows/wayfinder-resolution.yaml): the
separate `collect` state is deleted — the precheck `task show` capture
(:54 precheck) doubles as the investigate input bundle with no intervening write.
investigate→verify fails closed on a non-empty answer capture; verify is a fresh-session
observe-only reviewer (`freshSession: true` :148) deriving ONE standard verdict via
`spur task verdict --from-answer` (:155) inside a proof digest bracket; the ad-hoc
resolution-verdict PASS-word file and the >5-line/>60-word padding metrics are retired
while truthful `grep -n` evidence anchors stay mandatory. record captures
`task record --solution-from-diff --transition testing` && `task update done
--no-lifecycle` (:195) plus a persisted-status readback; record→done is fail-closed on
those captures — exit 0 never converts a denied record into success.

Tests: packages/app/tests/workflow/wayfinder-resolution.test.ts (16 tests, 75 expect —
collect absence, run-scoped artifacts, executed guard fixtures), rewritten
docs-pipeline-measured-verdict.test.ts (23 tests, 81 expect — new edge set, capture
fail-closed fixtures), idea-pipeline-definition.test.ts updated for command.gates,
plugins/sp/tests/skill-structure.test.ts R40 flipped (decompose prose now lists
design/plan/acceptance_criteria per task-batch.schema.json). Docs:
docs/design/workflow-shell-ownership.md tables + prose updated for the new captured
shell ownership.

Verification: bun test packages/app/tests/workflow 605 pass / 0 fail; skill-structure
68 pass / 0 fail; `bun run spur-check` PASS; `spur workflow validate` PASS ×3.
### Testing
**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 — Planning and document workflows use evidence instead of ceremony | MET | idea-pipeline, docs-pipeline, and wayfinder-resolution now derive verdicts through the standard `spur task verdict` contract with a proof-input digest bracket; config/workflows/wayfinder-resolution.yaml:120-209 replaced the ad-hoc PASS-word and length-padding proxies with a fresh-session observe-only reviewer. Static: guards and captures pinned by packages/app/tests/workflow/wayfinder-resolution.test.ts:100-146 and executed fixtures at :167-216. |
| R2 — Delegation captures and replays real agent evidence | MET | Every agent.run declares answerFile/expectFile under `.spur/run/<runId>-…`; investigate→verify fails closed on a non-empty answer (`test -s`), idea verify consumes the dev-verify answer via `task verdict --from-answer`. Static: config/workflows/wayfinder-resolution.yaml:168-172, config/workflows/idea-pipeline.yaml; executable guard fixtures packages/app/tests/workflow/wayfinder-resolution.test.ts:167-180. |
| R3 — HITL gates remain and are routed exhaustively | MET | docs-pipeline keeps docs-review HITL with yes→verify/no→failed/cancel→cancelled; wayfinder approve routes yes→record/no→failed/cancel→cancelled; idea boundaries keep command.gate measurement before HITL. Static: packages/app/tests/workflow/docs-pipeline-measured-verdict.test.ts:207-212, packages/app/tests/workflow/wayfinder-resolution.test.ts:155-160. |
| R4 — Proof-state brackets fail closed on verifier-time mutation | MET | Both pipelines bracket the verifier with proof.fingerprint (canonical + re-capture) and verify→record denies unless digests match, the verdict file exists, `.verdict = PASS`, and `.proof.digest = proofDigest`; empty/malformed/drifted fixtures all deny (executable). Static+fixtures: packages/app/tests/workflow/docs-pipeline-measured-verdict.test.ts:181-204, packages/app/tests/workflow/wayfinder-resolution.test.ts:182-198. |
| R5 — Recording is captured and never converts exit 0 into success | MET | docs record captures `task record --solution-from-diff --transition testing` into `.spur/run/<runId>-docs-record.status`; wayfinder record captures `task record` + `task update done --no-lifecycle` plus a persisted status readback; record→done guards re-assert captures and the persisted verdict; record→failed is always. Static+fixtures: config/workflows/docs-pipeline.yaml record state, packages/app/tests/workflow/docs-pipeline-measured-verdict.test.ts:123-133 + :205-216, packages/app/tests/workflow/wayfinder-resolution.test.ts:147-153 + :200-216. |
| R6 — Example pipelines stay compositionally valid and shell-minimal | MET | All three YAMLs pass `spur workflow validate` (explicit(1)); shell steps are captured GLUE per docs/design/workflow-shell-ownership.md (composition advisories are advisory-only after 0775 deleted baseline json). Command: `spur workflow validate` × 3 PASS; static: docs/design/workflow-shell-ownership.md wayfinder/docs tables updated in the same task. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| R1 — Planning and document workflows use evidence instead of ceremony | MET | test | bun test packages/app/tests/workflow — 605 pass / 0 fail (2028 expect), incl. new wayfinder-resolution.test.ts (16) and rewritten docs-pipeline-measured-verdict.test.ts (23) and idea-pipeline-definition.test.ts (31); guard fixtures execute the real shell guards fail-closed. `bun run spur-check` PASS (lint+typecheck+tests+rules). |
| R2 — Delegation captures and replays real agent evidence | MET | test | wayfinder-resolution.test.ts:97-146 pins run-scoped answerFile/expectFile, the deleted collect state, input-bundle reuse, and retire of the length/PASS-word proxies; docs-pipeline test pins answer clearing + fail-closed taskpath + verdict derivation. |
| R3 — HITL gates remain and are routed exhaustively | MET | test | Guard pins: docs-review yes/no/cancel, approve yes/no/cancel, draft auto-shortcut declared before always edge (routing order semantics); no always fallback on critical edges. |
| R4 — Proof-state brackets fail closed on verifier-time mutation | MET | test | Executable digest-drift / empty-var / missing-file / non-PASS fixtures deny on both pipelines; canonical/re-capture var pins (proofDigest, proofDigestNow) with identical inputs. |
| R5 — Recording is captured and never converts exit 0 into success | MET | test | Captured-FAIL / missing-capture / wrong-persisted-status / foreign-runId fixtures deny record→done; record onEnter pins the captured verbs; record→failed always. |
| R6 — Example pipelines stay compositionally valid and shell-minimal | MET | command | `spur workflow validate` PASS for idea-pipeline, docs-pipeline, wayfinder-resolution (explicit(1)); docs/design/workflow-shell-ownership.md tables updated with the new captured shell indices. |
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
- Upstream task contracts: spur task show 0766 --json; spur task show 0767 --json; spur task show 0768 --json.
- Surface/process authority: docs/04_DESIGN.md and docs/99_PROJECT_CONSTITUTION.md; local source/test paths are named in Design.

### History
- 2026-09-06T06:52:24.694Z todo → wip (system)
- 2026-09-06T06:52:25.191Z wip → testing (system)
- 2026-09-06T06:53:29.052Z testing → done (system)
