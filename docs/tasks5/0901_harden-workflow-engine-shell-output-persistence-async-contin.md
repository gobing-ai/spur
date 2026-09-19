---
schema_version: 1
name: "Harden workflow engine: shell-output persistence, async continue, terminal-id guard (kk dogfood 091825)"
status: todo
template: standard
created_at: 2026-09-19T17:18:49.545Z
updated_at: "2026-09-19T19:58:34.716Z"

priority: P2
feature_id: D3
ac_altitude: task-local
estimate_hours: "6"
---

## 0901. Harden workflow engine: shell-output persistence, async continue, terminal-id guard (kk dogfood 091825)

### Background

Handoff from knowledge-kit task 0148, whose 2026-09-19 Q&A identifies Spur task 0901 as the owner of all six engine/CLI findings from dogfood-daily-091825. The upstream task and its 11,988-byte log exist; this audit verifies mechanisms against the current tree, not the historical run database. The original reports were terminal-id reuse appearing to no-op, interrupted continue leaving running rows, headless continue consuming a stale answer, no detached continue, missing shell diagnostics, and no resumed-session run log.

**Refine corrections (2026-09-19)**

1. Three-item Design excluded R2/R3/R6 → upstream 0148 explicitly hands all R1–R6 to 0901 → preserve six-item ownership and original requirement numbering; supersede the earlier Q&A scope exclusion.
2. Terminal-id reuse silently succeeds → engine 0.4.69 createRun throws RunCollisionError for duplicate IDs → R1 is early CLI refusal, actionable guidance, and consistent JSON, not a new engine collision mechanism.
3. Continue errors are bare stderr → workflow.ts already catches and calls writeJsonError → preserve that handler; only run lacks the local equivalent.
4. Shell output is never persisted → StreamingShellActionRunner emits workflow.action.output and fresh CLI runs already attach WorkflowRunLogSink → gaps are per-action DB output, trace projection, configured-secret handling, and the continue sink.
5. action.finished carries stdout/stderr → WorkflowActionFinishedEvent carries only a result error/usage summary → reuse action.output for logging; do not invent a second finished-output stream.
6. Trace automatically exposes result_json → projectActionTraceResult uses TRACE_RESULT_FIELDS, excluding stdout/stderr → explicitly design bounded shell-only trace fields and update the existing no-raw-output regression.
7. recordSelfPid on createEngineService is sufficient for continue → withSelfPidRecording only intercepts createRun/createOrAttachRun, while resumeRun calls finalizeRun(running) → resume ownership must be claimed at the resume boundary, not the creation hooks.
8. Existing async registration polling can be reused → waitForRunRegistration only checks that a row exists, which every paused run already has → detached continue needs an acknowledgement tied to the new resume attempt.
9. Killing continue can safely restore paused → both installed drivers skip current-state actions on resume, including an interrupted action if status alone is restored; SIGKILL cannot run cleanup → R2 is an unresolved recovery-contract decision, not a safe status/pid patch.
10. Installed spur is this checkout → PATH resolves to /Users/robin/node_modules/@gobing-ai/spur/spur.js → use bun run apps/cli/src/index.ts for this task's edits and gates; installed engine, root pin, and lockfile agree on 0.4.69.

Ready-depth result: **failed / review-pending**, despite a structurally complete task. R2 cannot be honestly frozen without choosing safe interruption/replay semantics. Status was already todo; retain it without claiming implementation readiness. Existing P2 and 6-hour estimate are preserved, not re-estimated for unresolved recovery scope.

### Requirements

All six upstream findings remain owned here. Requirement IDs retain their upstream meanings.

