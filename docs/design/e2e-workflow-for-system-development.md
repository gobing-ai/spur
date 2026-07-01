# Design — End-to-end workflow for system development

Owning task: [`0167`](../tasks2/0167_sp-plugin-hands-off-ready-idea-to-feature-flow-post-executio.md).
Surface index row: [`04_DESIGN.md §0`](../04_DESIGN.md). Feature: `I` (sp plugin hands-off ready).

## Problem

The sp plugin's development workflow is fragmented: idea-to-feature requires multiple manual commands, there's no post-execution wrap-up step, and the system-design step (where critical architectural decisions are made) is either missing or conflated with post-implementation documentation. The operator has no single entry point that takes a vague idea through to a task batch ready for execution, and no automatic step that syncs docs and captures learnings after execution completes.

## Decision

A pipeline-based architecture where each pipeline owns one phase of the development lifecycle. Pipelines are `spur workflow` YAML files (ADR-022: orchestration is configuration), not skills. The system-design step is mandatory by default with auto-detection, and is fundamentally distinct from post-execution doc-sync.

**Why pipelines, not skills.** ADR-022: orchestration is configuration. Workflow YAMLs orchestrate the flow; existing skills (`brainstorm`, `spec-decomposition`, `sys-architecture`, `doc-evolve`) are invoked by `agent.run` steps. No orchestration logic in skill files. This means zero new skills — only 2 new workflow YAMLs + 3 thin command wrappers + reference updates.

**Why mandatory-by-default system-design.** "Nothing is too simple" (R2 pattern 2) — every idea gets a design, even if short. Architectural decisions (module boundaries, data flow, ADR entries) must be recorded before decomposition, not after implementation. The `--skip-design` flag exists for trivial features but is opt-in, not the default.

## Architecture principles

1. **Orchestration is configuration (ADR-022).** Pipelines are `spur workflow` YAML files. Skills are invoked by `agent.run` steps. No orchestration logic in skill files.
2. **Every write is CLI-gated.** Task/feature corpus mutations go through `spur` CLI verbs, never direct file writes. `.spur/memory/` is the exception — it's a working scratchpad, not validated corpus.
3. **HITL gates at decision points.** `hitl.confirm` gates at feature-check, system-design approval, batch-create, and branch-cleanup. `--auto` auto-resolves gates per auto-decision principles, but taste decisions still surface.
4. **Lifecycle guard respect.** Pipelines transition tasks/features through their existing lifecycle guards via `spur` CLI verbs, not around them. No new `*-lifecycle.yaml` workflows.
5. **No nesting.** Each pipeline owns one lifecycle phase. Pipelines do not contain another pipeline's state machine. Delegation is via `agent.run` + `spur workflow run`.
6. **Doc-sync boundary.** Design-step doc creation (ADR entries, architecture decisions) happens BEFORE code. Wrapup doc-sync (drift audit, lesson append) happens AFTER code. These are fundamentally different and must not be conflated.

## Lifecycle model

### Feature lifecycle (`feature-lifecycle.yaml`)

```
backlog → active → verifying → done
                                ↗
              cancelled (terminal)
```

### Task lifecycle (`task-lifecycle.yaml`)

```
backlog → todo → wip → testing → done
                                  ↗
              cancelled (terminal)
```

Pipelines respect these FSMs via `spur task update` / `spur feature update`. The `wrapup-pipeline.yaml` enforces the `verifying → done` guard with `spur feature check --strict` when `--feature` is used.

## Pipeline inventory

Seven workflows, each owning one lifecycle phase:

| Pipeline | Phase | Entry Point | Terminal States | Status |
|---|---|---|---|---|
| `idea-pipeline.yaml` | Ideation: idea → feature + AC + task batch | `dev-idea` | handoff, cancelled | NEW (0167) |
| `planning-pipeline.yaml` | Design: feature → design doc | `dev-plan` | handoff, cancelled | EXISTING |
| `task-pipeline.yaml` | Execution: single task → done | `dev-run` | done, failed | EXISTING |
| `wrapup-pipeline.yaml` | Wrap-up: done → docs synced + learnings | `dev-wrap` / `dev-wrapall` | done, skipped | NEW (0167) |
| `feature-dev.yaml` | Umbrella: idea → done (full loop) | `dev-runall --feature` | done, failed | EXISTING |
| `feature-lifecycle.yaml` | Feature FSM: backlog → active → verifying → done | `spur feature update` | done, cancelled | EXISTING |
| `task-lifecycle.yaml` | Task FSM: backlog → todo → wip → testing → done | `spur task update` | done, cancelled | EXISTING |

