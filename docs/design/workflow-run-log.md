---
doc: design/workflow-run-log
area: spur workflow run log — consolidated per-run log, retention, trace follow source
status: accepted design (ADR-045; not yet built)
authority: derived
owner: Robin Min
updated_at: 2026-08-04
read_before: implementing the all-in-one per-run workflow run log (feature D2)
edit_rules: 99 §6.5
sync: [T3, T9]
---

# Workflow run log (all-in-one per-run log)

**Area:** `spur workflow run`, `spur workflow trace --follow`, `spur workflow clean`.
**Status:** accepted design (ADR-045), **not yet built** — do not invoke the flags below as if they
exist. Rationale lives in `00_ADR ADR-045`; mechanism in `03_ARCHITECTURE §6`.

## Log contract

`spur workflow run` writes one all-in-one log per run at **`.spur/run/<RUNID>.log`**, from run
creation to terminal status. The log is produced in-process by a consolidated sink (below), so it is
written even when the process's own std streams are discarded (`--async`, detached nohup). It is
**retained by default**; `--no-log` opts out. Reclamation is owned by `spur workflow clean` under a
retention policy.

### Scope of the log

| Section | Producer | Redaction |
|---|---|---|
| Run header / plan preview | consolidated sink from run-start event | — |
| Per-step progress, transitions, action lifecycle | adapter workflow events (run/phase/transition/action) | allow-listed action metadata |
| Final summary / terminal status | run finalize event | — |
| Child agent stdout/stderr | `onOutput` relay chunks | redacted + 4,096-char bound per chunk |
| Consumed stdin (steering) | steering controller consumed-command feed | note text redacted before 1,024-char bound |
| Engine shell / HITL steps | adapter action lifecycle lines | prompt content absent; redacted action lifecycle only |

The log carries the same content the foreground human renderer emits plus the agent-output chunks
the `RunOutputSink` today writes — no new prompt or shell text enters it. Prompt bodies become
`[prompt N chars]`; shell commands become `[shell command redacted]`; common/configured secrets
become `[REDACTED]`.

## Producer: consolidated sink

A new read-only subscriber on the existing `WorkflowObservabilityBus` (`ADR-035` keeps the bus a
read-only projection) receives the already-redacted, already-bounded events and appends them to
`.spur/run/<RUNID>.log`. It subsumes the current `RunOutputSink`
(`packages/app/src/observability/run-output-sink.ts`) — the same `observe(AgentExecutionEvent)` /
`close()` contract, same bounds defaults, same best-effort semantics, but emitting the richer event
set above into one file instead of the agent-output-only `<RUNID>-output.log`.

The `--async` worker inherits the sink: the flag is propagated to the detached child (as `--trace-file`
is today), and the log file is written by the in-process sink directly, independent of the nohup
`/dev/null` std-stream redirect.

## Bounds & truncation

- Byte bound default **1 MiB**; line bound **unbounded** by default. Both configurable via the
  existing `agent.output` block (`.spur/config.yaml`).
- When a bound is hit, the sink stops writing and appends a **visible truncation marker**; never a
  silent cut. Inherits `RunOutputSink`'s marker contract.
- Steering note text is redacted before the existing 1,024-char bound.

## Best-effort

Every write is best-effort: an unwritable `.spur/run/` dir or failing disk degrades the log, never
the run. Errors are logged/swallowed (same contract as the current sink and the 0370 ledger bridge).

## Retention & `spur workflow clean`

- The log is **retained by default** after a run ends. No `--keep-log`; no delete-by-default.
- `--no-log` on `spur workflow run` opts out of writing it.
- `spur workflow clean` (already the run housekeeping verb, today finalizing stale
  running/pending runs) gains a **log-reclamation scope**: it removes retained `<RUNID>.log` files
  whose age exceeds a retention threshold. The threshold is configurable via a
  `workflow.logRetentionDays` config key (default **30 days**). `--logs` scopes the verb to log
  reclamation only; `--dry-run` lists what would be removed without writing.
- Removing `<RUNID>-output.log` (consolidated into `<RUNID>.log`) and reclaiming retained logs are
  the compatibility-bearing changes — see consumer table.

## `spur workflow trace <RUNID> --follow --output`

Real-time following is delivered by extending `spur workflow trace <RUNID> --follow` with a
**log-streaming source**: `--output` switches the follow source from the structured DB timeline to a
raw tail of `.spur/run/<RUNID>.log` (tail -f equivalent), exiting at terminal status. It is a human
stream and is rejected with `--json`, as `--follow` already is. The structured timeline remains the
default; `--output` is a distinct source and does not interleave with it. No new `monitor` verb.

## Consumer compatibility (repointing audit)

Removing or repointing any existing sink is a compatibility decision. Before removing
`<RUNID>-output.log` (folded into `<RUNID>.log`), verify these consumers:

| Consumer | Reads today | Disposition |
|---|---|---|
| `spur workflow trace --follow` | DB (`workflow_runs` etc.) | unchanged; gains `--output` source |
| Async worker (`apps/cli/src/commands/workflow.ts`, detached nohup) | writes `<RUNID>-output.log` via sink | propagates consolidated sink + `--no-log` |
| Web board (Observability/Tasks tabs) | persisted rows + event ledger | unchanged (reads DB/system events, not the log file) |
| timed-out-implement runbook (`plugins/sp/skills/spur-dev/references/execution-workflow.md`) | tails `<RUNID>-output.log` | repoint to `<RUNID>.log` |
| `spur workflow clean` | finalizes stale runs only | extended with log reclamation |

`.spur/runs/workflow/<RUNID>.jsonl` (`--trace-file`) and `.spur/run/<RUNID>-STEP-partial.md` salvage
remain distinct authorities and are **not** folded into `<RUNID>.log`.

## Surface additions (all planned, ADR-045)

| Command | Addition | Conflict |
|---|---|---|
| `spur workflow run <file>` | `--no-log` (opt out of the consolidated log) | none (composes with `--async`) |
| `spur workflow trace <run-id>` | `--follow --output` (stream `<RUNID>.log`) | `--output` requires `--follow`; rejects `--json` |
| `spur workflow clean` | log reclamation scope (`--logs`, `--dry-run`), retention age from config | composes with existing `--force`/`--older-than` |
| `.spur/config.yaml` | `workflow.logRetentionDays` (default 30) | — |

CLI signatures above are transcribed from this design, not from code (unbuilt). ADR-038 obligates a
same-change `plugins/sp/skills/spur-cli` reference update when the flags ship.
