# History CLI and refresh contracts

Detailed non-UI contracts, indexed by [04 Design](../04_DESIGN.md).
Original section numbers remain stable; unqualified section references resolve through the 04 index.

<a id="spur-history-import---source-source---file-path--root-path---mode-mode---dry-run---source-timeout-msnone---json"></a>

#### `spur history import --source <source> [--file <path>|--root <path>] [--mode <mode>] [--dry-run] [--source-timeout <ms|none>] [--json]`

Import agent conversation JSONL. `--source` ∈ {pi, claude, codex, gemini, opencode, antigravity,
openclaw, omp, grok, agy, **all**} (default `all`). `--mode` ∈ {full, incremental, force-file}
(defaults: `incremental` for root scans, `force-file` when `--file` is given). Reports scanned files,
processed lines, imported/duplicate records, parse/validation errors. Backed by
`ts-llm-jsonl-importer`.

**Provenance header (task 0504 R4):** every invocation prints a `binary:` line (the actually
invoked entry path — source-local `bun run apps/cli/src/index.ts` / built `spur.js`, or the stale
global `spur` that the header exposes) plus the resolved `@gobing-ai/ts-llm-jsonl-importer@<version>`
before the fan-out result; `--json` embeds the same `provenance` field (`{ binary, importer }`) in
the payload. Real-data history validation must run a source-local binary — never a bare global
`spur` — and record the header before each dry-run/write.

**Importer provenance guard (task 0726 R1):** importer releases below `0.4.49` (before ts-libs
commit 96762d5) silently collapse `history_tool_call.args_raw` on pi imports to the todo-tool
argument's first line, destroying bash-command evidence. `HistoryService` therefore asserts
provenance (0726 R1) before any database access on **non-dry-run full imports that include the
`pi` source**: the CLI resolves the installed importer version via `resolveImportProvenance` and
passes it into `HistoryServiceContext.importerVersion` at construction; `assertPiImporterSafe`
(in `history-service.ts`, shared by `import` and `importAll`) rejects versions that fail a strict
`MAJOR.MINOR.PATCH` parse — unknown, malformed, and prerelease values are unsafe by definition —
or that compare below `MIN_SAFE_PI_BASH_IMPORTER_VERSION` (`0.4.49`). Rejection throws
`UnsafeHistoryImporterError` (`code: 'unsafe-history-importer'`, carrying installed and minimum
safe versions plus the upgrade/relink remedy naming commit 96762d5) before the database opens or
the importer runs; the CLI renders it as a structured `--json` error (`details.cliCode`) with
exit 1. Dry-run previews and append-scoped modes (`incremental`, `force-file`) are unaffected.

**Fan-out (task 0470):** `--source all` iterates every known source in `SOURCES` order, each in its
own `try` with its own transaction — a throwing or timing-out source is caught, recorded
`status: 'failed'` with its error, and the loop continues; one source can never abort another. A
source that discovers zero files is `status: 'empty'`, never `ok`; a source with checkpoint rows but
zero files now emits a `source-was-nonempty` warning. `--source-timeout <ms|none>` bounds each source
(default **600000** = 10 min; `none` removes the deadline and the source runs to completion); a
source exceeding it is abandoned at its deadline and recorded
`failed`. A single `--source <x>` is the n=1 case of the same contract — there is never a second
import path.

**Degraded status (task 0504 R2):** a source that imported records while skipping malformed or
schema-invalid ones is `status: 'degraded'`, never clean `ok` — parse/validation error counts are
no longer the only signal. The degraded entry carries a `source-degraded` warning with counts, and
bounded file-and-line samples stay in the artifact (overflow to the `.errors.jsonl` sidecar).

