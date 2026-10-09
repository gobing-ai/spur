---
schema_version: 1
name: Emit the execution summary from the run close step and split time by actor
status: todo
template: feature-impl
created_at: 2026-10-09T17:29:05.417Z
updated_at: "2026-10-09T18:16:44.568Z"
feature_id: E5

ac_numbering: task-local
ac_altitude: task-local
priority: P2
estimate_hours: 6
dependencies: ["1136", "1138"]
---

## 1146. Emit the execution summary from the run close step and split time by actor

### Background

The default-on execution summary (`/sp:dev-run`, `/sp:dev-runall`, opt-out `--no-summary`) did not appear in recent runs. The spec and installed adapters are correct (Claude cache 0.4.0 and pi `~/.agents/skills/sp-dev-run*` both carry the step); the failure is structural:

- The summary is a trailing prose obligation (`plugins/sp/skills/spur-dev/references/dev-operations.md:167-179`) outside the bootstrap reads (`SKILL.md`, `execution-batch.md`, `inline-pipeline-driver.md`). The 1130/1131 pi batch session lost it across 9 compactions and printed only the batch report; `SINCE` was never recorded.
- On pi it measures nothing: the H1 run invoked `run-summary.mjs` but every tool-call/token cell was `n/a` and every wait 0:00 (pi transcript parsing and `PI_SESSION_FILE` resolution are owned by 1138).
- In batches the agent invoked it per run with one batch-wide `--since`, so every block showed the same Total.

Operator-supplied manual breakdowns (4 sessions) show the columns that actually explain cost: wait-on-operator (incl. longest single unanswered question), subagent time, shell time with gate time split out, model time, compactions, subagent timeouts/errors. `docs/reports/2026-10-09-1133-run-time-breakdown.md` adds: 80 % of a run quiet, 3 h 35 m with no node row (owned by 1136 R9/R10).

**Refine corrections (2026-10-09)**

- "Bootstrap reads are `SKILL.md`, `execution-batch.md`, `inline-pipeline-driver.md`" → `SKILL.md` § Bootstrap reads lists only `execution-batch.md` (plus worktree/parallel files) per mode; `inline-pipeline-driver.md` is read at per-task dispatch, and the `--close` call itself is documented in `structured-trace-emission.md:85-98` (read at the first trace event); the batch summary instruction is in `execution-batch-report.md:20-21` (read at Step 5) → R2 re-targeted to those four files, and the print obligation is carried by the close JSON itself (`summaryFile`) so it cannot be lost to compaction.
- "pi parsing is owned by 1138" / R5 "reuse the 1138 pi parser" → pi row parsing already landed in `plugins/sp/lib/transcript.ts` (`accumulate`/`promptText`/`sniffFormat`, task 1130, `done`); 1138 (`todo`) still owns `PI_SESSION_FILE`/`PI_SESSION_ID` resolution (its R8) and skill-injected-prompt classification (its R3). `resolveTranscript` (`transcript.ts:202-221`) reads only `CLAUDE_CODE_SESSION_ID` today → on pi this task's summary renders `Execution summary: n/a (no host session id …)` until 1138 lands; that is the honest R1 failure path, not a defect of this task.
- "The close step uses `runs.started_at`" → verified available: `WorkflowActionTraceWriter.closeRun` returns the committed row's `startedAt` (`packages/app/src/workflow/action-trace.ts:345-361`) and `runInlineRunTrace` already threads it (`packages/app/src/services/inline-run-setup.ts:1344-1351`). `spur workflow progress` / `projectWorkflowProgress` carries no run-level start/end (`progress-projection.ts:11-42`), so the window must come from the close path, not from the progress file.
- Layering (not stated in the original filing): `--close` is implemented in `packages/app` (`runInlineRunTrace`), while the transcript measurement lives in plugin code (`plugins/sp/scripts/run-summary.ts`, `plugins/sp/lib/transcript.ts`, Node builtins only). `packages/app` imports nothing from `plugins/sp`, and ADR-130 keeps host-transcript glue plugin-side → Design adds an injected summarizer callback, not a move of transcript code into the app.
- "Gate time from check receipts" → receipts are `.spur/run/<wbs>-check-receipt.json` carrying `runId`, `completedAt` and per-check `durationMs` (`packages/app/src/services/quality-gate.ts:184-240`), written only when the gate env has a proof digest. Reading one inside the same run is allowed by the ADR-131 consumer amendment (cross-run reads are not) → Design matches on `receipt.runId === runId` and renders `n/a (<reason>)` otherwise.
- Subagent tool name verified in live transcripts: `Agent` on both Claude Code and pi (`~/.pi/agent/sessions/--Users-robin-xprojects-spur-new--/*` toolResult `toolName` census; `Task` is the legacy Claude name). Shell is `Bash` (Claude) / `bash` (pi). Claude compaction rows are `type:"system", subtype:"compact_boundary"`; `transcript.ts:146` counts only pi `type:"compaction"` today.

