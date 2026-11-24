---
schema_version: 1
name: Restore the run-close execution summary on the engine terminal path
status: done
template: issue
created_at: 2026-11-24T20:57:29.557Z
updated_at: "2026-11-24T22:45:53.633Z"
feature_id: E5

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 4
done_forced: "false"
done_reason: unforced close
---

## 1448. Restore the run-close execution summary on the engine terminal path

### Background

Task 1146 established per-run execution summaries and batch roll-up. Its 2026-11-24 verification found that task 1242 (commit `99c0d7524`) removed `spur workflow inline close` and the sole production call to `writeCloseSummary`. At the audited HEAD (`b3ce2bc58`), the `workflow run` and `workflow continue` JSON paths serialize the engine result without a summary receipt. In this checkout, the newest top-level summary Markdown by mtime is `.spur/run/1227-5865293f-summary.md` (2026-10-17 09:25:55 PDT). This corroborates the code audit for this checkout.

**Refine corrections (2026-11-24)**
- Terminal output includes a third path: `workflow run --async` can execute synchronously after a spawn failure. Cover that fallback alongside foreground run and continue. Successful launch acknowledgments are separate from terminal results.
- The existing writer creates a Markdown and JSON pair for measured runs. It can emit Markdown alone when measurements are unavailable, and it can throw if that fallback write fails. Specify both outcomes and isolate the entire reporting operation.
- Remove the stale reference to the retired CLI opt-out. Preserve the existing `--no-summary` slash-command flag as a display toggle, with no new flag on either workflow verb.
- Replace the single happy-path check with real CLI cases for immediate close, pause/resume, dry run, and a summary I/O failure. Freeze each run's window to its persisted start and completion timestamps.

### Requirements

- [x] R1. A real `spur workflow run` or `spur workflow continue` that settles as `done` or `failed` emits a best-effort summary from that run's persisted `started_at` through `completed_at`. A measured close writes `.spur/run/<runId>-summary.md` and `.json`. A close without measurements may write the existing Markdown-only `Execution summary: n/a (<reason>)` fallback. Summary failure preserves the workflow status, reason, and exit code.
- [x] R2. Terminal CLI JSON includes the optional `summaryFile` field with the Markdown path relative to the run's launch project when the writer returns a file. Pauses, interruptions, dry runs, start acknowledgments, and failed writes omit it. Existing JSON envelope and human output behavior are preserved.
- [x] R3. The single-run and batch runbooks describe how to display the terminal summary and roll up available per-run JSON receipts. The existing `/sp:dev-run` and batch `--no-summary` option suppresses display. The workflow CLI gains no verb or flag.
- [x] R4. Exercise real CLI execution in temporary projects so removing the terminal producer breaks the regression checks.

Out of scope: engine-package changes, workflow YAML edits, changes to measurement or transcript formats, summary backfill, cancellation/cleanup commands, and cross-worktree persistence changes.

### Acceptance Criteria

```gherkin
Scenario: AC1 — An immediate workflow close publishes its measured summary (req: R1; R2; R4)
Given a temporary project with a workflow that executes a timed action and reaches a terminal state
When the CLI runs it with JSON output
Then `summaryFile` names the launch-project-relative Markdown file, the sibling JSON identifies the run, and its measurement window equals the persisted run row's start and completion times.
Then a dry run of the fixture has no `summaryFile` and creates neither summary file.

Scenario: AC2 — A host pause publishes a receipt only after terminal resume (req: R1; R2; R4)
Given the real host operator-gate fixture launched with `executor=host`
When `workflow run` pauses and `workflow continue --answer yes --json` reaches the terminal state
Then the paused result has neither summary field nor files, and the terminal result reports the Markdown and writes the JSON using the original run ID, original start, and final persisted completion.

Scenario: AC3 — Summary I/O failure preserves the CLI verdict (req: R1; R2; R4)
Given a real workflow with an existing directory at the would-be Markdown path
When a successful run and a failed run close with JSON output
Then both commands retain their respective terminal status, reason if present, and exit code (0 or 1), and omit `summaryFile` without emitting a second JSON result.

Scenario: AC4 — Runbooks use terminal receipts for display and roll-up (req: R3)
Given the single-run and batch driver documentation
When a driver consumes a settled run result
Then it reads the returned `summaryFile` for display, skips missing JSON receipts for roll-up, and applies `--no-summary` to printing only. The docs contain no invocation of `workflow inline close` for summary generation.
```

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-11-24T21:04:11.568Z

