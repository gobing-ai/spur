---
schema_version: 1
name: spur workflow trace --json exposes the run's terminal reason
status: backlog
template: standard
created_at: 2026-10-05T02:56:29.383Z
updated_at: "2026-10-05T02:56:37.650Z"

feature_id: D1
---

## 1090. spur workflow trace --json exposes the run's terminal reason

### Background

Closing a stale run surfaced the gap: `spur workflow cancel run_e6b82447-…` wrote `status=failed`, `terminal_reason='cancelled'` and a `staleReason` (verified with `sqlite3 .spur/spur.db "SELECT status, terminal_reason, completed_at FROM runs WHERE id=…"` → `failed|cancelled|2026-10-04T22:45:36.592Z`), but `spur workflow trace run_e6b82447-… --json | jq '.run'` has no such key at all — its keys are `runId, workflowName, mode, status, startedAt, completedAt, isDryRun, project, durationMs, outcome`. An operator reading the trace sees `terminalReason: null` and cannot tell a cancelled run from any other failure; `interrupt_reason` is missing the same way.

AC-subset note: the scenario below is new for D1's AC; add it there when this task is refined.

### Requirements

- [ ] R1. The `spur workflow trace --json` payload carries the run's terminal reason (nullable) mirroring `runs.terminal_reason`, and its interrupt reason likewise.
- [ ] R2. Human `trace` output shows the reason when present.
- [ ] R3. The CLI contract docs list the fields; a test pins them.

### Acceptance Criteria

- [ ] AC1 — The trace payload carries the terminal reason

Task-local verification: cancel a probe run, then `spur workflow trace <id> --json | jq -r .run.terminalReason` prints `cancelled`; a finished `done` run prints its reason; a run with none prints `null`.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- Chosen: add the two nullable fields to the trace projection (`apps/cli/src/commands/workflow.ts` trace path / the run projection it consumes) sourced from the `runs` row the command already loads.
- Rejected: re-deriving the reason from transitions or metadata (the column is authoritative).
- Invariants: no schema change to the run store; `--json` stays additive (existing consumers unaffected).

### Plan

- [ ] 1. Test first in the workflow command suite: cancelled / done / null cases.
- [ ] 2. Add the fields to the projection and the human renderer.
- [ ] 3. Docs: the trace payload in `docs/design/cli-contracts.md`.
- [ ] 4. Gates: `(cd apps/cli && bun test tests/commands/workflow.test.ts)`, `bun run typecheck`, `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to features, docs, ADRs, related tasks, or external references. -->

### History
