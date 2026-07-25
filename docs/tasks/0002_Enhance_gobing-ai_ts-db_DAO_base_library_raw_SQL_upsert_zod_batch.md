---
name: "Enhance @gobing-ai/ts-db DAO base library (raw SQL, upsert, zod, batch)"
description: "Enhance @gobing-ai/ts-db DAO base library (raw SQL, upsert, zod, batch)"
status: cancelled
created_at: 2026-05-31T17:30:43.643Z
updated_at: 2026-05-31T18:34:45.914Z
folder: docs/tasks
type: task
feature-id: ""
dependencies: ["ts-libs parallel agent (owner/executor); spur-new link-to-semver follow-up (consumes after publish)"]
tags: ["ts-libs","ts-db","dao","enhancement","handoff","cross-repo"]
impl_progress:
  planning: pending
  design: pending
  implementation: pending
  review: pending
  testing: pending
---

## 0002. "Enhance @gobing-ai/ts-db DAO base library (raw SQL, upsert, zod, batch)"

### Background

Cross-repo handoff spec for the ts-libs agent (ts-libs is owned/executed by the parallel agent; this is the SPEC, spur-new consumes after publish). Supersedes the earlier "patch the BaseDao/EntityDao" framing — this is a from-scratch redesign of @gobing-ai/ts-db at the query/DAO surface, driven by three operator-stated goals.

**Primary goal (G1) — Decoupling facade.** ts-db is the anti-corruption layer between the application and its DB dependency (drizzle-orm). Application/package code must depend ONLY on ts-db vocabulary, NEVER on drizzle directly — so drizzle can be swapped (or Postgres added) by changing ts-db internals, not call sites. A consumer `grep -r "drizzle" apps/ packages/` must return NOTHING.

**Secondary goal (G2) — Single source of truth.** A table is defined ONCE; zod validation and migrations are DERIVED from it (drizzle-zod + the existing migrate module), never re-authored in parallel with different tools. Kills schema/validation/migration drift.

**Tertiary goal (G3) — Two-tier mental model.** A clean, unified split between STRUCTURED operations (typed CRUD over an entity) and RAW operations (escape hatch for ETL/complex), user's choice which tier — but BOTH speak ts-db's vocabulary, never leak drizzle.

**Why redesign, not patch.** Read of current ts-db (2026-05-31): the library's intent is right but its execution LEAKS. `DbClient` (adapter.ts, 109 lines) re-declares a lossy SUBSET of drizzle's builder, then `getDb()` does `this.drizzleDb as unknown as DbClient` (throws away types); raw SQL escapes to DbAdapter OUTSIDE the DAO abstraction; `withTransaction` reaches `.transaction()` via `as unknown as` because DbClient never declared it. The leaks ARE the bugs. The fix is to COMPLETE the facade (full, drizzle-free, no casts), not remove it. Earlier idea of exposing `db.client: DrizzleDatabase` is REJECTED — it violates G1 (sprays drizzle everywhere).


### Requirements

DECIDED (operator, 2026-05-31): full from-scratch redesign; lean facade; zero drizzle imports in consumers; breaking change → 0.2.0.

