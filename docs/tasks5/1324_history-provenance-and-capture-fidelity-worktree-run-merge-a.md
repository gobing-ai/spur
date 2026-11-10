---
schema_version: 1
name: "History provenance and capture fidelity: worktree run merge and antigravity ETL"
status: todo
template: feature-impl
created_at: 2026-11-10T07:34:40.105Z
updated_at: "2026-11-10T16:31:02.983Z"
feature_id: E6

priority: P2
ac_altitude: task-local
estimate_hours: 16
---

## 1324. History provenance and capture fidelity: worktree run merge and antigravity ETL

### Background

KK history analysis since spur 0.4.30 (2026-11-10) showed two history-fidelity gaps. Provenance:
dev-run worktree pipeline runs record `runs`/`phase_runs`/`task_run_links` in the worktree's own
`.spur/spur.db`, discarded with the worktree — the project DB's newest task_run_links row pointed
at task 0344 (Nov 7) although tasks 0345–0347 ran pipelines Nov 8–10, and `history analyze`
reported `verifiedOutcome.taskDenominator = 0` despite 0345 having a real PASS verdict synced to
the main `.spur/run/`. Capture: antigravity (agy) sessions carried 61% of window messages (9,643
of 15,721) with zero usage, model, or tool-args capture, so 39.9% of wall time shows as
unattributed and cost is blind for the majority source; one agy session emitted 3,455
near-identical "awaiting completion" messages that survive as distinct records, and the loop
detector false-fired 1,050 findings on identical empty args digests (query-level guard fixed in
this repo on 2026-11-10).

### Requirements

- [ ] R1. Worktree provenance merge: at worktree merge/wrap (WT-4 landing or wrapup), runs, phase_runs,
   task_run_links, and run_sessions from the worktree DB merge back into the project DB with ids
   preserved and an exactness/mechanism marker identifying worktree origin; re-merge is idempotent.
- [ ] R2. Antigravity ETL: parse vendor-side logs to populate `history_message.model`, usage token fields,
   cost where derivable, and `history_tool_call.args_raw`/`args_digest`, so agy steps attribute
   time and tokens like other sources.
- [ ] R3. Poll-message dedupe: verbatim-duplicate consecutive assistant messages (same normalized text,
   same session, contiguous) collapse into one record with a repeat count, or carry a disposition
   that downstream aggregators exclude from loop/latency denominators.
- [ ] R4. `history analyze` verifiedOutcome denominators then count tasks whose pipelines ran in
   worktrees, closing the false taskDenominator = 0.

### Acceptance Criteria

- [ ] AC1 — (req: R1; R4): A worktree run's provenance rows (runs, phase_runs, task_run_links, run_sessions) land in the project DB with ids preserved and a worktree-origin mechanism marker; re-merge is idempotent (second merge changes no rows), and `history analyze` counts worktree runs in the verifiedOutcome task denominator instead of a false 0.
- [ ] AC2 — (req: R2): An antigravity session import populates `history_message.model` and usage token fields (cost where derivable) and `history_tool_call.args_raw`/`args_digest`; vendor-unavailable fields carry an explicit unavailable disposition, not empty strings — agy steps stop showing as zero-usage unattributed time.
- [ ] AC3 — (req: R3): Verbatim-duplicate consecutive assistant messages (same normalized text, same session, contiguous) collapse into one record with a repeat count or an excluded disposition, and loop/latency aggregators exclude them from their denominators.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-10T16:30:43.047Z

- Q: Why merge instead of pointing analyze at worktree DBs? A: Worktrees are deleted after
  landing; the project DB is the only durable provenance store. Merge-at-landing is the earliest
  durable point.
- Q: Is the loop-detector fix part of this task? A: No — the query-side empty-digest guard is
  already done (forensic-query.ts, 2026-11-10). This task removes the root cause at import time.
- Q: Dependencies? A: None; both workstreams touch only spur-owned code and fixtures.

### Design

**Decision: two independent workstreams in one task, both on the history plane.**
Workstream A (provenance) extends the existing worktree landing/wrap path
(`packages/app/src/services/worktree-persist.ts`, wrapup pipeline) with a DB merge step;
workstream B (capture) extends the antigravity importer in the history ETL
(`@gobing-ai/ts-llm-jsonl-importer` source adapters) — no new tables.

1. **Provenance merge**: at WT-4 landing, read the worktree `.spur/spur.db` and upsert its `runs`,
   `phase_runs`, `task_run_links`, and `run_sessions` rows into the project DB with ids preserved
   and a `mechanism` marker noting worktree origin. Upsert keyed on run id makes re-merge
   idempotent; no row is deleted.
2. **Antigravity capture**: parse vendor-side session logs for model, usage token fields, and tool
   args; populate `history_message.model`/usage and `history_tool_call.args_raw`/`args_digest`.
   Fields the vendor does not expose get an explicit unavailable disposition rather than empty
   strings (the empty-digest loop-detector false-fire was already guarded query-side).
3. **Poll dedupe**: verbatim-duplicate consecutive assistant messages (same normalized text, same
   session, contiguous) collapse to one record with a repeat count or an excluded disposition so
   loop/latency aggregates stop counting them.

### Plan

- [ ] P1. Provenance merge module: worktree DB reader + idempotent upsert into project DB, invoked
  from the WT-4 landing/wrap path; unit tests with two DB fixtures and a re-merge assertion.
- [ ] P2. Antigravity ETL adapter: model/usage/args extraction with unavailable-disposition
  fallback; fixture test over a real agy session shape.
- [ ] P3. Consecutive-duplicate assistant collapse (or disposition tagging) in the importer;
  aggregate-level test that loop findings and latency denominators exclude them.
- [ ] P4. Verify `spur history analyze` on the merged fixtures: taskDenominator counts worktree
  runs, unattributed share drops.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-10T16:31:02.983Z backlog → todo (system)

