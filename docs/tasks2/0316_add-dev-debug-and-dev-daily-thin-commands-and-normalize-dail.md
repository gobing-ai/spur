---
template: feature-impl
schema_version: 1
name: "Add dev-debug and dev-daily thin commands and normalize daily-summary env/links"
description: ""
status: todo
type: task
profile: standard
feature_id: O
parent_wbs: "0314"
priority: P2
tags: []
dependencies: ["0315"]
created_at: "2026-07-23T06:11:55.082Z"
updated_at: "2026-07-23T06:17:38.795Z"
---

## 0316. Add dev-debug and dev-daily thin commands and normalize daily-summary env/links

### Background
Decomposed from parent **0314** (feature O) — read 0314 for the full audit and cross-cutting rationale. This subtask owns the **two new thin entry points** and the `daily-summary` cleanup. It is the only subtask that changes the command count (28 → 30), so it owns the README inventory rows, the command-count test, and the plugin version bump.

Verified state:

- `sp:sys-debugging` and `sp:daily-summary` are mature skills (`skills/sys-debugging/SKILL.md`, `skills/daily-summary/SKILL.md`) with no discoverable `/sp:dev-*` entry point.
- The `daily-summary` script still honors the stale `RD3_DAILY_SUMMARY_NO_PROMPT` env var (`scripts/daily-summary/daily-summary.ts`) and supports `--date`, `--dry-run`, `--output`, `--no-git`, `--no-ccusage`.
- `skills/daily-summary/SKILL.md` links a stale script path (`scripts/daily-summary.ts`) — the real path is `scripts/daily-summary/daily-summary.ts`.
- `plugins/sp/README.md` reports version `0.3.18` while `plugin.json` is `0.3.20`; the README command index currently lists 28 commands.
### Requirements
- R1. Preserve commands-as-SSOT and the thin-wrapper architecture. Both new command files contain only frontmatter, H1, `Usage`, `Implementation`; the reproduce/report procedures stay in their backing skills. Do not commit generated platform adapters.

- R5. Add a thin `dev-debug` command backed by `sp:sys-debugging`. Define a small explicit input contract for a symptom or failing command plus optional scope/task capture. The backing skill remains the SSOT for reproduce → isolate → root cause → minimal fix → regression test; issue-task creation goes through `spur task create --template issue` plus CLI-gated section writes. Only the minimal public argument/output contract may be added to the skill.

- R6. Add a thin `dev-daily` command backed by `sp:daily-summary`, exposing the script's existing `--date`, `--dry-run`, `--output`, `--no-git`, `--no-ccusage` modes. Rename `RD3_DAILY_SUMMARY_NO_PROMPT` → `SP_DAILY_SUMMARY_NO_PROMPT` with a documented compatibility window (the old name is still honored with a deprecation note for at least one release). Fix the stale SKILL.md script link. Keep missing optional telemetry tools (ccusage, etc.) graceful. Reuse the existing tested script — do not duplicate it.

- R8 (slice). Add `dev-debug` and `dev-daily` rows to the README command inventory exactly once each, placed in the correct taxonomy group; update the command count 28 → 30.

- R9 (slice). Bump the command-count assertion 28 → 30; add `dev-debug`/`dev-daily` dispatch tests; assert the Codex converter stages an `sp`-prefixed skill for each of the two new basenames.

- R11 (slice). Update same-commit T3 docs (`docs/04_DESIGN.md`, README) and add a changelog entry. **This subtask owns the version bump** — synchronize `plugin.json`, marketplace metadata, and the README `0.3.18` reference to the current version.

