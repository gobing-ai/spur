---
template: feature-impl
schema_version: 1
name: "Complete the R10 least-privilege allowed-tools sweep across all sp command wrappers"
description: ""
status: done
type: task
profile: standard
feature_id: O
parent_wbs: "0314"
priority: P2
tags: []
dependencies: []
created_at: "2026-07-23T06:59:26.486Z"
updated_at: "2026-07-23T18:22:52.822Z"
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
1. `plugins/sp/commands/dev-idea.md:4` — Trimmed `allowed-tools`: dropped `Write` and `Edit` (`["Bash", "Read", "AskUserQuestion"]`).
2. `plugins/sp/commands/dev-wrap.md:4` — Trimmed `allowed-tools`: dropped `Write` and `Edit` (`["Bash", "Read", "AskUserQuestion"]`).
3. `plugins/sp/commands/dev-wrapall.md:4` — Trimmed `allowed-tools`: dropped `Write` and `Edit` (`["Bash", "Read", "AskUserQuestion"]`).
4. `plugins/sp/commands/dev-verify.md:4` — Trimmed `allowed-tools`: dropped `Write` (`["Bash", "Read", "Skill"]`).
5. `plugins/sp/commands/dev-verifyall.md:4` — Trimmed `allowed-tools`: dropped `Write` (`["Bash", "Read", "Skill"]`).
6. `plugins/sp/commands/dev-plan.md:4` — Verify-then-decide **TRIM** Write (`["Bash", "Read", "Skill", "AskUserQuestion"]`) — CLI-gated via `sp:spur-dev plan`.
7. `plugins/sp/commands/dev-refine.md:4` — Verify-then-decide **TRIM** Write (`["Bash", "Read", "Skill", "AskUserQuestion"]`) — CLI-gated via `sp:spur-dev refine`.
8. `plugins/sp/commands/dev-parallel.md:4` — Verify-then-decide **TRIM** Write+Edit (`["Bash", "Read", "Skill"]`) — subagent fan-out.
9. `plugins/sp/commands/dev-runall.md:4` — Verify-then-decide **TRIM** Write+Edit (`["Bash", "Read", "Skill"]`) — batch orchestration / child agents.
10. Verify-then-decide **KEEP** (one-release-compat / agent-writes): `dev-dogfood.md` (Write+Edit), `rule-add.md` (Write), `workflow-add.md` (Write) — left unchanged.
11. Left untouched (R4 authoring): `dev-run`, `dev-unit`, `dev-simplify`, `dev-reverse` retain Write/Edit.
12. `plugins/sp/tests/command-contract.test.ts:778-846` — Test block `(j)`: forbidden Write/Edit on 9 trimmed wrappers; authoring retain; interactive AskUserQuestion.
13. `CHANGELOG.md:16` — Release note under `[0.3.21]`.
14. **Notes** — Full 30-command write-path classification table (R2 deliverable) with path class + evidence + KEEP/TRIM decision.
### Testing
**Pipeline verify results**

- Verdict: PASS (from `.spur/run/0318-verdict.json`, re-verify 2026-07-23 --force --fix all)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `git diff` frontmatter-only on 9 command wrappers; Usage/Implementation unchanged (`dev-idea.md:4`, `dev-verify.md:4`, …) |
| R2 | MET | Notes: 30-command write-path classification table (path class + Implementation evidence + KEEP/TRIM) |
| R3 | MET | 9 trims applied (pre-evidenced five + plan/refine/parallel/runall); `command-contract.test.ts` block (j) |
| R4 | MET | `dev-run`/`dev-unit`/`dev-simplify`/`dev-reverse` retain Write/Edit; interactive wrappers retain AskUserQuestion — test (j) |
| R5 | MET | `plugins/sp/tests/command-contract.test.ts:778-846`; 49/49 contract tests pass this run |
| R6 | MET | validate-commands: 30 pass; `bun test plugins/sp` 390 pass; `bun run lint` clean; wrap dry-run status=done; CHANGELOG.md:16 |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
|----|--------|---------------|----------|
| Scenario: R2 - write-path classified | MET | static-ref | Notes classification table (30 rows) |
| Scenario: R3 - over-privileged trimmed | MET | test | (j) forbidden Write/Edit on 9 trimmed wrappers |
| Scenario: R4 - authoring grants retained | MET | test | (j) authoring retain + AskUserQuestion |
| Scenario: R5 - regression guard | MET | command | `bun test plugins/sp` → 390 pass |
| Scenario: R6 - gates green | MET | command | validator + lint + wrap dry-run done |

- Coverage: N/A (frontmatter/config + test-only change; no runtime product path)
- Fix-pass disclosure: Notes classification table; Testing rewrite; Review P1–P4 table via `spur task update --section Review` (record skipped non-bare Review)
### Review
**SECU findings** (standalone re-verify --force --fix all — verdict: PASS)

