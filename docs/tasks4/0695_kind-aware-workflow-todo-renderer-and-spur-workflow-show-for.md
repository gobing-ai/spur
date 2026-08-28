---
schema_version: 1
name: "Kind-aware workflow todo renderer and spur workflow show --format/--json"
status: todo
template: feature-impl
created_at: 2026-08-27T23:57:38.268Z
updated_at: "2026-08-27T23:57:38.271Z"
feature_id: D7
priority: P2
tags: ["workflow", "cli-surface"]
---

## 0695. Kind-aware workflow todo renderer and spur workflow show --format/--json

### Background

`spur workflow show` renders exactly one projection today — a mermaid FSM diagram, hardcoded with no options at all (apps/cli/src/commands/workflow.ts:800). Separately, `renderRunPlan` (packages/app/src/workflow/step-reporter.ts:171) emits a one-line `plan: a -> b -> c` at run start, built from declaration order. Neither serves the actual consumer: plugins/sp/skills/spur-dev/references/inline-pipeline-driver.md line 34 instructs the inline driver to read task-pipeline.yaml and hand-build a two-layer todo list, which is a descriptive procedure doing work a deterministic renderer should do.

This task adds the todo projection and the option surface that exposes it. It covers feature D7 scenarios R1 (default output unchanged), R2 (transition-flow topological checklist), R3 (state-machine declared inventory with markers), R4 (--json machine shape), R5 (one shared step-ordering implementation), R7 (unknown --format value), and R8 (unresolvable or invalid definition).

The surface change crosses the ADR-051 public-CLI consent gate; consent was given at the D7 idea-evaluation gate, which also rejected a boolean `--todo` flag (does not scale past a third projection) and a separate `spur workflow todo` verb (duplicates show's file resolution, schema validation, and error paths for a different output encoding). Caching the rendered todo was explicitly rejected as speculative: the parse is single-digit milliseconds and the render is pure.

### Requirements

R1. Add a kind-aware todo renderer beside `renderRunPlan` in `packages/app/src/workflow/`. A `transition-flow` definition renders every node id exactly once as an unchecked checkbox in a topological order of its edges starting at `initialNode`, marking `terminalNodes` and labelling `gate`/`decision`/`parallel` node types. A `state-machine` definition renders every state id exactly once in declaration order, states in the output that the list is a declared inventory rather than a predicted execution path, and marks the `initialState`, terminal states, states carrying `pause: true`, transitions whose target precedes their source (loop-backs), and states reachable only through a guarded transition (conditional).

R2. Keep one step-ordering implementation. `renderRunPlan` and the todo renderer share it, so a change to the ordering rule is reflected by both the `spur workflow run` plan preview and the new projection; no second step-ordering implementation exists under `apps/cli`.

R3. Add `--format <mermaid|todo>` to `spur workflow show`, defaulting to `mermaid`. With the option omitted, stdout is byte-identical to the pre-change output. Document the resulting `show` option surface in `docs/04_DESIGN.md` in the same commit as the code (constitution T3) and record the ADR-051 public-surface consent.

R4. Add `--json` to `spur workflow show`, emitting the machine shape of the selected format: the workflow name, its kind, and an ordered array of step objects each carrying its id and its initial/terminal/pause/loop-back/conditional markers. `--json` with no `--format` returns the mermaid projection in the same envelope.

R5. Fail predictably. An unrecognised `--format` value exits non-zero with stderr naming both accepted values. A path that does not resolve, or a file that fails schema validation, exits 1 with the same message the mermaid path emits today, for every format.

### Acceptance Criteria

<!-- Copy or derive real scenarios from the linked feature. Do not leave placeholder AC here. -->

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

### Design

<!-- Chosen implementation approach, key tradeoffs, invariants, and impacted surfaces. -->

### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
