---
schema_version: 1
name: "Session triage: history-board time-window flake, serve --cwd half-scoping, startup drain gap"
status: done
template: issue
created_at: 2026-09-08T05:46:02.113Z
updated_at: "2026-09-08T18:28:09.003Z"

---

## 0805. Session triage: history-board time-window flake, serve --cwd half-scoping, startup drain gap

### Background

Revalidated on 2026-09-08 against the 0.3.76 source baseline d37c1f6b3 (subsequent HEAD changes during refinement are task documentation only). This register separates confirmed source gaps from historical observations. Requirements-only refinement: no production code, host configuration, daemon or runtime data was changed.

| Original item | Disposition | Current evidence / corrected scope |
| --- | --- | --- |
| R1 history-board flake | Retain as bounded investigation; root cause unresolved | The fixture still inserts a message at Date.now minus 30 minutes, refreshes rollups and expects one tool-filtered session. The report establishes intermittent failures, not a daily 05:04–05:13 UTC recurrence or a proven clock bug. |
| R2 serve --cwd | Retain; correct source ownership and select full scoping | The CLI scopes the default DB path but does not pass cwd to startServer. Server configuration, filesystem/context and scheduled child work derive from process.cwd. The server code is now in apps/server/src/serve.ts, not the old long CLI file. |
| R3 startup drain | Retain; use existing awaited async drain | startAgentQuotaUpdateConsumer already returns drain(). Startup subscribes and starts polling without awaiting it. This is a pending-update-before-dispatch gap; supervised-agent autostart is not itself proof of executor selection. |
| R4 DB-lock incident | Narrow to accurate remediation wording | 0801 and 0803 are done and already own busy handling/watchdog work. errorMessage still says to stop the stale process or serve without establishing staleness. No daemon classifier, idle TTL or impossible zero-contention guarantee is needed. |
| R5 editor schema resolution | Defer outside implementation requirements | Current $schema is a package reference supported by the runtime loader. The old editor treated it as document-relative. No current yaml-ls diagnostic or active editor mapping was captured in this refinement; reinstalls and local copies may have changed that environment. |
| Background concurrent writes | Drop as new product work | One writer per worktree is already project policy. No evidence justifies a new cross-session commit guard. 0804 R5 owns the small dogfood advisory gap. |
| Background cast advisories | Drop as already mitigated | Both pi-lens-ignore comments remain adjacent to the documented SAFETY casts. No new suppression or checker work is requested. |

Historical evidence remains in docs/dogfood/2026-09-07-B5-executor-quota-dogfood.md (run 54D294E4D301) and this task's Git history. Original full-suite counts and /tmp paths are historical observations, not current verification results.

### Requirements

- [x] R1. Establish the cause or an explicitly unresolved disposition for the historical history-board tool-filtered 4h flake using a bounded, reproducible investigation. Preserve the one-session/700-token assertions and tool/model/source series semantics. Test controlled time and rollup freshness/read-path hypotheses before selecting a fix. If reproduced, correct the confirmed cause and retain the smallest regression; if not, record attempted cases and missing evidence without inventing a clock defect or making speculative production edits.
- [x] R2. Make the existing serve --cwd option select one coherent project root for server configuration, filesystem/task folders, DB defaults, quota updates and project-scoped scheduled/child work. Both canonical self serve and the hidden serve alias follow the same behavior. Resolve relative cwd against the invocation directory, validate the directory and preserve explicit DATABASE_URL precedence. Omitted cwd preserves existing behavior. Select full scoping, not a new mismatch-refusal mode; no new public command is proposed.
- [x] R3. Before startup admits workflow/executor dispatch, await one bounded pass of the existing quota consumer drain so successfully applied pending observations are visible at the first subsequent executor-resolution boundary. Preserve serialization, poll/event handling, version-aware acknowledgment and shutdown drain. Failed/deferred updates stay visible and pending under the existing nonfatal startup policy; do not claim disabled-executor exclusion when applying the disable failed. This does not redefine supervised team-agent eligibility.
- [x] R4. SQLite-busy remediation distinguishes the observed lock from unverified holder liveness: identify the holder, allow active work to finish/retry, and make any stop action an explicit operator decision after inspection. Do not call an arbitrary holder stale, recommend an unconditional kill or assert gates never contend. Preserve the recognizable busy-error classification for 0804 R3 and existing nonzero exits.

