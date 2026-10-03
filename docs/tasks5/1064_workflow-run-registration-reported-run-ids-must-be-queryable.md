---
schema_version: 1
name: "Workflow run registration: reported run ids must be queryable"
status: done
template: feature-impl
created_at: 2026-10-03T03:01:26.649Z
updated_at: "2026-10-03T04:28:31.411Z"
feature_id: D3

ac_altitude: task-local
done_forced: "false"
done_reason: unforced close; PASS artifact at /Users/robin/xprojects/spur-new-run-1064-b02a/.spur/memory/evidence/1064-verdict.json
---

## 1064. Workflow run registration: reported run ids must be queryable

### Background

**Symptom (2026-10-02, 1061 wrap-up session):** a sync `spur workflow run wrapup-pipeline.yaml` produced nothing useful but left an empty `.spur/memory/runs/095fb377-5e99-4824-b9e5-909b77f13fc6.md`; `spur workflow trace 095fb377…` → `Run not found`. A later `--no-plan` rerun (`3f3e8ffc…`) succeeded.

**Re-verification (2026-10-02, refinement): defect CONFIRMED, root cause found, and it recurs.**

- A second orphan already exists: `.spur/memory/runs/39d39982-4729-4a6e-a63b-39dd5d0a2888.md` (0 bytes, no `.state.json`, 15:35 local, next to the successful `a9b42460` wrapup run). `spur workflow trace 39d39982…` → `Run not found`, with zero rows in `runs` and zero `system_events`. (Left in place for the operator.)
- Deterministic repro, with no actions run: `spur workflow run wrapup-pipeline.yaml --vars '{"profile":""}'` prints `Run: <id>` plus the plan, then fails with `--vars leaves declared vars unset: profile` (exit 1). It leaves an empty `<id>.md`, and `spur workflow trace <id>` → `Run not found`. `--no-plan` gives the same orphan. `--json` prints no id but still leaves the empty `.md`. (Repro files were removed afterward.)

**Root cause:** the sync CLI path makes two run-id side effects before the run row exists.

1. `apps/cli/src/commands/workflow.ts:896-906` constructs `WorkflowRunLogSink`, whose constructor eagerly runs `openSync(<id>.md, 'a')` (`packages/app/src/observability/workflow-run-log-sink.ts:101-107`). That creates the empty file right away.
2. `apps/cli/src/commands/workflow.ts:912` prints `Run: ${runId}` (human mode) before `svc.run()` is called (`:1005`).

