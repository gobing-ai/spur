---
schema_version: 1
name: Log and show the served model on decision_logs rows
status: done
template: feature-impl
created_at: 2026-11-27T07:35:46.245Z
updated_at: "2026-11-27T19:25:25.000Z"
feature_id: P12

dependencies: ["1466"]
estimate_hours: 3
priority: P2
done_forced: "false"
done_reason: unforced close
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

- [x] R1. Migration `drizzle/0057_spur_cli_decision_logs_served_model.sql` (`ALTER TABLE decision_logs ADD COLUMN served_model TEXT`) plus its `migrations.ts` mirror — a `*_SCHEMA_SQL` constant and an array entry with `addColumnIfMissing: { table: 'decision_logs', column: 'served_model' }` — add the nullable column.
- [x] R2. `DecisionLogRow`, the DAO insert, the `SUMMARY_COLUMNS` projection (`decision-log-dao.ts:114`), `DecisionLogRecord` and `buildDecisionLogRow` carry `served_model` / `servedModel` from `DecisionResult.servedModel`.
- [x] R3. `decisionLogRowSchema` gains `servedModel: z.string().nullable()`, `toSummaryEntry` (`decision-log-query.ts:117`) maps it, and the drawer shows "Served model" only when the value is non-null.
- [x] R4. Rows from non-typesafe makers, fallbacks and rejected decisions store `NULL`.
- [x] R5. The root catalog bumps `@gobing-ai/ts-ai-runner` and `@gobing-ai/ts-ai-decision` to the release from task 1466.

Out of scope: a CLI log-row viewer; backfilling old rows.

### Acceptance Criteria

- [x] AC1 — the served model is logged per decision (req: R1; R2; R3; R5) — unit: in-memory DAO test in `packages/domain/tests` round-trips `served_model` through insert and the summary select; builder/query tests in `packages/app/tests/decision` map an accepted typesafe result to `servedModel`; web test in `apps/web/tests` renders "Served model" in `DecisionDetailDrawer` only when non-null. Real proof: one `spur decision run <id>` with the typesafe maker records a non-null `served_model`.
- [x] AC2 — non-typesafe makers leave the served model empty (req: R4) — unit: `packages/app/tests/decision` builder tests prove fm-local/agent, fallback and rejected rows store `NULL`, and a pre-0057 row reads `NULL` after migration.

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

| File | Change |
| --- | --- |
| `drizzle/0057_spur_cli_decision_logs_served_model.sql:1-3` | New migration: `ALTER TABLE decision_logs ADD COLUMN served_model TEXT` — nullable and additive (R1). |
| `packages/domain/src/migrations.ts:260-270` | `DECISION_LOGS_SERVED_MODEL_SCHEMA_SQL` constant mirroring the file above, with the "pre-0057 rows, non-typesafe makers, fallbacks and rejections all read NULL" rationale (R1). |
| `packages/domain/src/migrations.ts:1666-1671` | Registry entry `0057_spur_cli_decision_logs_served_model` with `addColumnIfMissing: { table: 'decision_logs', column: 'served_model' }`, so a database created before it gains the column exactly once (R1). |
| `packages/domain/src/dao/decision-log-dao.ts:40-43` | `DecisionLogRow.served_model` (R2). |
| `packages/domain/src/dao/decision-log-dao.ts:137-141` | `served_model` joins `SUMMARY_COLUMNS`, so the list projection carries it and `DecisionLogSummaryRow` inherits through its `Omit` (R2). |
| `packages/domain/src/dao/decision-log-dao.ts:197,224` | Insert column list and bind list both carry `row.served_model` (R2). |
| `packages/app/src/decision/decision-log.ts:101-103` | `DecisionLogRecord.servedModel` (R2). |
| `packages/app/src/decision/decision-log.ts:173-175` | `buildDecisionLogRow` writes the value **only for `outcome === 'accepted'`**; a fallback, a rejection or a driver that reports no model stores NULL (R2/R4). |
| `packages/app/src/decision/decision-events.ts:95-97,284` | `DecisionEndFields.servedModel` and its forwarding into the row builder (R2). |
| `packages/app/src/decision/decision-service.ts:643` | The terminal `end()` call passes `outcome.servedModel` from the hub result (R2). |
| `packages/contracts/src/observability.ts:339-340` | `decisionLogRowSchema.servedModel: z.string().nullable()`; the detail schema inherits it through `extend` (R3). |
| `packages/app/src/decision/decision-log-query.ts:52-53,144` | `DecisionLogSummaryEntry.servedModel` and the `toSummaryEntry` mapping from `row.served_model` (R3). |
| `apps/web/src/modules/observability/DecisionDetailDrawer.tsx:138-139` | "Served model" field, pushed only when the value is non-null (R3). |
| `package.json` (workspaces.catalog) | All fourteen `@gobing-ai/ts-*` entries 0.8.5 → 0.8.6, plus `bun.lock` (R5). |

