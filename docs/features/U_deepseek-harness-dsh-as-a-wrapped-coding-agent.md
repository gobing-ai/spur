---
schema_version: 1
id: "U"
name: "DeepSeek Harness (dsh) as a wrapped coding agent"
status: backlog
priority: P2
tags: []
created_at: "2026-11-26T19:33:42.587Z"
updated_at: "2026-11-26T19:34:30.755Z"
---

# U: DeepSeek Harness (dsh) as a wrapped coding agent

## Goal

Spur can dispatch work to DeepSeek Harness (`dsh`) as a first-class wrapped coding agent, so operators who use dsh — and the plugins they install in their dsh profiles — can run Spur tasks and workflows on it with the same executor selection, run observation, failure classification and MCP readiness that the other ten agents have. Spur does not host or translate dsh (Cordis) plugins; the dsh ecosystem reaches Spur runs through dsh itself.

## Scope

**In scope**

- A `dsh` agent shim in the released `@gobing-ai/ts-ai-runner` facade over `dsh --profile headless --json`: NDJSON event mapping, `--session-id` resume, permission-mode mapping, availability/auth detection, success = exit 0 and `final.reason.kind === 'completed'`.
- Spur recognition of `dsh` across executor config (`config/config.global.yaml`, `config/config.example.yaml`), process identity, run-session observation, failure classification, MCP readiness and the Board integrations row.
- A pinned-version NDJSON contract test and a doctor-visible version mismatch.
- Verification that the `sp-*` skills Superskill already writes to `~/.agents/skills` are discovered by dsh.
- One repeatable E2E receipt: a real task dispatched to dsh that leaves a Spur run record.

**Out of scope**

- Hosting, loading, or statically extracting dsh/Cordis plugins inside Spur.
- The Superskill `dsh` install target for hooks and the MCP profile patch (follow-up feature).
- Importing Zstandard-compressed dsh session logs into the history plane (follow-up feature).
- `/sp:dev-*` slash commands inside dsh (dsh registers commands only in code).
- ACP or SDK JSON-RPC transport for dsh.

## Acceptance Criteria

```gherkin
Feature: DeepSeek Harness (dsh) as a wrapped coding agent

  @core
  Scenario: R1 — The runner builds a dsh headless one-shot command
    # covers: I1, I2
    Given the ts-ai-runner dsh shim
    When a prompt is built for a fresh run in a working directory
    Then the command is dsh --profile headless with --json and the task on stdin
    And no dsh plugin is loaded, translated or inspected by Spur or the runner

  @core
  Scenario: R2 — dsh NDJSON events map to runner events
    # covers: I2
    Given a dsh --json stream carrying session, status, text, thinking, tool_call, tool_result and final events
    When the runner parses the stream
    Then the session id comes from the opening session event
    And assistant text, tool calls and tool results surface as the matching runner events
    And an unknown event type is ignored without failing the run

  @core
  Scenario: R3 — Success requires exit zero and a completed final reason
    # covers: I3
    Given a dsh process that exits 0
    When its final event reason kind is not completed or no final event was emitted
    Then the runner reports the run as failed with the final reason
    And only exit 0 together with final.reason.kind completed reports success

  @core
  Scenario: R4 — A dsh run resumes by session id
    # covers: I2
    Given a previous dsh run whose session event named session-abc
    When a stage resumes that executor session
    Then the command carries --session-id session-abc
    And the dsh capability record declares resumeById true

  @core
  Scenario: R5 — Spur permission intent maps to a dsh permission mode
    # covers: I2
    Given a stage requesting workspace-write execution
    When the dsh command is built
    Then it carries --permission-mode workspace-write
    And an unattended full-access request maps to --permission-mode auto with --approval-policy never

  @core
  Scenario: R6 — dsh availability is detected without Spur storing credentials
    # covers: I2
    Given a host where the dsh binary is or is not on PATH
    When spur agent doctor probes executors
    Then dsh is reported available or unavailable with the probed version
    And Spur reads no dsh credential value and writes none to its config or database

  @core
  Scenario: R7 — dsh is a configurable executor tier entry
    # covers: I4
    Given config/config.global.yaml and config/config.example.yaml
    When an operator lists the supported executors and enables dsh in a tier
    Then dsh is a recognised agent name and executor selection can resolve it

  @core
  Scenario: R8 — Spur services recognise dsh processes and failures
    # covers: I5
    Given a running dsh executor process
    When process identity, run-session observation and failure classification inspect it
    Then the process is attributed to dsh
    And a dsh quota or auth error is classified with provider dsh instead of unknown

  @core
  Scenario: R9 — MCP readiness and the Board integrations row cover dsh
    # covers: I5, I6
    Given the Board integrations page and the agent MCP readiness service
    When dsh is installed
    Then dsh appears with its binary, its YAML profile-patch config format and its MCP readiness verdict

  @core
  Scenario: R10 — sp skills are discovered by dsh
    # covers: I7
    Given Superskill has written sp-* skills to ~/.agents/skills
    When dsh lists its session skill catalog
    Then the sp skills appear with their names and descriptions

  @core
  Scenario: R11 — A real task runs through dsh and leaves a Spur run record
    # covers: I10
    Given dsh is installed and configured with a model provider
    When the E2E proof dispatches one bounded task to the dsh executor
    Then the run ends completed and a Spur run record names dsh as the executor
    And the proof writes a repeatable receipt artifact with the dsh version and session id

  @core
  Scenario: R12 — The NDJSON contract is pinned to a dsh version
    # covers: I11, I14
    Given a recorded dsh --json fixture captured from the pinned dsh version
    When the contract test replays it through the runner parser
    Then every event the shim depends on parses
    And the dsh capability record names the version it was verified against

  @edge
  Scenario: R13 — A dsh version mismatch is surfaced by doctor
    # covers: I14
    Given the dsh capability record verified against one version
    When doctor detects a different installed dsh version
    Then doctor reports the mismatch with both versions and does not disable the executor
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
<!-- END AUTO-GENERATED -->

## Notes

## History
