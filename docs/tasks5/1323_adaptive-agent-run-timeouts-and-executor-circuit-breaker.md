---
schema_version: 1
name: Adaptive agent-run timeouts and executor circuit breaker
status: todo
template: feature-impl
created_at: 2026-11-10T07:34:39.575Z
updated_at: "2026-11-10T16:31:02.654Z"
feature_id: D3

priority: P1
ac_altitude: task-local
estimate_hours: 12
---

## 1323. Adaptive agent-run timeouts and executor circuit breaker

### Background

KK history analysis since spur 0.4.30 (2026-11-10) shows workflow `agent.run` dispatches failing at
exactly their configured `timeoutMs` (600s on kk-daily-ai-voice3 plan-translate/script-write; 1200s
on kk-daily-safety review/revise) because the first-choice executor (pi-dsv4.1-flash-volc, ~100K
token prompts, 4–80s steps) cannot finish inside the budget. Retry chains in one 3-day window:
review-retry ×11 (66 min), judge-retry ×10 (45 min), revise-retry ×10 (26 min) — 33 extra dispatches
and 150+ minutes. Separately, an unavailable executor (codex-sol) returned instant exitCode 2
"dispatch result carried no usage" 6+ times and was still retried. Pairing success rates were
reviewer 40% and scribe 37.5%. Both Nov 9 kk-daily-ai-voice3 production runs failed
`failed-check` after ~2.2h each.

### Requirements

- [ ] R1. Circuit breaker: an executor whose dispatch fails immediately with unavailability (exitCode 2 /
   no usage / provider unavailability) is skipped for the remainder of the run's ladder before
   another dispatch is attempted against it.
- [ ] R2. Adaptive timeout: per-node `timeoutMs` may be derived from the executor's observed latency
   history (e.g. `history_board_model_stats` mean/p95 step and dispatch durations) with the YAML
   value as the hard cap, so slow executors get a workable budget instead of a guaranteed timeout.
- [ ] R3. Ladder ordering may use measured latency × success rate (not price alone) when choosing the next
   executor after a timeout or unavailability failure.

### Acceptance Criteria

- [ ] AC1 — (req: R1): With a dead executor first in the ladder, a run with a retry-bound node performs zero
  dispatches against the dead executor after its first unavailability failure.
- [ ] AC2 — (req: R2; R3): A node whose historical executor latency exceeds the static timeout either completes under a
  derived budget or fails over to the next executor without burning the static timeout twice.
- [ ] AC3 — (req: R1; R2; R3): Ladder decisions and derived budgets are recorded in the run trace for auditing.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-10T16:30:41.706Z

- Q: Why not fix the workflows instead? A: YAML budgets are operator intent; the defect is the
  executor ignoring measured latency and re-dispatching to dead executors. Fixing it in the engine
  repairs every workflow at once.
- Q: Does the breaker persist across runs? A: No — run-scoped only. Cross-run executor disabling
  already belongs to B5/B6 availability lifecycle, not this task.
- Q: Dependencies? A: Reads `history_board_model_stats` when present; degrades to static behavior
  when history is empty. No other task dependency.

### Design

**Decision: extend the existing escalation ladder in `packages/app/src/services/agent-run-executor.ts`;
do not add a parallel retry controller.** The ladder already tracks executors tried per run and
escalates on rule-matched failures. Two additions close the measured failure modes:

1. **Circuit breaker (unavailability)**: when an attempt fails immediately with executor
   unavailability — exitCode 2, "dispatch result carried no usage", provider unavailable
   classification — mark that executor unavailable for the rest of the run so subsequent attempts
   and retry-bound nodes skip it. The existing per-attempt exclusion list is the seam; the breaker
   persists the exclusion across attempts of the same run instead of relearning it per node.
2. **Adaptive timeout (latency)**: per-node `timeoutMs` may be derived from observed executor
   latency in `history_board_model_stats` (mean/p95 dispatch duration), clamped to the YAML value
   as a hard cap. When no history exists, the static YAML timeout applies unchanged.
3. **Ladder ordering**: after a timeout or unavailability failure, order remaining executors by
   measured latency × success rate (from the same stats) instead of declaration order alone.

Every breaker decision, derived budget, and ordering rationale is written to the run trace.

### Plan

- [ ] P1. Add a run-scoped unavailability breaker to `agent-run-executor.ts`: classify instant
  unavailability failures, exclude the executor for the run, emit trace events.
- [ ] P2. Implement latency-derived `timeoutMs` resolution with YAML hard cap and no-history
  fallback; record derived values in the trace.
- [ ] P3. Order post-failure ladder candidates by latency × success from `history_board_model_stats`.
- [ ] P4. Tests: dead-executor-first ladder performs zero repeat dispatches; slow-executor node
  derives a workable budget or fails over without burning the static timeout twice.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-11-10T16:31:02.654Z backlog → todo (system)