Non-goals: implementation in this refinement; new public nouns/verbs; global process.chdir as a server embedding workaround; clock injection without demonstrated need; daemon idle TTL/liveness framework; additional timeout tuning; automatic process termination; host lens configuration edits; schema copies/symlinks per YAML directory; new concurrency guards. Former R5 is an environment follow-up, not a completion condition.

### Acceptance Criteria

- [x] AC1 (R1): Given the original fixture semantics, when a bounded investigation exercises controlled times around the reported window and outside it, plus fresh/stale rollup paths and test isolation, then evidence identifies either a reproducible cause with a failing-before/passing-after regression or an explicitly unresolved result with exact commands, clock values and missing observations. No unsupported daily recurrence or forced production fix is claimed. A reproduced fix preserves session/token/series assertions and passes focused tests plus one full suite.
- [x] AC2 (R2): Given distinct projects A and B with different config/task roots, when either serve spelling launches from A with absolute or relative --cwd B, then server context/config, default DB and project-scoped child invocation use B while A is unchanged. Explicit DATABASE_URL retains precedence; omitted cwd uses A. A missing/non-directory target fails before server startup. Exercise the real startup composition with injected dependencies; the --json probe alone is insufficient.
- [x] AC3 (R3): Given a pending quota-disable observation and an eligible alternative executor, when server startup completes its initial drain and the first workflow dispatch resolves an executor, then it observes the persisted disable before a poll tick. An empty queue proceeds once; drain failure/deferred work is reported and retained without false acknowledgment or an infinite startup retry. Existing subscription, later poll, recovery and shutdown behavior remains covered.
- [x] AC4 (R4): Given a SQLITE_BUSY failure with no process-state evidence, when errorMessage renders remediation, then it names the lock and inspection/retry steps without declaring the holder stale or requiring a kill. Existing busy classification and CLI failure exit remain intact; 0804 retry fixtures accept the resulting diagnostic.

### Q&A

<!-- Clarifications and triage decisions. Keep empty if none. -->

#### Q&A entry — 2026-09-08T15:26:15.750Z

2026-09-08 operator instruction: evaluate/refine both tasks against the reinstalled current version, correct or drop stale items and add substantiated findings; do not implement. Both tasks remain todo.

Selected design directions: full project-root scoping for the existing --cwd option; reuse awaited async drain; diagnostic-only lock remediation. Rejected prescriptions: guaranteed daily flake recurrence, mandatory new clock interface, zero-contention guarantee, daemon TTL/liveness machinery, per-directory schema copies and new shared-checkout guards. Current history-flake cause remains unresolved; current host yaml-ls recurrence remains unverified. Neither uncertainty grants permission for speculative code or host edits.

### Design

Future implementation direction; not evidence of implemented behavior.

R1 — Investigation first. Follow getSummary -> toArtifactSelector -> historyBoardRollupsFresh -> selected rollup/mart/raw read path. The current selector subtracts four hours from Date.now; a message only 30 minutes old is well inside that window. An hour-boundary explanation therefore needs additional evidence. Compare message.ts, minute-normalized rollup timestamps and imported_at freshness independently. Use a controlled Date.now/test clock or explicit existing from/to filters before adding a service-wide clock interface. Isolate temporary DB/clock state and restore it after each case. Budget: at most six targeted controlled cases and one reduced-order run before recording an unresolved checkpoint; do not repeatedly launch the full suite to chase timing. An unresolved result retains the issue explicitly in Notes and does not count as a fixed defect.

R2 — CLI owns path normalization and passes the resolved project root through StartServerOptions into apps/server/src/serve.ts. Thread that root through existing config/bootstrap loading, filesystem/context creation, planning folders, project asset lookup and scheduled child cwd. Keep package-adjacent asset fallback distinct from project-relative paths. Reuse the existing server dependency-injection seam and CLI serve tests; avoid process.chdir because startServer is also an embedding API. Preserve existing environment/explicit database precedence and document the base for relative DATABASE_URL consistently with current behavior. Update docs/04_DESIGN.md with the existing --cwd contract when implementing. This refinement selects the intended fix but does not authorize implementation/public-surface mutations.

