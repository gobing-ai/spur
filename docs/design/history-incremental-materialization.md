# History Incremental Materialization — Refresh Watermark, Bucket-Scoped Rollups, and Precomputed Serving

**Feature:** E91 · **ADR:** ADR-103 · **Status:** implemented (0741 incremental refresh; 0763 bounded derivations)

Companion to [`history-data-processing.md`](history-data-processing.md), which describes the
ingestion/materialization/serving planes as built. This satellite describes only what E91 changes:
how the rollup refresh becomes incremental, how freshness stops being global, and what moves from
per-request aggregation into materialization.

---

## 1. Problem statement (measured, 2026-09-03)

Corpus: `history_message` 1,790,369 rows / 1707 MB; `history_tool_call` 494 K / 309 MB;
`history_import_ledger` 2,283,342 rows / 831 MB incl. autoindex; database 4.2 GB.

| Symptom | Measurement | Location |
| --- | --- | --- |
| Rollup refresh aborts | `no such table: history_skill_call` after 43.9 s — stale importer (0.4.51 vs locked 0.4.54) | `history-board-rollup.ts:266` |
| Full-rebuild ETL | 43.9 s over whole corpus, on every import | `history-analysis-service.ts:44-75` |
| Global freshness invalidation | one imported line invalidates all 12 tables | `history-board-rollup.ts:245` |
| Raw fallback — sessions | 2.30 s | `forensic-query.ts:380` |
| Raw fallback — tools | 4.17 s | `forensic-query.ts:294,320` |
| Raw fallback — tool sequence | 1.29 s | `forensic-query.ts:1857` |
| Summary read amplification | ~12 aggregates per request | `history-board-service.ts:514` |
| Rollup read (for contrast) | 0.001 s point read; 0.087–0.112 s re-`GROUP BY` | `history-board-rollup.ts:713` |

Two facts shape every decision below:

1. **The rollup layer is currently inert.** Because `refreshHistoryRollups` throws, `replaceHistoryBoardRollups` never commits, so every tab serves from the raw fallback.
2. **Re-aggregating the 5-minute rollups is already fast enough** (0.09–0.11 s). The cost that matters is the *full-corpus rebuild* and the *freshness cliff*, not the per-request `GROUP BY` over materialized rows. This bounds how much new materialization is worth building.

---

## 2. The data model this design assumes: three facts, everything else is a mart

| Layer | Tables | Property |
| --- | --- | --- |
| Raw landing | `history_etl_*` (10, created dynamically by the importer DAO) | Source-shaped, per-agent; not queried by the board |
| **Core facts** | **`history_message`, `history_tool_call`, `history_skill_call`** | One row per message / tool call / skill call, with full provenance (`record_hash`, `source_file`, `source_line`, `session_id`, `seq`, `imported_at`) |
| Derived marts | 12 `history_board_*`, `history_daily_stats` | Rebuildable from facts; disposable by definition |

The provenance columns are what make this hold: any mart can be dropped and rebuilt from the facts,
so a mart is never a source of truth and a bug in one is never data loss.

Consequences this design is bound by:

- Incremental ETL reads **facts**, writes **marts** — never the reverse.
- New insight work adds marts. It never adds a second source of truth, and it never denormalizes a
  fact into a mart that then gets written back.
- Columns that describe an event's identity (D7: `effective_tool_name`, `tool_name_alias`) belong on
  the **fact**, computed once at import, not recomputed per query in each mart.

---

## 3. D1 — `history_skill_call` is correct; the defect is dependency version skew

`skillCallRollup()` reads `FROM history_skill_call` and the refresh aborts with
`no such table`. The table is **not** phantom and its design is **not** in question.

Its DDL lives in the importer package, not in Spur's drizzle migrations — which is why a search of
`drizzle/` and `packages/domain/` finds nothing:

```
/Users/robin/xprojects/ts-libs/packages/llm-jsonl-importer/src/schema-sql.ts:89
    CREATE TABLE IF NOT EXISTS history_skill_call ( … )
    + idx_history_skill_call_{session,skill_name,message_hash,invocation_kind}
```

Task **0735** froze that DDL deliberately (`HISTORY_IMPORT_SCHEMA_SQL`, applied lazily and
idempotently at import time, R5/R6), **0736** wired per-agent extraction into the seven split
functions plus the OpenCode path, and **0737** built the Summary breakdown on top. All three are
`done` under **E9** — feature L's scope was moved under E9, not dropped.

