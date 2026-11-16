---
schema_version: 1
name: Land A2A remote writer branches through the integration queue
status: todo
template: feature-impl
created_at: 2026-11-16T01:11:47.121Z
updated_at: "2026-11-16T01:21:05.617Z"
feature_id: G76

dependencies: ["1342"]
priority: P2
estimate_hours: 5
---

## 1345. Land A2A remote writer branches through the integration queue

### Background

Implements: R9 — A remote writer's branch lands through the same gate.

Closes the gap where a fenced A2A member returns `metadata.remoteBranch` that Spur records but never lands (ADR-148 amendment, task 1337).

Contract: `docs/design/fleet-orchestration-lanes.md` (ADR-149); plan: `docs/plans/2026-11-15-multi-agent-task-orchestration.md` (failure catalogue §4.7).

### Requirements

- [ ] R1 — A completed remote write result fetches `remoteBranch` into `sp/remote-<wbs>-<attempt>` and enters the integration queue unchanged.
- [ ] R2 — Spur gates the rebased tree; a remote self-reported pass is never accepted (ADR-138).
- [ ] R3 — A missing branch or failed fetch is `not-started` for integration; the remote writing turn is never replayed.
- [ ] R4 — Fetch uses the operator git config; Spur stores no credentials.

### Acceptance Criteria

- [ ] AC1 — A remote writer's branch lands through the same gate

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-16T01:20:49.160Z

- **Q: Which git remote does `remoteBranch` name?** CLOSED (refine 2026-11-15): `<remote>/<branch>` against a remote already configured in the base repo, honouring R4 (operator git config, no stored credentials). An unknown remote holds with an actionable detail. No new config key (Q5).

### Design

**WHAT.** A completed A2A write result that carries `remoteBranch` is fetched into `sp/remote-<wbs>-<attempt>` and landed by 1342's queue unchanged.

**WHY.** Today the sender records `remoteBranch` (`packages/app/src/services/a2a-member-transport.ts:271`, re-read from `artifact_refs_json` at `:425-431`) but never fetches or merges it (`docs/design/a2a-member-transport.md:238-239`).

**WHERE / frozen names.**
- **Fetch source.** `remoteBranch` is interpreted as `<remote>/<branch>`, where `<remote>` must be a remote configured in the base repo (`git remote get-url <remote>` succeeds). Fetch with `git fetch <remote> <branch>:sp/remote-<wbs>-<attempt>` using the operator's git config and credential helpers. Spur stores no URL or credential, and no new config key is added.
- **Lane.** `WorktreeLaneService.open` (1341) gains an optional `branch` argument so it can check out the fetched branch as the lane instead of creating `sp/run-…`.
- **Queue.** `FleetIntegrationQueue.drainOne` (1342) takes the lane's branch name from the lane record. Rebase, gate, ff-only, persist, sync and dispose are identical. `persistWorktreeRuns` copies nothing when the remote lane has no `.spur/` run rows; this is not an error.
- **Failure mapping.** A missing `remoteBranch`, an unknown remote or a failed fetch → integration outcome `not-started` with a hold detail naming the cause. The A2A turn is **never** re-dispatched (ADR-126 A4).
- **Gate trust.** Only Spur's own gate receipt counts. A remote self-reported pass in the artifact is ignored (ADR-138).

**Anti-patterns.**
- No credential storage.
- No `git pull`.
- No merge commits.
- No second landing path.
- Do not replay the remote turn.

**Handoff.** It extends the two-install fixture from task 1337 (`scripts/commands/fleet-e2e.ts`).

### Plan

1. Write E2E case F11 before code.
2. Extend the two-install fixture from task 1337 so the remote branch lands through the gate.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-16T01:21:05.617Z backlog → todo (system)