- R1 (Zero drizzle leakage, G1): No `from 'drizzle-orm'` import anywhere outside ts-db itself. ts-db re-surfaces every capability consumers need in its OWN signatures. The drizzle `sql\`\`` tag is NOT exposed to consumers. A spur rule forbids drizzle imports in apps/ + packages/ (validated against /Users/robin/xprojects/spur/dist/cli/spur).
- R2 (Two-tier facade, G3): BaseDao = RAW tier (generic, table-agnostic): `query<T>(spec)`, `one<T>(spec)`, `exec(spec)`, `tx<T>(fn)` — all drizzle-free signatures; the callback in `tx` receives a ts-db tx handle, not a drizzle tx. EntityDao extends BaseDao = STRUCTURED tier (typed CRUD over one table). ETL/analytics/reporting DAOs extend BaseDao DIRECTLY (no EntityTable contract). This is option-B layering with ts-db-native (not drizzle pass-through) signatures.
- R3 (Lean facade, no second ORM): STRUCTURED tier = create / createMany / upsert / findById / findBy / findAllBy / update / delete / list({where, orderBy, cursor, limit, offset}) / count. `where`/`orderBy` use a SMALL ts-db predicate spec (eq/in/gte/gt/lte/lt/like/isNull over column refs) + order spec — enough for the 90%, NOT a full query builder. Anything beyond (joins, aggregates, window fns) = a NAMED method on a specific DAO whose body uses drizzle privately. Do NOT expose a query-builder DSL.
- R4 (Single source of truth, G2): A table is authored ONCE (ts-db column/table helpers over sqliteTable + standardColumns). From it, DERIVE: (a) zod insert/select schemas via drizzle-zod (internal), (b) migration SQL via the existing migrate module, (c) EntityDao<typeof table> types. No parallel re-authoring.
- R5 (Type-safe everything): No `as unknown as` casts in the data path. The internal drizzle db is fully typed end-to-end inside ts-db; only the PUBLIC surface is the ts-db facade.
- R6 (Capability completeness — the gaps from spur 0001): upsert (onConflictDoUpdate, internal), createMany (single multi-VALUES batch), RETURNING-based create/update/upsert (not JS-constructed rows), orderBy in list, cursor/keyset pagination (reuse ts-utils cursor), composite-PK support. All exposed as ts-db methods, drizzle hidden.
- R7 (zod opt-in, boundary-scoped, G2): drizzle-zod schemas derived from tables; validation is OPT-IN per DAO and intended for trust boundaries (e.g. JSONL importer parsing untrusted files), NOT pervasive on internal writes. zod stays a peer/optional dep.
- R8 (Migrations — port, do NOT redesign): keep the current migrate module (file-based + embedded + journal) essentially as-is. The redesign is the query/DAO surface, not migrations.
- R9 (Conventions preserved): standardColumns, appendOnlyColumns, soft-delete column + auto-filter, nowTimestamp, id generator — keep as drizzle-native helpers composed into tables.
- R10 (Adapter/lifecycle): keep createDbAdapter (driver select + pragmas + schema attach) + migrate + close. The string-SQL escape (exec/run for DDL/dynamic identifiers like history_etl_${source}) stays on the adapter, DAO-gated by the spur rule — the ONLY place raw string SQL is allowed.
- R11 (Backward-incompatible, managed): 0.2.0. EntityDao/BaseDao public API changes (signatures become drizzle-free). Provide a migration note for consumers. spur-new packages/domain (6 DAOs from task 0001) will be rewritten to the new facade as part of consuming it.
- R12 (Tests + coverage): TDD, 90%+ per ts-libs convention; both backends (bun:sqlite + D1 where feasible); cover the predicate spec, cursor pagination, upsert, batch, tx, soft-delete.
- R13 (Publish): semver 0.2.0 → npm; spur-new switches link: → semver (coordinate with the link-to-semver follow-up).


### Q&A



### Design

### The facade contract (G1)

Consumer code imports ONLY `@gobing-ai/ts-db`. `import ... from 'drizzle-orm'` is forbidden outside ts-db (spur rule). drizzle is an internal impl detail.

### Public surface (sketch — implementer refines against drizzle 0.38+)

