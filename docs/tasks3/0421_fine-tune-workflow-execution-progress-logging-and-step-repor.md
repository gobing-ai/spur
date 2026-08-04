---
template: issue
schema_version: 1
name: "Fine-tune workflow execution progress logging and step reporter CLI UX"
description: "Umbrella task to address workflow execution CLI logging friction: omit redundant run ID prefixes, hide unavailable agent/model metadata on non-agent actions, render note messages and shell commands, include subprocess PID and exit codes, omit usage unavailable noise, and format state transitions."
status: todo
type: issue
profile: standard
feature_id: D
parent_wbs: null
priority: P2
tags: ["workflow", "logging", "cli", "ux", "step-reporter", "umbrella"]
dependencies: []
created_at: "2026-08-03T17:59:17.973Z"
updated_at: "2026-08-03T18:00:00.000Z"
---

## 0421. Fine-tune workflow execution progress logging and step reporter CLI UX

### Background

Observation of `spur workflow run .spur/workflows/idea-pipeline.yaml` revealed several progress logging UX friction points in `packages/app/src/workflow/step-reporter.ts`:

1. **Redundant Run ID Prefix:** Every line prepends `[run 36fcb2e6-4541-4f83-9c9f-a58e489dfdc3]`, duplicating the run ID printed at run start across 30+ lines and consuming ~40 chars of horizontal terminal width.
2. **`agent=unavailable · model=unavailable` Noise:** Non-agent actions (`note`, `shell`, `hitl.confirm`, `file.read.into-var`) display `agent=unavailable · model=unavailable` by default.
3. **`start/note` Renders `=> unavailable`:** `note` actions display `=> unavailable` instead of showing the note message/hint.
4. **`start/shell` Indiscriminate Redaction:** Shell actions render `=> [shell command redacted]` for all shell invocations regardless of sensitivity.
5. **Missing Subprocess PID & Exit Codes:** Agent execution heartbeats lack subprocess `pid` metadata, and finish events display `agent done` / `agent failed` without exit status code details (`exit 0`, `exit 1`).
6. **`usage unavailable` Boilerplate:** Non-agent actions (`note`, `shell`) output `· usage unavailable` on every completion event.
7. **Hidden State Transitions:** State transition events `↪ from → to` are suppressed in standard (`invocation`) detail mode and only show in `--detail full`.
8. **Sub-agent Output Visual Indentation:** Sub-agent stdout/stderr chunks use flat margin alignment instead of indented visual hierarchy under their parent `agent.run` action block.
9. **Missing Shell Action Output Streaming:** `shell` actions run process execution silently without streaming stdout/stderr output chunks to the observability bus during execution.
10. **Suppressed Failure Output Details:** When `shell` or `agent.run` actions complete or fail, stdout/stderr output snippets or error messages are dropped from the finish event (`projectResult`), leaving the operator with only a pass/fail mark instead of showing *what happened during execution*.

### Requirements

- [ ] R1. Omit 36-char GUID run ID prefix `[run <runId>]` in single-run CLI progress output (or condense to `[run shortId]` in multi-run mode).
- [ ] R2. Omit `agent=` and `model=` metadata key-value pairs when `agent === 'unavailable'` or when action `kind` is non-agent (`note`, `shell`, `hitl.confirm`, `file.read.into-var`).
- [ ] R3. Render note message string (truncated to ~70 chars) for `note` actions instead of `=> unavailable`.
- [ ] R4. Render actual shell command string (sanitized and truncated to ~80 chars) for `shell` actions instead of `=> [shell command redacted]`.
- [ ] R5. Include subprocess PID in agent execution heartbeat/start lines, and log exit status code on completion (`exit 0`, `exit 1`).
- [ ] R6. Omit `· usage unavailable` for non-agent actions; display token usage metrics only when data exists.
- [ ] R7. Render state transition lines `↪ from → to` in standard `invocation` detail mode.
- [ ] R8. Indent child agent stderr/stdout stream lines and heartbeats with 2-space padding under parent `agent.run` action boundary.
- [ ] R9. Stream shell action stdout/stderr output chunks to the observability bus during execution (under `--detail invocation` / `full`).
- [ ] R10. Capture and display stdout/stderr output snippets or error output in action finish events when shell or agent actions fail or finish, showing what happened during execution.

