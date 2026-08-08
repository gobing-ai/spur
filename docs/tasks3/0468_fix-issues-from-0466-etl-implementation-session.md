---
template: feature-impl
schema_version: 1
name: "Fix issues found in 0466 forensic ETL implementation session: Bun link, TS strict, test coverage, analyze command"
description: "Remediate the four bottlenecks identified during the 0466 implementation session to reduce future implementation friction"
status: done
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P1
tags: ["infrastructure", "dev-exp", "tech-debt"]
dependencies: ["0466"]
created_at: "2026-08-07T05:00:00.000Z"
updated_at: "2026-08-08T12:32:19.142Z"
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
- [x] R1. `ts-libs/packages/llm-jsonl-importer` regenerates `dist/` on install/link rather than
      trusting it, so a ts-libs source edit can never present as "my edit did nothing".
      **Done (2026-08-07) via the two mechanisms that actually guard Spur.** The originally specified
      one — a `prepare` hook — was falsified during verification and then dropped by the operator
      (ts-libs `8e71310`); **0.4.22 ships without it**, deliberately. Bun enqueues `prepare` only for
      `ResolutionTag::Git | Github | Root` and `Workspace`
      (`src/install/lockfile/Package/Scripts.rs:167-194`), never for the `Symlink` a `bun link`
      produces (`src/install/resolution.rs:84-91`), so it never covered the path that cost 77 minutes.
      What covers Spur now: **registry path** — `prepublishOnly: bun run build` builds `dist/` from
      `src/` at publish time, verified in the consumed 0.4.22 tarball (its `dist/mappers.js` carries the
      `o()` helper added to `src/`); **link path** — `bun run link-check`, chained into `spur-check`,
      fails with the offending package, file, and rebuild command. **Identity** — 0.4.22 released, Spur
      catalog `^0.4.22`, and all three consuming workspaces resolve to
      `node_modules/.bun/@gobing-ai+ts-llm-jsonl-importer@0.4.22/…`, so the path itself names the copy.
      AC amended twice (operator-approved) from mechanism wording to outcome; see `### Acceptance Criteria`.
- [x] R2. `src/mappers.ts` compiles clean under `tsc -p tsconfig.build.json` with **no
      `@ts-nocheck`** and with `noUncheckedIndexedAccess` left enabled. All seven `TS2339` sites
      are fixed at the expression, not by relaxing a compiler flag. ts-libs' own suite stays green.
      **Done (2026-08-07)** — `@ts-nocheck` deleted, `o()` narrowing helper added beside `s()`, all
      seven sites rewritten per the `### Design` § P2 table; `tsc -p tsconfig.build.json` → 0 errors
      with `noUncheckedIndexedAccess` still true, importer suite 164 pass / 0 fail,
      `tooling/typescript/base.json` untouched. **Released in 0.4.22 and consumed by Spur** — the copy at `node_modules/.bun/@gobing-ai+ts-llm-jsonl-importer@0.4.22/…` carries no `@ts-nocheck` in `src/mappers.ts` and the `o()` helper in both `src/` and the compiled `dist/`.
- [x] R3. The source-conversion lesson from P3 is recorded where the next conversion will hit it:
      converting a built-in source to a custom mapper moves its rows from `history_etl_<source>`
      to `history_message`/`history_tool_call`, and any test asserting generic ETL behavior must
      pin a still-generic source. **Done** — recorded in `.spur/context/pitfalls.md` (2026-08-07),
      alongside the linked-package-serves-`dist` stale-build trap.
- [x] R4. `bun test apps/cli/tests/commands/migrate-stubs.test.ts` is green, with **no change to
      `queryAllEtlRecords`, `SOURCE_TABLES`, or any analytics production code** — those belong to
      0474 and 0467. Task 0474's Background records that `analyze` is currently blind to every
      converted source. **Done** — test pinned to `--source gemini` (commit 6052ef51); 0474
      Background carries the blind-sources hand-off. 4 pass / 0 fail; analytics diff empty.
- [x] R5. `bun run lint` and `bun run test` remain green in Spur at task end. **Done** — lint +
      typecheck clean; 4580 pass / 24 fail of 4604, all 24 in the known sandbox `Bun.serve`
      port-binding class, none in importer/analytics/history modules.
### Design
Re-verification of the `/skill:sp-dev-findissue` post-mortem
(`.spur/run/sp-dev-findissue-20260806.md`) against the tree, 2026-08-07.
Each finding below carries the **measured** cause and a fix that was **executed and
verified**, then reverted, so the implementing agent is reapplying a known-good change.

#### P1: ts-libs `dist/` goes stale, so ts-libs edits silently do nothing (~77 min)

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
- At the time of verification `diff -rq` between the linked `dist/` and the cached `dist/`
  reported **no differences** — byte-identical. The shadowing the post-mortem blames could not
  have produced any behavioral difference, because both paths loaded the same bytes.

**Measured root cause — a stale build artifact, not a symlink.** `bun link` resolves the package
`exports` entry, i.e. `dist/index.js`, never `src/`. At verification time seven source files were
newer than the built `dist/` (`src/mappers.ts` Aug 7 00:02 vs `dist/mappers.js` Aug 6 22:15; same
for `importer.ts`, `sources.ts`, `types.ts`, `index.ts`, `schema-sql.ts`,
`jsonl-importer-dao.ts`). Editing ts-libs `src/` changed nothing on the Spur side until ts-libs
rebuilt. That is the mechanism that burns time: the edit looks applied and is not.

