---
name: product-planning
description: Product-management judgment for the sp planning path: intake, prioritization, strategy profiles, PRD-shaped output, and handoff rules without adding a PM command surface.
see_also:
  - spur-dev
  - planning-workflow
  - decomposition
  - spur-cli
  - doc-evolve
---

# Product Planning Guidance

This reference captures product-management judgment for the Spur planning path without adding old
feature-tree, PRD command, or PM-agent surfaces. `sp:spur-dev` remains the planning orchestrator.
Product planning is a lens applied during intake, feature authoring, prioritization, decomposition,
and doc handoff; deterministic writes still go through `spur feature`, `spur task`,
`spur workflow`, and `sp:doc-evolve`.

## Routing Rule

Use this reference when the request is PM-shaped:

- prioritizing a backlog or roadmap,
- turning a vague idea into a feature with measurable outcomes,
- deciding whether to create a feature, task, or doc update,
- choosing a decomposition strategy (`simplify`, `mvp`, `standard`, `mature`),
- producing PRD-shaped thinking without creating a PRD command family.

Do not create a standalone `sp:product-management` skill, `sp:super-pm` agent, or `/sp:prd-*`
command for this workflow unless a later task proves a stable, distinct routing value.

## Intake Questions

Ask only for missing information. A senior, specific request can proceed directly to feature
creation.

| Dimension | Question |
| --- | --- |
| Outcome | What user or business result changes if this ships? |
| User | Which persona, workflow, or operator role benefits first? |
| Scope | What is explicitly in and out for this iteration? |
| Success | Which observable metric, behavior, or acceptance signal proves it worked? |
| Constraints | What timeline, risk, compliance, migration, or compatibility limits shape the plan? |
| Opportunity cost | What current or planned work should lose priority if this wins? |

Expertise calibration:

- **Sparse idea:** ask foundational outcome/scope/success questions.
- **Problem + rough scope:** ask boundary, metric, and dependency questions.
- **Problem + personas + metrics:** ask tradeoff and opportunity-cost questions; do not over-elicit.

## Prioritization

Use prioritization to decide ordering, not to replace operator judgment.

### RICE

Use RICE when comparing multiple candidates with enough estimates to rank them.

```
score = (reach * impact * confidence) / effort
```

| Field | Guidance |
| --- | --- |
| Reach | A count over a defined period, e.g. users/quarter or runs/month. |
| Impact | `3` massive, `2` high, `1` medium, `0.5` low, `0.25` minimal. |
| Confidence | `1.0` high, `0.8` medium, `0.5` low. Penalize guesses. |
| Effort | Person-months or equivalent relative effort; keep the unit consistent. |

Flag outliers: if one score is more than 10x the median, review the inputs before using the rank.

### MoSCoW

Use MoSCoW when shaping a release boundary.

| Bucket | Meaning |
| --- | --- |
| Must | Release fails without it; critical path or blocking dependency. |
| Should | Important and high-value, but can slip one release. |
| Could | Useful if capacity remains. |
| Won't | Explicitly out of scope for this release; document for future. |

The Must set should be sufficient to satisfy the release goal. If it is not, the release goal or the
bucket assignment is wrong.

## Strategy Profiles

Strategy profiles tune planning ceremony and decomposition scope. They are judgment aids, not new
CLI flags unless a command explicitly supports them.

| Profile | Use when | Scope | Tests/docs expectation |
| --- | --- | --- | --- |
| `simplify` | Low-risk request, operator wants speed, or a tiny workflow change. | Minimum useful deliverable; skip non-blocking edge cases. | Smoke/manual evidence and concise task prose. |
| `mvp` | Need to validate demand or unblock learning quickly. | Core happy path; defer nice-to-haves. | Basic automated happy-path checks where cheap. |
| `standard` | Normal validated work. | Balanced core + known edge cases. | Unit/integration coverage and normal docs. |
| `mature` | Production-critical, regulated, security-sensitive, or high-reliability work. | Complete path including migration, failure modes, observability, and rollback. | Unit + integration + e2e/perf/security evidence as relevant. |

Auto-selection heuristics:

- Sparse request + explicit speed/minimal ceremony -> `simplify`.
- Uncertain demand or missing success metric -> `mvp`.
- Clear problem, scope, and acceptance signals -> `standard`.
- Compliance, money movement, data loss, auth, migration, or reliability keywords -> `mature`.

## Feature, Task, Or Doc

Choose the smallest durable artifact that preserves traceability.

| Need | Artifact |
| --- | --- |
| New user-facing capability, roadmap item, or acceptance criteria surface | `spur feature create` |
| Concrete implementation work with a bounded code change | `spur task create` or `spur task batch-create` |
| Existing canonical docs drift or a PRD-style decision record | `sp:doc-evolve` |
| Repeatable, stable multi-step PM process | `spur workflow` YAML, only after the steps stabilize |

Default to one feature and one task until the decomposition rubric proves a split. A PRD-shaped
document is useful for stakeholder alignment, scope negotiation, or cross-team handoff; it is not a
reason to add `/sp:prd-doc`.

## PRD-Shaped Output

When the operator asks for a PRD, product brief, or requirements doc, produce the needed shape in the
current planning artifact or route to `sp:doc-evolve` for canonical docs. Use the template size that
matches the decision:

| Shape | Sections | Use when |
| --- | --- | --- |
| Brief | Problem, users, success, scope, next decision | Exploration or a one-week spike. |
| One-page PRD | Problem, solution, scope, success metrics | Simple feature, one team, two to four weeks. |
| Standard PRD | Problem, goals, users, scope in/out, AC, metrics, risks, rollout, open questions | Complex feature, multiple stakeholders, or six-plus weeks. |

Always include an Out of Scope section when the output is PRD-shaped. That is the part that prevents
scope creep.

## Handoff Rules

- Feature writes: use `spur feature create`, `spur feature update`, and direct feature-body edits
  followed by `spur feature check`.
- Task writes: use `spur task create`, `spur task batch-create`, or
  `spur task update --section --from-file`.
- Documentation synchronization: invoke `sp:doc-evolve` and follow the constitution.
- Repeatable orchestration: author `spur workflow` YAML only when the process has become mechanical
  enough to validate and rerun.

Rejected surfaces for now: `sp:super-pm`, `/sp:prd-run`, `/sp:prd-doc`, `/sp:prd-adjust`,
`/sp:prd-init`, and a standalone `sp:product-management` skill.
