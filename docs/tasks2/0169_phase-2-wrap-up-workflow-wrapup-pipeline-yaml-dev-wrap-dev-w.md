---
template: feature-impl
schema_version: 1
name: Phase 2 Wrap-Up workflow — wrapup-pipeline.yaml, dev-wrap, dev-wrapall, --wrap flag
description: ""
status: done
type: task
profile: standard
feature_id: I1
parent_wbs: "0167"
priority: P2
tags: []
dependencies: []
created_at: 2026-07-01T18:42:39.270Z
updated_at: "2026-08-11T21:18:35.361Z"
---

## 0169. Phase 2 Wrap-Up workflow — wrapup-pipeline.yaml, dev-wrap, dev-wrapall, --wrap flag

### Background

Phase 2 of the 0167 6-phase decomposition (Plan steps 7-12). Builds the post-execution wrap-up flow. Depends on Phase 1 (task 0167 phase-1 child) completing first — uses the cross-cutting conventions (Auto-Decision Principles, Pipeline Alignment, Learning Log/Checkpoint conventions are co-located here). Implements parent task 0167 Plan Phase 2.

Dependency: Phase 1 must complete first (cross-cutting conventions + brainstorm enhancement). Phase 3 depends on this task.

Source: docs/tasks2/0167_*.md Plan Phase 2; docs/design/e2e-workflow-for-system-development.md wrapup-pipeline contract.

### Requirements
R1. (parent R5) Create `wrapup-pipeline.yaml` state-machine workflow at `config/workflows/wrapup-pipeline.yaml` (physical source; `.spur/workflows/wrapup-pipeline.yaml` is the symlinked project-facing path). States: start -> task-resolve -> doc-sync (agent.run dispatching sp:doc-evolve) -> learning-capture (write to `.spur/memory/learnings.md`) -> metrics-record (append `.spur/memory/wrapup-metrics.jsonl`) -> feature-transition (conditional, if `--feature`; advance via `spur feature update` through legal lifecycle edges only) -> branch-cleanup (conditional, if `--merge`; irreversible HITL gate) -> done. Wrap-up steps run ONCE for the entire batch (project-level doc-sync, aggregated learning-capture). Task statuses are not mutated. `$schema` = `@gobing-ai/spur/schemas/state-machine-workflow.schema.json`, `kind: state-machine`.

R2. (parent R5) Create `/sp:dev-wrap` command at `plugins/sp/commands/dev-wrap.md` — single-task wrap-up. Thin wrapper: `spur workflow run .spur/workflows/wrapup-pipeline.yaml --vars '{"tasks":["<wbs>"],"profile":"interactive|auto"}'`. Supports `--auto` and `--merge` flags.

R3. (parent R5) Create `/sp:dev-wrapall` command at `plugins/sp/commands/dev-wrapall.md` — batch wrap-up. Resolves task list via `spur task list --json`, passes `{"tasks":[...]}` to the workflow. Options: `--since <iso-date>` (filter done tasks by frontmatter `updated_at >= date`, the v1 approximation until a dedicated completion timestamp exists), `--feature <id>` (all tasks under feature + transition feature to done via legal lifecycle edges), `--status <s>` (default: done), `--auto`, `--merge`.

R4. (parent R5) Add `--wrap` flag to `plugins/sp/commands/dev-run.md` and `plugins/sp/commands/dev-runall.md` — triggers `wrapup-pipeline.yaml` after the last task completes. Equivalent to running `dev-wrap`/`dev-wrapall` after execution.

R5. (parent R10) Register `wrap` and `wrapall` operations in `plugins/sp/skills/spur-dev/references/dev-operations.md`. This drives the R32 structural test (added in Phase 6, task 0173).

R6. (parent R14, R15) The `wrapup-pipeline.yaml` respects existing lifecycle guards: `feature-transition` advances features through `spur feature update` only via legal edges (`backlog -> active`, `active -> verifying` with feature check guard, `verifying -> done` with strict guard). Never attempts `backlog|active -> done` directly. No new `*-lifecycle.yaml` workflows are created. Task statuses are not mutated by wrap-up.

R7. (parent R6) Add `## Learning Log Convention` section to `plugins/sp/skills/spur-dev/references/cross-cutting.md`: markdown log at `.spur/memory/learnings.md`; entries include date, task WBS, insights, errors, conventions; working scratchpad, not CLI-gated, not a validated corpus. The `wrapup-pipeline.yaml` learning-capture step writes to it.

