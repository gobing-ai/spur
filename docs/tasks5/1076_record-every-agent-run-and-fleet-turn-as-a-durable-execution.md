---
schema_version: 1
name: Record every agent run and fleet turn as a durable execution record with spur agent trace
status: backlog
template: feature-impl
created_at: 2026-10-04T20:30:37.507Z
updated_at: "2026-10-04T20:33:17.403Z"
feature_id: G71

dependencies: ["1073", "1074"]
---

## 1076. Record every agent run and fleet turn as a durable execution record with spur agent trace

### Background

Implements G71 R7 — ADR-132 "Every execution is a run; the run id is Spur's session id" (plan `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md` §3.2 item 15; decision D7, `spur agent trace` consented 2026-10-04).

Verified state (2026-10-04):

- Workflow runs already retain narration through `WorkflowRunLogSink` (`packages/app/src/observability/workflow-run-log-sink.ts:65`) into the `.spur/memory/runs/` record pair (ADR-045, ADR-131; `run-storage.ts:729` durable run dir).
- `spur agent run` and fleet member turns have no durable stream: the supervisor keeps a bounded in-memory ring buffer of frames (`packages/app/src/services/supervisor-service.ts:15-36`), lost on restart.
- `coordination_runs` (`packages/domain/src/migrations.ts:167`) has no parent link; `history_run_session` (`:220`) maps run → agent session.
- `spur workflow trace <runId> --output` streams the record pair but is workflow-scoped.

### Requirements

- [ ] R1. `spur agent run` and every fleet member turn tee stdout/stderr frames, secret-redacted, to `.spur/memory/runs/<runId>.log` through the existing `WorkflowRunLogSink`, under ADR-131 retention.
- [ ] R2. The supervisor ring buffer tags each frame with the current `run_id`; the buffer stays a live view, not the record.
- [ ] R3. A migration (next four-digit prefix) adds `coordination_runs.parent_run_id`; the fleet dispatch message carries the parent run id and the exit sink persists it.
- [ ] R4. New `spur agent trace <runId> [--follow] [--json]` prints the lineage tree (root to leaves), each run's agent session ids from `history_run_session`, and the stream; `--follow` polls until terminal. Logic lives in `packages/app`; the CLI is a thin transport (ADR-130).
- [ ] R5. Surface docs: `docs/design/cli-contracts.md`, the `sp:spur-cli` agent reference, and `03_ARCHITECTURE` record the execution record.

### Acceptance Criteria

- [ ] AC1 — Every execution has a durable record

Task-local verification:

- After a member turn and a simulated serve restart, `spur agent trace <root> --json` returns the dispatch → turn lineage, the turn's agent session id, and its stdout/stderr lines.
- Redaction masks a configured secret in the stored log.
- The CLI surface parity test lists `agent trace`.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Plan: `docs/plans/2026-10-04-agent-fleet-inbox-redesign.md`
- ADRs: 057, 086, 121, 126 (amended 2026-10-04); 132 (new)
- Feature: see `feature_id`

### History
