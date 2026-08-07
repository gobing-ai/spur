---
template: feature-impl
schema_version: 1
name: "Consumption surface: analyze artifact, report rendering, and the scheduled loop"
description: ""
status: done
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0455"]
created_at: "2026-08-06T23:30:12.778Z"
updated_at: "2026-08-07T04:03:40.252Z"
done_forced: "true"
done_reason: "wayfinder:grilling investigation ticket — deliverable is the decision in ## Design, not code. No implementation diff exists to verify, so no /sp:dev-verify verdict artifact is producible. Evidence is the measurement table in ## Testing (corpus volume, 600k-row aggregation benchmark, live system_events queries, CLI probes), each claim carrying a HIGH/MEDIUM confidence rating. spur task check 0464 passes with 0 errors."
---

## 0464. Consumption surface: analyze artifact, report rendering, and the scheduled loop

### Background
**Wayfinder ticket** — type: `wayfinder:grilling`. Map: feature E1. **Blocked by 0455.**
Consolidates cancelled tickets 0460 and 0461.

**The question:** What must `spur history analyze` answer, what artifact does it emit for
`spur history report` to render, and what runs the whole thing every morning?

**Why it is open.** `analyze` today loads every ETL record into memory, prices each one, and returns
an `AnalyticsSummary` — `totals`, `bySource`, `byModel`, `daily`
(`packages/domain/src/analytics/types.ts:55`, `packages/app/src/services/history-service.ts:62`).
That is a spend dashboard; it never answers "which tool loop burned this session", which is why this
map exists. It also emits no artifact — output goes to stdout, so `report` has nothing to render and
is an explicit not-implemented stub (`apps/cli/src/commands/history.ts:39`).

**Analyze and the artifact:**

- Which diagnoses earn a place? The lost 0451 report is the reference: time cost by step, token cost
  by step, tool calls by step. Name concrete queries, not categories.
- Artifact shape: what `analyze` writes, where, under what name, and how it is versioned. `report`
  renders it without re-querying the DB, so the artifact is a contract.
- Selectors: session, day, source, run/task. Minimum set serving both the scheduled loop and ad-hoc
  forensics.
- In-memory pass vs SQL. It currently loads everything; at 90k–1.5M lines per source per scan, check
  whether that survives a month of daily imports before committing.
- What survives from the existing surface — `formatSummary` (`analytics/costs.ts:90`) and the
  `run-cost.ts` attribution helpers already exist and may be reusable rather than replaced.

**The scheduled loop:**

- What runs it. Feature A2 (embedded job queue and scheduler) is done and
  `apps/cli/schemas/spur-config.schema.json:90` exposes `runtime.scheduler.enabled`, documented as
  "OFF by default for CLI (run-once)" — establish what it can actually drive before choosing.
  Candidates: Spur's own scheduler plus a `spur workflow`; OS-level `launchd`; agent-side scheduling.
  Weigh harness observability against unattended reliability.
- Multi-source fan-out: `--source` takes one value (default `pi`). Six agents means six invocations
  or a new `--source all`. One source failing must not abort the rest (map AC R6).
- What "yesterday's sessions" means — incremental mode resumes from checkpoints, so a date window may
  be unnecessary. Confirm against 0457's findings.
- Delivery: where the report lands and how the operator learns it exists.
- Failure detection: a scheduled job that silently stops is worse than none. Note `system_events` is
  ~90% prune heartbeat with no workflow or agent rows today, so event-ledger visibility needs
  verifying, not assuming.

**Resolved when** the task body carries the query list, the JSON artifact schema and versioning rule,
the selector set, the in-memory-vs-SQL decision with volume reasoning, the scheduling surface with
its fan-out and failure-isolation model, and how a missed run is detected.

**If the machine-parsable and human-legible needs pull apart, say so** — that is a real finding, not
a failure to decide.
### Requirements
- R1 — Name the concrete queries analyze must answer, including time cost by step, token cost by step, and tool calls by step.
- R2 — Define the JSON artifact contract: schema, location, naming, and versioning, such that report renders it without re-querying the database.
- R3 — Define the selector set (session, day, source, run/task) serving both the scheduled loop and ad-hoc forensics.
- R4 — Decide in-memory aggregation vs SQL, justified against measured volume after a month of daily imports.
- R5 — State what survives from the existing surface — formatSummary and the run-cost.ts attribution helpers — rather than replacing them by default.
- R6 — Choose the scheduling surface, having first established what the A2 embedded scheduler can actually drive, with reasoning across Spur scheduler, launchd, and agent-side scheduling.
- R7 — Define multi-source fan-out across six agents such that one source failing does not abort the others, and define what a nightly window means given checkpoint-based resume.
- R8 — Define report delivery and how a failed or skipped morning run is detected, verifying rather than assuming event-ledger visibility.
### Acceptance Criteria
```gherkin
Feature: 0464 wayfinder investigation

  Scenario: R1 — analyze answers forensic questions, not just spend questions
    Given the forensic record contract from 0455
    When ticket 0464 is resolved
    Then the task body names the concrete queries including per-step attribution
    And a JSON artifact schema with a versioning rule is stated
    And the in-memory versus SQL decision cites volume reasoning
    And reuse of existing analytics helpers is assessed explicitly

  Scenario: R6 — the scheduled loop has an owner and fails visibly
    Given the analyze artifact contract settled in this ticket
    When the scheduling surface is chosen
    Then the surface is named with its reasoning against the alternatives
    And fan-out across six sources isolates per-source failure
    And report delivery and missed-run detection are both specified
```
### Q&A