**Reconciliation pass-through (task 0505 R1):** on `--mode full` with importer 0.4.25+, each JSON
entry carries the importer's optional `reconciliation` summary (`{ staleTargetRows,
staleLedgerRows, staleCheckpointRows }`) — additive, absent on incremental runs — so a dry-run
preview and its write can be compared count-for-count without manual SQL.

**Single-file full-write guard (task 0506 R2):** `--file <path> --mode full` **without** `--dry-run`
is rejected at the CLI boundary (exit 1) before any database access — full mode treats the file as
the authoritative input for a reconciliation of the real repository DB, which is only safe for an
all-source/source-root full write. The error names both alternatives: add `--dry-run` to preview,
or use `--mode force-file` to import one file. `--file --mode full --dry-run`, `--file --mode
force-file`, and all-source/source-root full writes are unchanged.

**Exit-code contract (R3, amended 0504 R2) — replaced the old "exit 1 if any errors":** `0` every
source ok/empty, `2` at least one failed **and** at least one not (or any source `degraded`), `1`
every source failed. A source is `failed` only if it threw or hit its timeout. Before 0504, parse
and validation errors were counts only (deliberate loss of "parse errors ⇒ exit 1", which under
fan-out cannot distinguish one noisy source from six dead ones); 0504 restores the loud signal for
skipped records at the source level — `degraded` status + non-zero exit — while keeping per-source
isolation intact. The compensating signals remain the artifact's error counts and the `history.*`
events.

<a id="assistant-step-duration-provenance--duration_source-task-0702-r2-t3"></a>

##### Assistant-step duration provenance — `duration_source` (task 0702 R2, T3)

Four of six sources (`claude`, `pi`, `codex`, `agy`) write no per-step `duration_ms`, so
bottleneck ranking and per-model latency were unusable for the two busiest of them and roughly
73% of the measured span could not be attributed to llm/tool/idle. The provider-side fix lives
upstream in `@gobing-ai/ts-llm-jsonl-importer` and costs a lockstep family bump plus a publish;
the transcripts already carry a per-record `ts`, so the ETL derives the value instead.

**Frozen name.** `history_message.duration_source` (migration
`0026_spur_cli_history_message_duration_source`), a nullable `TEXT`:

| Value | Meaning |
| --- | --- |
| `NULL` | `duration_ms` is the provider's own measurement, or the step has none |
| `'derived'` | `duration_ms` is an ETL timestamp delta — includes queue and network time |

**Derivation.** `deriveAssistantDurations()` (`packages/domain/src/analytics/assistant-duration.ts`)
runs once per non-dry-run `history import`, after `alignMessageProvenance()`. For each `assistant`
row with a valid `ts` and no `duration_ms`, it takes the delta to the preceding record in the same
`(source, session_id)` by `seq`, at exact millisecond resolution
(`unixepoch(ts, 'subsec')` — the `julianday` form loses ~1ms to double-precision rounding).

Three rules keep the number honest, each pinned by a test in
`packages/domain/tests/analytics/assistant-duration.test.ts`:

- **A provider value always wins.** The `UPDATE` re-asserts `duration_ms IS NULL`, so the pass is
  additive and idempotent; re-running after a later import only fills rows it could not reach.
- **A session gap is never billed as work.** Deltas above `DERIVED_DURATION_CEILING_MS` (30 min)
  stay unmeasured — attributing an overnight gap to a step would corrupt the ranking this exists
  to make usable.
- **Absent is not zero (0680 R6).** A non-positive delta (shared timestamp, out-of-order records)
  leaves the row unmeasured rather than writing `0`.

**Reporting contract.** `stepSupport` carries `stepsWithDerivedDuration` alongside
`stepsWithDuration`, and the forensics **Section Support** table's Time column reads `yes`
(provider), `derived` (ETL only), `yes (mixed)`, or `no`. A derived value is not a weaker `yes` —
it measures something different, and a reader comparing latency across sources must be able to see
which is which. Nothing may present the two as the same measurement.

**Not a backfill of history.** Rows imported before the migration gain their derived value on the
next `history import`, not through a one-time migration pass; until then they render as unmeasured
(never as zero).

<a id="spur-history-daily---since-iso---until-iso---root-path---source-timeout-msnone---mode-name---json"></a>

#### `spur history daily [--since <iso>] [--until <iso>] [--root <path>] [--source-timeout <ms|none>] [--mode <name>] [--json]`

Run-once daily pipeline (task 0470 R6): **import-all → analyze → write artifact → prune** reports
older than 90 days (`REPORT_RETENTION_DAYS`), in a single process that exits when done — never stays
resident (a resident schedule belongs to 0471's launchd agent, not Spur's embedded scheduler). The
**import** step takes no date window and runs `--mode incremental` on every source, relying on
checkpoint resume (R7): a missed night self-heals on the next run with no gap and no double-count.
Only the **analyze** step scopes the report via `--since`/`--until`. `--root <path>` overrides the
per-source history roots (test seam; default is each source's platform dir). `--json` emits the
structured `DailyResult` (`{ fanOut, artifact, pruned, coverage }`). Exit code follows the fan-out import
outcome (0/1/2), so `history.daily.failed` and the exit agree. `coverage` (task 0550, R3/R4) is the honest
coverage report `{ refreshed, skipped, window }`: `refreshed` names the full-fidelity sources this refresh
imported (claude, codex, pi, omp, agy, grok), `skipped` names the unsupported sources deferred by the
2026-08-06 operator ruling (gemini, opencode, antigravity-ide, openclaw, hermes), and `window` carries the
MIN/MAX message `ts` the analyze covered (`{ since, until }`) so a reader can tell current data from stale
without inspecting the database. A failed full-fidelity source drops out of `refreshed` (surfaced via
`fanOut`/exit code) rather than being silently counted as refreshed.

**Bounded `SQLITE_BUSY` tolerance (task 0803 R3).** The `importAll` fan-out classifies each
per-source failure against `/database is locked|SQLITE_BUSY/i`; **two consecutive** busy-classified
failures abort the remaining sources with `history import aborted: sustained SQLITE_BUSY contention
(<n> consecutive sources)`, because a shared WAL write lock that busy-times out repeatedly will not
recover mid-fan-out and every later source would only burn its own timeout. Any non-busy outcome —
success, empty, or a different failure — resets the counter, and a lone busy failure still degrades
to that source's `source-failed` warning under the usual per-source isolation.

**Passive WAL checkpoint (task 0803 R2).** The retention pass inside `daily` checkpoints the WAL
with `PRAGMA wal_checkpoint(PASSIVE)` after compaction — never `TRUNCATE`, which takes an exclusive
lock and would block every other writer for the checkpoint's duration. Full WAL truncation stays on
the manual `spur self maintain` path, where the operator explicitly accepts the exclusive-lock cost.

**`--mode <name>` (task 0555 R4) is a pure pass-through:** when set, `daily` additionally writes a
`.md` sidecar next to the artifact rendered in that report mode (`reportPath` in `DailyResult`,
`report:` line in the human output). The mode is validated up front — an unknown name fails before
the import fan-out runs. Daily's composition (per-source isolation, checkpoint self-heal, 90-day
pruning) is untouched; without `--mode`, behavior is unchanged.

**Operation-triggered refresh (feature E3, tasks 0549–0550).** Completing a task (`spur task update <wbs> done`) or a non-dry workflow run (`status: done`) enqueues a `history.refresh` job on the embedded job queue when `history.refresh.on_completion` is `true` in `.spur/config.yaml`. The key is **opt-in and defaults off**. Completions inside `history.refresh.debounce_ms` (default **600000**) join one pending job and stretch its covered window — a burst produces one refresh, not N. The server queue handler does not call `HistoryService.daily` in-process: E31 (0717) executes `<invocation> --no-logo history daily` in an isolated child via `ProcessExecutor`, passing the validated payload through `SPUR_HISTORY_REFRESH_CONTEXT`; 0716's single-flight writer extends exclusion through `processing`. See [`history-refresh-process-isolation.md`](history-refresh-process-isolation.md).

**Periodic refresh (task 0750, replacing 0696).** There is no history-specific scheduling key. Recurring refresh is declared like any other periodic execution, as a `bootstrap.scheduler.jobs` entry running `history daily` (see *Scheduled jobs*, task 0734); `registerSchedulerEntries` no longer reads project config and registers only the prune and smoke built-ins plus the configured jobs. The retired `history.refresh.schedule_minutes` key is dropped from `HistoryRefreshConfigSchema`, and `HistoryRefreshTriggerConfig` no longer carries `scheduleMinutes`. `'schedule'` remains a valid `history.refresh` payload trigger value so rows persisted by the old path still validate, but nothing enqueues with it.

**Trade-off recorded at migration.** A configured job is a plain non-coalesced `scheduler.custom` enqueue, so a periodic refresh no longer shares the `enqueueHistoryRefresh` single-flight row with the completion trigger, and no longer inherits its `DATABASE_URL`/`resolveSpurBin` plumbing — the command's own `cwd` (project root) resolves the database. Coalescing and per-job env for configured jobs are open enhancements against the shared scheduler surface, not a reason to keep a second scheduling mechanism.

`DailyResult.coverage` is `{ refreshed, skipped, window: { since, until } }`. Analyze stamps `bySession[].sessionState` (`in-progress` | `complete`): a session whose last stored message is not an assistant turn is in progress, and derived aggregates clip to the last complete turn so a partial turn cannot fabricate totals. Re-analyzing a growing session replaces the previous `bySession` row (one record per session, not one per refresh). Events: `history.refresh.enqueued`, `history.refresh.completed`, `history.refresh.skipped` (disabled). No new CLI noun.

<a id="spur-history-analyze---since-iso---until-iso---source-sall---session-id---run-runid---task-wbs---top-n---out-path---json"></a>

#### `spur history analyze [--since <iso>] [--until <iso>] [--source <s|all>] [--session <id>] [--run <runId>] [--task <wbs>] [--top <n>] [--out <path>] [--json]`

Aggregate imported history into forensic analytics and write a **versioned JSON artifact** (task 0474).
Aggregation is done in **SQL** over `history_message` / `history_tool_call` (the Q1–Q10 forensic query
set — per-step time/token cost, tool-call counts, repeated-call loop detection, unknown-disposition
drift) — never by loading the corpus into memory. Reads the contract tables populated by the six
converted sources (claude, codex, pi, omp, grok, agy) plus the generic ETL sources.

Six composable `AND` selectors, each resolving against an indexed column: `--since`/`--until`
(`history_message.ts`), `--source <s>` / `all` (`source`; `all` = no source predicate), `--session`,
`--run`, `--task` (task-only selection resolves through the mapping authorities — the
`task_run_links` → `history_run_session` run chain plus the direct `history_task_session`
attribution recovered at import (task 0722) — never through `run_id`/`task_wbs` message columns,
which are reserved for boundary promotion; task+run selection intersects through the run chain), and `--top <n>` (default 20; bounds `bySession`/`byTool` only — never
`totals`/`bySource`/`byModel`/`daily`).

Artifact: `.spur/reports/history/<YYYY-MM-DD>/analyze-<selectorDigest>.json` where `selectorDigest` is
the first 8 hex of sha256 over the canonicalized selector (stable for the daily loop). `--out <path>`
overrides; `latest.json` symlinks the newest artifact. `schemaVersion: 1`; additive fields do not bump
it. `coverage[].parseErrors`/`validationErrors` are **counts** plus at most 20 samples per source, with
full detail streamed to `analyze-<digest>.errors.jsonl` (R6). `recordsWithUsage` /
`durationUnmeasured` carry the never-fabricate invariant — a consumer renders `n/a`, never a
fabricated `0`. No artifact flags ⇒ human stdout summary (rendered from the artifact); `--json` ⇒ the
artifact shape.

**Watermark policy (task 0550, R1/R2):** a session still being written is analyzed only up to its **last
complete turn** — an assistant (non-meta) message with no open tool call closes a turn, and everything
after it is a possibly-incomplete trailing turn excluded from derived values. Each `bySession[]` row
carries an additive `sessionState: 'in-progress' | 'complete'` (absent ⇒ unknown for artifacts written
before 0550) so a consumer can filter to finished sessions; the state is output, never a new column.
Where "complete" is ambiguous for a source (no tool-call rows to inspect), the rule degrades to "last
message is assistant-like" — including `role='unknown'`/role-less rows, so imported role-less messages are
analyzed rather than zeroed. Pre-0550 behavior for complete sessions is unchanged — no data is excluded.

**Assistant response duration (task 0507 R2):** totals (`assistantDurationMs`,
`assistantDurationUnmeasured`) and per-session stats (`bySession[].assistantDurationMs` /
`assistantDurationUnmeasured`) aggregate the **measured** `history_message.duration_ms` from OMP
assistant responses — role-filtered to `role = 'assistant'`, additive, and distinct from tool-call
`durationMs`/`durationUnmeasured` (which remain computed only from `history_tool_call`). Missing or
non-finite durations count as unmeasured, never as zero. `HISTORY_ARTIFACT_SCHEMA_VERSION` stays 1 —
the fields are additive.

**Derived variables (task 0554):** `analyze` additionally computes `derived` on the artifact via a
**MetricRegistry** (`packages/domain/src/analytics/derived.ts`) — an ordered list of `MetricFn`s run
after the SQL aggregation, each receiving `{ sessionSpans, sessionTools, todoCalls, results }` and
returning an additive key. Defaults: `phases` (todo-tool `args_raw` replay — per-session first
`in_progress` → first `completed` per todo name, `endedAt` falls back to the session's last todo-call
ts; sources without todo tools report `phaseSupport: 'unsupported'`), `timeDecomposition` (per-session
`llmMs` + `toolMs` + `idleMs`, with `unattributedMs` holding the remainder whenever any duration in
the session is unmeasured — the never-fabricate invariant extends to decomposition), and
`bottlenecks` (time buckets ranked desc by `ms`, `share = ms / spanMs`). `derived` is optional on the
artifact: old artifacts remain valid (`schemaVersion` stays 1), and sessions with no measured time
surface `derivedWarnings[]` (`derived-unattributed-time`) instead of zeros. Metric inputs come from
three new forensic queries (`sessionSpans`, `sessionToolDurations`, `todoToolCalls` — the latter
reading the 0012 `args_raw` column) alongside the existing SQL set; registry metrics never load the
corpus into memory.

<a id="spur-history-reset---yes---json"></a>

#### `spur history reset --yes [--json]`

Destructively wipe every `history_*` table in one atomic batch: normalized rows
(`history_message` / `history_tool_call` / `history_run_session` / `history_task_session`), the ten
importer-created `history_etl_*` tables, all derived analytics (`history_daily_stats`, the ten
`history_board_*` rollups), and importer bookkeeping (`history_import_checkpoint` /
`history_import_ledger`). Requires `--yes`; without it the command refuses with exit 1. Task corpus
and run provenance (`task_run_links`) are untouched, so run-chain attribution re-resolves after a
full re-import. Unlisted `history_*` tables are reported (never silently deleted) in the
`unknown` result field. The canonical table list lives in
`HISTORY_RESET_TABLES` (domain `history-reset.ts`) with a drift-guard test asserting it covers
every migrated history table; a full `spur history import` + `analyze` rebuilds everything after a
reset.

<a id="spur-history-report-path---mode-name---task-wbs---top-n---json"></a>

#### `spur history report [path] [--mode <name>] [--task <wbs>] [--top <n>] [--json]`

Pure renderer of a previously-generated analyze artifact — never opens the database. Reads the
artifact JSON, asserts `schemaVersion === HISTORY_ARTIFACT_SCHEMA_VERSION`, then renders a stdout
spend rollup (reusing `formatSummary` via `artifactToSummary`) plus forensic sections the spend
summary cannot express: per-tool time/calls/result-bytes, detected loops, session leaderboard, and
per-source coverage. Writes a `.md` sidecar next to the artifact (same basename) so the morning read
needs no CLI invocation.

- `[path]` — explicit artifact JSON path. When omitted, resolves `.spur/reports/history/latest.json`
  (a symlink to the newest artifact, written by `analyze`). An explicit path wins (R6).
- `--json` — emit the parsed artifact shape instead of the human report.
- **Render-time narrowing (task 0564 R3):** `--task <wbs>` and `--top <n>` mirror `analyze`'s
  flags exactly and narrow the already-loaded artifact JSON client-side — the renderer never gains
  database access. `--task` renders only when the artifact's selector carried that task dimension
  (the artifact WAS analyzed with `--task <wbs>`; its buckets are that task's rows); an artifact
  with no task dimension, or one analyzed for a different task, exits 1 with a message naming the
  artifact id and the missing/mismatched dimension — never a silent unfiltered render. `--top`
  re-slices the `byTool`/`bySession` leaderboards to depth `n`. A narrowed render prints one banner
  line naming the applied filter and the artifact id.
- **Staleness banner (R7):** when the artifact is resolved via the `latest.json` pointer and is older
  than 36 hours, a `⚠ STALE ARTIFACT` banner prints before the report body — the daily loop may have
  stopped. Suppressed for explicit paths (the operator already knows the file's age).
- **Version gate (R4):** an artifact whose `schemaVersion` is not the one this renderer understands is
  refused with a clear message naming the path, the actual version, and the expected version; nothing
  else is emitted. Re-run `spur history analyze` to regenerate.
- **Never-fabricate (R5):** when a tool bucket has calls but every `duration_ms` was NULL
  (`durationUnmeasured === calls`), timing renders `n/a`, never `0` — the same convention
  `formatRatio` uses for unavailable cache-hit ratios.
- Rendering is pure (`packages/domain/src/analytics/render-report.ts`); the FS seam lives in
  `packages/app/src/services/history-service.ts` (`runHistoryReport`).

**Report mode registry (task 0555 R1):** rendering resolves through
`REPORT_MODES` (`packages/domain/src/analytics/report-modes.ts`) — a `Readonly<Record<string,
ReportRenderer>>` of pure `HistoryArtifact → string` functions. The registry **subsumes** the former
direct `renderReport`/`renderMarkdown` call path: `default` maps to `renderReport` (byte-identical
legacy output), `forensics` to `renderForensics`. `--mode <name>` (default: `default`) resolves via
`resolveReportMode`; an unknown name fails with `UnknownReportModeError` naming the registered set —
before any import or render work. Built-in TS renderers only: no template engine, no
variable-binding contract, no config surface (operator ruling 2026-08-09). `renderMarkdown` moved
into `report-modes.ts` and is mode-aware (fenced sidecar of the selected mode's body).

**Forensics renderer (0555 R2–R5):** `renderForensics`
(`packages/domain/src/analytics/render-forensics.ts`) renders the 8 sections task 0491 identified
as derivable from the artifact alone — Session Data Summary (incl. Tool Breakdown + Token
Profile), Time Decomposition, Per-Phase Breakdown, Per-Tool Execution Time, Bottleneck Ranking,
Raw Data. Tokens only, never currency (R3): no `$`/USD value appears, `MODEL_PRICING` gains no
consumer; cache efficiency renders as `cacheRead / inputTokens` ("share of billed input served
from cache", `n/a` when `recordsWithUsage === 0`). Missing derived inputs render honest
`not available` lines — artifact without a `derived` block (rerun `spur history analyze`) for the
three derived-dependent sections, `phaseSupport: 'unsupported'` for phases (R5). The 8 partial /
model-authored sections from 0491 are deliberately absent, not stubbed (task 0556).

**Per-step sections (task 0581, feature E5):** the analyze artifact gains three additive fields
(no schema bump, `schemaVersion` stays 1): `topStepsByTokens`, `topStepsByDuration`
(`StepStat[]` — raw `history_message` columns, nulls preserved), `cacheWaste`
(`{ steps, inputTokens, topSteps }`), and `stepSupport` (`StepSupportEntry[]` — per-source
support verdicts derived from assistant rows, never hard-coded). Queries Q11–Q14 are
`LIMIT ?`-bounded and watermarked like the Q1–Q10 set; Q13a is a single-row aggregate bounded
by `LIMIT 1`. `renderForensics` renders `## Per-Step Analysis` (between Per-Tool Execution Time
and Bottleneck Ranking) — `### Section Support`, `### Top Steps by Total Tokens`, `### Top Steps
by Duration`, `### Cache Re-Send Waste`. Tokens only (R3): `StepStat.costUsd` is unread. Cache
waste counts assistant steps with fresh input > 100,000 tokens and < 10 % cache reuse
(`CACHE_WASTE_MIN_INPUT_TOKENS` / `CACHE_WASTE_MAX_REUSE_FRACTION` in
`packages/domain/src/analytics/forensic-query.ts`); NULL cache reads never compare true, so
only measured low-reuse steps count. Pre-0581 artifacts state `not available` for all four
sections (R5), never zeros.

