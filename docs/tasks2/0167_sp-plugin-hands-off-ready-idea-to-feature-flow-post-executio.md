---
template: standard
schema_version: 1
name: sp plugin hands-off ready — idea-to-feature flow + post-execution wrap-up + cross-session learning
description: ""
status: done
type: task
profile: standard
feature_id: I
parent_wbs: null
priority: P2
tags: []
dependencies: []
created_at: 2026-07-01T06:04:09.068Z
updated_at: 2026-07-02T00:49:19.134Z
---

## 0167. sp plugin hands-off ready — idea-to-feature flow + post-execution wrap-up + cross-session learning

### Background
The `sp` plugin (v0.2.3) is the Claude Code plugin surface for the Spur toolkit. It provides a full planning-to-execution pipeline: brainstorm → plan → run → verify, with CLI-gated writes preventing corpus corruption. The user wants to make the plugin "hands-off ready" — meaning minimal human intervention from idea to shipped code.

Two specific enhancement areas were requested:
1. **Idea-to-feature conversion** — better leverage existing tools (`spur feature`, `sp:spur-cli`, `agents/expert-spur.md`) to manage features and convert them into executable task files.
2. **Optional wrap-up step** — post-execution step to sync documentation and accumulate knowledge/experience.

Three reference repos were studied for patterns:
- `~/projects/cc-agents/plugins/rd3/` — original plugin sp migrated from (feature-planning, product-management)
- `vendors/Superpowers` — external agent skills repo (brainstorming, writing-plans)
- `vendors/gstack` — external agent skills repo (spec, autoplan, learn, retro, ship, context_save_restore)

Key patterns extracted:
- **rd3 feature-planning**: combined Phase 1+2 entry point (brainstorm→task→plan in one pass) with `--plan` flag — reduces context re-loads vs sp's multi-command sequence.
- **rd3 product-management**: elicitation taxonomy + per-profile decomposition decision rules — enriches sp's `plugins/sp/skills/spur-dev/references/product-planning.md` without creating a standalone PM skill.
- **gstack spec**: five-phase spec creation with automatic issue filing and worktree spawning.
- **gstack autoplan**: auto-decision pipeline using 6 principles to minimize human intervention at review gates.
- **gstack learn**: append-only learnings.jsonl with latest-wins dedup and cross-project search.
- **gstack ship**: verification iron law (non-negotiable checks before merge) + TODO auto-update + metrics persistence.
- **gstack context_save_restore**: markdown checkpoints with frontmatter for session persistence.
- **Superpowers brainstorming**: hard gate preventing implementation until design approved + "nothing is too simple" anti-pattern.
- **Superpowers writing-plans**: zero-context engineer assumption, file-structure mapping before task definition.

This task is a spec/parent task capturing the enhancement plan. It will be decomposed into implementable subtasks after plan approval.
### Requirements
R1. A new `/sp:dev-idea` command provides a unified entry point from vague idea to feature + task batch. It is a thin wrapper that runs `spur workflow run .spur/workflows/idea-pipeline.yaml` (the project-facing symlink to `config/workflows/idea-pipeline.yaml` in this repo). The workflow states are: start → discovery (sp:brainstorm) → feature-create → ac-generate → feature-check (gate) → system-design (sp:sys-architecture, design approval when needed) → decompose (sp:spec-decomposition, informed by design output) → batch-create (gate) → handoff. A design summary is always recorded by brainstorm ("nothing is too simple"); the heavier `system-design` step runs by default unless R16's `needs_design=false` signal or `--skip-design` bypasses it for trivial work. Design doc creation (ADR entries, architecture decisions, design satellites) happens in the system-design step — NOT in the wrapup-pipeline, which handles post-implementation doc sync only. With `--auto`, only objective gates auto-resolve per auto-decision principles (R3); taste/irreversible decisions still pause. The pipeline stops at handoff — tasks are created but not executed.

R2. `sp:brainstorm` is enhanced with 6 patterns from Superpowers: (1) hard design-summary gate — no downstream command proceeds without a recorded design summary; (2) "nothing is too simple" anti-pattern — every idea gets a design summary, even if short; (3) spec self-review — check for placeholders, contradictions, scope creep, ambiguity before handoff; (4) user review gate — operator reviews the written brainstorm doc; (5) incremental design presentation — overview → approaches → recommendation, each confirmed; (6) scope decomposition check — multi-subsystem ideas are flagged for decomposition before detailed brainstorming. The check also outputs a `needs_design` boolean signal consumed by `idea-pipeline.yaml`'s system-design step (R16): multi-subsystem/schema/transport/dependency changes → `needs_design=true`; single-module/bug-fix/pattern-following → `needs_design=false`. With `--auto`, objective gates route around prompts but the design summary is still recorded.

R3. Auto-decision principles are documented in `plugins/sp/skills/spur-dev/references/cross-cutting.md`: (1) schema-valid → auto-approve; (2) gate-passed → auto-continue; (3) tests-green → auto-continue; (4) verdict-PASS → auto-continue; (5) taste-decision → surface to human; (6) irreversible action → surface to human; (7) error → stop. The `--auto` flag uses these principles by routing around objective `hitl.confirm` states before they are entered; the workflow engine does not auto-dismiss HITL states by itself. Without `--auto`, gates surface to the human.

R4. Pre-gate verification checklists are documented in a new `plugins/sp/skills/spur-dev/references/gate-checklists.md` reference: feature-check gate, batch-create gate, precheck gate, review gate, verify gate. Each checklist is a checkbox list of prerequisites.

R5. A new `/sp:dev-wrap` command provides post-execution wrap-up for a single task: `spur workflow run .spur/workflows/wrapup-pipeline.yaml --vars '{"tasks":["<wbs>"]}'`. A new `/sp:dev-wrapall` command provides batch wrap-up: `spur workflow run .spur/workflows/wrapup-pipeline.yaml --vars '{"tasks":[...]}'` with `--since <date>` / `--feature <id>` / `--status <s>` options. `--since` is implemented in the wrapper by resolving `spur task list --json` output and filtering completed task files by frontmatter `updated_at >= <date>` until Spur grows a dedicated completion timestamp. The workflow states are: doc-sync (sp:doc-evolve) → learning-capture (write to `.spur/memory/learnings.md`) → metrics-record (append `.spur/memory/wrapup-metrics.jsonl`) → feature-transition (conditional, if --feature) → branch-cleanup (conditional, if --merge) → done. Wrap-up steps run ONCE for the entire batch (project-level doc-sync, aggregated learning-capture). Both `dev-wrap` and `dev-wrapall` support `--auto`, but branch cleanup still pauses because it is irreversible. The wrapup `doc-sync` step handles post-implementation drift (docs updated to reflect what was built, drift audit, lesson append) — distinct from the `idea-pipeline.yaml` system-design step which creates initial design docs (ADR entries, architecture decisions) before code (R1).

R6. A cross-session learning log is maintained at `.spur/memory/learnings.md` (markdown, not JSON). Entries include date, task WBS, insights, errors, and conventions. The `wrapup-pipeline.yaml` learning-capture step writes to it. The log is a working scratchpad — not CLI-gated, not a validated corpus.

R7. Session checkpoints are written to `.spur/memory/sessions/` after every gate transition and phase transition in the sp pipelines. Checkpoints are markdown files with YAML frontmatter (session_id, task_wbs or feature_id, workflow, run_id, phase, last_gate, timestamp, next_action). Implementation must add explicit checkpoint write/read steps to `task-pipeline.yaml`, `planning-pipeline.yaml`, `feature-dev.yaml`, `idea-pipeline.yaml`, `wrapup-pipeline.yaml`, and the `dev-run`/`dev-runall` resume instructions; documenting the convention alone is insufficient.