**Confirmed by construction:** running `bun run build` in the importer made `dist/mappers.js`,
`dist/mappers.d.ts`, and `dist/mappers.d.ts.map` diverge from the npm 0.4.19 copy for the first
time. The source changes had been sitting unbuilt.

**Fix (scoped by operator decision, 2026-08-07):** add `"prepare": "bun run build"` to
`ts-libs/packages/llm-jsonl-importer/package.json`. `prepare` fires on install and on `bun link`,
so `dist/` is regenerated rather than trusted. Verified: `bun run build` exits 0, no `src/*.ts`
is left newer than `dist/`, and Spur's `bun run lint` stays green against the rebuilt package.

**Consequence to accept deliberately:** with `prepare` wired, a type error anywhere in the
importer will fail `bun install` in ts-libs rather than surfacing later. That is the intended
trade — loud beats silent — but it means R2 (removing `@ts-nocheck`) must leave the package
compiling clean, which it does (verified: 0 errors).

**Resolved by the 0.4.20 release (2026-08-07).** Both copies used to declare `"version": "0.4.19"`,
so nothing in a version string revealed which was loaded. Fixing that required a real release,
and ts-libs blocks manual publishing: its `release` script exits 1 with *"Releases go through
GitHub Actions via Trusted Publishing — push a tag"*. The operator released **0.4.20** via a
Trusted Publishing tag push and bumped the Spur `workspaces.catalog` entry to `^0.4.20`, so the
importer now declares a version distinct from the cached 0.4.19 and the registry resolves to the
new copy. **The identity-collision half of P1 is closed; no version work remains here.**

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
non-nullish branch of `unknown?.` to `{}`, which has no properties.

**Fix — this exact patch was applied and verified, then reverted. Reapply it.**

Add beside the existing `s()` helper at `src/mappers.ts:1034`:

```ts
/** Narrow an unknown JSON value to an object bag so nested lookups type-check. */
function o(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
```

Then rewrite the seven sites and delete line 1:

| Line | Before | After |
| --- | --- | --- |
| 212 | `s(r.id, r.session?.id)` | `s(r.id, o(r.session).id)` |
| 217 | `s(r.model, r.message?.model)` | `s(r.model, o(r.message).model)` |
| 299 | `s(raw.id, raw.session?.id)` | `s(raw.id, o(raw.session).id)` |
| 312 | `s(raw.id, raw.session?.id)` | `s(raw.id, o(raw.session).id)` |
| 316 | `s(raw.model, raw.message?.model)` | `s(raw.model, o(raw.message).model)` |
| 387 | `s(raw.session_id, raw.session_meta?.id, raw.id)` | `s(raw.session_id, o(raw.session_meta).id, raw.id)` |
| 411 | `s(raw.model, payload.model, raw.turn_context?.payload?.model)` | `s(raw.model, payload.model, o(o(raw.turn_context).payload).model)` |

**Verification result from the trial run:** `tsc -p tsconfig.build.json` → **0 errors** with
`noUncheckedIndexedAccess` still enabled, and the importer's own suite → **158 pass, 0 fail**.
Do **not** touch `tooling/typescript/base.json`.

This restores type checking across a 41 KB file — the largest in the package and the one doing
the forensic field mapping. `@ts-nocheck` on this file is not an acceptable permanent state: it
is precisely the file whose mapping correctness the forensic contract depends on.

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

**Verified fix:** switching the import in that test from `--source claude` to `--source gemini`
(`gemini` is a plain `sourceDefinition`, no custom mapper, so it still writes `history_etl_gemini`)
makes the test pass — trial run: **1 pass, 0 fail**, with zero production-code changes.

#### Dropped after verification — do not implement

- ~~"`bun run lint` in Spur passes without type errors from the importer package"~~ —
  already true at HEAD. Measured: `bun run lint` passes; biome checks 613 files clean and
  all seven workspaces typecheck with exit 0. The `as unknown as` workarounds the
  post-mortem described are not present in `packages/app/src/services/history-service.ts`
  or `apps/cli/src/commands/history.ts`; a grep for them returns nothing. No work here.
- ~~"Update `queryAllEtlRecords` to union the contract tables"~~ — superseded by 0474 R7,
### Plan
Steps 1–2 land in **ts-libs** (`~/xprojects/ts-libs`), a separate repo with its own `bun run check`
gate. Steps 3–5 land in Spur. Every fix below was executed and verified during task
re-verification, then reverted — you are reapplying known-good changes, not exploring.

- [x] **1. Remove `@ts-nocheck` from `mappers.ts` (R2).** Apply the exact patch in
      `### Design` § P2: add the `o()` helper next to `s()` at `src/mappers.ts:1034`, rewrite the
      seven sites per the table, delete line 1. Confirm `bunx tsc -p tsconfig.build.json` → 0
      errors with `noUncheckedIndexedAccess` still on, then `bun run check` in the importer
      package (expect 158 pass / 0 fail). Do **not** touch `tooling/typescript/base.json`.
      Do this *before* step 2 — once `prepare` is wired, a type error breaks `bun install`.
      **Done 2026-08-07** — helper landed at `src/mappers.ts:1038-1041`, seven sites at
      `213,218,301,314,318,390,414`, line 1 deleted. `tsc` → 0 errors, 0 `TS2339`;
      `bun run check` → 164 pass / 0 fail (suite grew from the 158 estimated here).