<!-- Clarifications and decisions made during refinement. Keep empty if none. -->

### Design
**WHAT.** `analyze` becomes a SQL aggregator over the 0455 forensic tables that writes a versioned
JSON artifact; `report` becomes a pure renderer of that artifact with no DB access; a new
`spur history daily` does import-all → analyze → artifact in one run-once invocation, driven by
**launchd**, not by Spur's embedded scheduler.

All volume and behavior claims below are measured on this machine 2026-08-07, not estimated.

#### Measured baseline

| Fact | Measurement |
| --- | --- |
| claude corpus | 308 files · 196.4 MB · ~87,476 lines · 2,245 B/line avg |
| codex corpus | 1,328 files · 552.8 MB · ~502,785 lines · 1,099 B/line avg |
| Two of six sources | **~590k lines / 749 MB** |
| Growth (14 active days) | 236 files · 145 MB → **~10.4 MB/day, ~17 files/day** |
| 30-day projection | +~311 MB, **+~280k lines** → ~870k lines from two sources alone |
| `history_message` / `history_tool_call` | Already landed in ts-libs `llm-jsonl-importer/src/schema-sql.ts:84-142` with the five 0455 indices — the contract is real, not proposed |
| `system_events` | 15,794 rows; `workflow.*` **is** populated (489 `workflow.action.start`, last 2026-08-06); **`history.*` = 0 rows, 0 of 66 declared events** |

#### R1 — The query list

"Step" = one `history_tool_call` row (the tool invocation) or one `history_message` row. The three
axes the lost 0451 report carried, as concrete SQL against the 0455 tables:

```sql
-- Q1 time cost by step: which tool burned the wall clock
SELECT tool_name, COUNT(*) calls, SUM(duration_ms) total_ms,
       CAST(AVG(duration_ms) AS INT) mean_ms, MAX(duration_ms) max_ms,
       SUM(duration_ms IS NULL) unmeasured
FROM history_tool_call WHERE session_id = ?1 GROUP BY tool_name ORDER BY total_ms DESC;

-- Q2 token cost by step: which tool's RESULTS bloated the context
SELECT tc.tool_name, COUNT(*) calls, SUM(tc.result_bytes) result_bytes,
       SUM(m.input_tokens) input_tokens, SUM(m.output_tokens) output_tokens, SUM(m.cost_usd) usd
FROM history_tool_call tc JOIN history_message m ON m.record_hash = tc.message_hash
WHERE tc.session_id = ?1 GROUP BY tc.tool_name ORDER BY result_bytes DESC;

-- Q3 tool calls by step (the headline "which loop burned this session")
SELECT tool_name, COUNT(*) n, SUM(status='error') errors
FROM history_tool_call WHERE session_id = ?1 GROUP BY tool_name ORDER BY n DESC;

-- Q4 LOOP DETECTION — the same call repeated. This is why args_digest exists (0455).
SELECT tool_name, args_digest, COUNT(*) repeats, MIN(seq) first_seq, MAX(seq) last_seq
FROM history_tool_call WHERE session_id = ?1 AND args_digest IS NOT NULL
GROUP BY tool_name, args_digest HAVING COUNT(*) >= 3 ORDER BY repeats DESC;

-- Q5 session leaderboard: which sessions are worth opening at all
SELECT session_id, source, MIN(ts) started, COUNT(*) messages,
       SUM(input_tokens+output_tokens) tokens, SUM(cost_usd) usd
FROM history_message WHERE ts >= ?1 GROUP BY session_id, source ORDER BY tokens DESC LIMIT ?2;

-- Q6 error concentration
SELECT tool_name, COUNT(*) errors FROM history_tool_call
WHERE status='error' AND session_id = ?1 GROUP BY tool_name ORDER BY errors DESC;

-- Q7 turn shape: how much of the session was meta/non-conversational
SELECT disposition, record_type, COUNT(*) n FROM history_message
WHERE session_id = ?1 GROUP BY disposition, record_type ORDER BY n DESC;

-- Q8 spend rollups (the existing surface, re-expressed as SQL — see R4/R5)
SELECT source, model, DATE(ts) day, SUM(input_tokens) i, SUM(output_tokens) o,
       SUM(cache_read_tokens) cr, SUM(cache_write_tokens) cw, SUM(cost_usd) usd, COUNT(*) n
FROM history_message WHERE ts >= ?1 GROUP BY source, model, DATE(ts);

-- Q9 run/task attribution (exact, not heuristic — provenance='spur-run')
SELECT run_id, task_wbs, COUNT(*) messages, SUM(cost_usd) usd
FROM history_message WHERE provenance='spur-run' AND run_id IS NOT NULL GROUP BY run_id, task_wbs;

-- Q10 drift alarm (0455's whole point in counting unknowns rather than skipping)
SELECT source, record_type, COUNT(*) n FROM history_message
WHERE disposition='unknown' AND imported_at >= ?1 GROUP BY source, record_type ORDER BY n DESC;
```

