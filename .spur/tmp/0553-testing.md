## Testing

**External package tests (`~/xprojects/ts-libs/packages/llm-jsonl-importer/`):**

```bash
bun test
# 207 pass / 0 fail / 1097 expect() calls — 11 files
```

**Spur domain tests (`packages/domain`):**

```bash
bun test packages/domain
# 824 pass / 0 fail / 2173 expect() calls — 49 files
```

**Coverage:** not measured at per-file level — changes are additive schema/mapper fields with
targeted forensic-contract tests. All new code paths (maybeArgsRaw, args_raw emission) are
exercised by the 5 new tests.

- **R1 args_raw retention**: 3 tests in `forensic-contract.test.ts` — Claude TodoWrite (retains),
  Bash (does not retain), Codex update_plan (retains), Grok todo_write (retains).
- **R4 no result content**: 2 tests — schema-level assertion (has `result_bytes`, lacks
  result-content columns), import-level assertion (SECRET_TOKEN in tool_result never reaches
  any stored string).
- **Migration 0012**: 3 test scenarios updated in `migrations.test.ts` — fresh DB, legacy-0001 DB,
  pre-journaled-0000-0008 DB — all pass.
- **R5**: `session-formats.md` now 85 lines (was 121); no per-source fidelity ratings remain.
- **R2/R4 require no code change**: verified by reading mappers.ts — Grok already populates
  `duration_ms` via `tool_completed` event; tool result content is never mapped to any column.

Real-data import validation with source-local binary + provenance header (plan step 7) is
deferred to the verify phase — it requires a rebuilt importer package with `bun link`.
