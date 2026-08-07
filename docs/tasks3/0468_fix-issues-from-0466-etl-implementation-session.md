---
template: feature-impl
schema_version: 1
name: "Fix issues found in 0466 forensic ETL implementation session: Bun link, TS strict, test coverage, analyze command"
description: "Remediate the four bottlenecks identified during the 0466 implementation session to reduce future implementation friction"
status: todo
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P1
tags: ["infrastructure", "dev-exp", "tech-debt"]
dependencies: ["0466"]
created_at: "2026-08-07T05:00:00.000Z"
updated_at: "2026-08-07T05:00:00.000Z"
---

## Fix issues found in 0466 forensic ETL implementation session

### Background
The 0466 task (forensic ETL contract implementation) took 280 minutes due to four major
bottlenecks totaling ~195 minutes of wasted time. This task addresses each root cause.

### Root cause analysis
See `.spur/run/sp-dev-findissue-20260806.md` for the full session analysis with per-phase
time/token/tool breakdown.

### Issues

#### P1: Bun workspace resolution overrides local link (~77 min wasted)
- **Problem:** `packages/app/node_modules/@gobing-ai/ts-llm-jsonl-importer` symlinks to Bun
  cache (npm 0.4.19), not to `bun link` global. When resolving through the workspace, Bun
  uses the cached npm version which lacks `omp`/`grok`/`agy` sources and `unknownRecords`.
- **Fix needed:** Ensure the workspace always uses the linked version when developing locally.
- **Options:** (a) `link:` protocol in `packages/app/package.json`, (b) fix symlink in
  postinstall script, (c) publish 0.5.0 and update catalog.

#### P1: TypeScript noUncheckedIndexedAccess blocks mapper functions (~23 min wasted)
- **Problem:** `tooling/typescript/base.json` sets `noUncheckedIndexedAccess: true`. This
  prevents dot notation on `Record<string, unknown>`, which mapper functions need for
  dynamic JSON property access.
- **Fix needed:** Either disable `noUncheckedIndexedAccess` in the mapper build config, or
  accept `@ts-nocheck` as permanent.
- **Options:** (a) Override in `tsconfig.build.json`, (b) set `noUncheckedIndexedAccess: false`
  in base config, (c) keep `@ts-nocheck` with documentation.

#### P2: Spur lint fails due to type mismatch with npm package version (~70 min wasted)
- **Problem:** Same root cause as P1 — workspace resolves to npm 0.4.19 types. The
  `LlmJsonlSource` type and `ImportResult` type lack `omp`/`grok`/`agy` and `unknownRecords`.
- **Fix needed:** Fix the dependency resolution so the linked package's types are used.
- **Options:** Same as P1 options. Currently uses `as unknown as` assertions as workaround.

#### P2: Tests broke when built-in sources switched to custom mappers (~9 min wasted)
- **Problem:** 8 tests used `codex`/`claude`/`pi` expecting `history_etl_*` tables. Custom
  mappers write to `history_message`/`history_tool_call`.
- **Fix needed:** Tests that need generic ETL behavior should use `gemini`/`opencode`.
- **Status:** Already fixed in 0466. Document as a lesson for future similar changes.

#### P3: Consistently handle `history_message` data in `history analyze` command
- **Problem:** `analyze` queries `history_etl_*` tables only. New mappers write to
  `history_message`/`history_tool_call`. The test `runs history analyze with --json and
  text output` fails because it finds 0 records.
- **Fix needed:** Update `queryAllEtlRecords` in `@gobing-ai/spur-domain` to also query
  the contract tables, or create a new query function.

### Requirements
- [ ] R1. Bun link works reliably with workspace packages. After `bun link` + `bun install`,
      `spur history import --source omp` resolves correctly.
- [ ] R2. `tsc -p tsconfig.build.json` in `llm-jsonl-importer` passes without errors from
      mapper functions. `noUncheckedIndexedAccess` is either disabled or overridden.
- [ ] R3. `bun run lint` in Spur passes without type errors from the importer package.
- [ ] R4. Existing tests that need generic ETL behavior are documented and use stable sources.
- [ ] R5. `history analyze` returns correct results for records in `history_message` and
      `history_tool_call` tables (R5 deferred from 0466).

### Plan
- [ ] **1. Fix workspace link (P1/R1).** Change `packages/app/package.json` to use
      `link:@gobing-ai/ts-llm-jsonl-importer` for the dev dependency, or implement a
      postinstall fix. Verify with `spur history import --source omp --dry-run`.
- [ ] **2. Fix TS strict mode (P1/R2).** Add `noUncheckedIndexedAccess: false` override in
      `tsconfig.build.json` for the mapper file, or accept `@ts-nocheck` permanently. Remove
      the `@ts-nocheck` comment in `mappers.ts` if the override approach works.
- [ ] **3. Fix Spur lint (P2/R3).** After fixing the workspace link, remove the type
      assertions in `history-service.ts` and `history.ts` formatImportResult. Re-run lint.
- [ ] **4. Fix history analyze (P3/R5).** Update `queryAllEtlRecords` in `spur-domain` to
      union `history_message` and `history_tool_call` records. Fix the failing test.
- [ ] **5. Document lesson (P2/R4).** Add a note in the project's pitfalls or lessons
      about the test dependency issue when converting built-in sources.

### Acceptance Criteria
```gherkin
Feature: 0466-fix — remediate 0466 bottlenecks

  Scenario: R1 — bun link works reliably
    Given the importer package is linked via bun link
    When spur history import --source omp --dry-run runs
    Then it finds omp source definition and scans files

  Scenario: R2 — mapper functions compile without errors
    Given the mappers.ts file
    When tsc -p tsconfig.build.json runs
    Then it produces no errors about property access on '{}'

  Scenario: R3 — spur lint passes
    Given the linked package is up to date
    When bun run lint runs
    Then all typecheck passes without assertions

  Scenario: R5 — history analyze works with contract tables
    Given the database has records in history_message
    When spur history analyze runs
    Then it returns the records count
```

### References
- Session: 019fd9c7-1967-7000-8958-c42024612f77
- Full analysis: `.spur/run/sp-dev-findissue-20260806.md`
- Parent: Feature E1