**Root cause.** The Spur workspace resolves a build of the importer that predates 0735:

| Package | Catalog / lock | Installed |
| --- | --- | --- |
| `@gobing-ai/ts-llm-jsonl-importer` | `^0.4.54` / `0.4.54` | **0.4.51** |
| `@gobing-ai/ts-db` | `^0.4.54` | **0.4.51** |
| `@gobing-ai/ts-ai-runner` | `^0.4.54` | **0.4.51** |

`bun.lock` already pins `0.4.54`; `node_modules` holds `0.4.51` for the whole `ts-*` set. `bun install`
was never re-run after the catalog bump, so the importer in use has no `history_skill_call` in its
schema, never creates the table, and never emits skill rows into it.

**Decision.** Keep `history_skill_call`, keep `skillCallRollup()` reading from it, keep the
`HISTORY_RESET_TABLES` entry. Resync the workspace to the locked `0.4.54` set and re-run an import so
the additive schema is applied. No schema change, no rewrite of the skill path.

**Why this matters beyond one table.** The failure was invisible for a full release cycle: three
tasks verified green against a source tree whose runtime dependency was three patch versions behind,
and the only symptom was an empty `history_board_skill_5m` and a rollup refresh that silently threw
44 s in. The guard therefore has two parts:

1. **Schema guard (AC R2).** Assert every table the rollup refresh reads exists in the
   *importer-applied* schema — not just in Spur's migrations — so a missing upstream table fails a
   test instead of a production refresh.
2. **Dependency drift guard.** Assert installed `@gobing-ai/ts-*` versions match the lockfile at
   check time, so a stale `node_modules` cannot present as a schema bug again.

**Rejected alternative** (proposed in the first design pass, corrected here): deriving the skill
rollup from `history_tool_call` via `HISTORY_SKILL_NAME_SQL`. It looked lazier, but it is strictly
worse — that expression only recovers skill calls that surface as tool calls, which is the *Claude
Code / OMP* signature. 0736's L0/L1/L2 detection layers exist precisely because pi inlines
`<skill name=… location=…>` into user-message text, codex uses `$sp-` prompts with `<skill>` blocks,
Antigravity surfaces `view_file` on a skill path, and Grok surfaces `read_file` on `SKILL.md`. A
tool-call-derived rollup would silently lose five of the eight sources. `history_skill_call` is the
normalized home that makes those comparable; re-deriving from tool calls would rebuild a worse
version of it at query time.

---

## 4. D2 — The refresh watermark is a new concept, distinct from `watermark.ts`

`packages/domain/src/analytics/watermark.ts` is a **turn-completeness** watermark: it excludes the
trailing partial turn of a still-appending session (task 0550/0576). It answers *"which rows are
complete?"*. It does **not** answer *"which rows are new?"*, and reusing it for incrementality would
silently conflate the two.

**Decision.** Introduce a separate **refresh watermark** — the high-water mark of
`history_message.imported_at` (and `history_tool_call.imported_at`) already materialized. The two
compose orthogonally on every incremental pass:

```
candidate rows = imported_at > refresh_watermark      (novelty — new)
               AND turn-complete per watermark.ts     (completeness — existing)
```

Persisted in `history_board_rollup_meta` alongside the existing history version.

**Index required:** `history_message` has no index on `imported_at`
(`history_tool_call(source, imported_at)` already exists). Add
`idx_history_message_imported_at`.

---

## 5. D3 — The incremental unit is the bucket, not the row

Rollup tables are keyed by `bucket_start`. A new import can carry **old** `ts` values (backfill of a
previously unimported session), so "append the new rows" is wrong; the affected buckets must be
recomputed from scratch.

```
1. affected := SELECT DISTINCT bucket_of(ts) FROM history_message
               WHERE imported_at > :refresh_watermark
2. for each rollup table: DELETE WHERE bucket_start IN affected
3. re-derive those buckets with the existing analyzer SQL, selector bounded to affected range
4. INSERT; advance refresh_watermark in the same transaction
```

Cost is proportional to affected buckets, not to corpus size — the property AC R3 asserts.

**Table classes.**

