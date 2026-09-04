# task-pipeline proportional migration plan (task 0759 WIP)

**Status:** WIP — gated on 0758 pilot completion. The route table contract proven
on wrapup-pipeline and task-lifecycle is reused unchanged. No code change to
task-pipeline.yaml until the pilot clears the bar.

## Prerequisites (all satisfied at the time of this commit)

- **0751** — proof primitives fail-closed: ✅ done in this branch.
- **0752** — resume-to-definition binding: ✅ done in this branch.
- **0753** — workflow-seam repairs (command.gate timeout, run-id validation, nested
  composition, dry-probe escalation): ✅ done in this branch.
- **0757** — re-measure gate recorded Option A continues (wrapup-pipeline 40 real
  terminal runs, task-lifecycle 27, both pilots clear ≥5): ✅ done in this branch.
- **0758** — route table proven on the two pilots with ≥5 real terminal runs each
  and ≥80% run-scoped cost row coverage: **WIP** in this branch. The scaffold is in
  `config/proportional-route-table.ts`; the pilot runs accumulate in a follow-up
  session.

## Migration contract (frozen; no changes expected from the pilot)

1. **Same closed route table.** `config/proportional-route-table.ts` is the data
   structure. task-pipeline adopts it unchanged. The fast-path predicates are
   per-pilot: wrapup-pipeline and task-lifecycle get theirs from the 0758 pilot;
   task-pipeline gets its predicates after the pilot proves the shape.

2. **Same safety floor.** `safetyFloorHolds()` is the gate. proofBinding
   `current`, reviewerIndependent `true`, runIdConfined `true` — all three must
   hold on every route.

3. **Same evidence-writing interface.** The run-bound evidence writer (R4/R5) is
   implemented once in the 0758 follow-up; task-pipeline uses the same writer.
   No per-workflow duplication.

4. **Same revertability property (R7).** task-pipeline gets a per-workflow
   `proportional_routing: enabled|disabled` switch (default: disabled until the
   migration lands). Rollback is one config change, not an engine change.

## What task-pipeline.yaml changes when the migration lands

A single block at the top of `config/workflows/task-pipeline.yaml`:

```yaml
proportional_routing:
  enabled: true
  route_table: ../proportional-route-table.ts#ROUTE_TABLE
  safety_floor: ../proportional-route-table.ts#safetyFloorHolds
  evidence_writer: ../proportional-route-evidence-writer.ts  # lands in 0758 follow-up
```

No change to states, transitions, actions, or guards in this commit. The
migration lands only after the 0758 pilot clears and the operator approves
the change (plan §7 S5 operator consent gate).

## Acceptance criteria mapping (task 0759)

- R1 — closed route table: ✅ frozen in `config/proportional-route-table.ts`; task-pipeline
  adopts unchanged.
- R2 — safety floor: ✅ frozen in `safetyFloorHolds()`; task-pipeline enforces the
  same invariant.
- R3 — no regression: PENDING — requires real terminal runs after migration
  with pre/post comparison.
- R4 — real engine, no fixture: ✅ invariant is a design property; no fixture
  substitution in this branch.
- R5 — verified-outcome binding: ✅ already shipped via 0751 R4 (the
  `proofBinding: current` guard); the migration reuses it.
- R6 — measured bounds: ✅ none adjusted in this branch; per-bound justification
  required at migration time.
- R7 — revertable: ✅ `proportional_routing.enabled: false` is the rollback.

## Open items (all blocked on 0758 pilot)

- Per-pilot fast-path predicate values (R1).
- Run-bound evidence writer implementation (R4, R5).
- Pre/post terminal-run comparison (R3).
- Operator consent for the task-pipeline.yaml change (plan §7 S5).

Status moves from WIP to done when the 0758 pilot clears the bar and the
follow-up session implements the per-pilot predicates and the evidence writer.