Q4 and Q10 are the two that justify this map's existence: Q4 answers "which tool loop burned this
session", Q10 is the format-drift alarm. Q8 is the *only* thing today's `analyze` can do.

#### R2 — The artifact contract

**`analyze` writes; `report` renders and never touches the DB.** That separation is the contract:
it is what makes the morning report reproducible, diffable, and cheap to re-render.

- **Location:** `.spur/reports/history/<YYYY-MM-DD>/analyze-<selectorDigest>.json`, where
  `selectorDigest` is the first 8 hex of sha256 over the canonicalized selector object. The daily
  loop's digest is stable, so yesterday's and today's artifacts are directly diffable. `--out <path>`
  overrides for ad-hoc use; `latest.json` is a symlink to the newest artifact in the newest dir.
- **Versioning:** integer `schemaVersion`, starting at `1`. Additive fields do **not** bump it;
  removing or retyping a field does. `report` refuses an unknown `schemaVersion` with the artifact
  path and the version it expected — it never renders a shape it does not understand. Old artifacts
  stay readable by old renderers; there is no migration.
- **Retention:** the daily loop prunes `.spur/reports/history/` beyond 90 days.

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-08-07T14:03:11Z",
  "spurVersion": "0.4.12",
  "selector": { "since": "2026-08-06T00:00:00Z", "until": null, "sources": ["claude","codex","pi","omp","grok","agy"],
                "sessionId": null, "runId": null, "taskWbs": null },
  "coverage": [ { "source": "claude", "status": "ok", "files": 308, "messages": 87476, "toolCalls": 12043,
                  "unknownRecords": 17, "lastImportedAt": "2026-08-07T06:00:11Z",
                  "parseErrors": 0, "validationErrors": 0 } ],
  "totals":   { "messages": 0, "toolCalls": 0, "inputTokens": 0, "outputTokens": 0,
                "cacheReadTokens": 0, "cacheWriteTokens": 0, "costUsd": 0,
                "recordsWithUsage": 0, "durationMs": 0, "durationUnmeasured": 0 },
  "bySource": { "claude": { /* totals shape */ } },
  "byModel":  { "claude-opus-5": { /* totals shape */ } },
  "daily":    [ { "date": "2026-08-06", /* totals shape */ } ],
  "byTool":   [ { "toolName": "Bash", "calls": 412, "errors": 9, "durationMsTotal": 918233,
                  "durationMsMean": 2229, "durationMsMax": 61002, "durationUnmeasured": 4,
                  "resultBytes": 8812340 } ],
  "bySession":[ { "sessionId": "a6ac…", "source": "claude", "startedAt": "…", "messages": 235,
                  "toolCalls": 40, "tokens": 1840233, "costUsd": 3.71, "topTool": "Bash" } ],
  "loops":    [ { "sessionId": "a6ac…", "toolName": "Read", "argsDigest": "9f2c…",
                  "repeats": 37, "firstSeq": 88, "lastSeq": 201 } ],
  "warnings": [ { "code": "source-empty", "source": "opencode", "detail": "0 files discovered" } ]
}
```

**`recordsWithUsage` and `durationUnmeasured` are load-bearing, not decoration.** They are the
denominators that let `report` print `n/a` instead of a fabricated `0` — the same 0281/0284
never-fabricate invariant `cacheHitRatio` already encodes (`packages/domain/src/analytics/costs.ts:81-87`), extended to
duration. 0455 ruled a NULL `duration_ms` is a fact; the artifact must carry how many were NULL or
the renderer will silently average over them.

**Where machine-parsable and human-legible DO pull apart — one real finding.** Today's import result
carries `parseErrors` and `validationErrors` as **unbounded arrays, one entry per bad line**. Probed
`spur history import --source gemini --json`: the error array alone overran a 64 KB pipe buffer. At
590k lines a mapping regression produces a multi-hundred-MB "report". The artifact therefore stores
**counts plus the first 20 samples per source**; full detail streams to a sidecar
`analyze-<digest>.errors.jsonl`. Bounded artifact for both readers, nothing lost for forensics. This
is the one place the two needs genuinely diverge, and it is resolved by splitting the file, not by
choosing a winner.

#### R3 — Selector set

Six selectors, all composable, all mapping to an indexed column:

| Selector | Flag | Column | Serves |
| --- | --- | --- | --- |
| Time window | `--since` / `--until` (ISO) | `history_message.ts` (indexed) | both |
| Source | `--source <s>` / `all` | `source` | both |
| Session | `--session <id>` | `session_id` (indexed w/ source, seq) | forensics |
| Run | `--run <runId>` | `run_id` | forensics |
| Task | `--task <wbs>` | `task_wbs` | forensics |
| Leaderboard depth | `--top <n>` (default 20) | LIMIT on `bySession`/`byTool` | both |

`--since`/`--source all` is the scheduled loop's selector; `--session` is the ad-hoc forensic entry
point. Every selector hits an existing 0455 index except `run_id`/`task_wbs`, which need one added
index `(provenance, run_id)` — cheap and additive.

**Deliberately not a selector:** `--project`/`--cwd`. `cwd` is on `history_message` and can be added
later without a schema change; adding it now is a seventh axis with no demonstrated demand.

#### R4 — SQL, not in-memory. Decided on measurement.

Today's path (`packages/app/src/services/history-service.ts:73-78`) is
`queryAllEtlRecords` → `records.map(computeRecordCost)` → `aggregateCosts`: three full-corpus arrays
live at once, since `queryAllEtlRecords` (`packages/domain/src/analytics/query.ts:55-72`) issues a bare
`SELECT payload_json FROM <table>` with no LIMIT and `JSON.parse`s every row.

Benchmarked at 600k rows (≈ today's real two-source corpus) with a 1.1 KB payload — the *codex*
average; claude's 2.2 KB doubles the memory term:

| Path | Time | Heap |
| --- | --- | --- |
| Load-all + JS aggregate (today) | 652 ms | **+865 MB** |
| `SELECT … GROUP BY model` | 286 ms | constant |
| `GROUP BY session_id ORDER BY … LIMIT 10` | 225 ms | constant |

**Verdict: SQL.** At today's volume the current path already allocates ~865 MB for one `analyze`
call. At the measured +280k lines/month it crosses ~1.3 GB within a month and ~2 GB by month two —
for a run-once CLI on a laptop, in a process that also holds the importer. The time difference
(652 ms vs 286 ms) is immaterial; the **memory profile is the decision**, and it is not a tuning
problem — it is linear in corpus size by construction. SQL aggregation is constant-memory in the
corpus and bounded by the result-set size, which the selectors already bound.

Secondary reason, equally decisive: `byTool`, `loops` (Q4), and per-step duration cannot be computed
from `history_etl_*` at all — they need `history_tool_call` rows, which only exist in SQL.

#### R5 — What survives

Assessed rather than assumed. Reuse is the default; each item below is a deliberate call.

| Existing | Disposition | Why |
| --- | --- | --- |
| `formatSummary` (`packages/domain/src/analytics/costs.ts:90-125`) | **Survives, moves.** Becomes one renderer *section* inside `report`, fed from the artifact's `totals`/`bySource`/`byModel` instead of an `AnalyticsSummary`. | Its shape is already the artifact's shape; the padding/`toFixed` layout is good and re-deriving it is pure waste. |
| `cacheHitRatio` + `formatRatio` (`packages/domain/src/analytics/costs.ts:81-131`) | **Survives verbatim.** | The never-fabricate invariant is exactly what the artifact needs; extend the same pattern to duration. |
| `TokenTotals` / `AnalyticsSummary` (`packages/domain/src/analytics/types.ts:40-64`) | **Survives as the artifact's core, extended.** Add `messages`, `toolCalls`, `durationMs`, `durationUnmeasured`; rename `cacheCreationTokens` → `cacheWriteTokens` to match the landed column. | The bucket shape is right; it is missing the forensic dimensions, not wrong. |
| `accumulate` (`packages/domain/src/analytics/costs.ts:29-37`) | **Dies with the in-memory path.** | Its own comment says it exists so a new dimension is added once — SQL `SUM()` gives that for free. |
| `aggregateCosts` (`packages/domain/src/analytics/costs.ts:40-70`) | **Replaced by SQL.** | This *is* the O(corpus) in-memory fold R4 rules out. |
| `queryAllEtlRecords` / `etlToCostRecord` (`packages/domain/src/analytics/query.ts:55-72,119-144`) | **Replaced.** `etlToCostRecord`'s 4-chars-per-token fallback (`packages/domain/src/analytics/query.ts:125-131`) does not survive at all. | 0455 makes token counts a typed column; a length-based *estimate* silently entering a cost total is the fabrication the contract exists to end. |
| `run-cost.ts` attribution (`loadAllEtlPayloads:103`, `matchEtlPayloads:131`, `actionCost:179`) | **Survives now, demoted later.** Keep the R1b time-window heuristic for the four sources without `--session-dir`; for `provenance='spur-run'` rows, Q9's exact `run_id` join supersedes it. | 0455 routes pi/omp through exact attribution; the other four still need the heuristic, so deleting it would lose coverage. `estimated: true` already marks which path ran. |

**Bug found while assessing, worth its own ticket.** `SOURCE_TABLES` (`packages/domain/src/analytics/query.ts:8-16`)
lists seven tables and **omits `history_etl_omp`, `history_etl_grok`, `history_etl_agy`** — three of
the six in-scope sources. `spur history analyze` is structurally blind to them today, and
`loadAllEtlPayloads` inherits the same blind spot, so workflow run-cost attribution silently misses
any omp-executed step — and `agent.default` is `omp` (`config/config.example.yaml`). The SQL cut-over
dissolves this (one `history_message` table, no per-source allowlist), but it is a live wrong-answer
bug until then, not merely a gap.

#### R6 — Scheduling surface: **launchd**. Spur's scheduler cannot do this.

The task asked to establish what A2's embedded scheduler can actually drive before choosing. Three
findings, each independently disqualifying:

1. **It cannot express a daily schedule.** `NodeSchedulerAdapter.parseInterval` (ts-infra
   `src/scheduler/node.ts`) handles only `* * * * *`, `*/N * * * *`, and raw millisecond strings.
   A real cron field expression — `0 7 * * *`, "7am daily" — hits the documented fallback and
   **silently becomes a 60-second interval**, with only a warn log. The adapter's own comment says
   running them every minute "would badly misfire". A daily job is not expressible.
2. **It needs a long-lived process the CLI does not have.** It is `setInterval`-based and in-process;
   `bootstrap.scheduler.enabled` is `false` in `config/config.example.yaml:33-34` and the schema
   documents it as "OFF by default for CLI (run-once)" (`apps/cli/schemas/spur-config.schema.json:90`).
3. **Nothing is registered on it.** Zero `initScheduler` call sites and zero cron entries exist
   anywhere in `apps/` or `packages/`. The 2,867 `scheduler.job.executed` rows in `system_events` all
   stop at 2026-07-29 — residue from the A2 queue work, not a live surface.

| Candidate | Verdict |
| --- | --- |
| Spur embedded scheduler | **Rejected** — cannot express daily, needs a daemon the CLI is not, drives nothing today. Wiring it means writing a cron parser *and* a supervised daemon: a large build to schedule one command. |
| **launchd** (`~/Library/LaunchAgents/ai.gobing.spur.history.daily.plist`) | **Chosen** — `StartCalendarInterval` is exactly a daily wall-clock trigger; the OS supervises, survives reboot, and runs missed jobs at next login. Operator is macOS-primary (`AGENTS.md` stack defaults). Zero new Spur code for the trigger. |
| Agent-side scheduling | **Rejected** — makes the data plane depend on a coding agent being open, which is precisely the ambient-vs-attended coupling 0455 removed. |
| `spur workflow run` as the driver | **Rejected as the trigger, unnecessary as the body.** A workflow still needs an external trigger, and the action registry (`packages/app/src/workflow/actions/`) has `shell`/`agent-run`/`file-*`/`hitl-*`/`http-request`/`rule-check` but **no `foreach` or `parallel`** — fan-out would be six hand-enumerated `shell` steps. That is more YAML than a `--source all` flag, with worse error isolation. |

**Harness observability is not conceded by choosing launchd** — it is bought back by R8's
`history.*` events, which land in `system_events` regardless of what invoked the CLI. That is
strictly better than coupling observability to the scheduler.

**The command launchd invokes:** `spur history daily` — one verb doing import-all → analyze →
artifact → prune. One plist, one command, no wrapper script to drift.

#### R7 — Fan-out and the nightly window

**Fan-out lives in `spur history`, not in the scheduler.** `--source` takes one value defaulting to
`pi` (`apps/cli/src/commands/history.ts:12`); add `--source all` iterating the ten known sources.
Placing isolation in the CLI means it holds no matter what drives it — launchd, a workflow, or a
human.

**Per-source isolation contract:**

- Each source runs in its own `try`; a throw is caught, recorded as
  `{source, status:'failed', error}` in `coverage`, and the loop continues. One source never aborts
  another. This is map AC R6.
- Exit code is **2 = partial** (≥1 source failed, ≥1 succeeded), **1 = total failure** (all failed),
  **0 = all ok**. Today `import` returns 1 for *any* parse/validation error
  (`commands/history.ts:27`), which under fan-out would make one noisy source indistinguishable from
  six dead ones.
- Each source commits its own transaction. A source that fails mid-import leaves its checkpoint
  where it was and re-resumes next run; it does not roll back its siblings.
- Per-source timeout so one pathological corpus cannot hang the nightly job past its window.

**"Yesterday's sessions" is not a date window — confirmed against 0457.** 0457 verified incremental
mode PASS: append-only resume works, the checkpoint advances correctly, and dry-run does not advance
it. So the nightly import is plain `--mode incremental` with **no date argument** — it imports
whatever arrived since the last checkpoint, which is the correct semantics and is self-healing: a
missed night is picked up the next night automatically, with no gap and no double-count.

The **analyze** step is the only one that takes a window, and it takes `--since <24h ago>` purely to
scope the *report*, never the import.

Two 0457 caveats carried forward, both already covered by the realpath-normalization ticket, and
both **worse under fan-out** than they were single-source:
- The realpath/path-identity bug (0457 R4) yields duplicate checkpoint rows per physical file. Under
  `--source all` every source is affected on every run, since each agent dir under `$HOME` is a
  symlink.
- The rewrite-shorter blind spot (0457 R2) is theoretical for today's six sources but becomes a
  silent nightly data-loss path the day any agent adds compaction.

`spur history daily` should not ship before the realpath-normalization fix lands.

#### R8 — Delivery and missed-run detection

**Delivery.** The artifact is the delivery; `spur history report` is how the operator reads it,
rendering `latest.json` by default. Three additions make it *arrive* rather than wait:

1. A rendered `analyze-<digest>.md` written next to the JSON — the morning read, no CLI needed.
2. `.spur/reports/history/latest.json` symlink so `report` and any dashboard have a stable path.
3. The existing daily-summary surface (`/sp:dev-daily`) gains the report path — reusing a surface the
   operator already opens beats inventing a notification channel.

**Missed-run detection — verified, not assumed.** The task flagged `system_events` as suspect. Live
check of the 15,794-row ledger:

- **Correction to prior belief:** the ledger is *not* dead. `workflow.*` rows are live and current —
  489 `workflow.action.start`, 216 `workflow.run.started`, last written 2026-08-06. The
  prune-heartbeat characterization is stale.
- **The real gap:** `SELECT COUNT(*) … WHERE event_name LIKE 'history%'` returns **0**, and **zero
  of the 66 events declared in `packages/app/src/services/event-names.ts` are `history.*`**. The
  history plane emits nothing. Ledger visibility for this loop does not exist and must be built.

So detection is four layers, cheapest first — no single one is trusted:

| Layer | Signal | Detects |
| --- | --- | --- |
| 1. Artifact freshness | `report` prints a loud banner when `latest.json` is older than 36 h | The whole loop stopped — catches launchd unloaded, disk full, crash-on-start |
| 2. `history.*` ledger events | Declare `history.import.completed`, `history.analyze.completed`, `history.daily.failed` in `event-names.ts`; query last occurrence | A run that started and died mid-way — layer 1 alone cannot distinguish "never ran" from "ran and failed" |
| 3. Per-source `coverage[].status` | `ok` \| `failed` \| **`empty`** in the artifact | One source silently stopped while five kept working |
| 4. launchd `StandardErrorPath` | `.spur/logs/history-daily.err` | Failures before Spur's own logging is up |

**Layer 3 exists because of a probe finding.** `spur history import --source opencode` returns
`files=0 lines=0 imported=0` and **exit 0** — an absent source is bit-identical to a healthy no-op.
Under nightly fan-out that means an agent whose history path changed would report success forever
while importing nothing. `coverage[].status='empty'` must be its own state, distinct from `ok`, and
a source that was non-empty yesterday and is empty today is a **warning**, not a success.

#### Anti-patterns for the implementer

- Do **not** keep `etlToCostRecord`'s 4-chars-per-token estimate (`packages/domain/src/analytics/query.ts:125-131`) alive into the
  artifact. An estimate that reaches a cost total without a flag is exactly the fabrication 0455 ends.
- Do **not** let `report` open the database. The moment it does, the artifact stops being a contract
  and the morning report stops being reproducible.
- Do **not** write the unbounded error arrays into the artifact. Counts + 20 samples; the rest to the
  sidecar.
- Do **not** wire the embedded scheduler "since it's already there". It cannot express daily, and a
  60-second silent fallback loop is worse than no scheduler.
- Do **not** treat a zero-file source as success.

#### ADR: no.

0455 already routed the structural decision (the two-table shape and the importer's split extension)
to `docs/00_ADR.md`. This ticket picks a consumption surface and an OS-level trigger on top of that
contract — `docs/04_DESIGN.md` §`spur history` covers the command surface, same commit as the code
(T3). If the artifact schema later needs a v2, that bump is the ADR-worthy event, not v1.

#### Handoff — implementation tickets this graduates

1. **analyze → SQL over the forensic tables** (Q1–Q10, selectors, artifact writer). Sequenced after
   the forensic-ETL implementation ticket, which populates the tables this reads.
2. **report → artifact renderer** (reuses `formatSummary`; markdown sidecar; freshness banner).
3. **`--source all` + `spur history daily`** with per-source isolation and the 0/1/2 exit contract.
   Sequenced after the realpath-normalization ticket, per R7.
4. **`history.*` events in `event-names.ts`** + the launchd plist and its install path.
5. **Fix `SOURCE_TABLES`** (`packages/domain/src/analytics/query.ts:8-16`) to include omp/grok/agy — standalone bug,
   fixable today, independent of everything above.
### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution
**Investigation ticket (`wayfinder:grilling`) — no code changed.** The deliverable is the decision
recorded in `### Design`; this section is the change-map of what was read and measured to produce it.