R8. Iron laws are documented in `plugins/sp/skills/spur-dev/references/cross-cutting.md`: (1) never skip the verification gate; (2) never write to task/feature corpus outside the spur CLI; (3) never mark a task done without a PASS verdict; (4) never proceed past a failed gate without explicit operator approval; (5) never suppress gate failures with --no-verify/--force/biome-ignore; (6) never create a standalone PM skill or command; (7) never claim completion without fresh verification evidence.

R9. The `--auto` flag is consistently supported across all gates and commands, using auto-decision principles (R3) to minimize human intervention while stopping for genuine taste decisions. `dev-idea` and `dev-wrap`/`dev-wrapall` pass `profile=auto` to their workflows. `--auto` is not `--yes-to-everything` — taste decisions still surface.

R10. All new commands, workflow YAMLs, references, and dev-operations entries are registered in `plugins/sp/skills/spur-dev/references/dev-operations.md` (the authoritative reference) and covered by new R-numbered structural invariant tests (R30+) in `plugins/sp/tests/skill-structure.test.ts`. No new skills are created — orchestration is expressed as workflow YAMLs per ADR-022.

R11. All enhancements respect sp's cross-cutting rules: every-write-is-CLI-gated, two-surface `--agent` contract, section-editing body-only workflow.

R12. `plugins/sp/skills/spur-dev/references/product-planning.md` constraint is respected: no standalone PM skill or command is created. Idea-to-feature conversion works within the existing `sp:spur-dev` spine + competency skills architecture. `plugins/sp/skills/spur-dev/references/product-planning.md` is enriched with elicitation question taxonomy and per-profile decomposition decision rules extracted from rd3:product-management.

R13. Pipeline YAMLs are aligned to avoid conflicts: each pipeline owns one lifecycle phase (ideation, planning, execution, wrap-up). Pipelines do not nest — no pipeline contains another pipeline's state machine. Pipelines may delegate via `agent.run` + `spur workflow run` (as `feature-dev.yaml` delegates to `task-pipeline.yaml`). The alignment is documented in `plugins/sp/skills/spur-dev/references/cross-cutting.md`.

R14. No new `*-lifecycle.yaml` workflows are added. The existing `feature-lifecycle.yaml` and `task-lifecycle.yaml` cover all persistent entities. New pipelines (`idea-pipeline.yaml`, `wrapup-pipeline.yaml`) are process flows that respect existing lifecycle guards via the `spur` CLI.

R15. The `wrapup-pipeline.yaml` transitions features through their existing lifecycle guards (via `spur feature update`), not around them. When `dev-wrapall --feature <id>` is used and all linked tasks are done/cancelled, the wrapper advances the feature idempotently by current status: `backlog → active` when needed, `active → verifying` with the normal feature check guard, then `verifying → done` with the strict guard. The workflow must not attempt a direct `active/backlog → done` transition. Task statuses are not mutated by wrap-up; input tasks are expected to be `done` unless `--status` explicitly selects another status for analysis-only wrap-up.
R16. Auto-detection for the system-design step: when neither `--design` nor `--skip-design` is set, the brainstorm skill's scope decomposition check (R2 pattern 6) outputs a `needs_design` boolean signal. If `needs_design=true` (default), the system-design step runs. If `needs_design=false` (trivial feature), it is skipped. `--design` forces `needs_design=true`; `--skip-design` forces `needs_design=false`. The criteria mirror the seam heuristic from `dev-plan-design-doc-generation.md`: multi-subsystem/schema/transport/dependency changes need design; single-module/bug-fix/pattern-following work can skip. Ties lean toward design (nothing is too simple, per R2 pattern 2).
### Acceptance Criteria

- AC1. `bun test plugins/sp/tests/skill-structure.test.ts` passes with new R30-R35 invariants and the pre-existing R29 invariant unchanged.
- AC2. `bun run apps/cli/src/index.ts workflow validate .spur/workflows/idea-pipeline.yaml --json` and `... wrapup-pipeline.yaml --json` both pass; validating the physical `config/workflows/*` targets is also acceptable in repo-local tests.
- AC3. `/sp:dev-idea "<idea>" --auto` creates or selects a feature, writes AC, runs feature check, records a brainstorm design summary, applies the R16 design-step routing, creates a validated task batch, and stops at handoff without executing tasks.
- AC4. `/sp:dev-wrap <wbs> --auto` and `/sp:dev-wrapall --feature <id> --auto` run project-level doc-sync once, append `.spur/memory/learnings.md`, append `.spur/memory/wrapup-metrics.jsonl`, and do not mutate task status.
- AC5. `dev-wrapall --feature <id>` advances the feature only through legal lifecycle edges (`backlog → active → verifying → done` as needed) and blocks if strict feature check fails.
- AC6. `--auto` skips only objective gates; design taste decisions and `--merge` branch cleanup still pause.
- AC7. Checkpoint files under `.spur/memory/sessions/` are written by the affected workflows and read by `dev-run`/`dev-runall` resume guidance.
- AC8. All new commands/reference/workflow files are registered in `plugins/sp/skills/spur-dev/references/dev-operations.md`, linked from `plugins/README.md`, and use the project-facing workflow path `.spur/workflows/*` in operator-facing command docs while accepting `config/workflows/*` as the physical repo source.

### Q&A

- 2026-07-01 refinement: `.spur/workflows/` is the correct project-facing workflow root and is symlinked to `config/workflows/` in this repo; operator-facing commands should use `.spur/workflows/*`, while repo-local tests may validate `config/workflows/*` directly.
- 2026-07-01 refinement: "nothing is too simple" means brainstorm always records a design summary; it does not force the heavy `sp:sys-architecture` step when R16 confidently classifies the work as trivial.
- 2026-07-01 refinement: `--auto` is not HITL auto-clicking. Workflows must route around objective HITL states before entry; taste/irreversible gates remain pauses.
- 2026-07-01 refinement: `--since` has no dedicated completion timestamp today; use done-task `updated_at` as the explicit v1 approximation and record real wrap-up metrics in `.spur/memory/wrapup-metrics.jsonl`.

### Design
## Overview

Eight enhancements organized into three groups: (A) idea-to-feature conversion, (B) post-execution wrap-up, (C) hands-off readiness. Key architectural decision: orchestration logic is expressed as `spur workflow` YAML files (ADR-022: orchestration is configuration), NOT as new skills. This means **zero new skills** — only 2 new workflow YAMLs + 3 thin command wrappers + reference updates.

## Pipeline Alignment (R13)

Each pipeline owns one phase of the development lifecycle. Pipelines do not nest — no pipeline contains another pipeline's state machine. Pipelines may delegate via `agent.run` + `spur workflow run` (as `feature-dev.yaml` already delegates to `task-pipeline.yaml`).

| Pipeline | Phase | Entry Point | Terminal States | Status |
|---|---|---|---|---|
| `idea-pipeline.yaml` | Ideation: idea → feature + AC + task batch | `dev-idea` | handoff, cancelled | NEW |
| `planning-pipeline.yaml` | Design: feature → design doc | `dev-plan` | handoff, cancelled | EXISTING |
| `task-pipeline.yaml` | Execution: single task → done | `dev-run` | done, failed | EXISTING |
| `wrapup-pipeline.yaml` | Wrap-up: done → docs synced + learnings | `dev-wrap` / `dev-wrapall` | done, skipped | NEW |
| `feature-dev.yaml` | Umbrella: idea → done (full loop) | `dev-runall --feature` | done, failed | EXISTING |
| `basic.yaml` | Simple: implement → check → fix | direct | done, failed | EXISTING |