| Class | Tables | Incremental strategy |
| --- | --- | --- |
| Bucketed | `history_board_message_5m`, `history_board_tool_5m`, `history_board_skill_5m`, `history_daily_stats`, `history_board_source_daily` | Bucket-scoped delete + re-derive (above) |
| Keyed aggregate | `history_board_session_stats`, `history_board_source_stats`, `history_board_model_stats`, `history_board_tool_stats`, `history_board_loop_findings` | Delete + re-derive by affected key set (session ids / sources / models / tools touched since the watermark). Loop findings join this class because its grouping key contains `session_id` (0763) — a keyed aggregate, not a ranking. |
| Global ranked | `history_board_ranked_steps` | Index-ordered top-N: the three rank indexes (`idx_history_message_{duration,token,input}_rank`) serve the `ORDER BY … DESC LIMIT` in index order for unfiltered selectors via `rankOrderExpr`/`selectorIsUnfiltered`; filtered selectors keep the selective `(source, ts)` index (0763 R2/R7). |

*Correction (0763, 2026-09-04):* the original design classified loop findings with ranked steps as a
"global ranked" class rebuilt in full each pass. Premise verification split them: loop findings is a
keyed aggregate over sessions (its grouping key carries `session_id`) and reuses `deltaSessionScope`;
ranked steps is a genuine top-N whose exact bounded path is the three rank indexes a unary `+` was
defeating. Neither class scans the whole corpus — the earlier "honest limit" (ranked steps still cost
a full pass) is superseded.

*Re-audit correction (0763, definition v4):* an explicit empty eligible-session scope is a no-op;
only a `null` scope selects the documented whole-corpus fallback. `history_board_source_daily` is
driven by the raw source/day set and left-joins analyzed message/tool measures, so a source/day is
preserved even when request-id dedup removes its only analyzed message.

---

## 6. D4 — Why incremental aggregates equal a full rebuild (dedup invariant)

`MESSAGE_DEDUP` (`history-board-rollup.ts:17`) keeps, per `request_id`, the row with the **lowest
`rowid`**:

```sql
(m.request_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM history_message o WHERE o.request_id = m.request_id AND o.rowid < m.rowid))
```

Imports only ever append, so a newly imported duplicate always has a **higher** rowid than the row
already materialized. It is therefore always the *loser* — it can never displace a row a previous
pass already counted. **Consequence: a materialized bucket is stable under append**, and the
late-arrival case that AC R5 names resolves to "the new row is excluded", not "the bucket must be
retroactively corrected".

**Invariant this depends on:** rowid monotonicity under append. It holds today because the only
deletion path is a full `resetHistoryTables` wipe. If partial deletion is ever introduced, SQLite
may reuse freed rowids and the invariant breaks. The dedup tiebreaker is therefore documented as
**append-ordered**, and a regression test asserts a late duplicate does not change an already
materialized bucket. If partial deletes land, the tiebreaker moves to
`(imported_at, source_file, source_line)`, which is reuse-immune.

---

## 7. D5 — Freshness stops being a single global hash

Today `historyBoardHistoryVersion` is
`v2:checkpoint:<MAX(updated_at)>:<COUNT(*)>:<SUM(last_imported_line)>` over
`history_import_checkpoint`, and `historyBoardRollupsFresh` compares it to one stored value. Any new
line flips every table to stale at once — verified live: meta `…06:02:23.251Z:18309:1789383` vs
current `…06:46:05.795Z:18323:1790369`.

**Decision.** `history_board_rollup_meta` becomes per-table rows carrying the refresh watermark and
the **materialized bucket range** (`max_bucket_start`). A read is served from rollups when the
range it requests is covered by that table's materialized range; only requests reaching into
not-yet-materialized buckets take the fallback. A new import therefore degrades the *newest* slice
of the newest tab, not the whole board.

**De-risking fallback.** If per-table meta proves too invasive for one release, the smaller change
is bounded staleness: keep the global key but serve rollups when the gap is under a configured
threshold, reporting the staleness through the existing response freshness fields. This is strictly
weaker (a stale window instead of an accurate one) and is the fallback, not the target.

The existing `skillBreakdown.fresh` / response freshness fields are the reporting channel — no DTO
change (AC R14).

---

## 8. D6 — Materialize what Summary always asks for, and no more

`computeSummaryExtras` (`history-board-service.ts:514`) issues, on every Summary request regardless
of the requested dimension: four dimension series (model/source/tool/skill), a KPI trend, previous-
window KPIs, and a skill breakdown. `SummaryTab.tsx:354-430` genuinely consumes all four, so the
fan-out is required by the UI — which is exactly why it belongs in materialization.