- Keep the existing slash-command `--no-summary` behavior as a display toggle. A producer opt-out would require separate operator consent for the CLI surface.
- Treat the measured Markdown/JSON pair and the Markdown-only diagnostic as separate valid outputs. A filesystem failure with no Markdown report leaves the optional field absent.

### Design

**Ownership and seam.** Keep completion reporting at the workflow CLI boundary (ADR-021). Put the persisted-run lookup, progress projection and writing in `packages/app/src/workflow/run-summary-render.ts` behind its existing `@gobing-ai/spur-app/close-summary` export. Add a single wrapper in `apps/cli/src/commands/workflow/shared.ts` and invoke it before output on the synchronous run, async-spawn fallback, and synchronous continue result paths. A detached worker executes those normal CLI paths; the launcher ack does not call the helper. Keep server and programmatic app-service callers out of the added write path.

**Inputs and order.** Only accept actual `done` or `failed` results and skip dry runs before opening the database. Use the result run ID with `RunDao.traceRowById`. Require a persisted terminal row with `completed_at` and a run ID safe as one filename component (reuse `SAFE_RUN_ID_RE` in `packages/app/src/workflow/run-citation.ts`). Give `projectWorkflowProgress` and `writeCloseSummary` that run's launch cwd (`metadata_json.definitionSource.workdir`; legacy rows without the field use the CLI cwd), and pass the CLI env and persisted timestamp window. Reuse the renderer and its existing fallback semantics. Guard DB access, projection, and writing at the wrapper boundary because even the Markdown fallback can fail. Append `summaryFile` only when the writer returns it, before raw/enveloped JSON serialization. Keep workflow exit semantics and stdout framing. No new command, CLI option, config key, workflow state, or dependency.

**Driver contract.** Read the returned Markdown path against the run's project or worktree, and resolve the sibling JSON from the same root for `spur workflow summary --rollup` when present. Describe the existing driver flag as controlling display only. Update `dev-operations.md`, `execution-batch-report.md`, and the `docs/help/cmd_workflow.md` run/continue result reference. Keep explicit `workflow summary --progress` behavior and renderer/roll-up math. Capture any worktree summary needed by the driver while the source paths are available, using the existing driver lifecycle.

**Alternatives considered.** A per-workflow YAML step would miss other workflows and early terminal failures. An engine event subscriber adds ordering and flush dependencies to a synchronous CLI result. Restoring the removed inline command or adding a replacement flag would expand the public command surface.

**Dependencies and concurrency.** Tasks 1146 and 1242 are done and supply the existing writer and engine-host path. No pending dependencies. At refine time the main checkout was the only listed worktree, no tasks were `wip`, and the other modified files were task records 1143, 1144, and 1146. During refinement, overlapping uncommitted edits appeared in `run.ts`, `continue.ts`, `shared.ts`, `run-summary-render.ts`, `run.test.ts`, and `continue.test.ts`. Preserve and reconcile that work before opening another implementation pass. The in-progress diff observed at refine time still needed review against dry-run exclusion, the persisted terminal row requirement, and the launch-project receipt path.

### Plan

- [x] 0. Confirm the implementation checkout uses the lockfile's engine version and root manifest's Bun version. Refine found engine 0.8.4 matching the lockfile; the CLI workspace test resolved Bun 1.4.4 while the root pins 1.4.3. Use the pinned Bun for implementation gates.
- [x] 1. Before production edits, extend `apps/cli/tests/commands/workflow/host-operator-pause.test.ts` for AC2 and `apps/cli/tests/commands/workflow/run.test.ts` for AC1 and AC3, using the real CLI `main`, an isolated on-disk DB, and real filesystem writes. Use the async spawn test harness to force only the launch to throw and assert the synchronous fallback result includes its own receipt. Record the failing receipt assertions before the fix.
- [x] 2. Add the app reporting seam and invoke it from all three CLI terminal result paths as specified in Design. Keep the reporting error boundary outside the workflow result/error handling. (R1, R2)
- [x] 3. Update single-run, batch, and workflow CLI docs for the terminal field and display switch. Keep the batch receipt contract test consistent with the documented roll-up command. (R3)
- [x] 4. Rerun both CLI test files from `apps/cli`, the existing `run-summary-render.test.ts` and `run-summary-cli.test.ts` suites from `packages/app`, the `execution-batch-contract.test.ts` suite from `plugins/sp`, and the task gate. Record reproducible commands, results, and observed terminal JSON/file assertions through normal task verification. (R1–R4)