**Overlap management:**
- `idea-pipeline.yaml` and `feature-dev.yaml` share the brainstorm+plan steps. This is intentional: `idea-pipeline` stops at handoff (tasks created), `feature-dev` continues to execution. Duplication is in YAML calls, not logic (logic lives in skills).
- `planning-pipeline.yaml` starts from a known slug (design-doc focus). `idea-pipeline.yaml` starts from a vague idea (discovery focus). Different entry conditions, different exits.
- Rule: each pipeline is a self-contained phase boundary with distinct entry/exit points.

**Lifecycle workflows (R14):** No new `*-lifecycle.yaml` workflows. Existing `feature-lifecycle.yaml` and `task-lifecycle.yaml` cover all persistent entities. New pipelines respect lifecycle guards via `spur` CLI verbs.

## A. Idea-to-Feature Conversion

**A1. Unified entry point: `/sp:dev-idea` + `idea-pipeline.yaml`**

**Problem.** Going from a vague idea to a feature requires multiple commands: `dev-brainstorm` → `dev-plan` → (manually) `spur feature create` → `spur task batch-create`. Multi-step, context-heavy, loses state.

**Source pattern.** rd3 `feature-planning` — combined Phase 1+2 entry point with `--plan` flag. gstack `spec` — five-phase spec creation from vague intent.

**Adaptation.** New `/sp:dev-idea` command + new `.spur/workflows/idea-pipeline.yaml` state-machine workflow (physically `config/workflows/idea-pipeline.yaml` in this repo). The command is a thin wrapper: `spur workflow run .spur/workflows/idea-pipeline.yaml --vars '{"slug":"...","profile":"interactive|auto","feature":"...","skip_design":false}'`. The workflow states:

1. `start` → `discovery` — `agent.run` dispatching `sp:brainstorm` discovery phase (skip if `--skip-discovery`).
2. `discovery` → `feature-create` — `agent.run` executing `spur feature create` with auto-derived hierarchical ID.
3. `feature-create` → `ac-generate` — `agent.run` writing AC per `ac-style-guide.md`, then `spur feature update <id> --section acceptance-criteria --from-file <path>`.
4. `ac-generate` → `feature-check` — `hitl.confirm` gate: `spur feature check <id> --strict`. Auto-decision principles apply (R3).
5. `feature-check` → `system-design` — `agent.run` dispatching `sp:sys-architecture` to produce design doc (module boundaries, data flow, ADR entries for cross-cutting decisions). The skill routes decisions through the constitution rules (`docs/00_ADR.md` first when a new cross-cutting decision exists, then `docs/03_ARCHITECTURE.md`/`docs/04_DESIGN.md` as applicable). Design approval is a taste gate and remains a pause unless the operator has explicitly approved the design in-session. With `--skip-design` or `needs_design=false`, this step is bypassed: `feature-check` → `decompose` directly, using the brainstorm design summary as the decomposition input.
6. `system-design` → `decompose` — `agent.run` dispatching `sp:spec-decomposition` with the design doc as input, producing task batch JSON that aligns with the design's module boundaries.
7. `decompose` → `batch-create` — `hitl.confirm` gate: `spur task batch-create --file <batch.json>`. Auto-decision principles apply.
8. `batch-create` → `handoff` (terminal) — pass WBS numbers to the operator for `dev-run`/`dev-runall`.

With `profile=auto` (via `--auto`), objective `hitl.confirm` states are routed around per auto-decision principles; taste and irreversible decisions still pause.
**Doc-sync boundary.** The `system-design` step (step 5) creates initial design docs — ADR entries to `docs/00_ADR.md`, architecture decisions to `docs/03_ARCHITECTURE.md`, design shapes to `docs/04_DESIGN.md`. This is fundamentally different from the `wrapup-pipeline.yaml` `doc-sync` step (R5), which handles post-implementation drift (docs updated to reflect what was actually built, drift audit, lesson append). Design-step doc creation is "write the high-level plan before code"; wrapup doc-sync is "update docs to match implementation." Conflating these two is a correctness risk — design decisions must be recorded before decomposition, not after implementation.
**Auto-detection (R16).** When neither `--design` nor `--skip-design` is set, the system-design step's execution is determined by the `needs_design` signal from the brainstorm skill's scope decomposition check (R2 pattern 6). The signal is passed as a workflow var. Ties lean toward design (R2 pattern 2). The criteria mirror the seam heuristic from `dev-plan-design-doc-generation.md`.

| Flags | `needs_design` signal | System-design step |
|---|---|---|
| `--design` | (ignored) | Runs (forced on) |
| `--skip-design` | (ignored) | Skipped (forced off) |
| neither | `true` (multi-subsystem/schema/transport/dependency) | Runs |
| neither | `false` (single-module/bug-fix/pattern-following) | Skipped |

**Why a workflow, not a skill.** Orchestration is configuration (ADR-022). The workflow YAML orchestrates the flow; existing skills (`brainstorm`, `spec-decomposition`, `sys-architecture`) are invoked by `agent.run` steps. No orchestration logic in skill files.

**Impacted surfaces.**
- New: `plugins/sp/commands/dev-idea.md`, `.spur/workflows/idea-pipeline.yaml` (`config/workflows/idea-pipeline.yaml` physical source)
- Updated: `plugins/sp/skills/spur-dev/references/dev-operations.md` (new operation), `plugins/sp/skills/spur-dev/references/cross-cutting.md` (pipeline alignment principle), `plugins/sp/tests/skill-structure.test.ts` (R30+), `plugins/README.md`

**A2. Brainstorm enhancement: 6 Superpowers patterns + elicitation enrichment**

**Problem.** sp's brainstorm has no hard gate preventing premature implementation. The operator can jump from brainstorm to code without an approved design. The brainstorm also lacks spec self-review, user review, incremental presentation, and scope decomposition checks.

**Source patterns.**
- Superpowers `brainstorming` — hard gate + "nothing is too simple" anti-pattern.
- Superpowers `writing-plans` — scope decomposition check (multi-subsystem → decompose first).
- rd3 `product-management/elicitation.md` — expertise-adaptive questioning. Enriches the existing `plugins/sp/skills/spur-dev/references/product-planning.md` extraction.

**Adaptation.** Enhance `sp:brainstorm/SKILL.md` with six patterns:

1. **Hard gate** — Add `## Design Approval Gate` section. After the Output phase, before any handoff, the brainstorm MUST present a structured design summary and explicitly ask for approval. With `--auto`, the gate auto-approves but still records the design summary. Hard stop: no downstream command proceeds without a recorded approval.

2. **"Nothing is too simple"** — Every idea goes through the process. The design can be short (1 paragraph for a trivial idea) but must be presented. No skipping the gate.

3. **Spec self-review** — After writing the brainstorm doc, run an inline self-review checking for: (a) placeholders (TODO, TBD, ???); (b) contradictions between sections; (c) scope creep beyond the original idea; (d) ambiguity. Fix or flag before handoff.

4. **User review gate** — After self-review, ask the operator to review the written brainstorm doc. With `--auto`, skip the prompt but still output the doc path.

5. **Incremental design presentation** — Present in sections: (a) overview → confirm; (b) 2-3 approaches with tradeoffs → confirm; (c) recommendation with confidence score → confirm. With `--auto`, all sections presented at once.

6. **Scope decomposition check** — If the idea spans multiple independent subsystems (multiple distinct user-facing surfaces, multiple data models, multiple integration points), flag it and recommend decomposition via `sp:spec-decomposition` before brainstorming details.

