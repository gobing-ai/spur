---
name: structured-trace-emission
description: "Structured trace emission (task 1128 split, ADR-117 / task 0868): the action vocabulary, the per-step emit shape, the close contract and the parse rules the host driver follows. Read it when the first trace event is emitted."
see_also:
  - inline-pipeline-driver
---

## Structured trace emission (ADR-117, task 0868)

`.spur/memory/runs/<run-id>.md` is the human half of the two-file run record — evidence, **not the record
of truth**. A run's
observability is a property of the run, so the inline driver owes the same structured trace the
engine subprocess writes — and it owes it through the **same writer**, never a parallel
implementation. The shared writer is `WorkflowActionTraceWriter`
(`packages/app/src/workflow/action-trace.ts`): the same decorator the engine composition installs
around `DbWorkflowPersistenceAdapter`, so the two surfaces call one emission path and one run-row
closure path and cannot drift.

The driver reaches it through the existing run delegate (`$SETUP_SCRIPT`,
`plugins/sp/scripts/inline-run-setup.ts`) — no new entry point, no second resolution chain:

- **Every executed action** — after the action settles, whether it ran host-inline or via a native
  subagent — append its provenance line as before, then record the boundary:

  ```bash
  bun "$SETUP_SCRIPT" --action --run-id "$RUN_ID" --node <state-id> --kind <action-kind> \
    --status <done|failed> --ok <true|false> --duration-ms <measured-ms> [--estimated]
  ```

  `<state-id>` is the current YAML state id (the `node`), `<action-kind>` the YAML action kind
  (`agent.run`, `shell`, `note`, `doctor.probe`, …). `--status` is `done` when the action settled
  under its declared error policy and `failed` otherwise; `--duration-ms` is the wall clock the
  driver measured around the action, and `--estimated` marks a duration the driver did **not**
  time (a value reconstructed after the action returned). The row's provenance stamp rides
  `action_runs.result_json` as `{provenance:'host-reported', estimated}`, and the projection
  exposes it per attempt — `provenance` is `host-reported` for every inline row and `unknown`
  for an engine-written or pre-stamp row, so the Board can label a host-reported duration
  instead of presenting it as measured. This writes the `action_runs` row (node, kind, status,
  `ok`, `duration_ms`, `run_id`) the engine would have written, so the run's rows are queryable
  by run id (`spur workflow progress <run-id>`, `ActionRunDao`) without reading the text log.
  The writer
  back-dates the row's `started_at` from its own `completed_at` minus the measured duration
  (0887 R8), so `completed_at − started_at == duration_ms` exactly; a back-date failure is
  recorded (`action.backdate`) and never affects the run.

- **A state with several actions (1007 R5)** — emit the whole state's boundaries in one call
  instead of one `--action` invocation per action. Write a JSON array
  (`[{node,kind,status,ok,durationMs,estimated?}, …]` — the `--action` fields, `estimated`
  optional and `false` when absent) to a temp file and pass it with `--actions-file`:

  ```bash
  bun "$SETUP_SCRIPT" --actions-file <actions.json> --run-id "$RUN_ID"
  ```

  Every row is recorded through the same writer as `--action` (one `action_runs` row per entry);
  the batch is validated in full before the first write, so an invalid row or unreadable file
  exits `1` with `{"ok":false}` and leaves **no** partial rows — fix the batch and re-emit. On
  success it prints `{"ok":true,"runId":…,"recorded":<n>}` and exits `0`. Row emission stays
  best-effort exactly like `--action`: if a row's write fails mid-batch, the failure is recorded
  to the run record and the call reports `{"ok":false,…,"error":…}` but still exits `0` — the run
  continues; never retry the batch or backfill by hand. `--actions-file` is exclusive with the
  other mode flags (`--action`, `--decide`, `--close`, …): mixing them is a usage error (exit 2),
  and a mixed call must be corrected, not silently split.