R8. (parent R7) Add `## Session Checkpoint Convention` section to `plugins/sp/skills/spur-dev/references/cross-cutting.md`: checkpoints under `.spur/memory/sessions/`; markdown + YAML frontmatter (session_id, task_wbs/feature_id, workflow, run_id, phase, last_gate, timestamp, next_action); written after every gate/phase transition; read on `dev-run`/`dev-runall` resume. (Note: the actual checkpoint write actions in pipeline YAMLs are added in Phase 4, task 0171 — this step documents the convention only.)
### Acceptance Criteria
**AC-P2.1: wrapup-pipeline.yaml validates**
```gherkin
Feature: Phase 2 Wrap-Up workflow

  Scenario: wrapup-pipeline.yaml is a valid state-machine workflow
    Given the file config/workflows/wrapup-pipeline.yaml
    When running `spur workflow validate .spur/workflows/wrapup-pipeline.yaml --json`
    Then the command exits 0
    And the workflow has states: task-resolve, doc-sync, learning-capture, metrics-record, feature-transition, branch-cleanup, done
```

**AC-P2.2: dev-wrap command exists**
- Pass: `plugins/sp/commands/dev-wrap.md` exists with valid frontmatter.
- Pass: the command delegates to `.spur/workflows/wrapup-pipeline.yaml`.
- Pass: the command supports `--auto` and `--merge` flags.

**AC-P2.3: dev-wrapall command exists**
- Pass: `plugins/sp/commands/dev-wrapall.md` exists with valid frontmatter.
- Pass: the command delegates to `.spur/workflows/wrapup-pipeline.yaml`.
- Pass: the command supports `--since`, `--feature`, `--status`, `--auto`, `--merge` options.

**AC-P2.4: --wrap flag on dev-run and dev-runall**
- Pass: `grep '\-\-wrap' plugins/sp/commands/dev-run.md` returns a match.
- Pass: `grep '\-\-wrap' plugins/sp/commands/dev-runall.md` returns a match.

**AC-P2.5: dev-operations registration**
- Pass: `grep 'wrap' plugins/sp/skills/spur-dev/references/dev-operations.md` returns a match.
- Pass: `grep 'wrapall' plugins/sp/skills/spur-dev/references/dev-operations.md` returns a match.

**AC-P2.6: Learning log and checkpoint conventions documented**
- Pass: `grep '## Learning Log Convention' plugins/sp/skills/spur-dev/references/cross-cutting.md` returns a match.
- Pass: `grep '## Session Checkpoint Convention' plugins/sp/skills/spur-dev/references/cross-cutting.md` returns a match.

**AC-P2.7: No task status mutation, no new lifecycle workflows**
- Pass: `wrapup-pipeline.yaml` header or state docs explicitly state task statuses are not mutated.
- Pass: `ls config/workflows/` shows no new `*-lifecycle.yaml` files.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Inherits the parent task 0167 Design section group B1-B3 and the design doc's `wrapup-pipeline.yaml` contract, memory artifacts, and lifecycle contracts.

**Approach:** Phase 2 builds the post-execution wrap-up flow. One workflow YAML (`wrapup-pipeline.yaml`), two new commands (`dev-wrap`, `dev-wrapall`), one flag on two existing commands (`--wrap`), two new cross-cutting convention sections, and dev-operations registration. No code changes — all orchestration is configuration (ADR-022).

**Key design decisions (sliced from parent Design B1-B3):**

- **One workflow, two commands (parent B1):** `wrapup-pipeline.yaml` is the single workflow; `dev-wrap` passes `{"tasks":["<wbs>"]}` and `dev-wrapall` passes `{"tasks":[...]}` with batch-resolution logic. Source pattern: gstack `ship` (verification iron law, metrics persistence) + gstack `learn` (structured learning capture).

- **Batch-level steps:** doc-sync runs ONCE for the batch (project-level), learning-capture aggregates the batch. This is not per-task wrap-up — it is post-batch wrap-up. The design doc's wrapup-pipeline contract specifies: `doc-sync` dispatches `sp:doc-evolve` once; `learning-capture` appends to `.spur/memory/learnings.md`; `metrics-record` appends one JSONL row per task to `.spur/memory/wrapup-metrics.jsonl`.

- **Lifecycle guard respect (parent R15, design doc Lifecycle Contracts):** `feature-transition` advances the feature through legal edges only: `backlog -> active` (always), `active -> verifying` (feature check guard), `verifying -> done` (strict feature check guard). Never `backlog|active -> done` directly. Task statuses are not mutated.

- **Branch cleanup is irreversible (design doc HITL taxonomy):** `branch-cleanup` is classified as an irreversible gate — it always pauses even under `--auto`, unless the operator explicitly confirms. This is the one gate `--auto` cannot route around.

