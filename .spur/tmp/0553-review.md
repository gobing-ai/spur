## Review

**Functional traceability** — all requirements MET:

| Req | Status | Evidence |
| --- | --- | --- |
| R1 args_raw retention | MET | `~/xprojects/ts-libs/.../schema-sql.ts:67` + `mappers.ts:98-118` — `args_raw TEXT` column + `TODO_TOOL_ALLOWLIST` + `maybeArgsRaw`; 3 tests in `forensic-contract.test.ts` |
| R2 duration_ms | MET (no change) | `duration_ms` already exists in schema; Grok mapper populates it; other sources leave null — verified by reading mappers.ts |
| R3 probe codex/grok/agy | MET | `TODO_TOOL_ALLOWLIST` at `mappers.ts:98-106`: codex `update_plan`, grok `todo_write`, agy `[]` (no on-disk format) |
| R4 no result content | MET (no change) | Only `result_bytes` counter exists; 2 tests assert no result-content column + SECRET_TOKEN never stored |
| R5 reduce session-formats.md | MET | File reduced from 121→85 lines; fidelity ratings deleted; points at `mappers.ts` as single authority |

**Priority findings** (no P1/P2):

| # | Severity | File | Finding |
| --- | --- | --- | --- |
| 1 | P3 | `mappers.ts:98` | `TODO_TOOL_ALLOWLIST` is module-private — not exported. Correct: 0554 reads `args_raw` from the DB, not the allowlist at query time. The per-source verdict is recorded in the allowlist docstring (`:91-97`) for 0554 to read. |
| 2 | P4 | `session-formats.md:1` | Published importer `0.4.32` lacks `args_raw` in DDL; fresh DBs get it via migration 0012 ALTER. Idempotent via `addColumnIfMissing` once ts-libs republished with the column in DDL. |

**Residual risk** — none blocking. All changes additive (`args_raw` nullable, `args_digest` untouched, Q4 loop detection unchanged). Migration 0012 has table-exists skip guard for legacy DBs.