- [x] **2. Make the build non-optional (R1).** Add `"prepare": "bun run build"` to
      `ts-libs/packages/llm-jsonl-importer/package.json` scripts. Verify `bun run build` exits 0
      and no `src/*.ts` is newer than its `dist/*.js`. The identity-collision half of R1 is
      already closed by a real release (version bumped, catalog bumped) — see `### Design`
      § P1; this step no longer needs to touch version or release.
      **Superseded 2026-08-07 — the hook was added, then deliberately removed.** It was verified to
      regenerate a staled `dist/`, but verification then showed it can never fire on the `bun link`
      path this requirement names (Bun skips lifecycle scripts for `Symlink` resolutions). Since Spur
      consumes the registry tarball — whose `dist/` is already built at publish time by the
      pre-existing `prepublishOnly` — the hook bought Spur nothing while making any importer type
      error break `bun install` in ts-libs. The operator removed it (`8e71310`) and released 0.4.22
      without it. The link path is covered instead by step 7.
- [x] **3. Fix the red test without touching analytics (R4).** In
      `apps/cli/tests/commands/migrate-stubs.test.ts:192`, change `'--source', 'claude'` to
      `'--source', 'gemini'` and add a one-line comment naming the reason and pointing at 0474.
      No production file changes in this step. Verified to pass.
- [x] **4. Hand the analyze regression to 0474 (R4).** Append to task 0474's Background that
      `analyze` currently returns zero records for `claude`, `codex`, `pi`, `omp`, `grok`, and
      `agy`, and that the migrate-stubs test was pinned to `gemini` to keep the suite honest in
      the meantime. Use `spur task update 0474 --section Background --from-file …`.
- [x] **5. Record the lesson (R3).** Append to `.spur/context/pitfalls.md` via
      `sp:indexed-context`, covering both P3 (converting a source moves its rows to different
      tables) and P1 (a linked package serves `dist/`, so unbuilt `src/` edits are invisible).
- [x] **6. Gate (R5).** `bun run lint` and `bun run test` in Spur. Twenty-four full-suite
      failures are sandbox `Bun.serve` port-binding denials, not regressions — reproduced bare
      via `Bun.serve({port:0})`.

**Released.** The ts-libs work was committed and published by the operator as **0.4.22**
(ts-libs `401d5a4`, tree clean), Spur's `workspaces.catalog` is `^0.4.22`, and a root `bun install`
was run. Verified here: all three consuming workspaces resolve to
`node_modules/.bun/@gobing-ai+ts-llm-jsonl-importer@0.4.22+…/dist/index.js`, and that copy carries the
R2 fix in both `src/` and the compiled `dist/`. Nothing about this task remains pending upstream.

- [x] **7. Close the link path R1's `prepare` hook cannot reach (R1).** Verification showed Bun fires
      `prepare` only for `Root`/`Workspace`/`Git`/`Github` resolutions, never for the `Symlink` a
      `bun link` produces, so step 2 alone leaves the original failure mode open. Added a
      consumer-side guard in Spur: `scripts/commands/link-check.ts` + `bun run link-check`, chained
      into `spur-check` / `spur-check:full`. It compares the newest build input against the newest
      build output for every `@gobing-ai/*` entry that resolves **outside** this repo's
      `node_modules` (store copies stay inside and are skipped — they publish `src/` too, so
      "has a src/ dir" does not distinguish them). Verified both directions against the live ts-libs
      link, plus 7 unit tests. AC amended (operator-approved) from mechanism to outcome.
### Acceptance Criteria
**AC amendment, 2026-08-07 (operator-approved, revised twice as evidence came in).**

The original R1 stale-dist scenario read "When the package is installed **or linked** / Then dist is
regenerated from src", premised on a `prepare` hook. Verification falsified that premise: Bun enqueues
`prepare` only for `ResolutionTag::Git | Github | Root` and `Workspace`
(`src/install/lockfile/Package/Scripts.rs:167-194`), while `bun link` yields a `Symlink` resolution
(`src/install/resolution.rs:84-91`) that never fires it. The operator then dropped the `prepare` hook
entirely (ts-libs `8e71310`) and released **0.4.22** without it.

The scenarios below are therefore restated around the two mechanisms that actually guard Spur, each
verified. The install-time `prepare` branch is **removed, not softened** — it was never load-bearing for
Spur, because Spur consumes the registry tarball, whose `dist/` is built at publish time by
`prepublishOnly`. Intent unchanged: a ts-libs source edit can never present as applied when it is not.

