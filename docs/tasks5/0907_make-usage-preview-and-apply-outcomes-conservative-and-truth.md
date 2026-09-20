---
schema_version: 1
name: Make usage preview and apply outcomes conservative and truthful
status: todo
template: feature-impl
created_at: 2026-09-20T15:48:46.080Z
updated_at: "2026-09-20T15:50:08.987Z"
feature_id: B61
priority: P1
tags:
  - i31-next-batch
estimate_hours: 5

ac_numbering: task-local
ac_altitude: task-local
---

## 0907. Make usage preview and apply outcomes conservative and truthful

### Background

I31/0904 C10 exposed preview/apply ownership disagreement. Current runAgentUsageProducer includes no-usage providers in healthy mappings and labels applied before drain; its own contract says no-usage must be skipped. The report reconstruction is a lead, not an executable regression.

### Requirements

- [ ] R1. Exclude no-usage and errored providers from availability decisions and observations; retain their diagnostic/snapshot classifications. When providers share an executor, exhausted valid signal wins; absent signal cannot hide valid headroom or imply recovery.
- [ ] R2. Preview and apply must preserve both bare disabled:true and explicit operator-owned disables. Preview reports no-op with an ownership reason and unchanged target; it writes no snapshot, observation or YAML.
- [ ] R3. Emit applied only after the exact observation created by this invocation is acknowledged without a skip. Use no-op for protected/unchanged decisions, skipped for a superseded or rejected observation, and pending for unacknowledged or failed delivery; expose an accurate reason without swallowing write failures.
- [ ] R4. Preserve the existing single availability writer and declaring-layer precedence. Verify isolated project-only, global-only and shadowed declarations, partial provider errors and nonzero parsable captures without touching operator configuration.
- [ ] R5. Update the owning design and CLI rendering/tests for additive skipped/pending action values; document applied as acknowledged desired state, not proof of byte mutation. Keep drain.applied as its existing delivery-ack count.

### Acceptance Criteria

- [ ] AC1 — usage decisions require a real signal and respect operator ownership (req: R1)
- [ ] AC2 — operator-owned disables survive preview and apply (req: R2)
- [ ] AC3 — usage actions describe acknowledged outcomes (req: R3)
- [ ] AC4 — usable partial provider results remain supported (req: R4)
- [ ] AC5 — usage output documents delivery semantics (req: R5)

### Q&A

Ready freeze — 2026-09-20, inline planning owner.

- Q: Implement now or prepare delegation? A: Prepare a reviewable implementation-ready task; production implementation belongs to the delegated coding agent.
- Q: Is I31 evidence sufficient? A: The reports identify candidate defects; current source anchors substantiate the bounded fixes. The implementation starts with executable regression evidence. Sparse 0905 runs do not authorize trace/cost redesign.
- Q: Dependencies and execution order? A: No unfinished semantic upstream dependency. I31 tasks 0903/0904/0905 are done. Recommended serial order: 0906 → 0907 → 0908 → 0909. Parallel work requires isolated worktrees and serial integration; 0907/0908 share a design satellite.
- Q: Which scope choices remain open? A: None required for this task. Requirements and Design freeze the implementation behavior; freshness policy, installed role propagation, fleet receipts and cost attribution are separate follow-ups.
- Q: Feature traceability? A: B61 R1 ↔ AC1-AC2; B61 R2 ↔ AC3/AC5; B61 R4 ↔ AC4 (capture compatibility). Task-local AC describe the implementation checks without redefining feature shipment criteria.
- Q: How is this checked? A: Focused tests listed in Plan, then `bun run spur-check`, task verify PASS and a separate task commit. Run `bun run spur-check-feature` once per completed feature (after both tasks for B61). CLI source changes additionally require `bun link` inside apps/cli and `bun run --filter @gobing-ai/spur build:bundle` from the root. New feature completion must satisfy its real dogfood gate; historical parent evidence is not fabricated.

### Design

Freeze the smallest fix in runAgentUsageProducer and its existing result contract. Keep classification thresholds, mapping, observation DAO and quota drain ownership. Filter no-usage before choosing an executor decision, while retaining diagnostic mapping. Evaluate operator ownership before preview planning; the drain still checks ownership again to protect races. Dry-run returns would-apply only for eligible changes and no-op for protected or already-satisfied state.

Track the random observation ID returned by the existing recording path, then inspect AgentExecutorUpdateDao.getUpdate after drain. applied requires applied_observation_id equal to this invocation's ID and no skipped_reason; a later/different observation is skipped (superseded), not success for this run. Unacknowledged delivery/failure is pending with bounded reason; rejected recording is skipped with its outcome. Inspect Promise.allSettled failures instead of silently losing them. Preserve fail-closed capture/parse/config errors. Add only skipped and pending to AgentUsageChange.action; no new noun, flag, table, scheduler or public policy. Keep action/state semantics consistent in human and JSON outputs. For skipped/pending, describe the requested target as intent and explain that completion is unconfirmed; do not claim the desired state was persisted.

A re-acknowledged desired state may be applied without a YAML byte change: this is delivery semantics, not a reason to redesign the shared drain counters. Avoid editing the quota consumer unless its existing observation receipts cannot express the result; if that premise fails, report the exact gap before widening scope.

Regression matrix: enabled + exhausted; quota/probe disabled + real headroom; all-null/missing windows; provider errors; mixed no-signal/headroom/exhaustion aliases; operator true/object in preview and apply; write failure; stale/replaced observation; identical desired state; project/global/shadowed layers. Use in-memory SQLite, temporary snapshots/projects and the actual writer. For global paths run an isolated test child with a narrowly injected homedir seam before module loading; never point the writer at the real home or repurpose HOME. Mock provider input, not the writer. No live Codexbar polling required.

Dependencies: none. Own app producer/tests and CLI usage rendering/tests plus session-pinned-dispatch.md §3. The deadline task owns CLI capture source; both share the design file and CLI test workspace, so integrate serially despite no data dependency.

Source anchors:
- `packages/app/src/services/agent-usage-producer.ts`
- `packages/app/src/services/agent-quota-updates.ts`
- `packages/domain/src/dao/agent-executor-update-dao.ts`
- `packages/config/src/executor-update.ts`
- `packages/app/tests/services/agent-usage-producer.test.ts`
- `packages/app/tests/services/agent-quota-updates.test.ts`
- `apps/cli/tests/commands/agent-usage.test.ts`
- `docs/design/session-pinned-dispatch.md`
- `docs/reports/i31/0904-availability.md`

### Plan

- [ ] 1. Establish failing no-usage, operator-preview and post-drain reporting cases against current source, with isolated paths and real DAO (R1-R3/AC1-AC3).
- [ ] 2. Implement conservative decision selection and exact-observation reconciliation in the existing producer; update rendering exhaustiveness for skipped/pending (R1-R3,R5/AC1-AC3,AC5).
- [ ] 3. Exercise real writer layer precedence and error/supersession cases; run producer/quota tests inside packages/app and usage command tests inside apps/cli (R4/AC4).
- [ ] 4. Update session-pinned-dispatch.md §3 and usage reference result semantics; run task-local gates, rebuild/link CLI, verify and commit; defer B61 feature-wide gate until both B61 tasks are complete (R5/AC5).

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