```ts
// ── construction / lifecycle (keep, refine) ──
const adapter = await createDbAdapter({ driver: 'bun-sqlite', url, pragmas?, schema });
//   adapter.migrate(opts?)  adapter.close()
//   adapter.exec(sql)/run(sql,...p)  ← string-SQL escape: DDL / dynamic identifiers ONLY, DAO-gated

// ── tier 1: BaseDao (RAW, generic, drizzle-free signatures) ──
abstract class BaseDao {
  protected constructor(adapter: DbAdapter);
  protected now(): number;
  protected tx<T>(fn: (h: TxHandle) => Promise<T>): Promise<T>;   // ts-db tx handle, NOT drizzle tx
  // raw tier speaks a ts-db query spec, never drizzle sql``:
  protected query<T>(spec: QuerySpec): Promise<T[]>;
  protected one<T>(spec: QuerySpec): Promise<T | undefined>;
  protected exec(spec: WriteSpec): Promise<void>;
}

// ── tier 2: EntityDao (STRUCTURED CRUD, extends BaseDao) ──
class EntityDao<TTable, TPK> extends BaseDao {
  create(data): Promise<Row>;                 // RETURNING
  createMany(rows[]): Promise<Row[]>;         // single multi-VALUES
  upsert(data, conflict): Promise<Row>;       // onConflictDoUpdate (internal)
  findById/findBy/findAllBy/findAll;
  update(id, data): Promise<Row>;             // RETURNING
  delete(id, soft?);
  list(opts: ListSpec): Promise<Row[]>;       // where + orderBy + cursor|offset + limit
  listByCursor(opts): Promise<{ rows, nextCursor }>;
  count(where?: Predicate): Promise<number>;
}

// ── the SMALL predicate/order spec (the bounded re-surface, R3) ──
type Predicate =                              // enough for the 90%, NOT a builder
  | { col: ColRef; op: 'eq'|'ne'|'gt'|'gte'|'lt'|'lte'|'like'; value: unknown }
  | { col: ColRef; op: 'in'; values: unknown[] }
  | { col: ColRef; op: 'isNull'|'isNotNull' }
  | { and: Predicate[] } | { or: Predicate[] };
type ListSpec = { where?: Predicate; orderBy?: { col: ColRef; dir?: 'asc'|'desc' }[]; limit?; offset?; cursor?; includeDeleted? };

// ── single source of truth (G2) ──
export const users = defineTable('users', { id: id(), email: text().unique(), ...standardColumns });
//   → drizzle-zod schemas (internal), migration SQL (migrate module), EntityDao<typeof users> types
//   ALL derived from this one definition.

// ── ETL / complex: extend BaseDao, named methods, drizzle hidden in body ──
class HistoryAnalyticsDao extends BaseDao {
  costsByModel(since: string) { return this.query<...>({ /* ts-db spec or, if truly complex, a private drizzle call confined here */ }); }
}
```

### Facade boundary rule (spur rule, R1)

```
forbid: import ... from 'drizzle-orm'   in   apps/** , packages/**   (outside ts-db)
forbid: adapter string-SQL (exec/run/queryFirst/queryAll)   outside **/dao/** | **/*-dao.ts
allow:  ts-db facade (createDbAdapter, BaseDao, EntityDao, defineTable, predicates) everywhere
```
Re-points the 0001 boundary rule from "@gobing-ai/ts-db only in packages/domain" to "drizzle-orm never in consumers; raw tier only in DAOs."

### Acceptance criteria

- [ ] `grep -rn "from 'drizzle-orm'" apps/ packages/` in spur-new → ZERO hits (G1).
- [ ] An ETL DAO extends BaseDao and runs parameterized raw queries + transactions with drizzle-free signatures, no EntityTable.
- [ ] EntityDao: upsert, createMany, RETURNING create/update, list(where+orderBy+cursor), count — all via the predicate spec, no drizzle in the call.
- [ ] One table definition derives zod + migration + types (no parallel re-authoring).
- [ ] No `as unknown as` in the data path.
- [ ] Migrations module ported, unchanged behavior; both backends green.
- [ ] spur rule forbids drizzle imports in consumers; validates against /Users/robin/xprojects/spur/dist/cli/spur.
- [ ] ts-libs `bun run check` green, 90%+ coverage.
- [ ] Published 0.2.0; spur-new packages/domain rewritten to the facade; link: → semver.

### Decisions log (operator, 2026-05-31)

- Full from-scratch redesign (not incremental patch).
- Lean facade (CRUD + small predicate spec; complex = named DAO methods). NOT a query-builder DSL.
- Zero drizzle imports in consumers; spur-rule enforced.
- Keep BaseDao+EntityDao two-tier (it IS the facade, G3). Keep migrations (port). zod opt-in/boundary-only.

