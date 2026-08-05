---
schema_version: 1
id: "D2"
name: "All-in-one per-run workflow run log"
status: done
priority: P2
tags: []
created_at: "2026-08-04T17:15:08.512Z"
updated_at: "2026-08-04T23:46:11.806Z"
---

# D2: All-in-one per-run workflow run log

## Goal
Make every `spur workflow run` observable end-to-end through **one** all-in-one per-run log at
`.spur/run/RUNID.log`, consolidated from creation to terminal status. The log captures the run's own
foreground rendering (plan preview, per-step progress, transitions, final summary) plus every child
agent's stdout/stderr and any stdin the run consumed (steering commands). It is **retained by
default** with a `--no-log` opt-out; reclamation moves under a retention policy on the existing
`spur workflow clean` housekeeping verb. Real-time following is delivered by **extending** the
existing `spur workflow trace RUNID --follow` to add a log-streaming source — there is no new
`monitor` verb.

Source idea: idea-run f2a3f9c4-1a24-48ea-b6ea-d2cf7219edb4 (idea-eval-report.md).
## Scope
In:
- All-in-one per-run log at `.spur/run/RUNID.log` covering run creation → terminal status: the run's
  own foreground rendering (plan preview, per-step progress, transitions, final summary), every child
  agent's stdout/stderr, and consumed stdin (steering commands).
- Retain-by-default with a `--no-log` opt-out on `spur workflow run` (no `--keep-log`).
- Real-time following by extending `spur workflow trace RUNID --follow` with a log-streaming source
  (e.g. an `--output`/`--raw`-style modifier, or the log as a source the follower interleaves with
  persisted DB state). No `monitor` verb.
- Reclamation of retained logs under a retention policy on the existing `spur workflow clean` verb.
- Consolidation of existing per-run log sinks (RUNID-output.log, RUNID-STEP-partial.md,
  `.spur/runs/workflow/RUNID.jsonl`, persisted workflow_runs DB state) treated as a compatibility
  decision — check `spur workflow trace`, the async worker
  (apps/cli/src/commands/workflow.ts:53), web board consumers, and the timed-out-implement runbook
  (plugins/sp/skills/spur-dev/references/execution-workflow.md) before repointing any path.

Out:
- New `spur workflow monitor` verb — explicitly rejected by operator.
- `--keep-log` flag / delete-by-default — explicitly overridden by operator.
- The shell-interpolation defect (`.spur/workflows/idea-pipeline.yaml:89`) — decomposed as its own
  task.
