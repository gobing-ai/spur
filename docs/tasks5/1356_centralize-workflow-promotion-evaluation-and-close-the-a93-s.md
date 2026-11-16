---
schema_version: 1
name: Centralize workflow promotion evaluation and close the A93 script ownership audit
status: todo
template: feature-impl
created_at: 2026-11-16T23:01:54.457Z
updated_at: "2026-11-16T23:11:43.631Z"
feature_id: A93
priority: P2
tags:
  - A93
estimate_hours: 4

dependencies: ["1351", "1352", "1353", "1354", "1355"]
---

## 1356. Centralize workflow promotion evaluation and close the A93 script ownership audit

### Background

A93 implements R8 — Noun-specific tooling and retained repository checks keep one owner. Source ask: .spur/run/9e537a69-f2a1-4f80-be7d-065acca58ecc-idea-input.md. Owner contract: docs/design/concrete-spur-self.md. Plan quiz was auto-skipped under the operator's --auto; no public-contract consent is inferred.

**Refine corrections (2026-11-16)**

- Generic workflow evaluator extraction → current script already consumes domain history queries and resolved workflow facts → move only measurement/statistics/verdict types/functions, retaining repository policy and orchestration.
- Fixed-input proof could mock the behavior under test → existing evaluate --db/--config/--workflows-dir/--now supports a real dispatcher fixture → freeze that E2E path.
- Final removal audit assumed every route disappears → authorized CI callers can retain thin forwarding paths → distinguish proven forwarding from obsolete/duplicated logic.
- Dependency assumptions and final handoff implicit → name receipts/contracts from 1351–1355 and one feature-owned verification boundary → record exact inputs/outputs.

Issue triage: the migration outcome remains valid. Already-recorded direction is verified, not reimplemented; existing implementation gaps and owner handoffs are corrected here. No task-level issue was cancelled or merged. Audit: main@134ea68a111b9d0aac739419a7259d7928498005; sole worktree; no wip tasks. Existing A93 changes preserved.

### Requirements

- [ ] R1. Move reusable readAgentRunHistory/measureAgentRunHistory/evaluateCandidate and their measurement/verdict types into packages/app/src/workflow/promotion-evaluation.ts, reusing existing domain query functions; retain repository catalogue, deadlines, check/resolve policy and dispatcher grammar.
- [ ] R2. Preserve zero-real-run delete, strictly-fewer-actions promotion, pinned baseline behavior, missing duration semantics, refusal diagnostics and evaluation timestamp. No public promotion verb or app runtime import from scripts/tests.
- [ ] R3. Consume receipts/dispositions from 1351–1355 and regenerate the exhaustive caller report; classify each remaining dispatcher route as retained repository orchestration or forwarding to one shared owner. Missing approval/foreign-platform execution is explicit, not a completed removal.
- [ ] R4. Prove evaluate/check/resolve via the actual existing dispatcher and isolated SQLite/candidate/workflow fixtures, plus final source/packed/host-native standalone ownership checks. Produce a repeatable final report and run the feature-owned verification pass only after all implementation tasks and their gates are complete.

### Acceptance Criteria

- [ ] AC1 — Noun-specific tooling and retained repository checks keep one owner

Requirement and verification mapping: AC1 covers R1–R4. Given isolated candidate/DB/workflow fixtures, drive existing dispatcher evaluate/check/resolve; assert fixed-time verdict/error policy and final caller/disposition coverage using dependency receipts.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-16T23:11:43.448Z

- Closed: app owns portable measurement/verdict; repository catalogue/deadline/check/resolve policy stays in scripts. No new public verb or source fixture dependency.
- Closed: fixture E2E uses the existing explicit --db/--config/--workflows-dir/--now flags and domain-owned fixture setup, never live run data.
- Closed: retaining a justified single-owner CI forwarding route is compatible with staged migration; duplicated logic and unaccounted routes fail the audit.
- Deferred to upstream tasks/Robin: public consent and implementation receipts are inputs, not grants made by this refinement. Cross-platform runtime validation remains with the appropriate release hosts.

### Design

No new public API. Freeze packages/app/src/workflow/promotion-evaluation.ts exports using existing names and semantic signatures: readAgentRunHistory(dbPath,workflow,runIds?), measureAgentRunHistory(dbPath,workflow,runIds?), evaluateCandidate(candidate,measured,canonicalAgentRunCount,nowIso), associated WorkflowCandidate/AgentRunMeasurement/WorkflowCandidateVerdict data. Use @gobing-ai/spur-domain history rows; move only the minimum helper types/statistics required by these functions. Export through the existing app owner. No repository-root defaults inside app and no candidate persistence/schema redesign.

scripts/commands/workflow-promotion.ts retains load/save catalogue, deadline/retirement/parallel-definition policy, check/evaluate/resolve argument parsing and output. It imports the app functions and shares one verdict implementation. Preserve baseline comparator and runs>0 evidence requirement; only measured durations participate in duration statistics. Do not add a live model call or change the promotion bar.

Test first at scripts/commands/workflow-promotion.e2e.test.ts through bun scripts/spur-dev.ts promotion evaluate <id> --db <fixture> --config <fixture> --workflows-dir <fixture> --now <fixed>. The CLI already supports these internal flags. Create fixture data with the domain DB owner, never touch live candidates/history. Include zero history, reduced/equal counts, baseline drift, missing candidate and resolve contradiction; retain existing workflow-promotion.test.ts assertions and move pure evaluator checks with the owner only when necessary.

Inputs: 1351 canonical inventory/contracts, 1352 read-only status receipt, 1353 installation/bootstrap receipt, 1354 compile and 1355 artifact receipts/forwarding dispositions. All are declared dependencies and must be implemented before final audit. Final output docs/reports/A93-tooling-absorption.md plus refreshed docs/reports/A93-script-ownership.json; execution receipt .spur/run/1356-promotion-e2e.json. Audit leftovers and all artifact entrypoints without publishing or changing workflows. A compatibility forwarding path is accepted only with one actual app owner, a live caller and a recorded retirement condition.

Current tree: only main, no wip task; sequential writing preserves the earlier A93 changes. Budget 4h; requireDiff evaluator/caller+final audit. Request feature-owned verification once after full implementation; this refinement supplies no verify PASS or feature done claim.

### Plan

1. Step 0: verify dependency receipts and current inventory; isolate candidate DB/config/workflow fixtures and recheck baseline comparator semantics.
2. R1/R2/R4: write failing dispatcher E2E cases before extraction; confirm they exercise real app/domain evaluation rather than mocked collaborators.
3. R1/R2: move minimal shared evaluator/types and import from the script, preserving policy/grammar/output and refusal behavior.
4. R3/R4: regenerate final caller report and retained forwarding reasons; run (cd scripts && bun test commands/workflow-promotion.e2e.test.ts commands/workflow-promotion.test.ts), relevant installed proofs and task gate. Only after all task implementation gates pass, invoke the single feature-owned verify pass and attach its actual receipt.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: A93; [owning design](../design/concrete-spur-self.md).
- Source ask: .spur/run/9e537a69-f2a1-4f80-be7d-065acca58ecc-idea-input.md.
- Verified current tree: scripts/commands/workflow-promotion.ts:230.
- Verified current tree: scripts/commands/workflow-promotion.ts:275.
- Verified current tree: scripts/commands/workflow-promotion.ts:302.
- Verified current tree: scripts/commands/workflow-promotion.ts:596.
- Verified current tree: packages/domain/src/analytics/workflow-measurements.ts:313.
- Refinement report: docs/reports/2026-11-16-A93-ready-refinement.md.

### History
