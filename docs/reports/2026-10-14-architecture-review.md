# Spur architecture review — legacy, overengineering, perfunctory verification

Base: `origin/main` @ `df451f601` (0.4.5, 2026-10-14). Branch: `refactor/architecture-simplify`.
PRs #7, #8 and #9 are merged on this base.
Tools: `knip@5` (unused files, exports and deps), `git grep` checks on every "unused" claim
(including plugin hooks.json, `superskill script convert` lists, generated bundles and package
`exports`), the baseline `bun run gate`, and reading the verification code.

Size: about 177k lines of non-test TS/TSX across 3,497 tracked files. In `packages/app/src/services`
alone, 5 files are over 2,000 lines (`agent-service.ts` 3,378, `workflow-service.ts` 2,910,
`task-service.ts` 2,634, `inline-run-setup.ts` 2,483, `task-check.ts` 2,011).

Ratings: **Impact** H/M/L · **Effort** S/M/L · **Action**: FIXED in this PR, or REC (recommended
only, because it is risky or needs a product decision).

---

## 1. Legacy and stale

| # | Finding | Evidence | I/E | Action |
|---|---|---|---|---|
| L1 | Dead web components with no importers: `SettingsModal`, `SmokeIsland`, `observability/ProcessListTab` (211 lines) and `observability/ToolUsingTab` (451 lines, a stale fork of the live `history/ToolUsingTab.tsx`). | knip "unused files". `git grep` finds no import in `apps/web/src` or `apps/web/tests`. Only old task docs mention them. | M/S | FIXED |
| L2 | `apps/web/src/modules/projects/AgentsView.tsx` is a one-line re-export of `settings/AgentsView`, and nothing imports it. | `git grep "AgentsView" apps/web` shows only `settings/tabs.tsx` importing `./AgentsView` (the settings one). | L/S | FIXED |
| L3 | `packages/domain/src/types.ts` is a type barrel that is not in the package `exports` and is not imported anywhere. Its doc comment claims a "stable type surface" that does not exist. All `./types` imports go to `analytics/types`. | `packages/domain/package.json` has no `types` export. `git grep "domain/src/types"` returns nothing. | L/S | FIXED |
| L4 | `@dnd-kit/sortable` is declared in `apps/web/package.json` but never imported. Only `@dnd-kit/core` is used. | knip "unused dependencies". `git grep dnd-kit apps/web/src` shows only `@dnd-kit/core`. | L/S | FIXED |
| L5 | `bun.lock` was stale after the 0.4.5 bump: workspace versions still read 0.4.3. The release commit skipped CI, so the next `bun install --frozen-lockfile` in CI would hit the drift. | `git diff bun.lock` after `bun install`. | M/S | FIXED |
| L6 | Stale design comment in `done-transition-guard.ts` (header): "the aggregation rule is duplicated here intentionally". Since 0592 the guard delegates to `aggregateVerifyVerdict`. | `done-transition-guard.ts:computeAggregate` | L/S | FIXED |
| L7 | One-off verification scripts left in the docs tree: `docs/reports/i31/{0903,0904,0905,0912,next-batch}-check.ts`. Nothing runs them. | knip "unused files". No script, test or workflow references them. | L/S | REC (historical report artifacts; the owner decides whether reports keep their probes) |
| L8 | Duplicate exports and aliases kept for old names: `quality-gate.ts:512 scopeFromFiles = lightScope`, `domain/planning/schema.ts:391 TASK_TEMPLATES = TASK_VARIANTS`, `services/event-names.ts` exporting the same arrays under two names, and default + named exports for every `history/*Tab.tsx`. | knip "duplicate exports". | L/M | REC (`scopeFromFiles` is pinned in the generated plugin-lib `.d.mts` contract by `scripts/commands/bundle-plugin-lib.ts:542`, so removing it means regenerating the plugin bundles) |
| L9 | About 100 unused exports, mostly test-only seams (`resetAgentUsageSourceForTesting`, `existingRunRefusal`, ...) and internal helpers exported for unit tests (`apps/web/src/modules/history/ToolCallDetail.tsx` exports 12 helpers). | knip "unused exports" (104 values, about 200 types). | L/M | REC (many are deliberate test seams, so prune case by case) |
| L10 | Three live transition shims (`config/transition-shims.json`: `agent-bare-binary-name`, `spec-without-executor-field`, `agent-default-executor`) are each guarded by a 241-line gate script. Their removal conditions are objectively checkable, but nobody has run them. | `scripts/commands/transition-shim-check.ts`, `agent-service.ts:2918,2937`, `apps/cli/src/commands/agent.ts:1568` | M/M | **PARTLY FIXED** (owner decision): `spec-without-executor-field` and `agent-default-executor` were removed, and both now fail with an actionable error. `agent-bare-binary-name` is kept pending a decision. |
| L11 | `package.json` duplicates scripts: `spur-check-new` equals `spur-check`, `spur-check-new:full` equals `spur-check:full`, and `check:full` equals `check`. | `package.json` scripts. Tests pin the identity (`apps/cli/tests/commands/task.test.ts:107`, `plugins/sp/tests/feature-verification-scope.test.ts:56`). | L/S | REC (named in skills and docs, so this needs a deprecation pass) |

