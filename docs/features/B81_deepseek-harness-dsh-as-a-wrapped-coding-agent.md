---
schema_version: 1
id: "B81"
name: "DeepSeek Harness (dsh) as a wrapped coding agent"
status: backlog
priority: P2
tags: []
created_at: "2026-11-26T19:33:42.587Z"
updated_at: "2026-11-26T22:05:55.120Z"
---

# B81: DeepSeek Harness (dsh) as a wrapped coding agent

## Goal

Spur can dispatch work to DeepSeek Harness (`dsh`) as a first-class wrapped coding agent, so operators who use dsh — and the plugins they install in their dsh profiles — can run Spur tasks and workflows on it with the same executor selection, run observation, failure classification and MCP readiness that the other ten agents have. Spur does not host or translate dsh (Cordis) plugins; the dsh ecosystem reaches Spur runs through dsh itself.

## Scope

**In scope**

- Upgrade the existing `deepseek` agent shim (binary `dsh`) in the released `@gobing-ai/ts-ai-runner` facade to the `dsh --profile headless` 0.2.x contract: `--json` in json mode, `--session-id` resume, fixed unattended permission flags, availability detection. Success is dsh's exit status, which is 0 only for a completed final turn.
- Spur recognition of the `deepseek` agent across executor config (`config/config.global.yaml`, `config/config.example.yaml`), process identity, run-session observation, failure classification, MCP readiness and the Board integrations row.
- A pinned-version NDJSON contract test and a doctor-visible version mismatch.
- Verification that the `sp-*` skills Superskill already writes to `~/.agents/skills` are discovered by dsh.
- One repeatable E2E receipt: a real task dispatched to dsh that leaves a Spur run record.

**Out of scope**

- Hosting, loading, or statically extracting dsh/Cordis plugins inside Spur.
- The Superskill `dsh` install target for hooks and the MCP profile patch (follow-up feature B811).
- Spur history-plane coverage of the importer's existing `deepseek` source (follow-up feature E11).
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
    Then the command is dsh --profile headless with the task as a --pinned positional after --
    And no dsh plugin is loaded, translated or inspected by Spur or the runner

  @core
  Scenario: R2 — The dsh shim emits --json only in json mode
    # covers: I2
    Given the ts-ai-runner deepseek shim
    When a prompt is built with output mode json
    Then the command carries --json
    And a text-mode prompt carries no --json
    And the shim parses no dsh output events

  @core
  Scenario: R3 — Success requires exit zero and a completed final reason
    # covers: I3
    Given recorded dsh --json runs, one completed and one not completed
    When the contract test compares each exit status with its final event
    Then exit 0 occurs only with final.reason.kind completed
    And Spur treats the dsh exit status as the run outcome

  @core
  Scenario: R4 — A dsh run resumes by session id
    # covers: I2
    Given a previous dsh run whose session event named session-abc
    When a stage resumes that executor session
    Then the command carries --session-id session-abc
    And the dsh capability record declares resumeById true

  @core
  Scenario: R5 — dsh runs carry fixed unattended permission flags
    # covers: I2
    Given a fresh or resumed dsh prompt
    When the dsh command is built
    Then it carries --permission-mode workspace-write and --approval-policy never

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
    Then deepseek is a recognised agent name and executor selection can resolve it

  @core
  Scenario: R8 — Spur services recognise dsh processes and failures
    # covers: I5
    Given a running dsh executor process
    When process identity, run-session observation and failure classification inspect it
    Then the process is attributed to deepseek when its executable name is distinguishable
    And the run's dsh session is observed through the importer's deepseek source

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
    When a dsh --json run is asked to load one named sp skill
    Then the stream carries a skill tool_call naming it and a non-error tool_result

  @core
  Scenario: R11 — A real task runs through dsh and leaves a Spur run record
    # covers: I10
    Given dsh is installed and configured with a model provider
    When the E2E proof dispatches one bounded task to the dsh executor
    Then the run exits 0 and a Spur run record names the deepseek executor
    And the proof writes a repeatable receipt artifact with the dsh version and session id

  @core
  Scenario: R12 — The NDJSON contract is pinned to a dsh version
    # covers: I11, I14
    Given a recorded dsh --json fixture captured from the pinned dsh version
    When the contract test replays it
    Then the session id and final reason fields the proofs depend on parse
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
| WBS | Task | Status |
| --- | ---- | ------ |
| 1457 | Spur wiring for the dsh executor: config, services, Board row and doctor version check | todo |
| 1458 | dsh E2E proof: skill discovery and a real task run record | todo |
| 1456 | dsh agent shim in ts-ai-runner with a pinned NDJSON contract | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-11-26T21:03:52.262Z moved U → B81 (system)

