---
schema_version: 1
name: Restore the run-close execution summary on the engine terminal path
status: todo
template: issue
created_at: 2026-11-24T20:57:29.557Z
updated_at: "2026-11-24T21:04:37.484Z"
feature_id: E5

ac_altitude: task-local
ac_numbering: task-local
priority: P2
estimate_hours: 4
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

- [ ] R1. A real `spur workflow run` or `spur workflow continue` that settles as `done` or `failed` emits a best-effort summary from that run's persisted `started_at` through `completed_at`. A measured close writes `.spur/run/<runId>-summary.md` and `.json`. A close without measurements may write the existing Markdown-only `Execution summary: n/a (<reason>)` fallback. Summary failure preserves the workflow status, reason, and exit code.
- [ ] R2. Terminal CLI JSON includes the optional `summaryFile` field with the Markdown path relative to the run's launch project when the writer returns a file. Pauses, interruptions, dry runs, start acknowledgments, and failed writes omit it. Existing JSON envelope and human output behavior are preserved.
- [ ] R3. The single-run and batch runbooks describe how to display the terminal summary and roll up available per-run JSON receipts. The existing `/sp:dev-run` and batch `--no-summary` option suppresses display. The workflow CLI gains no verb or flag.
- [ ] R4. Exercise real CLI execution in temporary projects so removing the terminal producer breaks the regression checks.

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

- [ ] 0. Confirm the implementation checkout uses the lockfile's engine version and root manifest's Bun version. Refine found engine 0.8.4 matching the lockfile; the CLI workspace test resolved Bun 1.4.4 while the root pins 1.4.3. Use the pinned Bun for implementation gates.
- [ ] 1. Before production edits, extend `apps/cli/tests/commands/workflow/host-operator-pause.test.ts` for AC2 and `apps/cli/tests/commands/workflow/run.test.ts` for AC1 and AC3, using the real CLI `main`, an isolated on-disk DB, and real filesystem writes. Use the async spawn test harness to force only the launch to throw and assert the synchronous fallback result includes its own receipt. Record the failing receipt assertions before the fix.
- [ ] 2. Add the app reporting seam and invoke it from all three CLI terminal result paths as specified in Design. Keep the reporting error boundary outside the workflow result/error handling. (R1, R2)
- [ ] 3. Update single-run, batch, and workflow CLI docs for the terminal field and display switch. Keep the batch receipt contract test consistent with the documented roll-up command. (R3)
- [ ] 4. Rerun both CLI test files from `apps/cli`, the existing `run-summary-render.test.ts` and `run-summary-cli.test.ts` suites from `packages/app`, the `execution-batch-contract.test.ts` suite from `plugins/sp`, and the task gate. Record reproducible commands, results, and observed terminal JSON/file assertions through normal task verification. (R1–R4)

### Root Cause

`99c0d7524` removed the `summarize` callback from the only CLI consumer, `apps/cli/src/commands/workflow/inline.ts` in the parent commit. The surviving renderer at `packages/app/src/workflow/run-summary-render.ts:160` has only test callers at the audited HEAD (`b3ce2bc58`). The replacement CLI paths serialize the engine result directly at `apps/cli/src/commands/workflow/run.ts:590`, `:979`, and `apps/cli/src/commands/workflow/continue.ts:303`. The stale producer instruction remains at `plugins/sp/skills/spur-dev/references/dev-operations.md:169`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Task 1146 verification artifact: `.spur/run/1146-verify-answer.txt`, R1–R3 traceability. Task 1242 removal: `99c0d7524`.
- Persisted run window: `packages/domain/src/dao/run-dao.ts:133`. Progress projection: `packages/app/src/workflow/progress-projection.ts:241`.
- Host CLI fixture: `apps/cli/tests/commands/workflow/host-operator-pause.test.ts:68`. Batch driver: `plugins/sp/skills/spur-dev/references/execution-batch-report.md:144`.

### History