- **Learning log is markdown, not JSON (parent B2):** The operator prefers simple markdown for working scratchpads. `.spur/memory/learnings.md` is directly readable without parsing. `doc-evolve`'s lesson-append handles promoting high-value learnings to the constitution. Not CLI-gated, not a validated corpus.

- **Session checkpoints (parent B3):** Source pattern: gstack `context_save_restore`. Markdown + YAML frontmatter under `.spur/memory/sessions/`. Written after every gate/phase transition. Read on resume. The convention is documented here; the actual write/read actions in pipeline YAMLs are added in Phase 4 (task 0171).

- **--since implementation (parent R5 Q&A):** `--since` has no dedicated completion timestamp today. v1 approximation: `dev-wrapall` resolves `spur task list --json` and filters done-task files by frontmatter `updated_at >= <date>`. Real wrap-up metrics recorded in `.spur/memory/wrapup-metrics.jsonl`.

**Impacted surfaces (from parent Plan steps 7-12):**
- New: `config/workflows/wrapup-pipeline.yaml`, `plugins/sp/commands/dev-wrap.md`, `plugins/sp/commands/dev-wrapall.md`
- Updated: `plugins/sp/commands/dev-run.md` (`--wrap`), `plugins/sp/commands/dev-runall.md` (`--wrap`), `plugins/sp/skills/spur-dev/references/dev-operations.md`, `plugins/sp/skills/spur-dev/references/cross-cutting.md` (Learning Log + Session Checkpoint sections)
### Plan
Ordered checklist from parent task 0167 Plan Phase 2 (steps 7-12). Each step is sequential within the phase. Phase 1 (task 0168) must complete first.

- [x] Step 7: Create `config/workflows/wrapup-pipeline.yaml` state-machine workflow (start -> task-resolve -> doc-sync -> learning-capture -> metrics-record -> feature-transition -> branch-cleanup -> done) (R1). Verify: `spur workflow validate .spur/workflows/wrapup-pipeline.yaml --json` exits 0.
- [x] Step 8: Create `plugins/sp/commands/dev-wrap.md` command (single-task wrap-up, passes `{"tasks":["<wbs>"]}` to workflow) (R2). Verify: file exists with valid frontmatter delegating to `.spur/workflows/wrapup-pipeline.yaml`.
- [x] Step 9: Create `plugins/sp/commands/dev-wrapall.md` command (batch wrap-up with `--since`/`--feature`/`--status`/`--auto`/`--merge` options) (R3). Verify: file exists with valid frontmatter.
- [x] Step 10: Add `--wrap` flag to `plugins/sp/commands/dev-run.md` and `plugins/sp/commands/dev-runall.md` (R4). Verify: `grep '\-\-wrap'` in both files.
- [x] Step 11: Register `wrap` and `wrapall` operations in `plugins/sp/skills/spur-dev/references/dev-operations.md` (R5). Verify: `grep 'wrap'` and `grep 'wrapall'` in dev-operations.md.
- [x] Step 12: Add `## Learning Log Convention` and `## Session Checkpoint Convention` sections to `plugins/sp/skills/spur-dev/references/cross-cutting.md` (R7, R8). Verify: `grep '## Learning Log Convention'` and `grep '## Session Checkpoint Convention'` in cross-cutting.md.
- [x] Final: confirm no new `*-lifecycle.yaml` in `config/workflows/`; confirm `wrapup-pipeline.yaml` documents that task statuses are not mutated (R6).
### Solution
Phase 2 Wrap-Up workflow implemented. One new workflow YAML, two new command files, --wrap flag on two existing commands, dev-operations registration, two new cross-cutting convention sections. No code changes — all orchestration is configuration (ADR-022).

**Change map:**

- `config/workflows/wrapup-pipeline.yaml:26` — new state-machine workflow (start -> task-resolve -> doc-sync -> learning-capture -> metrics-record -> feature-transition -> branch-cleanup -> done; conditional routing via shell guards on `vars.feature` and `vars.merge`; branch-cleanup is irreversible HITL with `pause: true`)
- `plugins/sp/commands/dev-wrap.md:7` — new command (single-task wrap-up; passes `{"tasks":["<wbs>"]}` to wrapup-pipeline; supports `--auto`, `--merge`)
- `plugins/sp/commands/dev-wrapall.md:7` — new command (batch wrap-up; resolves tasks via `spur task list --json`; supports `--since`, `--feature`, `--status`, `--auto`, `--merge`)
- `plugins/sp/commands/dev-run.md:173` — added `--wrap` flag section and Arguments table row (triggers wrapup-pipeline after task reaches done)
- `plugins/sp/commands/dev-runall.md:84` — added `--wrap` flag section and Arguments table row (triggers wrapup-pipeline after batch completes)
- `plugins/sp/skills/spur-dev/references/dev-operations.md:157` — registered operation #14 (wrap) and #15 (wrapall); updated operation count 13 -> 15
- `plugins/sp/skills/spur-dev/references/cross-cutting.md:243` — appended `## Learning Log Convention` section (`.spur/memory/learnings.md` format, not CLI-gated, not validated corpus)
- `plugins/sp/skills/spur-dev/references/cross-cutting.md:272` — appended `## Session Checkpoint Convention` section (`.spur/memory/sessions/` format, YAML frontmatter, write/read triggers)

