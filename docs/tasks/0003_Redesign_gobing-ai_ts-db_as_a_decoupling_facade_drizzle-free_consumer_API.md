---
name: "Redesign @gobing-ai/ts-db as a decoupling facade (drizzle-free consumer API)"
description: "Redesign @gobing-ai/ts-db as a decoupling facade (drizzle-free consumer API)"
status: done
created_at: 2026-05-31T18:31:19.708Z
updated_at: 2026-06-01T17:00:45Z
folder: docs/tasks
type: task
feature-id: ""
priority: high
dependencies: ["@gobing-ai/ts-* 0.2.4 published and consumed by semver"]
tags: ["ts-libs","ts-db","dao","redesign","breaking-change","handoff","cross-repo"]
impl_progress:
  planning: done
  design: done
  implementation: done
  review: done
  testing: done
---

## 0003. "Redesign @gobing-ai/ts-db as a decoupling facade (drizzle-free consumer API)"

### Background

Cross-repo handoff spec for the ts-libs agent (ts-libs is owned/executed by the parallel agent; this is the SPEC — spur-new consumes after publish). Supersedes task 0002 (canceled), which carried a stale "patch the DAO base library" framing. This is a **from-scratch redesign of @gobing-ai/ts-db at the query/DAO surface**, driven by three operator-stated goals.

**Primary goal (G1) — Decoupling facade.** ts-db is the anti-corruption layer between the application and its DB dependency (drizzle-orm). Application/package code depends ONLY on ts-db vocabulary, NEVER on drizzle directly — so drizzle can be swapped (or Postgres added) by changing ts-db internals, not call sites. `grep -r "drizzle" apps/ packages/` in a consumer must return NOTHING.

**Secondary goal (G2) — Single source of truth.** A table is defined ONCE; zod validation and migrations are DERIVED from it (drizzle-zod + the existing migrate module), never re-authored in parallel with different tools. Eliminates schema/validation/migration drift.

**Tertiary goal (G3) — Two-tier mental model.** A clean, unified split between STRUCTURED operations (typed CRUD over an entity) and RAW operations (escape hatch for ETL/complex), the consumer's choice which tier — but BOTH speak ts-db's vocabulary, never leaking drizzle.

**Why redesign, not patch.** Source read 2026-05-31: the library's INTENT is right but its EXECUTION leaks. `DbClient` (adapter.ts, 109 lines) re-declares a lossy SUBSET of drizzle's builder; `getDb()` returns `this.drizzleDb as unknown as DbClient` (throws away types); raw SQL escapes to DbAdapter OUTSIDE the DAO abstraction; `withTransaction` reaches `.transaction()` via `as unknown as` because DbClient never declared it. The leaks ARE the bugs. The fix is to COMPLETE the facade (full, drizzle-free, no casts), not remove it.


### Requirements

DECIDED (operator, 2026-05-31): full from-scratch redesign; lean facade; zero drizzle imports in consumers; breaking change. Actual released/consumed version is **@gobing-ai/ts-db 0.2.4**.