knip false positives I checked and kept: `plugins/sp/hooks/*` and `plugins/sp/scripts/*` (loaded via
`hooks.json` and `superskill script convert`), `plugins/sp/lib/*.generated.*` (bundled
contracts), the root deps `@gobing-ai/ts-ai-runner`/`ts-llm-jsonl-importer`/`ts-rule-engine`
(used by plugin libs and scripts, which have no own package.json), `apps/web/scripts/host-inventory.ts`
(spawned by `board-runtime.ts:172`), and the `ts-decision-fm` catalog pin (asserted by
`dependency-drift-check`).

## 2. Overengineering

| # | Finding | Evidence | I/E | Action |
|---|---|---|---|---|
| O1 | Three copies of the verdict union `'PASS'|'PARTIAL'|'FAIL'|'UNKNOWN'`, plus two `VerifyVerdict` interfaces (`task-record.ts:41` and the canonical `verify-verdict.ts:60`) and a third `VerdictArtifact` (`done-transition-guard.ts:51`). | `verify-verdict.ts:31`, `done-transition-guard.ts:42`, `task-verdict.ts:19,447`, `task-record.ts:43` | M/S (type) · M/M (interfaces) | Type FIXED (one `VerdictAggregate`). Interfaces REC: fold `VerdictArtifact` and `task-record.VerifyVerdict` into the zod-derived canonical type. |
| O2 | A generic "evidence channel" allowlist framework (parser, allowlist, injected DB counter, fail-closed taxonomy) serves exactly one channel. | `packages/app/src/services/task-evidence-precheck.ts` (114 lines + deps wiring in `task-check.ts:640`), `ALLOWED_EVIDENCE_CHANNELS` has 1 entry | L/S | REC (collapse to a single named precheck if no second channel is planned) |
| O3 | `feature-verification-steps.ts` has a `--module-mode source` path whose only job is to throw an explanatory error, and a `spurBin` arg kept "only to make the failure message actionable". | `plugins/sp/scripts/feature-verification-steps.ts:44-75` | L/S | REC (a flag on a shipped plugin script; drop it once the workflows stop passing it) |
| O4 | `build:scripts` hand-lists 22 `superskill script convert` calls, while `config/plugin-scripts.json` is the manifest `script-contract-check` already enforces. That gives two sources of truth for the same list. | `package.json` `build:scripts`, `scripts/commands/script-contract-check.ts` | M/S | REC (generate the convert loop from the manifest) |
| O5 | God-services. `agent-service.ts` (3,378 lines), `workflow-service.ts` (2,910) and `task-service.ts` (2,634) mix policy, IO and formatting, and `packages/app/src/index.ts` re-exports 1,215 lines of surface. The CLI command files are also large (`workflow.ts` 2,441, `task.ts` 2,082, `agent.ts` 1,901), so "apps are thin transports" (ADR-021) is only partly true. | `wc -l` | H/L | REC (a big redesign; split by sub-domain incrementally) |
| O6 | Gate-script proliferation: `spur-check-feature` chains 8 bespoke checker scripts (link, transition-shim, script-contract, inline-pipeline-parity, workflow-promotion, dependency-drift, importer-schema, history-surface-freeze), each with its own CLI, argument parser and tests. | `package.json` `spur-check-feature`, `scripts/commands/*-check.ts` | M/L | REC (fold them into `spur rule` presets or one `spur-dev check <name>` runner) |

## 3. Perfunctory verification

