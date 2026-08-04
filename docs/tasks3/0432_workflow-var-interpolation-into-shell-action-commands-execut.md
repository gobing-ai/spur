---
template: issue
schema_version: 1
name: "Workflow var interpolation into shell action commands executes as shell"
description: ""
status: todo
type: issue
profile: standard
feature_id: D3
parent_wbs: null
priority: P1
tags: ["bug"]
dependencies: []
created_at: "2026-08-04T17:26:20.672Z"
updated_at: "2026-08-04T18:34:14.203Z"
---

## 0432. Workflow var interpolation into shell action commands executes as shell

### Background



### Requirements
Workflow `var` values are interpolated verbatim into `shell` action command strings, so any shell
metacharacter inside a var executes as shell in the action's subprocess. `.spur/workflows/idea-pipeline.yaml`
interpolates the operator-supplied idea text straight into a command:

```yaml
if [ "$doctor_rc" -eq 0 ] && test -n "${vars.idea}"; then
```

The value lands inside a double-quoted shell word, where backticks and `$(...)` still expand. An idea
containing either executes arbitrary commands with the workflow runner's privileges; an idea
containing a bare `"` breaks out of the quoting entirely and can append further commands.

This is not confined to `idea-pipeline.yaml` — it is a property of how the shell action composes
commands from resolved template vars, so every workflow that interpolates a var into a `shell`
action's `command` shares it. Vars routinely carry operator free text (`idea`), agent-authored
content, and file-derived values.

Beyond the security exposure, the failure is silent and misattributed: the injected commands write
their own noise to stderr while the intended command's real work (here, writing a gate's status
file) is skipped, so the workflow then fails a downstream guard for a reason unrelated to the
actual cause.

Fix by removing shell interpretation of var content: pass resolved vars to the shell action as
environment variables referenced by name in the command, or escape values at interpolation time.
Prefer the env-var handoff — escaping is a recurring source of near-misses. The remediation must
cover the shell action itself, not only the one workflow where it was first observed; auditing
existing workflow YAMLs for interpolated vars is part of the work.
### Acceptance Criteria
```gherkin
Feature: Workflow var interpolation into shell actions is data, not code

  @core
  Scenario: R3 — a workflow var carrying shell metacharacters is treated as data
    Given a workflow whose shell action interpolates a var into its command
    When the run supplies a value containing backticks, command substitution, quotes and backslashes
    Then the command observes the value literally
    And no additional process is spawned from the value's content
    And the action's own writes and exit status match the inert-text case

  @core
  Scenario: R4 — shell interpolation cannot silently mask a gate
    Given the idea-pipeline start state whose shell action writes a doctor status file
    When the run is started with an idea containing Markdown backticks around file paths
    Then the status file is written with the correct verdict
    And the step terminates rather than hanging in-flight

  @core
  Scenario: R8 — each defect is covered at the shared mechanism
    Given the three fixes are implemented
    When the test suite runs
    Then each defect has a regression test against schema loading, the shell action, or the HITL resume path
    And no defect relies solely on a test of the single workflow file where it was observed
```

**Audit obligation (not a scenario):** every var reference inside a `shell` action `command` across
`config/workflows/` must reach the command through the safe handoff — the fix belongs to the shell
action, not to the one workflow where it was first observed.
### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

### Design

<!-- Fix approach and tradeoffs. Keep this short unless the issue changes architecture. -->

### Plan

<!-- Ordered debugging/fix checklist. Fill before moving to todo/wip. -->

### Root Cause
Reproduced live on 2026-08-04, run `941bf031-fc7b-4011-ab1c-975ddc6014e2`.

An `idea-pipeline.yaml` run was launched with an idea containing ordinary Markdown backticks — file
paths and identifiers in prose, e.g. `` `.spur/run/<runId>-output.log` ``. The `start/shell` action
executed roughly forty injected commands. Representative stderr from the run:

```
stderr> /bin/sh: RunOutputSink: command not found
stderr> /bin/sh: packages/app/src/observability/run-output-sink.ts:51: No such file or directory
stderr> /bin/sh: agent.run: command not found
stderr> /bin/sh: .spur/config.yaml: Permission denied
stderr> /bin/sh: command substitution: line 0: syntax error near unexpected token `newline'
stderr> trace: illegal option -- -
```

Each backticked span became a command substitution; `<runId>` inside those spans became shell
redirection. No destructive command happened to be present in the prose — `git status` and a
scan of the repo root confirmed no file was created, truncated, or modified — but nothing about the
mechanism prevents one. Prose that merely mentions a command would run it.

Second-order effect that made the cause hard to see: the mangled command never reached its
`printf 'PASS' > "$DOCTOR_FILE"` branch, so
`.spur/run/941bf031-...-idea-precheck-doctor.status` was never written, and the step then hung
in-flight rather than failing with a message naming the interpolation.

Confirmed as the mechanism by re-running the identical pipeline with backticks, `$`, `"` and `\`
stripped from the idea text: run `ffcdfbfd-cae9-4cdc-b1df-f4d1058513ef` executed `start/shell`
cleanly in 1s with the doctor status file written as intended.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: regression command(s), outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to failing logs, related issues, tasks, docs, or external references. -->

### History