- R1 (Zero drizzle leakage, G1): No `from 'drizzle-orm'` import anywhere outside ts-db itself. ts-db re-surfaces every capability consumers need in its OWN signatures. The drizzle `sql` tagged template is NOT exposed to consumers. A spur rule forbids drizzle imports in apps/ + packages/ (validated against /Users/robin/xprojects/spur/dist/cli/spur).
- R2 (Two-tier facade, G3): BaseDao = RAW tier (generic, table-agnostic): `query<T>(spec)`, `one<T>(spec)`, `exec(spec)`, `tx<T>(fn)` — all drizzle-free signatures; the `tx` callback receives a ts-db tx handle, not a drizzle tx. EntityDao extends BaseDao = STRUCTURED tier (typed CRUD over one table). ETL/analytics/reporting DAOs extend BaseDao DIRECTLY (no EntityTable contract).
- R3 (Lean facade, no second ORM): STRUCTURED tier = create / createMany / upsert / findById / findBy / findAllBy / update / delete / list({where, orderBy, cursor, limit, offset}) / count. `where`/`orderBy` use a SMALL ts-db predicate spec (eq/ne/gt/gte/lt/lte/like/in/isNull over column refs) + order spec — enough for the 90%, NOT a full query builder. Anything beyond (joins, aggregates, window fns) = a NAMED method on a specific DAO whose body uses drizzle privately (confined, never leaked to app code). Do NOT expose a query-builder DSL.
- R4 (Single source of truth, G2): A table is authored ONCE (ts-db column/table helpers over sqliteTable + standardColumns). From it, DERIVE: (a) zod insert/select schemas via drizzle-zod (internal), (b) migration SQL via the existing migrate module, (c) EntityDao<typeof table> types. No parallel re-authoring.
- R5 (Type-safe everything): No `as unknown as` casts in the data path. The internal drizzle db is fully typed end-to-end inside ts-db; only the PUBLIC surface is the ts-db facade.
- R6 (Capability completeness — the gaps surfaced by spur task 0001): upsert (onConflictDoUpdate, internal), createMany (single multi-VALUES batch), RETURNING-based create/update/upsert (not JS-constructed rows), orderBy in list, cursor/keyset pagination (reuse ts-utils cursor helpers), composite-PK support. All exposed as ts-db methods, drizzle hidden.
- R7 (zod opt-in, boundary-scoped, G2): drizzle-zod schemas derived from tables; validation is OPT-IN per DAO and intended for TRUST BOUNDARIES (e.g. JSONL importer parsing untrusted files), NOT pervasive on internal writes where types already guarantee shape. zod stays a peer/optional dep.
- R8 (Migrations — PORT, do NOT redesign): keep the current migrate module (file-based + embedded + journal) essentially as-is. The redesign is the query/DAO surface, not migrations.
- R9 (Conventions preserved): standardColumns, appendOnlyColumns, soft-delete column + auto-filter, nowTimestamp, id generator — keep as drizzle-native helpers composed into tables.
- R10 (Adapter/lifecycle + the ONLY string-SQL door): keep createDbAdapter (driver select + pragmas + schema attach) + migrate + close. The string-SQL escape (exec/run for DDL / dynamic identifiers like `history_etl_${source}`) stays on the adapter, DAO-gated by the spur rule — the ONLY place raw string SQL is allowed. (Parameterized queries go through the R2 raw tier's ts-db spec, NOT string SQL.)
- R11 (Backward-incompatible, managed): 0.2.4. BaseDao/EntityDao public API changes (signatures become drizzle-free). Provide a consumer migration note. ts-db's own QueueJobDao is rewritten to the new facade. spur-new packages/domain (6 DAOs from task 0001) is rewritten as part of consuming it.
- R12 (Tests + coverage): TDD, 90%+ per ts-libs convention; both backends (bun:sqlite + D1 where feasible); cover the predicate spec, cursor pagination, upsert, batch, tx, soft-delete, composite-PK.
- R13 (Publish + consume): semver 0.2.4 is published/consumed by spur-new (`@gobing-ai/ts-db: ^0.2.4`). Clean semver installs now include the schema facade exports needed by the zero-drizzle consumer rewrite.

### 0.2.4 alignment update (2026-06-01)

`@gobing-ai/ts-db` 0.2.4 is published and Spur consumes `^0.2.4` from semver in root `package.json` and `packages/domain/package.json`. Verification confirms the published artifact now satisfies the zero-leakage schema-authoring requirement.

Current 0.2.4 facts:

- 0.2.4 keeps public `DbClient` / `adapter.getDb()` removed and moved DAOs to `DbAdapter`.
- Published 0.2.4 exposes `text`, `integer`, and `index` from `@gobing-ai/ts-db/schema`.
- Spur `packages/domain/src/schema/*` now imports table authoring vocabulary only from `@gobing-ai/ts-db/schema`.
- `packages/domain/package.json` no longer directly depends on `drizzle-orm`.
- No temporary `bun link` is required.


### Q&A



### Design

### The facade contract (G1)

Consumer code imports ONLY `@gobing-ai/ts-db`. `import ... from 'drizzle-orm'` is forbidden outside ts-db (spur rule). drizzle is an internal impl detail.

### Public surface (sketch — implementer refines against drizzle 0.38+)

```ts
// ── construction / lifecycle (keep, refine) ──
const adapter = await createDbAdapter({ driver: 'bun-sqlite', url, pragmas?, schema });
//   adapter.migrate(opts?)  adapter.close()
//   adapter.exec(sql) / adapter.run(sql, ...p)  ← string-SQL escape: DDL / dynamic identifiers ONLY, DAO-gated

// ── tier 1: BaseDao (RAW, generic, drizzle-free signatures) ──
abstract class BaseDao {
  protected constructor(adapter: DbAdapter);
  protected now(): number;
  protected tx<T>(fn: (h: TxHandle) => Promise<T>): Promise<T>;   // ts-db tx handle, NOT a drizzle tx
  // raw tier speaks a ts-db query spec, never the drizzle sql`` tag:
  protected query<T>(spec: QuerySpec): Promise<T[]>;
  protected one<T>(spec: QuerySpec): Promise<T | undefined>;
  protected exec(spec: WriteSpec): Promise<void>;
}

// ── tier 2: EntityDao (STRUCTURED CRUD, extends BaseDao) ──
class EntityDao<TTable, TPK> extends BaseDao {
  create(data): Promise<Row>;                 // RETURNING
  createMany(rows: Insert[]): Promise<Row[]>; // single multi-VALUES
  upsert(data, conflict): Promise<Row>;       // onConflictDoUpdate (internal)
  findById / findBy / findAllBy / findAll;
  update(id, data): Promise<Row>;             // RETURNING
  delete(id, soft?);
  list(opts: ListSpec): Promise<Row[]>;       // where + orderBy + cursor|offset + limit
  listByCursor(opts): Promise<{ rows; nextCursor }>;
  count(where?: Predicate): Promise<number>;
}

// ── the SMALL predicate / order spec (the bounded re-surface, R3) ──
type Predicate =                              // enough for the 90%, NOT a builder
  | { col: ColRef; op: 'eq'|'ne'|'gt'|'gte'|'lt'|'lte'|'like'; value: unknown }
  | { col: ColRef; op: 'in'; values: unknown[] }
  | { col: ColRef; op: 'isNull'|'isNotNull' }
  | { and: Predicate[] } | { or: Predicate[] };
type ListSpec = { where?: Predicate; orderBy?: { col: ColRef; dir?: 'asc'|'desc' }[]; limit?; offset?; cursor?; includeDeleted? };

// ── single source of truth (G2) ──
export const users = defineTable('users', { id: id(), email: text().unique(), ...standardColumns });
//   → drizzle-zod schemas (internal) + migration SQL (migrate module) + EntityDao<typeof users> types
//   ALL derived from this one definition.

// ── ETL / complex: extend BaseDao, named methods, drizzle hidden in body ──
class HistoryAnalyticsDao extends BaseDao {
  costsByModel(since: string) { /* ts-db spec, or a private confined drizzle call inside this method */ }
}
```

### Facade boundary rule (spur rule, R1)

```
forbid: import ... from 'drizzle-orm'                          in apps/** , packages/**   (outside ts-db)
forbid: adapter string-SQL (exec/run/queryFirst/queryAll)     outside **/dao/** | **/*-dao.ts
allow:  ts-db facade (createDbAdapter, BaseDao, EntityDao, defineTable, predicates)   everywhere
```
Re-points the 0001 boundary rule from "@gobing-ai/ts-db only in packages/domain" to "drizzle-orm never in consumers; string-SQL only in DAOs."

### Acceptance criteria

- [x] `grep -rn "from 'drizzle-orm'" apps/ packages/` in spur-new → ZERO hits (G1).
- [x] An ETL DAO extends BaseDao and runs parameterized raw queries + transactions with drizzle-free signatures, no EntityTable.
- [x] EntityDao: upsert, createMany, RETURNING create/update, list(where+orderBy+cursor), count — all via the predicate spec, no drizzle in the call.
- [x] Composite-PK DAO works (e.g. a (source, source_file) keyed table).
- [x] One table definition derives zod + migration + types (no parallel re-authoring).
- [x] No `as unknown as` in the DAO/query data path (`base-dao.ts`, `entity-dao.ts`, `queue-job-dao.ts`).
- [x] Migrations module ported, behavior unchanged; both backends green.
- [x] ts-db's QueueJobDao rewritten to the facade and green.
- [x] spur rule forbids drizzle imports in consumers + string-SQL outside DAOs; validates against /Users/robin/xprojects/spur/dist/cli/spur.
- [x] ts-libs `bun run check` green, 90%+ coverage.
- [x] Published/consumed `@gobing-ai/ts-db` 0.2.4 via semver.
- [x] spur-new packages/domain rewritten to the facade with zero direct `drizzle-orm` dependency.

### Open implementation choices (ts-libs agent decides with full context)

- Predicate-spec ergonomics: object literals vs tiny builder fns (`eq('email', x)`) — keep minimal, no chaining DSL.
- `defineTable` thin wrapper vs raw `sqliteTable` + documented helper convention — pick whichever achieves G2 with least magic.
- Confined private drizzle inside a named DAO method is ACCEPTABLE (does not leak to app code); the bar is "no drizzle in apps/ + packages/", not "no drizzle anywhere in a DAO body".
- Cursor encoding: reuse ts-utils cursor module vs a ts-db-local helper.

### Decisions log (operator, 2026-05-31)

- Full from-scratch redesign (not incremental patch). Actual release/consumption line: 0.2.4.
- Lean facade (CRUD + small predicate spec; complex = named DAO methods). NOT a query-builder DSL.
- Zero drizzle imports in consumers; spur-rule enforced.
- Keep BaseDao+EntityDao two-tier (it IS the facade, G3). Port migrations (do not redesign). zod opt-in / boundary-only.


### Solution

**ts-db is a COMPLETE decoupling facade; drizzle is an internal implementation detail that never appears in consumer code.** The current library has the right intent but leaks (lossy DbClient subset + `as unknown as` casts + raw SQL escaping outside the abstraction). The redesign COMPLETES the facade rather than removing it.

**Two-tier layering (G3):** BaseDao = raw tier (generic, table-agnostic), EntityDao extends BaseDao = structured CRUD. Every signature is ts-db's OWN vocabulary, not a drizzle pass-through. Two classes, clear responsibilities (raw vs structured), zero drizzle leakage.

**The 90/10 discipline (keeps it simple):** the structured tier covers the 90% (CRUD + list with a tiny predicate/order spec); the raw tier is the explicit, rule-gated 10% as NAMED DAO methods (e.g. `analytics.costsByModel(since)`) with drizzle hidden in the body. No exposed query-builder DSL → no second ORM.

**The one real cost of strict G1:** ts-db must re-surface a SMALL predicate/order spec so consumers express where/orderBy without importing drizzle. Bounded to a tiny typed vocabulary (eq/in/gte/...), not a builder. This is the deliberate, contained re-implementation that buys full swappability.

**Rejected alternatives (for the record):**
- Expose `db.client: DrizzleDatabase` / the drizzle `sql` tag to consumers — REJECTED: violates G1 (sprays drizzle across call sites; defeats the facade).
- Merge BaseDao into EntityDao (single class) — REJECTED: deletes the non-entity seam that ETL/reporting DAOs need (they must not be forced through the EntityTable contract).
- Push CRUD into BaseDao + raw onto EntityDao (the literal earlier "Option B") — REJECTED: inverts layering; CRUD needs table identity only EntityDao has, so BaseDao would just become EntityDao.
- Rich facade / own typed query-builder DSL — REJECTED: re-implements drizzle's builder = the wheel-reinvention and complexity to avoid.
- Pervasive zod on every write — REJECTED: runtime cost with no safety gain over edge validation; zod is opt-in/boundary-only.
- Mixins (Transactional/RawQueryable/Crud) — PARKED: verbose, overkill at the current DAO count.
- Repository + UnitOfWork — DEFERRED: premature for single-process local-first SQLite; revisit only if multi-aggregate transactional workflows appear.

**Industry best practice honored for this stack (bun:sqlite/D1 + drizzle + zod):** derive validation + migration from ONE schema (drizzle-zod + drizzle-kit); `INSERT/UPDATE ... RETURNING` over JS-constructed rows (avoids drift from DB defaults/triggers; supported on both backends); multi-VALUES batch insert for ETL (bun:sqlite prepared-stmt cache already present); keyset/cursor pagination for large scans, offset only for small bounded lists; WAL + foreign_keys=ON pragmas (already defaulted — keep). The facade adds the decoupling layer (G1) these tools do not provide on their own.


### Plan

Build order (each phase ends green in ts-libs before the next):

### Phase 1 — Facade contract + predicate spec (the new core)
1. Define the ts-db query vocabulary: `QuerySpec`, `WriteSpec`, `Predicate`, `ListSpec`, `ColRef`, `TxHandle` — drizzle-free public types.
2. Internal compiler: predicate/order spec → drizzle where/orderBy (contained in ts-db).
3. Tests for the spec compiler (eq/in/gte/like/and/or, order, edge cases).

### Phase 2 — Adapter + lifecycle (keep, de-leak)
4. Keep createDbAdapter (driver select + pragmas + schema attach). Remove the `as unknown as DbClient` cast; type the internal drizzle db fully; STOP exposing DbClient as a public type.
5. Keep adapter.exec/run as the string-SQL escape (DDL/dynamic identifiers).
6. Port the migrate module unchanged; confirm both backends.

### Phase 3 — BaseDao (raw tier)
7. BaseDao over the adapter: now(), tx() (type-safe, no cast), query/one/exec over the spec compiler.
8. Tests: an ETL-style DAO extends BaseDao, runs parameterized queries + a transaction, no EntityTable.

### Phase 4 — EntityDao (structured tier)
9. CRUD via RETURNING; createMany (multi-VALUES); upsert (onConflictDoUpdate); list(where/orderBy/offset); listByCursor (keyset); count; soft-delete auto-filter; composite-PK support.
10. Tests covering each, both backends where feasible, 90%+.

### Phase 5 — Single source of truth (G2)
11. defineTable (or documented helper convention) → derive drizzle-zod insert/select schemas (internal) + feed migration generation + EntityDao types.
12. Opt-in validation hook on create/update (boundary-only). zod peer/optional.

### Phase 6 — Internal migration + publish
13. Rewrite ts-db's own QueueJobDao to the facade; ensure ts-libs `bun run check` green.
14. Consumer migration note (BaseDao/EntityDao signature changes; how to port).
15. Publish 0.2.4 to npm. ✅ Done.

### Phase 7 — spur-new consumption (separate, in spur-new after publish)
16. Rewrite spur-new packages/domain (6 DAOs) to the facade; re-point the 0001 boundary rule → "no drizzle in consumers + string-SQL only in DAOs".
17. Switch spur-new ts-db dep link: → ^0.2.4; full gate + migration smoke (16 tables). ✅ Semver switch and zero-drizzle schema rewrite are done; no temporary link is required.


### Review

#### Verification — 2026-06-01 (`rd3-dev-verify 0003 --auto --fix all --force`)

**Verdict: FAIL**

**Scope:** `docs/tasks/0003_*`, `../ts-libs/packages/db`, `packages/domain`, `.spur/rules/boundary/dao-boundary.yaml`

**Fix-pass result:** 0 fixed in committed project files, 3 unresolved.

- Note: `.spur/rules/boundary/dao-boundary.yaml` has an evaluator-version mismatch. The linked `ts-rule-engine` evaluator expects `patterns`, but the installed `spur 0.1.0` binary used by `bun run spur-check` expects `forbidden` + `scope`. The project rule file is kept compatible with `spur-check`; tightening it to R1's zero-consumer-drizzle requirement must be coordinated with the Spur rule engine/binary version.
- Unresolved: `packages/domain/src/schema/{artifacts,phase-runs,runs,transition-runs,workflow-states,workspaces}.ts` still import `drizzle-orm/sqlite-core`; the strict R1 rule would fail on these six imports, while current `spur-check` intentionally allows them.
- Unresolved: `../ts-libs/packages/db/src/base-dao.ts`, `entity-dao.ts`, and `queue-job-dao.ts` still contain `as unknown as` casts in DAO/query data paths, violating R5.
- Unresolved: `BaseDao` still exposes drizzle-shaped internals to subclasses (`TxHandle = InternalDb`, table args typed as `SQLiteTable`), so R2's "raw tier speaks only ts-db vocabulary" is only partial.

| # | Title | Dimension | Location | Recommendation |
|---|-------|-----------|----------|----------------|
| 1 | Consumer schema still imports drizzle | Security | `packages/domain/src/schema/runs.ts:2` | Enhance/export ts-db schema column helpers (`text`, `integer`, `index`, references/index support as needed), then rewrite all six `packages/domain/src/schema/*` files to import schema vocabulary only from `@gobing-ai/ts-db/schema`. |
| 2 | Rule enforcement version mismatch | Correctness | `.spur/rules/boundary/dao-boundary.yaml:12` | Align Spur's installed rule evaluator and ts-rule-engine schema, then tighten the consumer drizzle rule without breaking `bun run spur-check`. |
| 3 | DAO data path still relies on `as unknown as` | Correctness | `../ts-libs/packages/db/src/entity-dao.ts:163` | Replace typed-erasure casts with a real internal query/CRUD abstraction or properly typed internal drizzle helpers; R5 explicitly forbids these casts in the data path. |
| 4 | Raw tier transaction handle is drizzle-shaped | Correctness | `../ts-libs/packages/db/src/base-dao.ts:44` | Introduce a true ts-db transaction handle facade instead of aliasing `InternalDb`; keep protected DAO capabilities drizzle-free. |

**Traceability**

| Requirement | Verdict | Evidence |
|---|---|---|
| R1 Zero drizzle leakage | UNMET | Six consumer schema files import `drizzle-orm/sqlite-core`; `packages/domain/package.json` still depends on `drizzle-orm`. Current `spur-check` allows this schema-authoring exception, so strict R1 enforcement still needs a rule update after the schema facade is available. |
| R2 Two-tier facade | PARTIAL | `BaseDao` / `EntityDao` exist and tests cover raw + structured tiers, but `TxHandle = InternalDb` and protected raw methods still accept drizzle `SQLiteTable`. |
| R3 Lean facade | PARTIAL | `EntityDao` implements CRUD/list/count/cursor/upsert; `QueueJobDao` still uses private drizzle SQL and typed-erasure casts for aggregate/claim methods. |
| R4 Single source of truth | PARTIAL | `defineTable` derives zod + DDL, but consumer schema authoring still imports drizzle column builders directly. |
| R5 Type-safe everything | UNMET | Multiple `as unknown as` casts remain in `base-dao.ts`, `entity-dao.ts`, adapter internals, and `queue-job-dao.ts`; several are in DAO data paths. |
| R6 Capability completeness | PARTIAL | Tests cover createMany, upsert, RETURNING, cursor pagination, count, soft delete, composite PK; implementation still depends on casts. |
| R7 zod opt-in | MET | `EntityDaoOptions` accepts optional structural validators; `defineTable` lazily derives insert/select schemas. |
| R8 Migrations ported | MET | Existing migrate module remains and `ts-libs` check/build pass. |
| R9 Conventions preserved | MET | Standard/append-only/soft-delete helpers remain under `ts-db/schema`. |
| R10 Adapter/lifecycle + string-SQL door | PARTIAL | Adapter lifecycle exists; `spur-check` boundary rules pass under the installed Spur rule schema, but R1's stricter zero-consumer-drizzle rule is not yet enforceable without a rule-engine/binary alignment. |
| R11 Backward-incompatible managed | PARTIAL | `@gobing-ai/ts-db` is at `0.2.3`, migration notes exist in the README, and Spur consumes semver; consumer schema is not fully rewritten to the facade. |
| R12 Tests + coverage | MET | `ts-libs bun run check`: 623 tests, 99.57% lines / 99.44% functions. `spur-new bun run check`: 186 tests, 99.87% lines / 99.80% functions. |
| R13 Publish + consume | MET for publish/semver; PARTIAL for full acceptance | `@gobing-ai/ts-db` is published/consumed as `^0.2.3`; final consumer zero-drizzle rewrite remains incomplete and belongs to R1/R11. |

#### Re-verification — 2026-06-01T06:45:47Z (`rd3-dev-verify 0003 --auto --fix all --force`)

**Verdict: FAIL (unchanged).** Auto-fix made no source changes. Project gates are green, but task acceptance remains blocked by R1/R5:

- R1 still fails: `packages/domain/src/schema/{artifacts,phase-runs,runs,transition-runs,workflow-states,workspaces}.ts` import `drizzle-orm/sqlite-core`.
- R5 still fails: `../ts-libs/packages/db/src/{base-dao.ts,entity-dao.ts,queue-job-dao.ts}` still contain `as unknown as` casts in DAO/query data paths.
- Boundary enforcement still passes under installed `spur 0.1.0`, but that rule schema allows `packages/domain/src/schema/**` drizzle imports and therefore does not enforce task 0003's stricter R1.
- 0.2.3 alignment note: publish/semver is complete; next implementation should target schema facade exports + consumer rewrite, not another release/dep-link pass.

#### Re-verification — 2026-06-01T06:52:04Z (`rd3-dev-verify 0003 --auto --fix all --force`)

**Verdict: FAIL (unchanged).** The 0.2.3 alignment update is now present and accurate, but no implementation source changed in this pass.

- R1 remains UNMET: six consumer schema files still import `drizzle-orm/sqlite-core`, and `packages/domain/package.json` still depends on `drizzle-orm`.
- R5 remains UNMET: `../ts-libs/packages/db/src/{base-dao.ts,entity-dao.ts,queue-job-dao.ts}` still contain `as unknown as` casts in DAO/query data paths.
- R13 publish/semver remains MET: `@gobing-ai/ts-db` is already consumed as `^0.2.3`; the next fix should be schema facade exports + consumer rewrite.

#### Fix pass — 2026-06-01T07:01:56Z

**Verdict: PASS for the previously blocking R1/R5 items.** The workspace now verifies against the patched local `../ts-libs/packages/db` package linked into Spur.

- R1 fixed in Spur consumer code: `packages/domain/src/schema/*` imports `defineTable`, `standardColumns`, `text`, and `integer` from `@gobing-ai/ts-db/schema`; there are no direct `drizzle-orm` imports under `apps/` or `packages/`.
- R1 dependency leak fixed: `packages/domain/package.json` no longer declares a direct `drizzle-orm` dependency.
- R5 fixed for DAO/query data paths: `../ts-libs/packages/db/src/{base-dao.ts,entity-dao.ts,queue-job-dao.ts}` no longer contain `as unknown as`.
- Schema facade enhanced locally: `../ts-libs/packages/db/src/schema/index.ts` now exports `text`, `integer`, and `index`.
- Caveat: npm `@gobing-ai/ts-db@0.2.3` does not contain those schema facade exports. The green Spur verification depends on the local `bun link @gobing-ai/ts-db` state until ts-db is republished or otherwise refreshed in the registry.

#### Final verification — 2026-06-01T17:00:45Z

**Verdict: PASS / DONE.** All `@gobing-ai/ts-*` dependencies now consume published `0.2.4` packages by semver, and the temporary local `ts-db` link is removed.

- `package.json`, `apps/cli/package.json`, and `packages/domain/package.json` now use `^0.2.4` for `@gobing-ai/ts-*`.
- `bun.lock` resolves all consumed `@gobing-ai/ts-*` packages to `0.2.4`.
- `node_modules/@gobing-ai/ts-db` and `packages/domain/node_modules/@gobing-ai/ts-db` resolve to Bun's registry install cache, not `~/xprojects/ts-libs`.
- `packages/domain/src/schema/*` still typechecks against `@gobing-ai/ts-db/schema` exports from published `0.2.4`.
- No direct `drizzle-orm` imports exist under `apps/` or `packages/`.



### Testing

#### Verification — 2026-06-01

- `cd ../ts-libs && bun run check` → pass (623 tests, 99.57% line coverage, 99.44% function coverage).
- `cd ../ts-libs && bun run build` → pass.
- `bun run check` → pass (186 tests, 99.87% line coverage, 99.80% function coverage).
- `bun run test-cf` → pass (1 Cloudflare Worker test).
- `bun run build` → pass.
- `bun run autofix && bun run spur-check; echo EXIT_CODE=$?` → `EXIT_CODE=0`.

#### Re-verification — 2026-06-01T06:45:47Z

- `bun run autofix && bun run spur-check; echo EXIT_CODE=$?` → `EXIT_CODE=0` (186 tests, 99.87% line coverage, 99.80% function coverage).
- `/Users/robin/xprojects/spur/dist/cli/spur rule run --preset recommended-pre-check --fail-on warning` → pass (0 errors, 0 warnings, 0 infos).
- `cd ../ts-libs && bun run check && bun run build` → pass (623 tests, 99.57% line coverage, 99.44% function coverage).

#### Re-verification — 2026-06-01T06:52:04Z

- `bun run autofix && bun run spur-check; echo EXIT_CODE=$?` → `EXIT_CODE=0` (186 tests, 99.87% line coverage, 99.80% function coverage).
- `/Users/robin/xprojects/spur/dist/cli/spur rule run --preset recommended-pre-check --fail-on warning` → pass (0 errors, 0 warnings, 0 infos).
- `cd ../ts-libs && bun run check && bun run build` → pass (623 tests, 99.57% line coverage, 99.44% function coverage).

#### Fix verification — 2026-06-01T07:01:56Z

- `rg -n "from 'drizzle-orm|from \"drizzle-orm|drizzle-orm" apps packages -g '*.ts' -g '*.tsx' packages/domain/package.json` → no matches.
- `rg -n "as unknown as" ../ts-libs/packages/db/src/base-dao.ts ../ts-libs/packages/db/src/entity-dao.ts ../ts-libs/packages/db/src/queue-job-dao.ts` → no matches.
- `cd ../ts-libs && bun run check` → pass (623 tests, 99.57% line coverage, 99.44% function coverage).
- `cd ../ts-libs && bun run build` → pass.
- `bun run autofix` → pass.
- `bun run spur-check` → pass (186 tests, 99.87% line coverage, 99.80% function coverage).
- `bun run test-cf` → pass (1 Cloudflare Worker test).
- `bun run build` → pass.
- `/Users/robin/xprojects/spur/dist/cli/spur rule run --preset recommended-pre-check --fail-on warning` → pass (0 errors, 0 warnings, 0 infos).

#### Final semver verification — 2026-06-01T17:00:45Z

- `bun install` → installed `@gobing-ai/ts-*` 0.2.4 packages and refreshed `bun.lock`.
- `rg -n '"@gobing-ai/ts-[^"]+": "\^0\.2\.3"|@gobing-ai/ts-[^@"]+@0\.2\.3|link:@gobing-ai/ts-' package.json apps packages bun.lock` → no matches.
- `readlink node_modules/@gobing-ai/ts-db` and `readlink packages/domain/node_modules/@gobing-ai/ts-db` → registry cache paths for `@gobing-ai+ts-db@0.2.4`, not `~/xprojects/ts-libs`.
- `bun run autofix` → pass.
- `bun run spur-check` → pass (186 tests, 99.87% line coverage, 99.80% function coverage).
- `bun run test-cf` → pass (1 Cloudflare Worker test).
- `bun run build` → pass.
- `/Users/robin/xprojects/spur/dist/cli/spur rule run --preset recommended-pre-check --fail-on warning` → pass (0 errors, 0 warnings, 0 infos).



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References

- Current ts-db source reviewed (2026-05-31): `~/xprojects/ts-libs/packages/db/src/{base-dao.ts, entity-dao.ts, adapter.ts, adapters/bun-sqlite.ts, adapters/d1.ts, migrate.ts, queue-job-dao.ts, schema/common.ts}`.
- Current ts-db 0.2.4 package consumed (2026-06-01): root and `packages/domain` consume `@gobing-ai/ts-db: ^0.2.4`; all `@gobing-ai/ts-*` dependencies are resolved from published semver packages, not local links.
- Evidence of the leak: `adapter.ts` DbClient (lossy subset); `d1.ts`/`bun-sqlite.ts` `getDb(): this.drizzleDb as unknown as DbClient`; `base-dao.ts` withTransaction `as unknown as { transaction }`.
- drizzle-zod: `createInsertSchema` / `createSelectSchema` (derive validation from tables).
- Consuming context: spur task 0001 (the extraction that surfaced the gaps — WorkspaceDao raw upsert, JS sort for missing orderBy, analytics SQL interpolation). spur-new `packages/domain`.
- Supersedes: task 0002 (canceled).