R3 — Await quotaConsumer.drain() at the composition root after subscription and before dispatch acceptance. No new synchronous consumer API or polling framework. Inspect the returned failed/deferred counts as well as thrown failures and preserve the current nonfatal server policy. The consumer's bounded attempts own retry limits. Test the workflow launch path that reloads config (apps/server/src/context.ts), rather than asserting startAutostart inherently reads executor profiles. Keep successful-drain visibility and failed-drain limitations explicit.

R4 — Edit the existing diagnostic and its tests only. Retain the SQLite database ... is busy prefix, removing the assumption of staleness from remediation prose. Holder inspection cannot prove a process is stale merely from a live child or lsof entry. 0803 owns periodic-job containment; 0804 R3 owns retry matching. No automatic signaling or process probing is added.

Deferred R5 owner: operator's active editor/lens adapter. If a fresh diagnostic recurs, capture its resolved schema URI and resolver/version; compare it with apps/cli/schemas/spur-config.schema.json and the installed package schema. Correct the owning editor association using its supported configuration after authorization. Runtime package-schema loading and editor URI resolution are separate contracts; a passing Spur gate does not prove yaml-ls resolution. Do not add build-time mirrors or change package schema semantics to accommodate an unverified host mapping.

### Plan

- [x] R1: Run the bounded controlled-time/read-path investigation, preserving exact fixture assertions; record cause and regression or the explicitly unresolved evidence gap.
- [x] R2: Trace all startServer callers and project-root consumers, thread one resolved root through existing composition seams, and cover A-to-B absolute/relative launches and override precedence.
- [x] R3: Await the existing initial drain, report failed/deferred summaries and prove successful updates affect first workflow executor resolution without waiting for polling.
- [x] R4: Correct remediation wording and coordinate busy-message compatibility with 0804 R3; retain current lock handling and watchdog behavior.
- [x] Close: Run focused tests and final code gates once for implemented changes; update the affected surface docs and task evidence through Spur. Report any unresolved R1 investigation separately from fixed behavior. Former R5 does not block completion.

### Root Cause

Confirmed:

- serve.ts CLI computes dbUrl from options.cwd but passes no project root into startServer. apps/server/src/serve.ts still uses process.cwd for bootstrap/config/context and project work. This establishes mixed scope when invoked outside the target project.
- startAgentQuotaUpdateConsumer installs subscriptions and a 30-second interval and exposes drain(); apps/server/src/serve.ts does not await a startup drain. Existing workflow launch config reload cannot observe a persisted disable before that update is applied.
- apps/cli/src/errors.ts renders a static stale-process/serve stop hint without checking holder state.

Unresolved:

- The history-board flake's underlying cause is not established. Current source retains the original seed and assertion, and its selector uses a relative four-hour subtraction. Historical passing/failing timestamps do not prove daily recurrence or clock-boundary causation.
- Current editor schema failure is not reproduced. Package $schema declarations and runtime package resolution exist; the old editor's document-relative resolution is a historical observation, not a confirmed missing-schema defect in the current product.

Already covered:

- Task 0801 owns CLI busy diagnostics/connection handling; this task narrows the remaining prose issue.
- Task 0803 owns scheduled history-child timeout/lock containment.
- Task 0804 R3 owns YAML retry classification; R5 owns dogfood worktree advice.

### Solution