**Phase ownership:**
- `idea-pipeline.yaml` — Ideation: from vague idea to feature + AC + task batch. Stops at handoff.
- `planning-pipeline.yaml` — Design: from known slug to design satellite doc. Stops at handoff.
- `task-pipeline.yaml` — Execution: single task from precheck to done.
- `wrapup-pipeline.yaml` — Wrap-up: from done tasks to docs synced + learnings captured.
- `feature-dev.yaml` — Umbrella: full loop from idea to done. Delegates task execution to `task-pipeline.yaml`.

**Overlap management:**
- `idea-pipeline.yaml` and `feature-dev.yaml` share brainstorm+plan steps. Intentional: `idea-pipeline` stops at handoff; `feature-dev` continues to execution. Duplication is in YAML calls, not logic.
- `idea-pipeline.yaml` and `planning-pipeline.yaml` both produce design docs. Different entry conditions: `idea-pipeline` starts from a vague idea (discovery focus); `planning-pipeline` starts from a known slug (design-doc focus). The `idea-pipeline` system-design step produces ADR entries + architecture decisions; the `planning-pipeline` design-gen step produces a design satellite doc.
- Rule: each pipeline is a self-contained phase boundary with distinct entry/exit points.

## End-to-end flow

```
Operator: "I have an idea"
    ↓
dev-idea → idea-pipeline.yaml
    ↓
discovery (sp:brainstorm — outputs needs_design signal)
    ↓
feature-create (spur feature create)
    ↓
ac-generate (AC per ac-style-guide.md)
    ↓
feature-check (HITL: spur feature check --strict)
    ↓
system-design (sp:sys-architecture → ADR entries, architecture decisions)
    ↓                    ↑ auto-detection (R16): needs_design signal from brainstorm
design-approval (HITL)
    ↓
decompose (sp:spec-decomposition, informed by design doc)
    ↓
batch-create (HITL: spur task batch-create)
    ↓
handoff → operator runs dev-run / dev-runall
    ↓
task-pipeline.yaml (per task: precheck → implement → test → review → verify → record → done)
    ↓
dev-wrap / dev-wrapall → wrapup-pipeline.yaml
    ↓
doc-sync (sp:doc-evolve — post-implementation drift)
    ↓
learning-capture (write to .spur/memory/learnings.md)
    ↓
metrics-record (task durations, verdicts, gate decisions)
    ↓
feature-transition (if --feature: spur feature update <id> done)
    ↓
branch-cleanup (if --merge: sp:branch-workflow)
    ↓
done
```

## Design step auto-detection

The `idea-pipeline.yaml` system-design step is mandatory by default ("nothing is too simple", R2 pattern 2). Auto-detection (R16) determines whether the step runs when neither `--design` nor `--skip-design` is explicitly set.

### Signal source

The brainstorm skill's scope decomposition check (R2 pattern 6) evaluates the idea during the discovery phase and outputs a `needs_design` boolean signal. This signal is passed as a workflow var to `idea-pipeline.yaml`.

### Criteria

The criteria mirror the seam heuristic from [`dev-plan-design-doc-generation.md`](dev-plan-design-doc-generation.md):

**Needs design (`needs_design=true`):**
- Multi-subsystem work (multiple distinct user-facing surfaces, multiple data models, multiple integration points)
- Schema changes (DB table/migration, Zod config key, DTO/contract shape)
- New module/package/service (`apps/*`, `packages/*`)
- New transport/boundary (oRPC seam, auth boundary, job-queue/EventBus topic)
- New dependency
- Cross-cutting convention change

**Can skip (`needs_design=false`):**
- Single-module work
- Bug fixes
- Docs/chores
- Boundary-preserving refactors
- Follows existing pattern with no architectural impact

### Flag truth table

| Flags | `needs_design` signal | System-design step |
|---|---|---|
| `--design` | (ignored) | Runs (forced on) |
| `--skip-design` | (ignored) | Skipped (forced off) |
| neither | `true` (multi-subsystem/schema/transport/dependency) | Runs |
| neither | `false` (single-module/bug-fix/pattern-following) | Skipped |

**Ties lean toward design** (R2 pattern 2: "nothing is too simple"). The operator can always override with `--skip-design`.

### Relationship to `dev-plan --design/--auto`

The existing `dev-plan --design/--auto` pattern controls whether the `planning-pipeline.yaml` design-gen step produces a design satellite doc. The new `dev-idea --design/--skip-design` pattern controls whether the `idea-pipeline.yaml` system-design step runs `sp:sys-architecture`. These are related but distinct:

