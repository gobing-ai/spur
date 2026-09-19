---
schema_version: 1
name: "Harden workflow engine: shell-output persistence, async continue, terminal-id guard (kk dogfood 091825)"
status: todo
template: standard
created_at: 2026-09-19T17:18:49.545Z
updated_at: "2026-09-19T17:33:35.029Z"

priority: P2
feature_id: D3
ac_altitude: task-local
estimate_hours: "6"
---

## 0901. Harden workflow engine: shell-output persistence, async continue, terminal-id guard (kk dogfood 091825)

### Background

Handoff from knowledge-kit task 0148 (Sep 19, 2026 live dogfood of the kk-daily-ai-voice workflow, run dogfood-daily-091825). Six engine gaps surfaced; reproductions recorded there. Symptoms, in the order hit:

1. Re-running `spur workflow run` with a terminal run-id silently no-ops (looked like a hang).
2. A `workflow continue` attach killed mid-run leaves the DB row `running` with a dead pid; recovery needed manual DB surgery (`status='paused', pid=NULL`).
3. Bare `workflow continue` on a non-TTY (nohup context) attaches with no answer source, fails the run, leaves it `running`.
4. No detached-resume flag exists; every retry needed a fresh `--run-id` plus manual nohup.
5. Shell-action stdout/stderr are never persisted — diagnosing a failed step means re-running blind.
6. The run log freezes at first attach; continued sessions are invisible in it (only `spur workflow trace --json` shows liveness).

Background narrative: kk pipeline runs depend on reliable continue/observability semantics; until R5 lands, every pipeline failure costs 10+ minutes of blind re-diagnosis; the kk project keeps a cross-reference in task 0148 Q&A.

### Requirements

- [ ] R1. `workflow run` with an existing terminal run-id silently no-ops; must fail loud or require an explicit override flag.
- [ ] R2. `workflow continue` interrupted mid-attach leaves the run marked `running` with a dead pid instead of restoring `paused` (runs table has only status/pid columns).
- [ ] R3. `workflow continue` without an answer source on non-TTY attaches, fails the run, and leaves it `running`; must refuse pre-attach with guidance.
- [ ] R4. No detached resume: `workflow continue --async` does not exist; the workaround is manual nohup-detach.
- [ ] R5. Shell-action stdout/stderr are discarded (only onEnter logs survive); persist each action's output under the run dir (e.g. `.spur/run/<id>/<state>-<seq>.log`) and reference it from trace events. Highest value — every retry cost 10+ min of blind diagnosis.
- [ ] R6. Continued sessions never append to the run log (frozen at first attach); either append per-session or document `trace --json` as the liveness source.

### Acceptance Criteria

- [ ] A1 (R1): a second `workflow run` with a terminal run-id exits non-zero with a clear message naming the existing run.
- [ ] A2 (R2): killing the continue attach leaves `status='paused'`, `pid=NULL` in the runs table.
- [ ] A3 (R3): bare `workflow continue` on non-TTY exits non-zero before attaching, printing the flag to supply.
- [ ] A4 (R4): `workflow continue --async <run-id>` returns immediately; run proceeds detached and reaches terminal state.
- [ ] A5 (R5): after any run, each shell action has a log file under the run dir and trace events carry its path.
- [ ] A6 (R6): after continue, the run log grows (or trace is documented + verified as the liveness contract in `spur workflow --help`).

### Q&A

#### Q&A entry — 2026-09-19 (ready-depth refine)

- **Q: Fix shell-output persistence in the engine's `defaultActionRedactor` instead?** Closed — **no**. The engine is a published package (`@gobing-ai/ts-dual-workflow-engine` 0.4.69) on a release train; spur already owns the injection seam (`deps.options.redactor ?? defaultActionRedactor`, `action-step.js:48`). A spur-side redactor fixes all workflows without an upstream release. Changing the engine default is a separate upstream decision.
- **Q: Where does output go — DB, sidecar files, or the run log?** Closed — two existing seams, no new storage surface. `action_runs.result_json` (capped, secret-redacted) for query/trace; `.spur/run/<runId>.log` via the existing `WorkflowRunLogSink` for human tail. No new `.spur/run/<id>/` directory layout — that would fork the `workflow clean` reclamation contract (task 0429 scans flat `<runId>.log`).
- **Q: Cap size configurable?** Closed — constant 64 KiB tail per stream. A value that never varies is a constant; revisit only if real post-mortems hit the cap.
- **Q: `--force` to re-run over a terminal id?** Closed — **no**. Terminal rows are evidence; overwriting them via flag defeats the guard's purpose. Fresh run-id is the retry contract; the R3 guidance message says so.
- **Q: Unfiled sibling findings (interrupted-continue paused restore, bare-continue non-TTY refusal, run-log attach on continue)?** Closed — confirmed real in this refine (mechanisms pinned: no signal handlers + pid never recorded on the continue path, `workflow-service.ts:1254`; headless gate default deny re-evaluated on resume, `default-responder.ts:5,16`; sink constructed only at `workflow.ts:826`) but they are **not filed as tasks**. They must get their own upstream filings; do not fold them into 0901 — the title scopes three findings.
- **Q: Feature placement — D3 was `done`, the DD-09 subset rule rejected the link.** Closed — reopened D3 to `active` (checker-sanctioned `spur feature update D3 active`): 0901 is a new workflow-run reliability defect batch arriving in D3's exact area, so reopening the feature is the honest parent, not a workaround. `ac_altitude: task-local` is set because 0901's scenarios come from an external dogfood filing (kk 0148) and are intentionally below D3's original ship criteria (schema resolution / shell interpolation / headless HITL) — per the verbs reference, task-local requires recorded rationale, which is this entry.

