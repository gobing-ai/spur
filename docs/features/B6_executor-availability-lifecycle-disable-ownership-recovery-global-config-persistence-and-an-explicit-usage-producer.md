---
schema_version: 1
id: "B6"
name: "Executor availability lifecycle: disable ownership, recovery, global-config persistence, and an explicit usage producer"
status: done
priority: P2
tags: []
created_at: "2026-09-17T23:02:01.980Z"
updated_at: "2026-09-18T06:33:17.238Z"
---

# B6: Executor availability lifecycle: disable ownership, recovery, global-config persistence, and an explicit usage producer

## Goal

An executor disabled by quota comes back on its own, an executor the operator disabled never does, every executor (project- or global-declared) can be updated, and the routing ladder can be refreshed from an explicit usage snapshot before dispatch — so `--agent auto` stops degrading monotonically after the first quota event.

## Scope

- In:
  - **Disable ownership.** Every `disabled` executor entry carries an owner (`quota` | `operator` | `probe`), a timestamp and a reason. A bare `disabled: true` with no owner is operator-owned.
  - **Recovery consumer.** `agent.quota.recovered` events (already emitted upstream, dropped by B5) and a usage snapshot showing headroom re-enable **quota-owned** disables only.
  - **Global-config persistence.** The YAML updater can target `~/.config/spur/config.yaml` for executors declared only there (today the project updater cannot persist them).
  - **Explicit run-once usage producer.** A command that captures `codexbar usage --format json --provider all` into a snapshot file, maps providers to executors, and applies quota-owned disable/enable through the same updater. Run-once by contract; scheduling is external (cron/launchd, like `spur history daily`). Verb/flag shape decided at design with ADR-051 consent.
  - **Reactive fallback.** When codexbar is absent or fails, the producer reports the cause and changes nothing; the B5 event path keeps working unchanged.
  - **Doctor rendering.** `spur agent doctor` shows the availability owner, reason and age; a stale snapshot is rendered stale, never as usable.
- Out:
  - Any provider polling or timer inside `spur serve`.
  - Synthetic recovery without evidence (time-based re-enable is not in scope).
  - Runner (`ts-ai-runner`) changes — feature B8.
  - Board UI for availability.

## Acceptance Criteria

```gherkin
Feature: Executor availability lifecycle

  @core
  Scenario: R1 — A quota-driven disable records its owner, timestamp and reason
    Given an executor is usable
    When an agent.quota.exhausted event for its provider is drained
    Then the executor entry is persisted as disabled with owner quota, a timestamp and the event reason
    And an executor entry with disabled true and no owner is treated as operator-owned

  @core
  Scenario: R2 — An operator-owned disable is never re-enabled automatically
    Given an executor disabled with owner operator
    When a recovery event or a usage snapshot with headroom arrives for its provider
    Then the executor stays disabled
    And the skipped recovery is logged with the owner as the reason

  @core
  Scenario: R3 — A quota-owned disable recovers on evidence
    Given an executor disabled with owner quota
    When an agent.quota.recovered event is drained or a usage snapshot shows headroom for its provider
    Then the executor is persisted as enabled
    And the loader cache is invalidated so the next resolution sees it

  @core
  Scenario: R4 — A global-only executor is persisted in the global config
    Given an executor declared only in the global config file
    When a quota-owned disable or recovery is applied
    Then the global config file is rewritten atomically with a backup
    And the project config file is not modified

  @core
  Scenario: R5 — The usage producer captures a snapshot and applies quota-owned changes
    Given codexbar is installed and returns usage JSON for all providers
    When the operator runs the usage producer command
    Then a snapshot file is written with the raw usage and a captured_at timestamp
    And each provider is mapped to its executors through the executor config
    And quota-owned disable and enable changes are applied through the shared updater
    And a provider entry that reports an error is skipped without changing its executors

  @core
  Scenario: R6 — The usage producer supports a dry run
    Given a usage snapshot that would change executor availability
    When the operator runs the usage producer with the dry-run flag
    Then the intended changes are printed with their owner and reason
    And no config file is written

  @core
  Scenario: R7 — A missing or failing codexbar changes nothing
    Given codexbar is not installed or its output is not a parsable array of provider entries
    When the operator runs the usage producer command
    Then the command exits non-zero naming the cause
    And no executor availability is changed
    And the reactive quota event path keeps working

  @core
  Scenario: R8 — Doctor renders availability ownership and age
    Given an executor disabled with owner quota at a known time
    When the operator runs spur agent doctor
    Then the row shows the owner, the reason and the age of the decision
    And a usage snapshot older than the configured maximum age is rendered as stale

  @edge
  Scenario: R9 — The producer is never scheduled by spur serve
    Given spur serve is running
    When the server starts and runs for any duration
    Then it never invokes the usage producer or polls a provider
    And the documentation carries an external scheduling example

  @edge
  Scenario: R10 — Owner precedence resolves concurrent writers
    Given the event drain and the usage producer write the same executor in the same window
    When both changes reach the updater
    Then writes are serialized through the single updater
    And an operator-owned state is never overwritten by a quota-owned one
```

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0890 | Executor availability ownership: widen agent.executors[].disabled to carry owner/since/reason, normalize readers, and enforce owner precedence in the B5 drain | done |
| 0891 | Global-layer availability updater and quota recovery consumer: setExecutorAvailability targets the declaring config layer and agent.quota.recovered re-enables quota-owned executors | done |
| 0892 | Add spur agent usage: run-once codexbar usage producer with snapshot file, provider-to-executor mapping, dry run, fail-closed exit, and the ADR-051 consent row | done |
| 0893 | Doctor availability provenance: render owner, since, reason and usage-snapshot age, and mark stale snapshots | done |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-09-18T03:24:54.165Z backlog → active (system)
- 2026-09-18T06:22:50.114Z active → verifying (system)
- 2026-09-18T06:33:17.238Z verifying → done (system)

