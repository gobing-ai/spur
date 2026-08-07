---
template: feature-impl
schema_version: 1
name: "ETL contract: what is a forensic history record?"
description: ""
status: done
type: task
profile: standard
feature_id: E1
parent_wbs: null
priority: P2
tags: []
dependencies: ["0463"]
created_at: "2026-08-06T23:09:53.642Z"
updated_at: "2026-08-07T00:43:02.155Z"
done_forced: "true"
done_reason: "Wayfinder investigation ticket resolved by decision, not code. R1-R7 are all 'the task body states X' and are satisfied in Design + Q&A; there is no implementation in this task to verify. The contract itself is verified when the graduated implementation task lands."
---

## 0455. ETL contract: what is a forensic history record?

### Background
**Wayfinder ticket** — type: `wayfinder:grilling`. Map: feature E1. **Unblocked** — dependency
0463 is `done` (field map + ingestion inventory ready). Resolve with `sp:dev-refine` (structured Q&A,
one question at a time). Consolidates cancelled tickets 0459 and the decision half of 0462.
Also consumes 0457 checkpoint verdict (line-number OK for current agents; path-identity fix is 0465).

**This is the keystone.** 0464 is blocked on it, and every implementation task graduates from it.

**The question:** What is a forensic history record — the canonical shape `spur history import`
persists so a report can attribute time cost, token cost, and tool calls *by step* — which sources
feed it, and where does the mapping that produces it live?

**Why it is open.** `ts-llm-jsonl-importer@0.4.19` persists one flat row per JSONL line into
`history_etl_<source>` with a `payload_json` blob, validated against a schema requiring top-level
`content: string`. Real transcripts nest their payload — claude puts everything under
`message.{model,usage,content[]}` across 9 record types, and tool calls are content blocks. Measured
yield is ~1%. The current shape cannot express step forensics at all.


- Granularity: one row per JSONL line, per message, per content block, or per tool call? A `tool_use`
  and its matching `tool_result` arrive on different lines — what row do they collapse into?
- Linkage: how are session, turn, and step identified across sources with different id schemes?
- Duration: derived from adjacent timestamps, or read from a field where one exists? What happens at
  gaps and interruptions?
- Usage rollup: which numbers are authoritative for cost when nested `usage.iterations[]` disagrees
  with top-level counts?
- Cross-source normalization: one shared queryable shape, or per-source tables with a view over them?
  This decides whether analyze is written once or six times.
- Backward compatibility: `packages/domain/src/analytics/run-cost.ts` and `costs.ts` already read
  `EtlPayload`. Does the new shape extend it or replace it?


0463 supplies the facts; this ticket makes the call.

- Cover Spur-launched run sessions (`.spur/run/<runId>/agent-sessions/<agent>/`), ambient `$HOME`
  history, or both? A report seeing only Spur-launched runs cannot diagnose an interactive session;
  one seeing only ambient history throws away exact run correlation Spur already has.
- If both: one source with two roots, or distinct provenance carried on the record?
- Can `run_id` and task WBS be recorded at import time for the two sources that honor
  `--session-dir` (pi, omp), instead of reconstructed? `run-cost.ts:131` matches heuristically today.
  What do claude, codex, agy, and grok fall back to?
- For agy: JSONL transcript or the `conversations/<uuid>.db` SQLite store (0463 characterizes both)?


- Can `SourceDefinition` express step forensics declaratively? It is currently `defaultRoots`,
  `filePatterns`, a flat field-rename map, and `splitConfig` with `one-to-one` / `one-to-many` /
  `custom` modes (`~/xprojects/ts-libs/packages/llm-jsonl-importer/src/sources.ts:59-108`). Step
  forensics needs conditional record-type dispatch, cross-line joins, nested extraction, and derived
  durations. **Establish what `splitConfig.mode: 'custom'` already permits before proposing a new
  seam.**
- Options: extend the declarative model; add a per-source transform hook; move mapping into Spur
  (contradicts the `AGENTS.md` prefer-fix-the-facade rule — needs a real reason); or have
  `ts-ai-runner`'s shims own history location while the importer owns parsing, collapsing the two
  drifted registries into one.
- Blast radius: `@gobing-ai/ts-llm-jsonl-importer` has consumers beyond Spur, and
  `HISTORY_IMPORT_SCHEMA_SQL` is consumed by `packages/domain/src/migrations.ts:4` — a schema change
  is a Spur migration too.
- Whatever is chosen must leave adding the deferred sources (gemini, opencode, antigravity-ide,
  openclaw, hermes) mechanical rather than a redesign.

