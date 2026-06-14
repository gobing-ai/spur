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

`apps/cli/schemas/task-batch.schema.json` defines the JSON shape. Key fields per task:

| Field | Required | Notes |
|-------|----------|-------|
| `name` | yes | Task title; used in slug generation. |
| `template` | no | Template variant (`feature-impl`, `issue`, `review`, `meta`); defaults to `default`. |
| `feature_id` | no | Links the task to a feature — the single traceability edge. |
| `parent_wbs` | no | For sub-tasks; references the parent's WBS. |
| `priority` | no | `P0`–`P3`; align with feature priority. |
| `dependencies` | no | WBS refs of tasks this one depends on. |
| `sections` | no | Pre-filled section content per the template variant's section matrix. |

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
- **Ordering:** tasks with no dependencies come first. Use `dependencies` for soft ordering;
  the pipeline respects the dependency graph.
- **Parallelism:** mark independent tasks with the same priority — the pipeline can fan out.
- **Testing:** every `feature-impl` task should produce tests. Do not create separate "write
  tests" tasks — testing is part of implementation.
- **Review:** complex or cross-cutting tasks get a `review` companion task (template
  `review`). Simple tasks skip it — the pipeline's review step suffices.

## Batch JSON example

```json
{
  "tasks": [
    {
      "name": "Implement task creation endpoint",
      "template": "feature-impl",
      "feature_id": "A1",
      "priority": "P0",
      "dependencies": [],
      "sections": {
        "Background": "Implements: R1 — User can create a task with required fields"
      }
    },
    {
      "name": "Implement task listing endpoint",
      "template": "feature-impl",
      "feature_id": "A1",
      "priority": "P1",
      "dependencies": ["0042"],
      "sections": {
        "Background": "Implements: R2 — User can list tasks filtered by status"
      }
    }
  ]
}
```

## Common schema violations

| Violation | Fix |
|-----------|-----|
| `name` is empty or missing | Every task must have a name. |
| `template` value not in the enum | Use one of: `default`, `feature-impl`, `issue`, `review`, `meta`. |
| `feature_id` references a non-existent feature | Run `spur feature list --json` to confirm the ID exists. |
| `priority` not `P0`–`P3` | Use the canonical priority scale. |
| Section content for a section the variant's matrix does not allow | Check the variant's matrix; remove the extra section. |
| WBS range collision | A prior batch or manual create already claimed the WBS range — use a different base or offset. |
