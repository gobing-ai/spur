---
schema_version: 1
name: Log and show the served model on decision_logs rows
status: todo
template: feature-impl
created_at: 2026-11-27T07:35:46.245Z
updated_at: "2026-11-27T07:54:33.668Z"
feature_id: P12

dependencies: ["1466"]
estimate_hours: 3
---

## 1467. Log and show the served model on decision_logs rows

### Background

Feature P12 R1/R2: Spur persists the model that served each decision. Seams:

- DDL: `packages/domain/src/migrations.ts:262-304` (`decision_logs`, task 1100), mirrored in `drizzle/0052_spur_cli_decision_logs.sql`. The latest migration is `0056_…`, so this one is `0057`. Column-add precedent: `drizzle/0056_spur_cli_coordination_runs_a2a_remote_context.sql` (`ALTER TABLE … ADD COLUMN … TEXT`).
- Row type: `packages/domain/src/dao/decision-log-dao.ts:7` (`DecisionLogRow`) and the DAO insert.
- Builder: `packages/app/src/decision/decision-log.ts:79` (`DecisionLogRecord`), `:137` (`buildDecisionLogRow`). Callers are in `decision-events.ts` (~:178, ~:261).
- Transport: `packages/contracts/src/observability.ts:315` (`decisionLogRowSchema`).
- UI: `apps/web/src/modules/observability/DecisionDetailDrawer.tsx`.

Refine correction: `spur decision show <id>` describes a catalog decision, not a log row (`apps/cli/src/commands/decision.ts:92`), so it cannot print a per-row model. The P12 R1 display surface was corrected to the Board drawer plus the row contract. A new CLI log verb would need public-surface consent and is out of scope.

Depends on task 1466 and its published ts-libs release.

### Requirements

- [ ] R1. Migration `drizzle/0057_spur_cli_decision_logs_served_model.sql` plus a mirrored statement in `migrations.ts` add `decision_logs.served_model TEXT` (nullable).
- [ ] R2. `DecisionLogRow`, the DAO insert/select, `DecisionLogRecord` and `buildDecisionLogRow` carry `served_model` / `servedModel` from `DecisionResult.servedModel`.
- [ ] R3. `decisionLogRowSchema` gains `servedModel: z.string().nullable()`, and the drawer shows "Served model" only when the value is non-null.
- [ ] R4. Rows from non-typesafe makers, fallbacks and rejected decisions store `NULL`.
- [ ] R5. The root catalog bumps `@gobing-ai/ts-ai-runner` and `@gobing-ai/ts-ai-decision` to the release from task 1466.

Out of scope: a CLI log-row viewer; backfilling old rows.

### Acceptance Criteria

- [ ] R1 — the served model is logged per decision
- [ ] R2 — non-typesafe makers leave the served model empty

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-27T07:54:05.892Z

- **Q: Add a `spur decision log show` verb?** A: No. It is a public-surface change that needs consent. The Board drawer and the row contract satisfy R1.
- **Q: Backfill historic rows?** A: No. The served model was never recorded, so `NULL` is truthful.
- **Q: List-page column?** A: No. The drawer only, which keeps the list row narrow.

### Design

- **Chosen:** one nullable column threaded through DAO → builder → contract → drawer.
- **Rejected:** storing it inside `phases_json`, which is not queryable and is the wrong owner.
- **Frozen names:** column `served_model`; contract field `servedModel`.
- **Invariants:** an additive migration that is safe on existing DBs; old rows read `NULL`.
- **Anti-patterns:** writing the configured/requested model into `served_model`.
- **Handoff:** none.

### Plan

1. Failure modes first:
   - (a) a DAO in-memory test where an inserted row with `served_model` round-trips, and a row without it reads `NULL`;
   - (b) a builder test where an accepted typesafe result maps to `servedModel`, and fallback/rejected rows map to null;
   - (c) a contract/drawer test where the field renders only when non-null.
2. Write the migration, the `migrations.ts` mirror, DAO, builder, contract and drawer.
3. Bump the catalog versions and run `bun install`.
4. Real proof: run one real `spur decision run <id>` with the typesafe maker. Query `decision_logs.served_model` through the source CLI/Board and record it.
5. Run `bun run spur-check`.

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

- `packages/domain/src/migrations.ts:262-304`; `drizzle/0052_spur_cli_decision_logs.sql`; `drizzle/0056_…`
- `packages/domain/src/dao/decision-log-dao.ts:7`
- `packages/app/src/decision/decision-log.ts:79,137`; `decision-events.ts`
- `packages/contracts/src/observability.ts:315`
- `apps/web/src/modules/observability/DecisionDetailDrawer.tsx`
- Task 1466; feature P12

### History

- 2026-11-27T07:54:33.668Z backlog → todo (system)