**Constraint:** upstream edits are authorized (map Decisions, 2026-08-06) — `~/xprojects/ts-libs`
developed against Spur via `bun link`. `bun link` validates unreleased fixes only; landing needs a
released version and a catalog bump.

**Resolved when** the task body carries the record shape as a concrete schema (fields, types, keys),
the granularity and linkage rules, the ingestion-path decision, the chosen mapping placement with its
migration path for existing `history_etl_*` tables, and an answer on whether this warrants an ADR
(`docs/00_ADR.md`) — changing a shared package's extension model probably does.

**Do not** write production code here. Implementation graduates into separate tasks once the contract
is settled.
### Requirements
- R1 — Define the canonical forensic record shape as a concrete schema (fields, types, keys) capable of attributing time cost, token cost, and tool calls by step.
- R2 — State the granularity rule and how a tool_use block collapses with its later tool_result, plus session/turn/step linkage across all six sources.
- R3 — State which usage numbers are authoritative for cost when nested iterations disagree with top-level counts, and how per-step duration is derived.
- R4 — Decide cross-source normalization (one shared shape vs per-source tables with a view) and whether the existing EtlPayload contract extends or is replaced.
- R5 — Decide which ingestion paths feed the record — Spur-launched run sessions, ambient $HOME history, or both — with provenance and run-correlation rules, and the fallback for sources ignoring --session-dir.
- R6 — Decide where per-source mapping lives, having first established what splitConfig.mode custom already permits, with blast-radius assessment and a migration path for existing history_etl_ tables.
- R7 — State whether the change warrants an ADR in docs/00_ADR.md.
### Acceptance Criteria
```gherkin
Feature: 0455 wayfinder investigation

  Scenario: R1 — the contract is concrete enough to implement against
    Given the per-source field map and ingestion-path facts from 0463
    When ticket 0455 is resolved
    Then the task body carries a field-level schema for the forensic record
    And each of R2 through R7 has an explicit answer or a deferral with a stated reason
    And the chosen mapping placement leaves the deferred sources mechanical to add
    And no production code was written in this ticket
```
### Q&A
**2026-08-07 — three operator decisions closed (decision briefs, not investigations).**

1. **Granularity → one row per tool call + one per message.** Rejected message-only (per-tool
   attribution would need JSON extraction on every report) and per-JSONL-line (pushes all forensic
   structure into analyze-time queries — the thing that makes report expensive and fragile). Accepted
   cost: `history_tool_call` is the largest table; omp showed 247 tool calls in one 489-line session.
2. **Undeterminable records → capture as `unknown`, count loudly.** Rejected hard-fail (one format
   change breaks the nightly loop for a source) and skip-with-warning (that is today's behavior, and
   it is how the ~1% yield went unnoticed for this long).
3. **Normalization → one shared shape, per-source raw retained.** Rejected per-source tables plus a
   view: the view would have to do the normalizing anyway, so the mapping cost is paid either way —
   better paid once at import than on every query.

**Closed during this session, not deferred:**

- *What does `splitConfig.mode: 'custom'` already permit?* — R6's stated prerequisite. Answered by
  reading `llm-jsonl-importer/src/types.ts:21-25` and `src/importer.ts:174-180`: it already accepts an
  arbitrary `(raw) => readonly JsonObject[]`, so type dispatch and one-line-to-many-rows are available
  today. Its only gap is that `targetTable` is per-config rather than per-entry. That single fact is
  what makes the placement answer a surgical extension instead of a new hook.
- *Usage authority when claude's `iterations[]` disagrees with top-level counts* — top-level wins;
  discrepancy counted once per import rather than per row.

**Deferred with reason:**

- *Reading agy's `conversations/<uuid>.db`* — its model and usage live in protobuf/blob columns. v1
  leaves those NULL for agy rather than adding a binary decoder to the import path. Revisit only if
  agy cost attribution turns out to matter; it is out of scope for the destination as charted.
- *Retention, pruning, and index tuning* — still fog on the map. The shape is now fixed, so this is
  specifiable, but it depends on measured growth after the first real imports. Graduate after 0464.
### Design
**WHAT.** Two normalized tables plus retained per-source raw. `history_message` (one row per message)
and `history_tool_call` (one row per tool invocation) are the forensic contract; the existing
`history_etl_<source>` tables stay as the raw payload of record.

**WHY.** Attributing time cost, token cost, and tool calls *by step* needs tool calls as first-class
rows — omp alone showed 247 tool calls in a 489-line session, and every "which tool loop burned this
session" question is a `GROUP BY tool_name` away once they are rows rather than nested JSON.

**Granularity (operator decision, 2026-08-07): one row per tool call + one per message.**