| Aspect | `dev-plan --design/--auto` | `dev-idea --design/--skip-design` |
|---|---|---|
| Pipeline | `planning-pipeline.yaml` | `idea-pipeline.yaml` |
| Step | design-gen (satellite doc) | system-design (ADR + architecture) |
| Decision | Seam heuristic (agent decides) | Scope decomposition check (brainstorm outputs signal) |
| Default | Skip (no satellite) | Run (nothing is too simple) |
| Force on | `--design` | `--design` |
| Force off | (no flag — skip is default) | `--skip-design` |

Both patterns use the same underlying criteria (seam heuristic) but apply them at different points in the lifecycle with different defaults.

## HITL gate model

### Gate locations

| Gate | Pipeline | Purpose | Auto-resolvable? |
|---|---|---|---|
| feature-check | idea-pipeline | Validate feature + AC format | Yes (schema-valid → auto-approve) |
| design-approval | idea-pipeline | Review architectural decisions before decomposition | No (taste decision) |
| batch-create | idea-pipeline | Confirm task batch before creation | Yes (schema-valid → auto-approve) |
| branch-cleanup | wrapup-pipeline | Confirm branch merge/delete (irreversible) | No (irreversible) |

### Auto-decision principles

With `--auto` (or `profile=auto` in workflow vars), gates auto-resolve per these principles:

1. Schema-valid → auto-approve
2. Gate-passed → auto-continue
3. Tests-green → auto-continue
4. Verdict-PASS → auto-continue
5. Taste-decision → surface to human (even with `--auto`)
6. Error → stop

`--auto` is not `--yes-to-everything` — taste decisions (design-approval, branch-cleanup) still surface even in auto mode.

## Doc-sync boundary

Design-step doc creation and wrapup doc-sync are fundamentally different operations that must not be conflated:

| Aspect | System-design step (idea-pipeline) | doc-sync step (wrapup-pipeline) |
|---|---|---|
| When | Before code, after feature-check | After code, after task completion |
| What | Creates initial design docs | Updates docs to match implementation |
| Writes to | `docs/00_ADR.md` (ADR entries), `docs/03_ARCHITECTURE.md` (decisions/rationale) | `docs/` drift audit, lesson-append to constitution |
| Skill | `sp:sys-architecture` | `sp:doc-evolve` |
| Purpose | "Write the high-level plan before code" | "Update docs to match what was built" |

Conflating these is a correctness risk: design decisions must be recorded before decomposition (so tasks align with module boundaries), not after implementation (when it's too late to influence task structure).

## Cross-session memory

### Learning log (`.spur/memory/learnings.md`)

Simple markdown, not JSON. Written by `wrapup-pipeline.yaml` learning-capture step. Not CLI-gated — working scratchpad, not validated corpus. High-value learnings are promoted to the constitution via `doc-evolve`'s lesson-append.

### Session checkpoints (`.spur/memory/sessions/`)

Markdown files with YAML frontmatter (session_id, task_wbs, phase, last_gate, timestamp). Written after every gate/phase transition. Read on `dev-run` resume.

## Command surface

| Command | Pipeline | Purpose |
|---|---|---|
| `/sp:dev-idea` | `idea-pipeline.yaml` | Unified entry: vague idea → feature + AC + task batch |
| `/sp:dev-plan` | `planning-pipeline.yaml` | Design doc generation from known slug |
| `/sp:dev-run` | `task-pipeline.yaml` | Single task execution |
| `/sp:dev-runall` | `task-pipeline.yaml` (batch) | Batch task execution |
| `/sp:dev-wrap` | `wrapup-pipeline.yaml` | Single-task post-execution wrap-up |
| `/sp:dev-wrapall` | `wrapup-pipeline.yaml` | Batch post-execution wrap-up |

All commands support `--auto` (skip HITL gates per auto-decision principles). `dev-idea` supports `--design`/`--skip-design` (override auto-detection). `dev-wrap`/`dev-wrapall` support `--since`/`--feature`/`--status`/`--merge` options.

## Workflow YAML schema

All workflows use:
- **Schema**: `@gobing-ai/spur/schemas/state-machine-workflow.schema.json`
- **Kind**: `state-machine`
- **LLM steps**: `agent.run` dispatching skills
- **Gates**: `hitl.confirm` (auto-resolved when `profile=auto`)
- **Iteration bound**: 20 (default)
- **Vars**: passed as JSON via `--vars '{"key":"value"}'`

New workflows (`idea-pipeline.yaml`, `wrapup-pipeline.yaml`) follow the same pattern as `planning-pipeline.yaml`, adding `skip_design` and `needs_design` vars for the auto-detection system.