**Decision — two new tables, not six.** The 5-minute tables already answer every dimension in
0.09–0.11 s. That is acceptable for short ranges; it is *not* acceptable for `30d`/`all`, where the
same query re-groups the full 104 K + 140 K bucket rows.

| New object | Grain | Serves |
| --- | --- | --- |
| `history_board_dimension_daily` | day × dimension × key × source | The four dimension series for ranges ≥ 7d |
| `history_board_kpi_window` | day | KPI trend points and previous-window KPI totals |

**Routing cut line.** Ranges ≥ 7d and bucket `1d` route to the day-grain tables. Shorter ranges and
sub-day buckets keep re-aggregating the 5-minute tables. Filter combinations outside
`{unfiltered, source-filtered}` fall back to the 5-minute path. Nothing falls back to
`history_message` / `history_tool_call` (AC R8).

**Rejected:** materializing every `filter × bucket × dimension` combination. It is combinatorial,
and the measured 0.09 s fallback makes the tail worthless to precompute.

---

## 9. D7 — Tool identity is two columns, not one: extraction and canonicalization

`EFFECTIVE_TOOL_NAME_SQL` (`history-board-rollup.ts:27`) is an 11-branch `CASE` over
`json_extract(tc.args_raw, …)` plus `call_id` prefix matching, evaluated per row per query (twice in
`byTool`), and unindexable because it is an expression over JSON.

Measurement first: removing the double evaluation is worth **0.5 %** (4.152 s vs 4.171 s). The scan
and join dominate, so **no latency claim is made here**. These are correctness and groupability
fixes.

Two distinct problems live under "tool name", and collapsing them loses one:

| Column | Problem class | Example |
| --- | --- | --- |
| `effective_tool_name` | **Extraction** — recover the real name when `tool_name` is a wrapper or empty | `call_bash_xyz` → `bash`; 19,429 empty `tool_name` rows |
| `tool_name_alias` | **Canonicalization** — group the same logical tool across coding agents | `bash` / `Bash` / `shell` / `exec` / `exec_command` / `run_command` / `run_terminal_command` → `shell` |

They compose in one direction: **extract, then canonicalize.**

### 8.1 `effective_tool_name` (extraction)

Persist at import, index, and point both the Summary top-tools path and `toolSequenceQuery` at it.
This fixes a live consistency defect: `toolSequenceQuery` (`forensic-query.ts:1857`) filters raw
`tc.tool_name` while Summary uses the effective name, so a tool picked from the Summary list can
match nothing in Tool Using. Backfill by migration.

### 8.2 `tool_name_alias` (canonicalization)

`history_tool_call` carries **256 distinct `tool_name` values**. The shell family alone spans nine
`(source, tool_name)` pairs across eight agents and ~233 K calls:

```
pi|bash 80572 · omp|bash 47258 · codex|exec_command 32737 · agy|run_command 22179
claude|Bash 17965 · codex|exec 17495 · grok|run_terminal_command 10842
opencode|bash 2730 · codex|shell 1077
```

Cross-agent tool breakdowns are therefore not comparable today: the same capability is counted under
eight different names, so any "which tool dominates" answer is really "which agent was busiest".

**Decision — build the structure now, defer the mapping.**

- `history_tool_call.tool_name_alias` (TEXT NOT NULL), **defaulting to the row's
  `effective_tool_name`** — identity by default, so nothing changes behaviorally on day one.
- Indexed for grouping; the rollups gain the alias so breakdowns can group by it without touching
  facts.
- One resolution seam — `packages/domain/src/analytics/tool-alias.ts` — with a single mapping table
  that starts effectively empty and falls through to identity. Fine-tuning later means adding
  entries plus a refresh, not changing query code. The seam is a write/read/select triple rather
  than a scalar function, because resolution has to happen in SQL where the grouping happens:
  `applyToolAliases(db)` recomputes `tool_name_alias` from the map before every rollup refresh —
  on the incremental path scoped to the union of already materialized sources and sources first seen
  in the message delta, plus the per-source `imported_at` range (`{ sources, since }`, 0763 R5), on
  the full-rebuild path a guarded whole-table update,
  `ALIASED_TOOL_NAME_SQL` reads the persisted result in the rollup inserts, and
  `toolSelectionSql(tc, placeholders)` lets a drill-down match a selection that named either the
  alias or the effective name.