**Code anchors inspected (monorepo):**

| File | What it established |
| --- | --- |
| `packages/app/src/services/history-service.ts:73-78` | analyze's three-array load-all path — the R4 memory profile |
| `packages/domain/src/analytics/query.ts:8-16` | `SOURCE_TABLES` omits omp/grok/agy — the R5 blind-spot bug |
| `packages/domain/src/analytics/query.ts:55-72` | unbounded `SELECT payload_json` with no LIMIT |
| `packages/domain/src/analytics/query.ts:119-144` | `etlToCostRecord` 4-chars-per-token fallback (retired by R5) |
| `packages/domain/src/analytics/costs.ts:81-131` | `cacheHitRatio` / `formatRatio` never-fabricate pattern (survives) |
| `packages/domain/src/analytics/costs.ts:90-125` | `formatSummary` (survives as a report section) |
| `packages/domain/src/analytics/types.ts:40-64` | `TokenTotals` / `AnalyticsSummary` — the artifact's core shape |
| `packages/domain/src/analytics/run-cost.ts:103,131,179` | attribution helpers assessed for R5 |
| `apps/cli/src/commands/history.ts:12` | single-valued `--source`, default `pi` (R7 fan-out gap) |
| `apps/cli/src/commands/history.ts:27` | exit 1 on any parse error (R7 exit-code contract) |
| `apps/cli/src/commands/history.ts:39-52` | `report` not-implemented stub |
| `apps/cli/schemas/spur-config.schema.json:90` | `runtime.scheduler.enabled` — "OFF by default for CLI" |
| `config/config.example.yaml:33-34` | scheduler disabled in the shipped example |
| `packages/app/src/services/event-names.ts` | 66 declared events, zero `history.*` (R8 gap) |
| `packages/app/src/workflow/actions/` | no `foreach`/`parallel` action — R6 workflow rejection |

