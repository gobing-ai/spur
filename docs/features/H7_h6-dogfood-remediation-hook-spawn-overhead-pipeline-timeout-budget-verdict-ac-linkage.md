---
schema_version: 1
id: "H7"
name: "H6 dogfood remediation: hook spawn overhead, pipeline timeout budget, verdict AC linkage"
status: backlog
priority: P1
tags: []
created_at: "2026-07-31T04:30:55.740Z"
updated_at: "2026-07-31T05:02:24.906Z"
---

# H7: H6 dogfood remediation: hook spawn overhead, pipeline timeout budget, verdict AC linkage

## Goal
Repair the three defect classes surfaced by the H6 dogfood run
(`/skill:sp-dev-runall --feature H6 --auto`, 2026-07-31) so the next batch does not pay them
again: per-tool-call hook spawn overhead, an `agent.run` timeout budget below the observed step
ceiling, and a self-contradicting verdict/scenario AC linkage contract.

This is a remediation feature — no new product surface. It exists so the consolidated fix task
has a traceability parent that is not H5 or H6 (both in flight or closed, and neither's AC covers
this work).
## Scope
### In scope

- `task-write-guard` path prefilter, so a Write/Edit outside the task corpus no longer spawns
  `spur task resolve` (cross-repo: `~/xprojects/superskill`).
- `SessionStart` idempotency, so nested `agent.run` subprocesses stop registering as new sessions.
- `stepTimeoutMs` raise in both `task-pipeline.yaml` copies, plus a written timeout-recovery
  runbook.
- `normalizeEvidenceType` documentation aliases and a diagnostic in place of the silent row drop.
- Bracket-tag stripping in the scenario-to-verdict-row matching path, plus the linkage contract
  written into `ac-style-guide.md`.

### Out of scope

- Replacing `omp` as the default pipeline executor — needs data from the raised budget first.
- `spur` / `superskill` CLI startup optimisation as a general project.
- Redesigning the `[doc-only]` / `[advisory]` tag vocabulary.
- Tightening the `PostToolUse` matcher — ledger evidence does not support it.
## Acceptance Criteria
```gherkin
Feature: H6 dogfood remediation

  Scenario: R1 — Hook latency baseline is recorded from a bare shell
    Given the four R1 commands are run on a bare shell with no agent harness and no sandbox
    When three consecutive timings of each are collected
    Then the median wall time of each is written into Root Cause with the shell and host named
    And the R1 decision rule is applied in writing, stating whether the bun cold-start cost is
        real or a sandbox artifact

  Scenario: R2 — Write-guard skips the ownership spawn for non-corpus paths
    Given a PreToolUse payload for Write whose file_path cannot be a task file
    When the sp task-write-guard runs
    Then the decision is allow
    And spur task resolve is never spawned

  Scenario: R3 — Write-guard still denies raw writes to a real task file
    Given a PreToolUse payload for Write targeting an existing task-corpus file
    When the sp task-write-guard runs
    Then spur task resolve is consulted
    And the decision is deny carrying the edit-through-the-spur-CLI reason

  Scenario: R4 — Write-guard fails open when ownership cannot be determined
    Given a PreToolUse payload whose path survives the prefilter
    And spur task resolve errors, times out, or is absent from PATH
    When the sp task-write-guard runs
    Then the decision is allow

  Scenario: R5 — A nested agent subprocess reuses the ancestor session id
    Given .spur/context/.session.json names an active session
    When SessionStart fires again from a nested agent.run subprocess of that session
    Then no additional session_start line is appended to token-ledger.jsonl
    And .spur/context/.session.json still names the original session id

  Scenario: R6 — A genuinely new host session still opens a new session
    Given no active session is recorded for the current host session
    When SessionStart fires
    Then exactly one session_start line is appended
    And .spur/context/.session.json names the new session id

  Scenario: R7 — The pipeline test step gets a thirty minute budget
    Given both copies of task-pipeline.yaml
    When stepTimeoutMs is read from each
    Then both resolve to 1800000
    And spur workflow validate passes against both copies

  Scenario: R8 — The timeout-recovery runbook is discoverable from done-housekeeping
    Given an operator whose agent.run step was killed at the timeout wall
    When they open plugins/sp/skills/spur-dev/references/done-housekeeping.md
    Then they find the partial-handoff recognition signal, the manual green-gate commands, the
        exact force-done invocation with provenance override, the required verdict follow-up,
        and the recorded-reason honesty rule

  Scenario: R9 — Documentation evidence types parse instead of vanishing
    Given a verify-answer AC table whose evidence-type cell reads doc
    When spur task verdict is run with --from-answer
    Then the row appears in the verdict artifact with evidenceType static-ref
    And no row is discarded without a diagnostic naming the unrecognised value

  Scenario: R10 — A bracket-tagged AC row matches its untagged scenario title
    Given a feature scenario titled "R3 — Batch report names every skipped task"
    And a done task whose PASS verdict carries a MET row with id
        "[doc-only] R3 — Batch report names every skipped task"
    When spur feature check runs with --strict
    Then the scenario is verified
    And spur feature advance to done with --strict is not blocked by it

  Scenario: R11 — Tagging still exempts a row from executable evidence
    Given a MET verdict row tagged doc-only whose evidenceType is static-ref
    When the executable-evidence rule is applied
    Then the row status remains MET
    And an untagged MET row with static-ref evidence is still demoted to PARTIAL

  Scenario: R12 — The linkage contract is written down
    Given an operator authoring a verify-answer AC table for a documentation scenario
    When they read plugins/sp/skills/spur-dev/references/ac-style-guide.md
    Then they find the four accepted id forms, the evidence-type vocabulary including the new
        aliases, the tags that exempt a row from executable evidence, and the strict-advance
        precondition, with a worked example

  Scenario: R13 — No regression in the existing gate suites
    Given the full repository verification gate
    When lint, test, and build are run
    Then all three pass with no skipped tests introduced to reach green
```
## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
| WBS | Task | Status |
| --- | ---- | ------ |
| 0398 | Fix H6 dogfood defects: hook spawn overhead, pipeline agent.run timeouts, and verdict AC parser/linkage traps | backlog |
<!-- END AUTO-GENERATED -->

## Notes

## History