Rationale: one nullable column threaded DAO → builder → contract → drawer, so nothing is stored inside `phases_json` (unqueryable, wrong owner) and no new public CLI verb appears (the Q&A's rejected `spur decision log show`). The accepted-only guard is deliberate defence in depth: the hub never sets `servedModel` on a fallback, and the row writer does not trust that alone.

**R5 scope note.** The task says bump the two packages 1466 changed; the catalog bumps the whole `@gobing-ai/ts-*` family instead, because ts-libs releases lockstep — leaving mixed 0.8.5/0.8.6 entries would install two copies of a shared transitive package (`@gobing-ai/ts-runtime`, `ts-utils`) into one tree. Content is identical apart from the 1466 change, so the wider pin carries no extra behaviour.

Real proof (Plan step 4, live TypeSafe API — the credential was present, never read or printed):
- `spur decision run maker-liveness --param instructions=… --maker typesafe --json` → `source: model`, `reason: accepted`, `servedModel: "jev-1.14.0"`, and `sqlite3 .spur/spur.db "SELECT decision_id, outcome, source, served_model FROM decision_logs ORDER BY started_at DESC"` → `maker-liveness|accepted|model|jev-1.14.0`.
- `spur decision run gate-evidence … --maker typesafe --json` → `source: default`, `reason: low-confidence` → the same query shows `gate-evidence|fallback|default|` (NULL), which is R4 end-to-end.

Tests (Plan step 1a-1d): `packages/domain/tests/dao/decision-log-dao.test.ts` round-trip through insert + the summary select; `packages/domain/tests/dao/migrations.test.ts` guard + pre-0057 row reads NULL + migration-count bumps; `packages/app/tests/decision/decision-log.test.ts` accepted-only storage; `packages/app/tests/decision/decision-log-query.test.ts` summary mapping; `apps/web/tests/components/decision-detail-drawer.test.tsx` renders only when non-null.

Gate: `spur task gate 1467 light` → PASS (16 changed files, 12 checks).
probe: golden path above — `spur decision run` end-to-end against the real backend plus a direct row read.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
|-------------|--------|----------|
| R1 | MET | `drizzle/0057_spur_cli_decision_logs_served_model.sql:1-3` adds the nullable column; `packages/domain/src/migrations.ts:260-270` is the `DECISION_LOGS_SERVED_MODEL_SCHEMA_SQL` mirror and `packages/domain/src/migrations.ts:1666-1671` registers it with `addColumnIfMissing: { table: 'decision_logs', column: 'served_model' }`. `packages/domain/tests/dao/migrations.test.ts` asserts the constant/entry pairing, one column after migration, a pre-0057 row reading NULL, and a re-applied migration count of 0. |
| R2 | MET | `packages/domain/src/dao/decision-log-dao.ts:40-43` (row), `:137-141` (`SUMMARY_COLUMNS`), `:197,224` (insert list + binds); `packages/app/src/decision/decision-log.ts:101-103` (record) and `:173-175` (builder); `packages/app/src/decision/decision-events.ts:95-97,284` (end fields + forwarding); `packages/app/src/decision/decision-service.ts:643` (hub result → end). Round-trip proven at `packages/domain/tests/dao/decision-log-dao.test.ts` and `packages/app/tests/decision/decision-log.test.ts`. |
| R3 | MET | `packages/contracts/src/observability.ts:339-340` (`servedModel: z.string().nullable()`, inherited by the detail schema), `packages/app/src/decision/decision-log-query.ts:52-53,144` (entry + `toSummaryEntry`), `apps/web/src/modules/observability/DecisionDetailDrawer.tsx:138-139` (field only when non-null). Proven at `packages/app/tests/decision/decision-log-query.test.ts` and `apps/web/tests/components/decision-detail-drawer.test.tsx`. |
| R4 | MET | `packages/app/src/decision/decision-log.ts:175` writes the value only when `record.outcome === 'accepted'`; `packages/app/tests/decision/decision-log.test.ts` covers accepted / no-model / fallback / rejected. Live proof: `spur decision run gate-evidence …` → `reason: low-confidence` left `gate-evidence\|fallback\|default\|` (NULL) in `decision_logs`, while `maker-liveness` → `accepted\|model\|jev-1.14.0`. |
| R5 | MET | `package.json` workspaces.catalog: all fourteen `@gobing-ai/ts-*` entries at `0.8.6` (published from ts-libs release commit `83c95f47` + `280467e7`), `bun.lock` refreshed; `bun install --ignore-scripts` in this tree resolves `@gobing-ai/ts-ai-runner` 0.8.6 and `@gobing-ai/ts-ai-decision` 0.8.6. |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| AC1 — the served model is logged per decision (req: R1; R2; R3; R5) | MET | test | DAO round-trip `packages/domain/tests/dao/decision-log-dao.test.ts`; builder/query mapping `packages/app/tests/decision/decision-log.test.ts` and `packages/app/tests/decision/decision-log-query.test.ts`; drawer render `apps/web/tests/components/decision-detail-drawer.test.tsx`; real proof `spur decision run maker-liveness --maker typesafe` → `served_model = jev-1.14.0` read back with `sqlite3 .spur/spur.db`. |
| AC2 — non-typesafe makers leave the served model empty (req: R4) | MET | test | `packages/app/tests/decision/decision-log.test.ts` proves fallback/rejected/no-model rows store NULL; `packages/domain/tests/dao/migrations.test.ts` proves a pre-0057 row reads NULL; live fallback row observed NULL. |
- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

P1 (blocker): none.

P2 (major): none.

P3 (minor): none open.

P4 (advisory): R5 was implemented as a **family-wide** catalog bump (all fourteen `@gobing-ai/ts-*` entries to 0.8.6) rather than the two packages 1466 touched. ts-libs releases lockstep, and a mixed pin would install two copies of `@gobing-ai/ts-runtime` / `ts-utils` into one tree; content is identical apart from 1466's change. Recorded rather than silently widened.

P4 (advisory): the release path needed a detour worth knowing. `bump-ver 0.8.6` created the commit and tags, but the first tag push triggered no `Publish` run and the accompanying `CI` run failed on a host-dependent assertion in 1466's new test (`createFmDriver` refuses to construct off darwin/arm64). Fixed (`280467e7`), tags retagged onto the green commit, then `gh workflow run publish.yml` published 0.8.6 for the whole family. Publishing from CI uses OIDC, so a local `npm publish` was never an option.

P4 (advisory): the drawer fetch path is on the summary row's contract; `servedModel` therefore reaches the drawer through the same object that opens it, and no extra request is needed. Verified by the render test rather than by a browser pass — the Browser check for the Decisions tab is not part of this task and no UI layout changed beyond one conditional field row.

Residual risk: `served_model` records whatever the backend echoes, so a maker that reports no model and a fallback are indistinguishable in the column alone — consumers must read it with `outcome`/`source`, which is exactly how the row is written (accepted-only). No backfill, by design: the value was never recorded, so NULL is truthful.

Disposition: PASS — one nullable column threaded end to end, accepted-only write guarded twice (hub + writer), contract and drawer gated on non-null, real-backend proof both ways, light gate green on this tree.

### References

- `packages/domain/src/migrations.ts:262-304`; `drizzle/0052_spur_cli_decision_logs.sql`; `drizzle/0056_…`
- `packages/domain/src/dao/decision-log-dao.ts:7`
- `packages/app/src/decision/decision-log.ts:79,137`; `decision-events.ts`
- `packages/contracts/src/observability.ts:315`
- `apps/web/src/modules/observability/DecisionDetailDrawer.tsx`
- Task 1466; feature P12

### History

- 2026-11-27T07:54:33.668Z backlog → todo (system)
- 2026-11-27T19:24:19.243Z todo → wip (system)
- 2026-11-27T19:25:21.365Z wip → testing (system)
- 2026-11-27T19:25:24.982Z testing → done (system)