- [ ] R1. Reject existing run IDs before a run banner, async spawn, or plan/log mutation; name the ID and recommend a fresh --run-id. Preserve engine collision enforcement as the race backstop. Human, raw JSON and envelope errors must agree.
- [ ] R2. Recover interrupted continue without leaving a false live owner or silently skipping/replaying unfinished side effects. The requested paused/pid=NULL outcome requires a safe resume-point contract. **Blocked:** exact interruption classes and recovery semantics need the decision in Q&A; status-only restoration is forbidden.
- [ ] R3. Refuse CLI continue before resume mutation when no explicit gate answer is supplied in a headless invocation (non-TTY, JSON, or detached). Explain --answer yes|no|cancel. --yes only selects/confirms a run; it never answers a gate. Keep application-service callers that intentionally use persisted vars compatible.
- [ ] R4. Add workflow continue [run-id] --async using the existing worker launcher. Forward explicit answer and existing --force consent, validate the paused target, acknowledge the new resume attempt, and record the actual worker PID so cancel reaches it. Missing run-id discovery/confirmation keeps existing --yes semantics. Failed startup must not report started merely because the paused row exists.
- [ ] R5. Persist redacted bounded shell stdout/stderr in action_runs.result_json and expose bounded shell-only tails through trace. Preserve existing streaming log output and flat .spur/run/<runId>.log retention. No promise of full output after log caps, process death, or storage failure; truncation/failure must be visible.
- [ ] R6. Attach the existing consolidated log sink during continue, including its async worker, and close it in finally. Existing content remains intact, bounds cover the whole file across sessions, and trace --json remains the structured status source.

Non-goals: replay terminal runs, --force overwrite of existing IDs, arbitrary side-effect rollback, a new per-action directory layout, workflow YAML edits, non-shell payload exposure, or changing Superskill/generated adapters. R2 must not be silently dropped to satisfy these non-goals.

### Acceptance Criteria

- [ ] AC1 — Existing run IDs fail before launch (req: R1)
  Given an existing running, paused, done or failed row, when sync or async run reuses its ID, then it exits nonzero with that ID and a fresh-ID remedy, emits no started banner, and leaves row, plan and log unchanged. Exercise human, --json and --json-envelope in apps/cli/tests/commands/workflow.test.ts; retain engine/service duplicate-ID coverage.
- [ ] AC2 — Interrupted continuation has a safe recovery point (req: R2)
  Given a resumed workflow with a side-effecting action in progress, when its owner is interrupted, then recovery neither skips unfinished actions nor repeats completed side effects and never claims a dead owner is running. The originally requested paused/pid=NULL assertion is pending the Q&A decision. Required test layer: real worker subprocess plus migrated SQLite and action sentinel files, for both workflow dialects; a mocked continuePaused cannot prove this.
- [ ] AC3 — Headless continue requires an explicit answer (req: R3)
  Given a paused run and no --answer, when continue is invoked without a TTY, with JSON, or with --async, then it exits before resume/spawn and names --answer; status/snapshots/actions are unchanged. With yes, no or cancel, existing branch behavior remains observable; --yes alone is insufficient. Cover CLI tests and preserve service HITL tests.
- [ ] AC4 — Detached continue acknowledges its own worker (req: R4)
  Given a paused fixture and explicit answer, when continue --async runs, then it returns after a bounded worker acknowledgement and the worker completes after launcher exit. A sleeping fixture records the worker PID and cancel stops the worker/child; failed or competing startup cannot pass on the pre-existing row. Use actual subprocess integration in apps/cli/tests/commands/workflow.test.ts with isolated SQLite, bounded polling and finally cleanup.
- [ ] AC5 — Shell evidence survives completion safely (req: R5)
  Given success/failure shell actions on fresh and resumed runs in both dialects, when they emit stdout/stderr including configured secrets and oversized Unicode text, then DB evidence retains redacted UTF-8 tails of at most 65,536 bytes per stream, trace exposes those bounded shell fields, and truncation is explicit. Non-shell output remains excluded. Use real engine/SQLite in packages/app/tests/services/workflow-service.test.ts and CLI JSON coverage; do not mock the persistence/projection seams being tested.
- [ ] AC6 — Resumed sessions append within existing log bounds (req: R6)
  Given an existing run log, when continue emits action.output/progress, then it appends without truncating earlier sessions or duplicating finished-output blocks, and cumulative configured byte/line limits still apply. Unwritable logging remains best-effort. Cover packages/app/tests/observability/workflow-run-log-sink.test.ts and actual CLI continue integration.

### Q&A

#### Q&A entry — 2026-09-19 (ready-depth refine)