| File | Change | What / why |
| --- | --- | --- |
| `packages/domain/src/analytics/history-board-rollup.ts:1283` | `bucketWindow` lower bound widened by one second | Stored `ts` carries fractional seconds that sort below the whole-second `>= bucket` bound, dropping first-second-of-minute delta rows from their own bucket's incremental recompute — the intermittent 4h history-board flake (R1). |
| `packages/domain/tests/analytics/history-board-rollup.test.ts:1285` | R1 regression test | First-second-of-minute delta rows survive incremental rollup (failing-before/passing-after); 53-test rollup suite green. |
| `apps/cli/src/commands/serve.ts:24` | `resolveServeCwd` — resolve/validate `--cwd` | Resolve relative `--cwd` against the invocation directory, require an existing directory BEFORE server startup (CommandError exit 1). |
| `apps/cli/src/commands/serve.ts:74` | Pass resolved root through to startServer | `StartServerOptions.cwd` receives the absolute root; omitted `--cwd` passes nothing (server falls back to `process.cwd()`); explicit `DATABASE_URL` precedence unchanged (R2). |
| `apps/cli/src/commands/serve.ts:39` | `RegisterServeOptions.startServer` injectable seam | Mirrors `StartServerDeps` so the CLI startup composition is testable with injected dependencies (AC2). |
| `apps/cli/src/commands/shared-options.ts:50` | Tightened `--cwd` (cwdServe) description | "Working directory" → project-root contract (server config/DB defaults/project-scoped work, resolved against the invocation directory). |
| `apps/server/src/serve.ts:99` | `StartServerOptions.cwd` + root threading | One resolved project root scopes config/bootstrap loading, filesystem/context, planning folders, web-dist lookup, DB defaults and project-scoped child work (R2). |
| `apps/server/src/serve.ts:579` | Startup drain pass after consumer start | Await one bounded pass of the existing serialized drain BEFORE autostart/dispatch; log applied/failed/deferred, report thrown failures nonfatally, never claim disabled-executor exclusion on a failed apply, empty queue proceeds once (R3). |
| `apps/cli/src/errors.ts:36` | SQLITE_BUSY remediation reworded | Name the lock, identify the holder (`lsof .spur/spur.db`), let active work finish/retry, stop only by explicit operator decision after inspection; no "stale"/unconditional kill/"never contend" (R4). |
| `apps/cli/tests/commands/serve.test.ts:120` | R2 CLI tests | `resolveServeCwd` (absolute/relative/missing/non-dir), action cwd pass-through, omitted-cwd fallback, `DATABASE_URL` precedence, pre-startup failure, `self serve` == hidden alias. |
| `apps/server/tests/serve.test.ts:600` | R2 composition + R3 tests | options.cwd threads into context/config/fs; startup drain applies persisted disable before first workflow launch (no poll); empty queue proceeds once; failed/deferred retained without false ack; thrown drain failure nonfatal. |
| `apps/cli/tests/errors.test.ts:62` | R4 diagnostics updated | Busy-diagnostic assertions accept the new inspection/retry/decision wording (no stale/kill assumptions). |
| `docs/04_DESIGN.md:1299` | `spur serve` row documents `--cwd` contract | Resolution against invocation dir, directory validation before startup, pass-through, omitted-cwd fallback, `DATABASE_URL` precedence. |

### Testing

**Pipeline verify results**

- Verdict: PASS (from verdict artifact)

| Requirement | Status | Evidence |
| ------------- | -------- | ---------- |
| R1 | MET | `packages/domain/src/analytics/history-board-rollup.ts:1292-1293` — bucketWindow lower bound widened to `> bucket - 1 second`; fresh SQL-literal + JS ordering checks this session prove the failing-before mechanism (old `>= bucket` bound drops `…09:59:00.000Z`; new bound includes it) and the residual `MSG_BUCKET_5M_SQL = bucket` filter keeps the selected set exact; regression test `packages/domain/tests/analytics/history-board-rollup.test.ts:1831` passes (55/55 domain analytics tests green this session); ROLLUP_DEFINITION_VERSION v6 `packages/domain/src/analytics/rollup-watermark.ts:26` + pinned digest `packages/domain/tests/analytics/rollup-definition-version.test.ts:32` (both version-guard tests pass); one-session/700-token + tool/model/source series assertions preserved unchanged `packages/app/tests/services/history-board-service.test.ts:293-302` |
| R2 | MET | `apps/cli/src/commands/serve.ts:24-36` resolveServeCwd (resolve + directory validation before startup), `:104` StartServerOptions.cwd pass-through; `apps/server/src/serve.ts:494` one projectRoot threads config/bootstrap/fs/context/planning/web-dist/DB-defaults/project work (`:511`, `:527`, `:537`, `:741`); docs `docs/04_DESIGN.md:1299` (T3 same-commit); sync-FS exemption `config/rules/strict/runtime-boundaries.yaml:73`; 8 CLI R2 tests `apps/cli/tests/commands/serve.test.ts:164-267` + server R2 composition test `apps/server/tests/serve.test.ts:580-635` green this session; both spellings share the path `apps/cli/src/index.ts:175,181` |
| R3 | MET | `apps/server/src/serve.ts:579` awaited `quotaConsumer.drain()` before autostart/dispatch; `:586` thrown-failure nonfatal warn; consumer serialization/poll/shutdown unchanged `packages/app/src/services/agent-quota-updates.ts:353`; 4 server R3 tests green this session `apps/server/tests/serve.test.ts:637-908` (persisted disable applied before first workflow launch, empty queue proceeds once, failed/deferred retained without false ack — attempts=3, applied_observation_id null, thrown failure nonfatal) |
| R4 | MET | `apps/cli/src/errors.ts:36-39` remediation names holder/inspection/retry/operator-decision without stale/kill; busy prefix `SQLite database .spur/spur.db is busy` retained `:43`; classification unchanged `apps/cli/src/errors.ts:12-17`; errors tests green this session `apps/cli/tests/errors.test.ts:98-111,113-175`; no test depends on removed wording; 0804 R3 retry classifiers key on raw error signatures (`database is locked`) unaffected `config/workflows/task-pipeline.yaml:438,554` |