**Elicitation enrichment (FP1).** Enhance the discovery phase with expertise-adaptive questioning from rd3:product-management/elicitation.md: detect operator expertise from the initial idea, adjust question depth, use a question taxonomy (purpose, scope, constraints, success criteria). Also enrich `plugins/sp/skills/spur-dev/references/product-planning.md` with per-profile decomposition decision rules from rd3:product-management/decomposition-strategies.md (simplify/mvp/standard/mature).

**Impacted surfaces.**
- Updated: `plugins/sp/skills/brainstorm/SKILL.md` (6 new patterns), `plugins/sp/skills/spur-dev/references/cross-cutting.md` (document the gate), `plugins/sp/skills/spur-dev/references/product-planning.md` (elicitation taxonomy + decomposition decision rules)

**A3. Auto-decision principles in `plugins/sp/skills/spur-dev/references/cross-cutting.md`**

**Problem.** Review gates require human intervention even for clear-cut decisions (AC format is valid, batch JSON passes schema, tests pass).

**Source pattern.** gstack `autoplan` — 6 decision principles for auto-resolving clear-cut decisions.

**Adaptation.** Add `## Auto-Decision Principles` section to `plugins/sp/skills/spur-dev/references/cross-cutting.md`:

1. Schema-valid → auto-approve. 2. Gate-passed → auto-continue. 3. Tests-green → auto-continue. 4. Verdict-PASS → auto-continue. 5. Taste-decision → surface. 6. Irreversible action → surface. 7. Error → stop.

The `--auto` flag uses these principles. Without `--auto`, all gates surface to the human.

**Impacted surfaces.** Updated: `plugins/sp/skills/spur-dev/references/cross-cutting.md`

**A4. Pre-gate verification checklists**

**Problem.** Gates rely on the LLM remembering all prerequisites.

**Source pattern.** gstack pre-gate verification — checkbox checklists.

**Adaptation.** New reference file `spur-dev/references/gate-checklists.md`: feature-check gate, batch-create gate, precheck gate, review gate, verify gate. Each is a checkbox list.

**Impacted surfaces.** New: `plugins/sp/skills/spur-dev/references/gate-checklists.md`. Updated: `plugins/sp/tests/skill-structure.test.ts` (R30+), `plugins/README.md`

## B. Post-Execution Wrap-Up

**B1. Wrap-up workflow: `/sp:dev-wrap` + `/sp:dev-wrapall` + `wrapup-pipeline.yaml`**

**Problem.** After task/feature completion, there's no automatic step to sync docs, capture learnings, and update related artifacts.

**Source pattern.** gstack `ship` (verification iron law, metrics persistence), gstack `learn` (structured learning capture), gstack `retro` (retrospective).

**Adaptation.** ONE workflow (`wrapup-pipeline.yaml`), TWO commands:

- `/sp:dev-wrap <wbs>` — single-task wrap-up. Passes `{"tasks":["<wbs>"]}` to the workflow.
- `/sp:dev-wrapall` — batch wrap-up. Resolves task list, passes `{"tasks":[...]}` to the workflow. Options:
  - `--since <iso-date>`: tasks with `done` status since this date
  - `--feature <id>`: all tasks under this feature (also transitions feature to `done` via lifecycle guard)
  - `--status <s>`: filter by status (default: `done`)
  - `--auto`: skip HITL

The workflow states (run ONCE for the entire batch — project-level steps):
1. `start` → `doc-sync` — `agent.run` dispatching `sp:doc-evolve` (sync-check, drift-audit, lesson-append).
2. `doc-sync` → `learning-capture` — `agent.run` extracting learnings from all tasks. Write to `.spur/memory/learnings.md`.
3. `learning-capture` → `metrics-record` — `agent.run` recording task durations, verdicts, gate decisions.
4. `metrics-record` → `feature-transition` (conditional, if `--feature` flag) — `spur feature update <id> done` (enforces `feature-lifecycle.yaml` guard with `spur feature check --strict`).
5. `feature-transition` → `branch-cleanup` (conditional, if `--merge` flag) — `agent.run` dispatching `sp:branch-workflow`.
6. `branch-cleanup` → `done` (terminal).

With `profile=auto` (via `--auto`), objective gates route around prompts. Branch cleanup still uses an `hitl.confirm` pause because merge/delete is irreversible.

**Dual entry on dev-run/dev-runall.** `--wrap` flag on `dev-run`/`dev-runall` triggers `wrapup-pipeline.yaml` after the last task completes. This is equivalent to running `dev-wrap`/`dev-wrapall` after execution.

**Lifecycle guard respect (R15).** The workflow transitions features through existing lifecycle guards via `spur feature update`, not around them. Task statuses are not mutated during wrap-up; the workflow YAML header documents this.

**Impacted surfaces.**
- New: `plugins/sp/commands/dev-wrap.md`, `plugins/sp/commands/dev-wrapall.md`, `.spur/workflows/wrapup-pipeline.yaml` (`config/workflows/wrapup-pipeline.yaml` physical source)
- Updated: `plugins/sp/commands/dev-run.md` (`--wrap` flag), `plugins/sp/commands/dev-runall.md` (`--wrap` flag), `plugins/sp/skills/spur-dev/references/dev-operations.md`, `plugins/sp/tests/skill-structure.test.ts` (R30+), `plugins/README.md`

**B2. Cross-session learning log**

**Problem.** sp has no structured mechanism to capture learnings across sessions. `doc-evolve`'s lesson-append is constitution-scoped, not task-scoped.

**Source pattern.** gstack `learn` — append-only log with dedup.

**Adaptation.** Simple markdown-based learning log under `.spur/memory/learnings.md`:

```markdown
## 2026-07-01 — Task 0167

### Insights
- The `spur feature check --strict` gate also validates AC R-numbering.
- Decomposition granularity: 1-2 day tasks work best.

### Errors
- `spur task batch-create` fails silently if dependencies reference non-existent WBS numbers.

### Conventions
- Always use `--json` output when scripting spur commands.
```

**Why markdown, not JSON.** The user prefers simple markdown for working scratchpads. Markdown is directly readable by the agent without parsing. The `doc-evolve` lesson-append handles promoting high-value learnings to the constitution.

**Impacted surfaces.** New: `.spur/memory/learnings.md` (convention). Updated: `wrapup-pipeline.yaml`, `plugins/sp/skills/spur-dev/references/cross-cutting.md`

**B3. Session checkpoints**

**Problem.** Long pipeline runs lose context across sessions.

**Source pattern.** gstack `context_save_restore` — markdown checkpoints with frontmatter.

**Adaptation.** Lightweight checkpoints under `.spur/memory/sessions/`:

```markdown
---
session_id: 2026-07-01-0167
task_wbs: "0167"
phase: implement
last_gate: precheck-passed
timestamp: "2026-07-01T14:30:00Z"
---

## State
- Task 0167 is in implement phase.
- Next: dispatch sp:code-implementation for subtask 0167.1.
```

**When written:** after every gate transition, after every phase transition.
**When read:** on `dev-run` resume, on session start if operator says "continue where we left off".

**Impacted surfaces.** New: `.spur/memory/sessions/` (convention). Updated: `plugins/sp/skills/spur-dev/references/execution-workflow.md`, `plugins/sp/skills/spur-dev/references/execution-batch.md`

## C. Hands-Off Readiness

**C1. Iron laws in `plugins/sp/skills/spur-dev/references/cross-cutting.md`**

**Source pattern.** gstack iron law pattern + Superpowers `verification-before-completion`.

**Adaptation.** Add `## Iron Laws` section to `plugins/sp/skills/spur-dev/references/cross-cutting.md`:

