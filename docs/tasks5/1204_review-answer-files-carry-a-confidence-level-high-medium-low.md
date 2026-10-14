---
schema_version: 1
name: Review answer files carry a confidence level (HIGH/MEDIUM/LOW)
status: done
template: standard
created_at: 2026-10-14T03:44:43.514Z
updated_at: "2026-10-14T06:29:12.935Z"

ac_altitude: graduating
ac_numbering: task-local
feature_id: F51
priority: P2
estimate_hours: 1
done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1204-verdict.json
---

## 1204. Review answer files carry a confidence level (HIGH/MEDIUM/LOW)

### Background

The review PASS boundaries needed the same confidence acknowledgement policy as verification. Current inspection and focused regression execution confirm this behavior is already implemented: both PASS guards pass --review-answer to residual-scan review-gate, whose reviewConfidenceViolation admits HIGH/MEDIUM and requires exact ackLowConfidence=true for LOW or an unparseable/missing level.

**Refine corrections (2026-10-13)**
- The task is wip, not an untouched backlog item. Preserve its lifecycle and implementation receipts; remaining work is review/verify/close-out, not duplicate implementation.
- Original shell-predicate design was superseded: confidence grading lives in packages/app/src/services/residual-scan.ts, preserving ADR-115 guard budgets. No extra YAML grep is required.
- Presence/enum checking of the recorded Review section and answer-grade checking are distinct. Acknowledgement waives only the answer grade; it does not waive FAIL verdicts or recorded review contract/open P1-P3 findings.
- The current implementation treats malformed/duplicate grades as unknown, consistent with missing-confidence verification semantics: without acknowledgement they block; exact acknowledgement permits unknown grade. Freeze that policy explicitly rather than promise invalid-enum hard rejection despite acknowledgement.
- Fresh proof-chain tests passed 36/36 and residual-scan service tests 31/31. Historical Testing receipts remain historical; a full live pipeline was not run during refinement.
- Link to feature F51, a delivery slice under F5 Execution pipeline, rather than leave this task orphaned. Feature F51 uses the same scenarios so the implementation is accountable to its ship criteria.

### Requirements

- [x] R1. The pipeline review answer contract mandates one Verdict: PASS|FAIL and one Confidence: HIGH|MEDIUM|LOW line, with documented evidence-based confidence semantics.
- [x] R2. Both review PASS edges delegate answer confidence grading to the existing review-gate command; HIGH/MEDIUM proceed without acknowledgement, while LOW or missing/unparseable confidence requires ackLowConfidence exactly true.
- [x] R3. Acknowledgement waives only answer confidence grading. FAIL/absent verdict, open P1-P3 findings, recorded Review contract violations, missing scanner or scanner failure remain fail closed through review-fail-triage.
- [x] R4. Focused behavioral regressions exercise both rendered PASS guards and real scanner behavior; source and bundled scanner artifacts agree without adding a shell predicate, new workflow state or public API.

### Acceptance Criteria

```gherkin
Scenario: AC1 — Authoring contract is explicit (req: R1)
  Given plugins/sp/commands/dev-review.md and plugins/sp/agents/super-reviewer.md
  When their answer contracts are inspected
  Then they mandate Verdict and Confidence and describe the operator acknowledgement policy
Scenario: AC2 — Both PASS boundaries apply confidence policy (req: R2, R4)
  Given clean PASS answers at HIGH, MEDIUM, LOW and absent confidence
  When the actual rendered review-to-verify and review-to-approve guards execute
  Then HIGH and MEDIUM pass without acknowledgement
  And LOW and absent confidence fail without acknowledgement and pass with exact true
Scenario: AC3 — Other review failures still block (req: R3, R4)
  Given FAIL or absent verdicts, an open P2 finding, or a missing scanner
  When the rendered PASS guards execute with acknowledgement
  Then they refuse the transition and preserve the existing fail-closed catch-all
Scenario: AC4 — Implementation stays in its deterministic owner (req: R2, R4)
  Given the current source and bundled residual scanner and both workflow guards
  When parity and focused tests run
  Then review-gate owns grading and both edges name --review-answer
  And neither edge adds an inline confidence grep or new state
```

### Q&A

- Closed: the original shell predicate exceeded ADR-115's guard command budget; use reviewConfidenceViolation and reviewGradingInput inside existing review-gate instead.
- Closed: exact ackLowConfidence=true acknowledges LOW or unknown answer grade, mirroring verify semantics; other truthy strings do not acknowledge.
- Closed: recorded Review confidence/source-citation contract violations are independent and cannot be acknowledged away by answer grading.
- Closed: no confidence telemetry row, lint service, public API or extra workflow state. Preserve existing implementation; complete review/verification next.

### Design

