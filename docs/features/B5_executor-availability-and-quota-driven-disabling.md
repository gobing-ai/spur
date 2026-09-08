---
schema_version: 1
id: "B5"
name: "Executor availability and quota-driven disabling"
status: done
priority: P2
tags: []
created_at: "2026-09-07T16:18:52.158Z"
updated_at: "2026-09-08T04:10:23.608Z"
---

# B5: Executor availability and quota-driven disabling

## Goal

Keep exhausted or intentionally disabled executors visible and out of subsequent dispatches, with precise quota events driving safe, project-local configuration updates.

## Scope

- In: optional executor disabled booleans in global and project configuration, merged defaults, eligibility across agent/workflow/team paths, and doctor text/JSON behavior.
- In: exact-name project-only YAML updater, concurrency checks, precise upstream quota event production and attribution, durable asynchronous local-server consumption, runtime refresh, and recovery event contract/consumer.
- In: regression coverage and synchronized configuration, event, and operational documentation.
- Out: automatic recovery detection, provider polling, account-wide fan-out, global configuration writes, insertion of missing project entries, new public CLI verbs, dynamic executor CRUD, and Cloudflare filesystem mutation.
- Limits: uninstrumented agent sessions cannot emit these events; global-only executors cannot be persistently disabled by the project-only updater.

## Acceptance Criteria

```gherkin
Feature: Executor availability and quota-driven disabling

  @core
  Scenario: R1 — Legacy configuration and layered overrides preserve availability
    Given global and project executor entries omit disabled
    When the merged configuration is loaded
    Then effective disabled is false; a global true survives project omission and an explicit project false overrides it

  @core
  Scenario: R2 — Executor disabled values are strictly boolean
    Given an executor declares disabled as a string, null, or number
    When Zod and the shipped JSON Schema validate the configuration
    Then both reject it while accepting omitted, true, and false values

  @core
  Scenario: R3 — Automatic routing excludes disabled executors
    Given the cheapest eligible executor is disabled and another enabled candidate exists
    When role, default, workflow, escalation, or role-based team selection runs
    Then only enabled candidates may launch and an all-disabled candidate set fails with a nonzero resolution error

  @core
  Scenario: R4 — Explicit disabled executor references fail before spawn
    Given a disabled executor is explicitly pinned by agent run, a workflow, or a team member
    When execution resolves the reference
    Then it returns a disabled-executor error before spawning and never substitutes a binary or another executor

  @core
  Scenario: R5 — Doctor displays exclusions without electing or probing them
    Given the inventory contains disabled and enabled usable executors
    When doctor renders the inventory or a role ladder in text and JSON
    Then disabled entries remain visible with disabled true and usable false, receive no health probe or election, and successful role JSON places its enabled elected entry first

  @core
  Scenario: R6 — Doctor exit status distinguishes inventory and explicit checks
    Given an enabled healthy executor and a disabled executor are configured
    When full-inventory, explicit-disabled, and all-disabled-role doctor checks run
    Then the healthy inventory succeeds, the explicit-disabled check fails, and the all-disabled role fails

  @core
  Scenario: R7 — Project updates change only an exact existing entry
    Given the project YAML contains executor alpha, executor alphabet, comments, and unrelated settings
    When the updater sets alpha disabled to false
    Then only alpha disabled becomes explicitly false, including for a name-only project fragment, and an already matching explicit value causes no rewrite

  @core
  Scenario: R8 — Missing or invalid project targets never cause unintended writes
    Given the project file, executor list, or exact name is absent, or the YAML has invalid or ambiguous duplicate entries
    When the updater is called
    Then absent targets return a structured no-op, invalid targets return an actionable error, and no file, section, entry, or global override is created

  @core
  Scenario: R9 — Concurrent configuration writes preserve unrelated edits
    Given two updater calls target different executors and an external editor may change the same file
    When updates attempt to commit
    Then updater writes serialize, detectable external changes cause conflict instead of overwrite, and failed atomic writes preserve the original file

  @core
  Scenario: R10 — Confirmed quota failures emit one precise attributed event
    Given a supported instrumented invocation or health observation confirms exhausted usage allowance or credits
    When the shared runner classifies the observation
    Then one agent.quota.exhausted event carries stable observation identity and the exact available project and executor attribution across buffered and streaming paths

  @core
  Scenario: R11 — Transient and unrelated failures never persistently disable executors
    Given a failure is generic HTTP 429, throttling, overload, authentication, context length, output budget, timeout, or unrelated quoted text
    When the failure is classified
    Then no quota-exhaustion event or persistent disable occurs solely from that evidence and the original failure result remains intact

  @core
  Scenario: R12 — Quota updates survive process boundaries and server restarts
    Given a valid quota event is emitted by a CLI or server process for the same project while the server may be offline
    When the local server starts and processes pending updates
    Then the existing named project entry becomes disabled exactly through the common updater and event display or history pruning does not silently discard accepted pending work

  @core
  Scenario: R13 — Duplicate stale and unattributed quota events cannot overwrite state
    Given events repeat an observation, predate a newer applied executor observation, or lack trustworthy exact project and executor identity
    When the consumer processes them
    Then duplicate and stale observations cause no repeated mutation, ambiguous targets are reported without writes, and failed writes remain observable and retryable

  @core
  Scenario: R14 — Subsequent dispatches see availability changes immediately
    Given an executor exhausts quota during a long-running workflow or its project disabled value changes
    When a fallback or subsequent dispatch resolves candidates
    Then the current invocation excludes the exhausted executor without waiting for persistence and subsequent decisions reload effective availability without server restart

  @core
  Scenario: R15 — Recovery is a reserved explicit reenable contract
    Given a trusted agent.quota.recovered event targets an existing project executor
    When the consumer applies it
    Then the common updater sets disabled false, missing entries remain absent, and no timer, polling process, or automatic recovery producer is introduced

  @core
  Scenario: R16 — Server lifecycle owns one quota update consumer
    Given the local server starts with pending quota updates and autostart work
    When startup and then graceful shutdown run
    Then quota consumption is ready before dispatch, one ordered mutation path applies events, and shutdown detaches listeners and drains active writes
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0796 | Respect executor disabled state in routing and doctor | done |
| 0797 | Safely update one existing project executor disabled flag | done |
| 0798 | Emit precise attributed quota events from the shared agent runner | done |
| 0799 | Apply durable quota updates and refresh running executor selection | done |
<!-- END AUTO-GENERATED -->

## Notes

Approved evaluation: [executor availability evaluation](../plans/2026-09-07-agent-executor-disabled-brainstorm.md).

Proposed system design: [executor availability](../design/executor-availability.md), ADR-111.
The proposed durable latest-observation record replaces the evaluation's tentative ledger-consumer mechanism; scope is unchanged.
Idea run bd360df4-561f-40f5-94a7-ae7132c55984 is awaiting the design-approval gate before decomposition.
The upstream runner implementation/release is an integration prerequisite, not an assumed installed capability.

## History

- 2026-09-08T03:44:37.721Z backlog → active (system)
- 2026-09-08T03:44:37.957Z active → verifying (system)
- 2026-09-08T04:10:23.608Z verifying → done (system)