1. NEVER skip the verification gate. 2. NEVER write to the corpus outside the `spur` CLI. 3. NEVER mark a task done without a PASS verdict. 4. NEVER proceed past a failed gate without explicit approval. 5. NEVER suppress gate failures. 6. NEVER create a standalone PM skill or command. 7. NEVER claim completion without fresh verification evidence.

**Impacted surfaces.** Updated: `plugins/sp/skills/spur-dev/references/cross-cutting.md`

**C2. `--auto` flag propagation**

**Adaptation.** Ensure `--auto` is supported on: `dev-idea` (new), `dev-plan`, `dev-run`/`dev-runall` (existing), `dev-wrap`/`dev-wrapall` (new). `--auto` is not `--yes-to-everything` — taste decisions still surface (A3 principle 5).

**Impacted surfaces.** Updated: all command files, corresponding skills/references

**C3. Structural test coverage**

**Adaptation.** Since no new skills are created, test entries cover commands, workflows, and references:
- **R30**: `dev-idea`, `dev-wrap`, `dev-wrapall` commands exist with valid frontmatter and delegate to the correct workflows.
- **R31**: `plugins/sp/skills/spur-dev/references/gate-checklists.md` exists and is linked from `plugins/sp/skills/spur-dev/SKILL.md`.
- **R32**: `plugins/sp/skills/spur-dev/references/dev-operations.md` includes entries for `idea`, `wrap`, and `wrapall` operations.
- **R33**: `plugins/sp/skills/spur-dev/references/cross-cutting.md` includes `## Auto-Decision Principles`, `## Iron Laws`, `## Design Approval Gate`, `## Learning Log Convention`, `## Session Checkpoint Convention`, `## Pipeline Alignment` sections.
- **R34**: `.spur/workflows/idea-pipeline.yaml` and `.spur/workflows/wrapup-pipeline.yaml` exist and validate against the state-machine workflow schema; repo-local tests may validate the symlink targets under `config/workflows/`.
- **R35**: `plugins/sp/skills/brainstorm/SKILL.md` includes `## Design Approval Gate` and emits the `needs_design` signal contract.

**Impacted surfaces.** Updated: `plugins/sp/tests/skill-structure.test.ts`

## Decomposition Preview

This parent task will decompose into approximately 7-8 subtasks:
1. A2: Brainstorm enhancement (6 Superpowers patterns + elicitation enrichment)
2. A3+A4: Auto-decision principles + gate checklists in `plugins/sp/skills/spur-dev/references/cross-cutting.md` + new reference
3. B1: `dev-wrap` + `dev-wrapall` commands + `wrapup-pipeline.yaml` workflow + `--wrap` flag
4. B2+B3: Learning log + session checkpoint conventions
5. A1: `dev-idea` command + `idea-pipeline.yaml` workflow
6. C1+C2: Iron laws in `plugins/sp/skills/spur-dev/references/cross-cutting.md` + `--auto` flag propagation
7. C3: Structural test coverage (R30-R35)
8. Pipeline alignment documentation in `plugins/sp/skills/spur-dev/references/cross-cutting.md`

## Non-Goals

- **GitHub issue filing** (gstack spec pattern) — out of scope. sp is local-first; issue filing is the agent's concern.
- **Worktree spawning** (gstack spec pattern) — already handled by `sp:branch-workflow` skill.
- **Weekly retrospective** (gstack retro pattern) — deferred. `daily-summary` covers daily; weekly retro is a future enhancement.
- **Cross-project learning search** (gstack learn pattern) — deferred. Per-project learning log is sufficient.
- **PRD template files** (rd3 product-management pattern) — out of scope per `plugins/sp/skills/spur-dev/references/product-planning.md` constraint. PRD-shaped output guidance is already in `plugins/sp/skills/spur-dev/references/product-planning.md`.
- **New lifecycle workflows** — not needed. Existing `feature-lifecycle.yaml` and `task-lifecycle.yaml` cover all persistent entities.
### Plan
## Sub-Task Roster

| WBS | Task | Phase | Status |
|-----|------|-------|--------|
| 0168 | Phase 1 — Foundation, cross-cutting conventions, brainstorm enhancement | 1 | done |
| 0169 | Phase 2 — Wrap-up workflow, wrapup-pipeline.yaml, dev-wrap/dev-wrapall | 2 | done |
| 0170 | Phase 3 — Idea-to-feature workflow, idea-pipeline.yaml, dev-idea | 3 | done |
| 0171 | Phase 4 — Auto-flag propagation, checkpoint write/read actions | 4 | done |
| 0172 | Phase 5 — Documentation, README, plugin.json 0.3.0, dev-operations | 5 | done |
| 0173 | Phase 6 — Verification, R30-R35 structural tests, full gate dogfood | 6 | done |
| 0174 | 0167 Follow-ups — post-implementation actions (Track B operational) | — | testing |
| 0175 | spur feature update --section --from-file support (unblocks ac-generate) | — | todo |

## Overview

6 phases, 27 steps. Each phase is independently testable. Phases are sequential — phase N+1 depends on phase N's outputs (files, conventions, commands). Within a phase, steps are sequential.

## Phase 1: Foundation (steps 1-6)

**Goal:** Establish the cross-cutting conventions and enhance brainstorm before building any new commands or workflows.

| Step | Action | Impacted Surfaces | Verify |
|---|---|---|---|
| 1 | Add `## Iron Laws` section to `plugins/sp/skills/spur-dev/references/cross-cutting.md` (7 laws) | `plugins/sp/skills/spur-dev/references/cross-cutting.md` | grep for `## Iron Laws` |
| 2 | Add `## Auto-Decision Principles` section to `plugins/sp/skills/spur-dev/references/cross-cutting.md` (7 principles, including irreversible-action pause) | `plugins/sp/skills/spur-dev/references/cross-cutting.md` | grep for `## Auto-Decision Principles` |
| 3 | Enhance `sp:brainstorm/SKILL.md` with 6 Superpowers patterns (hard gate, nothing-too-simple, spec self-review, user review gate, incremental presentation, scope decomposition check with `needs_design` signal output per R16) | `plugins/sp/skills/brainstorm/SKILL.md` | R35 test passes |
| 4 | Enrich `plugins/sp/skills/spur-dev/references/product-planning.md` with elicitation question taxonomy + per-profile decomposition decision rules (extracted from rd3:product-management) | `plugins/sp/skills/spur-dev/references/product-planning.md` | grep for `## Elicitation Question Taxonomy` and `## Decomposition Decision Rules` |
| 5 | Create `plugins/sp/skills/spur-dev/references/gate-checklists.md` reference (feature-check, batch-create, precheck, review, verify gate checklists) | New: `plugins/sp/skills/spur-dev/references/gate-checklists.md` | R31 test passes |
| 6 | Add `## Pipeline Alignment` section to `plugins/sp/skills/spur-dev/references/cross-cutting.md` (pipeline phase table + no-nesting principle + lifecycle guard respect) | `plugins/sp/skills/spur-dev/references/cross-cutting.md` | grep for `## Pipeline Alignment` |

## Phase 2: Wrap-Up Workflow (steps 7-12)

**Goal:** Build the post-execution wrap-up flow (B1-B3).