| Priority | Dimension | Location | Finding |
|----------|-----------|----------|---------|
| P4 | correctness | plugins/sp/commands/*.md:4 | No P1–P3 findings. Nine wrappers correctly least-privileged; authoring commands retain Write/Edit; regression suite green. |
| P4 | architecture | plugins/sp/tests/command-contract.test.ts:778-846 | Least-privilege gate (j) locks trims; scope limited to frontmatter + contract tests + changelog. |

Residual risk: none for this slice. Conservative KEEP on dogfood/rule-add/workflow-add is intentional one-release-compat (Notes).
### References
- Parent **0314** (umbrella) and sibling **0315** — its R2 28-command audit (in 0315 `Notes`) is the source of this task; independent of **0316**/**0317**
- `plugins/sp/commands/*.md` (frontmatter `allowed-tools`)
- `plugins/sp/tests/command-contract.test.ts` — the gate `(h)` per-command assertion pattern 0315 established
- `plugins/sp/scripts/validate-commands.ts` — thin-wrapper gates
- 0315 R10 principle ("workflow wrappers must not retain Write/Edit solely because spawned workflow steps mutate") and `docs/00_ADR.md` ADR-032 (commands-as-SSOT)
### History
- 2026-07-23 — Implemented R10 least-privilege sweep: 9 wrapper trims, contract tests `(j)`, changelog.
- 2026-07-23 — `/sp-dev-verify 0318 --force --fix all`: PASS. Filled Notes classification (30 cmds), Testing tables, Review P1–P4. `spur task check` pass:true (L4 DD-09 warnings only — task AC titles are more specific than feature O scenarios; feature O's "R10" is shadow-migration, not this least-privilege slice).
- 2026-07-23 — Wrap residual close-out: Solution KEEP decisions recorded; History filled; learning captured.
### Notes

**R2 write-path classification** (2026-07-23 re-verify; 30 wrappers). Taxonomy: agent-writes | CLI-gated | workflow-engine | subagent-delegated | read-only-ops.

| Command | Path class | Evidence (Implementation) | Decision |
|---------|------------|---------------------------|----------|
| dev-idea | workflow-engine | `spur workflow run idea-pipeline.yaml` | **TRIM** Write+Edit |
| dev-wrap | workflow-engine | `spur workflow run wrapup-pipeline.yaml` | **TRIM** Write+Edit |
| dev-wrapall | workflow-engine | `spur workflow run wrapup-pipeline.yaml` | **TRIM** Write+Edit |
| dev-verify | CLI-gated | `Skill(sp:code-verification)` → `spur task update` via Bash temp | **TRIM** Write |
| dev-verifyall | CLI-gated / orchestrator | `Skill(sp:spur-dev verifyall)` + inner code-verification | **TRIM** Write |
| dev-plan | CLI-gated | `Skill(sp:spur-dev plan)` — corpus via CLI, not Write tool | **TRIM** Write |
| dev-refine | CLI-gated | `Skill(sp:spur-dev refine)` | **TRIM** Write |
| dev-runall | subagent-delegated | `Skill(sp:spur-dev runall)` — batch pipeline / child agents | **TRIM** Write+Edit |
| dev-parallel | subagent-delegated | `Skill(sp:parallel-execution)` — fan-out subagents | **TRIM** Write+Edit |
| dev-review | CLI-gated | skills write Review via CLI (trimmed in 0315) | keep (already least-priv) |
| dev-dogfood | agent-writes | `Skill(sp:dogfood-testing)` authors report artifacts | **KEEP** Write+Edit |
| rule-add | agent-writes (conservative) | `Skill(sp:spur-cli rule add)` may author rule files | **KEEP** Write |
| workflow-add | agent-writes (conservative) | `Skill(sp:spur-cli workflow add)` may author workflow YAML | **KEEP** Write |
| dev-run | agent-writes | `sp:code-implementation` / full pipeline | **KEEP** Write+Edit |
| dev-unit | agent-writes | `sp:code-testing` | **KEEP** Write+Edit |
| dev-simplify | agent-writes | `sp:code-simplification` (Edit) | **KEEP** Edit |
| dev-reverse | agent-writes | `sp:reverse-engineering` | **KEEP** Write+Edit |
| dev-debug | agent-writes | `sp:sys-debugging` | **KEEP** Write |
| dev-fixall | agent-writes | inline fixall procedure mutates tree | **KEEP** Write+Edit |
| dev-handover | agent-writes | writes handover markdown SSOT | **KEEP** Write |
| rule-refine | agent-writes | `sp:spur-cli rule refine` (Edit) | **KEEP** Edit |
| workflow-refine | agent-writes | `sp:spur-cli workflow refine` (Edit) | **KEEP** Edit |
| spur-init | agent-writes + CLI | `spur init` + customize skill | **KEEP** Write |
| dev-arch | read-only-ops | survey skill; report only | no Write |
| dev-brainstorm | interactive | brainstorm/wayfinder skills | no Write; AskUserQuestion |
| dev-changelog | CLI-gated / read | git history → changelog procedure | no Write in tools (Bash) |
| dev-daily | CLI-gated | runs daily-summary.ts script | no Write |
| dev-gitmsg | CLI-gated / read | gitmsg procedure | no Write |
| dev-next | orchestrator | `sp:next-router` dispatch | no Write; AskUserQuestion |
| rule-scan | read-only-ops | scan skill (Grep/Glob/Skill) | no Write |

**Verify-then-decide (7):** plan/refine/runall/parallel → TRIM (CLI or subagent). dogfood/rule-add/workflow-add → KEEP (agent may author files; one-release-compat).

**Interactive HITL retained:** dev-brainstorm, dev-idea, dev-next, dev-plan, dev-refine, dev-wrap, dev-wrapall keep `AskUserQuestion`.