- **A `decide` action (0941)** — the driver never executes the DecisionMaker itself; it delegates
  to the same app runner the engine registers, which writes the resultFile row (schemaVersion 1)
  and returns the decision, then the delegate records the `action_runs` row (`kind=decide`)
  through the same writer as every other action:

  ```bash
  bun "$SETUP_SCRIPT" --decide --run-id "$RUN_ID" --node <state-id> --options-json <options-file>
  ```

  The options JSON mirrors the YAML `decide` options (`id`, `method: choice|noul`, `question`,
  `choices`/`default`, optional `evidence`, optional `minConfidence`, `resultFile`); paths resolve
  against the project workdir. The decision never pauses and never fails the run for model
  problems: a degraded outcome (feature switch off, no backend, error, timeout, low confidence)
  prints `ok:true` with `degraded:true`, the declared `reason`, and `value = default`, and exits
  `0` — route on the resultFile's `.value` with the declared file guards. Every row carries
  `source: model|default` (0976 R2), and the delegate appends
  `decide node=<id> value=<v> source=<s> reason=<r>` to the run log, so a declared-default
  fallback is never read as a model decision. Only an invalid options
  schema exits `1` (fail closed), and usage errors exit `2`. The `action_runs` trace row is
  best-effort exactly like `--action`.

- **At the run's declared terminal state** — before the driver reports the run complete, close the
  row so a successful inline run is never left non-terminal for `spur workflow clean` to reap as
  stale:

  ```bash
  bun "$SETUP_SCRIPT" --close --run-id "$RUN_ID" --status <done|failed|paused>
  ```

  `--status` is the declared terminal state's verdict, not a guess: a run that reached a terminal
  state is `done`; a run halted by a failing action under its error policy is `failed`. On success
  the close reports the recorded evidence: `{"ok":true,"runId":…,"actionRows":<n>}`.
  After the close, the invoking command prints the measured
  [execution summary](dev-operations.md#execution-summary) for `$RUN_ID` unless `--no-summary`.

  **Zero-row done closes are a named failure (task 0975 R2).** A run closed `done` with **zero**
  `action_runs` rows (`actionRows:0`) finalizes the row but exits `1` with
  `{"ok":false,"code":"NO_ACTION_ROWS","actionRows":0}` — a run that claims success without a
  single recorded action is exactly the untraced-runs gap ADR-117 closes, so the driver must
  surface the code in its final report instead of reporting a clean close. The failure must NOT
  be repaired by backfilling rows: the run row is already terminal, and hand-written rows are
  forbidden (ADR-117) — record the finding and let the task's evidence show the gap. A `failed`
  close with zero rows stays a clean `0` (a halt before the first boundary legitimately records
  nothing), and any `done` close with `actionRows ≥ 1` exits `0`.

**Best-effort at the action boundary only (ADR-117).** An `--action` persistence failure is
recorded — the delegate appends a `trace-emission-failed` line to `.spur/memory/runs/<run-id>.md` and
prints `{"ok":false}` on stdout — and the run continues to its declared terminal state; the
delegate exits `0` for that outcome and the driver must never treat an emission failure as a run
failure, retry it in a loop, or substitute a hand-written row. The run-row closure (`--close`) is
bookkeeping, not trace emission, and is **not** best-effort: a missing run row or a persistence
failure exits `1` with `{"ok":false}` and a named error (a missing row also carries
`code:"RUN_NOT_FOUND"`), because a silently `running` row is exactly the stale state
`spur workflow clean` reaps as `failed`. Exit `2` means the invocation itself was malformed
(missing `--node`/`--kind`/`--status`/`--ok`, a miscased `--ok`, a missing or malformed
`--duration-ms`, or an unsafe run id) and must be corrected, not ignored.

Emission is not optional and not deferred: an inline run that skips it reintroduces the
1,011-untraced-runs gap ADR-117 exists to close.

Transition guards are not advisory. Execute the declared guard exactly, in order, with the same
resolved variables and artifacts. `--no-lifecycle` remains bookkeeping only; the YAML's task checks,
verdict gate, record step, and done guard all remain authoritative.