| Acceptance Criteria | Status | Evidence Type | Evidence |
| --------------------- | -------- | --------------- | ---------- |
| AC1 (R1) | MET | test | Failing-before/passing-after proven: fresh SQL-literal evaluation (old `>= bucket` bound drops `…09:59:00.000Z`; new `> bucket-1s` includes it) + regression `packages/domain/tests/analytics/history-board-rollup.test.ts:1831` passes; controlled times (09:58:00Z, 09:59:00.000Z trigger, 10:00:30.500Z mid-minute sanity) with per-test `setup()` isolation; session/token/series assertions preserved `packages/app/tests/services/history-board-service.test.ts:293-302`; focused tests 55/0 domain + full suite green at test stage `.spur/run/0805-test-gate.log` (7815 pass / 431 files / 0 fail) |
| AC2 (R2) | MET | test | A→B absolute + relative `--cwd` (server uses B, not A), DATABASE_URL precedence, omitted-cwd fallback, missing/non-dir fails pre-startup exit 1 — 8 CLI tests `apps/cli/tests/commands/serve.test.ts:164-267`; real startup composition with injected deps (CLI launch-spy + server StartServerDeps) `apps/server/tests/serve.test.ts:580-635` — not just the --json probe; alias parity `apps/cli/src/index.ts:175,181` |
| AC3 (R3) | MET | test | Persisted disable observed before first workflow launch without a poll tick `apps/server/tests/serve.test.ts:637-727`; empty queue proceeds once (one pass, no startup retry) `:728-790`; failed/deferred retained without false ack (attempts=3, applied_observation_id null, last_error set) `:791-873`; thrown drain failure nonfatal (server still starts) `:874-908`; all 4 green this session |
| AC4 (R4) | MET | test | Diagnostic names lock + inspection/retry with stop as explicit operator decision, no stale/kill `apps/cli/tests/errors.test.ts:98-111`; busy classification + CLI nonzero exit intact `apps/cli/tests/errors.test.ts:113-175`; 0804 R3 retry classifiers match raw signatures (`SQLiteError: database is locked`) unaffected `config/workflows/task-pipeline.yaml:438,554` |

- Coverage: N/A (verdict-based; verify pipeline does not measure code coverage)

### Review

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P4 | Usability | `apps/cli/src/commands/serve.ts:66-68` | `--json --cwd <missing>` behavior change: `resolveServeCwd` now throws (exit 1) before the `--json` probe returns, where previously the probe returned JSON (exit 0). Defensible fail-fast, but undocumented for the probe path and untested (no `--json`+`--cwd` test). Recommend a test or a doc carve-out. |
| P4 | Correctness/doc accuracy | `apps/cli/src/commands/serve.ts:59,69-73` | "Omitted `--cwd` passes nothing" is not what the real CLI does: `.option(...cwdServe, context.cwd)` makes `context.cwd` the commander default, so `options.cwd` is never `undefined` and the documented pass-nothing branch never executes. Observable behavior is preserved (context.cwd == process.cwd() in CLI flow) and full-scoping is the intended R2 fix, but the comment, docs row, and the "omitted --cwd" test describe a mechanism that doesn't run through the real CLI (the test calls the action directly, bypassing commander). |
| P4 | Test hygiene | `apps/server/tests/serve.test.ts:597-623` | R2 server test sets `SPUR_SKIP_GLOBAL_CONFIG=true` but restores it after `startServer` (not in a `finally`) and never removes the temp dir `b`. If `startServer` throws, the env var leaks into subsequent tests. The R3 tests use `try/finally` + `rmSync` correctly — the R2 test should match. |
| P4 | — | — | No P1–P3 findings across functional traceability, SECUA, or architecture. |