## Acceptance Criteria
```gherkin
Feature: All-in-one per-run workflow run log

  @core
  Scenario: R1 — workflow run writes a single all-in-one log at .spur/run/RUNID.log covering creation to terminal status
    Given a workflow run is started with spur workflow run
    When the run reaches a terminal status
    Then exactly one log file exists at .spur/run/RUNID.log for that run
    And that log file contains entries spanning from run creation to terminal status

  @core
  Scenario: R2 — the all-in-one log captures the run's foreground rendering
    Given a workflow run is started with spur workflow run
    When the run completes
    Then the log at .spur/run/RUNID.log contains the plan preview
    And the log contains per-step progress lines
    And the log contains the FSM transitions
    And the log contains the final summary

  @core
  Scenario: R3 — the all-in-one log captures every child agent's stdout and stderr
    Given a workflow run with at least one agent.run step that writes to stdout and stderr
    When the run completes
    Then the log at .spur/run/RUNID.log contains each child agent's stdout
    And the log contains each child agent's stderr

  @core
  Scenario: R4 — the all-in-one log captures steering commands consumed from stdin
    Given a workflow run is started with spur workflow run --steer
    When the operator sends steering commands via stdin during the run
    Then the log at .spur/run/RUNID.log contains each steering command consumed by the run

  @core
  Scenario: R5 — --async runs write their narration to the all-in-one log instead of discarding it
    Given a workflow run is started with spur workflow run --async
    When the detached worker runs to a terminal status
    Then the log at .spur/run/RUNID.log contains the run's foreground rendering
    And the log contains the child agents' output

  @core
  Scenario: R6 — the all-in-one log is retained by default after the run ends
    Given a workflow run completes
    When the operator inspects .spur/run
    Then the file RUNID.log still exists for that run
    And no --keep-log flag or delete-by-default behavior applies

  @core
  Scenario: R7 — --no-log opts out of writing the all-in-one log
    Given an operator starts a workflow run with spur workflow run --no-log
    When the run completes
    Then no RUNID.log file is written for that run

  @core
  Scenario: R8 — spur workflow trace RUNID --follow streams the all-in-one log in real time
    Given an active workflow run with a written RUNID.log and the persisted run state
    When the operator runs spur workflow trace RUNID --follow
    Then the follower streams new log lines from RUNID.log as the run progresses
    And no new spur workflow monitor verb exists

  @core
  Scenario: R9 — spur workflow clean reclaims retained run logs under a retention policy
    Given one or more retained RUNID.log files exist in .spur/run
    When the operator runs spur workflow clean
    Then logs exceeding the configured retention policy are removed
    And logs within the retention policy are kept

  @edge
  Scenario: R10 — the all-in-one log never leaks prompt bodies or shell command text
    Given a workflow run whose agent prompts contain secret material and whose shell actions contain command text
    When the run completes
    Then the log at .spur/run/RUNID.log does not contain any prompt body
    And the log does not contain any shell command text

  @edge
  Scenario: R11 — the all-in-one log stays bounded with an explicit truncation marker
    Given a workflow run whose combined output exceeds the configured log byte or line limit
    When the run completes
    Then the log at .spur/run/RUNID.log is capped at the configured limit
    And a visible truncation marker is written at the truncation point

  @edge
  Scenario: R12 — an unwritable .spur/run directory degrades the log, never the run
    Given the .spur/run directory is unwritable
    When a workflow run is started with spur workflow run
    Then the run proceeds and reaches a terminal status
    And no RUNID.log file is written for that run
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0426 | Consolidated all-in-one per-run workflow run log sink | done |
| 0427 | spur workflow run --no-log opt-out and retain-by-default | done |
| 0428 | spur workflow trace --follow --output log-streaming source | done |
| 0429 | spur workflow clean run-log retention | done |
| 0430 | Workflow run-log observability doc sync | done |
<!-- END AUTO-GENERATED -->

## Notes
**Settled operator decisions (2026-08-04) — binding scope, do not re-litigate**

1. **Follow surface:** extend `spur workflow trace RUNID --follow` with a log-streaming source. No `monitor` verb.
2. **Retention:** retain by default, `--no-log` opt-out. No `--keep-log`. Reclamation belongs to a retention policy on `spur workflow clean`.
3. **Adjacent defect** (shell interpolation at `.spur/workflows/idea-pipeline.yaml:89`) stays separate — its own task.
4. **Design gate:** pre-approved; proceed through decomposition without pausing.

**Constraints (non-negotiable)**

- **Redaction:** prompt bodies and shell command text never enter the observability bus/log; a consolidated log must not become the leak. Existing sinks already emit redacted output.
- **Bounded volume:** caps bytes/lines with an explicit truncation marker; never silently cut.
- **Best-effort writes:** an unwritable `.spur/run/` dir or failing disk degrades the log, never the run.
- **Compatibility:** consolidating sinks touches an ADR-anchored observability contract (ADR-035). Removing or repointing any sink is a compatibility decision — check `trace`, the async worker, web board consumers, and the timed-out-implement runbook first.

**Current gaps to close**

- The run's own foreground rendering is terminal-only, never lands in any file.
- With `--async`, that rendering is discarded outright (detached nohup, three std streams to /dev/null at apps/cli/src/commands/workflow.ts:53).
- stdin is not captured; `--steer` reads steering commands from stdin, only redacted steering events reach the bus/trace.
- Non-agent.run actions (engine shell, HITL steps) contribute no output to any log file.
- Artifacts split across `.spur/run/` and `.spur/runs/workflow/` — a discoverability trap.

**Design authority**

- docs/design/workflow-observability.md
- ADR-035 (control-plane boundary)
- tasks 0114, 0310, 0365, 0414
## History
- 2026-08-04T23:30:07.882Z backlog → active (system)
- 2026-08-04T23:30:08.122Z active → verifying (system)
- 2026-08-04T23:46:11.806Z verifying → done (system)