**External anchors** (ts-libs, outside repo root — cite package + symbol per the 0457 convention):
llm-jsonl-importer `schema-sql.ts` — `history_message` / `history_tool_call` DDL and the five indices
(the landed contract); ts-infra `scheduler/node.ts` — `NodeSchedulerAdapter.parseInterval` cron
fallback; ts-infra `scheduler/factory.ts` — `initScheduler`, no monorepo call site.

**Measurements taken** (2026-08-07, this machine): corpus walk of the claude and codex history roots
(file counts, bytes, extrapolated line counts, 14-day growth); a 600k-row SQLite benchmark comparing
load-all+JS aggregation against `GROUP BY` (timing and heap delta); live queries against
`.spur/spur.db` `system_events` (15,794 rows) for event-name coverage; and CLI probes of
`spur history import` for three sources to characterize empty-source and error-flood behavior.
Numbers are tabulated in `### Design` § Measured baseline and § R4.
### Testing
**N/A** — decision ticket, no code changed, so no test suite applies. Verification here is the
measurement evidence behind the decision, plus a confidence rating on each load-bearing claim.

**Verification performed:**

| Probe | Command / method | Result |
| --- | --- | --- |
| Corpus volume | filesystem walk of the claude + codex history roots | 1,636 files, 749 MB, ~590k lines |
| Growth rate | mtime histogram, last 14 active days | ~10.4 MB/day → +~280k lines/30d |
| Aggregation cost | 600k-row SQLite bench, load-all+JS vs `GROUP BY` | 652 ms/+865 MB heap vs 286 ms/constant |
| Ledger coverage | `SELECT event_name, COUNT(*) … GROUP BY` on `.spur/spur.db` | `workflow.*` live to 2026-08-06; `history.*` = 0 |
| Event catalog | grep of `event-names.ts` | 66 events declared, zero `history.*` |
| Empty-source behavior | `spur history import --source opencode --json` | `files=0`, exit 0 — indistinguishable from success |
| Error-flood behavior | `spur history import --source gemini --json` | validation-error array overran a 64 KB pipe buffer |
| Scheduler capability | read of ts-infra `parseInterval`; grep for `initScheduler` call sites | daily cron unsupported (60 s fallback); zero call sites |

