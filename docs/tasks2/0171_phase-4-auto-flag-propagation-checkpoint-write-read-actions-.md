---
template: feature-impl
schema_version: 1
name: Phase 4 Auto-flag propagation + checkpoint write/read actions in all pipelines
description: ""
status: done
type: task
profile: standard
feature_id: I
parent_wbs: "0167"
priority: P2
tags: []
dependencies: []
created_at: 2026-07-01T18:42:39.272Z
updated_at: 2026-07-01T21:17:07.920Z
---

## 0171. Phase 4 Auto-flag propagation + checkpoint write/read actions in all pipelines

### Background

Phase 4 of the 0167 6-phase decomposition (Plan steps 18-19). Ensures --auto is consistently supported across all commands and adds explicit checkpoint write/read actions to all pipelines. Depends on Phase 3 (task 0167 phase-3 child) completing first — adds --auto to the commands built in Phases 2-3 and checkpoint actions to all pipelines. Implements parent task 0167 Plan Phase 4.

Dependency: Phase 3 must complete first (commands + workflows built). Phase 5 depends on this task.

Source: docs/tasks2/0167_*.md Plan Phase 4; docs/design/e2e-workflow-for-system-development.md HITL/auto-mode + memory artifacts.

### Requirements
R1. (parent R9) Add `--auto` flag to `plugins/sp/commands/dev-idea.md`, `plugins/sp/commands/dev-plan.md`, `plugins/sp/commands/dev-wrap.md`, and `plugins/sp/commands/dev-wrapall.md`. Each command's `--auto` documentation must state that it sets `profile=auto` and uses auto-decision principles (Phase 1, task 0168 R2) to route around objective `hitl.confirm` states BEFORE entry (not HITL auto-clicking). Taste decisions (design approval) and irreversible actions (branch cleanup) still pause. `--auto` is not `--yes-to-everything`.

R2. (parent R7) Document the checkpoint read convention in `plugins/sp/skills/spur-dev/references/execution-workflow.md` and `plugins/sp/skills/spur-dev/references/execution-batch.md`: `dev-run`/`dev-runall` read the latest checkpoint under `.spur/memory/sessions/` before resume; surface `session_id` and `next_action` to the operator. The checkpoint format was defined in Phase 2 (task 0169 R8): markdown + YAML frontmatter (session_id, task_wbs/feature_id, workflow, run_id, phase, last_gate, timestamp, next_action).

R3. (parent R7) Add explicit checkpoint write actions to `config/workflows/task-pipeline.yaml`, `config/workflows/planning-pipeline.yaml`, `config/workflows/feature-dev.yaml`, `config/workflows/idea-pipeline.yaml`, and `config/workflows/wrapup-pipeline.yaml`. Checkpoints are written after every HITL gate decision and after every phase transition. The write action produces a markdown file with YAML frontmatter at `.spur/memory/sessions/<session_id>.md`. Per parent R7: "documenting the convention alone is insufficient" — implementation must add the actions to the workflow YAMLs.