As built: config/workflows/task-pipeline.yaml retains its Verdict and real review-gate chain on review-to-verify (profile=auto) and review-to-approve. Both guards pass --review-answer. packages/app/src/services/residual-scan.ts implements reviewConfidenceViolation, reviewGradingInput and the review input to buildReviewGateArtifact. plugins/sp/scripts/residual-scan.ts provides the IO boundary; its generated .mjs must be regenerated through the established build:scripts/Superskill route, never hand-maintained. Both command/subagent authoring sources document the answer contract.

No new API. Confidence parsing reuses extractAnswerConfidence; unknown includes malformed/duplicate values. Exact true acknowledges the answer grade, with all pre-existing blockers still authoritative. Tests in packages/app/tests/workflow/task-pipeline-proof-chain.test.ts exercise both rendered guards using the real scanner; service tests pin recorded contract behavior.

This is already implemented and freshly tested. Keep wip; the next implementer should inspect the current diff/commits and finish any failed AC or generated parity check, then run the harness review and verification/record/close-out. Do not reinsert the historical grep or rewrite completed work. Graduating AC match F51 ship scenarios; task-local numbering binds every task requirement.

Concurrency: inspection found only this task wip and one worktree, but unrelated F43 changes are present in task services, Board surfaces and tests, and generated residual-scan.mjs is dirty. Recheck ownership and compare the generated scanner before any regeneration; preserve unrelated edits. The user request authorizes refinement of this wip task, not lifecycle demotion.

Out of scope: hang diagnosis, confidence telemetry, new parser/lint service, public CLI additions and changing verify certification.

### Plan

1. Reconcile the current implementation with the as-built Design and pending generated residual-scan.mjs diff; preserve unrelated F43 edits and obtain clean/exclusive task ownership before any further code change (R1-R4).
2. Rerun the focused proof-chain and residual-scan tests inside packages/app. Inspect whether exact-ack and malformed/duplicate unknown-grade cases need direct assertions; add only missing coverage in the existing test seams (R2-R4).
3. Check both authoring contracts and source/generated scanner parity through the existing build route if needed; run source-local workflow validation to retain ADR-115 composition compliance (R1/R4).
4. Run harness review and verify for this existing implementation; repair only concrete failures. Persist the real verdict and transition forward through testing/done only after applicable PASS gates. Preserve historical receipts and append new evidence instead of claiming refinement is implementation completion (R1-R4).

### Solution

Current as-built map (supersedes the earlier inline-predicate receipt):
- config/workflows/task-pipeline.yaml: both review PASS edges pass --review-answer into existing review-gate; descriptions and catch-all name confidence policy. No inline confidence grep remains.
- packages/app/src/services/residual-scan.ts:370: reviewConfidenceViolation grades the answer; reviewGradingInput reads the named file; buildReviewGateArtifact incorporates blocking review-contract findings.
- plugins/sp/scripts/residual-scan.ts and generated residual-scan.mjs: scanner IO supplies the answer and operator acknowledgement; confirm generated parity before close-out because the generated file has unrelated working-tree changes.
- plugins/sp/commands/dev-review.md and plugins/sp/agents/super-reviewer.md: authoring and gate ownership contracts.
- packages/app/tests/workflow/task-pipeline-proof-chain.test.ts: static ownership assertion and behavioral matrix through real scanner.

The original task recorded an inline grep implementation before the session review moved grading into the deterministic owner to satisfy ADR-115. This correction preserves that history without asking an implementer to restore the superseded approach.

#### Close-out — 2026-10-14

- `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:915` — both review transitions now execute the confidence matrix against source and installed scanners; separate cases retain the normal per-test timeout under contention.
- `packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:945` — exact acknowledgement still refuses open findings, recorded-contract violations and an unavailable scanner; FAIL and absent verdicts are pinned by the matrix.
- `packages/app/tests/services/residual-scan.test.ts:30` — exact acknowledgement, malformed/duplicate grades, omitted/named-missing/non-file inputs and readable answer IO are covered.
- `plugins/sp/agents/super-reviewer.md:244` — machine-check ownership correctly names scanner-side answer grading.
- `docs/design/task-residual-sweep.md:61` — owning contract now describes confidence grading, standalone compatibility and independent blockers.
- `plugins/sp/scripts/residual-scan.mjs:232` — generated scanner rebuilt through Superskill and exercised by installed-mode guard fixtures. The originally dirty generated scanner was already committed on main during close-out.
- `plugins/sp/lib/inline-run.generated.mjs:1` — generated application libraries rebuilt after the integrated dependency upgrade; 18 bundler determinism tests pass. quality-gate and idea-handoff libraries were refreshed by the same generator.

