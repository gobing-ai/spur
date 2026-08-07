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
updated_at: "2026-08-07T07:08:32.973Z"
---

## Fix issues found in 0466 forensic ETL implementation session

### Background
The 0466 task (forensic ETL contract implementation) took 280 minutes. The
`/skill:sp-dev-findissue` post-mortem attributed ~195 minutes to four bottlenecks.

**This task was re-verified against the tree on 2026-08-07 before implementation started, and
three of the four original diagnoses did not survive the check.** The findissue pass reported
the *symptoms* the session hit accurately, but inferred the wrong cause for each. The sections
below carry the measured cause, not the reported one. Evidence for every claim is inline.

What actually remains as work: a ts-libs build/version-identity trap (P1), seven real type
errors hidden behind a package-wide `@ts-nocheck` (P2), one lesson to record (P3), and one
genuinely failing test whose product-side fix belongs to task 0474, not here (P4).
### Requirements
- [ ] R1. The loaded `@gobing-ai/ts-llm-jsonl-importer` is self-identifying and its `dist/` cannot
      silently lag `src/`. ts-libs carries a version distinct from the published `0.4.19`, the
      Spur catalog resolves to it deliberately, and a stale `dist/` is either impossible (build
      hook) or loud (fails a check) rather than presenting as "my edit did nothing".
- [ ] R2. `src/mappers.ts` compiles clean under `tsc -p tsconfig.build.json` with **no
      `@ts-nocheck`** and with `noUncheckedIndexedAccess` left enabled. All seven `TS2339` sites
      are fixed at the expression, not by relaxing a compiler flag.
- [ ] R3. The source-conversion lesson from P3 is recorded where the next conversion will hit it:
      converting a built-in source to a custom mapper moves its rows from `history_etl_<source>`
      to `history_message`/`history_tool_call`, and any test asserting generic ETL behavior must
      pin a still-generic source.
- [ ] R4. `bun test apps/cli/tests/commands/migrate-stubs.test.ts` is green, with **no change to
      `queryAllEtlRecords`, `SOURCE_TABLES`, or any analytics production code** — those belong to
      0474 and 0467. Task 0474's Background records that `analyze` is currently blind to every
      converted source.
- [ ] R5. `bun run lint` and `bun run test` remain green at task end.

### Design
Re-verification of the `/skill:sp-dev-findissue` post-mortem
(`.spur/run/sp-dev-findissue-20260806.md`) against the tree, 2026-08-07.
Each finding below carries the **measured** cause and the fix that follows from it.

#### P1: ts-libs `dist/` goes stale and both copies claim version `0.4.19` (~77 min)

**Originally reported as:** "`packages/app/node_modules/@gobing-ai/ts-llm-jsonl-importer`
symlinks to the Bun cache (npm 0.4.19), not the `bun link` global. The cached version lacks
`omp`/`grok`/`agy` sources and `unknownRecords`."

**Both halves of that are false. Measured:**

- `packages/app` has **no** nested `@gobing-ai/ts-llm-jsonl-importer` at all. It resolves through
  the root link: `Bun.resolveSync` from `packages/app` →
  `/Users/robin/xprojects/ts-libs/packages/llm-jsonl-importer/dist/index.js`. The workspaces that
  *do* shadow with the cached copy are `packages/domain` and `apps/cli`.
- The cached copy does **not** lack those symbols. `dist/types.d.ts:5` reads
  `… | 'openclaw' | 'omp' | 'grok' | 'agy'`; `dist/types.d.ts:88` declares `unknownRecords`;
  `dist/sources.js:104-106` defines the `omp`, `grok`, and `agy` source definitions.
- `diff -rq` between the linked `dist/` and the cached `dist/` reports **no differences**. The
  two trees are byte-identical. There is no functional gap between the two resolution paths.

**Measured root cause — two compounding traps, neither one a symlink problem:**

1. **Stale build artifact.** `bun link` resolves the package `exports` entry, i.e.
   `dist/index.js` — never `src/`. Seven source files in the linked package are currently newer
   than the built `dist/` (`src/mappers.ts` Aug 7 00:02 vs `dist/mappers.js` Aug 6 22:15; same
   for `importer.ts`, `sources.ts`, `types.ts`, `index.ts`, `schema-sql.ts`,
   `jsonl-importer-dao.ts`). Editing ts-libs `src/` changes nothing on the Spur side until
   ts-libs rebuilds. This is the mechanism that burns time: the edit looks applied and isn't.
2. **Version identity collision.** The local ts-libs package and the published npm tarball both
   declare `"version": "0.4.19"`. The root catalog pins `^0.4.19`. Bun cannot distinguish them,
   so `bun install` is free to restore the registry copy over the link at any time, and no
   version string ever reveals which one is loaded.

**Fix direction:** make the two copies distinguishable and the build non-optional. Bump ts-libs
to a prerelease identity (e.g. `0.5.0-dev.0`) so the loaded copy is self-identifying, and make
the rebuild automatic on the ts-libs side (`prepare`/`prepublishOnly`, or a watch build) so
`dist/` cannot lag `src/`. The three originally-listed options (`link:` protocol, postinstall
symlink patch, publish 0.5.0) all address the *shadowing* that was never the failure.