| Step | Action | Impacted Surfaces | Verify |
|---|---|---|---|
| 7 | Create `wrapup-pipeline.yaml` state-machine workflow (start → doc-sync → learning-capture → metrics-record → feature-transition → branch-cleanup → done) | New: `.spur/workflows/wrapup-pipeline.yaml` (`config/workflows/wrapup-pipeline.yaml` physical source) | `spur workflow validate .spur/workflows/wrapup-pipeline.yaml --json` |
| 8 | Create `/sp:dev-wrap` command (single-task wrap-up, passes `{"tasks":["<wbs>"]}` to workflow) | New: `plugins/sp/commands/dev-wrap.md` | R30 test passes |
| 9 | Create `/sp:dev-wrapall` command (batch wrap-up with `--since`/`--feature`/`--status`/`--auto` options) | New: `plugins/sp/commands/dev-wrapall.md` | R30 test passes |
| 10 | Add `--wrap` flag to `dev-run` and `dev-runall` commands | `plugins/sp/commands/dev-run.md`, `plugins/sp/commands/dev-runall.md` | grep for `--wrap` in both files |
| 11 | Register `wrap` and `wrapall` operations in `plugins/sp/skills/spur-dev/references/dev-operations.md` | `plugins/sp/skills/spur-dev/references/dev-operations.md` | R32 test passes |
| 12 | Add `## Learning Log Convention` and `## Session Checkpoint Convention` sections to `plugins/sp/skills/spur-dev/references/cross-cutting.md` | `plugins/sp/skills/spur-dev/references/cross-cutting.md` | grep for both sections |

## Phase 3: Idea-to-Feature Workflow (steps 13-17)

**Goal:** Build the unified idea-to-feature entry point (A1).

| Step | Action | Impacted Surfaces | Verify |
|---|---|---|---|
| 13 | Create `idea-pipeline.yaml` state-machine workflow (start → discovery → feature-create → ac-generate → feature-check → system-design → decompose → batch-create → handoff). System-design step dispatches `sp:sys-architecture` with HITL approval gate; auto-detection (R16) uses `needs_design` signal from brainstorm to determine whether system-design runs; `--design`/`--skip-design` flags override auto-detection | New: `.spur/workflows/idea-pipeline.yaml` (`config/workflows/idea-pipeline.yaml` physical source) | `spur workflow validate .spur/workflows/idea-pipeline.yaml --json` |
| 14 | Create `/sp:dev-idea` command (thin wrapper: `spur workflow run .spur/workflows/idea-pipeline.yaml`) | New: `plugins/sp/commands/dev-idea.md` | R30 test passes |
| 15 | Register `idea` operation in `plugins/sp/skills/spur-dev/references/dev-operations.md` | `plugins/sp/skills/spur-dev/references/dev-operations.md` | R32 test passes |
| 16 | Add `## Design Approval Gate` section to `plugins/sp/skills/spur-dev/references/cross-cutting.md` (documenting the brainstorm hard gate) | `plugins/sp/skills/spur-dev/references/cross-cutting.md` | grep for `## Design Approval Gate` |
| 17 | Validate pipeline alignment: verify `idea-pipeline.yaml` stops at handoff, `feature-dev.yaml` continues to execution, no nesting | `config/workflows/idea-pipeline.yaml` | manual review: no state in idea-pipeline calls another pipeline |

## Phase 4: Auto-Flag Propagation (steps 18-19)

**Goal:** Ensure `--auto` is consistently supported across all commands (C2).

| Step | Action | Impacted Surfaces | Verify |
|---|---|---|---|
| 18 | Add `--auto` flag to `dev-idea`, `dev-plan`, `dev-wrap`, `dev-wrapall` commands (with documentation that `--auto` uses auto-decision principles) | `plugins/sp/commands/dev-idea.md`, `plugins/sp/commands/dev-plan.md`, `plugins/sp/commands/dev-wrap.md`, `plugins/sp/commands/dev-wrapall.md` | grep for `--auto` in each file |
| 19 | Add checkpoint write/read support: document the convention in `execution-workflow.md` / `execution-batch.md`, add explicit checkpoint actions to `task-pipeline.yaml`, `planning-pipeline.yaml`, `feature-dev.yaml`, `idea-pipeline.yaml`, and `wrapup-pipeline.yaml`, and make `dev-run` / `dev-runall` read the latest checkpoint before resume | `plugins/sp/skills/spur-dev/references/execution-workflow.md`, `plugins/sp/skills/spur-dev/references/execution-batch.md`, `config/workflows/*.yaml`, `plugins/sp/commands/dev-run.md`, `plugins/sp/commands/dev-runall.md` | grep for `checkpoint`; dry-run workflow validates |

## Phase 5: Documentation (steps 20-22)

**Goal:** Update plugin metadata and documentation.

| Step | Action | Impacted Surfaces | Verify |
|---|---|---|---|
| 20 | Update `plugins/README.md` with new commands (`dev-idea`, `dev-wrap`, `dev-wrapall`), new workflows (`idea-pipeline.yaml`, `wrapup-pipeline.yaml`), new reference (`plugins/sp/skills/spur-dev/references/gate-checklists.md`) | `plugins/README.md` | manual review |
| 21 | Bump `plugin.json` version from 0.2.3 to 0.3.0 | `plugins/sp/plugin.json` | grep for `"version": "0.3.0"` |
| 22 | Verify `plugins/sp/skills/spur-dev/references/dev-operations.md` is complete: all 16 operations listed (13 existing + 3 new: `idea`, `wrap`, `wrapall`) | `plugins/sp/skills/spur-dev/references/dev-operations.md` | R32 test passes |
| 22b | Create `docs/design/e2e-workflow-for-system-development.md` design doc (end-to-end workflow system: pipeline architecture, design step auto-detection, HITL gate model, doc-sync boundary) + add satellite row to `04_DESIGN.md` §0 | New: `docs/design/e2e-workflow-for-system-development.md`. Updated: `docs/04_DESIGN.md` | satellite exists in `docs/design/`, row in `04_DESIGN.md` §0 |

## Phase 6: Verification (steps 23-26)

**Goal:** Run the full verification gate.

| Step | Action | Verify |
|---|---|---|
| 23 | Add structural test entries R30-R35 to `plugins/sp/tests/skill-structure.test.ts` | `bun test` passes with all R30-R35 |
| 24 | Run lint + typecheck + tests | `bun run lint` clean, `bun run test` passes |
| 25 | Dogfood: run `/sp:dev-idea "add a --dry-run flag to dev-wrap"` end-to-end | idea-pipeline.yaml executes: discovery → feature-create → ac-generate → feature-check → system-design → decompose → batch-create → handoff |
| 26 | Dogfood: run `/sp:dev-wrapall --since 2026-07-01` end-to-end | wrapup-pipeline.yaml executes: doc-sync → learning-capture → metrics-record → done |

## Dependencies

```
Phase 1 (Foundation) → Phase 2 (Wrap-Up) → Phase 3 (Idea-to-Feature) → Phase 4 (Auto-Flag) → Phase 5 (Documentation) → Phase 6 (Verification)
```

Phase 1 must complete first because Phase 2 and 3 depend on the conventions in `plugins/sp/skills/spur-dev/references/cross-cutting.md`. Phase 3 depends on Phase 2's `plugins/sp/skills/spur-dev/references/dev-operations.md` registration pattern. Phase 4 depends on Phase 2 and 3's commands. Phase 5 documents all prior phases. Phase 6 verifies everything.

<!-- Filled during implementation: file:line change map and concise rationale. -->


<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->


<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

## Internal (sp plugin)