### Open implementation choices (ts-libs agent decides with full context)

- Exact predicate-spec ergonomics (object literals vs tiny builder fns like `eq('email', x)`) — keep minimal.
- `defineTable` thin-wrapper vs raw `sqliteTable` + documented helper convention — pick whichever keeps G2 with least magic.
- Whether truly-complex named methods may use a private drizzle call internally (confined to ts-db or to a DAO body) vs must go through the ts-db spec — recommend: confined private drizzle is acceptable INSIDE a named DAO method, since it does not leak to app code.


### Raw SQL policy (R2/R3/R12)

| Path | When | Where allowed |
|------|------|---------------|
| `this.all/get/run(sql\`...\`)` (drizzle tag) | parameterized queries, complex WHERE, aggregates | any DAO method (BaseDao or EntityDao subclass) |
| `this.execSql / queryAllSql / queryFirstSql` (string) | DDL, migrations, dynamic identifiers | DAO files only — spur rule forbids elsewhere |

spur rule: forbid `adapter.run|exec|queryFirst|queryAll` and string-SQL literals outside `**/dao/**` / `**/*-dao.ts`; allow the `sql\`\`` tag freely.

### Acceptance criteria

- [ ] BaseDao exposes raw (sql-tag) + type-safe withTransaction; DbClient declares .transaction(); no `as unknown as` cast remains.
- [ ] An ETL DAO can `extends BaseDao` and run raw parameterized SQL + transactions with zero EntityTable requirement.
- [ ] EntityDao: upsert, createMany, returning-based create/update, list orderBy, cursor list, (composite-PK or documented BaseDao escape).
- [ ] drizzle-zod validation available and opt-in (zod stays peer/optional).
- [ ] Backward compatible: QueueJobDao + all spur-new DAOs unchanged and green.
- [ ] spur rule gates string-SQL to DAO files; validates against /Users/robin/xprojects/spur/dist/cli/spur.
- [ ] ts-libs `bun run check` green, 90%+ coverage, both backends covered where feasible.
- [ ] Published to npm (semver bump) → spur-new switches link: → semver.

### Options considered (for the record)

- **Approach 1 (SELECTED):** raw/tx on BaseDao, CRUD on EntityDao. Correct generic↓base / specific↓derived layering; preserves non-entity seam.
- Option A (merge): rejected — deletes the non-entity DAO seam ETL needs.
- Option B (CRUD→BaseDao, raw→EntityDao): rejected — inverts layering; BaseDao would need table identity → becomes EntityDao.
- Mixins (Transactional/RawQueryable/Crud): parked — verbose, overkill at current DAO count (R2 simplicity).
- Repository + UnitOfWork: deferred — premature for single-process local-first SQLite; revisit if multi-aggregate transactional workflows appear.

### Industry best practice (this stack: bun:sqlite/D1 + drizzle + zod)

1. Typed query builder for the 90%; `sql\`\`` tag for the parameterized 10%; raw string SQL only behind a DAO + lint gate.
2. `INSERT/UPDATE ... RETURNING` over JS-constructed return objects (avoids drift from DB defaults/triggers; supported on both backends).
3. drizzle-zod (`createInsertSchema`/`createSelectSchema`) for boundary validation — derive from the table, don't hand-maintain.
4. Multi-VALUES batch insert for ETL (one statement; bun:sqlite prepared-stmt cache already present).
5. Keyset/cursor pagination for large scans; offset only for small bounded lists.
6. WAL + `foreign_keys=ON` pragmas (already defaulted in the bun-sqlite adapter — good).


### Solution

Superseded by task 0003 (Redesign @gobing-ai/ts-db as a decoupling facade). Recreated with an accurate title/filename and consolidated, debris-free content. Do not implement this task.


### Plan



### Review



### Testing



### Artifacts

| Type | Path | Agent | Date |
| ---- | ---- | ----- | ---- |

### References