### Acceptance Criteria

```gherkin
Feature: Fine-tune workflow execution progress logging and step reporter CLI UX

  @core
  Scenario: R1 & R2 — Non-agent actions omit run ID and unavailable agent/model metadata
    Given a workflow run emits a start/note or start/shell action event
    When renderStepLine formats the progress event for standard CLI output
    Then the line does not repeat the 36-character run GUID prefix
    And agent=unavailable and model=unavailable are omitted

  @core
  Scenario: R3 — Note actions render the note message
    Given a workflow action of kind note is started with message "Idea pipeline start"
    When renderStepLine formats the action started event
    Then the output displays "→ start/note => Idea pipeline start"

  @core
  Scenario: R4 — Shell actions render sanitized command summaries
    Given a workflow action of kind shell is started with command "mkdir -p .spur/run"
    When renderStepLine formats the action started event
    Then the output displays "→ start/shell => mkdir -p .spur/run"

  @core
  Scenario: R5 — Agent heartbeats show PID and finish events log exit status
    Given an agent execution subprocess is running with PID 49281
    When a heartbeat or finish event is rendered
    Then heartbeat lines include "pid=49281"
    And completion lines explicitly report the exit status code (e.g., exit 0)

  @core
  Scenario: R6 — Usage unavailable boilerplate is hidden for non-agent actions
    Given a non-agent shell or note action finishes
    When renderStepLine formats the finish event
    Then "· usage unavailable" is omitted from the line

  @core
  Scenario: R7 & R8 — Transitions render in standard mode and child outputs are indented
    Given a workflow transition event from discovery to idea-eval occurs
    When renderStepLine formats the transition event
    Then "↪ discovery → to idea-eval" renders in invocation mode
    And sub-agent stdout/stderr chunks are indented by 2 spaces

  @core
  Scenario: R9 & R10 — Shell and agent.run stream stdout/stderr output and show failure details
    Given a shell action or agent.run action produces stdout or stderr output
    When the action streams output or finishes with a failure
    Then stdout and stderr output chunks are streamed to the progress view
    And failure finish lines include the stdout/stderr output snippet explaining what happened
```

### Q&A

- **Q: Should `[run <id>]` be completely removed or configurable?**  
  *A:* In single-run CLI mode (the 99% default), `[run <id>]` is redundant because `Run: <id>` is already printed in the header box. When running in multi-run or verbose mode (`--detail full`), short 8-char prefixes (`[ac350c4c]`) can be enabled.

### Design

- **Primary file:** `packages/app/src/workflow/step-reporter.ts`
- **Helpers:** Add `sanitizeCommand(cmd: string, maxLen?: number): string` and `formatActionInvocation(event: WorkflowActionStartedEvent): string`.
- **Test coverage:** `packages/app/tests/workflow/step-reporter.test.ts`.

### Plan

1. Update `renderStepLine` in `step-reporter.ts` for R1 (prefix handling) and R2 (metadata filtering).
2. Implement R3 (note message extraction) and R4 (command sanitization/truncation).
3. Implement R5 (PID and exit status reporting) and R6 (conditional usage display).
4. Enable R7 (transition lines in `invocation` mode) and R8 (2-space indentation).
5. Update and add unit tests in `packages/app/tests/workflow/step-reporter.test.ts`.

### Root Cause

`packages/app/src/workflow/step-reporter.ts` used hardcoded string templates (`[run ${event.runId}] ... · agent=${agent} · model=${model} => ${invocation} · usage ${usage}`) without checking if metadata was `unavailable` or if `invocation` was a note message or shell command string.

### Solution

<!-- Filled during implementation -->

### Testing

<!-- Filled during verification -->

### Review

<!-- Filled during review -->

### References

- `packages/app/src/workflow/step-reporter.ts`
- `packages/app/tests/workflow/step-reporter.test.ts`
- Issue report: workflow execution progress logging review

### History

- 2026-08-03: Created umbrella task 0421.