**True population + coverage rendering (HA-S1, ADR-080):** `analyze` records an additive
optional `population` block on `HistoryArtifact` (`SelectionPopulation` — sessions, tools,
loops, warnings, `appliedTop`; no schema bump) from unbounded `COUNT(DISTINCT …)` queries over
the active selector — never from the bounded leaderboard array lengths. `renderForensics`
renders the Sessions metric and the Raw Data Counts line through `fmtTopOf`: `top N of M` when
the applied depth is below the true population, the plain count when the whole population is
shown, and `not available` on a pre-HA-S1 artifact (never reconstructed from a bounded length).
The coverage table adds `Last imported` / `Parse err` / `Validation err`, marks sample overflow
`(truncated)` at the `MAX_ERROR_SAMPLES` cap, and warnings render one `code — detail` line per
warning instead of a code-only list. `narrowArtifact` re-slice (`report --top`) lowers
`appliedTop` to `min(requested, existing)` and leaves the population counts untouched.

**Verified-outcome projection (ADR-100, task 0712):** `HistoryArtifact.verifiedOutcome?`
(`VerifiedOutcomeStat`, additive, no schema bump; absent on pre-0712 artifacts and whenever no
task locator is configured — absence means unknown, never zero). The app derivation
(`packages/app/src/services/verified-outcome.ts`) gathers per-task evidence — `task_run_links`
⨝ `runs` (window-bounded population, hard row cap), the task-file corpus (frontmatter
`status`/`done_forced`, `## History` transitions via the shared `parseHistoryLine`, the
`## Testing` `Verdict:` line via the shared `parseVerdictLine`), and
`.spur/run/<wbs>-verdict.json` — and the pure domain fold
(`packages/domain/src/analytics/verified-outcome.ts`) applies the frozen R1/R2 definitions:
verified = done ∧ PASS artifact verdict ∧ proof digest present ∧ certifying run completed;
correction = verified task with a reopen transition or a superseding failed run. Rates null on
a zero denominator; time-to-verified folds first-wip→done spans; measured cost per verified
result uses exact run→session mappings only (estimated mappings and dollar figures unread, per
run-cost R3) and is `null` plus an explicit `costCoverage {covered,total}` pair — absence is
never coalesced to zero (R4). Exclusions land in `excludedReasons` by frozen reason. The
default report mode renders a `Verified outcome` section with `n/a` for unmeasured values
(R5); duplicate wbs rows dedupe (R8); `history analyze --json` carries the block unchanged.
`HistoryServiceContext.taskLocator` (wired in `apps/cli/src/commands/history.ts` from
`TaskLocator.forDirs`) gates derivation; derivation failure never fails the analyze batch.