**sp Plugin Core**
- **ADR-022**: Orchestration is configuration — `spur workflow` YAML files are the orchestration mechanism, not skills.
- **`plugins/sp/plugin.json`**: Plugin manifest (version 0.2.3 → 0.3.0 after this task).
- **`plugins/README.md`**: Plugin README — command/workflow/skill inventory.
- **`plugins/sp/skills/spur-dev/SKILL.md`**: The thin orchestration spine — dispatches competency skills, owns the lifecycle FSM, CLI-gated section-write contract.
- **`plugins/sp/skills/spur-dev/references/dev-operations.md`**: Authoritative operation reference — 13 existing operations + 3 new (`idea`, `wrap`, `wrapall`).
- **`plugins/sp/skills/spur-dev/references/cross-cutting.md`**: Cross-cutting rules — two-surface `--agent` contract, auto-decision principles, iron laws, pipeline alignment, learning log convention, session checkpoint convention.
- **`plugins/sp/skills/spur-dev/references/product-planning.md`**: PM constraint — no standalone PM skill/command; elicitation taxonomy + decomposition decision rules.
- **`plugins/sp/skills/spur-dev/references/ac-style-guide.md`**: AC conventions — R-numbering, @core/@edge tiers.
- **`plugins/sp/skills/spur-dev/references/execution-workflow.md`**: Task pipeline execution loop (precheck → implement → test → review → verify → record → done).
- **`plugins/sp/skills/spur-dev/references/execution-batch.md`**: Batch execution loop (resolve → topo-sort → per-task pipeline → batch report).
- **`plugins/sp/skills/spur-dev/references/feature-link-helper.md`**: Feature↔task linking helper.
- **`plugins/sp/skills/brainstorm/SKILL.md`**: Current brainstorm skill (3-phase workflow, to be enhanced with 6 Superpowers patterns).
- **`plugins/sp/skills/spec-decomposition/SKILL.md`**: Decomposition competency — turns validated feature into task batch.
- **`plugins/sp/skills/doc-evolve/SKILL.md`**: Document evolution — drift audit, sync check, lesson-append.
- **`plugins/sp/skills/branch-workflow/SKILL.md`**: Branch lifecycle — create, merge, cleanup.
- **`plugins/sp/skills/sys-architecture/SKILL.md`**: Architecture competency — design docs, ADR entries.
- **`plugins/sp/agents/super-coder.md`**: Task pipeline driver agent.
- **`plugins/sp/agents/expert-spur.md`**: Spur CLI corpus work agent.
- **`plugins/sp/tests/skill-structure.test.ts`**: Structural invariants test (R13–R28; R30-R35 added by this task).

**sp Plugin Commands (existing)**
- `dev-brainstorm.md`, `dev-plan.md`, `dev-run.md`, `dev-runall.md`, `dev-refine.md`, `dev-verify.md`, `dev-unit.md`, `dev-dogfood.md`, `dev-handover.md`, `dev-fixall.md`, `dev-gitmsg.md`, `dev-review.md`, `dev-changelog.md`, `dev-parallel.md`

**sp Plugin Commands (new, created by this task)**
- `dev-idea.md` — unified idea-to-feature entry point (wraps `idea-pipeline.yaml`)
- `dev-wrap.md` — single-task post-execution wrap-up (wraps `wrapup-pipeline.yaml`)
- `dev-wrapall.md` — batch post-execution wrap-up (wraps `wrapup-pipeline.yaml` with task list)

**Existing Spur Workflows**
- **`config/workflows/basic.yaml`**: Simple implement → check → fix → done loop.
- **`config/workflows/feature-dev.yaml`**: Umbrella: brainstorm → plan → execute-tasks → feature-verify → done. Delegates task execution to `task-pipeline.yaml`.
- **`config/workflows/feature-lifecycle.yaml`**: Feature FSM: backlog → active → verifying → done; cancelled terminal.
- **`config/workflows/planning-pipeline.yaml`**: Front-half planning: phasing → feature-id → design-gen → design-approval → handoff.
- **`config/workflows/task-lifecycle.yaml`**: Task FSM: backlog → todo → wip → testing → done; cancelled terminal.
- **`config/workflows/task-pipeline.yaml`**: Task execution: precheck → implement → test → review → approve → verify → record → done.

**New Spur Workflows (created by this task)**
- **`.spur/workflows/idea-pipeline.yaml`** (`config/workflows/idea-pipeline.yaml` physical source): Ideation phase: start → discovery → feature-create → ac-generate → feature-check → system-design → decompose → batch-create → handoff.
- **`.spur/workflows/wrapup-pipeline.yaml`** (`config/workflows/wrapup-pipeline.yaml` physical source): Wrap-up phase: start → doc-sync → learning-capture → metrics-record → feature-transition → branch-cleanup → done.

## Internal (Spur core)

- **`docs/00_ADR.md`**: ADR-022 (orchestration is configuration), ADR-028 (expert-spur agent).
- **`packages/app/`**: Application services (AgentService, WorkflowService, etc.).
- **`drizzle/0000_spur_cli_foundation.sql`**: Active schema (CLI domain + history + workflow engine).

## Internal (task)

- **`docs/tasks2/0167_sp-plugin-hands-off-ready-idea-to-feature-flow-post-executio.md`**: This task file.

## External (reference repos)

**vendors/Superpowers**
- **`vendors/Superpowers/skills/brainstorming/SKILL.md`**: Source for 6 brainstorm patterns — hard gate, "nothing is too simple", spec self-review, user review gate, incremental design presentation, scope decomposition check.
- **`vendors/Superpowers/skills/writing-plans/SKILL.md`**: Source for scope decomposition check pattern.
- **`vendors/Superpowers/skills/verification-before-completion/SKILL.md`**: Source for verification iron law (C1).
- **`vendors/Superpowers/skills/using-superpowers/SKILL.md`**: Skill discovery pattern (always-on + auto-activate).

**vendors/gstack**
- **`vendors/gstack/skills/spec/SKILL.md`**: Source for idea-to-spec five-phase flow (inspires A1).
- **`vendors/gstack/skills/autoplan/SKILL.md`**: Source for 6 auto-decision principles (inspires A3).
- **`vendors/gstack/skills/learn/SKILL.md`**: Source for structured learning capture (inspires B2).
- **`vendors/gstack/skills/retro/SKILL.md`**: Source for retrospective pattern (deferred — daily-summary covers daily).
- **`vendors/gstack/skills/ship/SKILL.md`**: Source for verification iron law + metrics persistence (inspires B1 metrics-record).
- **`vendors/gstack/skills/context_save_restore/SKILL.md`**: Source for session checkpoint pattern (inspires B3).

**~/projects/cc-agents/plugins/rd3**
- **`~/projects/cc-agents/plugins/rd3/skills/feature-planning/SKILL.md`**: Source for combined Phase 1+2 entry point with `--plan` flag (inspires A1).
- **`~/projects/cc-agents/plugins/rd3/skills/product-management/SKILL.md`**: Source for PM orchestration patterns. Extracted into `plugins/sp/skills/spur-dev/references/product-planning.md` (elicitation taxonomy + decomposition decision rules). No standalone PM skill created (per `plugins/sp/skills/spur-dev/references/product-planning.md` constraint).
- **`~/projects/cc-agents/plugins/rd3/skills/product-management/references/elicitation.md`**: Source for expertise-adaptive questioning (enriches A2).
- **`~/projects/cc-agents/plugins/rd3/skills/product-management/references/decomposition-strategies.md`**: Source for per-profile decomposition rules (enriches `plugins/sp/skills/spur-dev/references/product-planning.md`).
### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References
## Internal (sp plugin)