```sql
CREATE TABLE IF NOT EXISTS history_message (
    record_hash        TEXT PRIMARY KEY,   -- sha256(source, source_file, source_line, split_index)
    source             TEXT NOT NULL,      -- claude|codex|pi|omp|agy|grok
    source_file        TEXT NOT NULL,      -- realpath-normalized (see 0465)
    source_line        INTEGER NOT NULL,
    session_id         TEXT NOT NULL,
    seq                INTEGER NOT NULL,   -- monotone order within session
    turn_index         INTEGER,            -- NULL where the source has no turn concept
    role               TEXT NOT NULL,      -- user|assistant|system|meta|unknown
    record_type        TEXT NOT NULL,      -- the source's own discriminator, verbatim
    disposition        TEXT NOT NULL,      -- keep|meta|unknown
    ts                 TEXT NOT NULL,      -- ISO-8601 UTC
    duration_ms        INTEGER,            -- NULL unless the source supplies or it is derivable
    model              TEXT,               -- NULL for agy (see per-source constraints)
    input_tokens       INTEGER,
    output_tokens      INTEGER,
    cache_read_tokens  INTEGER,
    cache_write_tokens INTEGER,
    cost_usd           REAL,               -- NULL when not derivable; never guessed
    content_text       TEXT,               -- reconstructed; NULL for meta rows
    cwd                TEXT,
    provenance         TEXT NOT NULL,      -- ambient|spur-run
    run_id             TEXT,               -- non-NULL only when provenance='spur-run'
    task_wbs           TEXT,
    imported_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS history_tool_call (
    record_hash   TEXT PRIMARY KEY,
    message_hash  TEXT NOT NULL,           -- FK -> history_message.record_hash (the invoking message)
    source        TEXT NOT NULL,
    source_file   TEXT NOT NULL,
    source_line   INTEGER NOT NULL,
    session_id    TEXT NOT NULL,
    seq           INTEGER NOT NULL,
    tool_name     TEXT NOT NULL,
    args_digest   TEXT,                    -- sha256 of redacted, key-sorted args; never raw args
    status        TEXT NOT NULL,           -- ok|error|unknown
    started_at    TEXT,
    completed_at  TEXT,
    duration_ms   INTEGER,
    result_bytes  INTEGER,
    error_text    TEXT,
    imported_at   TEXT NOT NULL
);
```

Indices: `(source, session_id, seq)` on both; `(tool_name)` and `(message_hash)` on
`history_tool_call`; `(ts)` on `history_message`.

**Why `args_digest` and not raw args.** Tool arguments carry file contents, secrets, and prompt text.
A digest supports "the same call repeated N times in a loop" — the actual forensic question — at a
fraction of the size and with no new redaction surface. Raw args stay in `history_etl_<source>`.

**Linkage rules.** `session_id` is per-source: claude `sessionId`; pi/omp `session.id`; grok
`params.sessionId`; agy the brain UUID directory; codex `session_meta.id`. `seq` is assigned at import
as the line ordinal within a session file, so ordering never depends on timestamp precision. Tool
calls join to their invoking message by `message_hash`; the pairing is per-source:

| source | tool pairing |
| --- | --- |
| claude | `toolUseID` / `sourceToolUseID` / `toolUseResult` |
| codex | `response_item` `function_call` ↔ its result item |
| pi / omp | `toolCall` blocks in assistant content ↔ `tool_result` blocks in the next user record |
| grok | `tool_call` ↔ `tool_call_update`; `tool_started` / `tool_completed` bracket the timing |
| agy | `PLANNER_RESPONSE.tool_calls[]` ordered by `step_index` |

**duration_ms precedence.** (1) An explicit source field where one exists — grok
`turn_completed.usage.apiDurationMs` and `tool_started`/`tool_completed` timestamps, claude `system`
`subtype: turn_duration` `durationMs`. (2) Otherwise derive from adjacent `ts` within a session.
(3) Otherwise NULL. **Never** interpolate across a gap or a session boundary — a NULL duration is a
fact, an invented one is a corrupt report.

**Usage authority.** Where claude's `message.usage.iterations[]` disagrees with the top-level counts,
the **top-level counts win** and the discrepancy is recorded once per import as a counter, not
per-row. Cache tiers map to `cache_read_tokens` / `cache_write_tokens`; `cost_usd` is computed only
where model and token counts are both present.

**Per-source constraints — these are facts, not gaps to fill:**

- **agy** carries no model and no usage in its JSONL; both live in the `conversations/<uuid>.db`
  SQLite (protobuf/blob). `model`, token columns, and `cost_usd` are NULL for agy in v1. Reading the
  SQLite store is explicitly deferred (see Scope Out).
- **grok** supplies per-turn usage only, never per-call, and its content is chunked across streaming
  records requiring reconstruction before `content_text`. It is also the only source with true
  per-step tool timing.