```gherkin
Feature: 0468 — remediate the verified 0466 bottlenecks

  Scenario: R1 — the published copy's dist always matches its src (registry path)
    Given the importer declares prepublishOnly that runs its build
    When a release is published and Spur resolves that version from the registry
    Then the shipped dist is built from the shipped src at publish time
    And the compiled output contains the current source's symbols

  Scenario: R1 — a stale dist cannot masquerade as an applied edit (link path)
    Given a consumer has bun link-ed the package, which Bun resolves as a Symlink
    And Bun therefore never fires the package's prepare script
    When the linked package's newest build input is newer than its newest build output
    Then bun run link-check fails with a non-zero exit
    And the failure names the package, the offending source file, and the rebuild command
    And spur-check fails, so the staleness cannot pass unnoticed

  Scenario: R1 — the identity trap is resolved by a real release
    Given ts-libs released via Trusted Publishing tag push
    And the importer declares a version distinct from any previously cached copy
    And the Spur workspaces.catalog entry is bumped to match
    When the resolved module path is inspected from each consuming workspace
    Then the version in that path reveals which copy is loaded
    And no further version work is deferred

  Scenario: R1 — the guard does not false-alarm on registry copies
    Given Bun store copies under node_modules are symlinked and publish src/ alongside dist/
    When link-check runs against a clean install
    Then it reports no stale links
    And it exits zero

  Scenario: R2 — mappers.ts type-checks without suppression
    Given src/mappers.ts has no @ts-nocheck directive
    And noUncheckedIndexedAccess remains true in the ts-libs base tsconfig
    When tsc -p tsconfig.build.json runs
    Then it reports zero errors
    And no TS2339 "does not exist on type '{}'" error remains
    And the importer's own test suite passes

  Scenario: R2 — the fix reaches the copy Spur actually loads
    Given Spur resolves the importer from the registry, not a link
    When the resolved package is inspected
    Then its src/mappers.ts carries no @ts-nocheck
    And its compiled dist carries the narrowing helper

  Scenario: R4 — the analyze test is green without touching analytics
    When bun test apps/cli/tests/commands/migrate-stubs.test.ts runs
    Then all tests pass
    And SOURCE_TABLES and queryAllEtlRecords are byte-identical to HEAD

  Scenario: R4 — the analyze regression is handed off, not dropped
    Given analyze returns zero records for every source converted by 0466
    When task 0474's Background is read
    Then it names the blind sources and the pinned migrate-stubs test

  Scenario: R5 — the gate holds
    When bun run lint and bun run test run in Spur
    Then lint passes and no new test failures appear beyond the known sandbox port-binding denials
```
### Solution
Change map for the work this task landed. Steps 3–6 landed in Spur across commits `6052ef51`,
`5f692e96`, and `84842e8f`. Steps 1–2 landed in the upstream repo `~/xprojects/ts-libs` during the
`/sp:dev-verify --fix all` pass on 2026-08-07, and were subsequently committed and **released by the
operator as 0.4.22** (with the `prepare` hook dropped — see below).

**Spur (`~/xprojects/spur-new`)**

| File | Change | Requirement |
| --- | --- | --- |
| `apps/cli/tests/commands/migrate-stubs.test.ts:192-196` | Pinned the `runs history analyze` import to `--source gemini` (a generic `sourceDefinition` still writing `history_etl_gemini`) and added a four-line comment naming the reason and pointing at 0474. Zero production diff. | R4 |
| `package.json:36` | `workspaces.catalog` entry for `@gobing-ai/ts-llm-jsonl-importer` bumped — first to `^0.4.20` in commit `5f692e96`, and now `^0.4.22` after the operator's release — so all consuming workspaces resolve the released copy instead of shadowing a same-version cached one. | R1 (identity half) |
| `.spur/context/pitfalls.md:245,247` | Recorded the source-conversion lesson (converting a source moves its rows to `history_message`/`history_tool_call`; pin generic-ETL assertions to a still-generic source) and the companion `bun link`-serves-`dist` stale-build trap. Tracked in git, so it lands in this task's commit. | R3 |
| `docs/tasks3/0474_*.md:48-56` | Appended the live-regression handoff: `analyze` returns zero records for all six sources 0466 converted (`claude`, `codex`, `pi`, `omp`, `grok`, `agy`), plus the `--source gemini` pin 0474's SQL cut-over removes. | R4 |
| `scripts/commands/link-check.ts` (new) | Consumer-side staleness guard: for every `@gobing-ai/*` node_modules entry that is a symlink resolving **outside** this repo's `node_modules`, compares the newest `src/**/*.ts` mtime against the newest `dist/**/*.js` mtime (every ts-libs package builds `include: ["src/**/*.ts"]` with tests in a sibling `tests/` dir, verified across all 8, so everything under `src/` is a build input) and fails with the package, offending file, and rebuild command. Store copies resolve *inside* `node_modules/.bun` and are skipped — they publish `src/` alongside `dist/` (`files: ["dist","src"]`), so a `src/` probe alone would false-alarm on every install. | R1 (link path) |
| `scripts/commands/link-check.test.ts` (new) | 7 tests pinning the comparison's direction — stale flagged, fresh passes, equal mtimes pass, never-built flagged, colocated test counted, store copies ignored, bare tree empty. The direction was inverted in the first draft; these tests are what caught it. | R1 (link path) |
| `scripts/spur-dev.ts:27,76-78` | Registered the `link-check` subcommand alongside `corpus-check`. | R1 (link path) |
| `package.json:78,83,86` | Added the `link-check` script and chained it first in `spur-check` and `spur-check:full` — first because a stale link invalidates every downstream result. | R1 (link path) |

**ts-libs (`~/xprojects/ts-libs/packages/llm-jsonl-importer`) — uncommitted**

| File | Change | Requirement |
| --- | --- | --- |
| `src/mappers.ts:1` | Deleted the package-wide `// @ts-nocheck` directive, restoring type checking over the 41 KB forensic-mapping file. | R2 |
| `src/mappers.ts:1038-1041` | Added the `o()` narrowing helper beside the existing `s()`: returns the value cast to `Record<string, unknown>` when it is a non-null object, `{}` otherwise. | R2 |
| `src/mappers.ts:213,218,301,314,318,390,414` | Rewrote the seven `unknown?.` sites per the `### Design` § P2 table — e.g. `s(r.id, r.session?.id)` → `s(r.id, o(r.session).id)`, and the nested `raw.turn_context?.payload?.model` → `o(o(raw.turn_context).payload).model`. | R2 |
| `package.json` | A `"prepare": "bun run build"` hook was added here during the fix pass, then **removed by the operator** (`8e71310`) once verification showed it cannot cover the `bun link` path. 0.4.22 ships without it. The registry path is guarded by the pre-existing `prepublishOnly: bun run build`; the link path by Spur-side `link-check`. | R1 |