**sp Plugin Core**
- **ADR-022**: Orchestration is configuration — `spur workflow` YAML files are the orchestration mechanism, not skills.
- **`plugins/sp/plugin.json`**: Plugin manifest (version 0.2.3 → 0.3.0 after this task).
- **`plugins/README.md`**: Plugin README — command/workflow/skill inventory.
- **`plugins/sp/skills/spur-dev/SKILL.md`**: The thin orchestration spine — dispatches competency skills, owns the lifecycle FSM, CLI-gated section-write contract.
- **`plugins/sp/skills/spur-dev/references/dev-operations.md`**: Authoritative operation reference — 13 existing operations + 3 new (`idea`, `wrap`, `wrapall`).
- **`plugins/sp/skills/spur-dev/references/cross-cutting.md`**: Cross-cutting rules — two-surface `--agent` contract, auto-decision principles, iron laws, pipeline alignment, learning log convention, session checkpoint convention.
- **`plugins/sp/skills/spur-dev/references/product-planning.md`**: PM constraint — no standalone PM skill/command; elicitation taxonomy + decomposition decision rules.
- **`plugins/sp/skills/spur-dev/references/ac-style-guide.md`**: AC conventions — R-numbering, @core/@edge tiers.
- **`plugins/sp/skills/spur-dev/references/execution-workflow.md`**: Task pipeline execution loop (precheck → implement → test → review → verify → record → done).
- **`plugins/sp/skills/spur-dev/references/execution-batch.md`**: Batch execution loop (resolve → topo-sort → per-task pipeline → batch report).
- **`plugins/sp/skills/spur-dev/references/feature-link-helper.md`**: Feature↔task linking helper.
- **`plugins/sp/skills/brainstorm/SKILL.md`**: Current brainstorm skill (3-phase workflow, to be enhanced with 6 Superpowers patterns).
- **`plugins/sp/skills/spec-decomposition/SKILL.md`**: Decomposition competency — turns validated feature into task batch.
- **`plugins/sp/skills/doc-evolve/SKILL.md`**: Document evolution — drift audit, sync check, lesson-append.
- **`plugins/sp/skills/branch-workflow/SKILL.md`**: Branch lifecycle — create, merge, cleanup.
- **`plugins/sp/skills/sys-architecture/SKILL.md`**: Architecture competency — design docs, ADR entries.
- **`plugins/sp/agents/super-coder.md`**: Task pipeline driver agent.
- **`plugins/sp/agents/expert-spur.md`**: Spur CLI corpus work agent.
- **`plugins/sp/tests/skill-structure.test.ts`**: Structural invariants test (R13–R28; R30-R35 added by this task).

**sp Plugin Commands (existing)**
- `dev-brainstorm.md`, `dev-plan.md`, `dev-run.md`, `dev-runall.md`, `dev-refine.md`, `dev-verify.md`, `dev-unit.md`, `dev-dogfood.md`, `dev-handover.md`, `dev-fixall.md`, `dev-gitmsg.md`, `dev-review.md`, `dev-changelog.md`, `dev-parallel.md`

**sp Plugin Commands (new, created by this task)**
- `dev-idea.md` — unified idea-to-feature entry point (wraps `idea-pipeline.yaml`)
- `dev-wrap.md` — single-task post-execution wrap-up (wraps `wrapup-pipeline.yaml`)
- `dev-wrapall.md` — batch post-execution wrap-up (wraps `wrapup-pipeline.yaml` with task list)

**Existing Spur Workflows**
- **`config/workflows/basic.yaml`**: Simple implement → check → fix → done loop.
- **`config/workflows/feature-dev.yaml`**: Umbrella: brainstorm → plan → execute-tasks → feature-verify → done. Delegates task execution to `task-pipeline.yaml`.
- **`config/workflows/feature-lifecycle.yaml`**: Feature FSM: backlog → active → verifying → done; cancelled terminal.
- **`config/workflows/planning-pipeline.yaml`**: Front-half planning: phasing → feature-id → design-gen → design-approval → handoff.
- **`config/workflows/task-lifecycle.yaml`**: Task FSM: backlog → todo → wip → testing → done; cancelled terminal.
- **`config/workflows/task-pipeline.yaml`**: Task execution: precheck → implement → test → review → approve → verify → record → done.

**New Spur Workflows (created by this task)**
- **`.spur/workflows/idea-pipeline.yaml`** (`config/workflows/idea-pipeline.yaml` physical source): Ideation phase: start → discovery → feature-create → ac-generate → feature-check → system-design → decompose → batch-create → handoff.
- **`.spur/workflows/wrapup-pipeline.yaml`** (`config/workflows/wrapup-pipeline.yaml` physical source): Wrap-up phase: start → doc-sync → learning-capture → metrics-record → feature-transition → branch-cleanup → done.

## Internal (Spur core)

- **`docs/00_ADR.md`**: ADR-022 (orchestration is configuration), ADR-028 (expert-spur agent).
- **`packages/app/`**: Application services (AgentService, WorkflowService, etc.).
- **`drizzle/0000_spur_cli_foundation.sql`**: Active schema (CLI domain + history + workflow engine).

## Internal (task)

- **`docs/tasks2/0167_sp-plugin-hands-off-ready-idea-to-feature-flow-post-executio.md`**: This task file.

## External (reference repos)

**vendors/Superpowers**
- **`vendors/Superpowers/skills/brainstorming/SKILL.md`**: Source for 6 brainstorm patterns — hard gate, "nothing is too simple", spec self-review, user review gate, incremental design presentation, scope decomposition check.
- **`vendors/Superpowers/skills/writing-plans/SKILL.md`**: Source for scope decomposition check pattern.
- **`vendors/Superpowers/skills/verification-before-completion/SKILL.md`**: Source for verification iron law (C1).
- **`vendors/Superpowers/skills/using-superpowers/SKILL.md`**: Skill discovery pattern (always-on + auto-activate).

**vendors/gstack**
- **`vendors/gstack/skills/spec/SKILL.md`**: Source for idea-to-spec five-phase flow (inspires A1).
- **`vendors/gstack/skills/autoplan/SKILL.md`**: Source for 6 auto-decision principles (inspires A3).
- **`vendors/gstack/skills/learn/SKILL.md`**: Source for structured learning capture (inspires B2).
- **`vendors/gstack/skills/retro/SKILL.md`**: Source for retrospective pattern (deferred — daily-summary covers daily).
- **`vendors/gstack/skills/ship/SKILL.md`**: Source for verification iron law + metrics persistence (inspires B1 metrics-record).
- **`vendors/gstack/skills/context_save_restore/SKILL.md`**: Source for session checkpoint pattern (inspires B3).

**~/projects/cc-agents/plugins/rd3**
- **`~/projects/cc-agents/plugins/rd3/skills/feature-planning/SKILL.md`**: Source for combined Phase 1+2 entry point with `--plan` flag (inspires A1).
- **`~/projects/cc-agents/plugins/rd3/skills/product-management/SKILL.md`**: Source for PM orchestration patterns. Extracted into `plugins/sp/skills/spur-dev/references/product-planning.md` (elicitation taxonomy + decomposition decision rules). No standalone PM skill created (per `plugins/sp/skills/spur-dev/references/product-planning.md` constraint).
- **`~/projects/cc-agents/plugins/rd3/skills/product-management/references/elicitation.md`**: Source for expertise-adaptive questioning (enriches A2).
- **`~/projects/cc-agents/plugins/rd3/skills/product-management/references/decomposition-strategies.md`**: Source for per-profile decomposition rules (enriches `plugins/sp/skills/spur-dev/references/product-planning.md`).
### History
- 2026-07-02T00:21:17.289Z backlog → todo (system)
- 2026-07-02T00:29:15.058Z todo → wip (system)
- 2026-07-02T00:29:19.410Z wip → testing (system)
- 2026-07-02T00:49:19.134Z testing → done (system)
