---
name: decomposition
description: Task decomposition conventions — the task-batch.schema.json contract, template-variant selection, scenario-to-task mapping.
see_also:
  - spur-dev
---

# Decomposition

Turning a feature's acceptance criteria into a validated task batch. The LLM produces JSON;
the CLI validates it against `task-batch.schema.json`; nothing is written until the gate
passes.

## The batch schema

`apps/cli/schemas/task-batch.schema.json` (runtime SSOT: the Zod `taskBatchSchema` in
`@gobing-ai/spur-domain`) defines the JSON shape. **The top level is a JSON ARRAY of task items —
NOT an object with a `tasks` key.** Each item is `.strict()`: any field not in the table below is
rejected, and a single rejected item fails the whole batch (all-or-nothing).

| Field | Required | Notes |
|-------|----------|-------|
| `name` | yes | Task title; used in slug generation. |
| `template` | no | Template variant (`feature-impl`, `issue`, `review`, `meta`); defaults to `default`. |
| `feature_id` | no | Links the task to a feature — the single traceability edge. |
| `parent_wbs` | no | For sub-tasks; references the parent's WBS (quoted 4-digit string, e.g. `"0042"`). |
| `priority` | no | `P0`–`P3`; align with feature priority. |
| `tags` | no | String tags. |
| `background` | no | Pre-filled `## Background` body (the scenario→task mapping note goes here). |
| `requirements` | no | Pre-filled `## Requirements` body. |

> There is **no** generic `sections` field and **no** `dependencies` field in the batch item — the
> Zod schema is strict and rejects both. Use `background`/`requirements` for content, and record
> ordering in `background` prose (the WBS-level `dependencies` frontmatter is set later, not at batch
> create).

## Template-variant selection

Choose the variant that matches the task's purpose:

| Variant | When to use | Sections created |
|---------|-------------|------------------|
| `feature-impl` | Implementation work for a feature | Background, Acceptance Criteria, Plan, Solution, Testing, Review, References, History |
| `issue` | Bug reports | Background (repro), Root Cause, Solution, Testing, History |
| `review` | Review-summary tasks | Background, Review (P1–P4 table), History |
| `meta` | Process/docs/chore | Background, Plan, History |
| `default` | General-purpose | Background, Acceptance Criteria, Plan, Solution, Testing, Review, References, History |

`feature-impl` is the workhorse: it pre-seeds the Background from the linked feature's
`## Goal` when `--feature <id>` is passed.

## Scenario-to-task mapping

For each core scenario in the feature's AC:

1. **Design one task** that implements the scenario end-to-end. This is the common case.
2. **Split into multiple tasks** when the scenario spans subsystems (e.g., auth service +
   UI). Each task names the subsystem it owns.
3. **Record the mapping** in each task's `## Background`: `Implements: R3 — Registered user
   can log in with email and password`.

Edge-case scenarios may map to tasks or be deferred. Record deferrals explicitly:
`Deferred: R7 — Edge case not in this iteration`.

## Decomposition heuristics

- **Granularity:** one task = what a single agent can complete in one session. Split tasks
  that describe two independent subsystems.
- **Ordering:** tasks with no dependencies come first. Note ordering in each task's `background`
  prose at batch time; set the WBS-level `dependencies` frontmatter after creation if needed.
- **Parallelism:** mark independent tasks with the same priority — the pipeline can fan out.
- **Testing:** every `feature-impl` task should produce tests. Do not create separate "write
  tests" tasks — testing is part of implementation.
- **Review:** complex or cross-cutting tasks get a `review` companion task (template
  `review`). Simple tasks skip it — the pipeline's review step suffices.

## Batch JSON example

The payload is a top-level JSON **array** (no `tasks` wrapper):

```json
[
  {
    "name": "Implement task creation endpoint",
    "template": "feature-impl",
    "feature_id": "A1",
    "priority": "P0",
    "background": "Implements: R1 — User can create a task with required fields"
  },
  {
    "name": "Implement task listing endpoint",
    "template": "feature-impl",
    "feature_id": "A1",
    "priority": "P1",
    "background": "Implements: R2 — User can list tasks filtered by status (runs after the create endpoint)"
  }
]
```

## Common schema violations

| Violation | Fix |
|-----------|-----|
| `name` is empty or missing | Every task must have a name. |
| `template` value not in the enum | Use one of: `default`, `feature-impl`, `issue`, `review`, `meta`. |
| `feature_id` references a non-existent feature | Run `spur feature list --json` to confirm the ID exists. |
| `priority` not `P0`–`P3` | Use the canonical priority scale. |
| Unknown field (e.g. `sections`, `dependencies`, `tasks` wrapper) | The item schema is strict — use only the documented fields; the payload is a bare array. |
| `parent_wbs` as a number (`0042`) | Quote it: `"0042"` — leading-zero numerics fail the 4-digit string schema. |