**Root cause addressed.** Both R1 and R2 trace to the same class of silent failure: something the
toolchain was *trusting* rather than *checking*. `dist/` was trusted to match `src/` (it did not — seven
source files were newer than their build), and `mappers.ts` was trusted to be correct behind a blanket
`@ts-nocheck` (it hid seven real `TS2339` errors). The fix in both cases is to make the check
non-optional rather than to work around the symptom.

**Why a consumer-side guard and no `prepare` at all.** The task's `### Design` § P1 assumed `prepare`
fires on `bun link`. It does not: Bun enqueues lifecycle scripts only for `ResolutionTag::Git |
Github | Root` and `Workspace` (`src/install/lockfile/Package/Scripts.rs:167-194`), and `bun link`
produces a `Symlink` resolution (`src/install/resolution.rs:84-91`). `prepare` therefore closes the
ts-libs-side `bun install` case only. The link case — the one that actually cost 77 minutes — has to
be caught where the stale bytes are consumed, so the guard lives in Spur and holds regardless of any
package manager's lifecycle semantics. It fails loudly rather than rebuilding silently: a check with a
hidden side effect into another repo would contradict this project's deterministic-over-hidden-automation
standard. `prepare` was then dropped from the package entirely: for Spur it was never load-bearing —
Spur consumes the registry tarball, whose `dist/` is built at publish time by the pre-existing
`prepublishOnly` — and keeping it would have made any importer type error break `bun install` in ts-libs
for no Spur-side benefit.

**Released state.** ts-libs `0.4.22` carries the R2 fix; Spur's catalog is `^0.4.22` and all three
consuming workspaces resolve to that store copy, so the fix is in the bytes Spur actually loads rather
than in an uncommitted working tree.

**Why `o()` and not a compiler-flag relaxation.** The seven errors are `TS2339`
("Property 'x' does not exist on type '{}'"), produced by optional chaining on an `unknown` value —
TypeScript narrows the non-nullish branch of `unknown?.` to `{}`, which has no properties.
`noUncheckedIndexedAccess` produces `TS18048`/`TS2532` instead and is not implicated; disabling it
leaves all seven errors standing (measured). `o()` fixes them at the expression, so
`tooling/typescript/base.json` stays untouched and the flag stays enabled.

**Deliberately not done.** No change to `queryAllEtlRecords`, `SOURCE_TABLES`, or any analytics
production code — `git diff HEAD -- packages/domain/src/analytics/query.ts` is empty. That path belongs
to 0474 (which retires `queryAllEtlRecords` outright, its R7) and 0467 (which owns the `SOURCE_TABLES`
allowlist). Building the union here would have meant writing code 0474 deletes. No commit, tag, push, or
publish in either repo.
### Testing
**Verdict: PARTIAL** — re-audit 2026-08-08 via the E1 verifyall batch (`--auto --force --focus all --fix all --next`). All evidence below was re-run fresh this run; every `file:line` anchor was re-read at the cited lines. R1–R4 MET on fresh targeted evidence; R5 PARTIAL — the full-repo gate it names (`bun run lint`, `bun run test`) is prohibited by the batch run-scope constraint, so freshness rests on scoped proxies (all green). The completion-time full-gate result (2026-08-07: lint exit 0; 4580 pass / 24 fail of 4604, all 24 sandbox `Bun.serve` port-binding denials) stands recorded but is not re-certified.

**Tree-state note (successor drift, not a defect).** Since 0468 closed, sibling E1 tasks have landed in this worktree: 0474's in-flight SQL cut-over removed the `--source gemini` pin from `apps/cli/tests/commands/migrate-stubs.test.ts` (the test now imports `--source claude`, current `:198`) — exactly the successor action 0468's design prescribed ("This task's SQL cut-over restores coverage for all six converted sources and removes that pin", `docs/tasks3/0474_*.md:51-58`). The test stays green (4 pass / 0 fail, fresh). 0468's own commits (`6052ef51`, `5f692e96`, `84842e8f`) remain the scope baseline: zero analytics production change.

**Fix pass (`--fix all`).** No UNMET requirement/AC and no unresolved major finding — nothing repaired. R5's PARTIAL is not fixable inside the batch run-scope constraint (the only certifying commands are the prohibited full-repo runs); residual reported, no retry per the bounded-loop rule. Ledger: `.spur/run/0468-fix-created.json` (zero entries this run). `--next`: no-op — task already terminal (done).

