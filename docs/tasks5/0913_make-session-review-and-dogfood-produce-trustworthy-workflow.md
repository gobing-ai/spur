---
schema_version: 1
name: Make session review and dogfood produce trustworthy workflow-improvement evidence
status: backlog
template: standard
created_at: 2026-09-22T00:57:58.668Z
updated_at: "2026-09-22T00:59:29.152Z"
feature_id: I

ac_altitude: task-local
ac_numbering: task-local
estimate_hours: "8"
priority: P2
dependencies: ["0912"]
---

## 0913. Make session review and dogfood produce trustworthy workflow-improvement evidence

### Background

Robin requested this follow-up after reviewing dev-review-session, dev-dogfood and their backing plugin paths: "go ahead to add the new task file." Task 0912 owns the post-delivery baseline and pilot selection under D62; this task owns adoption of that evidence in shipped plugin contracts under I. Do not fold plugin implementation into the measurement task.

Review findings to reproduce:
- P2: plugins/sp/scripts/dogfood-testing/validate-report.ts:52 validates structure but not Cost presence or arithmetic. Pure validator probes accepted removal of the Cost block and a 999% cache figure. The golden fixture at plugins/sp/tests/dogfood-testing/fixtures/report-complete.md:38 reports 1400 total although fresh 1400 plus cached 700 totals 2100.
- P2: plugins/sp/skills/dogfood-testing/references/monitor-ledger.md:106 derives chars/4 estimates, then :172 mandates cache-health findings at fixed 40/50 percent thresholds. Context-reuse estimates do not prove provider cache behavior or unnecessary rereading.
- P2: plugins/sp/commands/dev-dogfood.md:16 advertises retry default 3 versus skill default 2, task attachment versus creation of a new review task, and ambiguous chain-follow behavior. The skill allows reading existing chained evidence, not executing the chain.
- P3: session-review supports --triage, while docs/design/session-review.md and ADR-089 still describe an absolute mutation prohibition. Reconcile the documented explicit exception while preserving report-only default.
- Enhancement: plugins/sp/scripts/workflow-step-profile.ts:403 selects done runs and :255 emits aggregates without sampled IDs. That is not a defect in its existing scope, but it cannot alone provide a comparable failure/recovery baseline.

Two focused session-review structural tests passed during review, demonstrating that those tests do not catch these semantic discrepancies. No live dogfood or full test suite was run during review.

One cohesive plugin evidence-contract task, estimated 8 hours, because command guidance, report grammar, validator and tests must change together. Task-local AC is intentional: these implementation scenarios do not redefine umbrella I's ownership scenarios. Existing I9 owns the environment mapping and remains a reference; do not reopen or broaden its frozen category/protocol scope.

### Requirements

- [ ] R1. Align dev-dogfood, its backing skill and shared flag references on retry default 2, testee-scoped agent forwarding, --task creating a review task, and --chain-follow reading existing chained evidence only.
- [ ] R2. Strengthen the existing dogfood report validator to reject missing required Cost evidence, impossible percentages, contradictory observable token totals/cache arithmetic and unknown values silently folded into zero; correct the golden fixture and preserve valid aborted-report handling.
- [ ] R3. Separate measured usage, heuristic context estimates and unavailable values in report guidance; remove automatic causal waste findings based solely on estimated cache thresholds and require evidence or a labeled hypothesis.
- [ ] R4. Retain dogfood/testee run identity, source and executing-definition provenance, execution mode, measurement source/scope and known/total coverage for evidence used in pilot comparisons; preserve driver versus testee separation.
- [ ] R5. Adopt only supported 0912 findings as focused session-review questions and dogfood observations, with artifact anchors and concrete owner handoffs; if 0912 is insufficient, preserve its limitations and implement no invented performance conclusion.
- [ ] R6. Keep session-review inline, compact and report-only by default, preserve its explicit bounded --triage exception, reconcile owning documentation, and keep historical comparison/recurrence in history-anatomy or existing doctor tooling.
- [ ] R7. Add semantic parity and negative evidence tests, preserve existing report compatibility and standalone plugin installation, and demonstrate the revised path with bounded local dogfood before recording verification.

### Acceptance Criteria

- [ ] AC1 — Command skill and shared references expose the same dogfood semantics (req: R1)
- [ ] AC2 — Invalid cost evidence is rejected and consistent measured estimated or unavailable evidence is accepted (req: R2)
- [ ] AC3 — Estimated context reuse alone cannot establish cache waste or realized savings (req: R3)
- [ ] AC4 — Pilot evidence carries attributable run provenance and honest coverage without mixing driver and testee cost (req: R4)
- [ ] AC5 — Supported baseline findings are adopted and insufficient evidence produces an explicit limitation (req: R5)
- [ ] AC6 — Session review preserves its evidence ownership and its explicit triage exception across documentation and tests (req: R6)
- [ ] AC7 — Regression suites and a bounded local dogfood confirm the revised evidence path (req: R7)

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-22T00:59:28.765Z

Decision: one task under existing plugin owner I, with explicit dependency 0912 for the full evidence-adoption deliverable. The known correctness fixes are independently reproducible and do not scientifically depend on 0912; the dependency sequences the combined task so performance guidance uses actual results.

Scope authorized in this session is task creation. This task specifies future implementation; no implementation, feature status closure, plugin installation or runtime workflow change is claimed now.