**Confidence ratings:**

| Claim | Rating | Basis |
| --- | --- | --- |
| R4 — in-memory aggregation does not survive the corpus | **HIGH** | Measured today: +865 MB heap at a row count matching the live corpus; scales linearly by construction |
| R6 — the embedded scheduler cannot drive a daily job | **HIGH** | Read from ts-infra source today; three independent disqualifiers, each verified |
| R5 — `SOURCE_TABLES` is blind to omp/grok/agy | **HIGH** | Read from `packages/domain/src/analytics/query.ts:8-16` today |
| R8 — no `history.*` ledger visibility exists | **HIGH** | Queried the live 15,794-row ledger and the event catalog today |
| R8 — an empty source is silently successful | **HIGH** | Reproduced via CLI probe today |
| R2 — the artifact schema as specified | **MEDIUM** | Sound design, unproven until built; field set is derived from the landed 0455 columns, so shape risk is low, but v1 will meet cases this ticket cannot foresee |
| R1 — the ten queries are the right ten | **MEDIUM** | Grounded in the landed schema and the lost report's three axes; the loop-detection and drift queries are the novel pair and have not been run against populated forensic tables (they are empty until the ETL implementation lands) |
| R7 — launchd fan-out reliability in practice | **MEDIUM** | `StartCalendarInterval` semantics are documented and stable; this operator's specific plist has not been installed or observed across a reboot |
| R3 — the selector set is sufficient | **MEDIUM** | Covers both stated consumers; `--project`/`--cwd` deliberately deferred and may prove needed |
### Review
| Severity | File | Finding | Recommendation |
| --- | --- | --- | --- |
| P2 | `packages/domain/src/analytics/query.ts:8-16` | `SOURCE_TABLES` omits `history_etl_omp`, `history_etl_grok`, `history_etl_agy`. `spur history analyze` and `loadAllEtlPayloads` are structurally blind to three of six in-scope sources — including omp, the configured `agent.default`, so workflow run-cost attribution silently under-reports today. | Standalone bug fix, independent of this map's implementation chain. Add the three tables to the allowlist now; the SQL cut-over later dissolves the allowlist entirely. |
| P3 | `apps/cli/src/commands/history.ts:39-52` | `report` is a not-implemented stub, so the artifact contract this ticket specifies has no consumer until the renderer ticket lands. Specified but unbuilt. | Sequence the renderer ticket immediately after the analyze cut-over so the artifact is never write-only. |
| P3 | `packages/app/src/services/event-names.ts` | The history plane declares zero of the 66 catalogued events, so a scheduled loop would have no ledger trail whatsoever. The chosen scheduling surface is external to Spur, which makes this the *only* in-harness signal. | Declare `history.import.completed`, `history.analyze.completed`, `history.daily.failed` as part of the daily-command ticket, not as a follow-up. |
| P4 | `### Design` R2 | The artifact `schemaVersion` starts at 1 with an additive-changes-do-not-bump rule. A consumer written against v1 that *requires* a field added later has no way to express that requirement. | Accept for v1. If a third consumer appears, add a `minimumFields` assertion rather than over-versioning now. |
| P4 | `### Design` R7 | `spur history daily` is specified as blocked on the realpath fix, but nothing mechanically enforces that ordering. | Note the dependency on the implementation ticket when it is created; no gate needed for a two-ticket ordering. |

**Residual risk.** The two MEDIUM-confidence areas are the artifact schema (R2) and the query set
(R1): both are derived from the landed forensic columns, but neither has been exercised against
populated `history_message` / `history_tool_call` tables, which stay empty until the ETL
implementation ticket lands. The failure mode is a v1 artifact missing a field the first real report
wants — cheap to fix additively under the stated versioning rule, and deliberately preferred over
speculating a wider schema now. The scheduling decision (R6) carries no residual risk: it rests on
three independently verified disqualifiers read from source today.

**Disposition.** Investigation complete. All eight requirements answered with measured evidence; the
one genuine machine-vs-human divergence (unbounded error arrays) is identified and resolved by
splitting the artifact from an error sidecar rather than compromising either reader. Five
implementation tickets graduate from this map. Ready to close.
### References

E1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-07T03:58:20.317Z todo → wip (system)
- 2026-08-07T04:03:29.994Z wip → testing (system)
- 2026-08-07T04:03:40.203Z testing → done (system)
