---
schema_version: 1
name: "Workflow run registration: reported run ids must be queryable"
status: todo
template: feature-impl
created_at: 2026-10-03T03:01:26.649Z
updated_at: "2026-10-03T03:18:46.337Z"
feature_id: D3

---

## 1064. Workflow run registration: reported run ids must be queryable

### Background

**Symptom chain (2026-10-02, 1061 wrap-up session):**

1. Synchronous invocation of `spur workflow run wrapup-pipeline.yaml` (no `--no-plan`) silently produced nothing observable, but left an empty run log `.spur/memory/runs/095fb377-5e99-4824-b9e5-909b77f13fc6.md` (operator removed it manually — no in-tool cleanup exists).
2. A `--no-plan` re-run of the same command worked end to end (run `3f3e8ffc-21bd-46ed-81ff-56fab9d6bbaf`, wrap PASS).
3. Post-session review: `spur workflow trace 095fb377-5e99-4824-b9e5-909b77f13fc6` → `Run not found` (re-verified read-only 2026-10-02). The CLI emitted/derived a run identity that no store row backs — provenance, `--next` chains, and resume for that invocation are all broken, silently.

**Counterpart evidence the adjacent paths are healthy:** executor-failure run `8e41fcca` produced a proper terminal `failed` row (`outcome=failure`, exit 3, actionable error + artifact paths), so agent.run failure handling works; the defect is specifically run-row creation vs id/log emission on the sync invocation path.

**Code anchors (observed 2026-10-02):**

- `packages/app/src/services/workflow-service.ts:159-182` and `:254-256` — persistence proxies around `createRun` / `createOrAttachRun` ("row the instant the engine creates it").
- `packages/app/src/services/workflow-service.ts:1752` — trace resolution: `if (!row) throw new Error(\`Run not found: ${runId}\`)`.
- `packages/app/src/observability/workflow-run-log-sink.ts:47-57` — writes `.spur/memory/runs/<RUNID>.md` + `<RUNID>.state.json`; comment states a failing sink "degrades the record, never the run" (deliberately non-fatal).
- `packages/app/src/workflow/action-trace.ts:419` — emission-failure recorder appending to `.spur/memory/runs/<runId>.log`.

**Hypotheses (unconfirmed — P1 must confirm before fixing):**

- H1: the log sink created the file while persistence `createRun` never ran on the sync (default plan) path — the deliberate non-fatal sink design (`workflow-run-log-sink.ts:57`) means a sink-without-row state is reachable and nothing reconciles it.
- H2: the sync invocation aborted between id allocation/log creation and row insert, with the error swallowed by plan resolution (the `--no-plan` rerun bypassing the failing branch supports this).
- H3 (ruled out): caller-side invented id — the log file naming requires a run id generated inside the CLI.

**Constraints and non-goals:**

- No behavior change to `--async`, `--plan`, resume, trace, or per-run log contracts (R3; D1/D2).
- No new public noun/verb (public-surface consent rule); fix lives inside the existing workflow noun.
- Root-cause fix only: do NOT "fix" by suppressing log creation or deleting orphan artifacts at trace time.
- Any new user-facing error text follows the ADR-091 envelope (single line + "Next:" hint, as seen in the `8e41fcca` trace row).

### Requirements

- R1. A workflow invocation must never return (or print) a run id that `spur workflow trace` cannot resolve: the run row must be durably created before the id reaches the caller or any log/state artifact is written (write-ahead ordering), for sync and async paths alike.
- R2. When run-row creation fails, the CLI exits nonzero with an actionable ADR-091-envelope error naming the failure, emits no orphan id, and removes any partially created `.spur/memory/runs/<id>.*` artifact for the aborted run.
- R3. No behavior change for already-working paths: `--async`, `--plan`, resume, trace, and per-run run-log contracts (D1/D2) stay as-is; the log sink's "degrade the record, never the run" design is preserved for post-row disk failures.
- R4. Directory invariant: a `.spur/memory/runs/<id>.md`, `<id>.state.json`, or `<id>.log` may exist only while a queryable run row exists; row insert happens first, sink init second.

### Acceptance Criteria

<!-- See docs/04_DESIGN.md "Task AC guidance". -->
- [ ] AC1. Given a sync workflow invocation whose run-row creation fails, when the CLI returns, then it exits nonzero, prints no run id, and leaves no empty run log (failure injection in a test).
- [ ] AC2. Given every successful invocation, when the reported run id is passed to `spur workflow trace <id>`, then the row resolves (regression test covers the sync path that previously printed `095fb377…` and later returned "Run not found").
- [ ] AC3. Given existing `--async`/`--plan`/resume flows, when the full `bun run spur-check` gate runs, then all existing workflow tests pass unchanged.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

- [ ] P1. Trace the sync `workflow run` path (default, no `--no-plan`): find where the run id is allocated, where the log sink initializes (`packages/app/src/observability/workflow-run-log-sink.ts`), and where persistence `createRun`/`createOrAttachRun` is invoked (`packages/app/src/services/workflow-service.ts:159-182`, `:254-256`). Identify the early-return or swallowed error that can skip the insert while the id/log already exist. Confirm/kill H1–H2 from Background with a repro before touching code.
- [ ] P2. Failing-first regression tests in `packages/app` (in-memory SQLite; fault-inject persistence `createRun`): (a) AC1 — invocation exits nonzero, prints no run id, leaves no `.spur/memory/runs/<id>.*` artifact; (b) AC2 — every run id emitted on the sync path resolves via the trace lookup (`workflow-service.ts:1752` path), covering the previous `095fb377…`-style orphan.
- [ ] P3. Fix: reorder to write-ahead row creation (R1/R4), add the R2 failure path (error + artifact cleanup), then run focused tests and `bun run spur-check`. Manual probe: one sync invocation (default plan path) then `spur workflow trace <id>` resolves; repeat with `--no-plan` to confirm both paths intact.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History

- 2026-10-03T03:18:46.337Z backlog → todo (system)