| Req | Status | Evidence |
| --- | --- | --- |
| R1 | MET | `packages/domain/src/analytics/history-board-rollup.ts:1283-1290` — `bucketWindow` lower bound widened to `> bucket - 1 second`; mechanism verified by direct ISO-text ordering (`00.123Z < 00Z`, `00.123Z > 00:59Z`); regression test `history-board-rollup.test.ts:1831` passes; `rollup-watermark.ts:23` v5→v6 + pinned digest `rollup-definition-version.test.ts:33` verified (55/55 domain analytics tests + full domain suite 1276/1276 this session). |
| R2 | MET | `apps/cli/src/commands/serve.ts:24-36` `resolveServeCwd` (resolve+validate); `:74` passes `StartServerOptions.cwd`; `apps/server/src/serve.ts:494` projectRoot threads into `resolveConfigFile`, `createNodeFileSystem`, `loadSpurConfig`, `createServerContext`, `resolveWebDistPath`, planning folders, consumer, child work (`cwd: ctx.cwd`), registry; all 8 CLI `serve.test.ts` R2 tests + server R2 test pass; docs `04_DESIGN.md:1299` updated (T3). |
| R3 | MET | `apps/server/src/serve.ts:573-583` — awaited `quotaConsumer.drain()` before autostart/dispatch; 4 server R3 tests pass (persisted disable applied before first workflow launch, empty queue once, failed/deferred retained without false ack, thrown failure nonfatal). Consumer `drain()` is serialized and safe immediately after start (`agent-quota-updates.ts:352`). |
| R4 | MET | `apps/cli/src/errors.ts:36-39` — remediation names the lock, identifies the holder (`lsof .spur/spur.db`), allows finish/retry, makes stop an explicit operator decision; no "stale"/"kill"; busy classification preserved (`isSqliteBusy` + prefix + nonzero exit). `errors.test.ts` updated and passing. |

#### Acceptance Criteria

| AC | Status | Evidence |
| --- | --- | --- |
| AC1 (R1) | MET | Reproducible cause + failing-before/passing-after regression (mechanism verified); session/token/series assertions preserved (full domain suite 1276/1276 green this session). |
| AC2 (R2) | MET | A→B absolute/relative launches, DATABASE_URL precedence, omitted-cwd fallback, missing/non-dir fails pre-startup, real startup composition with injected deps (both CLI launch-spy and server StartServerDeps) — not just the --json probe. |
| AC3 (R3) | MET | Persisted disable observed before first workflow launch without a poll tick; empty queue proceeds once; failed/deferred retained without false ack; no infinite startup retry. |
| AC4 (R4) | MET | Busy diagnostic names the lock + inspection/retry/decision without stale/kill; busy classification and CLI failure exit intact; 0804 retry fixtures accept the diagnostic (errors.test.ts green). |

#### SECUA + Architecture