**Per-Requirement Traceability**

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | Registry path: consumed store copy declares `prepublishOnly: "bun run build"` (`node_modules/.bun/@gobing-ai+ts-llm-jsonl-importer@0.4.22+d5c29f764bf0e6e0/node_modules/@gobing-ai/ts-llm-jsonl-importer/package.json:46`, re-read) and its `dist/mappers.js` carries `function o(` (grep count 1) matching its `src/mappers.ts` — the shipped dist is built from the shipped src. Link path: `bun run link-check` → exit 0 fresh ("no linked @gobing-ai package is serving a stale dist/"), chained first in `spur-check` / `spur-check:full` (`package.json:78,83,86`, re-read); `bun test scripts/commands/link-check.test.ts` → 7 pass / 0 fail fresh, pinning both directions (`flags a linked package whose dist is older than its src`, `flags a linked package that was never built at all`, `ignores a Bun store copy, whose realpath stays inside node_modules`). Identity: catalog `^0.4.22` (`package.json:36`, re-read); `Bun.resolveSync` from `packages/app`, `packages/domain`, and `apps/cli` each → `node_modules/.bun/@gobing-ai+ts-llm-jsonl-importer@0.4.22+d5c29f764bf0e6e0/…/dist/index.js` (fresh this run). |
| R2 | MET | `bunx tsc -p tsconfig.build.json` in `~/xprojects/ts-libs/packages/llm-jsonl-importer` → exit 0 fresh (0 `TS2339`); `noUncheckedIndexedAccess: true` retained (`tooling/typescript/base.json:16`, re-read); store-copy `src/mappers.ts` `@ts-nocheck` count 0 with the `o()` helper present, and `dist/mappers.js` carries `function o(` (count 1) — the fix is in the bytes Spur loads; importer suite fresh: 174 pass / 0 fail across 10 files (grew from 164 via later upstream work). |
| R3 | MET | `.spur/context/pitfalls.md:245` re-read — "Converting a built-in history source to a custom mapper moves its rows to different tables — any test or query asserting the generic ETL path must pin a still-generic source"; `:247` re-read — "A `bun link`-ed package serves its `dist/`, never `src/` — an unbuilt ts-libs edit looks applied and isn't". Both anchors exact and name the R3 subjects. |
| R4 | MET | `bun test apps/cli/tests/commands/migrate-stubs.test.ts` → 4 pass / 0 fail / 50 expect() fresh. 0468 made zero analytics production change: `git show 6052ef51 --stat` → only `.spur/context/pitfalls.md` + the test file (2 files). Handoff intact at `docs/tasks3/0474_*.md:51-58` (re-read: names all six blind sources `claude`, `codex`, `pi`, `omp`, `grok`, `agy` and the gemini pin as the interim measure 0474's cut-over removes). The pin's subsequent removal by 0474 is the designed successor action — see tree-state note. |
| R5 | PARTIAL | Full-gate re-run prohibited by batch run-scope constraint (no `bun run lint` / `bun run test` this run). Scoped proxies fresh: `bunx biome check` on all five Spur files 0468 touched (`scripts/commands/link-check.ts`, `scripts/commands/link-check.test.ts`, `scripts/spur-dev.ts`, `apps/cli/tests/commands/migrate-stubs.test.ts`, `package.json`) → clean, exit 0; `apps/cli` `tsc --noEmit` → exit 0; targeted suites green (migrate-stubs 4/0, link-check 7/7, importer 174/0). Not re-certified: project-wide lint + full suite. |

**Acceptance Criteria Verification**

| AC | Status | Evidence Type | Evidence |
| --- | --- | --- | --- |
| R1 — the published copy's dist always matches its src (registry path) | MET | command | Store-copy `package.json:46` declares `prepublishOnly: "bun run build"` (re-read); its `dist/mappers.js` contains `function o(` (grep count 1), the helper added to its `src/mappers.ts` — shipped build is from shipped source. |
| R1 — a stale dist cannot masquerade as an applied edit (link path) | MET | test + command | No live `bun link` exists this run (resolution is store copies), so the stale-direction proof rests on fixtures: `bun test scripts/commands/link-check.test.ts` → 7/7 fresh, including `flags a linked package whose dist is older than its src` and `flags a linked package that was never built at all`; live run `bun run link-check` → exit 0; guard is chained into `spur-check` (`package.json:78`). Failure output names package, offending file, and rebuild command (pinned by the same tests). |
| R1 — the guard does not false-alarm on registry copies | MET | command | `bun run link-check` → "link-check OK", exit 0, fresh, with all `@gobing-ai/*` store copies present; regression-pinned by `ignores a Bun store copy, whose realpath stays inside node_modules` (`scripts/commands/link-check.test.ts:90`, re-read). |
| R1 — the identity trap is resolved by a real release | MET | command | `package.json:36` catalog `^0.4.22`; `Bun.resolveSync` from all three consuming workspaces → `…@gobing-ai+ts-llm-jsonl-importer@0.4.22+d5c29f764bf0e6e0/…/dist/index.js` (fresh) — the version is in the resolved path; no version work deferred. |
| R2 — mappers.ts type-checks without suppression | MET | command | No `@ts-nocheck` in `src/mappers.ts` (count 0); `bunx tsc -p tsconfig.build.json` → exit 0, 0 `TS2339`; `noUncheckedIndexedAccess: true` at `tooling/typescript/base.json:16` (re-read); importer suite 174 pass / 0 fail fresh. |
| R2 — the fix reaches the copy Spur actually loads | MET | command | Store copy `…@0.4.22+…/src/mappers.ts`: `@ts-nocheck` count 0, `function o(value: unknown)` present (count 1); `dist/mappers.js`: `function o(` count 1. All three workspaces resolve to this copy (fresh `Bun.resolveSync`). |
| R4 — the analyze test is green without touching analytics | MET | command | `bun test apps/cli/tests/commands/migrate-stubs.test.ts` → 4 pass / 0 fail fresh. 0468's diff touched zero analytics production code (`git show 6052ef51 --stat`: 2 files, neither under `packages/domain/`). The "byte-identical to HEAD" clause was time-bound to 0468's completion; 0474's owned in-flight cut-over has since modified `packages/domain/src/analytics/` as designed (0474 R7 retires `queryAllEtlRecords`). |
| R4 — the analyze regression is handed off, not dropped | MET | static-ref | `docs/tasks3/0474_*.md:51-58` re-read — "Live regression this task owns (handed off from task 0468 R4)…" names all six blind sources (`claude`, `codex`, `pi`, `omp`, `grok`, `agy`) and records the `--source gemini` pin as the interim measure. (Prior anchor `:48-56` shifted to `:51-58` after 0474 edits; refreshed here.) |
| R5 — the gate holds | PARTIAL | command | Scoped proxies only, per batch run-scope constraint: biome clean on 0468-touched files (exit 0), `apps/cli` typecheck exit 0, targeted suites 4/0 + 7/7 + 174/0. Full `bun run lint` / `bun run test` not re-run this run; completion-time result (lint exit 0; 4580/24/4604, all 24 sandbox port-binding) recorded 2026-08-07. |

**Aggregation:** R1–R4 MET with fresh evidence, 8/9 AC MET, R5 + its AC PARTIAL (batch run-scope constraint, not an observed regression), no blocker and no unresolved major finding ⇒ **PARTIAL** (core PARTIAL, no FAIL).

**Design conformance**

| Check | Status | Evidence |
| --- | --- | --- |
| design-conformance | pass | Re-classified this run against 0468's commits: 8/10 claims DONE; 2 CHANGED, both documented in `### Solution` — the `prepare`-on-link premise (falsified at Bun source, hook dropped by operator ts-libs `8e71310`, link path covered by `link-check` instead) and the `packages/app` root-link resolution claim (post-release all three workspaces resolve the 0.4.22 store copy — goal-equivalent). No undocumented deviation found. |
| scope-creep | pass | 0468's commits touch exactly the planned files (test pin + comment, pitfalls lessons, catalog bump, task docs, link-check guard + wiring). The dirty working tree (`apps/cli/src/commands/history.ts`, analytics package, sibling task files, …) belongs to concurrent E1 sibling tasks (0469/0470/0471/0474/0477/0480/0482), not 0468. |

**SECUA Review** (`--focus all`) — no blockers, no unresolved majors; minors carried from the prior review, re-confirmed this run.

- **minor / Efficiency** — `o()` allocates a fresh `{}` per non-object call in a per-record mapping path (store-copy `src/mappers.ts`, helper beside `s()`). Negligible against `JSON.parse` on the same record. Accepted.
- **minor / Usability (docs)** — `docs/tasks3/0474_*.md` handoff paragraph still cites `packages/domain/src/analytics/query.ts:8-19` for `SOURCE_TABLES` (span was `8-16`; file now under 0474's in-flight edit). Sibling task's file; fix when 0474 is next edited.
- **minor / Environment** — full-repo gate not re-runnable under the batch constraint (see R5). No defect; policy-bound evidence gap only.
- **Security / Correctness / Architecture** — clean on re-look. `o()` is behaviour-preserving against the `?.` it replaces; `link-check` fails in the safe direction (false alarm carries its own fix command, never a missed staleness); no new trust boundary, secret, or injection surface in 0468's diff.

Coverage: N/A for the Spur-side diff (test-source pin + catalog bump + guard script; the guard carries its own 7-test suite, 7/7 fresh). Upstream importer coverage is measured by its own suite: 174 pass / 0 fail fresh this run.
### Review
**Review (0468) — review mode (`sp:code-verification` Steps 3+7+10), three-dimensional, 2026-08-07.**
Diff scope: Spur commits `6052ef51` (test-source pin + comment), `5f692e96` (catalog `^0.4.20`),
`84842e8f` (task docs), plus this run's `--fix all` cross-repo pass in
`~/xprojects/ts-libs/packages/llm-jsonl-importer` (`src/mappers.ts`, `package.json`).
Aggregated verdict: **PASS** — functional PASS (5/5 requirements MET, 9/9 AC MET); SECUA PASS: the one
major and two of the three minors were resolved rather than deferred; architecture PASS with 1 advisory.
Re-verified 2026-08-07 against released ts-libs **0.4.22**, which Spur now consumes.

| Pri | Finding | Disposition |
|-----|---------|-------------|
| P1 | None — no blocker. `o()` is behaviour-preserving against the `?.` it replaces (null / undefined / primitive / array inputs all still yield `undefined` downstream), introduces no trust boundary, and feeds `s()`, which type-guards to `string`/`number`. Importer suite 164 pass / 0 fail confirms no runtime drift. | N/A |
| P2 → **RESOLVED** | **The `prepare` hook does not cover the failure it was chosen to prevent — `### Design` § P1's premise is false.** Verified against Bun `1.3.14` source: `src/install/lockfile/Package/Scripts.rs:167-194` enqueues prepare scripts only for `ResolutionTag::Git \| Github \| Root` and `Workspace`; all other tags hit `_ => {}`. `src/install/resolution.rs:84-91` lists `Symlink` (what `bun link` produces) among the excluded. Bun's docs concur — `docs/pm/cli/install.mdx:38` scopes lifecycle scripts to "**your project's**"; `docs/pm/cli/link.mdx` never mentions `prepare`. | **Closed this run**, not deferred. Added `scripts/commands/link-check.ts` + `bun run link-check`, chained first into `spur-check`/`spur-check:full`: it compares newest build input vs newest build output for every `@gobing-ai/*` entry resolving outside this repo's `node_modules`, and fails with the package, offending file, and rebuild command. Verified live in both directions against the ts-libs link; 7 unit tests. `prepare` kept — it still closes the ts-libs-side `bun install` case. AC amended (operator-approved) from mechanism to outcome. |
| P2 → **CLEARED** | **R1/R2 were satisfied only in an uncommitted working tree of a second repo.** `~/xprojects/ts-libs` tracked diff is `packages/llm-jsonl-importer/{package.json,src/mappers.ts}` — nothing committed, tagged, pushed, or published. Spur still consumes registry `0.4.20`, which retains `@ts-nocheck` and has no `prepare`. A `git checkout` in ts-libs silently reverts both. | **Resolved 2026-08-07** — the operator committed the ts-libs work and released **0.4.22**, bumped Spur's catalog to `^0.4.22`, and ran `bun install` at the repo root. Verified here: all three consuming workspaces resolve to `…@0.4.22/…`, and that copy's `src/mappers.ts` carries no `@ts-nocheck` while its `dist/mappers.js` carries the `o()` helper. The fix is in the bytes Spur loads. |
| P3 | **Efficiency** — `src/mappers.ts:1039`: `o()` allocates a fresh `{}` on every non-object call, in a per-record mapping path over JSONL history. | Accepted. Negligible against `JSON.parse` cost on the same record. Hoist a shared frozen empty object only if importer throughput is measured as a bottleneck. |
| P3 → **CLEARED** | **Environment** — `bun install` cannot run under the verification sandbox (`unable to write files to tempdir: PermissionDenied`). | No longer material. The operator ran a real `bun install` at the repo root; the resulting resolution was verified here directly (`Bun.resolveSync` per workspace → `…@0.4.22/…`). Source reading had already been sufficient to *falsify* the link claim, so the sandbox limit never masked a defect. |
| P3 | **Usability (docs)** — `docs/tasks3/0474_*.md:52` cites `packages/domain/src/analytics/query.ts:8-19` for `SOURCE_TABLES`, which spans `8-16`. | Non-blocking; fix when 0474 is next edited. The handoff content itself is correct and complete (all six blind sources named at `:48-56`). |
| P4 | **Architecture (advisory)** — `src/mappers.ts` is ~1040 lines / 41 KB carrying forensic field mapping for ten sources behind one module. Now that `@ts-nocheck` is gone the compiler covers it, but the locality signal stands: per-source mapper modules over a shared narrowing kit would shrink the blast radius of any single source's schema drift. | Out of scope — the requirement was to restore type coverage, not restructure. Candidate for a future `sp:code-improvement` pass if source count keeps growing. |

**One defect found in the guard itself, before it shipped.** The first draft inverted the staleness
comparison (skipping the stale case and reporting the fresh one), and a second draft false-alarmed on
every Bun store copy — the assumption that "a store copy has no `src/`" is wrong, since these packages
publish `files: ["dist", "src"]`. Store copies are separated instead by realpath: a store copy stays
inside `node_modules/.bun`, a `bun link` always escapes the repo. Both defects are pinned by tests.

**Process note — how the P2 was caught.** R1 was first certified MET in this same run on the assumption
that `prepare` fires on link, taken from `### Design` § P1 without checking. The claim was only tested
when a confidence level had to be attached to it, and it failed. The generalizable lesson: a design
premise inherited from the task text is *not* verified evidence, and an AC whose When-clause names a
third-party tool's behaviour needs that tool's source or docs cited, not the task's own restatement of it.

**Design conformance:** 8/10 claims DONE, 1 CHANGED, 1 FALSIFIED. FALSIFIED is the P2 above. CHANGED:
§ P1 asserts `packages/app` resolves through the root link to `~/xprojects/ts-libs/.../dist/index.js`;
measured this run, `packages/app`, `packages/domain`, and `apps/cli` all resolve to
`node_modules/.bun/@gobing-ai+ts-llm-jsonl-importer@0.4.22+.../dist/index.js` (measured post-release), and only the repo root
still resolves via the global link. The catalog bump changed resolution after the Design text
was written, in the direction P1 wanted — goal-equivalent, no downgrade for that one.

**Scope creep:** none attributable. The uncommitted working-tree changes (`.gitignore` +1,
`packages/app/tests/services/history-service.test.ts` +50) predate this run and belong to other work.

**Residual risk:** (a) `link-check` is mtime-based, so clock skew or a bare `touch` produces a false
alarm — it fails in the safe direction (a spurious gate failure carrying its own fix command, never a
missed staleness); (b) `link-check` guards only the `bun link` path, by design — the registry path relies on
`prepublishOnly` running at publish time (`bun` docs `pm/lifecycle.mdx:11`), and that is **not
unconditional**: `pm/cli/publish.mdx:44-45` states `bun publish` skips
`prepublishOnly/prepack/prepare/postpack/publish/postpublish` "if a tarball path is provided —
scripts run only when `bun publish` packs the package itself". ts-libs publishes through GitHub
Actions via Trusted Publishing, and that workflow was not read here, so whether it packs in-place or
passes a prebuilt tarball is unverified. For 0.4.22 the *outcome* is confirmed regardless — the
consumed tarball's `dist/mappers.js` carries the `o()` helper added to `src/` — but a future release
that switches to a tarball-path publish would silently drop the guarantee. Worth one look at the
workflow, or a `link-check`-style freshness assert in CI before publish; (c) the 24 full-suite failures are sandbox `Bun.serve` port-binding denials — if that count
moves, re-triage rather than assuming the same class.
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
### History

- 2026-08-07T18:22:04.841Z todo → wip (system)
- 2026-08-07T18:38:03.929Z wip → testing (system)
- 2026-08-07T18:39:33.398Z testing → done (system)
- 2026-08-07T18:43:39.468Z done → wip (system)
- 2026-08-07T18:56:21.153Z wip → testing (system)
- 2026-08-07T18:56:21.709Z testing → done (system)