**Pairings renderer (task 0574, feature J8 R2/R3):** `renderPairings`
(`packages/domain/src/analytics/render-pairings.ts`) — a pure `HistoryArtifact → string` mode
consuming ONLY the additive `pairings` / `ladderSnapshot` fields (0573); never opens the
database, never reads `.spur/config.yaml` at render time (the ladder arrives embedded in the
artifact), and never compares schema versions. Two sections: `## Pairings` — one ranked table
per role ordered success rate desc → total escalations asc → cost asc — and `## Ladder diff` —
per tier, the snapshotted config order vs the measured order, with `suggest: promote <executor>
above <executor> (dispatches=N, success=X% vs Y%, cost=$a vs $b)` lines for each adjacent
inversion. A rung totalling fewer than `MIN_PAIRING_DISPATCHES = 5` dispatches is marked
`insufficient-evidence (N<5)` and never suggested. Absence degradation mirrors the
`SessionStat.sessionState` precedent: a pre-0573 artifact renders `section unavailable (artifact
predates the pairings field; re-run spur history analyze)` in place of the missing section —
never a throw, never a fabricated row. Registered in `REPORT_MODES` as `pairings`; unknown mode
names keep failing with `UnknownReportModeError` naming the registered set.

**Report-first surface (task 0556, superseded 0661):** `/sp:dev-find-issue` was the report-first
entry over the forensics renderer + `sp:issue-finding`. **As of HA-S1 (0661) it is a thin forwarder
to `sp:history-anatomy`** with the reduced surface `[<focus>] [--mode <daily|ad-hoc>] [--date
<YYYY-MM-DD>] [--since <RFC3339>] [--until <RFC3339>] [--recompute] [--agent <inline|auto|name>]
[--output <path>]`; the fourteen legacy flags (`--full`, `--save`, `--source`, `--sessions`,
`--feature`, `--template`, `--priority`, `--severity`, `--category`, `--top`, `--min-cost`,
`--strict-topic`, `--create-task`, `--json`) are dropped, `/sp:dev-history-load` is deleted (its
independent import owners — `load-history` in `package.json` and the History UI Import & Analyze
path — are preserved), and the command never triggers an import. The legacy skill `sp:issue-finding`
remains packaged and directly invocable under the bounded coexistence and retirement gate in
`plugins/sp/README.md`; no logic is shared with the new skill.