- R12 (slice). Verify via the command validator, plugin tests/hooks, and the full quality gate; run `superskill install sp --targets codex --dry-run --verbose` and assert both new staged skill names; fresh-session dogfood both new commands in observe-only/dry-run-safe scenarios.
### Acceptance Criteria
```gherkin
Feature: dev-debug and dev-daily entry points

  Scenario: R5 - dev-debug delegates the debugging protocol
    Given the mature sys-debugging skill
    When /sp:dev-debug is invoked with a symptom or failing command
    Then the wrapper delegates reproduce-isolate-root-cause-fix-regress without copying the protocol into the wrapper
    And optional scope/task capture routes issue-task creation through spur task create --template issue

  Scenario: R6 - dev-daily delegates the existing script modes
    Given the daily-summary script and skill
    When /sp:dev-daily is invoked
    Then it exposes the existing --date, --dry-run, --output, --no-git, and --no-ccusage modes
    And the stale RD3_DAILY_SUMMARY_NO_PROMPT variable is renamed to an SP-owned name
    And the old variable is still honored for at least one release with a deprecation note
    And the stale SKILL.md script link is corrected
    And missing optional telemetry tools degrade gracefully

  Scenario: R8/R9 - Inventory, count, and version stay consistent
    Given two new commands are added
    When the surface is updated
    Then the README command inventory lists dev-debug and dev-daily exactly once each
    And the command-count assertion is 30
    And plugin.json, marketplace metadata, and the README version reference are synchronized

  Scenario: R9/R12 - Converter stages every command and gates pass
    Given the updated plugin command directory
    When superskill install sp --targets codex --dry-run --verbose runs
    Then every command basename (including dev-debug and dev-daily) has a corresponding staged sp-prefixed Codex skill
    And no generated platform adapter is committed in plugins/sp
    And the command validator, plugin tests, hooks tests, lint, test, test-cf, and build gates exit zero
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Two new **thin `Skill()` wrappers** that expose distinct, frequent operator jobs with stable argument contracts: `dev-debug` for incident/root-cause work, `dev-daily` for end-of-day reporting. No lifecycle prose in the wrappers — the backing skills own it. Do **not** add wrappers for composed disciplines (`spur-tdd`, `source-driven-development`, `indexed-context`, `doubt-driven-development`, `doc-evolve`).

**dev-debug** → `Skill(skill="sp:sys-debugging", args="$ARGUMENTS")`. The public contract: `"<symptom | failing command>" [--scope <path>] [--task [<wbs>]]`. Issue-task creation is CLI-gated (`spur task create --template issue` + section writes).

**dev-daily** → invokes the existing tested `scripts/daily-summary/daily-summary.ts`, passing through `--date/--dry-run/--output/--no-git/--no-ccusage`. No script duplication. Env rename uses **dual-read compatibility**: read `SP_DAILY_SUMMARY_NO_PROMPT` first, fall back to `RD3_DAILY_SUMMARY_NO_PROMPT` with a one-time deprecation warning.

Version bump is centralized here because this is the count-changing subtask: `plugin.json` → marketplace metadata → README version line move together in one commit (T3).
### Plan
1. Add `commands/dev-debug.md` (thin `Skill()` wrapper → `sp:sys-debugging`); add only the minimal public arg/output contract to the skill; add command + dispatch test.
2. Add `commands/dev-daily.md` (thin wrapper → `scripts/daily-summary/daily-summary.ts` modes); implement the env rename with dual-read compat; fix the stale SKILL.md link; keep optional telemetry graceful.
3. Update README command inventory (+2 rows, correct taxonomy group) and bump the command-count test 28 → 30.
4. Synchronize the plugin version across `plugin.json`, marketplace metadata, and the README `0.3.18` reference; update `docs/04_DESIGN.md`; add a changelog entry.
5. Run the validator and the Codex dry-run; assert both new staged skill names; fresh-session dogfood both commands; run the full gate and inspect git status.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Parent **0314** and sibling **0315** (this task depends on 0315 for the README inventory + command-contract test coupling)
- `plugins/sp/skills/sys-debugging/SKILL.md`, `plugins/sp/skills/daily-summary/SKILL.md`
- `plugins/sp/scripts/daily-summary/daily-summary.ts` (env var + modes)
- `plugins/sp/README.md`, `plugins/sp/plugin.json` (version sync)
- `plugins/sp/tests/command-contract.test.ts` (count assertion), `plugins/sp/scripts/validate-commands.ts`
- `docs/04_DESIGN.md` command-surface contract
### History