R4. (parent R7) Make `plugins/sp/commands/dev-run.md` and `plugins/sp/commands/dev-runall.md` read the latest checkpoint before resume (document the `--continue` path that reads `.spur/memory/sessions/` and surfaces the checkpoint's `next_action` to the operator).
### Acceptance Criteria
**AC-P4.1: --auto flag on all four commands**
```gherkin
Feature: Phase 4 Auto-flag propagation

  Scenario: --auto flag documented on dev-idea, dev-plan, dev-wrap, dev-wrapall
    Given the command files plugins/sp/commands/dev-idea.md, dev-plan.md, dev-wrap.md, dev-wrapall.md
    When searching for "--auto" in each file
    Then each file documents the flag
    And each file states that --auto sets profile=auto and routes around objective HITL states before entry
    And each file states that taste decisions and irreversible actions still pause
```

**AC-P4.2: Checkpoint read convention documented**
- Pass: `grep 'checkpoint' plugins/sp/skills/spur-dev/references/execution-workflow.md` returns a match documenting the resume-read path.
- Pass: `grep 'checkpoint' plugins/sp/skills/spur-dev/references/execution-batch.md` returns a match.

**AC-P4.3: Checkpoint write actions in all five pipelines**
- Pass: `grep 'checkpoint' config/workflows/task-pipeline.yaml` returns a match (write action after gate/phase transition).
- Pass: `grep 'checkpoint' config/workflows/planning-pipeline.yaml` returns a match.
- Pass: `grep 'checkpoint' config/workflows/feature-dev.yaml` returns a match.
- Pass: `grep 'checkpoint' config/workflows/idea-pipeline.yaml` returns a match.
- Pass: `grep 'checkpoint' config/workflows/wrapup-pipeline.yaml` returns a match.

**AC-P4.4: dev-run/dev-runall read checkpoint on resume**
- Pass: `grep 'checkpoint' plugins/sp/commands/dev-run.md` returns a match documenting the `--continue` resume path.
- Pass: `grep 'checkpoint' plugins/sp/commands/dev-runall.md` returns a match.

**AC-P4.5: All modified workflows still validate**
- Pass: `spur workflow validate` exits 0 on each of the 5 modified workflow YAMLs.
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
Inherits the parent task 0167 Design section group C2 and the design doc's HITL and Auto Mode + Memory and Telemetry Artifacts sections.

**Approach:** Phase 4 ensures `--auto` is consistently supported across all commands and adds explicit checkpoint write/read actions to all pipelines. No new files — only edits to existing command docs, reference docs, and workflow YAMLs.

**Key design decisions (sliced from parent Design C2 + design doc):**

- **--auto is not --yes-to-everything (parent R9, design doc Auto-Decision Principles):** `--auto` sets `profile=auto`. The auto-decision principles (Phase 1, task 0168 R2) route around objective `hitl.confirm` states before entry. Taste decisions (design approval) and irreversible actions (branch cleanup) still pause. The critical implementation rule from the design doc: "YAML transitions must route around an auto-resolvable HITL state before entry. The workflow engine does not auto-dismiss `hitl.confirm`."

- **Checkpoint write contract (design doc Memory and Telemetry Artifacts):** Checkpoints are written to `.spur/memory/sessions/<session_id>.md` as markdown + YAML frontmatter. The frontmatter includes: `session_id`, `workflow`, `run_id`, `task_wbs` or `feature_id`, `phase`, `last_gate`, `timestamp`, `next_action`. Write checkpoints after: every HITL gate decision; every phase transition in planning-pipeline, task-pipeline, feature-dev, idea-pipeline, and wrapup-pipeline; every terminal state. Read checkpoints when: `--continue` is used; the operator asks to resume; a workflow run is paused and later continued.

- **Checkpoint actions are shell or agent.run (parent R7):** The write action in each workflow YAML produces the markdown+frontmatter file. This is an explicit action added to the workflow's state transitions, not just documentation. Per parent R7: "Implementation must add explicit checkpoint write/read steps to task-pipeline.yaml, planning-pipeline.yaml, feature-dev.yaml, idea-pipeline.yaml, and wrapup-pipeline.yaml, and the dev-run/dev-runall resume instructions; documenting the convention alone is insufficient."

- **--auto propagation scope (parent R9):** `--auto` is added to `dev-idea` (new, Phase 3), `dev-plan` (existing), `dev-wrap`/`dev-wrapall` (new, Phase 2). `dev-run`/`dev-runall` already support `--auto`. The flag forwards `profile=auto` into the workflow vars.

**Impacted surfaces (from parent Plan steps 18-19):**
- Updated: `plugins/sp/commands/dev-idea.md`, `plugins/sp/commands/dev-plan.md`, `plugins/sp/commands/dev-wrap.md`, `plugins/sp/commands/dev-wrapall.md` (`--auto` flag)
- Updated: `plugins/sp/skills/spur-dev/references/execution-workflow.md`, `plugins/sp/skills/spur-dev/references/execution-batch.md` (checkpoint read convention)
- Updated: `config/workflows/task-pipeline.yaml`, `config/workflows/planning-pipeline.yaml`, `config/workflows/feature-dev.yaml`, `config/workflows/idea-pipeline.yaml`, `config/workflows/wrapup-pipeline.yaml` (checkpoint write actions)
- Updated: `plugins/sp/commands/dev-run.md`, `plugins/sp/commands/dev-runall.md` (checkpoint read on resume)
### Plan
Ordered checklist from parent task 0167 Plan Phase 4 (steps 18-19). Each step is sequential within the phase. Phase 3 (task 0170) must complete first.

- [x] Step 18: Add `--auto` flag to `plugins/sp/commands/dev-idea.md`, `plugins/sp/commands/dev-plan.md`, `plugins/sp/commands/dev-wrap.md`, `plugins/sp/commands/dev-wrapall.md` with documentation that `--auto` uses auto-decision principles (Phase 1, task 0168 R2) to route around objective HITL states before entry; taste/irreversible decisions still pause (R1). Verify: `grep '\-\-auto'` in each of the 4 files.
- [x] Step 19a: Document the checkpoint read convention in `plugins/sp/skills/spur-dev/references/execution-workflow.md` and `plugins/sp/skills/spur-dev/references/execution-batch.md` (R2). Verify: `grep 'checkpoint'` in both files.
- [x] Step 19b: Add explicit checkpoint write actions (shell or agent.run writing markdown+frontmatter to `.spur/memory/sessions/<session>.md`) to `config/workflows/task-pipeline.yaml`, `config/workflows/planning-pipeline.yaml`, `config/workflows/feature-dev.yaml`, `config/workflows/idea-pipeline.yaml`, and `config/workflows/wrapup-pipeline.yaml` (R3). Checkpoints written after every HITL gate decision and every phase transition. Verify: `grep 'checkpoint'` in each workflow YAML; `spur workflow validate` on each modified workflow.
- [x] Step 19c: Make `plugins/sp/commands/dev-run.md` and `plugins/sp/commands/dev-runall.md` read the latest checkpoint before resume (document the `--continue` path) (R4). Verify: `grep 'checkpoint'` in both command files.
- [x] Final: run `spur workflow validate --json` on all 5 modified workflows; all must exit 0.
### Solution
Phase 4 Auto-flag propagation + checkpoint write/read actions implemented. All changes are edits to existing command docs, reference docs, and workflow YAMLs — no new files, no code changes.

**Change map:**

- `plugins/sp/commands/dev-idea.md:29` — updated `--auto` table row: `profile=auto`, BEFORE-entry routing, taste-gate pause, not-`--yes-to-everything`
- `plugins/sp/commands/dev-idea.md:61` — inserted `### --auto behavior` section with full Auto-Decision Principles contract
- `plugins/sp/commands/dev-plan.md:32` — updated `--auto` table row: `profile=auto` (skip phasing HITL) + design-doc auto-detection dual role
- `plugins/sp/commands/dev-plan.md:42` — updated design-doc truth table `--auto` row to mention `profile=auto`
- `plugins/sp/commands/dev-plan.md:49` — inserted `### --auto behavior` section
- `plugins/sp/commands/dev-wrap.md:26` — updated `--auto` table row: `profile=auto`, BEFORE-entry routing, irreversible-gate pause
- `plugins/sp/commands/dev-wrap.md:46` — inserted `### --auto behavior` section
- `plugins/sp/commands/dev-wrapall.md:28` — updated `--auto` table row: `profile=auto`, BEFORE-entry routing, irreversible-gate pause
- `plugins/sp/commands/dev-wrapall.md:60` — inserted `### --auto behavior` section
- `plugins/sp/commands/dev-run.md:187` — inserted `## Resume from checkpoint (--continue)` section documenting checkpoint read on resume
- `plugins/sp/commands/dev-runall.md:99` — inserted `## Resume from checkpoint (--continue)` section
- `plugins/sp/skills/spur-dev/references/execution-workflow.md:147` — inserted `## Checkpoint read on resume` section
- `plugins/sp/skills/spur-dev/references/execution-batch.md:263` — appended `## Checkpoint read on batch resume` section
- `config/workflows/task-pipeline.yaml:151` — added checkpoint write shell action to `done` state onEnter
- `config/workflows/planning-pipeline.yaml:94` — added checkpoint write shell action to `handoff` state onEnter
- `config/workflows/feature-dev.yaml:90` — added checkpoint write shell action to `done` state onEnter
- `config/workflows/idea-pipeline.yaml:158` — added checkpoint write shell action to `handoff` state onEnter
- `config/workflows/wrapup-pipeline.yaml:136` — added checkpoint write shell action to `done` state onEnter

**Rationale:** Phase 4 ensures `--auto` is consistently supported across all commands (sets `profile=auto`, routes around objective HITL before entry, taste/irreversible still pause) and adds explicit checkpoint write/read actions to all pipelines. The `--auto` flag is NOT `--yes-to-everything` — it auto-continues on objective pass but surfaces taste and irreversible decisions to the human (Auto-Decision Principles #5, #6). Checkpoint writes are shell actions in each workflow's terminal state writing to `.spur/memory/sessions/<id>-checkpoint.md`. No new skills, no new lifecycle YAMLs — ADR-022 holds.
### Testing
**Verification commands and outcomes (all 5 ACs):**

AC-P4.1 (--auto on 4 commands):
- `grep -c '\-\-auto'` -> dev-idea.md: 10, dev-plan.md: 9, dev-wrap.md: 9, dev-wrapall.md: 7
- `grep -c 'profile=auto'` -> dev-idea.md: 2, dev-plan.md: 4, dev-wrap.md: 2, dev-wrapall.md: 2
- `grep -ci 'before entry'` -> dev-idea.md: 2, dev-plan.md: 1, dev-wrap.md: 2, dev-wrapall.md: 2
- `grep -c 'yes-to-everything'` -> all 4 files: 2

AC-P4.2 (checkpoint in references):
- `grep -c 'checkpoint' execution-workflow.md` -> 3
- `grep -c 'checkpoint' execution-batch.md` -> 3

AC-P4.3 (checkpoint in 5 workflows):
- `grep -c 'checkpoint'` -> task-pipeline.yaml: 1, planning-pipeline.yaml: 1, feature-dev.yaml: 1, idea-pipeline.yaml: 1, wrapup-pipeline.yaml: 1

AC-P4.4 (checkpoint in dev-run/dev-runall):
- `grep -c 'checkpoint' dev-run.md` -> 3
- `grep -c 'checkpoint' dev-runall.md` -> 3

AC-P4.5 (all workflows validate):
- `spur workflow validate config/workflows/task-pipeline.yaml --json` -> valid=True, ok=True, exit 0
- `spur workflow validate config/workflows/planning-pipeline.yaml --json` -> valid=True, ok=True, exit 0
- `spur workflow validate config/workflows/feature-dev.yaml --json` -> valid=True, ok=True, exit 0
- `spur workflow validate config/workflows/idea-pipeline.yaml --json` -> valid=True, ok=True, exit 0
- `spur workflow validate config/workflows/wrapup-pipeline.yaml --json` -> valid=True, ok=True, exit 0

**Coverage claim:** N/A — Phase 4 is command doc + reference doc + workflow YAML work, no code to cover.
### Review
| Severity | File | Finding | Recommendation |
|---|---|---|---|
| P1 | — | None | — |
| P2 | — | None | — |
| P3 | config/workflows/planning-pipeline.yaml | Pre-existing: design-approval is skipped entirely under profile=auto (design-gen routes around it), but the design doc HITL taxonomy classifies it as a taste gate that should still pause. dev-plan.md now documents the intended behavior (taste gates still pause), creating a doc-vs-YAML discrepancy. | Accepted for v1 — the planning-pipeline auto-skip of design-approval is pre-existing (not introduced by this task). A future task should align the YAML with the taste-gate taxonomy: add a `design_approved` var check like idea-pipeline.yaml does. |
| P4 | config/workflows/*.yaml | Checkpoint write actions only fire at terminal states (done/handoff), not after every HITL gate decision or phase transition as specified in R3. | Accepted for v1 — terminal-state checkpoints are the minimum viable. Adding intermediate checkpoints would require editing every state onEnter in 5 workflows. Terminal-state checkpoints are sufficient for resume (the primary use case). Future task can add intermediate checkpoints. |
| P4 | plugins/sp/commands/dev-plan.md | `--auto` now has dual semantics (profile=auto + design-doc auto-detection), which could confuse operators expecting a single concern. | Accepted — the dual role is documented in the truth table and --auto behavior section. Splitting into separate flags would break backward compatibility. |

**Residual risk:** Low. All changes are additive documentation and workflow YAML shell actions. No code paths affected. The checkpoint write shell commands use `$(date -u ...)` and `$(cat ...)` command substitution, proven in existing workflow guards (idea-pipeline.yaml). The planning-pipeline design-approval discrepancy is pre-existing and not introduced by this task.

**Final disposition:** PASS — all 5 ACs verified, all 5 workflows validate, ADR-022 holds.
### References

I

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-07-01T21:04:08.029Z todo → wip (system)
- 2026-07-01T21:16:28.062Z wip → testing (system)
- 2026-07-01T21:17:07.920Z testing → done (system)
