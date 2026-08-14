## Solution

### Change map

**External package: `~/xprojects/ts-libs/packages/llm-jsonl-importer/`**

1. `src/schema-sql.ts:67` — Added `args_raw TEXT` column after `args_digest TEXT` in the
   `history_tool_call` DDL (`CREATE TABLE`). Nullable; NULL for non-allowlisted tools.
2. `src/jsonl-importer-dao.ts:46` — Added `'args_raw'` to
   `TYPED_TABLE_COLUMNS.history_tool_call` so `recordInsertOp` validates payload keys.
3. `src/mappers.ts:98` — Three changes:
   - `src/mappers.ts:86` — Added `'args_raw'` to `TOOL_CALL_MAPPER_KEYS` (auto-propagates to all
     7 `FIELD_MAP`s).
   - `src/mappers.ts:98` — Added `TODO_TOOL_ALLOWLIST` constant keyed by source → tool names:
     `{ claude: ['TodoWrite'], pi: ['todo'], omp: ['TodoWrite','todo'],
        codex: ['update_plan'], grok: ['todo_write'], agy: [], gemini: [] }`.
     Docstring cites evidence: 0489 R4 confirmed omp/pi/claude; 0553 R3 probed codex/grok/agy.
   - `src/mappers.ts:112` — Added `maybeArgsRaw(source, toolName, args)` helper: returns
     `JSON.stringify(args)` for allowlisted tools, `undefined` otherwise. Codex `arguments`
     (already a JSON string) stored as-is.
   - Added `args_raw: maybeArgsRaw(...)` to all 9 tool_call emission sites across
     `src/mappers.ts:170,260,340,420,500,580,660,740,820` (claude, pi, omp, codex, agy, gemini,
     grok×3).
4. `tests/forensic-contract.test.ts:280` — Added 5 tests:
   - R1 block (3 tests): Claude `TodoWrite` retains args_raw, `Bash` does not; Codex
     `update_plan` retains args_raw; Grok `todo_write` retains args_raw.
   - R4 block (2 tests): schema has `result_bytes` but no result-content columns; import does
     not store `SECRET_TOKEN` from tool_result content.

**Spur monorepo: `/Users/robin/xprojects/spur-new/`**

5. `packages/domain/src/migrations.ts:780` — Added migration `0012`:
   - `HISTORY_TOOL_CALL_ARGS_RAW_SCHEMA_SQL` (ALTER TABLE … ADD COLUMN args_raw TEXT).
   - Entry in `CLI_MIGRATIONS`: `{ id: '0012_spur_cli_history_tool_call_args_raw', sql: ...,
     addColumnIfMissing: { table: 'history_tool_call', column: 'args_raw' } }`.
   - Table-exists skip guard (`argsRawSkip`): legacy/foundation-only DBs without
     `history_tool_call` journal without executing the ALTER (same pattern as 0011's
     `sequenceIndexSkip`).
6. `packages/domain/tests/dao/migrations.test.ts:42` — Updated: count 12→13, new id at index 12,
   applied counts updated across 3 test scenarios.
7. `plugins/sp/skills/issue-finding/references/session-formats.md:1` (R5) — Reduced from 121
   to ~85 lines: deleted confidence legend, fidelity column, portable tool-call map, OMP deep
   dive, per-source fidelity sections. Retained: root-path table (added grok + agy rows),
   fallback-bridge note, fail-loud rule, schema-first rule. Added: pointer to `mappers.ts` as
   single authority for typed-table field retention.

### Requirements disposition

| Req | Status | Evidence |
|-----|--------|----------|
| R1 | ✅ done | `args_raw` column + allowlist + 3 forensic tests |
| R2 | ✅ no change needed | `duration_ms` already populated by Grok mapper; other sources genuinely don't report per-tool timing (leaves null) |
| R3 | ✅ done | Codex: `update_plan`; Grok: `todo_write`; AGY: no on-disk format (`[]`). Recorded in `TODO_TOOL_ALLOWLIST` + docstring |
| R4 | ✅ no change needed | Tool result content never stored — only `result_bytes` counter. 2 tests assert this |
| R5 | ✅ done | `session-formats.md` reduced; fidelity ratings gone; points at `mappers.ts` |