### Design

**Chosen approach — three surgical changes, all on seams spur already owns:**

1. **R1 shell output.** `createEngineService` (`packages/app/src/services/workflow-service.ts:1616+` persistence decoration block) gains a spur redactor passed through run/continue options into the engine: secret redaction (reuse the existing redaction utility) plus per-stream tail cap (64 KiB constant) — `stdout`/`stderr` survive into `result_json` instead of `'[redacted]'`. `WorkflowRunLogSink` (`packages/app/src/observability/workflow-run-log-sink.ts`) subscribes to `workflow.action.finished` and, for shell actions whose event carries output, appends a capped stdout/stderr block under a `## action <node>` header. Trace already reads `result_json` (`packages/domain/src/dao/action-run-dao.ts:39`).
2. **R2 async continue.** Mirror the `run --async` detached-worker block (`apps/cli/src/commands/workflow.ts:474+`, `:557` pid contract): add `--async` to the continue command, spawn the worker with `SPUR_ASYNC_WORKER=1` invoking the same `continuePaused` path, pass `--answer` through. In `continuePaused`, thread `recordSelfPid: getEnvVar('SPUR_ASYNC_WORKER') === '1'` into its `createEngineService` call (`workflow-service.ts:1254`) so `workflow cancel` reaches a detached continue.
3. **R3 guard structuring.** The collision surfaces as `RunCollisionError` (engine) and the continue refusal as its not-paused error; both currently escape as bare stderr with no envelope. Route them through the CLI's existing structured error envelope path (same shape other `--json` failures use), append the remedy line to the human message. Print the `Run:`/plan banner only after the guard passes so a refused start doesn't look like a started run.

**Invariants:** terminal run rows are immutable (no force-overwrite); flat `.spur/run/<runId>.log` layout unchanged; engine package untouched; sync continue behavior byte-identical when `--async` is absent.

**Impacted surfaces:** `apps/cli/src/commands/workflow.ts` (options, async worker, error path, banner ordering), `packages/app/src/services/workflow-service.ts` (redactor threading, `recordSelfPid` on continue), `packages/app/src/observability/workflow-run-log-sink.ts` (output blocks). No schema changes; `docs/04_DESIGN.md` satellite update in the same commit (T3) for the continue `--async` surface.

### Plan

1. Thread a spur shell-output redactor (secret redact + 64 KiB tail cap) through `createEngineService` into engine options; unit-test `result_json` keeps capped output for a failing shell action.
2. Extend `WorkflowRunLogSink` with capped stdout/stderr blocks on shell `workflow.action.finished`; test append + cap against a stubbed bus.
3. Add `--async` to `workflow continue`; reuse the run detached-worker spawn; thread `recordSelfPid` in `continuePaused`; test: detached continue resumes a paused fixture, prints run id, `cancel` signals the recorded pid.
4. Route collision / not-paused errors through the structured envelope; move banner print after the guard; test `--json` stdout carries the error and human mode names the remedy (dry-run repro against an existing terminal run id).
5. Update the `docs/04_DESIGN.md` workflow satellite for `continue --async` (same commit).
6. `bun run spur-check`; manual: full dogfood-style repro — failing shell workflow run → evidence in `.spur/run/<id>.log` + `trace --json`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- kk task 0148 — `/Users/robin/xprojects/knowledge-kit/docs/tasks/0148_fix-workflow-engine-and-daily-pipeline-gaps-from-091825-live.md` (upstream R1/R4/R5 definitions; note its References path `/Users/robin/xprojects/spur` is stale — source of truth is spur-new)
- Dogfood log — `.spur/run/dogfood-daily-091825.log` (kk workspace)
- Engine seam: `node_modules/@gobing-ai/ts-dual-workflow-engine/dist/action-step.js:48` (`deps.options.redactor`), `persistence.js:25-30` (default redactor), `errors.js:20` (`RunCollisionError`)
- Spur surfaces: `apps/cli/src/commands/workflow.ts:474` (run `--async`), `:826` (sink), `:972` (continue options); `packages/app/src/services/workflow-service.ts:1254` (continue service wiring), `:1616+` (persistence decoration); `packages/app/src/observability/workflow-run-log-sink.ts`
- Retention contract: task 0426 (run log), task 0429 (clean reclamation)

### History

- 2026-09-19T17:29:25.928Z backlog → todo (system)