The row is created only later, inside the engine (`RunLifecycle.run` → `persistence.createRun`, which is the engine's first act; see `ts-dual-workflow-engine/src/run-lifecycle.ts:156`). Every Spur step in between can throw or be killed, and then an id/log exists with no row. Those steps are:

- `WorkflowAppService.run` pre-engine work (`packages/app/src/services/workflow-service.ts:697-761`): `createEngineService` (agent-config reload, `registerSpurBuiltins`, `loadWorkflowExtensions`, `getDb`) and `mergeWorkflowRunVars` (`:2214`, which throws on blanked declared vars, 0948 R2).
- CLI-side `makeEscalationPacketSink` / steering setup.
- A process kill (timeout or Ctrl-C) during that window.

**Hypothesis disposition:**

- H1 (sink before row): CONFIRMED.
- H2 (plan resolution swallowing the error): KILLED, because `--no-plan` orphans identically. The `3f3e8ffc` success was a different invocation, not a path difference.
- H3 (caller-invented id): KILLED.

The exact pre-engine throw for `095fb377` is unrecoverable: no events were persisted. The fix closes the whole window regardless of which step threw.

**Correct ordering signal:** `ObservableWorkflowAdapter.createRun` (`packages/app/src/workflow/observability.ts:463-470`) awaits the inner `createRun`, including the identity/pid stamping proxies (`workflow-service.ts:174-256`), before it emits `workflow.run.started`. That event therefore marks "row committed".

**Already-correct adjacent paths (no change):**

- The `--async` launcher refuses to print an id until `waitForRunRegistration` sees the row (0484 R2, `workflow.ts:695-720`). The worker runs the same sync path, so fixing the sync path covers it.
- `WorkflowTraceWriter` (`packages/app/src/workflow/trace-writer.ts`) is lazy: it writes only on bus events.
- The `<id>.log` emission-failure recorder (`packages/app/src/workflow/action-trace.ts:419`) writes only for post-row action emissions.
- Executor-failure run `8e41fcca` finalized correctly.

**Correction to the original draft:** ADR-091 is the `--json` contracts-envelope ADR. It is not a "single line + Next: hint" rule. Errors here keep the existing CLI error path: a thrown message, exit 1, and the `--json` error shape unchanged.

### Requirements

- [x] R1. The sync `spur workflow run` path (also used by the `--async` worker) must not print `Run: <id>` until the run row is committed, as signalled by `workflow.run.started`. The plan preview stays printed directly after that header.
- [x] R2. `WorkflowRunLogSink` must not create `<id>.md` (or `<id>.state.json`) before its first event. The file opens lazily on the first append, and events only flow after the row exists (`ObservableWorkflowAdapter.createRun` emits `workflow.run.started` after the inner insert). This applies to fresh runs and to resume (`continue`), where the row already exists.
- [x] R3. A pre-row failure (any throw or kill before `createRun` commits) exits nonzero through the existing error path, prints no run id, and leaves no `.spur/memory/runs/<id>.*` artifact. No cleanup code is needed, because nothing is created.
- [x] R4. No behavior change for already-working paths:
  - the R8 "unwritable dir → inert sink, run unaffected" contract;
  - `--no-log`, `--json` output bytes, `--trace-file`, the `--async` launcher's registration gate, `continue`/resume run logs (0926 state carry-forward), and plan-preview content;
  - the order header → plan → progress lines on success.

### Acceptance Criteria

<!-- See docs/04_DESIGN.md "Task AC guidance". -->
- [x] AC1. Given a sync `workflow run` whose pre-row step fails (`--vars` blanking a declared var), when the CLI returns, then it exits nonzero, its captured output contains no `Run: ` line, and `.spur/memory/runs/` contains no `<run-id>.*` file.
- [x] AC2. Given a successful sync `workflow run --run-id <id>` in human mode, when it returns, then the output contains `Run: <id>` before the plan preview and before the first progress line, and `spur workflow trace <id>` in the same project DB resolves the row.
- [x] AC3. Given a `WorkflowRunLogSink` constructed with no events emitted, when it is closed, then neither `<id>.md` nor `<id>.state.json` exists. Given the first event, then the file is created and receives it. The existing R8 unwritable-dir test still passes.
- [x] AC4. Given the existing workflow/run-log/async/continue suites, when `bun run spur-check` runs, then they pass with no assertion weakened.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-03T03:29:07.979Z

- **Prevent vs. clean up:** prevent. The original R2 asked for cleanup of partial artifacts on failure. Lazy sink open plus event-driven header means no artifact or id ever exists before the row, so there is nothing to clean. That is a smaller diff, and it also covers process kills, which a cleanup branch cannot.
- **Where the fix lives:** in the CLI header and the sink, not the engine. The engine already inserts the row first (`run-lifecycle.ts:156`). Reordering engine or app internals to pre-create the row would change engine ownership (`createRun` vs `createOrAttachRun`/externalKey) for no gain.
- **Async plan artifact (`.spur/run/<id>-workflow-plan.json`):** deferred. The launcher already withholds the id when registration fails (0484 R2). Deleting the plan artifact on registration timeout could race a slow worker that registers late and still needs it. Revisit only if orphan plan artifacts are observed.
- **Identity-stamp failure after insert** (`withRunIdentityRecording` throwing after `createRun`): out of scope. The row exists, so trace resolves (no orphan id), and the stale `running` row is already handled by `spur workflow clean`.
- **Existing orphan `39d39982…md`:** not deleted by this task. It is operator data; `rm` is a one-off manual step.
- **ADR-091 "Next:" hint:** dropped. ADR-091 governs the `--json` envelope, not error hint text. Existing error output is unchanged.

### Design

Two local edits, no new surface:

1. **Lazy sink open** (`packages/app/src/observability/workflow-run-log-sink.ts`):
   - The constructor stops calling `mkdirSync`/`openSync`; keep `dir` on the instance.
   - Add a private `ensureOpen(): boolean`. On first use it does `mkdirSync(dir, {recursive: true})` plus `openSync(filePath, 'a')`. On failure it latches an `openFailed` flag so the sink stays inert (R8) and never retries per line.
   - `append()` and every `if (this.fd === undefined …)` early-return go through `ensureOpen()`.
   - `writeState()` already writes by path; it only runs from `onRunStarted`/`onRunFinalized`, which fire post-row, so leave it as is.
   - `close()` is unchanged: it closes the fd only if one was opened.
   - Update the class doc comment to say the record is created at the first event, not at construction.
2. **Event-driven header** (`apps/cli/src/commands/workflow.ts`, `humanProgress` block ~`:911-913`):
   - Replace the eager `context.output.write(\`Run: ${runId}\`)` plus plan-preview write with a one-shot `workflow.run.started` subscription that writes both, then unsubscribes.
   - Guard it with a local `headerPrinted` boolean. The bus can carry two `workflow.run.started` projections (see the sink's `headerWritten` comment), and `EventBus` may lack `once`.
   - Subscribe it before the other `report` handlers so the header precedes the first progress line.

**Invariant:** every run-id-bearing side effect on the sync path (stdout header, `<id>.md`, `<id>.state.json`) is downstream of `workflow.run.started`, which is downstream of the committed row.

**Blast radius:**

- `WorkflowRunLogSink` is built in two places: `workflow.ts:896` (run) and `:1257` (continue). Continue emits events only after `claimRunOwnership` on an existing row, so lazy open is behavior-neutral there.
- No DB, schema, contract, or public-CLI change.

### Plan

- [x] P1. Failing-first tests:
  - (a) New `apps/cli/tests/commands/workflow-run-registration.test.ts`, using the in-process `main()` plus `createTempProject` harness from `workflow-vars-merge.test.ts`. AC1: a probe YAML with declared var `alpha` and `--vars '{"alpha":""}'` gives nonzero exit, no `Run: ` in captured output, and no `<runId>.*` under `runStoragePaths(dir).recordsDir`. AC2: a succeeding probe gives `Run: <id>` before the plan text; then `main(['workflow','trace',id])` on the same project resolves. Use a file-backed DB inside the temp project, not `:memory:`, because each `main()` call opens its own DB.
  - (b) AC3 in `packages/app/tests/observability/workflow-run-log-sink.test.ts`: construct then close with no events → `existsSync(filePath) === false`.
  - Run both and confirm they fail on current code.
- [x] P2. Implement Design §1 (lazy sink open). The AC3 and existing sink tests go green, including R8 and `close is idempotent`.
- [x] P3. Implement Design §2 (event-driven header). AC1 and AC2 go green. Run the focused CLI workflow suites: `(cd apps/cli && bun test tests/commands/workflow.test.ts tests/commands/workflow-vars-merge.test.ts tests/commands/workflow-system-events.test.ts tests/commands/workflow-preflight.test.ts)`. Fix only genuine order expectations; never weaken an assertion.
- [x] P4. Gate and probe:
  - Run `bun run spur-check` (AC4).
  - Manual probe A: `spur workflow run wrapup-pipeline.yaml --vars '{"profile":""}'` → no `Run:` line and no new file in `.spur/memory/runs/`.
  - Manual probe B: one succeeding trivial workflow (`--run-id probe-1064`) → `spur workflow trace probe-1064` resolves.
  - Remove the probe artifacts afterward.


Execution note (inline run 2026-10-03): P4 manual probes A/B were covered by the stronger in-process AC1/AC2 tests (temp-project isolation, real CLI `main()`); not re-run against the live corpus to avoid mutating this worktree. P1-P3 executed as specified (red confirmed, then green); full `bun run spur-check` PASS at proof digest sha256:26adb5f8.

### Solution

Change-map (auto-generated — implement step did not record a Solution).
Each entry cites the first changed line per file (`file:line`).

| Change (`file:line`) |
|----------------------|
| `apps/cli/src/commands/workflow.ts:912` |
| `packages/app/src/observability/workflow-run-log-sink.ts:106` |
| `packages/app/src/observability/workflow-run-log-sink.ts:11` |
| `packages/app/src/observability/workflow-run-log-sink.ts:125` |
| `packages/app/src/observability/workflow-run-log-sink.ts:141` |
| `packages/app/src/observability/workflow-run-log-sink.ts:262` |
| `packages/app/src/observability/workflow-run-log-sink.ts:292` |
| `packages/app/src/observability/workflow-run-log-sink.ts:305` |
| `packages/app/src/observability/workflow-run-log-sink.ts:313` |
| `packages/app/src/observability/workflow-run-log-sink.ts:321` |
| `packages/app/src/observability/workflow-run-log-sink.ts:338` |
| `packages/app/src/observability/workflow-run-log-sink.ts:345` |
| `packages/app/src/observability/workflow-run-log-sink.ts:50` |
| `packages/app/src/observability/workflow-run-log-sink.ts:80` |
| `packages/app/tests/observability/workflow-run-log-sink.test.ts:565` |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | apps/cli/src/commands/workflow.ts:912-923 — latched `workflow.run.started` handler writes `Run: <id>` + plan preview before all report handlers; AC2 test asserts header precedes first progress line |
| R2 | MET | packages/app/src/observability/workflow-run-log-sink.ts:141-157 `ensureOpen()` lazy mkdir+openSync with `openFailed` latch; constructor no longer opens (AC3 tests) |
| R3 | MET | AC1 test: pre-row `--vars` blanked-var failure → nonzero exit, zero `Run: ` lines, zero `<run-id>.*` in recordsDir; no cleanup code added |
| R4 | MET | Existing sink suite (R8 unwritable-dir, close-idempotent) and CLI suites pass unmodified — 22/22 + 177/177; no assertion weakened (git diff shows tests only added) |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 | MET | test | `1064 AC1: a pre-row failure prints no run id and leaves no run-record artifact` — apps/cli/tests/commands/workflow-run-registration.test.ts (in-process main, temp project) |
| AC2 | MET | test | same file `1064 AC2: a successful sync run prints the header first and the id resolves in the project DB`; plus `workflow trace <id>` returned 0 on the same file-backed dbUrl |
| AC3 | MET | test | `1064 AC3 — construction creates no record file…` + `…the first event creates the record` — packages/app/tests/observability/workflow-run-log-sink.test.ts (22/22) |
| AC4 | MET | command | `bun run spur-check` full PASS, receipt digest sha256:26adb5f8… (.spur/run/1064-test-gate.status), pre/post rules 2/2; focused suites (workflow, vars-merge, system-events, preflight) 177/177 |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

<!-- spur:record-review -->

**SECU findings** (pipeline verify step — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|----------|
| P4 | — | — | No findings (verify verdict PASS) |

### References

- Feature D3. Related: 0484 R2 (async registration gate), 0925/0926 (two-file run record), 0948 R2 (`mergeWorkflowRunVars` blank-var refusal, the repro trigger), ADR-117/0868 (action-trace writer).
- Code: `apps/cli/src/commands/workflow.ts:896-912,1005`, `packages/app/src/observability/workflow-run-log-sink.ts:101-107`, `packages/app/src/workflow/observability.ts:463-470`, `packages/app/src/services/workflow-service.ts:697-761,2214`, `node_modules/@gobing-ai/ts-dual-workflow-engine/src/run-lifecycle.ts:156`.
- Test harness precedent: `apps/cli/tests/commands/workflow-vars-merge.test.ts`.

### History

- 2026-10-03T03:18:46.337Z backlog → todo (system)
- 2026-10-03T04:05:42.644Z todo → wip (system)
- 2026-10-03T04:27:38.255Z wip → testing (system)
- 2026-10-03T04:28:31.407Z testing → done (system)