- **Q: Fix shell-output persistence in the engine's `defaultActionRedactor` instead?** Closed — **no**. The engine is a published package (`@gobing-ai/ts-dual-workflow-engine` 0.4.69) on a release train; spur already owns the injection seam (`deps.options.redactor ?? defaultActionRedactor`, `action-step.js:48`). A spur-side redactor fixes all workflows without an upstream release. Changing the engine default is a separate upstream decision.
- **Q: Where does output go — DB, sidecar files, or the run log?** Closed — two existing seams, no new storage surface. `action_runs.result_json` (capped, secret-redacted) for query/trace; `.spur/run/<runId>.log` via the existing `WorkflowRunLogSink` for human tail. No new `.spur/run/<id>/` directory layout — that would fork the `workflow clean` reclamation contract (task 0429 scans flat `<runId>.log`).
- **Q: Cap size configurable?** Closed — constant 64 KiB tail per stream. A value that never varies is a constant; revisit only if real post-mortems hit the cap.
- **Q: `--force` to re-run over a terminal id?** Closed — **no**. Terminal rows are evidence; overwriting them via flag defeats the guard's purpose. Fresh run-id is the retry contract; the R3 guidance message says so.
- **Q: Unfiled sibling findings (interrupted-continue paused restore, bare-continue non-TTY refusal, run-log attach on continue)?** Closed — confirmed real in this refine (mechanisms pinned: no signal handlers + pid never recorded on the continue path, `workflow-service.ts:1254`; headless gate default deny re-evaluated on resume, `default-responder.ts:5,16`; sink constructed only at `workflow.ts:826`) but they are **not filed as tasks**. They must get their own upstream filings; do not fold them into 0901 — the title scopes three findings.
- **Q: Feature placement — D3 was `done`, the DD-09 subset rule rejected the link.** Closed — reopened D3 to `active` (checker-sanctioned `spur feature update D3 active`): 0901 is a new workflow-run reliability defect batch arriving in D3's exact area, so reopening the feature is the honest parent, not a workaround. `ac_altitude: task-local` is set because 0901's scenarios come from an external dogfood filing (kk 0148) and are intentionally below D3's original ship criteria (schema resolution / shell interpolation / headless HITL) — per the verbs reference, task-local requires recorded rationale, which is this entry.

#### Q&A entry — 2026-09-19T19:58:32.959Z

**2026-09-19 audit — supersedes contradictory earlier answers.**

- Closed: task 0148 explicitly handed all six requirements to 0901. Title shorthand does not authorize deleting R2/R3/R6. No sibling task has been established as their owner.
- Closed: retain flat logs and the engine's caller-supplied ActionRedactor seam for R5; no upstream change is necessary merely to retain bounded output. A redactor alone does not change trace projection or log events.
- Closed: --force on continue already consents to definition drift; it is forwarded with its existing meaning, never repurposed for replay or duplicate-ID overwrite.
- Closed: R3 is a CLI admission rule, not a ban on service resumes with persisted vars. An explicit answer is required for headless CLI execution; --yes and automatic default approval are not substitutes for overriding a persisted answer.
- **Open / owner: Robin, workflow recovery policy.** R2's requested status restoration is unsafe with engine 0.4.69: resume skips current-state actions. Choose either (A) retain safe resumable interruption in scope and design/release an upstream engine checkpoint/interruption contract before freezing 0901, or (B) explicitly narrow R2 to fail interrupted runs with recovery guidance and require a fresh ID, accepting that this does not deliver paused restoration. SIGKILL/power loss require subsequent reconciliation, not signal cleanup. Recommendation: A if preserving expensive prior stages is the goal. This auto refine cannot silently weaken the handed-off acceptance criterion or invent exactly-once side-effect semantics.

### Design

**Readiness: review-pending. R1/R3/R4/R5/R6 direction is pinned below; R2 prevents an implement-ready freeze. Do not start implementation from this spec until its open decision is resolved.**

#### R1 — CLI refusal

In apps/cli/src/commands/workflow.ts, perform an existing-row check after validateRunId and before either branch writes plan/log/banner or launches a worker. Reuse trace/RunDao through the application boundary; only a genuine not-found is absence, never swallow arbitrary DB failures. Keep the engine createRun collision check authoritative under races. Catch execution collision through writeJsonError and preserve raw/enveloped conventions. Do not add a force-overwrite flag or reject engine external-key attach semantics globally.

#### R2 — recovery seam, blocked

Installed engine service.js resumeRun changes paused to running, restores state/vars, then both drivers resume with skip-on-enter. A snapshot records a state before all its actions necessarily finish. Therefore a CLI signal handler that merely restores paused and clears pid creates a false safe checkpoint. Rolling back to the pre-attach snapshot can instead repeat later side effects. The engine exposes no AbortSignal/resume-cursor contract in WorkflowRunOptions. SIGKILL cannot run a handler. Safe interruption belongs at the released engine facade, with downstream Spur integration after the upstream contract exists; do not patch node_modules or build a competing Spur execution loop. Scope/behavior must be decided before designing the dependency and runnable recovery acceptance test.