- Backfill migration sets `tool_name_alias = effective_tool_name` for the existing corpus.

**Explicitly not decided here:** the alias vocabulary itself (`shell` vs `bash` vs `exec` as the
canonical label). Naming the vocabulary is a separate, reversible decision once the structure exists;
committing to it now would freeze a taxonomy nobody has reviewed.

---

## 10. D8 — The UI-unchanged constraint is a gate, not a promise

The operator's constraint ("keep the UI no changes") is enforced mechanically, not by review
attention:

- `apps/web/src/modules/history/` — zero changed lines (14 files, 7,699 lines).
- `packages/contracts/src/history.ts` — zero changed lines (702 lines, 7 endpoints).

Both are diff assertions runnable in CI (AC R11). Any change that requires touching either file is
out of scope by construction and must come back through design.

---

## 11. D9 — DDL authority is split across two repos, and that is the defect class

D1's incident is one instance of a structural problem. Ownership of the `history_*` schema today:

| DDL authority | Tables |
| --- | --- |
| `@gobing-ai/ts-llm-jsonl-importer` (`src/schema-sql.ts`) | `history_message`, `history_tool_call`, `history_skill_call`, `history_import_checkpoint`, `history_import_ledger` |
| Spur `drizzle/` + `packages/domain/src/migrations.ts` | 12 `history_board_*`, `history_daily_stats`, `history_run_session` (`migrations.ts:146`), `history_task_session` |
| Importer, dynamically at runtime | `history_etl_*` (10 tables, `jsonl-importer-dao.ts:106`) |

**Spur already acts as owner for everything except `CREATE TABLE`.** Eight Spur migrations mutate
upstream-owned tables: `ALTER TABLE` in 0024, 0025, 0026; `CREATE INDEX` in 0009, 0020, 0022, 0029,
0030.

**Evidence the split is already costing us — `request_id` is defined twice:**

- upstream, inline in the CREATE (`schema-sql.ts:52`)
- downstream, `ALTER TABLE history_message ADD COLUMN request_id TEXT` (Spur migration `0018`)

The two do not collide only because Spur carries an `addColumnIfMissing` guard — a drift-tolerance
mechanism that exists *because* authority is split.

**The general failure mode.** `CREATE TABLE IF NOT EXISTS` upstream, against an already-existing
database, means **new upstream columns are silently never applied** — the table exists, so the
statement no-ops. A whole missing table (our incident) is the loud version; a missing column is the
quiet one. Neither is visible to Spur: an upstream schema change leaves no entry in Spur's migration
ledger and carries no version Spur can compare against.

**Decision.** Spur's migration ledger becomes the single DDL authority and the single ordering for
the history schema. The importer keeps its DDL so it remains usable standalone, but in Spur's context
`HISTORY_IMPORT_SCHEMA_SQL` is applied as an **input to a versioned migration step**, not as an
implicit side-effect of the next import. That yields one ordering, one recorded version, and drift
detection, without breaking other consumers of the library.

Paired with the D1 guards (R2 schema assertion, R17 dependency drift), this closes the class rather
than the instance.

**Ownership itself is decided by ADR-105** on three axes — table DDL by layer, fact columns by value
producer, indexes by query consumer. Under that rule Spur's twelve board-query indexes (migrations
0009, 0020, 0022, 0029, 0030) are correctly Spur's, and three columns are misplaced:
`history_import_checkpoint.source_size` / `.source_mtime_ms` (0024/0025) and
`history_message.duration_source` (0026) all move upstream. The repatriation, the
`HISTORY_IMPORT_SCHEMA_VERSION` export, and the source-table registry are **feature E92**, not E91;
E91 depends on E92 only for the version constant that R2/R18 compare against.

---

## 12. D10 — One additive measure vector, defined once and reused everywhere

Today each of the twelve rollup tables picked its own measure subset, so what is answerable depends
on which table happens to hold the dimension:

