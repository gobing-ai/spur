---
schema_version: 1
name: Fix post-G11 inbox, guest and task-projection regressions
status: done
template: issue
created_at: 2026-10-21T18:35:53.093Z
updated_at: "2026-10-21T19:12:43.043Z"
priority: P1

done_forced: "false"
done_reason: unforced close; PASS artifact at .spur/memory/evidence/1271-verdict.json
---

## 1271. Fix post-G11 inbox, guest and task-projection regressions

### Background

Comprehensive source review after G11 reproduced inbox claim generation races, async shared-connection transaction leakage, missing idempotency metadata checks, non-FIFO claim results, guest hook shape/consumption mismatches, global composer receipt misclassification, Inbox pagination selection races and missing zero-row fleet members, plus legacy task feature projection and custom feature-directory validation gaps. Fix root causes and sibling consumers, preserve chat/read-only semantics, with deterministic regression coverage. Scope: packages/app/, packages/domain/, packages/config/, packages/contracts/, apps/cli/, apps/server/, apps/web/, plugins/sp/, scripts/ and the owning docs/design/ contracts; any engine facade extension must follow the released ts-db boundary rather than a Spur workaround.

### Requirements

- [x] R1. Make inbox row/event transactions atomic without absorbing unrelated writes on the shared database connection.
- [x] R2. Fence claim settlement/release to the exact claim generation across expiry, requeue and reclaim; preserve FIFO delivery.
- [x] R3. Reject idempotency-key reuse with conflicting task or parent-run metadata.
- [x] R4. Restore guest Stop-hook JSON compatibility and ensure recipient-authorized guest work is claimed and settled without consuming inbox reads.
- [x] R5. Show truthful delivery/run receipts for global composer chat messages and role-targeted sends.
- [x] R6. Isolate Inbox pagination and row updates by selected member and include declared fleet members before their first message.
- [x] R7. Normalize legacy task feature/status projections and bind legacy feature edges into readiness digests.
- [x] R8. Honor configured feature directories in task AC validation and repair confirmed sibling stale integration assumptions.

- [x] R9. Remove retired accepted-baseline suppression plumbing from task checks while preserving unsuppressed severity and finding identity behavior.

### Acceptance Criteria

- [x] AC1 — An event failure rolls back only its inbox mutation, preserving an unrelated concurrent write (req: R1).
- [x] AC2 — A stale claimant cannot settle or release a reclaimed message, and returned claims preserve created order (req: R2).
- [x] AC3 — Conflicting taskId or parentRunId under the same request key fails without mutation (req: R3).
- [x] AC4 — Current inbox JSON triggers guest continuation and answered work does not remain perpetually queued (req: R4).
- [x] AC5 — Global chat and role-targeted messages show their actual durable delivery and run states (req: R5).
- [x] AC6 — A late older-page response cannot contaminate another member and a fresh declared member is selectable (req: R6).
- [x] AC7 — Legacy feature-id tasks appear in show/list filters, canonical status filters include legacy casing, and linkage changes alter readiness digests (req: R7).
- [x] AC8 — A nonsibling configured features directory still validates task scenario linkage and sibling fixes have targeted regressions (req: R8).

- [x] AC9 — Task checking cannot suppress findings through the retired accepted option; strict and severity override behavior remains covered (req: R9).

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

Preserve project layers and the public spur noun/verb inventory. Extend the public ts-db adapter facade through a pinned dependency patch; never access drizzle internals. Propagate exact claim ownership through existing consumers. Keep list/thread reads pure and chat excluded from unresolved work. Update the owning docs/design/inter-agent-control-plane.md contract, patches/README.md and docs/reports/2026-10-21-source-audit.md evidence report. User confirmation is required separately for feature/task deprecation. mutationPolicy: code.

### Plan

- [x] Reproduce and freeze all source findings with caller-chain evidence.
- [x] Fix shared inbox atomicity, ownership, idempotency and ordering paths.
- [x] Repair guest, server and composer integrations without weakening read contracts.
- [x] Repair Inbox selection/paging and canonical task projections/validation.
- [x] Run focused regressions and owning contract synchronization.
- [x] Run required project gate, review all changes, certify requirements/AC, and commit the task.

### Root Cause

Inbox row/event mutations awaited asynchronous BEGIN/COMMIT on a shared connection, allowing unrelated writes into a rollback. Ownership used message IDs without claim generation; replay identity omitted task/run metadata. Guest consumption, receipt classification and UI requests assumed outdated payload/selection lifetimes. Task metadata readers bypassed canonical aliases and AC validation assumed sibling feature directories. Retired accepted-baseline filtering remained callable despite removal of its owner.

### Solution

