---
template: feature-impl
schema_version: 1
name: "Complete the R10 least-privilege allowed-tools sweep across all sp command wrappers"
description: ""
status: todo
type: task
profile: standard
feature_id: O
parent_wbs: "0314"
priority: P2
tags: []
dependencies: []
created_at: "2026-07-23T06:59:26.486Z"
updated_at: "2026-07-23T07:00:39.763Z"
---

## 0318. Complete the R10 least-privilege allowed-tools sweep across all sp command wrappers

### Background
Follow-up surfaced by **0315**'s completed R2 28-command parity audit (recorded in 0315 `Notes`). 0315 correctly trimmed `dev-review` (`Write` dropped) and re-checked `dev-handover` (`Write` kept — it writes the handover file), but its R10 scope was **explicitly those two commands only**. The audit found the same over-privilege class on other wrappers: pure workflow / verify dispatchers carrying `Write`/`Edit` that only the workflow engine, spawned subagents, or the Bash-gated CLI actually use.

This task completes the R10 least-privilege sweep across all 28 command wrappers. It is **independent** of 0316/0317 — it touches only command frontmatter (`allowed-tools`) plus `command-contract.test.ts`, so it runs in parallel.

Write-paths traced 2026-07-22 (HIGH confidence, pre-evidenced):

- `dev-idea`, `dev-wrap`, `dev-wrapall` — implementation is a single `spur workflow run …` (Bash). The engine and any spawned subagents mutate, not the wrapper agent. `Write` + `Edit` are redundant. This is R10's explicitly-named pattern ("workflow wrappers must not retain Write/Edit solely because spawned workflow steps mutate").
- `dev-verify`, `dev-verifyall` — `Skill()` → `sp:code-verification`, which writes task sections via `spur task update --section --from-file` using a Bash-created temp file (verified first-hand this session — the verify run used only Bash heredocs, never the Write tool). `Write` is redundant, exactly as it was on `dev-review`.

Verify-then-decide (per-command write-path trace required, not pre-judged): `dev-plan`, `dev-refine`, `dev-runall`, `dev-parallel`, `dev-dogfood`, `rule-add`, `workflow-add`.

Leave untouched (backing skill instructs the same agent to author code/tests/docs via `Write`/`Edit`): `dev-run`, `dev-unit`, `dev-simplify`, `dev-reverse`.
### Requirements
- R1. Preserve commands-as-SSOT and the thin-wrapper architecture. Changes are **frontmatter-only** (`allowed-tools`) — no edit to any wrapper's `Usage` or `Implementation`, no behavior change, no committed platform adapters.

- R2. Trace the actual write-path of each of the 28 command wrappers and record a per-command classification: does the wrapper **agent itself** invoke the `Write`/`Edit` tool, or does mutation happen via the Bash-gated CLI (`spur task update`, `spur rule`, `spur workflow run`), the workflow engine, or spawned subagents (which carry their own independent tool grants)? The classification table is the deliverable 0315's R2 audit under-delivered.

- R3. Drop `Write`/`Edit` from `allowed-tools` **only** where the trace confirms the wrapper agent never uses them. Pre-evidenced trims (apply directly): `dev-idea` (−`Write`,−`Edit`), `dev-wrap` (−`Write`,−`Edit`), `dev-wrapall` (−`Write`,−`Edit`), `dev-verify` (−`Write`), `dev-verifyall` (−`Write`). For the seven verify-then-decide commands, trim only where the per-command trace confirms redundancy; record the decision for each either way.

- R4. Explicitly **leave** the code/test/doc-authoring commands untouched — `dev-run`, `dev-unit`, `dev-simplify`, `dev-reverse` — whose backing skills instruct the same agent to write via `Write`/`Edit`. Retain the minimum HITL tool (`AskUserQuestion`) on interactive wrappers. Record any exception.

- R5. Extend `command-contract.test.ts` with a per-command `allowed-tools` assertion for every trimmed wrapper (following the gate `(h)` pattern 0315 added for `dev-review`), so a regression that re-adds `Write`/`Edit` fails loud. Keep tests implementation-independent where Superskill owns conversion.