**History-anatomy surfaces (HA-S1 0658/0660):** skill `plugins/sp/skills/history-anatomy/` owns
interpretation (mode contract, finding taxonomy, twelve-section report contract, `enrich`/`validate`
rubrics); workflow `config/workflows/history-anatomy.yaml` owns the cache branch, deterministic stage
ordering, a shared two-pass correction budget, and atomic publication — the cache/digest/structure/publish
determinism is `plugins/sp/scripts/history-anatomy-cache.ts` (+ committed `.mjs` twin, ADR-065
standard contract, ADR-079 digest-truth). Publication is reachable only from a passing validation
state; a hit reuses model enrichment only and refreshes `validated_at` + the imported-snapshot banner
without claiming a later import.

**Active-session review (ADR-089):** `/sp:dev-review-session [<focus>]` invokes
`sp:session-review` directly in the active host session. Focus changes ordering, not evidence
collection. The current conversation is the primary evidence plane; read-only repository checks
may confirm material claims. The compact report contains Outcome, a non-overlapping Time breakdown,
Resolved issues, Open issues and risks, Process and environment improvements, and Next actions.
Timing comes only from visible session evidence, renders as `M:SS` or `H:MM:SS`, separates operator
waits from execution bottlenecks, and uses `n/a` rather than estimates. It launches no workflow or
agent, imports no history, performs no baseline/cache/publication step, and mutates nothing.
Historical, cross-agent, recurrence, trend, and quantitative questions stay on
`/sp:dev-find-issue`.