| Table | msgs | tools | skills | fresh | c_read | c_write | out | dur | samples |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `history_daily_stats` | Y | Y | — | Y | Y | **—** | Y | Y | **—** |
| `history_board_message_5m` | Y | — | — | Y | Y | **—** | Y | Y | Y |
| `history_board_tool_5m` | — | Y | dim | REAL | REAL | **—** | REAL | Y | — |
| `history_board_skill_5m` | — | — | Y | — | — | — | — | — | — |
| `history_board_session_stats` | Y | Y | — | Y | Y | **—** | Y | Y | **—** |
| `history_board_model_stats` | — | Y | — | Y | Y | **—** | Y | Y | Y |
| `history_board_source_stats` | Y | Y | — | Y | Y | **—** | Y | — | — |
| `history_board_source_daily` | — | Y | — | Y | Y | **—** | Y | — | — |
| `history_board_tool_stats` | — | Y | dim | — | — | — | — | — | — |

**Decision.** Define one measure vector, materialize it on the dimension-grain tables from D6, and
derive every ratio at read time.

### 12.1 The vector

| Measure | Type | Note |
| --- | --- | --- |
| `messages` | INTEGER | |
| `tool_calls` | INTEGER | |
| `skill_calls` | INTEGER | Currently has no home outside `history_board_skill_5m` |
| `fresh_input_tokens` | INTEGER | |
| `cache_read_tokens` | INTEGER | |
| `cache_write_tokens` | INTEGER | **Absent from all twelve tables today** |
| `output_tokens` | INTEGER | |
| `duration_ms` | INTEGER | Assistant-step duration |
| `duration_samples` | INTEGER | Denominator for `duration_ms` |

### 12.2 Cache write is a separate measure, not part of "cached"

`history_message` carries both `cache_read_tokens` and `cache_write_tokens`. No rollup table carries
the latter, though `run-cost.ts` and `role-tokens.ts` both use it.

Cache write is not a hit — it is the premium-billed cost of populating the cache. Folding it into a
single "cached" figure makes a session that wrote a large cache and never reused it score as high
cache-hit, which is the precise pathology the metric should expose. `history_board_ranked_steps`
already ships a `cache-waste` ranking kind (1000 rows live), so the concept exists in the product
while the measure backing it does not.

```
cache_hit_rate = cache_read / (fresh + cache_read + cache_write)
gain_rate      = output     / (fresh + cache_read + cache_write + output)
```

Measured corpus mix: `fresh=8.56B  cache_read=43.73B  cache_write=0.16B  output=0.16B`. The
aggregate correction is small (0.8367 uncorrected vs 0.8336 corrected, 0.3 %). The argument is not
the aggregate: cache write is unmeasurable at *any* grain today, and cache waste is a per-session
and per-model pathology that averages to nothing globally.

### 12.3 Additivity invariant

**Store additive measures only, and store the count beside every sum.** No rate, ratio, mean, or
percentage is ever materialized.

A stored rate invites `AVG()` across buckets, which is wrong and looks plausible. `duration_samples`
already pairs with `assistant_duration_ms` on `message_5m` and `model_stats` but is missing on
`daily_stats`, `session_stats`, and `source_stats` — a correct mean duration is therefore not
computable from those three today. Every derived variable (`cache_hit_rate`, `gain_rate`, mean
duration, error rate) is computed from the vector at read time.

This is what makes the vector composable: because every member is additive, any new question becomes
a `GROUP BY` over an existing table rather than a new rollup table.

### 12.4 Allocated tokens must not impersonate measured ones

`history_board_tool_5m` stores its token columns as `REAL` — message tokens *allocated* across the
tool calls of a message via the `CROSS JOIN`. Their sum does not equal `history_board_message_5m`'s
integer sums, so anything adding across the two tables silently double counts.

Tokens are a property of a message; on tool and skill grain they are an attribution. Allocated
measures therefore carry an `_alloc` suffix (`fresh_input_tokens_alloc`) so a measurement and an
attribution can never be summed by accident under one name.

### 12.5 Where the vector does and does not go

| Target | Vector |
| --- | --- |
| `history_board_dimension_daily`, `history_board_kpi_window` (D6) | Full vector, every dimension × bucket |
| Existing bucketed tables (`message_5m`, `daily_stats`, `session_stats`, `model_stats`, `source_*`) | Extend with the missing members that are well defined at that grain — chiefly `cache_write_tokens` and `duration_samples`; no restructuring |
| `history_board_tool_stats` | `calls` / `errors` only — a top-N breakdown, not a KPI surface |
| `history_board_ranked_steps`, `history_board_loop_findings`, `history_board_rollup_meta` | None — per-row rankings, findings, and metadata are not aggregates |

