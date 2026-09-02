---
schema_version: 1
name: "Configurable scheduler jobs (interval + real cron) in ts-libs adapter and spur serve"
status: backlog
template: standard
created_at: 2026-09-02T06:54:51.770Z
updated_at: "2026-09-02T06:56:49.945Z"
---

## 0734. Configurable scheduler jobs (interval + real cron) in ts-libs adapter and spur serve

### Background

The board's automatic history refresh works, but scheduling in this codebase is hardcoded: `apps/server/src/serve.ts:registerSchedulerEntries` registers three built-in entries (system-events prune, smoke, history refresh), and only the history one is config-driven (`history.refresh.schedule_minutes`). The upstream adapter `@gobing-ai/ts-infra` `NodeSchedulerAdapter` accepts only three schedule forms (`"60000"` ms, `"* * * * *"`, `"*/N * * * *"`) — `parseInterval` hard-errors on real cron field expressions (`"0 9 * * 1"`) by design (ts-libs task 0060 F7), so time-of-day schedules are impossible today.

Robin wants to define arbitrary recurring jobs in project config, e.g.:

```yaml
scheduler:
  jobs:
    - name: cache-efficiency
      intervalMinutes: 5
    - name: nightly-rollup
      cron: "0 3 * * *"
      command: python tools/rollup.py
```

Two layers must change: upstream `ts-libs` (real cron parsing in the adapter) and this repo (config schema + registration loop + child-process job runner). Upstream lands first; this repo consumes it via the workspace catalog.

### Requirements

- **R1 (ts-libs)**: `NodeSchedulerAdapter.register()` accepts full 5-field cron expressions (minute hour dom month dow) supporting `*`, `*/N`, lists (`0,30`), ranges (`1-5`), and plain numbers; interval forms keep working unchanged; unsupported expressions still throw at registration time, never silently misfire (preserve ts-libs 0060 F7 semantics).
- **R2 (ts-libs)**: cron-scheduled entries fire at correct wall-clock times (recompute next fire from current time after each run — no fixed-offset drift), and `stop()` drains an in-flight cron tick the same way it drains interval ticks (ADR-024 contract).
- **R3 (spur config)**: `packages/config` adds a `scheduler.jobs` section: array of `{ name, command, intervalMinutes? | cron? }` — `name` unique, `command` non-empty, exactly one of `intervalMinutes` / `cron` per job; schema-validated with actionable error messages.
- **R4 (spur serve)**: `registerSchedulerEntries` registers one adapter entry per configured job whose tick enqueues a generic `scheduler.custom` queue job (`{ name, command }` payload); the job handler executes `command` as an isolated child process in the project root via `ProcessExecutor`, reusing the history-refresh child contract (bounded output, exit-code-as-verdict, no `--json` envelope parsing).
- **R5 (observability)**: every scheduler tick and job attempt flows through the existing event paths (`scheduler.job.executed`, `queue.job.*`) so runs stay visible in the System Events tab without new instrumentation.
- **R6 (docs, T3)**: `docs/04_DESIGN.md` documents the `scheduler.jobs` surface in the same commit as the surface code; ts-libs side follows ts-libs' own docs/verify gates.

### Acceptance Criteria

- **AC1 (R1)**: Given cron `"*/5 * * * *"`, `"0 3 * * *"`, `"30 8 1,15 * 1-5"`, registration succeeds; given `"* 3 * * *"` (partial wildcard) or `"0 25 * * *"` (invalid field), registration throws `RangeError`.
- **AC2 (R2)**: Given a cron entry `"0 * * * *"` and an injectable clock, ticks fire within the correct minute across a simulated 25h window including one DST transition; `stop()` with an in-flight tick resolves within `drainTimeoutMs`.
- **AC3 (R3)**: Valid config parses; duplicate `name`, missing `command`, both/neither of `intervalMinutes`+`cron`, or invalid cron syntax each fail schema validation with a message naming the offending job.
- **AC4 (R4)**: With one configured job whose command is `bun -e "process.exit(0)"`, a serve scheduler tick enqueues `scheduler.custom`, the handler runs the child, and the queue job reaches `completed`; a failing command reaches `failed`/retry with the child's stderr tail as `last_error`.
- **AC5 (R5)**: After AC4, `system_events` contains both the `scheduler.job.executed` event and the `queue.job.*` lifecycle events for the custom run.
- **AC6 (R6)**: `docs/04_DESIGN.md` contains the `scheduler.jobs` schema and semantics; `bun run spur-check` passes in this repo and ts-libs' equivalent gate passes with tests green.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

- **ts-libs** (`packages/infra/src/scheduler/node.ts`): keep `parseInterval` for the three supported interval forms; a 5-field expression that is not one of those forms is classified as a real cron entry instead of throwing. `ScheduledEntry` becomes a discriminated union (`kind: 'interval'` with `setInterval` timer | `kind: 'cron'` with self-rescheduling `setTimeout` chain); `startEntry`/`stop` branch per kind. Cron matching uses a small local parser (5 fields, `*`, `*/N`, lists, ranges; stdlib `Date` only, no new dependency, ~80 lines). Register-time validation reuses the same parser in validate-only mode so unsupported syntax still throws at `register()` (0060 F7 invariant). Export the parser so spur can reuse it for config validation.
- **spur** (`packages/config`, `apps/server/src/serve.ts`): `scheduler.jobs` Zod schema with `.superRefine` one-of check and cron-syntax validation via the exported ts-infra parser. `registerSchedulerEntries` loops configured jobs after the history-refresh block; each tick enqueues type `scheduler.custom` with `{ name, command }` payload — plain non-coalesced enqueue is correct here (every tick is a real execution, unlike history refresh's debounce burst). Handler mirrors `handleHistoryRefreshJob` (`packages/app/src/services/history-refresh-service.ts`): split launch command, child run with bounded output, exit-code verdict, stderr tail as failure detail.
- **YAGNI**: no per-job `enabled` flag (deleting it from config is the off switch), no per-job `cwd` (runs in project root like the history child), no new run-history table beyond `system_events` (already proven sufficient — the 0734-predecessor investigation ran entirely off `queue_jobs` + `system_events`).
- **Sequencing**: ts-libs change lands first on its own branch/gates; spur then consumes via `workspaces.catalog` bump and implements the spur side in one conventional-commit series on `feat/scheduler-jobs`.

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Upstream repo: `~/xprojects/ts-libs` (`@gobing-ai/ts-infra`, `packages/infra/src/scheduler/node.ts`, `parseInterval`).
- Downstream wiring: `apps/server/src/serve.ts:registerSchedulerEntries` (built-ins + history-refresh precedent), job registry at `serve.ts:483-495`, child-process contract `packages/app/src/services/history-refresh-service.ts:handleHistoryRefreshJob`.
- Config precedent: `history.refresh` block in `packages/config/src/index.ts` (~line 770) and `.spur/config.yaml:220`.
- Constraints inherited: ts-libs ADR-024 (stop drain), ts-libs task 0060 F7 (no silent misfire), spur ADR-082 (config threading).

### History
