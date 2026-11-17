---
schema_version: 1
name: Certify A93 tooling ownership inventory and migration contract prerequisites
status: done
template: feature-impl
created_at: 2026-11-16T23:01:54.453Z
updated_at: "2026-11-16T23:44:49.313Z"
feature_id: A93
priority: P2
tags:
  - A93
estimate_hours: 3

done_forced: "false"
done_reason: unforced close
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

- [x] R1. Produce docs/reports/A93-script-ownership.json covering scripts/install.sh, scripts/spur-dev.ts and every tracked scripts/commands/**/*.ts candidate, including test-only files and nested fixtures. Record path, responsibility, destination, action, wave WBS, companion tests and path:line caller evidence; retained files require a reason.
- [x] R2. Verify the existing ADR-130 amendment against governance/AGENTS and source templates; change only a real mismatch and preserve dated history. No runtime implementation or checker-policy change.
- [x] R3. Persist the exact proposed self install/status and six builder surfaces, affected legacy behavior and consent scope in the owning design. Record Robin as the deferred consent owner; absent consent stops dependent public implementation, not inventory certification.
- [x] R4. Write the coverage assertion first at repo-wide-tests/a93-script-ownership.test.ts, then the report. Fail for duplicate/unclassified candidates, missing caller evidence without an explicit no-runtime-caller finding, invalid WBS ownership or an app-to-script runtime import. Leave build proofs to 1354/1355.

### Acceptance Criteria

- [x] AC1 — Architectural direction precedes script migration
- [x] AC2 — Every script has an evidenced migration disposition

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

Owned delta, all docs/inventory:

- `docs/reports/A93-script-ownership.json` — the inventory artifact: 64 entries (regenerated candidate set, not a fixed count), each with responsibility, destination (`builder|self|app-workflow|scripts`), action (`absorb|extract|retain|slim|shrink`), owning A93 wave, companion tests, `path:line` callers, and a responsibility-based reason where the file stays in `scripts/`. Adds `deferredConsent` (owner Robin, exact scope) and `boundaryEdges` (one real app→script import).
- `repo-wide-tests/a93-script-ownership.test.ts` — the coverage assertion, written first: report shape, exact candidate coverage (missing/duplicate/stray), classification consistency (a retained file must carry a reason; a moving action must name a wave), caller/test anchor resolution, "no callers ⇒ declared finding + named subject", the app→script import ledger, the ADR-130 amendment surviving beside its historical reading, and the proposed-contract/consent record.
- `docs/design/concrete-spur-self.md` §6–7 — records the release-ops boundary defect and its owner (1355), and the explicit consent record (owner Robin, deferred, with the exact verb/output scope and the legacy behavior each change touches).

No runtime, rule or workflow change: R2's verification found ADR-130, `docs/03_ARCHITECTURE.md`, `docs/design/harness-surface-governance.md` and `AGENTS.md` already consistent, and `config/templates/` carries no placement text to correct.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `docs/reports/A93-script-ownership.json` holds 64 entries — `scripts/install.sh`, `scripts/spur-dev.ts` and every tracked `scripts/commands/**/*.ts`, including 29 companions and the nested `fixtures/fleet-host-fixture.ts`; each carries responsibility, destination, action, wave, companion tests, `path:line` callers and a reason where it stays. Candidate set is regenerated by `repo-wide-tests/a93-script-ownership.test.ts:78`. |
| R2 | MET | ADR-130 keeps its dated amendment beside the historical reading (`docs/00_ADR.md:2223`, `docs/00_ADR.md:2241`); `docs/design/harness-surface-governance.md:85` and `AGENTS.md:219` carry the same split. `config/templates/` ships no placement text (portable project scaffolds only), so no template repair was needed — verified, not assumed. |
| R3 | MET | `docs/design/concrete-spur-self.md:117` names Robin as the deferred consent owner with the exact verb/output scope and the legacy behavior each change touches; `docs/reports/A93-script-ownership.json` mirrors it in `deferredConsent` with `blocksPublicImplementation: true`. No public implementation is claimed. |
| R4 | MET | The assertion was written before the report and fails without it (0 pass, 1 error); it now passes 12/12 and is failure-sensitive: duplicate entry, missing retained reason, out-of-range caller, invalid wave, unknown destination, dropped boundary edge and consent-owner drift each turn it red. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `repo-wide-tests/a93-script-ownership.test.ts:232` — ADR amendment + governance/entry projection assertions both pass |
| AC2 | MET | test | `repo-wide-tests/a93-script-ownership.test.ts:90` — exact candidate coverage, classification consistency, anchor resolution and the app→script ledger all pass |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature: A93; [owning design](../design/concrete-spur-self.md).
- Source ask: .spur/run/9e537a69-f2a1-4f80-be7d-065acca58ecc-idea-input.md.
- Verified current tree: docs/00_ADR.md:2221.
- Verified current tree: scripts/spur-dev.ts:1.
- Verified current tree: docs/design/harness-surface-governance.md:83.
- Refinement report: docs/reports/2026-11-16-A93-ready-refinement.md.

### History

- 2026-11-16T23:44:05.970Z todo → wip (system)
- 2026-11-16T23:44:47.795Z wip → testing (system)
- 2026-11-16T23:44:49.309Z testing → done (system)