0912 may conclude insufficient evidence. That outcome does not block the correctness fixes: use its explicit limits and owner handoff, defer unsupported tuning, and do not manufacture a benchmark. Protocol @1.2 and closed history categories remain unchanged; new provenance is additive and old reports without it remain readable but non-comparable.

Size: eight-hour planning estimate; one shared evidence-contract review boundary. Do not split command wording and validator semantics into separate phase tasks. Parent I's status is not automatically changed by this capture.

### Design

Use existing owners: commands remain thin wrappers; session-review owns active-context diagnosis; dogfood-testing owns execution/ledger/reporting; history-anatomy and spur-doctor own historical interpretation. No new agent, slash command, workflow, analytics engine, dependency, runtime schema or public CLI surface.

Primary edit surface:
- plugins/sp/commands/dev-dogfood.md and dev-review-session.md only where interface wording changes.
- plugins/sp/skills/dogfood-testing/SKILL.md and references/{monitor-ledger,report-template}.md; session-review/SKILL.md; spur-dev/references/{flag-glossary,dev-operations}.md.
- plugins/sp/scripts/dogfood-testing/validate-report.ts and tests/dogfood-testing/report-contract.test.ts plus fixtures.
- plugins/sp/tests/{command-contract,skill-structure}.test.ts for semantic consistency.
- docs/design/session-review.md and applicable dogfood/history surface owners; read docs/99_PROJECT_CONSTITUTION.md and use sp:doc-evolve before edits. Preserve ADR-089 history with a narrowly dated clarification of the already-shipped explicit triage exception, not a silent rewrite.

Metric contract: retain protocol @1.2 and existing headings. Require Cost/Method/confidence/Meter in complete reports. Distinguish measured data from heuristic estimates and unknowns. Validate observable totals as fresh+cached, cache share against that denominator with documented display-rounding tolerance, and percentages within 0..100. All-unknown or zero-denominator evidence renders n/a rather than a fabricated percentage. Unknown chained rows stay outside numeric sums and remain visible in coverage. Do not combine daily/session meters with per-step estimates. Legacy reports without new provenance remain readable but are not automatically eligible for comparison; do not rewrite archived reports.

Provenance is additive in the existing report Testee/Cost sections: dogfood run ID, testee workflow/run/session IDs when known, source commit/dirty-state evidence, resolved definition digest or path+hash, execution mode, measurement scope/source and sample coverage. Unsupported identifiers remain unknown. Before claiming comparability, require compatible scope, mode and evidence; otherwise emit not comparable and route missing evidence to its owner. Preserve historical-analysis ownership: no baseline loader, history import or cohort calculator in session-review.

Consume docs/reports/i31/0912-workflow-baseline.{json,md} only after 0912 produces validated outputs. Cite the actual supported findings rather than hard-code a guessed schema today. Select at most three relevant live-session review questions, such as repeated gates or recovery overhead, only when justified. If 0912 returns INSUFFICIENT_EVIDENCE, ship the independently reproduced correctness fixes and evidence handoff, explicitly defer performance-specific tuning, and claim no speedup.

Reuse workflow-step-profile calculations where compatible. Do not silently change its done-only population for existing consumers. Missing run IDs/failure coverage can be supplied by cited 0912 artifacts; widen a profiler return shape only if integration demonstrates a need, with consumer tests. Keep exact cache coverage/null handling already implemented there.

Implementation preserves proof-window mirror freezing, run-local ledgers, bounded retries, explicit mutating-testee consent and environment proposals. A validated report proves its contract, not causality, benchmark representativeness or realized savings. Keep skill BODY_BUDGET limits; move detailed procedure to existing references. Generated installed adapters go through Superskill, never manual edits.

Rejected: treating 0912 task readiness as measurement completion; duplicating a telemetry subsystem; converting session-review into a benchmark command; broad workflow refactoring; separate tasks for each wording fix; suppressing validator errors or retroactively editing archived evidence.

### Plan

1. Recheck 0912 status and validated artifacts; retain the insufficient-evidence branch if necessary. Read current plugin source, callers, owning design and tests; reproduce the reported validator and semantic gaps.
2. Add focused failing tests for missing Cost, impossible percentages, wrong totals, unknown-versus-zero, all-unknown and rounding cases. Add semantic command/skill checks without snapshotting entire prose.
3. Fix report validation and fixture arithmetic in the existing module; align metric terminology and remove unsupported causal thresholds.
4. Align command/skill/shared-reference semantics and the existing triage documentation exception. Add provenance to existing report sections and tests for comparison eligibility without breaking readable legacy reports.
5. Incorporate supported 0912 findings into bounded review questions and dogfood observation/handoff guidance. Leave historical comparisons with their existing owner.
6. Run focused plugin tests from plugins/sp, including tests/dogfood-testing, command-contract.test.ts and skill-structure.test.ts. Run relevant profiler tests only if that module changes.
7. Run required task-local and feature-scoped checks, script contract/parity checks and plugin-smoke; generate scripts/adapters through supported Superskill tooling as needed. Perform bounded local observe-only dogfood with explicit --max-retry 0, checking both valid and invalid report paths. Do not launch a paid fleet for this check.
8. Review the final diff against this task, record actual verification through the harness, and report remaining telemetry limits separately from correctness.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