### Requirements

- [ ] R1. The inline-run `--close` step generates the execution summary deterministically when the run settles (any close status: `done`, `failed`, `paused`), windowed `[runs.started_at, close time]` — no agent-recorded `SINCE`. It writes `.spur/run/<runId>-summary.md` (markdown) and `.spur/run/<runId>-summary.json` (the `RunSummary` object plus `runId`, `startedAt`, `completedAt`) and adds `summaryFile` (the `.md` path) to the close stdout JSON; `--no-summary` on `--close` suppresses both files and the key. Summary failure (unresolved transcript, no timed attempts, any thrown error) never changes the close's exit code or JSON verdict; the `.md` then contains exactly `Execution summary: n/a (<reason>)`.
- [ ] R2. The print obligation lives where the driver reads it at the moment it matters: `structured-trace-emission.md` (the `--close` step) and `inline-pipeline-driver.md` (one line at the terminal step) instruct the driver to print the `summaryFile` contents under `### Execution summary` and to pass `--no-summary` through to `--close`; `execution-batch-report.md` Step 5 prints the batch roll-up (R3). `dev-operations.md` § Execution summary is reduced to a pointer plus the column contract; the `SINCE` recording and the hand-assembled `run-summary.mjs --since` invocation are removed from every doc.
- [ ] R3. Batch mode (`/sp:dev-runall`) shows one summary per run (each produced by that run's own close, so each window is its own `runs.started_at` → close time) plus one batch roll-up produced by `run-summary.mjs --rollup <runId>-summary.json …`: one row per run (its Total) and a batch Total row (sums of the per-run Totals; when run windows overlap, the row also states the wall span first start → last end). No run block reuses a batch-wide window.
- [ ] R4. Each summary adds an actor split of the total window: operator wait (total and longest single wait), model, shell (gate time from this run's check receipt shown as an informational sub-row, not part of the partition), subagent, other tools, and idle/unattributed — partition rows sum exactly to the window — plus compaction count and subagent error count. Any value with no source renders `n/a (<reason>)`, never 0.
- [ ] R5. Measurement reuses `plugins/sp/lib/transcript.ts` (Claude + the 1130 pi row parser) and its `resolveTranscript`; this task adds no transcript format, no pi session resolution (1138 R8), no new public `spur` noun/verb, and no `packages/app` import of plugin code.

**Out of scope / non-goals:** `PI_SESSION_FILE` resolution and skill-injected-prompt classification (1138 R3/R8); engine-measured node timings (1136 R9/R10 — stage rows keep using recorded attempts); subprocess-executor (`spur workflow run`) summaries — their runs are not closed through `inline-run-setup --close` and keep the existing `n/a` behaviour; changing the existing stage table columns; `session-timeline.ts`.

### Acceptance Criteria

```gherkin
Scenario: AC1 — A settled inline run writes its own summary at close (req: R1)
  Given an inline run row started at T0 with timed action rows and a host transcript resolvable from CLAUDE_CODE_SESSION_ID
  When "inline-run-setup --close --run-id <id> --status done" runs
  Then the close exits 0 with stdout JSON containing ok true and summaryFile ".spur/run/<id>-summary.md"
  And that file holds the stage table and the actor split whose Total window starts at the run row's started_at
  And ".spur/run/<id>-summary.json" carries runId, startedAt and completedAt
```

```gherkin
Scenario: AC2 — A summary failure never changes the close verdict (req: R1)
  Given an inline run whose host transcript cannot be resolved
  When the run is closed with status done, failed (with a reason) and paused
  Then each close keeps the exit code and ok value it has without a summary
  And each summaryFile contains exactly "Execution summary: n/a (<reason>)"
```

```gherkin
Scenario: AC3 — --no-summary suppresses the summary at close (req: R1)
  Given an inline run ready to close
  When "inline-run-setup --close --run-id <id> --status done --no-summary" runs
  Then the close JSON has no summaryFile key and no <id>-summary.* file exists
  And "--no-summary" combined with any mode other than --close exits 2 with usage
```

```gherkin
Scenario: AC4 — The actor split partitions the window and never fakes a zero (req: R4, R5)
  Given a transcript window with an AskUserQuestion wait, an operator prompt gap, a Bash call overlapping an Agent call, a failed Agent result, a 6-minute row gap and one compaction row in each host format
  When the actor split is computed
  Then operator, model, shell, subagent, other-tool and idle sum exactly to the window
  And the overlapping span is counted once under subagent, the longest operator wait is the larger single wait
  And the 6-minute gap is idle, compactions and subagent errors are counted in both Claude and pi shapes
  And gate time comes only from a check receipt whose runId matches, otherwise renders "n/a (<reason>)"
```

```gherkin
Scenario: AC5 — Batch roll-up uses each run's own window (req: R3)
  Given two close-written summary JSON files with different started_at and completedAt
  When "run-summary --rollup a=<file> --rollup b=<file> --markdown" runs
  Then it prints one row per run carrying that run's own Total and a batch Total equal to their sums
  And overlapping windows add the wall span first start to last end
```

```gherkin
Scenario: AC6 — The print obligation is carried by the close output, not a trailing step (req: R2)
  Given the spur-dev references after this change
  When the execution-batch contract test scans them
  Then structured-trace-emission.md and inline-pipeline-driver.md instruct printing summaryFile after --close
  And execution-batch-report.md Step 5 names "run-summary --rollup"
  And no reference still records SINCE or invokes run-summary with --since
```

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-10-09T17:50:51.252Z

- **Where the summary is generated (closed).** Inside the committed close path of `runInlineRunTrace`, via a summarizer callback supplied by the plugin glue. Rejected: (a) move `transcript.ts`/`run-summary.ts` into `packages/app` — large move, and ADR-130 keeps host-transcript glue plugin-side; (b) glue runs the summary after the app returns and prints a second stdout line — breaks the one-JSON-line close contract (0868 finding #1); (c) keep the agent-run step and only move the instruction into bootstrap reads — the 1130/1131 failure was compaction loss plus agent-recorded `SINCE`, which only a deterministic producer removes.
- **Batch roll-up input (closed).** Per-run `<runId>-summary.json` files written by each close (`--rollup`). Rejected: re-measuring with the existing multi `--progress` mode — its windows are attempt spans, not run windows, and it needs the driver to re-export progress, the step that got lost.
- **Gate time source (closed).** This run's check receipt only (`receipt.runId === runId`), informational, outside the partition. Rejected: `command.gate` `action_runs` durations — host-reported estimates (1136 R9). A receipt from another run is a cross-run scratch read (ADR-131 amendment) → `n/a`.
- **Idle threshold (closed).** Fixed 5-minute row gap, no flag. Revisit only with evidence that it misclassifies.
- **pi (deferred → 1138).** On pi the summary is `n/a (no host session id …)` until 1138 R8 resolves `PI_SESSION_FILE`; skill-injected bodies counted as operator prompts until 1138 R3. No hard dependency: 1146's AC run on Claude-shaped fixtures plus pi-shaped rows for AC4.

### Design

**WHAT.** Make the execution summary a deterministic product of `inline-run-setup --close`, add an actor split to it, and give `/sp:dev-runall` a roll-up built from the per-run files. The driver's only remaining job is to print a file whose path the close reported.

**WHY.** The trailing agent-run step was lost to compaction, depended on an agent-recorded `SINCE`, and reused a batch-wide window. A producer that runs inside the close has none of those failure modes. The added columns are the ones the operator's manual breakdowns needed.

**WHERE / frozen names.**

1. `packages/app/src/services/inline-run-setup.ts`
   - `InlineRunTraceInput` gains `readonly summarize?: (run: InlineRunCloseSummaryInput) => Promise<string>`. The callback returns the summary `.md` path.
   - New exported `interface InlineRunCloseSummaryInput { readonly runId: string; readonly startedAt: string | undefined; readonly completedAt: string; readonly progress: WorkflowProgressProjection }`.
   - In `runInlineRunTrace`, call the summarizer only when `input.close && input.summarize`, and only after `closeRun` committed. That point is after the `result.ok !== true` failure check and after `stateError` is computed, before the `NO_ACTION_ROWS` / `RUN_RECORD_STATE_FAILED` / success branches.
     - Inputs: `startedAt` is `result.startedAt`, `completedAt` is `new Date().toISOString()` taken once, and `progress` is `await projectWorkflowProgress(input.runId, { db: projectDb.adapter, projectRoot: process.cwd() })`.
     - Wrap the progress projection and the call in `try/catch`. If it throws, append `summary-failed run=<id>: <msg>` via `appendInlineRunLogLine` and omit the key.
     - Add `summaryFile` to whichever of the three stdout JSON objects is printed. The exit code and `ok` never depend on it.
   - Export `InlineRunCloseSummaryInput` from the app barrel next to `runInlineRunTrace`.
2. `plugins/sp/scripts/run-summary.ts` (plugin glue, Node builtins plus `../lib/*` only):
   - `buildRunSummary(lines, inputs, since?, until?)`. A new optional `until` caps `totalEnd`, and the close passes `completedAt`. Existing callers are unchanged.
   - `export interface ActorSplit { operatorMs: number; longestOperatorWaitMs: number; modelMs: number; shellMs: number; subagentMs: number; otherToolMs: number; idleMs: number; compactions: number; subagentErrors: number }` and `export function actorSplit(rows: [Row, number][], start: number, end: number): ActorSplit`.
   - `RunSummary` gains `actors: ActorSplit` and `gate: { ms: number } | { ms: null; reason: string }`.
   - `export async function writeCloseSummary(run: CloseSummaryRun, opts?: { env?; projectsRoot?; cwd? }): Promise<string>`. It never throws.
     - Write `.spur/run/<runId>-summary.md` and `.spur/run/<runId>-summary.json` (with `runId`, `startedAt`, `completedAt`), then return the `.md` path relative to `cwd`.
     - On any failure it writes only the `.md` with `Execution summary: n/a (<reason>)`. Reasons include an unresolved transcript, `startedAt` undefined (`run row has no started_at`), and `no timed attempts`.
     - `CloseSummaryRun` is a local structural copy of `InlineRunCloseSummaryInput`. It uses `import type` only, because the plugin standalone rule forbids value imports.
   - `renderSummaryMarkdown` appends an actor table, `| Actor | Time | Share |`, with these rows:
     - operator wait, with the longest single wait in parentheses
     - model
     - shell, then an indented `of which gate` informational row
     - subagent
     - other tools
     - idle / unattributed
     - after the table, one line: `Compactions: N · Subagent errors: N`
   - A new `--rollup [<label>=]<summary.json>` flag (repeatable) is mutually exclusive with `--progress`/`--since`/`--transcript`. It renders `| Run | Status | Time | Wait | Tool calls | Token | Operator wait | Subagent |` with one row per file (that file's `total` + `actors`) and a bold `Batch total` of the sums. When any two `[startedAt, completedAt]` windows overlap, it adds a `Wall span` line from the first start to the last end.
3. `plugins/sp/lib/transcript.ts` is extended, not forked.
   - `Row` gains `subtype?: string`, and `Row.message` gains `isError?: boolean; toolName?: string`.
   - `Block` gains `is_error?: boolean`. Because it is currently `Partial<Record<…, string>>`, widen it into an explicit interface.
   - Add `export function isCompaction(row: Row): boolean`, which is true for pi `type:"compaction"` and for Claude `type:"system" && subtype:"compact_boundary"`.
   - `accumulate` is unchanged, because session-timeline is out of scope.
4. `plugins/sp/scripts/inline-run-setup.ts` is glue only.
   - Parse the boolean `--no-summary`. It is valid only with `--close`; any other mode calls `usage()`.
   - Pass `summarize: noSummary ? undefined : (run) => writeCloseSummary(run)` into the close `runInlineRunTrace` call, imported relatively from `./run-summary`.
   - Add the flag to the close usage line.
5. Docs:
   - `structured-trace-emission.md:85-98`: the close example adds `[--no-summary]`. After a close, print `cat "<summaryFile>"` under `### Execution summary`. When `summaryFile` is absent and `--no-summary` was not passed, print `Execution summary: n/a (close reported no summary file)`, which covers an older installed bundle.
   - `inline-pipeline-driver.md`: one line at the terminal/close step pointing at that rule.
   - `execution-batch-report.md:20-21`: run `run-summary.mjs --rollup <wbs>=.spur/run/<runId>-summary.json …` after the per-run summaries.
   - `dev-operations.md:167-179`: rewrite as a pointer plus the column contract, with no `SINCE`.
   - Sync `flag-glossary.md` `#flag-no-summary`, `commands/dev-run.md:51`, `commands/dev-runall.md:103-104` and `plugins/sp/README.md:542`.

**Actor-split algorithm (frozen).** The window is `[start, end]`.

1. Collect tool intervals `[callTs, resultTs]`.
   - Claude pairs `tool_use.id` with `tool_result.tool_use_id`. pi pairs `toolCall.id` with `toolResult.toolCallId`.
   - Clip each interval to the window. An unpaired call runs to `end`.
   - Classify by tool name:
     - operator: `OPERATOR_TOOLS`
     - subagent: `Agent`, `Task`
     - shell: `Bash`, `bash`
     - other: everything else
2. Operator prompt waits: for each row in the window with `promptText(row) !== undefined`, the interval is `[previous row ts (or start), prompt ts]`.
3. Sweep the elementary segments between all interval boundaries. Each segment goes to the highest-precedence class covering it: operator > subagent > shell > other.
4. An uncovered segment belongs to the consecutive-row gap containing it. That gap includes `start → first row` and `last row → end`. The segment is idle when that gap is at least `IDLE_GAP_MS = 300_000`, else model. Mark this with a `// ponytail:` comment: fixed threshold, make it configurable only on misclassification evidence.
5. `longestOperatorWaitMs` is the maximum single operator interval, either an AskUserQuestion pair or a prompt gap.
6. `compactions` counts rows in the window where `isCompaction(row)`.
7. `subagentErrors` counts subagent results with Claude `tool_result.is_error === true` or pi `message.isError === true`. Timeouts are not distinguishable and are included.
8. When the window has no transcript rows (`measured === false`), every actor value renders `n/a (no host transcript records in window)`.

**Gate (frozen).** Scan `<cwd>/.spur/run/*-check-receipt.json` and parse each file. A receipt counts only when its `runId === run.runId`, and then gate = Σ `checks[].durationMs`. Otherwise the gate is `{ ms: null, reason: 'no check receipt for this run' }`. This is a within-run read, which ADR-131 allows.

**Anti-patterns.**
- Do not have the agent compute or record any number, including `SINCE`.
- Do not print a second stdout line from `--close`, and do not let a summary failure change a close's exit or `ok`.
- Do not read another run's receipt.
- Do not add a `spur` verb or flag. `--no-summary` is a plugin-script flag on `inline-run-setup`, not a public noun/verb.
- Do not import plugin code from `packages/app`, and do not value-import `@gobing-ai/*` in plugin files.
- Do not change the existing stage-table columns or `session-timeline` output.
- Do not resolve `PI_SESSION_FILE` here (1138).

**Concurrency / handoff.**
- 1136 (`todo`) R1/R2 edits the same `runInlineRunTrace` close path (owning-tree resolution, row-count verification). 1134 (`todo`) touches `inline-run-setup.ts` status helpers. Whichever lands second rebases. This task's summarizer hook sits after the commit and does not change their branches.
- In worktree runs the close runs in the invoking tree (1136 contract), so a receipt left in the execution tree yields a gate `n/a`, by design.
- 1138 later fills pi measurement without touching this task's code.

### Plan

0. Precondition: `bun install` is clean, then `git status --short` confirms no other task's changes in the touched files.
1. (R4, R5) Tests first in `plugins/sp/tests/run-summary.test.ts`, failure modes F17–F23:
   - F17: partition sum
   - F18: overlap precedence
   - F19: longest operator wait
   - F20: idle threshold
   - F21: compactions and subagent errors, Claude and pi shapes
   - F22: gate receipt runId match and mismatch
   - F23: `--rollup` sums and wall span

   Then implement the `transcript.ts` type widening and `isCompaction`, plus `actorSplit`, the `until` param, the `gate` lookup, the markdown actor table and `--rollup` in `run-summary.ts`. Covers AC4, AC5.
2. (R1) Tests first in `plugins/sp/tests/inline-run-trace.test.ts`, which spawns the real script against a temp project.
   - Set `HOME` to a temp dir holding `.claude/projects/p/<sid>.jsonl`, and set `CLAUDE_CODE_SESSION_ID=<sid>`.
   - Close with `done` and assert `summaryFile`, the `.md`/`.json` content and the window start equal to the run row's `started_at` (AC1).
   - Without a session id, close with `done`, `failed --reason failed-check` and `paused`. Assert the unchanged exit/ok and the n/a file (AC2).
   - Assert `--no-summary` behaves per AC3.

   Then implement `writeCloseSummary` and the app `summarize` hook, the barrel export and the glue flag.
3. (R2, R3) Update the docs listed in Design §5. Add AC6 pins to `plugins/sp/tests/dogfood-testing/execution-batch-contract.test.ts`: the close docs mention `summaryFile`, batch-report names `--rollup`, and no `--since "$SINCE"` or `SINCE=` remains under `plugins/sp`. Then run `(cd plugins/sp && bun test tests/bootstrap-budget.test.ts)`, which must stay under budget.
4. Regenerate the twins: `bun run build:scripts` (`run-summary.mjs`, `inline-run-setup.mjs`) and `bun run build:plugin-lib` (regenerates `plugins/sp/lib/inline-run.generated.mjs` with the new `summarize` hook). Then run `bun run plugin-smoke`.
5. Gates:
   - focused: `(cd plugins/sp && bun test tests/run-summary.test.ts tests/inline-run-trace.test.ts tests/inline-run-close-reason.test.ts tests/inline-run-setup.test.ts tests/dogfood-testing/execution-batch-contract.test.ts)` and `(cd packages/app && bun test tests/services/inline-run-setup.test.ts)`
   - required: `bun run spur-check`
6. Verification artifact (repeatable): one real `/sp:dev-run` of a trivial task on Claude Code shows the printed summary. Record the run id and the `<runId>-summary.md` excerpt in Testing.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- Feature E5 (session forensics). ADR-130 (glue placement), ADR-131 + 2026-10-09 consumer amendment (scratch reads), ADR-117 / task 0868 (close contract, one stdout JSON line).
- Code: `packages/app/src/services/inline-run-setup.ts:1271-1400` (`runInlineRunTrace`), `packages/app/src/workflow/action-trace.ts:345-361` (`closeRun` → `startedAt`), `packages/app/src/workflow/progress-projection.ts:241` (`projectWorkflowProgress`), `packages/app/src/services/quality-gate.ts:184-240` (check receipt), `plugins/sp/scripts/run-summary.ts`, `plugins/sp/lib/transcript.ts`, `plugins/sp/scripts/inline-run-setup.ts:183-198`.
- Related: 1130 (pi row parser, done), 1138 (pi session resolution + injected-prompt classification, todo), 1136 (same close path; node timing R9/R10, todo), 1134 (inline-run-setup status helpers, todo).
- Evidence: `docs/reports/2026-10-09-1133-run-time-breakdown.md`.

### History

- 2026-10-09T17:50:59.663Z backlog → todo (system)