packages/domain/src/dao/inbox-dao.ts:160 and packages/app/src/services/task-metadata.ts:4: Use the optional public ts-db synchronous transaction facade with a pinned source/distribution dependency patch. Carry exact {id,attempts} claims across DAO/application/CLI consumers; preserve FIFO and full idempotency identity. Restore bounded guest handoff, exact durable chat/request receipts, project/member request fencing and fresh declared members. Share canonical task metadata and configured feature-directory resolution; remove dead accepted-baseline plumbing. Synchronize the control-plane contract and plugin references. Focused implementation receipts are summarized in docs/reports/2026-10-21-source-audit.md.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | Native atomic transaction and absent-capability behavior: packages/domain/src/dao/inbox-dao.ts:160; isolation/thenable/expired-handle regressions: packages/domain/tests/dao/inbox-dao.test.ts:212. |
| R2 | MET | Exact attempts ownership and FIFO regressions: packages/domain/tests/dao/inbox-dao.test.ts:242; expired reclaim service regression: packages/app/tests/services/inbox-service.test.ts:367. |
| R3 | MET | Full replay metadata and unique-key race regressions: packages/app/tests/services/inbox-service.test.ts:344. |
| R4 | MET | Guest authorized bounded handoff CLI regressions: apps/cli/tests/commands/agent/wait.test.ts:381; actual Stop-hook payload regressions: plugins/sp/tests/hooks/fleet-guest-stop.test.ts:98; executable join/send/wait/reply/second-wait probe passed. |
| R5 | MET | Exact chat/recipient receipt and run-state regressions: apps/server/tests/modules/inbox/handlers.test.ts:413; global receipt selection and project fencing: apps/web/tests/components/global-agent-receipts.test.ts:21. |
| R6 | MET | Member/project late pagination, refresh and zero-row membership regressions: apps/web/tests/modules/projects/inbox-view.test.ts:160. |
| R7 | MET | Canonical task aliases/filter regression: packages/app/tests/services/task-query-ops.test.ts:175; readiness digest regression: packages/app/tests/services/task-readiness.test.ts:505. |
| R8 | MET | Configured nonsibling feature directory regression: packages/app/tests/services/task-feature-link.test.ts:119; full workspace typecheck checks propagated claim signatures. |
| R9 | MET | Removed suppression option regression, strict/severity and observed finding identity suites: packages/app/tests/services/planning-check-base.test.ts:388; packages/app/tests/services/task-check.test.ts:3524; packages/app/tests/services/corpus-check.test.ts:287. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | Domain inbox-dao suite: failed inbox transaction leaves the unrelated concurrent insertion committed; async callback rolls back and escaped handle fails. |
| AC2 | MET | test | Domain inbox-dao suite: stale settlement/release changes no rows/events; replacement remains claimed; created-order claim output passes. |
| AC3 | MET | test | App inbox-service suite: changed/absent taskId and parentRunId conflict, including concurrent unique-key race; exactly one sent event. |
| AC4 | MET | test | CLI agent wait and plugin fleet-guest-stop suites cover current JSON and bounded consumption; real subprocess probe answered the work and subsequent wait timed out. |
| AC5 | MET | test | Server inbox handlers and web global-agent-receipts suites cover exact any-kind/recipient durable receipts, run projection, concrete member targeting and terminal polling cleanup. |
| AC6 | MET | test | Web inbox-view suite covers late older-page rejection after selection/project changes and selectable declared members before their first message. |
| AC7 | MET | test | App task-query-ops and task-readiness suites cover legacy feature-id/status normalization, filters and edge-bound digest change; server task handlers preserve the projection. |
| AC8 | MET | test | App task-feature-link nonsibling-directory test plus affected service/CLI/server/web/hook regressions pass. |
| AC9 | MET | test | Planning-check-base, task-check, feature-check and corpus-check suites prove a retired accepted property cannot suppress findings; severity overrides and strict checks remain covered. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Verdict: PASS**
Confidence: MEDIUM

| # | Finding | Dim | Location | Priority | Disposition |
| --- | --- | --- | --- | --- | --- |
| 1 | Shared transaction rollback, stale claim generation, FIFO and replay identity defects reproduced and repaired; native atomic facade and exact ownership cover sibling consumers. | Correctness | packages/domain/src/dao/inbox-dao.ts:160 | P1 | FIXED |
| 2 | Guest payload/consumption mismatch, receipt classification and cross-project late responses repaired with transport and UI regressions. | Correctness | apps/web/src/components/GlobalAgentBar.tsx:1 | P2 | FIXED |
| 3 | Canonical task metadata/configured feature directory and retired baseline suppression repaired without changing historical feature acceptance. | Traceability | packages/app/src/services/task-metadata.ts:4 | P2 | FIXED |
| 4 | Source and distributed ts-db facade are patched consistently (`patches/README.md:9`), but patch remains pinned to 0.5.32 pending upstream release; unsupported adapters fail explicitly. | Maintainability | patches/README.md:1 | P4 | ACCEPTED |
| 5 | Loaded inbox history refresh performs additional page reads to preserve authoritative row state; bounded by already loaded history. | Performance | apps/web/src/modules/projects/InboxView.tsx:1 | P4 | ACCEPTED |

Independent reviews checked core transaction/claim consumers and UI/server/guest integrations. Follow-up feedback was fixed: exact non-orchestrator classification, full handoff instructions, project/generation fencing and path-aware draft clearing. Focused workspace tests/typechecks and CLI executable probes passed; the full integrated task gate is the final verification authority. No real browser or live coding agent was launched. No deprecation was performed without operator confirmation.

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History

- 2026-10-21T18:59:05.913Z todo → wip (system)
- 2026-10-21T19:12:23.009Z wip → testing (system)
- 2026-10-21T19:12:33.566Z testing → done (system)

- Full integrated gate PASS: 11,557 tests, zero failures, 43,708 assertions across 742 files; lint, all workspace typechecks, pre/post rules green. Native transaction facade and CLI guest subprocess probes were also exercised.
- Pipeline e28f1f86-2b96-4e29-b393-39439daa2c71 stopped on review-authoring format: the table used P instead of canonical Priority, so confidence derivation ignored the carried rows. Corrected Priority and added the required same-cell patch citation. Fresh review-gate passed; recorded all requirements/AC MET, residual sweep blocking=0/advisory=2 and normal guarded testing-to-done passed. No forced completion or evidence waiver.
- Unsuppressed corpus audit ran separately and reported 463 errors /299 warnings; historical evidence/dogfood debt remains visible, distinct from the passing source gate.