### Root Cause

`99c0d7524` removed the `summarize` callback from the only CLI consumer, `apps/cli/src/commands/workflow/inline.ts` in the parent commit. The surviving renderer at `packages/app/src/workflow/run-summary-render.ts:160` has only test callers at the audited HEAD (`b3ce2bc58`). The replacement CLI paths serialize the engine result directly at `apps/cli/src/commands/workflow/run.ts:590`, `:979`, and `apps/cli/src/commands/workflow/continue.ts:303`. The stale producer instruction remains at `plugins/sp/skills/spur-dev/references/dev-operations.md:169`.

### Solution

| File | Change |
| --- | --- |
| `packages/app/src/workflow/run-summary-render.ts:15-268` | Hardened `writeRunCloseSummary` to validate `runId` against `SAFE_RUN_ID_RE`, require a persisted terminal row (`done`/`failed`) with non-empty `completed_at`, resolve the run's launch working directory from `metadata_json.definitionSource.workdir` (falling back to CLI `cwd`), and pass the exact persisted `[started_at, completed_at]` window (R1). |
| `apps/cli/src/commands/workflow/shared.ts:216-242` | Tightened `withCloseSummary` to skip dry runs before opening the DB (`options?.dryRun === true`) and accept only terminal `done`/`failed` statuses, keeping summary errors isolated from the workflow verdict and exit code (R1, R2). |
| `apps/cli/src/commands/workflow/run.ts:591-594,983-986` | Threaded `{ dryRun: options.dryRun === true }` into `withCloseSummary` on both the async-spawn fallback and synchronous run terminal paths (R1, R2). |
| `plugins/sp/skills/spur-dev/references/dev-operations.md:167-186` | Replaced the stale `inline close` reference with the terminal-close `summaryFile` contract, launch-project/worktree resolution, missing-JSON roll-up skipping, and display-only `--no-summary` semantics (R3). |
| `plugins/sp/skills/spur-dev/references/execution-batch-report.md:144-156` | Updated batch roll-up docs to resolve `summaryFile` and sibling `.json` from each run's project/worktree, skip missing JSON receipts, and treat `--no-summary` as display-only (R3). |
| `docs/help/cmd_workflow.md:220-239` | Documented optional `summaryFile` in the `workflow run`/`continue` terminal JSON reference and its omission rules (R3). |
| `apps/cli/tests/commands/workflow/run.test.ts:443-552` | Extended real-CLI tests for AC1 (persisted DB `started_at`/`completed_at` window equality, `--dry-run` exclusion, async-spawn fallback receipt) and AC3 (directory-at-path I/O failure on both `done` and `failed` runs preserving status, reason, exit code, and single JSON output) (R1, R2, R4). |
| `apps/cli/tests/commands/workflow/host-operator-pause.test.ts:288-328` | Added AC2 real-CLI host-pause regression test verifying paused runs omit `summaryFile` and write no files, while terminal `continue --answer yes --json` emits `summaryFile` and sibling JSON matching persisted DB timestamps (R1, R2, R4). |
| `packages/app/tests/workflow/run-summary-render.test.ts:175-238` | Added direct unit tests for `writeRunCloseSummary` covering unsafe run IDs, missing/paused rows, `metadata_json.definitionSource.workdir` resolution, and legacy metadata fallback (R1, R4). |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `packages/app/src/workflow/run-summary-render.ts:210-268` (`writeRunCloseSummary`: SAFE_RUN_ID_RE, persisted terminal row, launch workdir, DB window); `apps/cli/src/commands/workflow/shared.ts:216-242` (`withCloseSummary`: done/failed only, dry-run skipped) |
| R2 | MET | `apps/cli/src/commands/workflow/run.ts:591-594,983-986`; `apps/cli/src/commands/workflow/continue.ts:305-311`; `summaryFile` relative path asserted in `apps/cli/tests/commands/workflow/run.test.ts:445` |
| R3 | MET | `plugins/sp/skills/spur-dev/references/dev-operations.md:167-186`; `plugins/sp/skills/spur-dev/references/execution-batch-report.md:144-156`; `docs/help/cmd_workflow.md:220-239` |
| R4 | MET | Real CLI `main` + on-disk DB tests: `apps/cli/tests/commands/workflow/run.test.ts:445-580`; `apps/cli/tests/commands/workflow/host-operator-pause.test.ts:305-345`; `apps/cli/tests/commands/workflow/continue.test.ts:265` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — An immediate workflow close publishes its measured summary | MET | test | `apps/cli/tests/commands/workflow/run.test.ts:445` (summary + DB window), `:475` (dry run excluded), `:511` (failed run), `:528` (async fallback) |
| AC2 — A host pause publishes a receipt only after terminal resume | MET | test | `apps/cli/tests/commands/workflow/host-operator-pause.test.ts:305-345` |
| AC3 — Summary I/O failure preserves the CLI verdict | MET | test | `apps/cli/tests/commands/workflow/run.test.ts:558` (done + failed variants) |
| AC4 — Runbooks use terminal receipts for display and roll-up | MET | command | docs in R3; `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts:1162,1172`; `rg "inline close"` over references + cmd_workflow: 0 matches |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

