---
kind: plan
title: Task-level deprecated status — frozen-but-retained task lifecycle state
status: draft
created_at: 2026-10-13
updated_at: 2026-10-13
related: [F42, ADR-136, ADR-135, ADR-022, DD-01, DD-13]
tags: [brainstorm, deprecated, lifecycle, corpus]
needs_design: true
run_id: plan-task-deprecated-d24403a2
---

# Task-level deprecated status

## 1. Objective and outcome

F42 gave features a canonical, non-terminal `deprecated` status (ADR-136) and every
status-aware consumer a frozen-vs-retained treatment. It explicitly left
**task-level `deprecated`** out of scope. This brainstorm designs that follow-up: a task can be
marked retained-but-frozen, so agents, gates and routing stop attaching work to it without
deleting the record or misreporting its outcome.

Operator ask of record:
`.spur/run/plan-task-deprecated-d24403a2-idea-input.md`.

## 2. Approaches

| Approach | Shape | Cost | Verdict |
| --- | --- | --- | --- |
| **A. Mirror F42 one level down** | `deprecated` joins `TASK_STATUSES` as a non-terminal, retained state; the task-lifecycle graph admits it from every non-terminal state plus `done`; the only exits are `todo` (un-deprecate) and `cancelled` (removed); every status-aware consumer gets an explicit frozen treatment | ~4 slices, domain → graph → guards → surfaces | **Chosen** |
| B. Overload an existing status | Keep `cancelled` for "retained but unwanted", document the distinction in prose | near zero | Rejected — `cancelled` is terminal and claims abandonment; the record then cannot be un-frozen from the CLI, and derivation cannot tell "removed" from "parked" |
| C. Terminal `deprecated` | New status with no exit edges | small | Rejected — ADR-136 already rejected this at the feature layer: it duplicates `cancelled` and loses un-deprecation |
| D. Orthogonal `frozen: true` flag | Second axis beside `status` | small to add, large to consume | Rejected — every consumer would have to combine two axes; a status is already a single closed vocabulary (DD-01) |

## 3. Recommendation

Take **A**. It is the only option that keeps one status vocabulary, preserves the record, and
makes freeze intent machine-readable for guards — and it reuses a design that already survived
review at the feature layer, so the remaining decisions are about task-specific consumers rather
than about semantics.

## 4. Design Summary

**Semantics.** `deprecated` means *retained, frozen, removable*: the task file stays readable and
countable, nothing new may attach to it, and the only expected change is its eventual removal or
an explicit un-deprecation. It is deliberately **not** terminal, because a terminal state cannot be
left — `cancelled` already occupies that role.

**Graph.** Enter from `backlog`, `todo`, `wip`, `testing`, `blocked` and `done` (a completed task
can be deprecated when the capability it implemented is withdrawn). Exit only to `todo`
(un-deprecate, mandatory History entry) and `cancelled` (removed). Any other target is undeclared
and refused by the graph, exactly as ADR-135 requires.

**What "frozen" changes for a task, one surface at a time.** A task is not a container (unlike a
feature), so the freeze has two distinct meanings and the design must not conflate them:

1. **Nothing new attaches *to* it** — a dependency edge (`depends_on`) pointing at a deprecated
   task is refused at create/update/batch-create, before any file is written. This is the direct
   analogue of F42's parent-feature link refusal.
2. **It never starts or advances** — pipeline admission refuses a deprecated task, and the
   forward path has no entry for it, so `advance` refuses with the un-deprecate hint.
3. **It stops holding other work back** — derivation must read a deprecated task as *terminal* for
   the "all linked tasks are done/cancelled" rules (feature sync, feature verification), or a
   frozen task would block its feature forever with no way out but deletion.
4. **Its dependents are surfaced, not silently stranded** — a `task check` finding names live
   dependents of a deprecated task and advises re-pointing or un-deprecating. Existing live
   dependents are warned about, never rewritten: the freeze is prospective.
5. **Edits are discouraged, not refused** — a section write on a deprecated task succeeds with a
   freeze warning in its result, mirroring `FeatureService.updateSection`.

**Blast radius.** Domain vocabulary + contracts (enum), the task-lifecycle FSM and its regenerated
bundle copy, `TaskService` (dependency guard, section warning), `task check` findings, CLI
forward-path/advance, derivation (`feature sync`), routing (`next-router`/`dev-run` refusal),
Board Tasks module (icon, filter, actions), docs/skills/ADR, init-template parity.

**Reversibility.** High for the vocabulary (additive enum member); medium for the guards (each is
one branch plus a finding code); the lifecycle YAML is per-project overridable, so an existing
project can decline the new edges — which is also the migration caveat: project-layer
`task-lifecycle.yaml` overrides must be re-synced to gain them (ADR-136's stated consequence).

**Open questions the system-design step must settle.** (a) the exact refusal wording and whether a
deprecated task may still be *depended on by* an already-recorded edge without a write; (b) whether
`migrate-anchors`/`record` hops stay permitted (they edit the task file, not its status); (c)
whether the Board filter is a status chip or a separate toggle.

## 5. Next Steps

1. `feature-create` → a feature under `F` (Planning), sibling scope to F42.
2. `ac-generate` → scenarios R1–R6 mirroring F42's, with the task-specific freeze semantics above.
3. `feature-check` gate, then `system-design` (needs_design = true) resolving the three open
   questions into the feature satellite `docs/design/task-deprecated-status.md`.
4. `decompose` → four slices: vocabulary + graph, freeze guards, derivation/routing + Board,
   documentation and skill parity.
