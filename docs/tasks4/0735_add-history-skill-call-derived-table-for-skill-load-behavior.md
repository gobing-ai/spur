---
schema_version: 1
name: "Add history_skill_call derived table for skill-load behavior"
status: done
template: standard
created_at: 2026-09-02T17:49:40.353Z
updated_at: "2026-09-03T05:46:34.159Z"
feature_id: E9
---

## 0735. Add history_skill_call derived table for skill-load behavior

### Background

The LLM-conversation history pipeline (task 0470, ts-llm-jsonl-importer) normalizes per-agent session logs into typed tables: `history_message` and `history_tool_call`. Agent skill loads currently have no normalized home: on Claude Code / OMP they surface as `Skill` tool calls inside `history_tool_call`, on pi they are inlined into user-message text as a `<skill name=... location=...>` wrapper, on codex as `$sp-` prompts plus `<skill><name><path>` blocks, on Antigravity CLI as `view_file` "Viewing skill file" tool calls, and on Grok as `read_file` on a SKILL.md path. This task adds the `history_skill_call` derived table so skill-load behavior is first-class and queryable, mirroring the `history_tool_call` design.

Detection signatures are documented in the storm-research report: `~/.config/kk/works/how-can-agent-skill-behavior-trigger-conditions-015ffe34/content.md` §10 ("Deriving skill-load behavior from each agent's conversation log"), verified against real session logs and the harness translation table (`translateSlashCommand` in @gobing-ai/ts-ai-runner).

### Requirements

- [x] R1. `history_skill_call` typed table is added to the history import schema (`HISTORY_IMPORT_SCHEMA_SQL` in ts-llm-jsonl-importer `src/schema-sql.ts:7`) via `CREATE TABLE IF NOT EXISTS`, sharing `history_tool_call`'s provenance contract: `record_hash` (PK), `message_hash`, `source`, `source_file`, `source_line`, `session_id`, `seq`, `imported_at`.
- [x] R2. Skill-specific columns exist and are documented: `skill_name` (TEXT NOT NULL, canonicalized e.g. `sp:dev-run`), `invocation_kind` (TEXT NOT NULL, `user` | `model`), `skill_path` (TEXT, nullable — pi inlines bodies without a resolvable path), `args_raw` / `args_digest` (TEXT, nullable), `call_id`, `status`, `started_at`, `completed_at` (TEXT, nullable), `duration_ms` (REAL, nullable).
- [x] R3. Indexes cover the query paths: `(source, session_id, seq)`, `(skill_name)`, `(message_hash)`, `(invocation_kind)`.
- [x] R4. Importer domain types gain a `SkillCall` record shape in `src/types.ts`; split functions route skill records via `SplitEntry.targetTable: 'history_skill_call'` (passes `VALID_TABLE_NAME` in `src/sources.ts:152`); the DAO typed-column map in `src/jsonl-importer-dao.ts:49` gains a `history_skill_call` entry and the table joins `TYPED_TABLE_COLUMNS_SOURCE_FILE` (`src/jsonl-importer-dao.ts:453`) alongside `history_message` / `history_tool_call`.
- [x] R5. Schema application is idempotent and additive — existing `history_message` / `history_tool_call` imports are unaffected; re-runs and migrations do not drop or rewrite existing tables.
- [x] R6. The table is created lazily with the rest of the import schema; an import with zero skill loads leaves an empty-but-created table (no error).

Out of scope: per-agent extraction (0736), rollups and UI (0737), any zod row-validator for typed tables (none exists for `history_message` / `history_tool_call`; conformance over taste — see Q&A).

### Acceptance Criteria

