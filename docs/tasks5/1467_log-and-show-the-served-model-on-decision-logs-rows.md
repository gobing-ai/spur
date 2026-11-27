---
schema_version: 1
name: Log and show the served model on decision_logs rows
status: todo
template: feature-impl
created_at: 2026-11-27T07:35:46.245Z
updated_at: "2026-11-27T16:55:25.849Z"
feature_id: P12

dependencies: ["1466"]
estimate_hours: 3
priority: P2
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

**Refine corrections (2026-11-27)**

- "a mirrored statement in `migrations.ts`" → the mirror shape is a `*_SCHEMA_SQL` constant (precedent `migrations.ts:257`) plus a migrations-array entry with `addColumnIfMissing: { table: 'decision_logs', column: 'served_model' }` (precedent `:1652-1656`); the `decision_logs` DDL spans `:262-306` → R1 names the exact shape. `emit-migration-sql` covers only 0037, so 0057 is hand-mirrored.
- R2 "DAO insert/select" missed the explicit summary projection → `decision-log-dao.ts:114` `SUMMARY_COLUMNS` must list `served_model`; `DecisionLogSummaryRow` (`:77`) is an `Omit` of `DecisionLogRow` and inherits it → added to R2.
- R3 missed the row→contract mapper → `toSummaryEntry` (`packages/app/src/decision/decision-log-query.ts:117`) must set `servedModel`; the detail schema extends `decisionLogRowSchema` (`observability.ts:353`) and inherits the field; the drawer field list is at `DecisionDetailDrawer.tsx:114` → added to R3.
- Verified: `buildDecisionLogRow` callers at `decision-events.ts:178,261`; latest migration `0056_spur_cli_coordination_runs_a2a_remote_context.sql`; `run-transfer.ts` copies only target-present columns, so no change; catalog has both ts-ai packages at 0.8.5; `spur decision run <id>` exists.
- Plan step 4 real proof needs a TypeSafe credential and network → stated as an environment precondition; without it the proof is recorded as blocked, not substituted with a stub.
- AC rows used the non-canonical `R<n> —` form → rewritten as `AC<n> — … (req: …)` with test layers.

### Requirements

- [ ] R1. Migration `drizzle/0057_spur_cli_decision_logs_served_model.sql` (`ALTER TABLE decision_logs ADD COLUMN served_model TEXT`) plus its `migrations.ts` mirror — a `*_SCHEMA_SQL` constant and an array entry with `addColumnIfMissing: { table: 'decision_logs', column: 'served_model' }` — add the nullable column.
- [ ] R2. `DecisionLogRow`, the DAO insert, the `SUMMARY_COLUMNS` projection (`decision-log-dao.ts:114`), `DecisionLogRecord` and `buildDecisionLogRow` carry `served_model` / `servedModel` from `DecisionResult.servedModel`.
- [ ] R3. `decisionLogRowSchema` gains `servedModel: z.string().nullable()`, `toSummaryEntry` (`decision-log-query.ts:117`) maps it, and the drawer shows "Served model" only when the value is non-null.
- [ ] R4. Rows from non-typesafe makers, fallbacks and rejected decisions store `NULL`.
- [ ] R5. The root catalog bumps `@gobing-ai/ts-ai-runner` and `@gobing-ai/ts-ai-decision` to the release from task 1466.

Out of scope: a CLI log-row viewer; backfilling old rows.

### Acceptance Criteria

- [ ] AC1 — the served model is logged per decision (req: R1; R2; R3; R5) — unit: in-memory DAO test in `packages/domain/tests` round-trips `served_model` through insert and the summary select; builder/query tests in `packages/app/tests/decision` map an accepted typesafe result to `servedModel`; web test in `apps/web/tests` renders "Served model" in `DecisionDetailDrawer` only when non-null. Real proof: one `spur decision run <id>` with the typesafe maker records a non-null `served_model`.
- [ ] AC2 — non-typesafe makers leave the served model empty (req: R4) — unit: `packages/app/tests/decision` builder tests prove fm-local/agent, fallback and rejected rows store `NULL`, and a pre-0057 row reads `NULL` after migration.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-11-27T07:54:05.892Z

- **Q: Add a `spur decision log show` verb?** A: No. It is a public-surface change that needs consent. The Board drawer and the row contract satisfy R1.
- **Q: Backfill historic rows?** A: No. The served model was never recorded, so `NULL` is truthful.
- **Q: List-page column?** A: No. The drawer only, which keeps the list row narrow.

#### Q&A entry — 2026-11-27 (refine, depth=ready)

- **Q: Does `run-transfer.ts` need the new column?** A: No. It copies only columns present in the target table.
- **Q: What if the TypeSafe credential is unavailable for the real proof?** A: Record it as blocked with the reason; do not substitute a stub run as the real receipt.

### Design

- **Chosen:** one nullable column threaded through DAO → builder → contract → drawer.
- **Rejected:** storing it inside `phases_json`, which is not queryable and is the wrong owner.
- **Frozen names:** column `served_model`; contract field `servedModel`.
- **Invariants:** an additive migration that is safe on existing DBs; old rows read `NULL`.
- **Anti-patterns:** writing the configured/requested model into `served_model`.
- **Handoff:** none.

### Plan

1. Failure modes first:
   - (a) a DAO in-memory test where an inserted row with `served_model` round-trips through insert and the `SUMMARY_COLUMNS` select, and a row without it reads `NULL`;
   - (b) a builder/query test where an accepted typesafe result maps to `servedModel` through `buildDecisionLogRow` and `toSummaryEntry`, and fallback/rejected/non-typesafe rows map to null;
   - (c) a migration test where a DB created before 0057 gains the column via `addColumnIfMissing` and old rows read `NULL`;
   - (d) a drawer test where the field renders only when non-null.
2. Write the migration, the `migrations.ts` mirror (constant + `addColumnIfMissing` entry), DAO (`SUMMARY_COLUMNS`), builder, `toSummaryEntry`, contract and drawer (`DecisionDetailDrawer.tsx:114`).
3. After task 1466's release is authorized and published, bump the catalog versions and run `bun install`.
4. Real proof (precondition: a TypeSafe credential in the operator's environment and network access; never read or print the key): run one `spur decision run <id>` with the typesafe maker, then confirm `decision_logs.served_model` through the source CLI/Board and record it. If the precondition is missing, record the proof as blocked.
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