**Artifact-digest ownership boundary (task 0669).** The semantic artifact digest and its ranked-
versus-set canonicalization rules live in **`packages/domain/src/analytics/artifact-digest.ts`**,
beside the `HistoryArtifact` type they canonicalize. The classification
(`ARTIFACT_ARRAY_CLASSIFICATION`) is type-derived: a recursive array-key type over the artifact plus
an exhaustive `Record<ArtifactArrayKey, 'ranked' | 'set'>` makes an unclassified new array field a
`tsc` error naming the field — order-as-evidence must be declared, closing the drift class that hid
`topSteps`/`bottlenecks` for months. The plugin script consumes this authority through a **generated**
copy (`plugins/sp/lib/artifact-digest.generated.mjs`, built by `bun run build:plugin-lib` and
committed) because ADR-065 forbids a monorepo import surviving into the script's `.mjs` twin;
consequently the domain module has exactly one consumer reached through a generated file, not an
import. Consequences that are deliberate: no hand-maintained enumeration of artifact array keys may
exist in `plugins/sp/scripts/`; the twin's bare-`node` fixture test (R2) backstops the twin-staleness
hole (script-contract-check compares mtimes only against the direct source); and
`REPORT_SECTIONS`/`FINDING_FIELDS` stay local to the script with `skill-structure.test.ts` requiring
`report-contract.md` to name every entry of both — full single-owner treatment of the report
vocabulary was deferred as it has never drifted.

**Helper verb surface and stage order (0659/0660, corrected 2026-08-25).** The helper's CLI is
`paths | probe | stamp | refresh | digest | check | publish` — every stage in the workflow is one
invocation of one of these (ADR-069 R1 glue length). Stage order is
`resolve-scope → resolve-paths → analyze → cache-probe → {hit: refresh-provenance | miss: render →
enrich → structure-gate → validate → stamp} → publish`. **`analyze` precedes `cache-probe`
deliberately:** ADR-079 makes validity a *derived* fact, so the semantic digest must come from the
fresh artifact, never from the cached report being judged. Publication is reachable only via `stamp`
(guarded on `Verdict: PASS`) or `refresh-provenance` (whose model half was itself published through
a passing validation).

**Frontmatter provenance block (0660 R7).** `stamp` writes, and `parseProvenance` reads back, the
full block: `identity` (contract version, mode, date, IANA timezone, normalized inclusive bounds,
sources), `windowState` (`provisional` until the local calendar day closes, then `closed`),
`generatedAt`/`validatedAt`, `artifactDigest` + `baselineArtifactDigest`, `contractDigest` /
`skillDigest` / `workflowDigest`, per-source `coverage` with `lastImportedAt`, `runId`,
`currentArtifactPath`/`baselineArtifactPath`, `spurVersion`, `schemaVersion`, `executor`, `model`,
and `cacheDisposition`. Audit fields round-trip through `parseProvenance` so a cache-hit republish
never strips them. A logic path that cannot be resolved digests to `not available` (which compares
equal to itself, so an unresolvable path degrades to "no invalidation signal", never a false match).
The banner renders the **earliest** per-source `lastImportedAt`, so the report never claims a source
was imported later than its own recorded timestamp.

<a id="history-nightly-loop--scheduling-surface-and-observability-task-0471"></a>

#### History nightly loop — scheduling surface and observability (task 0471)

The daily pipeline runs on an **external macOS launchd agent**, not Spur's embedded scheduler. The
embedded scheduler needs a daemon the run-once CLI is not, and drives nothing under the CLI
(`bootstrap.scheduler.enabled = false`). An external supervisor is the only correct fit.

> **Amendment (2026-09-02, task 0734):** the *cron* half of this rationale is obsolete —
> `NodeSchedulerAdapter` now accepts real five-field cron, so `0 2 * * *` is expressible and no
> longer degrades to a 60-second interval. The decision stands on the remaining premise: the daily
> pipeline must run whether or not `spur serve` is up. An operator who *does* run the server can now
> express the same schedule as a `bootstrap.scheduler.jobs` entry instead (§5.2).