- **claude, pi, omp, codex** supply no per-step duration; theirs is derived.

**Unknown records (operator decision, 2026-08-07): capture as `unknown`, count loudly.** A record
whose type cannot be determined is persisted with `disposition='unknown'`, `record_type` set to a
stable field-shape key (sorted top-level key join), and the raw payload retained. Every import
reports `unknownRecords` per source in its result. grok emits at least six such shapes today
(`method+params+timestamp`, `after_snapshots+created_at+file_snapshots`, `agentId+authorId+authorType`,
`agentId+eventType+filePath`, `is_bash+prompt+session_id`, `answer+askedAt+attempts`) — a
type-dispatching mapper would drop all of them silently, which is the ~1% failure one level down.
**A rising unknown count is the format-drift alarm**; that is the whole point of counting rather than
skipping.

**Normalization (operator decision, 2026-08-07): one shared shape, per-source raw kept.** analyze and
report are written once against `history_message` / `history_tool_call`. `history_etl_<source>`
remains the raw payload of record and the re-derivation source if the shape changes.

**Ingestion paths: both, ambient primary.** Ambient `$HOME` history is where the volume and the real
diagnostic material live — including any interactive session. Spur-launched runs under
`.spur/run/<runId>/agent-sessions/<agent>/` are additionally ingested and carry `provenance='spur-run'`
plus `run_id`, giving exact attribution for the two sources that honor `--session-dir` (pi, omp). The
other four fall back to `provenance='ambient'` and the heuristic matching already in
`packages/domain/src/analytics/run-cost.ts:131`. A record is never double-counted: `record_hash`
covers realpath-normalized `source_file`, so the same file reached by two paths is one row (0465).

**Mapping placement: extend the existing `custom` split seam upstream.** `splitConfig.mode: 'custom'`
already accepts an arbitrary `split: (raw: JsonObject) => readonly JsonObject[]`
(`llm-jsonl-importer/src/types.ts:21-25`, applied at `src/importer.ts:174-180`), and `schema` is
already per-source. It can dispatch on record type and fan one line into many rows today. Its **one**
real limitation: `targetTable` is per-`splitConfig`, not per-emitted-entry, so a single line cannot
fan out into both `history_message` and `history_tool_call`.

Minimal change: let an emitted entry name its own target table, e.g.
`split: (raw) => readonly { targetTable?: string; record: JsonObject }[]`, defaulting to the config's
table when omitted. No new hook, no new concept, no Spur-side mapping layer — this is the smallest
extension that unblocks the contract, and it keeps the `AGENTS.md` prefer-fix-the-facade rule.

**Migration.** Additive. The two new tables are `CREATE TABLE IF NOT EXISTS` additions to
`HISTORY_IMPORT_SCHEMA_SQL`, consumed by `packages/domain/src/migrations.ts:4`; existing
`history_etl_*` tables are unchanged, so no backfill is required to land the schema. Re-import from
retained raw populates the new tables. `EtlPayload` and the existing `costs.ts` / `run-cost.ts`
readers keep working against `history_etl_*` until analyze is cut over in 0464.

**Anti-patterns:**

- Do **not** drop a record type because it looked like noise in one session. `attachment` is 18% of
  claude lines and `file-history-*` may be exactly what explains a slow session — mark `meta`, keep
  the row, decide at query time.
- Do **not** invent `duration_ms` or `cost_usd`. NULL is the honest value.
- Do **not** store raw tool args in `history_tool_call`.
- Do **not** add the deferred sources by copying a per-source mapper — the extension must keep them
  mechanical.

**ADR: yes.** Changing a published package's extension model plus adding two tables to the shared
schema is a structural decision. Route an ADR entry to `docs/00_ADR.md` covering the `custom` split
extension and the two-table forensic shape before implementation lands.

**Handoff to 0464.** analyze queries `history_message` + `history_tool_call` only. The per-step
report is `GROUP BY tool_name` over `history_tool_call` with `duration_ms` and the joined message's
token columns. 0464 owns the artifact schema and the scheduled loop.
### Plan

<!-- Ordered implementation checklist. Fill before moving to todo/wip. -->

### Solution

<!-- Filled during implementation: file:line change map and concise rationale. -->

### Testing

<!-- Filled during verification: commands run, outcomes, coverage claim or N/A. -->

### Review

<!-- Filled during review: P1-P4 findings, residual risk, and final disposition. -->

### References

E1

<!-- Links to the parent feature, design docs, related tasks, or external references. -->

### History
- 2026-08-07T00:40:37.711Z todo → wip (system)
- 2026-08-07T00:43:02.111Z wip → done (system)