#### R3/R4 — CLI admission and detached resume

Keep the existing continue verb and add only --async. Perform answer/TTY/JSON validation, target selection and paused validation before mutation. Reuse spawnAsyncWorkflowWorker; worker argv is workflow continue <id> --yes --answer <value>, forwarding --force and JSON mode as needed, never --async recursively. SPUR_ASYNC_WORKER=1 identifies the child. Do not read CLI environment inside WorkflowAppService: add a typed recordSelfPid option to continuePaused and pass it explicitly from the CLI.

A pre-existing paused row is not startup acknowledgement. The implementation must use an attempt identifier carried to the worker and persisted with its resume ownership claim; names and claim/cleanup protocol must be finalized together with R2, including concurrent continues and terminal-before-poll behavior. withSelfPidRecording's creation hooks cannot perform this claim. Record PID at the actual resume mutation, clear only the matching owner's PID on exit, and never overwrite terminal cancellation with paused. Preserve recorded definition source/workdir, digest/--force checks and HITL vars. Existing nohup launcher comments claim process-group leadership but its code does not itself establish setsid: real subprocess tests must prove descendant cancellation; do not treat the comment as evidence.

#### R5 — bounded evidence on existing seams

Pass a shared Spur ActionRedactor through both svc.run and svc.resumeRun options in packages/app/src/services/workflow-service.ts (not constructor-only options). For shell result.data.stdout/stderr only, redact configured secretValues and existing secret patterns before taking a UTF-8-safe 65,536-byte tail. Reuse redactAndBound with an unbounded intermediate redaction limit, then apply the byte tail; add stdoutTruncated/stderrTruncated booleans. Non-shell handling remains unchanged. Do not slice first, which can leave a partial configured secret. The engine finalize write is fire-and-forget/best-effort; tests must wait for the persisted action result rather than assume immediate DB visibility on run return.

projectActionTraceResult currently allows only selected scalar metadata. Add explicit shell-only stdoutTail/stderrTail and stdoutTruncated/stderrTruncated projection, preserving bounds and secret filtering; do not widen every action kind or run these tails through the current 256-character metadata limit. Keep existing trace transport types scalar-compatible. Update the existing test that intentionally excludes raw output to continue excluding non-shell payloads.

Fresh CLI logs already receive workflow.action.output; action.finished has no streams. Keep that stream instead of appending duplicate finish blocks. StreamingShellActionRunner currently uses pattern-only bounded(chunk): thread configured secrets through builtins and reuse/refactor the existing streaming redaction mechanism in observability/agent-execution.ts so a configured secret split across chunks cannot leak into logs or the system-event ledger. Cover this at the emission boundary, not only the file sink. No new output directory or cleanup scanner.

#### R6 — continue logging

Construct WorkflowRunLogSink on the continue bus for the resolved run ID and recorded launch workdir, using resolveRunLogConfig; close in existing finally alongside ledger/quota flushing. Add a resumed-session marker using the existing resumed lifecycle event if needed. Initialize existing byte/line counts before appending, and preserve truncation semantics across reopened sessions. Existing flat retention and best-effort failure behavior remain authoritative.

#### Owners, environment and scope

Targets: apps/cli/src/commands/workflow.ts; packages/app/src/services/workflow-service.ts; packages/app/src/workflow/actions/shell.ts and builtins.ts; packages/app/src/observability/{agent-execution,workflow-run-log-sink}.ts; corresponding existing tests. Any resume claim DAO change belongs in packages/domain, not CLI SQL. No migration is selected before R2 resolution.

Document changed CLI behavior in docs/design/cli-contracts.md and the facade plugins/sp/skills/spur-cli/references/workflows.md; output/retention behavior belongs in docs/design/workflow-run-log.md and workflow-observability.md. Update the docs/04_DESIGN.md command index only where its signature changes, under sp-doc-evolve and the constitution. No workflow YAML or generated adapter edits.