- R6 (slice). Verify via the command validator (thin-wrapper gates), the full `plugins/sp` test suite, and `bun run lint`. Dogfood at least one trimmed workflow wrapper (`dev-wrap --dry-run`) and one trimmed verify wrapper to confirm the trim does not break execution. Add a changelog entry. No version bump (frontmatter-only; if a bump becomes necessary, synchronize `plugin.json`/marketplace/README).
### Acceptance Criteria
```gherkin
Feature: Complete R10 least-privilege sweep across sp command wrappers

  Scenario: R2 - Every command's write-path is traced and classified
    Given the 28 command wrappers and their backing skills/workflows
    When the write-path audit is completed
    Then each command is classified as agent-writes (Write/Edit), CLI-gated (Bash), workflow-engine, or subagent-delegated
    And the classification names the concrete evidence for each command

  Scenario: R3 - Over-privileged wrappers are trimmed
    Given the pre-evidenced trims
    When allowed-tools is updated
    Then dev-idea, dev-wrap, and dev-wrapall drop Write and Edit
    And dev-verify and dev-verifyall drop Write
    And any additional trim among the seven verify-then-decide commands is backed by its recorded trace

  Scenario: R4 - Code-writing wrappers keep their grant
    Given dev-run, dev-unit, dev-simplify, and dev-reverse delegate to code/test/doc-authoring skills
    When the sweep is applied
    Then their Write/Edit grants are retained
    And interactive wrappers keep the minimum required HITL tool

  Scenario: R5 - Regression guard fails loud on re-privilege
    Given the trimmed allowed-tools sets
    When command-contract.test.ts runs
    Then each trimmed wrapper has an assertion that rejects a re-added Write/Edit
    And the full plugin test suite exits zero

  Scenario: R6 - Trims do not break execution and gates are green
    Given the trimmed wrappers
    When dev-wrap --dry-run and a verify wrapper are dogfooded
    Then each executes without a missing-tool failure
    And the command validator, plugin test suite, and lint gates exit zero
    And git status contains only intentional frontmatter/test/changelog changes
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
`allowed-tools` gates what the wrapper **agent** may do while executing the command; a `Skill()` or `spur workflow run` dispatch runs under that same grant. The trim decision follows a single write-path taxonomy:

| Write-path | Who mutates | `Write`/`Edit` on wrapper |
|-----------|-------------|----------------------------|
| Agent authors code/tests/docs (`sp:code-implementation`, `sp:code-testing`, `sp:code-simplification`, `sp:reverse-engineering`) | the wrapper agent, via Write/Edit tools | **KEEP** |
| CLI-gated section write (`spur task update --section --from-file`, temp file via Bash heredoc) | Bash + the CLI | **DROP** — Write not used |
| Workflow engine (`spur workflow run`) | the engine + spawned subagents (own grants) | **DROP** — wrapper needs only Bash |
| Subagent fan-out | subagents with independent grants | **DROP** on the parent wrapper |

**Additive-safe.** Trims are frontmatter-only and guarded by new `command-contract.test.ts` assertions; if a trim removed a genuinely-needed grant, the dogfood run (missing-tool failure) or a test surfaces it immediately. Carry the one-release-compat mindset from 0315: prefer to keep a grant flagged for a follow-up over trimming on a shaky trace. `dev-review`'s identical trim already ships with passing tests, proving the pattern.

Do not add wrappers, change Usage/Implementation, or move lifecycle prose. Any surface change follows T3 and ADR-032.
### Plan
1. Extend the 28-command parity scan into a per-command write-path classification table (agent-writes / CLI-gated / workflow-engine / subagent-delegated) with concrete evidence per command.
2. Apply the five pre-evidenced trims: `dev-idea`/`dev-wrap`/`dev-wrapall` drop `Write`+`Edit`; `dev-verify`/`dev-verifyall` drop `Write`.
3. Per-command trace the seven verify-then-decide commands (`dev-plan`, `dev-refine`, `dev-runall`, `dev-parallel`, `dev-dogfood`, `rule-add`, `workflow-add`); trim only where redundancy is confirmed; record each decision.
4. Leave `dev-run`/`dev-unit`/`dev-simplify`/`dev-reverse` untouched; confirm interactive wrappers keep the minimum HITL tool.
5. Extend `command-contract.test.ts` with an `allowed-tools` regression assertion per trimmed wrapper.
6. Run the command validator, the full `plugins/sp` suite, and `bun run lint`; dogfood `dev-wrap --dry-run` and a verify wrapper; add a changelog entry; inspect git status.
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
- Parent **0314** (umbrella) and sibling **0315** — its R2 28-command audit (in 0315 `Notes`) is the source of this task; independent of **0316**/**0317**
- `plugins/sp/commands/*.md` (frontmatter `allowed-tools`)
- `plugins/sp/tests/command-contract.test.ts` — the gate `(h)` per-command assertion pattern 0315 established
- `plugins/sp/scripts/validate-commands.ts` — thin-wrapper gates
- 0315 R10 principle ("workflow wrappers must not retain Write/Edit solely because spawned workflow steps mutate") and `docs/00_ADR.md` ADR-032 (commands-as-SSOT)
### History