### 12.6 This does not touch the transport contract

`cache_write_tokens` lands in the rollup **storage** layer only. No History response gains a field,
so `packages/contracts/src/history.ts` stays byte-identical and R11 holds. The measure becomes
available to future insight work without altering any current response shape; surfacing it in the UI
is a separate, later decision.

---

## 13. D11 — Bucket atomicity and definition versioning

Two properties D3 and D5 assumed without stating. Both were surfaced by the pre-decomposition review
of R1–R25.

### 13.1 Delete-then-re-derive needs a transaction boundary

D3 recomputes a bucket by deleting its rows and re-deriving them. Between those two statements the
bucket is **empty**, and a concurrent board read would serve an aggregate silently missing that
bucket — no error, just a wrong number. The current full-rebuild refresh does not have this hazard
because it swaps whole tables; incrementality introduces it.

**Decision.** A bucket's delete and re-derive commit as one unit. A reader observes either the prior
contents or the rebuilt contents, never an intermediate state. Migration 0027's
`history_refresh_active_unique` prevents two refreshes racing; it does not protect readers, so the
transaction boundary is a separate requirement (**R26**).

### 13.2 The watermark tracks data, not logic

Per-table watermarks (D5) answer "which rows are new". They cannot answer "was this row derived by
the current logic". Change `EFFECTIVE_TOOL_NAME_SQL`, a bucket boundary, an allocation rule, or the
measure vector, and every materialized row becomes stale while the watermark still reports fresh —
the rollups would be silently wrong until the next full reset.

The `history_version` hash this design replaces covered logic changes only by accident, because any
code change shipped alongside a data change.

**Decision.** Rollup tables store a **definition version** alongside the watermark. When it differs
from the current one, the affected tables are rebuilt rather than extended from the watermark. A
definition change unaccompanied by a version bump fails a test (**R27**), the same shape as the
importer’s `HISTORY_IMPORT_SCHEMA_VERSION` guard in E92.

Definition `v4` covers the 0763 re-audit corrections: empty loop scope is a no-op, source/day
coverage is driven from raw rows, and first-seen delta sources participate in alias backfill.

### 13.3 Equivalence is exact for integers, bounded for allocations

R4's original "byte-identical" wording conflicts with D10's `_alloc` real-valued measures: floating
point summation is order-dependent, so bucket-by-bucket accumulation and a single full-rebuild pass
can differ in the last unit in the last place. Integer measures are asserted exactly; allocated real
measures are asserted within a tolerance the test states, and key sets are asserted equal on both
sides.

---

## 14. Scope boundary — what stays on raw tables

"Always query from materialized objects" is correct for **aggregation** and wrong as an absolute:
drill-down detail (`ToolCallDetail.tsx`, 1,430 lines) needs per-call payloads that only the raw
tables hold. The enforced rule is therefore:

> No read-path statement **groups or aggregates** over `history_message` or `history_tool_call`.
> Point lookups by `record_hash` for drill-down remain permitted.

---

## 15. Storage

`history_import_ledger` is 650 MB + 181 MB autoindex ≈ 20 % of the database and is read by **no**
board query. Retention/compaction is independent of everything above and lands as its own task
(AC R15).

---

## 16. Accepted limits

| Limit | Why accepted |
| --- | --- |
| Loop-findings recompute falls back to a full pass when a delta exceeds `SESSION_SCOPE_LIMIT` | `deltaSessionScope` returns `null` past its limits; recompute-in-full is then the same path session stats already take (0763 R3). |
| Out-of-band `history_tool_alias_map` edits require a full rebuild | The scoped alias backfill (0763 R5) does not re-alias pre-delta rows; no runtime writer exists today, so the rule is stated rather than enforced. |
| The distinct-source-file walk scales with imported files, not messages | Loose index scan over `idx_history_message_source_file`; distinct files grow with imports, not with corpus rows (0763 R4). |
| Long-tail filter combinations re-aggregate 5-minute rollups | Measured 0.09–0.11 s; precomputing the combinatorial tail costs more than it saves. |
| Dedup invariant assumes append-only rowids | True under the current single reset path; asserted by test and documented as a constraint on any future partial-delete feature. |
| No columnar/analytics store | Correct answer at ~10× corpus, but an ADR-scale platform change that breaks the single-`ts-db` consumer rule in `packages/domain`. Recorded as the escape hatch, not built. |