**Template:** `config/launchd/ai.gobing.spur.history.daily.plist` — `StartCalendarInterval` (daily
wall-clock), `WorkingDirectory` = project root, `StandardOutPath`/`StandardErrorPath` →
`.spur/logs/history-daily.out`/`.err`. Ship-as-template (not an installer verb): one plist + two
documented commands beat a Spur verb that must track macOS launchctl changes.

```bash
# Install (from the project root, after substituting SPUR_BIN and PROJECT_DIR in the template)
cp config/launchd/ai.gobing.spur.history.daily.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.gobing.spur.history.daily.plist

# Uninstall
launchctl bootout gui/$(id -u)/ai.gobing.spur.history.daily
```

**Rejected alternatives** (ADR recorded under task 0464 § R6): Spur's embedded scheduler (cannot
express daily cron, silent 60-s fallback); a `spur history install-schedule` verb (tracks launchctl
changes forever); a fifth detection layer or health-check verb (four already earn their place).

**System events (R1, R2).** Choosing an external scheduler makes the event ledger the only in-harness
evidence the loop ran. Three `history.*` events declared in `packages/app/src/services/event-names.ts`
emit from `apps/cli/src/commands/history.ts` (daily verb) via the existing
`attachSystemEventLedger(bus, context)` bridge:

| Event                       | Renderer          | When                                                        |
| --------------------------- | ----------------- | ----------------------------------------------------------- |
| `history.import.completed`  | `history-import`  | fan-out import finished (regardless of per-source failures) |
| `history.analyze.completed` | `history-analyze` | analyze + artifact write finished                           |
| `history.daily.failed`      | `history-daily`   | the daily command exited non-zero or threw                  |

All three are `metadata-only`, `default` tier — history payloads may carry `cwd`, file paths, and error
text quoting source content; `raw-safe` would persist that. The canonical envelope builder retains
only catalog-declared history metadata, excludes content-bearing fields, and redacts configured
secrets before bounds. `await ledger.flush()` runs in a `finally` on **both** the success and failure
paths — without it, a run-once process exits before the async inserts land, reproducing the exact
"0 rows" symptom this task exists to end.

**Four-layer missed-run detection (R5, R6).** No single layer is the sole signal:

| Layer                   | Signal                                           | Detects                                        |
| ----------------------- | ------------------------------------------------ | ---------------------------------------------- |
| 1 — artifact freshness  | `latest.json` older than 36 h ⇒ staleness banner | the whole loop stopped                         |
| 2 — ledger events       | `history.*` rows present / absent                | started-and-failed vs never-started (R6)       |
| 3 — per-source coverage | `coverage[].status` per source                   | one source stopped while others kept working   |
| 4 — launchd error log   | `.spur/logs/history-daily.err`                   | failures before Spur's own logging initializes |

R6 is what layer 2 buys and layer 1 cannot: "no artifact" is ambiguous (launchd never fired vs the run
started and failed). A `history.daily.failed` row ⇒ it ran and failed; **no** `history.*` row in the
window ⇒ it never started. Both are checkable without reading the artifact, which by definition does
not exist in either case.

**Report reachability (R7).** The daily-summary surface (`plugins/sp/scripts/daily-summary/`) resolves
the `.spur/reports/history/latest.json` pointer and emits a `## History Report` section carrying the
newest artifact path — so a completed nightly run reaches the operator through the summary they already
open, with no new notification channel.

<a id="history-completion-triggered-refresh--coalesced-enqueue-on-work-completion-task-0549"></a>

#### History completion-triggered refresh — coalesced enqueue on work completion (task 0549)

`spur history daily` is bound to a clock; this trigger binds a refresh to **work completing** so the
history DB reflects the burst of session activity a task pipeline just produced, without waiting for
the 02:00 nightly loop.

**Trigger points (exhaustive).** Exactly two, both terminal — never "every CLI invocation":

1. `spur task update <wbs> done` (task completion) — `apps/cli/src/commands/task.ts`.
2. `spur workflow run` / `continue` reaching a terminal status (pipeline-run completion) —
   `apps/cli/src/commands/workflow.ts`, at the sync completion path, the main sync run path, and the
   `continue` path. The `--async` launcher itself does **not** trigger — its worker does when the run
   completes.

**Config (`config/config.global.yaml`, `packages/config/src/index.ts`)** — explicit/opt-in, disable-able
with no code edits:

```yaml
history:
  refresh:
    on_completion: false   # default; set true to enable
    debounce_ms: 600000    # coalescing window, floor 1000 ms
```

Periodic (clock-driven) refresh is **not** configured here — it is a `bootstrap.scheduler.jobs`
entry like every other recurring command (task 0750):

```yaml
bootstrap:
  scheduler:
    enabled: true
    jobs:
      - name: history-refresh
        intervalMinutes: 10
        command: bun apps/cli/src/index.ts --no-logo history daily
```

The debounce default (600 000 ms = 10 min) follows task 0548's measured figures
(`docs/tasks4/0548-import-cost-measurement.md`: steady-state all-fanout import ≈ 20.6 s, recommended
coalescing window 10 min, floor 5 min) — the window must dwarf the import cost so a burst pays one
import, not N.

**Coalescing semantics (R2).** `enqueueCoalesced` (`packages/domain/src/db.ts`) joins the newest
**pending** job of the type instead of inserting a second: merged payload keeps the earliest
`windowStart` and extends `windowEnd` to the latest completion, and `nextRetryAt` slides to
`now + debounce_ms`. A burst of N completions inside the window therefore yields **exactly one**
refresh whose covered window spans all N. Once a job is claimed (`processing`), the next completion
starts a fresh job — a refresh already in flight is never starved by further joining.