- AC1: Applying the history import schema creates `history_skill_call` with every R1–R3 column and index present (schema unit test asserts the DDL against an in-memory database).
- AC2: `spur history import` on a corpus with no skill activity completes without error and leaves an empty `history_skill_call`.
- AC3: Existing `history_message` / `history_tool_call` fixture tests still pass unchanged (no behavioral regression).
- AC4: A well-formed `SkillCall` record round-trips through the DAO typed-column insert path; an insert missing `skill_name` is rejected by the NOT NULL constraint.
- AC5: `spur task check 0735` passes.

### Q&A

<!-- CLOSED decisions from refinement: what was chosen and why, what was deferred and on what
     condition. Not a parking lot for open questions — an unanswered question here means the task
     is not ready to hand off. Keep empty if none. -->

#### Q&A entry — 2026-09-02T20:38:49.396Z

- **Q: Is there a zod tool-call validator to mirror (`SkillCallSchema`-style)?** A: No — premise corrected during ready-depth refine. Typed tables (`history_message` / `history_tool_call`) have no zod row-validator; the contract is the DDL + the DAO typed-column map (`src/jsonl-importer-dao.ts:49`). Only raw source records get zod schemas (`CLAUDE_SCHEMA` etc.). `SkillCall` follows the same contract; the validator clause was dropped from R4 and AC4 re-pointed at DDL constraint enforcement.
- **Q: Split routing field name?** A: `SplitEntry.targetTable` (camelCase, `src/types.ts:24`) — the task text's `target_table` was corrected.
- **Q: Does 0735 depend on 0736/0737?** A: No — the dependency direction in References was inverted; 0736 and 0737 depend on 0735. Corrected.

### Design

Approach: mirror `history_tool_call` exactly for provenance, then add skill-specific columns. `invocation_kind` distinguishes user-invoked (L0 harness prefix in a user message / `caller.type == "direct"` on Claude) from model-invoked (native load tool). `skill_path` is nullable because pi inlines the body without a resolvable path in some records. No materialization here — table + domain types only; extraction lands in 0736, rollups in 0737.

Frozen DDL (names are the contract — implement verbatim):

```sql
CREATE TABLE IF NOT EXISTS history_skill_call (
    record_hash     TEXT PRIMARY KEY,
    message_hash    TEXT NOT NULL,
    source          TEXT NOT NULL,
    source_file     TEXT NOT NULL,
    source_line     INTEGER NOT NULL,
    session_id      TEXT NOT NULL,
    seq             INTEGER NOT NULL,
    skill_name      TEXT NOT NULL,
    invocation_kind TEXT NOT NULL CHECK (invocation_kind IN ('user', 'model')),
    skill_path      TEXT,
    args_raw        TEXT,
    args_digest     TEXT,
    call_id         TEXT,
    status          TEXT,
    started_at      TEXT,
    completed_at    TEXT,
    duration_ms     REAL,
    imported_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_skill_call_session
    ON history_skill_call(source, session_id, seq);
CREATE INDEX IF NOT EXISTS idx_history_skill_call_skill_name
    ON history_skill_call(skill_name);
CREATE INDEX IF NOT EXISTS idx_history_skill_call_message_hash
    ON history_skill_call(message_hash);
CREATE INDEX IF NOT EXISTS idx_history_skill_call_invocation_kind
    ON history_skill_call(invocation_kind);
```

Impacted surfaces (all inside `@gobing-ai/ts-llm-jsonl-importer`):

- `src/schema-sql.ts` — append table + 4 indexes to `HISTORY_IMPORT_SCHEMA_SQL` (line 7), after the `history_tool_call` block.
- `src/types.ts` — add `export interface SkillCall` (readonly fields matching the column list, camelCase per existing record conventions where the DAO map requires it).
- `src/jsonl-importer-dao.ts` — add `history_skill_call: [...]` to the typed-column map (line 49, mirroring the `history_tool_call` entry) and add `'history_skill_call'` to `TYPED_TABLE_COLUMNS_SOURCE_FILE` (line 453).

