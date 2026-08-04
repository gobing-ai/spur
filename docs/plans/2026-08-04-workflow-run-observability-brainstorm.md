---
run_id: ffcdfbfd-cae9-4cdc-b1df-f4d1058513ef
needs_design: true
topic: workflow-run-observability
generated_at: 2026-08-04T17:05:30Z
---

# Brainstorm — One Comprehensive Per-Run Log for `spur workflow run`

## Overview

Today no single artifact spans a `spur workflow run` beginning to end. Four sinks exist, none
complete: a bounded agent-output log (`.spur/run/RUNID-output.log`, only `agent.run` child output),
a timeout-only `partial.md` salvage, an opt-in redacted JSONL trace (`.spur/runs/workflow/RUNID.jsonl`),
and persisted DB state. The run's own foreground rendering (plan preview, per-step progress, final
summary) is terminal-only — and under `--async` it is discarded outright (`nohup … </dev/null
>/dev/null 2>&1`, `apps/cli/src/commands/workflow.ts:53`), the exact mode an operator most needs to
watch. Steering stdin and non-`agent.run` (shell/HITL) actions contribute nothing to any log file.

This brainstorm shapes a consolidated, retentive, bounded, redacted run log plus real-time
following, and settles two design questions before decomposition.

## Approaches

### Approach 1: Unified log sink + extend `trace --follow` ⭐ Recommended

**Description:** A single `RunLogWriter` sink (`.spur/run/RUNID.log`) consumes the same already-
redacted observability projection the foreground renderer uses, plus agent stdout/stderr chunks and
steering stdin, writing everything to one bounded file with an explicit truncation marker. It shares
the existing bounded-relay machinery rather than re-inventing one. `spur workflow trace <run-id>
--follow` gains a log-streaming source option (e.g. `--source log` / `--output raw`) that tails the
file and interleaves it with the persisted-state replay, keeping a single "watch this run live"
command. Retain by default with a `--no-log` opt-out; reclamation lives under `spur workflow clean`.

**Trade-offs:**
- **Pros:** one artifact for a run's full story; closes the `--async` observability gap; captures
  steering stdin and shell/HITL output; no new verb duplicating trace's "watch this run live"
  intent; default-retain preserves failure evidence and matches today's retention.
- **Cons:** touching an ADR-anchored observability contract requires a compatibility pass over every
  consumer (`trace`, async worker, web board, timed-out-implement runbook) before repointing any
  path; folding foreground rendering into one file raises volume risk (bounds mandatory); streaming
  raw log text inside trace's structured-timeline contract needs careful framing.

**Confidence:** HIGH — surface, sinks, and consumers are documented in
`docs/design/workflow-observability.md`; async-discard and trace surface verified at
`apps/cli/src/commands/workflow.ts:53,526-558`.
**Sources:** `docs/design/workflow-observability.md` (implemented, tasks 0114/0310/0365);
`apps/cli/src/commands/workflow.ts`.

### Approach 2: New `spur workflow monitor RUNID` verb

**Description:** Add a dedicated verb that tails the consolidated log directly, leaving `trace`
purely the structured DB timeline.

**Trade-offs:**
- **Pros:** clean contract separation (structured timeline vs raw log); no risk of muddying trace's
  replay output.
- **Cons:** creates two commands that both mean "watch this run live", differing only in which sink
  they read; a plain `tail -f` already delivers most of this verb's value, capping what it adds.

**Confidence:** MEDIUM — the separation argument is sound, but the duplicate-intent cost is real.
**Sources:** same surface as Approach 1; counter-argument in the idea investigation.

### Approach 3: Minimal — widen the existing `RUNID-output.log` sink

**Description:** Extend the current agent-output sink to also accept foreground rendering lines,
steering input, and shell/HITL output; keep plain `tail -f` for real-time following. No CLI change.

**Trade-offs:**
- **Pros:** lowest risk, no new flag, no trace extension, reuse of the bounded relay.
- **Cons:** leaves two directory trees (`.spur/run` vs `.spur/runs/workflow`) unconsolidated;
  does not unify the log; still needs the async worker repointed; no CLI improvement beyond what
  `tail -f` gives.

**Confidence:** HIGH — mechanically simplest, but does not deliver the consolidation the idea asks
for.
**Sources:** sink at `packages/app/src/observability/run-output-sink.ts:51`.

## Recommendations

1. **Approach 1** — unify the log and extend `trace --follow`. A third verb is unwarranted when
   `tail -f` already tails and trace already owns "watch this run live"; a modifier that streams the
   log as a source keeps one command.
2. **Retain-by-default (`--no-log` opt-out), not `--keep-log`.** A run log is most valuable exactly
   when the run fails, i.e. after it ends; delete-by-default destroys the evidence at that moment and
   silently changes today's retained `RUNID-output.log`. Reclamation belongs to a retention policy on
   the existing `spur workflow clean` housekeeping verb. This inverts the operator's stated
   delete-by-default preference — surface this at the taste gate, do not silently pick either side.
3. **Fold in the adjacent shell-interpolation defect** (idea text interpolated into a shell command
   at `.spur/workflows/idea-pipeline.yaml:89` executed as shell). Needs escaping or env-var handoff;
   treat as a separate, well-scoped task rather than scope-creeping this observability change.

## Design Summary

Unified, redacted, bounded, best-effort run log at `.spur/run/RUNID.log` fed by the existing
observability projection (foreground rendering + agent stdout/stderr + steering stdin), shared with
a `spur workflow clean` retention policy, retained by default with `--no-log`. Real-time following
extends `spur workflow trace <run-id> --follow` with a log-streaming source; no new verb. Existing
sink repointing (`RUNID-output.log`, `partial.md`, JSONL trace) is a compatibility decision gated on
a consumer audit. `needs_design: true` — multiple subsystems and a new log transport over an
ADR-anchored contract; route through `system-design` before decomposition.