| # | Finding | What a real check verifies | I/E | Action |
|---|---|---|---|---|
| P1 | **A MET row cites evidence that is never checked.** `aggregateVerifyVerdict` (`verify-verdict.ts:isHollowMet`) only requires a non-empty evidence *string*, so a MET row citing a test file that does not exist (fabricated, renamed or deleted) still let `spur task update <wbs> done` pass. | Every repo-relative `*.test.*`/`*.spec.*` path cited by a MET requirement or AC row must exist in the project at done time. | H/S | **FIXED**: `findUnresolvedTestEvidence` + deny in `evaluateDoneTransition` (`done-transition-guard.ts`), wired in `task-transition.ts`. `--force-done --reason` still overrides. |
| P2 | **The verifier can waive the executable-evidence rule for its own rows.** `task-verdict.ts:324 requiresExecutableEvidence` exempts any AC whose id *in the verify answer* contains `[advisory]`, `[non-core]`, `[docs-only]` or `[non-behavior]`, so an LLM-judged or manual-review row can reach MET just by tagging its own id. | The exemption tag must come from the task file's own Acceptance Criteria (authored at plan time), not from the answer being judged. | H/M | **FIXED** (owner-approved): `deriveVerdict` takes exemption tags only from the task file's Acceptance Criteria (`taskAcExemptions`, wired via `readTaskAcceptanceCriteria` in `spur task verdict`). A tag that appears only in the answer is ignored and flagged by an advisory `ac-exemption-not-in-task` check. |
| P3 | **Test evidence is not tied to a test run.** Even with P1, a cited test only has to *exist*. Nothing proves it ran in the gate that produced the verdict, or that it passed. | Record the per-file test results of the canonical run (Bun JUnit reporter or the existing coverage-certification digest) and require cited tests to appear as passing in a run newer than the last source change. | H/M | REC (needs a results artifact; coverage-certification is the natural owner) |
| P4 | **The coverage gate skips whole layers.** `bunfig.toml` `coveragePathIgnorePatterns` excludes `**/*.tsx` (the entire web board) and `scripts/**` (every gate checker), so the per-file 90/90 rule never measures the UI or the checkers that enforce the gates. `passWithNoTests = true` also lets an empty test selection pass. | Measure `scripts/**`, or at least the gate checkers, and set `passWithNoTests = false` for the root gate. | M/S | **DEFERRED BY OWNER**: `scripts/**` is slated to be dropped or absorbed into the spur CLI, so `bunfig.toml` stays as it is for now. |
| P5 | **Feature verification runs outside the quality gate.** `bun run gate` does not run `spur-check-feature`, `test-repo-wide` or `test:heavy`. They run only when someone remembers the per-feature pass. | CI or the release flow should run `spur-check-feature` on every PR that touches gated surfaces. | M/S | **DEFERRED BY OWNER**: `spur-check-feature` is not mature enough yet to join `gate` or CI. |
| P6 | **A test passed on CI only through registry auto-install.** `plugins/sp/tests/feature-verification-steps.test.ts` resolved `@gobing-ai/spur` by Bun auto-installing the *published* package, so it verified whatever version npm served, not the workspace. It failed on any machine with an ancestor `node_modules`, which was the baseline gate's only failure. | The fixture should link the workspace package. | M/S | FIXED |
| P7 | `feature-verification-steps` "always exits 0" and relies on the transition guard reading the status file. This is fail-closed only if the guard is the sole consumer. | Keep it: the guard and `feature-check` read the receipt. Noted so nobody adds a consumer that treats exit 0 as PASS. | L/– | none |

What already holds up (so it is not reported as perfunctory): the done guard denies a missing,
malformed or foreign-identity verdict (`done-transition-guard.ts:readVerdictFrom`), it recomputes
the aggregate from rows (R10) and takes the harsher value, a row-less PASS reads as UNKNOWN, and
coverage post-checks refuse uncertified `lcov.info` (`coverage-provenance-check.ts`).

---

## Done in this PR vs recommended

FIXED: L1–L6, L10 (2 of 3 shims), O1 (the type), P1, P2, P6.
DEFERRED BY OWNER: P4 (scripts/** is slated to be dropped or absorbed into the spur CLI) and P5 (spur-check-feature is not mature enough yet).
REC: L7–L9, L10 (`agent-bare-binary-name`, pending), L11, O1 (interfaces), O2–O6, P3.