#### P2: seven real type errors are hidden by a package-wide `@ts-nocheck` (~23 min)

**Originally reported as:** "`noUncheckedIndexedAccess: true` prevents dot notation on
`Record<string, unknown>`, which mapper functions need."

**Wrong compiler flag. Measured:** removing the `@ts-nocheck` on `src/mappers.ts:1` and running
`tsc -p tsconfig.build.json` yields exactly **7 errors, all `TS2339`**, all of the form
`Property 'x' does not exist on type '{}'`. Re-running the same compile with
`--noUncheckedIndexedAccess false` yields **the same 7 errors**. The proposed fix does not
resolve a single one. `noUncheckedIndexedAccess` produces `TS18048`/`TS2532`
("possibly undefined") — not `TS2339` on `{}`.

Separately, proposed option (a) — "override in `tsconfig.build.json` **for the mapper file**" —
is not expressible: `tsconfig.json` has no per-file `compilerOptions`. It would disable the flag
for the whole package build.

**Measured root cause:** optional chaining applied to an `unknown` value. TypeScript narrows the
non-nullish branch of `unknown?.` to `{}`, which has no properties. All seven sites are the same
shape — a nested lookup on a JSON bag:

| Line | Expression |
| --- | --- |
| `src/mappers.ts:212` | `s(r.id, r.session?.id)` |
| `src/mappers.ts:217` | `s(r.model, r.message?.model)` |
| `src/mappers.ts:299` | `s(raw.id, raw.session?.id)` |
| `src/mappers.ts:312` | `s(raw.id, raw.session?.id)` |
| `src/mappers.ts:316` | `s(raw.model, raw.message?.model)` |
| `src/mappers.ts:387` | `s(raw.session_id, raw.session_meta?.id, raw.id)` |
| `src/mappers.ts:411` | `s(raw.model, payload.model, raw.turn_context?.payload?.model)` |

**Fix direction:** one local helper beside the existing `s()` at `src/mappers.ts:1034`, then
rewrite the seven sites and delete the `@ts-nocheck`:

```ts
/** Narrow an unknown JSON value to an object bag so nested lookups type-check. */
function o(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
```

`s(r.id, r.session?.id)` becomes `s(r.id, o(r.session).id)`. This restores type checking across a
41 KB file — the largest in the package and the one doing the forensic field mapping — instead of
weakening a repo-wide strictness flag that was never implicated. `@ts-nocheck` on this file is not
an acceptable permanent state: it is precisely the file whose mapping correctness the forensic
contract depends on.

#### P3: tests broke when built-in sources switched to custom mappers (~9 min)

Unchanged and still accurate. Eight tests used `codex`/`claude`/`pi` expecting `history_etl_*`
tables; custom mappers write to `history_message`/`history_tool_call`. Already fixed inside 0466.
Remaining work here is to record the lesson so the next source conversion does not rediscover it.

#### P4: `spur history analyze` reads only `history_etl_*` — one test is red at HEAD

**Confirmed real, and it is a live product regression, not just a test artifact.**
`apps/cli/tests/commands/migrate-stubs.test.ts:181`
(`runs history analyze with --json and text output`) fails now: it imports with
`--source claude`, which 0466 converted to a custom mapper writing `history_message`, then
asserts `jsonResult.totals.records >= 1`. `queryAllEtlRecords` only scans `SOURCE_TABLES`
(`packages/domain/src/analytics/query.ts:8-16`), so it returns zero. Every converted source —
`claude`, `codex`, `pi`, `omp`, `grok`, `agy` — is now invisible to `analyze`.

**The originally proposed fix must not be implemented here.** Plan step 4 said to extend
`queryAllEtlRecords` to union the contract tables. Task **0474 R7 explicitly retires
`queryAllEtlRecords`**, along with `aggregateCosts`, `accumulate`, and the `etlToCostRecord`
token estimate, replacing the whole path with SQL aggregation over `history_message` /
`history_tool_call`. Building the union here means writing code 0474 deletes. Task **0467**
separately owns the `SOURCE_TABLES` allowlist. Three tasks would touch one function.

**Fix direction here:** restore an honest, green suite with a zero-line production diff — point
the test at a source that still uses the generic ETL path (`gemini` or `opencode`), which is the
same corrective P3 documents. The product-side restoration of coverage for converted sources
stays with 0474, whose Background must record that `analyze` is currently blind to them so the
regression cannot be lost between the two tasks.

#### Dropped after verification — do not implement

- ~~"`bun run lint` in Spur passes without type errors from the importer package"~~ —
  already true at HEAD. Measured: `bun run lint` passes; biome checks 613 files clean and
  all seven workspaces typecheck with exit 0. The `as unknown as` workarounds the
  post-mortem described are not present in `packages/app/src/services/history-service.ts`
  or `apps/cli/src/commands/history.ts`; a grep for them returns nothing. No work here.