Audit environment: clean tree at b6ebe7fe2 on entry; git worktree list shows only this checkout; task list --status wip returned empty. The active-folder task listing found no other unfinished workflow task owning these fixes; this is not a claim about external repositories. D3 is active and ac_altitude remains task-local, reflecting the dogfood scenarios. No dependencies currently declared; the upstream recovery dependency is unresolved and must be registered through spur task deps after its contract/owner exists. Installed dependency and lockfile both resolve engine 0.4.69. PATH spur is an external install: use the source-local CLI for gates, then link/build:bundle only after actual CLI implementation.

### Plan

1. [ ] Resolve R2 in Q&A before implementation; freeze safe interruption classes, resume-point/side-effect semantics and concurrent ownership rules. If an upstream engine change is selected, record its concrete task/release dependency through spur task deps and re-run ready refine. Do not substitute paused-row surgery.
2. [ ] R1/R3: add early run-ID/headless-continue admission with existing JSON errors; test no launch/artifact/DB changes on refusal and explicit yes/no/cancel compatibility.
3. [ ] R5: thread the same secret-aware bounded shell redactor to run and resume, add shell-only trace projection, and cover real engine/SQLite success/failure, both dialects, Unicode and truncation. Reuse streaming redaction at the shell event emitter and prove split-secret safety.
4. [ ] R2/R4: implement the resolved recovery/ownership contract, attempt-specific detached acknowledgement, worker PID cleanup, flag forwarding and actual process-tree cancellation. Test real isolated subprocesses, fast terminal completion, startup failure, concurrent resume, and interruption at a side-effecting action.
5. [ ] R6: attach the existing sink to continue, preserve cumulative file bounds and test log append, unavailable disk and truncation across sessions.
6. [ ] Update owning docs/facade and applicable CLI parity coverage. Run focused workspace tests, then bun run spur-check; run feature gate once at feature completion. After CLI edits run bun link in apps/cli and bun run --filter @gobing-ai/spur build:bundle. Verify source/bundle provenance before any real-data dogfood; never repair live DB rows during tests.

Refine verification already performed: nine focused workflow-service tests passed (39 assertions), covering trace allowlisting, explicit HITL answers, later-gate isolation and non-duplication across normal pause/resume. These establish existing behavior, not implementation of this task. No production code changed by refine.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Upstream handoff: /Users/robin/xprojects/knowledge-kit/docs/tasks/0148_fix-workflow-engine-and-daily-pipeline-gaps-from-091825-live.md, Requirements R1–R6 and 2026-09-19T17:33 Q&A; stale source path in older prose is superseded by spur-new.
- Historical artifact existence: /Users/robin/xprojects/knowledge-kit/.spur/run/dogfood-daily-091825.log (11,988 bytes); historical DB and original reproductions were not rerun.
- node_modules/@gobing-ai/ts-dual-workflow-engine/dist/persistence.js: defaultActionRedactor/createRun; action-step.js: saveActionFinalize uses per-run redactor, fire-and-forget; service.js: resumeRun; state-machine.js:39 and transition-flow.js:43: resume skips current actions; types.d.ts: WorkflowRunOptions.
- packages/app/src/services/workflow-service.ts:135 withSelfPidRecording, 1074 continuePaused, 1246 createEngineService call, 2402 TRACE_RESULT_FIELDS, 2472 projectActionTraceResult.
- packages/app/src/workflow/actions/shell.ts: StreamingShellActionRunner; packages/app/src/workflow/observability.ts:98 WorkflowActionFinishedEvent and :543 saveActionFinalize projection.
- packages/app/src/observability/workflow-run-log-sink.ts: append-mode action.output subscriber and per-instance counters; packages/app/src/observability/agent-execution.ts:338 redactAndBound and streaming secret carry.
- apps/cli/src/commands/workflow.ts:99 spawnAsyncWorkflowWorker, :213 waitForRunRegistration, :826 run sink, :972 continue registration, :1047 continue call and JSON catch.
- packages/app/tests/services/workflow-service.test.ts:1039 trace privacy contract, :1192 HITL answers, :1665 resume side effects; apps/cli/tests/commands/workflow.test.ts; packages/app/tests/observability/workflow-run-log-sink.test.ts.
- Readiness evidence: source-local task check; git worktree list (only main at b6ebe7fe2); no wip tasks returned; D3 active. No implementation, pipeline verdict or all-repo gate is claimed.

### History

- 2026-09-19T17:29:25.928Z backlog → todo (system)