E31/ADR-101 supersedes the final sentence: a processing refresh returns
`already-running`, and the database admits no simultaneous pending follow-up. Schedule and Board
manual producers also use the same writer. Exact merge and outcome shapes live in
[`history-refresh-process-isolation.md`](history-refresh-process-isolation.md).

**Never inline (R1).** The trigger (`apps/cli/src/history-refresh.ts`, `packages/app/src/services/history-refresh-service.ts`)
is two queue-table statements — one lookup, one insert/update — and returns; the firing operation's
elapsed time is unaffected. The refresh runs as queue job kind `history.refresh` in an isolated child process (`apps/server/src/serve.ts`
registers a handler that runs `<invocation> --no-logo history daily` via `ProcessExecutor`), so
the same import-all fan-out with **per-source isolation** (R5: one source failing never aborts the others),
analyze, and artifact write the nightly loop uses executes outside the server event loop.
Both launchers provide a PATH-independent invocation: `spur serve` reuses its live CLI entry, while the
standalone server resolves the source-local CLI or its sibling compiled `dist/cli/spur`. All coalesced
refresh producers share `max_retries = 3`; this intentionally replaces the old scheduler-only value of 1.
The server queue visibility timeout is two hours because `history daily` can spend ten minutes on each
of six sequential sources before analysis; the generic 30-second default would duplicate a live child.
A native execution deadline additionally bounds each child (task 0813, ADR-112): the daemon resolves
the policy once at boot — `SPUR_HISTORY_REFRESH_TIMEOUT_MS` for `history.refresh`,
`SPUR_SCHEDULER_TIMEOUT_<NAME>_MS` / `SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS` (default 600,000 ms) for
`scheduler.custom`, explicit `none` for unlimited — and forwards `timeout`/`killGraceMs` to the
`ProcessExecutor`, which owns containment and reports a truthful timed-out outcome. A wedged child
can no longer hold the queue row, and the WAL write lock its imports take, for the full visibility
window; explicit-unlimited jobs impose no deadline and are exempt from age sweeping.

**Containment hardening (task 0806).** Four bounded knobs close the residual gaps:

- **Group kill (R1; task 0813).** Containment is native: Spur forwards the resolved deadline and
  `killGraceMs` (`SPUR_SCHEDULER_KILL_GRACE_MS`, default 5,000 ms) to the `ProcessExecutor`, which
  runs each child in an isolated process group and escalates SIGTERM→SIGKILL so descendants that
  ignore SIGTERM cannot outlive the deadline — no caller-side watchdog races the executor. The
  per-source import deadline is enforced by the same native policy: the loser is abandoned
  mid-flight (checkpoint resume, R7) and the whole `history daily` run aborts when a source exceeds
  its budget — a timed-out writer may still hold the write lock, so later sources are not started
  and the queue run fails (distinct `source-timeout` warning code).
- **Per-job budgets (R3).** Configured scheduler jobs resolve an effective deadline via
  `SPUR_SCHEDULER_TIMEOUT_<NAME>_MS` (upper-snake of the configured name), falling back to the
  global `SPUR_SCHEDULER_CUSTOM_TIMEOUT_MS` on absent/invalid values; the `history.refresh`
  deadline is decoupled via `SPUR_HISTORY_REFRESH_TIMEOUT_MS` so raising the chain budget cannot
  lengthen the completion-triggered refresh.
- **Single history producer (R6).** The completion-triggered `history.refresh` job holds an
  in-process exclusive key (`history-daily`); a configured `scheduler.custom` job whose command
  runs `history daily`/`history import` is stamped with the same key at enqueue (word-boundary
  match), so an overlapping start fails its own attempt cleanly instead of racing the scheduled
  importer into `SQLITE_BUSY`. Same-process advisory scope: the daemon is the only handler host;
  manual CLI runs are bounded by per-source busy-abort + the native per-source deadline.
- **Maintenance ordering (R7).** Preserved chain semantics: success-path order is import → report →
  maintenance (prune/smoke last); a failed or timed-out import marks maintenance skipped in the run
  outcome (recorded, not silently dropped) rather than pruning under contention; manual deep
  maintenance semantics are unchanged. Bounded policy, not a new mechanism: the queue serializes
  attempts and the exclusive key prevents producer overlap.

**Job lifecycle observability (R4/R5).** The daemon emits `queue.job.started` (metadata-only:
`jobId`, `type`, optional `name`, `entityId`) when one of the two child-spawning handlers begins
(`history-refresh`, `scheduler-custom` — the only kinds serving.ts wires a started anchor for), so
ledger queries can correlate queued→started→terminal even though the domain queue projection
clears `processing_at` on completion; other job kinds keep a null started anchor. `GET /api/jobs` enriches terminal rows whose `durationMs` is null from persisted
terminal events (`queue.job.completed`/`queue.job.failed` carry the handler `durationMs`); the
started anchor supplies `startedAt`. Unknown values stay null — a legacy row is never assigned its
enqueue time as its start. Enrichment is one bounded event query per page and degrades silently to
the raw projection.

**Failure policy.** A degraded fan-out (per-source failures) emits `history.daily.failed` and does
**not** rethrow — the refresh is idempotent (checkpoint resume) and the next completion re-triggers
it. An exception from `daily` itself emits and rethrows so the queue records the job failed.

**Observability (R3).** Enqueue is observable through the ledger: the trigger emits
`history.refresh.enqueued` (renderer `history-refresh`, `default` tier) carrying
`trigger`/`jobId`/`windowStart`/`windowEnd`; the job body emits the existing
`history.import.completed` / `history.analyze.completed` / `history.daily.failed` catalog events in the
child, stamped with the coalesced `trigger`/window and resolved `importMode` from
`SPUR_HISTORY_REFRESH_CONTEXT` (+ `coverage` on import). The child inherits the server's resolved
`DATABASE_URL`, so `spur serve --cwd` refreshes the same database; the parent emits no `history.*` events.
Enqueue failures degrade to a stderr warning and never change
the firing operation's exit code.