Final verification: full sequential gate passed 11447 tests across 660 files, lint/typechecks, 51 pre-check rules and 2 post-check rules. Fresh focused app verification passed 73 tests; residual sweep has zero findings. The previous red gates are retained in run scratch and were not represented as successful. A live external coding agent was not launched; rendered guard tests execute the real scanner against controlled task fixtures.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)
- Confidence: HIGH

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | plugins/sp/commands/dev-review.md:46 and plugins/sp/agents/super-reviewer.md:202 define Verdict, Confidence and evidence-based semantics; fresh contract assertion exited 0. |
| R2 | MET | packages/app/src/services/residual-scan.ts:370 grades HIGH/MEDIUM and exact acknowledgement; config/workflows/task-pipeline.yaml:1329 and :1340 pass the answer to the scanner; fresh focused suite: 73 pass, 0 fail, exit 0. |
| R3 | MET | packages/app/src/services/residual-scan.ts:426 preserves independent contract/finding blockers; packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:945 proves acknowledgement cannot bypass findings, invalid recorded contract or missing scanner; FAIL/absent verdict cells also refuse. |
| R4 | MET | packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:915 runs both transitions against real source and installed scanners; packages/app/tests/services/residual-scan.test.ts:30 and :42 cover exact acknowledgement, unknown grades and file boundaries; generated-bundle determinism: 18 pass, 0 fail. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: Authoring contract is explicit | MET | command | Fresh contract assertions exited 0; plugins/sp/commands/dev-review.md:46 and plugins/sp/agents/super-reviewer.md:244 name the line and grading owner. |
| Scenario: Both PASS boundaries apply confidence policy | MET | test | packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:915 executes source/installed HIGH, MEDIUM, LOW, absent and unknown grade cases for both edges; final focused suite 73 pass, 0 fail. |
| Scenario: Other review failures still block | MET | test | packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:945 executes acknowledged open-P2, recorded-contract and missing-scanner refusals; :928 pins FAIL/absent verdict refusal; final focused suite exit 0. |
| Scenario: Implementation stays in its deterministic owner | MET | test | packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:899 pins delegated guards; scripts/commands/bundle-plugin-lib.test.ts:131 pins generation; workflow validation valid=true, exit 0; all 18 bundler tests pass. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

#### Review Report — 1204
**Scope:** Task 1204 implementation commits and close-out tests, scanner generation, authoring contracts and residual-sweep design; unrelated F43 work is baseline only.
**Dimensions:** functional, security, efficiency, correctness, usability, architecture
**Verdict:** PASS
**Confidence:** HIGH

##### Findings

| Priority | Dimension | Location | Finding | Disposition |
| --- | --- | --- | --- | --- |
| P4 | all | packages/app/src/services/residual-scan.ts:370 | No findings (review verdict PASS) | ACCEPTED |

##### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | plugins/sp/commands/dev-review.md:46 defines the answer contract; plugins/sp/agents/super-reviewer.md:202 and :244 define report and gate ownership. |
| R2 | MET | packages/app/src/services/residual-scan.ts:370 grades the answer; config/workflows/task-pipeline.yaml:1329 and :1340 delegate both PASS boundaries; packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:915 executes source and installed scanners. |
| R3 | MET | packages/app/src/services/residual-scan.ts:426 merges independent blockers; packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:945 refuses open findings, invalid recorded contract and missing scanner despite acknowledgement. |
| R4 | MET | packages/app/tests/services/residual-scan.test.ts:30 and :42 cover exact acknowledgement and IO boundaries; regenerated scanner plus real installed-mode guards retain parity. |

##### SECUA and Architecture

Security/correctness: exact acknowledgement waives only answer confidence, with all independent blockers preserved. Missing named files grade as unknown; IO/scanner failure is nonzero. Efficiency: grading reuses the existing scanner and parser, adding no model stage or subprocess. Usability: blocker diagnostics name confidence and acknowledgement. Architecture: pure application grading and plugin IO stay separated; no extra YAML predicate, new state or public noun. No supported deepening finding survived the existing-seam check.

Fresh gate: lint/typecheck, 51 pre-check rules, 11447 tests with 0 failures, and 2 post-check rules; sequential suite completed with exit 0. Prior failed/interrupted parallel attempts and stale generated-bundle failures are retained as red receipts, not counted as PASS. The final tree digest matches quality-gate entry.

### References

- Feature F51: docs/features/F51_review-confidence-certification-at-pipeline-pass-boundaries.md
- Tasks 1068 (verify confidence), 1070 (review contract) and 1122 (review-gate delegation).
- docs/00_ADR.md: ADR-115 composition budgets.
- packages/app/src/services/residual-scan.ts:370: reviewConfidenceViolation; reviewGradingInput and buildReviewGateArtifact supply answer grading.
- packages/app/tests/workflow/task-pipeline-proof-chain.test.ts:861: both rendered PASS guard regressions; fresh 36/36 focused pass.
- packages/app/tests/services/residual-scan.test.ts: fresh 31/31 focused pass.
- Snapshot: 2026-10-13, HEAD 46718be2c; existing wip retained. Unrelated F43 working-tree changes must be preserved. No fresh full live pipeline receipt was produced.

### History

- 2026-10-14T03:57:35.949Z backlog → todo (system)
- 2026-10-14T03:57:36.288Z todo → wip (system)
- 2026-10-14T06:28:32.800Z wip → testing (system)
- 2026-10-14T06:28:52.702Z testing → done (system)