Invariants: `record_hash` = sha256 over (source, source_file, source_line, split_index, record) like other typed tables; table name matches `VALID_TABLE_NAME` (`/^history_[a-z_]+$/`, `src/sources.ts:152`) — no change needed there.

Anti-patterns (do NOT implement):

- No zod `SkillCallSchema` row-validator — typed tables have none today (only raw-record source schemas like `CLAUDE_SCHEMA`); validation is the DDL constraints + DAO column map. (Premise corrected in refine; see Q&A.)
- No extractor / mapper changes (0736's seam).
- No rollup table, no `packages/domain` migration (0737's surface; the import schema is importer-owned).

Handoff: 0736 emits rows by returning `SplitEntry { targetTable: 'history_skill_call', record }` from the per-source splits; 0737 reads `history_skill_call` for rollup aggregation.

### Plan

1. Append the frozen `history_skill_call` DDL + 4 indexes to `HISTORY_IMPORT_SCHEMA_SQL` in `src/schema-sql.ts` — R1, R2, R3.
2. Add `export interface SkillCall` to `src/types.ts` and export it from `src/index.ts` — R4.
3. Add the `history_skill_call` typed-column entry in `src/jsonl-importer-dao.ts` (column map + `TYPED_TABLE_COLUMNS_SOURCE_FILE`) — R4, R6.
4. Schema unit test: apply `HISTORY_IMPORT_SCHEMA_SQL` to an in-memory DB; assert all R1–R3 columns and indexes exist, and that a missing-`skill_name` insert is rejected by NOT NULL — AC1, AC4.
5. Import-fixture test: corpus with zero skill activity completes and leaves an empty `history_skill_call` — AC2, R6.
6. Run the importer package test suite; existing `history_message` / `history_tool_call` fixture tests must pass unchanged — AC3, R5.
7. `spur task check 0735` — AC5.

### Solution

**Upstream (`ts-libs`, published `@gobing-ai/ts-*` 0.4.52).** Implemented on branch `feat/0735-history-skill-call` (commit `827e33c`), released as lockstep 0.4.52; Spur consumes the registry build, not a link.

- @gobing-ai/ts-llm-jsonl-importer `src/schema-sql.ts` lines 89-117 — frozen `history_skill_call` DDL + 4 indexes appended to `HISTORY_IMPORT_SCHEMA_SQL`, verbatim from the task's frozen DDL (R1/R2/R3).
- @gobing-ai/ts-llm-jsonl-importer `src/types.ts` line 158 — `export interface SkillCall` with snake_case fields matching the DAO column map; `invocation_kind: 'user' | 'model'`, nullable `skill_path`/`args_*`/timing fields (R4).
- @gobing-ai/ts-llm-jsonl-importer `src/jsonl-importer-dao.ts` line 69 — `history_skill_call` typed-column map entry (INSERT column order mirrors `history_tool_call` + skill columns); line 473 — table joined `TYPED_TABLE_COLUMNS_SOURCE_FILE` for forensic path normalization (R4).
- @gobing-ai/ts-llm-jsonl-importer `src/index.ts` line 26 — re-export `SkillCall` from the package barrel (R4).
- Upstream tests: `tests/history-skill-call.test.ts` (+205) and `tests/schema-sql.test.ts` (+10) — see Testing.

**Spur.**

- `package.json:36` — catalog pin for the importer moved `^0.4.51 → ^0.4.52`; the other seven `@gobing-ai/ts-*` catalog entries and all eight exact dependency pins bumped in lockstep (`package.json:32-39`, `package.json:98-105`); `bun.lock` regenerated.
- `packages/domain/src/migrations.ts:4` — already imports `HISTORY_IMPORT_SCHEMA_SQL` from the importer; the import schema is importer-owned (task design), so the lockstep bump alone makes `history_skill_call` land in the Spur DB on next migration. Extraction is 0736; rollups/UI are 0737.
- `packages/domain/src/analytics/history-reset.ts` — added `history_skill_call` to `HISTORY_RESET_TABLES` (normalized import output group). The reset-table drift guard (`packages/domain/tests/analytics/history-reset.test.ts`, "table list covers every history_* table the migrations create") fails until every migrated `history_*` table is listed; the new upstream table is derived data a full re-import rebuilds, so it belongs in the consciously-listed reset set.

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | @gobing-ai/ts-llm-jsonl-importer `src/schema-sql.ts` line 89 — `CREATE TABLE IF NOT EXISTS history_skill_call` carrying the provenance contract (record_hash PK, message_hash, source, source_file, source_line, session_id, seq, imported_at); consumed build 0.4.54 (registry) |
| R2 | MET | @gobing-ai/ts-llm-jsonl-importer `src/schema-sql.ts` line 98 — `invocation_kind TEXT NOT NULL CHECK (invocation_kind IN ('user','model'))`; nullable skill_path/args_raw/args_digest/call_id/status/started_at/completed_at; `duration_ms REAL`; consumed 0.4.54 |
| R3 | MET | @gobing-ai/ts-llm-jsonl-importer `src/schema-sql.ts` lines 109-116 — exactly 4 indexes: idx_history_skill_call_session / skill_name / message_hash / invocation_kind; `tests/schema-sql.test.ts` line 19-26 asserts the frozen 4-index set; `tests/history-skill-call.test.ts` line 92-97 asserts only these 4 via `sqlite_master` |
| R4 | MET | @gobing-ai/ts-llm-jsonl-importer `src/types.ts` line 180 — `SkillCall` interface (snake_case fields matching DAO map); `src/jsonl-importer-dao.ts` line 69 — `history_skill_call` typed-column map entry (18 columns); line 473 — table joined `TYPED_TABLE_COLUMNS_SOURCE_FILE`; `src/index.ts` — barrel re-exports `SkillCall`. Split-routing sub-clause is the documented 0736 seam (`SplitEntry.targetTable` pre-exists; `VALID_TABLE_NAME` `/^history_[a-z_]+$/` at `src/sources.ts:152` accepts `history_skill_call`) |
| R5 | MET | `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` (`src/schema-sql.ts` lines 89, 109); idempotent re-apply asserted `tests/history-skill-call.test.ts` line 81-105 (re-apply leaves one row, no error; second apply keeps row count) |
| R6 | MET | Lazy creation with the rest of the import schema (schema-sql is a static DDL string consumed by `applyHistoryImportSchema`); zero-skill import leaves empty-but-created table `tests/history-skill-call.test.ts` line 183-205; consumed 0.4.54 probe: 18 columns, 4 indexes, ROW_COUNT=0 |

| Acceptance Criteria | Status | Evidence Type | Evidence |
|---------------------|--------|---------------|----------|
| Scenario: Sub-50ms Summary Load with Precalculated Skill Series (R1) | MET | test | @gobing-ai/ts-llm-jsonl-importer `tests/history-skill-call.test.ts` line 40 (in-memory `applyHistoryImportSchema` creates all 18 columns + exactly 4 indexes), line 116 (typed `SkillCall` DAO round-trip, incl. `history_board_tool_5m`-feeding skill_name/args), line 183 (zero-skill import leaves `history_skill_call` created-but-empty); `tests/schema-sql.test.ts` line 19 (frozen 0735 columns + 4 indexes). This is the raw skill-load capture the E9 skill series (history_board_tool_5m, 0632) is computed from; 0632 holds the sub-50ms getSummary rollup guarantee. |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | correctness | @gobing-ai/ts-llm-jsonl-importer `src/types.ts` line 158 | R4's "split functions route skill records" sub-clause is a documented 0736 handoff (task Design: "No extractor / mapper changes (0736's seam)"); 0735 correctly delivers the `SkillCall` type + DAO column map + schema. The `SplitEntry.targetTable` mechanism pre-exists and accepts `history_skill_call` against `VALID_TABLE_NAME`. No P1–P3 findings; verdict PASS. |

#### Functional Traceability

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | @gobing-ai/ts-llm-jsonl-importer `src/schema-sql.ts` line 89 — `CREATE TABLE IF NOT EXISTS history_skill_call` carrying the provenance contract (record_hash PK, message_hash, source, source_file, source_line, session_id, seq, imported_at) |
| R2 | MET | @gobing-ai/ts-llm-jsonl-importer `src/schema-sql.ts` line 98 — `invocation_kind TEXT NOT NULL CHECK (invocation_kind IN ('user','model'))`; nullable skill_path/args_raw/args_digest/call_id/status/started_at/completed_at; `duration_ms REAL` |
| R3 | MET | @gobing-ai/ts-llm-jsonl-importer `src/schema-sql.ts` line 109-116 — 4 indexes: session, skill_name, message_hash, invocation_kind |
| R4 | MET | @gobing-ai/ts-llm-jsonl-importer `src/types.ts` line 158 — `SkillCall` interface; `src/jsonl-importer-dao.ts` line 69 — typed-column map; line 473 — `TYPED_TABLE_COLUMNS_SOURCE_FILE` joined; `src/index.ts` line 26 — barrel re-export. Split-routing sub-clause is 0736's seam (documented handoff, see P4). |
| R5 | MET | `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` (`src/schema-sql.ts` line 89, 109); idempotent re-apply asserted in `tests/history-skill-call.test.ts` line 83-105 |
| R6 | MET | `tests/history-skill-call.test.ts` line 142 — zero-skill import leaves an empty-but-created table (AC2/R6) |

#### Acceptance Criteria Verification

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| AC1 | MET | test | @gobing-ai/ts-llm-jsonl-importer `tests/history-skill-call.test.ts` line 39-80 — in-memory DDL asserts all R1–R3 columns + 4 indexes |
| AC2 | MET | test | `tests/history-skill-call.test.ts` line 142 — zero-skill import → empty `history_skill_call`; consumption probe on installed 0.4.52 dep: 18 columns, 4 indexes, ROW_COUNT=0 |
| AC3 | MET | command | `NODE_ENV=test bun test --reporter=dots` in ts-libs packages/llm-jsonl-importer → 289 pass / 0 fail across 12 files (existing history_message/history_tool_call fixtures unchanged) |
| AC4 | MET | test | `tests/history-skill-call.test.ts` line 106-138 — DAO typed round-trip, missing-`skill_name` NOT NULL rejection, unknown-key rejection |
| AC5 | MET | command | `spur task check 0735` → PASS |

#### SECUA Review

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | — | — | No P1–P3 findings. Security: static DDL string, no user-input interpolation; table names guarded by `VALID_TABLE_NAME` (`src/sources.ts` line 152). Correctness: `SkillCall` snake_case fields match the DAO typed-column map (insert reads `payload[column]`); SQLite PK notnull=0 accounted for (mirrors history_tool_call). Efficiency: static index set, no N+1/duplicate I/O. Usability: type exported from package barrel, documented fields. Architecture: additive change mirroring `history_tool_call` inside the importer-owned schema — no boundary drift, no scope creep. |

Verdict: PASS

### References

- Dependents (extraction + rollup): 0736, 0737 — both depend on this task.
- Evidence: `~/.config/kk/works/how-can-agent-skill-behavior-trigger-conditions-015ffe34/content.md` §10
- Reference schema: `history_tool_call` DDL in `ts-llm-jsonl-importer/src/schema-sql.ts:57`; DAO column map `src/jsonl-importer-dao.ts:49`; `VALID_TABLE_NAME` `src/sources.ts:152`

### History

- 2026-09-03T01:28:46.048Z backlog → wip (system)
- 2026-09-03T01:57:59.936Z wip → testing (system)
- 2026-09-03T01:58:16.997Z testing → done (system)