- Security: no secrets, injection, or unsafe input introduced. `resolveServeCwd` validates the target is a directory before any server startup; error path is a controlled `CommandError` (exit 1). `runtime-boundaries.yaml` sync-FS exemption added for `statSync` usage (mirrors task.ts) — consistent.
- Correctness: R1 mechanism verified by direct string-ordering checks; residual equality filter (`MSG_BUCKET_5M_SQL = bucket`) keeps the selected set exact — no previous-minute row is newly included (strict `>` against `bucket - 1s`). R3 drain is serialized, race-free (30s poll timer unref'd, awaited drain is the only pass at startup).
- Usability: R4 diagnostic is clearer and no longer presumes staleness; R2 `--cwd` contract documented in `docs/04_DESIGN.md` same commit (T3).
- Architecture: R2 root threading is centralized through one `projectRoot` computed once in `startServer`; the `RegisterServeOptions.startServer` injectable seam mirrors the existing `StartServerDeps` DI pattern (consistent, testable, no new coupling). No shallow modules or wrong seams introduced. Daemon embedding path (`apps/server/src/index.ts:36`) omits `cwd` → unchanged `process.cwd()` fallback.

#### Design conformance

All 13 `### Solution` rows map to implemented diff hunks (verified this session). No scope creep: the `runtime-boundaries.yaml` exemption and rollup version-guard files are in-task. The Design direction (full scoping, awaited drain, diagnostic-only remediation) is followed exactly.

#### Residual Risk

1. R1's live intermittent 4h flake was reproduced at the unit level (first-second fractional-row drop) and fixed with a regression, but the exact historical recurrence was not re-triggered end-to-end in a running server; the mechanism is confirmed by text-ordering and the version-guard digest is re-pinned (v6).
2. The `--json` probe + explicit missing `--cwd` now exits 1 (P4) — untested and undocumented for that surface; low impact, add a test/doc note.
3. Full `bun run spur-check` was not run (per review-stage instruction); focused suites (domain 55, full domain 1276, CLI 32, server 48) all green this session. R2/R3/R4 do not touch other packages' runtime paths beyond those verified.
4. Pre-existing `docs/04_DESIGN.md` table-header formatting anomaly (`| ---- |` fragment after the separator row) is not introduced by this task and is out of scope.

#### Final Disposition

**APPROVE (PASS).** All four requirements R1–R4 are MET with concrete `file:line` evidence and green focused + full-domain suites this session; no P1–P3 findings; four P4 advisory notes only (probe-path doc/test, commander-default mechanism accuracy, R2 test hygiene). Residual risk is bounded and documented above. Task may proceed to `testing` / verify.

### References

Current-source evidence reviewed 2026-09-08:

- `packages/app/tests/services/history-board-service.test.ts:275` — relative seed; `:293` — one-session assertion.
- `packages/app/src/services/history-board-service.ts:155` — selector clock; `:919` — read-path selection.
- `packages/domain/src/analytics/history-board-rollup.ts:338` — minute timestamps; `:637` — selector normalization.
- `apps/cli/src/commands/shared-options.ts:50` — --cwd described as Working directory.
- `apps/cli/src/commands/serve.ts:33` — DB scoping; `:53` — startServer invocation without root.
- `apps/server/src/serve.ts:484`, `:509`, `:512` — filesystem/config/context root; `:538` — consumer startup; `:561` — separate supervised-agent autostart; `:701` — project cwd.
- `packages/app/src/services/agent-quota-updates.ts:318` — existing drain API; `:331` — consumer; `:352` — explicit serialized drain.
- `apps/server/src/context.ts:496` — supervisor config directory; `:566` — workflow launch config reload.
- `apps/cli/src/errors.ts:34` — static remediation; `:37` — error renderer.
- `config/config.example.yaml:6` — package schema declaration; apps/cli/schemas/spur-config.schema.json — schema source.
- `packages/config/src/loader.ts:194` — package/embedded schema resolution.
- `packages/app/src/services/agent-service.ts:853` and `:1467` — existing cast suppressions.
- Historical dogfood: docs/dogfood/2026-09-07-B5-executor-quota-dogfood.md, run 54D294E4D301. Old merge evidence: 02dbb8716, b524a6e76, 194ed5daf.
- Governance: docs/99_PROJECT_CONSTITUTION.md T11; docs/design/harness-surface-governance.md.
- Related tasks verified done: 0800, 0801, 0803.

### History

- 2026-09-08T17:40:52.819Z todo → wip (system)
- 2026-09-08T18:19:56.857Z wip → testing (system)
- 2026-09-08T18:28:09.003Z testing → done (system)

### Notes

Historical process observations, not additional implementation scope:

- Parallel sessions must follow the existing one-writer/worktree policy. No new guard is justified by this incident alone.
- Both cast false positives already have durable suppressions. Host diagnostic cache and registry state were not revalidated.
- Historical local schema copies and the prediction that a language-server restart would clear the remaining diagnostic are unverified today. Do not treat them as a durable product fix.
- Conventional merge messages and dependency installation after catalog-changing merges are existing operating conventions.
- R1 remains a real unresolved reliability report, with a bounded investigation contract instead of a fabricated root cause. R5 is deferred to the active editor/lens owner if a fresh diagnostic recurs.

Refinement verification: source inspection only for 0805; no full-suite reproduction, server launch, daemon stop or host configuration mutation. Future implementation tests are specified in Acceptance Criteria, not claimed as passed.