**Rationale:** Phase 2 builds the post-execution wrap-up flow per the design doc's wrapup-pipeline contract. The workflow respects lifecycle guards (feature-transition via `spur feature update`, task statuses NOT mutated). Branch-cleanup is an irreversible HITL gate that always pauses even under `--auto` (Auto-Decision Principle #6). No new skills, no new lifecycle YAMLs — ADR-022 holds.
### Testing
**Verification commands and outcomes (all 7 ACs):**

AC-P2.1 (wrapup-pipeline.yaml validates):
- `spur workflow validate .spur/workflows/wrapup-pipeline.yaml --json` -> `{"valid": true, "ok": true}`, exit 0
- States present: start, task-resolve, doc-sync, learning-capture, metrics-record, feature-transition, branch-cleanup, done, skipped

AC-P2.2 (dev-wrap command):
- `test -f plugins/sp/commands/dev-wrap.md` -> exists
- `grep -c '^description:' dev-wrap.md` -> 1 (valid frontmatter)
- `grep -c 'wrapup-pipeline' dev-wrap.md` -> 4 (delegates to wrapup-pipeline)
- `grep -c '\-\-auto'` -> 5, `grep -c '\-\-merge'` -> 6

AC-P2.3 (dev-wrapall command):
- `test -f plugins/sp/commands/dev-wrapall.md` -> exists
- `grep -c '^description:' dev-wrapall.md` -> 1 (valid frontmatter)
- `grep -c 'wrapup-pipeline' dev-wrapall.md` -> 3
- All 5 flags: --since (4), --feature (5), --status (6), --auto (3), --merge (4)

AC-P2.4 (--wrap flag):
- `grep -c '\-\-wrap' dev-run.md` -> 6
- `grep -c '\-\-wrap' dev-runall.md` -> 5

AC-P2.5 (dev-operations registration):
- `grep -c 'wrap' dev-operations.md` -> 17
- `grep -c 'wrapall' dev-operations.md` -> 3

AC-P2.6 (Learning log and checkpoint conventions):
- `grep -c '## Learning Log Convention' cross-cutting.md` -> 1
- `grep -c '## Session Checkpoint Convention' cross-cutting.md` -> 1

AC-P2.7 (No task status mutation, no new lifecycle workflows):
- `grep -c 'NOT mutated' wrapup-pipeline.yaml` -> 2 (documented in start + feature-transition)
- `ls config/workflows/ | grep lifecycle.yaml` -> only feature-lifecycle.yaml + task-lifecycle.yaml

**Coverage claim:** N/A — Phase 2 is workflow YAML + command/reference work, no code to cover. R32 structural test is added in Phase 6 (task 0173).

**Gate status:** All 7 ACs pass. `spur workflow validate` exits 0.
### Review
| Severity | File | Finding | Recommendation |
|---|---|---|---|
| P1 | — | None | — |
| P2 | — | None | — |
| P3 | — | None | — |
| P4 | config/workflows/wrapup-pipeline.yaml | feature-transition uses agent.run for what is deterministic CLI work (spur feature show + spur feature update). An agent.run step adds LLM latency to a mechanical transition. | Accepted for v1 — agent handles conditional status-check logic that would be complex in a single shell command. Future task could replace with shell script if latency is a concern. |
| P4 | plugins/sp/commands/dev-wrapall.md | --since filters by frontmatter `updated_at` which is a v1 approximation (updated_at changes on any section write, not just completion). | Accepted — documented as v1 approximation. A dedicated completion timestamp would require a schema change. |

**Residual risk:** Low. The wrapup-pipeline has not been end-to-end tested (that happens in Phase 6 dogfood). The conditional routing (feature set / merge true) is validated by `spur workflow validate` but not exercised. The learning-capture and metrics-record agent.run steps produce unstructured output that depends on the agent's quality.

**Final disposition:** PASS — all 7 ACs verified, workflow validates, ADR-022 holds, no new skills or lifecycle YAMLs.
### References

I

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-01T20:51:52.166Z todo → wip (system)
- 2026-07-01T20:57:08.379Z wip → testing (system)
- 2026-07-01T20:57:09.886Z testing → done (system)
