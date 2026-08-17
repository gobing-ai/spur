---
schema_version: 1
id: "I5"
name: "dev-history-load command: on-demand cumulative import + analyze"
status: active
priority: P2
tags: []
created_at: "2026-08-16T06:43:02.398Z"
updated_at: "2026-08-16T23:34:01.251Z"
---

# I5: dev-history-load command: on-demand cumulative import + analyze

## Goal
Ship a `/sp:dev-history-load` slash command that turns the on-demand "load history, then analyze"
sequence into one discoverable surface: a cumulative, idempotent `spur history import` (checkpoint
resume — re-runs only add newly created conversation data) followed by `spur history analyze`, with
`--session` / `--task` / `--since` / `--until` / `--source` narrowing for post-conversation
investigation and an optional `--report` forensics render, delegating the periodic cadence to the
already-shipped `spur history daily`.
## Scope
In:

- A new slash command `plugins/sp/commands/dev-history-load.md` that runs, in order: `spur history
  import` (cumulative — checkpoint resume makes re-runs additive and idempotent) then `spur history
  analyze`, composing the two verbs behind one surface.
- Narrowing passthrough flags: `--session`, `--task`, `--since`, `--until`, `--source`, forwarded to
  the import/analyze verbs with shared semantics.
- Optional `--report` flag rendering `spur history report --mode forensics` after analyze.
- `--json` and `--dry-run` support: `--dry-run` previews the sequence without persisting.
- Command doc + plugin test coverage + flag-glossary conformance, matching the `/sp:dev-*` family.

Out:

- Periodic cadence: `spur history daily` remains the scheduled loop (per-source isolation,
  checkpoint self-heal, 90-day prune, report retention) — this command delegates to it, never
  re-implements it.
- New import logic, schema changes, or new CLI verbs — every step reuses an existing `spur history`
  verb; zero new import state beyond what checkpoint resume already provides.
- Forensics-derived variables, report renderers, or `/sp:dev-find-issue` rewrite work — owned by
  feature E2.
- A bare forwarder of `spur history daily` (ADR-016: the command must convert intent into a reliable
  sequence, not duplicate an existing surface).
## Acceptance Criteria
```gherkin
Feature: dev-history-load command: on-demand cumulative import + analyze

  @core
  Scenario: R1 — The command file ships with the /sp:dev-* family contract
    Given the sp plugin command directory "plugins/sp/commands"
    When "dev-history-load.md" is loaded
    Then its frontmatter declares "description", "argument-hint", and "allowed-tools"
    And the argument-hint lists "--session", "--task", "--since", "--until", "--source", "--report", "--dry-run" and "--json"
    And the body links the shared flag glossary at "../skills/spur-dev/references/flag-glossary.md"
    And the plugin command structure test suite passes for the new file

  @core
  Scenario: R2 — A bare invocation loads history then analyzes it, in that order
    Given a project with importable agent conversation JSONL under the configured history roots
    When the operator runs "/sp:dev-history-load" with no flags
    Then the command runs "spur history import --source all" before "spur history analyze"
    And the analyze step runs only after the import step exits 0
    And the run reports the imported record count and the written analyze artifact path

  @core
  Scenario: R3 — Re-running is cumulative and never double-counts
    Given "/sp:dev-history-load" has already been run once and its checkpoints are persisted
    And three new conversation messages have since been appended to one source
    When the operator runs "/sp:dev-history-load" a second time
    Then the import step resumes from the persisted checkpoint rather than rescanning from zero
    And exactly the three new messages are added to the history tables
    And no previously imported message is duplicated

  @core
  Scenario: R4 — Narrowing flags reach the verb that actually accepts them
    Given the operator wants to investigate a single conversation
    When the operator runs "/sp:dev-history-load --session <session-id> --since <iso> --until <iso>"
    Then "--session", "--since" and "--until" are forwarded to "spur history analyze" only
    And they are not forwarded to "spur history import", which does not accept them
    And "--source <name>" is forwarded to both "spur history import" and "spur history analyze"
    And "--task <wbs>" is forwarded to "spur history analyze"

  @core
  Scenario: R5 — --report renders the forensics view after analyze
    Given a successful analyze step has written an artifact
    When the operator runs "/sp:dev-history-load --report"
    Then the command runs "spur history report --mode forensics" against the artifact just written
    And the rendered report is surfaced to the operator
    And omitting "--report" leaves the artifact written but unrendered

  @core
  Scenario: R6 — --dry-run previews the sequence without persisting
    Given importable conversation JSONL that has not yet been imported
    When the operator runs "/sp:dev-history-load --dry-run"
    Then "spur history import --dry-run" scans without persisting imported records
    And no analyze artifact is written
    And the command prints the sequence it would have run
    And a subsequent non-dry run still imports every record the dry run scanned

  @core
  Scenario: R7 — --json emits a machine-readable result
    Given a caller that parses the command output programmatically
    When the operator runs "/sp:dev-history-load --json"
    Then the output is a single JSON object carrying the import summary, the analyze artifact path, and the overall status
    And no human-formatted banner text is interleaved into the JSON payload

  @core
  Scenario: R8 — The command delegates the periodic cadence instead of duplicating it
    Given "spur history daily" already owns import-all, analyze, artifact write and 90-day prune
    When the command documentation describes periodic usage
    Then it directs the operator to "spur history daily" for the scheduled cadence
    And the command itself never prunes reports and never re-implements the daily pipeline
    And the command is not a bare forwarder of "spur history daily" (ADR-016)

  @edge
  Scenario: R9 — A fully failed import aborts before analyze and propagates the exit code
    Given the import step reports all sources failed (exit 1)
    When the operator runs "/sp:dev-history-load"
    Then the analyze step is not run
    And the command surfaces the failing source and the import error
    And the command exits with the import step's non-zero exit code

  @edge
  Scenario: R11 — A degraded fan-out proceeds to analyze with a loud warning
    Given the import step exits 2 for a mixed/degraded fan-out with at least one source imported
    When the operator runs "/sp:dev-history-load"
    Then the analyze step runs and the command exits 0 after a successful analyze
    And the command surfaces a per-source warning naming each degraded source and its parse/validation error counts
    And in --json mode the payload carries a "warnings" array with each source's counts and warning detail

  @edge
  Scenario: R10 — Narrowing to a window with no imported rows fails loudly
    Given the history tables contain no messages inside the requested "--since"/"--until" window
    When the operator runs "/sp:dev-history-load --since <iso> --until <iso>"
    Then the command reports that the window matched zero messages
    And it does not present an empty artifact as a successful analysis
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0567 | dev-history-load slash command: cumulative import then narrowed analyze | done |
| 0569 | dev-history-load: degraded-source tolerance for bare runs (exit 2 proceeds with warning) | todo |
<!-- END AUTO-GENERATED -->

## Notes

## History

- 2026-08-16T06:52:57.394Z moved L → I5 (system)
- 2026-08-16T07:37:57.553Z backlog → active (system)
