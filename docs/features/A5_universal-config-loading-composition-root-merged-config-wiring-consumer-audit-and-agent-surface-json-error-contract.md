---
schema_version: 1
id: "A5"
name: "Universal config loading: composition-root merged-config wiring, consumer audit, and agent-surface --json error contract"
status: backlog
priority: P2
tags: []
created_at: "2026-08-25T05:45:24.392Z"
updated_at: "2026-08-25T05:48:16.656Z"
---

# A5: Universal config loading: composition-root merged-config wiring, consumer audit, and agent-surface --json error contract

## Goal
Make the merged, layered Spur config (global `~/.config/spur/config.yaml` as defaults, project `.spur/config.yaml` overriding it) the single source of config truth for every CLI process, so the shipped config 1.2 layering contract is actually delivered at the composition root and no legacy, stale, or ad-hoc config-loading path survives. Agent-surface failures (e.g. `spur agent doctor coder`) resolve roles against the merged config and report errors through the standard `--json` error envelope.
## Scope
### In scope

- Wire the composition root (`apps/cli/src/index.ts`, `runNodeApplication`) so `loadSpurConfig`'s merged result is loaded once in `main()` and threaded into dispatch context as the only app-config source; ts-infra keeps only the project-shaped `bootstrap` section.
- Comprehensive audit of every `appRt.appConfig` read and per-slice `loadSpurConfig` call (workflow-service ×4, team-service, serve, history-refresh, workflow.ts, and any others found) so the merged loader is the only app-config path; remove or repoint stale/legacy single-file readers.
- Fix `spur agent doctor <role>` (e.g. `coder`) so role/executor resolution sees globally defined executors when the project config has no `agent:` section; make the `DEFAULT_AGENT_ROLES` silent fallback an explicit, recorded decision.
- Normalize agent-surface failure output to the CLI `--json` convention (`toJson({ error: { code, message } })`), fixing plain-text error paths such as `agent.ts:746` / `message.ts:415`.
- CLI-level layering regression tests covering the composition root (the gap that let this ship green).
- Related agent-executor resolution spots surfaced by the audit that share the same root cause.

### Out of scope

- Changing the 1.2 merge semantics of `loadSpurConfig` itself (by-name executor merge, path concatenation, single validation) — it is already layering-tested.
- Pushing layering into ts-infra (`configFiles: string[]` / generic merge hooks) as a platform capability — a later evolution, not a prerequisite.
- Config schema changes, new config keys, or a config 1.3 version bump.
- Unrelated agent-surface UX or doctor-feature enhancements beyond the config-resolution and `--json` error-contract fixes.
- Adjacent findings from the audit that do not share the config-loading root cause (record separately; no scope creep).
## Acceptance Criteria
```gherkin
Feature: Universal config loading: composition-root merged-config wiring, consumer audit, and agent-surface --json error contract

  @core
  Scenario: R1 — Merged config is loaded once at the composition root and threaded into dispatch
    Given a global config at `~/.config/spur/config.yaml` and a project config at `.spur/config.yaml`
    When any `spur` CLI command runs
    Then `loadSpurConfig` is invoked exactly once in `main()` and the merged result is the only app-config source available through the dispatch context

  @core
  Scenario: R2 — A config value defined only in the global config is honored by every CLI command
    Given the global config defines an executor `coder` and the project config has no `agent:` section
    When a CLI command that resolves the `coder` executor runs
    Then the globally defined `coder` executor is used

  @core
  Scenario: R3 — A project config value overrides the same key in the global config
    Given the global config and the project config both define the executor `coder` with different settings
    When a CLI command that resolves the `coder` executor runs
    Then the project config's `coder` settings win

  @core
  Scenario: R4 — Service slices consume the threaded merged config instead of loading their own
    Given a workflow-engine setting defined only in the global config
    When `spur workflow run` executes through the workflow service
    Then the workflow service observes the global setting from the merged config in the dispatch context

  @core
  Scenario: R5 — No stale or ad-hoc config-loading path survives the consumer audit
    When the codebase is checked for per-slice `loadSpurConfig` calls and `appRt.appConfig` reads outside the composition root
    Then workflow-service, team-service, serve, history-refresh, and workflow.ts all consume the threaded merged config and no legacy single-file reader remains

  @core
  Scenario: R6 — `spur agent doctor` resolves a globally defined executor when the project config has no `agent:` section
    Given the global config defines an executor for role `coder` and the project config has no `agent:` section
    When the user runs `spur agent doctor coder`
    Then doctor resolves the role against the merged config and reports the `coder` executor as configured

  @core
  Scenario: R7 — The DEFAULT_AGENT_ROLES fallback is explicit when no config defines the role
    Given neither the global config nor the project config defines an executor for role `coder`
    When the user runs `spur agent doctor coder`
    Then doctor reports that the built-in DEFAULT_AGENT_ROLES fallback is in effect instead of applying it silently

  @core
  Scenario: R8 — The DEFAULT_AGENT_ROLES fallback decision is recorded
    When the fallback behavior in R7 ships
    Then the decision to retain DEFAULT_AGENT_ROLES as an explicit fallback is recorded in the project's decision record

  @core
  Scenario: R9 — Agent-surface failures emit the standard `--json` error envelope
    Given an agent command invocation that will fail, such as `spur agent doctor` with an unresolvable role
    When the user runs the command with `--json`
    Then stdout carries `toJson({ error: { code, message } })`, the exit code is non-zero, and no plain-text error is printed

  @core
  Scenario: R10 — Message-surface failures emit the standard `--json` error envelope
    Given a `spur message send` invocation that will fail
    When the user runs the command with `--json`
    Then stdout carries `toJson({ error: { code, message } })`, the exit code is non-zero, and the former plain-text error path is gone

  @core
  Scenario: R11 — CLI-level layering regression tests cover the composition root
    When the CLI test suite runs
    Then tests exercising the real CLI entry assert that a global-only default and a project override both reach a dispatched command, and the suite fails if dispatch reverts to single-file loading

  @edge
  Scenario: R12 — The CLI works when no global config file exists
    Given no file at `~/.config/spur/config.yaml` and a valid project config
    When any `spur` CLI command runs
    Then the command proceeds with the project config and built-in defaults without a config-loading error

  @edge
  Scenario: R13 — An invalid global config fails once with a single validation error
    Given a global config file containing invalid YAML
    When the user runs any `spur` CLI command with `--json`
    Then the command exits non-zero with one `--json` error envelope naming the global config file path, not one error per consumer

  @edge
  Scenario: R14 — Long-running surfaces observe the same merged config as one-shot commands
    Given a setting defined only in the global config
    When `spur serve` or a history-refresh pass starts
    Then the surface behaves according to the global setting, identically to a one-shot command
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0665 | Wire merged config at composition roots and rewire every consumer | todo |
| 0666 | Agent-surface fallback provenance and --json error envelope | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History