**Requirements Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/app/src/workflow/run-summary-render.ts:210-268`, `apps/cli/src/commands/workflow/shared.ts:216-242`, `apps/cli/tests/commands/workflow/run.test.ts:445-552` |
| R2 | MET | `apps/cli/src/commands/workflow/shared.ts:216-242`, `apps/cli/src/commands/workflow/run.ts:591-594,983-986`, `apps/cli/src/commands/workflow/continue.ts:305-311`, `apps/cli/tests/commands/workflow/host-operator-pause.test.ts:288-328` |
| R3 | MET | `plugins/sp/skills/spur-dev/references/dev-operations.md:167-186`, `plugins/sp/skills/spur-dev/references/execution-batch-report.md:144-156`, `docs/help/cmd_workflow.md:220-239` |
| R4 | MET | `apps/cli/tests/commands/workflow/run.test.ts:445-552`, `apps/cli/tests/commands/workflow/host-operator-pause.test.ts:288-328`, `packages/app/tests/workflow/run-summary-render.test.ts:175-238` |

**Acceptance Criteria**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 | MET | test | `apps/cli/tests/commands/workflow/run.test.ts:445-518` |
| AC2 | MET | test | `apps/cli/tests/commands/workflow/host-operator-pause.test.ts:288-328` |
| AC3 | MET | test | `apps/cli/tests/commands/workflow/run.test.ts:520-552` |
| AC4 | MET | command+static-ref | `plugins/sp/skills/spur-dev/references/dev-operations.md:167-186`, `plugins/sp/skills/spur-dev/references/execution-batch-report.md:144-156`, `docs/help/cmd_workflow.md:220-239`, `plugins/sp/tests/skill-structure.test.ts` (0 `inline close` matches via `rg`) |

**Findings**

None (0 P1, 0 P2, 0 P3, 0 P4). All 10/10 light gate checks (biome, 52 pre-check rules, TSDoc post-check, CLI/server/app typechecks, CLI/app/plugin tests and coverage) passed.

Verdict: PASS

### References

- Task 1146 verification artifact: `.spur/run/1146-verify-answer.txt`, R1–R3 traceability. Task 1242 removal: `99c0d7524`.
- Persisted run window: `packages/domain/src/dao/run-dao.ts:133`. Progress projection: `packages/app/src/workflow/progress-projection.ts:241`.
- Host CLI fixture: `apps/cli/tests/commands/workflow/host-operator-pause.test.ts:68`. Batch driver: `plugins/sp/skills/spur-dev/references/execution-batch-report.md:144`.

### History

- 2026-11-24T21:45:47.253Z todo → wip (system)
- 2026-11-24T22:03:40.716Z wip → testing (system)
- 2026-11-24T22:03:51.194Z testing → done (system)