- ~~"Update `queryAllEtlRecords` to union the contract tables"~~ — superseded by 0474 R7,
  which retires that function. See P4.
### Plan
Steps 1 and 2 land in the **ts-libs** repo (`~/xprojects/ts-libs`); steps 3–5 land in Spur.

- [ ] **1. Make the importer copy self-identifying and its build non-optional (R1).** In
      `packages/llm-jsonl-importer/package.json`, bump `version` off `0.4.19` to a prerelease
      identity (`0.5.0-dev.0`) and add a build hook (`prepare`) so `dist/` is regenerated rather
      than trusted. Rebuild, then point the Spur root `workspaces.catalog` entry at that version
      and re-link. Verify with `Bun.resolveSync` from `packages/app`, `packages/domain`, and
      `apps/cli` — all three must land on the same realpath — and confirm no `src/*.ts` is newer
      than `dist/*.js`.
- [ ] **2. Delete `@ts-nocheck` from `mappers.ts` (R2).** Add the `o()` helper next to `s()` at
      `src/mappers.ts:1034`, rewrite the seven optional-chain sites listed in the P2 table, remove
      line 1, and confirm `bunx tsc -p tsconfig.build.json` reports zero errors with
      `noUncheckedIndexedAccess` still on. Do **not** touch `tooling/typescript/base.json`.
- [ ] **3. Fix the red test without touching analytics (R4).** In
      `apps/cli/tests/commands/migrate-stubs.test.ts:181`, switch the import source from `claude`
      to `gemini` (generic ETL path) and add a one-line comment naming the reason and pointing at
      0474. No production file changes in this step.
- [ ] **4. Hand the analyze regression to 0474 (R4).** Append to task 0474's Background that
      `analyze` currently returns zero records for `claude`, `codex`, `pi`, `omp`, `grok`, and
      `agy`, and that the migrate-stubs test was pinned to `gemini` to keep the suite honest in
      the meantime. Use `spur task update 0474 --section Background --from-file …`.
- [ ] **5. Record the lesson (R3).** Append the source-conversion trap to `.spur/context/
      pitfalls.md` via `sp:indexed-context`, covering both P3 (rows move tables) and the P1
      stale-`dist` trap, since both cost the 0466 session real time.
- [ ] **6. Gate (R5).** `bun run lint` and `bun run test`. Note that three pre-existing failures
      in the full suite are sandbox port-binding denials, not regressions.
### Acceptance Criteria
```gherkin
Feature: 0468 — remediate the verified 0466 bottlenecks

  Scenario: R1 — the loaded importer copy is self-identifying
    Given ts-libs llm-jsonl-importer carries a version distinct from the published 0.4.19
    When Bun.resolveSync runs from packages/app, packages/domain, and apps/cli
    Then all three resolve to the same realpath
    And the resolved package.json version matches the ts-libs version, not 0.4.19

  Scenario: R1 — a stale dist cannot masquerade as an applied edit
    Given a source file in the importer is edited
    When the package is consumed from Spur without an explicit manual build
    Then the built dist reflects the edit or the build fails loudly
    And no src/*.ts is newer than its corresponding dist/*.js

  Scenario: R2 — mappers.ts type-checks without suppression
    Given src/mappers.ts has no @ts-nocheck directive
    And noUncheckedIndexedAccess remains true in the ts-libs base tsconfig
    When tsc -p tsconfig.build.json runs
    Then it reports zero errors
    And no TS2339 "does not exist on type '{}'" error remains

  Scenario: R4 — the analyze test is green without touching analytics
    When bun test apps/cli/tests/commands/migrate-stubs.test.ts runs
    Then all tests pass
    And git diff shows no change to packages/domain/src/analytics/query.ts
    And SOURCE_TABLES and queryAllEtlRecords are byte-identical to HEAD

  Scenario: R4 — the analyze regression is handed off, not dropped
    Given analyze returns zero records for every source converted by 0466
    When task 0474's Background is read
    Then it names the blind sources and the pinned migrate-stubs test

  Scenario: R5 — the gate holds
    When bun run lint and bun run test run
    Then lint passes and no new test failures appear beyond the known sandbox port-binding denials
```
### References
- Session: 019fd9c7-1967-7000-8958-c42024612f77
- Original post-mortem: `.spur/run/sp-dev-findissue-20260806.md` — accurate on symptoms and
  timings; three of its four causal diagnoses were falsified on re-verification. Read the
  `### Design` section here, not the post-mortem, for what to implement.
- Parent: Feature E1
- Overlaps — do not duplicate their scope:
  - **0474** owns the `history analyze` SQL rework and explicitly retires `queryAllEtlRecords`
    (its R7). The analyze regression P4 describes is 0474's to fix.
  - **0467** owns the `SOURCE_TABLES` allowlist (`packages/domain/src/analytics/query.ts:8-16`).
- Upstream repo for R1/R2: `~/xprojects/ts-libs/packages/llm-jsonl-importer`
