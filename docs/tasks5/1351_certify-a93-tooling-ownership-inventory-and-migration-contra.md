---
schema_version: 1
name: Certify A93 tooling ownership inventory and migration contract prerequisites
status: todo
template: feature-impl
created_at: 2026-11-16T23:01:54.453Z
updated_at: "2026-11-16T23:11:21.379Z"
feature_id: A93
priority: P2
tags:
  - A93
estimate_hours: 3

---

## 1351. Certify A93 tooling ownership inventory and migration contract prerequisites

### Background

A93 implements R1 — Architectural direction precedes script migration; R2 — Every script has an evidenced migration disposition. Source ask: .spur/run/9e537a69-f2a1-4f80-be7d-065acca58ecc-idea-input.md. Owner contract: docs/design/concrete-spur-self.md. Plan quiz was auto-skipped under the operator's --auto; no public-contract consent is inferred.

**Refine corrections (2026-11-16)**

- Architectural amendment still to implement → ADR-130 and its projections are already changed in this tree → retain verification only; do not repeat the amendment.
- 64-file baseline treated as permanent → 64 currently enumerated candidates are a dated baseline → regenerate and compare file sets, including test-only fixtures.
- Inventory task expected to prove later build behavior → compile and artifact E2E belong to 1354/1355 → inventory checks coverage/ownership/caller edges, not their implementation.
- Unowned pending approval → Robin owns exact public-contract consent before public implementation → record a deferred execution prerequisite rather than infer consent or block the audit.

Issue triage: the migration outcome remains valid. Already-recorded direction is verified, not reimplemented; existing implementation gaps and owner handoffs are corrected here. No task-level issue was cancelled or merged. Audit: main@134ea68a111b9d0aac739419a7259d7928498005; sole worktree; no wip tasks. Existing A93 changes preserved.

### Requirements

- [ ] R1. Produce docs/reports/A93-script-ownership.json covering scripts/install.sh, scripts/spur-dev.ts and every tracked scripts/commands/**/*.ts candidate, including test-only files and nested fixtures. Record path, responsibility, destination, action, wave WBS, companion tests and path:line caller evidence; retained files require a reason.
- [ ] R2. Verify the existing ADR-130 amendment against governance/AGENTS and source templates; change only a real mismatch and preserve dated history. No runtime implementation or checker-policy change.
- [ ] R3. Persist the exact proposed self install/status and six builder surfaces, affected legacy behavior and consent scope in the owning design. Record Robin as the deferred consent owner; absent consent stops dependent public implementation, not inventory certification.
- [ ] R4. Write the coverage assertion first at repo-wide-tests/a93-script-ownership.test.ts, then the report. Fail for duplicate/unclassified candidates, missing caller evidence without an explicit no-runtime-caller finding, invalid WBS ownership or an app-to-script runtime import. Leave build proofs to 1354/1355.

### Acceptance Criteria

- [ ] AC1 — Architectural direction precedes script migration
- [ ] AC2 — Every script has an evidenced migration disposition

Requirement and verification mapping: AC1 covers R2/R3; AC2 covers R1/R4. Observe through the current ADR/governance text and repo-wide ownership assertion, with an inventory digest receipt.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-16T23:11:21.191Z

- Closed: retain ADR-130; the direction is already recorded. This task certifies it and the inventory, not a second architecture change.
- Deferred to Robin before public implementation: explicit consent to design §7 surfaces and compatibility changes. The audit may finish while the grant remains pending.
- Closed: no merge, task cancellation, feature relink or workflow edit is part of refinement.

### Design

No new public API in this task. Deliver the inventory and contract prerequisite record; retain ADR-130 as the existing decision of record. The report shape is {schemaVersion:1,generatedAt,sourceCommit,entries:[{path,responsibility,destination,action,waveWbs,tests,callers:[{path,line}],retainedReason?}]}; use tracked candidates, not a guessed fixed count. Test-only entries may have no runtime caller but must name their subject or fixture owner.

Owned targets: docs/reports/A93-script-ownership.json, docs/design/concrete-spur-self.md §6–7, repo-wide-tests/a93-script-ownership.test.ts; only necessary governance/entry projection corrections. Do not write a new inventory command or alter rule/workflow policy. Frozen handoff: 1352 reads collector ownership, 1353 install/bootstrap ownership, 1354 compile inputs, 1355 artifact inputs, 1356 final dispositions. Source root/build acyclicity is a classified edge here; execution evidence is owned downstream.

Decision gate: proposed contracts are frozen for implementation design, consent is explicitly deferred to Robin before public changes and recorded by the task executing them. No actual install, workflow edit, publish or inferred approval. Current concurrency: sole main worktree; no wip tasks; other six A93 tasks share this tree and execute sequentially. Initial unrelated edits are preserved.

Budget: one 3h session; mutationPolicy: docs-and-inventory-only; requireDiff: report/test/doc delta only. Persist partial inventory under .spur/run/1351-* at the boundary. Premises verified: docs/00_ADR.md:2221; scripts/spur-dev.ts:1; docs/design/harness-surface-governance.md:83.

### Plan

1. R1/R4: enumerate tracked candidates/callers and write the failing repo-wide ownership assertion before the report; include orphan tests and nested fixtures.
2. R1/R2: fill report entries, cross-check current ADR/governance/entry owners and repair only factual drift.
3. R3: document exact proposed public changes and Robin-owned consent deferral; hand the owner-specific report rows to 1352–1356 without declaring public implementation authorized.
4. R4: run bun scripts/spur-dev.ts run-tests test --reporter=dots ./repo-wide-tests/a93-script-ownership.test.ts, affected feature/task checks and the task pipeline gate; save commands, inventory digest and findings under .spur/run/1351-*.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature: A93; [owning design](../design/concrete-spur-self.md).
- Source ask: .spur/run/9e537a69-f2a1-4f80-be7d-065acca58ecc-idea-input.md.
- Verified current tree: docs/00_ADR.md:2221.
- Verified current tree: scripts/spur-dev.ts:1.
- Verified current tree: docs/design/harness-surface-governance.md:83.
- Refinement report: docs/reports/2026-11-16-A93-ready-refinement.md.

### History
