import { join } from 'node:path';
import type { DbAdapter } from '@gobing-ai/ts-db';
import { WORKFLOW_ENGINE_SCHEMA_SQL } from '@gobing-ai/ts-dual-workflow-engine';
import { HISTORY_IMPORT_SCHEMA_SQL } from '@gobing-ai/ts-llm-jsonl-importer';
import { RULE_ENGINE_SCHEMA_SQL } from '@gobing-ai/ts-rule-engine';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { DOMAIN_SCHEMA_SQL, PLANNING_SCHEMA_SQL } from './schema';

/** Embedded CLI migration used when no migration folder is available. */
export interface CliMigration {
    id: string;
    sql: string;
    addColumnIfMissing?: {
        table: string;
        column: string;
    };
}

/**
 * DDL for the team-mode `inbox_messages` table owned by `@gobing-ai/ts-db`
 * (`InboxMessageDao`). ts-db ships the Drizzle table but no SQL constant, so the
 * DDL is mirrored here and kept byte-compatible with `drizzle/0001_spur_cli_team_inbox.sql`.
 * Column types and the `(to_id, status)` pending-lookup index must match the package.
 */
export const INBOX_MESSAGES_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS inbox_messages (
    id TEXT PRIMARY KEY,
    from_id TEXT,
    to_id TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    in_reply_to TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    delivered_at INTEGER,
    inject_attempts INTEGER NOT NULL DEFAULT 0,
    inject_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_inbox_messages_to_status ON inbox_messages (to_id, status);
`;

/**
 * DDL for the `queue_jobs` table owned by `@gobing-ai/ts-db` (`QueueJobDao`, backing
 * `@gobing-ai/ts-infra` `DBJobQueue`/`DBQueueConsumer`). ts-db ships the Drizzle table +
 * embedded migrations but no SQL constant, so the DDL is mirrored here and kept
 * byte-compatible with ts-db's embedded migrations `0000_init` + `0001` (ready index) +
 * `0002` (`expires_at`). Column types and the `(status, next_retry_at, created_at)`
 * ready-lookup index must match the package or the DAO's claim query breaks.
 */
export const QUEUE_JOBS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS queue_jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    next_retry_at INTEGER,
    last_error TEXT,
    processing_at INTEGER,
    expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS queue_jobs_ready_idx ON queue_jobs (status, next_retry_at, created_at);

-- At most one ACTIVE job per coalesced type (task 0716): a partial unique index
-- scoped to history.refresh + status IN ('pending','processing') makes the
-- coalescing lookup-then-insert atomic under cross-process concurrency — and
-- blocks a duplicate enqueue while an older job is mid-flight (processing).
-- Scoped to ONE type on purpose: the queue also holds task-action/feature-action
-- jobs that legitimately have multiple active rows concurrently, so a global
-- (type, status) unique index would break them.
CREATE UNIQUE INDEX IF NOT EXISTS queue_jobs_history_refresh_active_unique ON queue_jobs (type) WHERE type = 'history.refresh' AND status IN ('pending', 'processing');
`;

/**
 * DDL for the `system_events` table — a capped append-only ledger of planning
 * and system events persisted by the server EventBus tap (task 0189 wave A /
 * 0198). Indexed on `occurred_at` (history query newest-first + since-filter),
 * `event_name` (per-stream board tabs), `run_id`, and the
 * `(entity_kind, entity_id)` pair (task 0369 indexed correlation columns).
 * Kept byte-compatible with `drizzle/0006_spur_cli_system_events.sql` for the
 * five original columns; the correlation columns ship only in the embedded
 * schema and migration `0008` (the historical drizzle file is inert).
 */
export const SYSTEM_EVENTS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS system_events (
    id TEXT PRIMARY KEY,
    event_name TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    actor TEXT,
    payload_json TEXT,
    run_id TEXT,
    entity_kind TEXT,
    entity_id TEXT,
    sequence INTEGER
);

CREATE INDEX IF NOT EXISTS idx_system_events_occurred_at ON system_events (occurred_at);
CREATE INDEX IF NOT EXISTS idx_system_events_event_name ON system_events (event_name);
CREATE INDEX IF NOT EXISTS idx_system_events_name_occurred ON system_events (event_name, occurred_at);
CREATE INDEX IF NOT EXISTS idx_system_events_run_id ON system_events (run_id);
CREATE INDEX IF NOT EXISTS idx_system_events_entity ON system_events (entity_kind, entity_id);
CREATE INDEX IF NOT EXISTS idx_system_events_sequence ON system_events (sequence);
`;

/**
 * DDL for the `coordination_runs` table (ADR-057 wave 1 / feature G4). Stores
 * occupant pins + path-only artifact refs so a sibling agent can address a run
 * by runId. Never stdout/stderr bodies (design §4). `run_id` is the primary
 * key (one row per invoke); `generation` is monotonic per specId.
 */
export const COORDINATION_RUNS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS coordination_runs (
    spec_id TEXT NOT NULL,
    agent_kind TEXT NOT NULL,
    process_id TEXT,
    run_id TEXT PRIMARY KEY,
    generation INTEGER NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    artifact_refs_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_coordination_runs_spec ON coordination_runs (spec_id, generation DESC);
`;

/**
 * DDL for the `history_run_session` table (feature E6 / task 0557): the
 * run→session mapping captured at the agent invoke boundary. One row per
 * agent invocation that resolves a session — the run id to the importer
 * source + session id the run produced, how the mapping was derived
 * (`mechanism`: `observed` / `supplied`) and how confident it is
 * (`exactness`: `exact` / `unresolved`). Ambiguous (R3) and unresolved (R5)
 * resolutions write a row with a NULL `session_id` — never an exact row with
 * a guessed id, because task 0559 trusts exactness. Populated by the run
 * path (AgentService observer); task 0624 also lets import promote unresolved
 * rows from a run-owned session directory. Consumers are tasks 0558
 * (retroactive correlation) and 0559 (cost attribution).
 */
export const HISTORY_RUN_SESSION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS history_run_session (
    run_id TEXT NOT NULL,
    source TEXT NOT NULL,
    session_id TEXT,
    exactness TEXT NOT NULL,
    mechanism TEXT NOT NULL,
    resolved_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_history_run_session_run ON history_run_session (run_id);
CREATE INDEX IF NOT EXISTS idx_history_run_session_source_session ON history_run_session (source, session_id);
`;

/**
 * DDL for the `history_task_session` table (task 0722, feature E6): the direct
 * many-to-many task↔session authority recovered during history import. One row per
 * evidence-backed `(wbs, source, session_id)` triple — a session that operated on
 * several tasks gets one row each. Rows are attribution metadata only: the bounded
 * evidence locator (kind + file basename#line) is stored, never transcript content.
 * Import writes `exactness='estimated'` (`mechanism='slash-command' | 'spur-cli'`)
 * because even deterministic syntax is retrospective evidence; the write path
 * enforces idempotency via the primary key and never downgrades an `exact` row.
 * Indexed on `(source, session_id)` for the selector and session-side lookups; WBS
 * lookup uses the primary-key prefix.
 */
export const HISTORY_TASK_SESSION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS history_task_session (
    wbs TEXT NOT NULL,
    source TEXT NOT NULL,
    session_id TEXT NOT NULL,
    exactness TEXT NOT NULL,
    mechanism TEXT NOT NULL,
    evidence_kind TEXT NOT NULL,
    evidence_ref TEXT,
    resolved_at TEXT NOT NULL,
    PRIMARY KEY (wbs, source, session_id)
);

CREATE INDEX IF NOT EXISTS idx_history_task_session_source_session ON history_task_session (source, session_id);
`;

/** SQL that creates the Spur CLI-owned domain tables plus package-owned tables. */

export const CLI_SCHEMA_SQL = `
${DOMAIN_SCHEMA_SQL}

${PLANNING_SCHEMA_SQL}

${HISTORY_IMPORT_SCHEMA_SQL}

${WORKFLOW_ENGINE_SCHEMA_SQL}

${RULE_ENGINE_SCHEMA_SQL}

${INBOX_MESSAGES_SCHEMA_SQL}

${QUEUE_JOBS_SCHEMA_SQL}

${SYSTEM_EVENTS_SCHEMA_SQL}

${COORDINATION_RUNS_SCHEMA_SQL}

${HISTORY_RUN_SESSION_SCHEMA_SQL}

${HISTORY_TASK_SESSION_SCHEMA_SQL}
`;

/**
 * Add a `pid` column to the engine-owned `runs` table so `spur workflow cancel
 * <run-id>` can SIGTERM the in-flight subprocess of an async run (task 0140).
 *
 * The `runs` table is created by `WORKFLOW_ENGINE_SCHEMA_SQL`
 * (`@gobing-ai/ts-dual-workflow-engine`), which Spur cannot edit, so the column
 * is added as a Spur-side incremental migration. SQLite has no
 * `ADD COLUMN IF NOT EXISTS`; this is safe because the applier journals each
 * migration by id and runs it exactly once per database (`applyCliMigrations`,
 * `existing != null → continue`). Requires `runs` to already exist — guaranteed
 * for any real DB, since `0000` provisions the engine schema that creates it.
 * Collision risk: if the engine package ever ships its own `runs.pid` column,
 * this ALTER fails on fresh DBs — flagged for review at that point.
 */
export const RUN_PID_COLUMN_SCHEMA_SQL = `
ALTER TABLE runs ADD COLUMN pid INTEGER;
`;

/**
 * Add the `external_key` column to legacy `runs` tables created before
 * `packages/domain` owned workflow-run lookup by external entity key.
 *
 * New databases already get this column from `DOMAIN_SCHEMA_SQL`/`runsTable`,
 * so this migration uses `addColumnIfMissing` to journal itself without
 * executing the ALTER when the column is already present. Old databases missing
 * the column still receive the same narrow SQLite ALTER used by the run-pid
 * precedent.
 */
export const RUNS_EXTERNAL_KEY_COLUMN_SCHEMA_SQL = `
ALTER TABLE runs ADD COLUMN external_key TEXT;
`;

/**
 * Add the indexed correlation columns (`run_id`, `entity_kind`, `entity_id`,
 * `sequence`) to legacy `system_events` tables created before task 0369.
 *
 * Fresh databases already get these columns (and their indexes) from
 * `SYSTEM_EVENTS_SCHEMA_SQL` in the `0000` foundation, so this migration uses
 * `addColumnIfMissing` to journal itself without executing the ALTERs when the
 * columns are already present — the `runs.external_key` precedent. `sequence`
 * is the representative guard column: the four columns are only ever added
 * together, so its absence identifies a pre-0369 table.
 *
 * No payload rewrite or backfill (R5): pre-migration rows keep their existing
 * `payload_json` and read back with nulls in every correlation column.
 */
export const SYSTEM_EVENTS_CORRELATION_COLUMNS_SCHEMA_SQL = `
ALTER TABLE system_events ADD COLUMN run_id TEXT;
ALTER TABLE system_events ADD COLUMN entity_kind TEXT;
ALTER TABLE system_events ADD COLUMN entity_id TEXT;
ALTER TABLE system_events ADD COLUMN sequence INTEGER;

CREATE INDEX IF NOT EXISTS idx_system_events_run_id ON system_events (run_id);
CREATE INDEX IF NOT EXISTS idx_system_events_entity ON system_events (entity_kind, entity_id);
`;

/**
 * Add the `(provenance, run_id)` index to the forensic `history_message` table so
 * the `--run` / `--task` analyze selectors resolve against an index rather than a
 * scan (task 0474, R3).
 *
 * `history_message` is created by `HISTORY_IMPORT_SCHEMA_SQL`
 * (`@gobing-ai/ts-llm-jsonl-importer`), which Spur cannot edit, so the index lands
 * Spur-side as an incremental migration — the same reasoning that produced
 * `0005_spur_cli_run_pid`. `CREATE INDEX IF NOT EXISTS` makes it idempotent if the
 * importer later ships the index itself.
 */
export const HISTORY_MESSAGE_RUN_INDEX_SCHEMA_SQL = `
CREATE INDEX IF NOT EXISTS idx_history_message_provenance_run ON history_message (provenance, run_id);
`;

/**
 * Index the `system_events.sequence` ledger cursor (task 0531). The follow
 * helper keysets `sequence > ?` every poll and the DAO's auto-assign reads
 * `MAX(sequence)` per insert — both want an index, not a table scan. Fresh
 * databases get the index from `SYSTEM_EVENTS_SCHEMA_SQL` (0000); this
 * migration covers ledgers created before it (idempotent, `0009` precedent).
 */
export const SYSTEM_EVENTS_SEQUENCE_INDEX_SCHEMA_SQL = `
CREATE INDEX IF NOT EXISTS idx_system_events_sequence ON system_events (sequence);
`;

/**
 * Composite `(event_name, occurred_at)` index for the routing aggregate (task
 * 0546 R2). `routingSummary` filters by `event_name` over a `since`/`until`
 * window; the single-column indexes let SQLite pick either the family filter
 * (then window-prune) or the window walk (then family-prune) — measured on
 * bun:sqlite 3.51 the optimizer chose the `occurred_at` window walk, which
 * traverses every event family (heartbeats included) before the residual
 * `event_name` filter. The composite drives the access path from the family,
 * bounding scan width to attribution rows. Fresh databases get the index from
 * `SYSTEM_EVENTS_SCHEMA_SQL`; this migration covers ledgers created before it
 * (idempotent, `0011` precedent).
 */
export const SYSTEM_EVENTS_NAME_OCCURRED_INDEX_SCHEMA_SQL = `
CREATE INDEX IF NOT EXISTS idx_system_events_name_occurred ON system_events (event_name, occurred_at);
`;

/**
 * Add the `args_raw` column to the forensic `history_tool_call` table (task 0553,
 * feature E5). Stores the full JSON arguments for allowlisted planning tools
 * (TodoWrite, todo_write, update_plan, etc.); other tools keep only
 * `args_digest`. Idempotent via `addColumnIfMissing`.
 */
export const HISTORY_TOOL_CALL_ARGS_RAW_SCHEMA_SQL = `
ALTER TABLE history_tool_call ADD COLUMN args_raw TEXT;
`;

/**
 * Add the `call_id` column to the forensic `history_tool_call` table (task 0564
 * R1). Stores the tool's own call id so the importer's streaming loop can join a
 * toolResult's `toolCallId` to its row and attach the measured duration.
 * Idempotent via `addColumnIfMissing` — the `0012` args_raw precedent.
 */
export const HISTORY_TOOL_CALL_CALL_ID_SCHEMA_SQL = `
ALTER TABLE history_tool_call ADD COLUMN call_id TEXT;
`;

/**
 * Add the `request_id` column to the forensic `history_message` table (task 0624
 * R1). Stores the API request id (`req_…`) that produced the message so the
 * rollup can fold streaming duplicate lines — the final JSONL line for one
 * request carries its complete cumulative usage. Idempotent via
 * `addColumnIfMissing` — the `0015` call_id precedent.
 */
export const HISTORY_MESSAGE_REQUEST_ID_SCHEMA_SQL = `
ALTER TABLE history_message ADD COLUMN request_id TEXT;
`;

/** Index the identified-response subset used by the message rollup (task 0624 R1 re-audit). */
export const HISTORY_MESSAGE_REQUEST_ID_INDEX_SCHEMA_SQL = `
CREATE INDEX IF NOT EXISTS idx_history_message_request_id
    ON history_message (request_id)
    WHERE request_id IS NOT NULL;
`;

/**
 * Drop the ten vestigial `history_etl_<source>` raw-payload tables (task 0624
 * R3). They were created unconditionally by the importer's
 * `ensureTargetTables` but never written — the E1 keystone ruling (2026-08-07)
 * fixed forensic granularity at `history_message` + `history_tool_call`, and
 * every mapper emits only those two targets. Zero rows across all ten in
 * `.spur/spur.db`. The importer now creates generic targets lazily; this
 * migration removes tables left by older eager schema application.
 */
export const HISTORY_ETL_TABLES_DROP_SCHEMA_SQL = `
DROP TABLE IF EXISTS history_etl_pi;
DROP TABLE IF EXISTS history_etl_claude;
DROP TABLE IF EXISTS history_etl_codex;
DROP TABLE IF EXISTS history_etl_gemini;
DROP TABLE IF EXISTS history_etl_opencode;
DROP TABLE IF EXISTS history_etl_antigravity;
DROP TABLE IF EXISTS history_etl_openclaw;
DROP TABLE IF EXISTS history_etl_omp;
DROP TABLE IF EXISTS history_etl_agy;
DROP TABLE IF EXISTS history_etl_grok;
`;

/**
 * E9 feature indexes for the History data plane (task 0631, feature E9). The
 * importer schema already provides (source, session_id, seq), (ts), and
 * message_hash paths; these cover the remaining selector/order paths:
 * source/ts and model/ts message reads, session-id-leading tool-call reads,
 * bucket-leading rollup scans, and the source-filtered session-stats
 * `ORDER BY started_at` access path.
 */
export const HISTORY_PERFORMANCE_INDEXES_SCHEMA_SQL = `
CREATE INDEX IF NOT EXISTS idx_history_message_source_ts
    ON history_message (source, ts);
CREATE INDEX IF NOT EXISTS idx_history_message_model_ts
    ON history_message (model, ts);
CREATE INDEX IF NOT EXISTS idx_history_tool_call_session_id_seq
    ON history_tool_call (session_id, seq);
CREATE INDEX IF NOT EXISTS idx_history_board_message_5m_bucket_model
    ON history_board_message_5m (bucket_start, model);
CREATE INDEX IF NOT EXISTS idx_history_board_tool_5m_bucket_skill
    ON history_board_tool_5m (bucket_start, skill_name);
CREATE INDEX IF NOT EXISTS idx_history_board_session_source_started
    ON history_board_session_stats (source, started_at DESC);
`;

/**
 * Index the two measured History Board raw-read paths (task 0628 R3). On the
 * 1.70M-message corpus, Timeline took 61.42ms without a session-id-leading
 * index and ranked-step reads took 205–212ms without order-compatible indexes.
 */
export const HISTORY_BOARD_QUERY_INDEXES_SCHEMA_SQL = `
CREATE INDEX IF NOT EXISTS idx_history_message_session_id_seq
    ON history_message (session_id, seq);
CREATE INDEX IF NOT EXISTS idx_history_message_duration_rank
    ON history_message (duration_ms DESC)
    WHERE role = 'assistant' AND duration_ms IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_history_message_token_rank
    ON history_message ((COALESCE(input_tokens, 0) + COALESCE(cache_read_tokens, 0)) DESC)
    WHERE role = 'assistant';
CREATE INDEX IF NOT EXISTS idx_history_message_input_rank
    ON history_message (input_tokens DESC)
    WHERE role = 'assistant';
`;

/**
 * Materialized History Board read models (task 0629 R2). The real-corpus gate
 * measured Summary 27.02s, Sessions 2.65s, Insights 12.48s, and Sources 5.45s;
 * these tables move only those aggregate paths off the 1.70M raw-message scan.
 */
export const HISTORY_BOARD_ROLLUPS_SCHEMA_SQL = `
-- Freshness gate shared by Summary (27.02s), Sessions (2.65s), Insights (12.48s), and Sources (5.45s).
CREATE TABLE IF NOT EXISTS history_board_rollup_meta (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    history_version TEXT NOT NULL,
    refreshed_at    TEXT NOT NULL
);

-- Summary (27.02s): bounded daily token series and breakdowns.
CREATE TABLE IF NOT EXISTS history_daily_stats (
    source                TEXT NOT NULL,
    model                 TEXT NOT NULL,
    day                   TEXT NOT NULL,
    fresh_input_tokens     INTEGER NOT NULL,
    cache_read_tokens      INTEGER NOT NULL,
    output_tokens          INTEGER NOT NULL,
    messages               INTEGER NOT NULL,
    assistant_duration_ms  INTEGER NOT NULL,
    tool_calls             INTEGER NOT NULL,
    PRIMARY KEY (source, model, day)
);

-- Summary (27.02s): sub-day token series, also feeding the Sources (5.45s) refresh projection.
CREATE TABLE IF NOT EXISTS history_board_message_5m (
    bucket_start          TEXT NOT NULL,
    session_id            TEXT NOT NULL,
    source                TEXT NOT NULL,
    model                 TEXT NOT NULL,
    fresh_input_tokens    INTEGER NOT NULL,
    cache_read_tokens     INTEGER NOT NULL,
    output_tokens         INTEGER NOT NULL,
    messages              INTEGER NOT NULL,
    assistant_duration_ms INTEGER NOT NULL,
    assistant_duration_samples INTEGER NOT NULL,
    PRIMARY KEY (bucket_start, session_id, source, model)
);
CREATE INDEX IF NOT EXISTS idx_history_board_message_5m_source
    ON history_board_message_5m (source, bucket_start);
CREATE INDEX IF NOT EXISTS idx_history_board_message_5m_model
    ON history_board_message_5m (model, bucket_start);
CREATE INDEX IF NOT EXISTS idx_history_board_message_5m_session
    ON history_board_message_5m (session_id, source);

-- Summary (27.02s): tool/skill series and call totals, also feeding Insights (12.48s) model reliability.
CREATE TABLE IF NOT EXISTS history_board_tool_5m (
    bucket_start       TEXT NOT NULL,
    session_id         TEXT NOT NULL,
    source             TEXT NOT NULL,
    model              TEXT NOT NULL,
    tool_name          TEXT NOT NULL,
    skill_name         TEXT NOT NULL DEFAULT '',
    fresh_input_tokens REAL NOT NULL,
    cache_read_tokens  REAL NOT NULL,
    output_tokens      REAL NOT NULL,
    calls              INTEGER NOT NULL,
    errors             INTEGER NOT NULL,
    duration_ms        INTEGER NOT NULL,
    PRIMARY KEY (bucket_start, session_id, source, model, tool_name, skill_name)
);
CREATE INDEX IF NOT EXISTS idx_history_board_tool_5m_source
    ON history_board_tool_5m (source, bucket_start);
CREATE INDEX IF NOT EXISTS idx_history_board_tool_5m_model
    ON history_board_tool_5m (model, bucket_start);
CREATE INDEX IF NOT EXISTS idx_history_board_tool_5m_tool
    ON history_board_tool_5m (tool_name, bucket_start);
CREATE INDEX IF NOT EXISTS idx_history_board_tool_5m_skill
    ON history_board_tool_5m (skill_name, bucket_start);
CREATE INDEX IF NOT EXISTS idx_history_board_tool_5m_session
    ON history_board_tool_5m (session_id, source);

-- Sessions (2.65s): paginated rows, also feeding Insights (12.48s) and Sources (5.45s).
CREATE TABLE IF NOT EXISTS history_board_session_stats (
    source                TEXT NOT NULL,
    session_id            TEXT NOT NULL,
    model                 TEXT NOT NULL,
    started_at            TEXT,
    ended_at              TEXT,
    messages              INTEGER NOT NULL,
    tool_calls            INTEGER NOT NULL,
    errors                INTEGER NOT NULL,
    fresh_input_tokens     INTEGER NOT NULL,
    cache_read_tokens      INTEGER NOT NULL,
    output_tokens          INTEGER NOT NULL,
    assistant_duration_ms  INTEGER NOT NULL,
    top_tool               TEXT,
    state                  TEXT NOT NULL,
    PRIMARY KEY (source, session_id)
);
CREATE INDEX IF NOT EXISTS idx_history_board_session_started
    ON history_board_session_stats (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_board_session_model
    ON history_board_session_stats (model, started_at DESC);

-- Insights (12.48s): bounded all-time model comparison axes.
CREATE TABLE IF NOT EXISTS history_board_model_stats (
    model                       TEXT PRIMARY KEY,
    assistant_duration_ms       INTEGER NOT NULL,
    assistant_duration_samples  INTEGER NOT NULL,
    fresh_input_tokens          INTEGER NOT NULL,
    cache_read_tokens           INTEGER NOT NULL,
    output_tokens               INTEGER NOT NULL,
    tool_calls                  INTEGER NOT NULL,
    errors                      INTEGER NOT NULL
);

-- Summary (27.02s): bounded all-time Top Tools and Skills Used aggregates.
CREATE TABLE IF NOT EXISTS history_board_tool_stats (
    tool_name  TEXT NOT NULL,
    skill_name TEXT NOT NULL,
    calls      INTEGER NOT NULL,
    errors     INTEGER NOT NULL,
    PRIMARY KEY (tool_name, skill_name)
);

-- Insights (12.48s): reused loop-analyzer findings.
CREATE TABLE IF NOT EXISTS history_board_loop_findings (
    source        TEXT NOT NULL,
    session_id    TEXT NOT NULL,
    model         TEXT NOT NULL,
    started_at    TEXT,
    tool_name     TEXT NOT NULL,
    args_digest   TEXT NOT NULL,
    repeats       INTEGER NOT NULL,
    first_seq     INTEGER NOT NULL,
    last_seq      INTEGER NOT NULL,
    PRIMARY KEY (source, session_id, tool_name, args_digest)
);

-- Insights (12.48s): bounded token, duration, and cache-waste rankings.
CREATE TABLE IF NOT EXISTS history_board_ranked_steps (
    kind              TEXT NOT NULL,
    rank              INTEGER NOT NULL,
    session_id        TEXT NOT NULL,
    source            TEXT NOT NULL,
    ts                TEXT,
    model             TEXT,
    input_tokens      INTEGER,
    cache_read_tokens INTEGER,
    output_tokens     INTEGER,
    duration_ms       INTEGER,
    PRIMARY KEY (kind, rank)
);
CREATE INDEX IF NOT EXISTS idx_history_board_ranked_steps_filter
    ON history_board_ranked_steps (kind, source, model, ts);

-- Sources (5.45s): all-time source cards and registry totals.
CREATE TABLE IF NOT EXISTS history_board_source_stats (
    source             TEXT PRIMARY KEY,
    files              INTEGER NOT NULL,
    messages           INTEGER NOT NULL,
    last_imported_at   TEXT,
    sessions           INTEGER NOT NULL DEFAULT 0,
    fresh_input_tokens INTEGER NOT NULL DEFAULT 0,
    cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens      INTEGER NOT NULL DEFAULT 0,
    tool_calls         INTEGER NOT NULL DEFAULT 0,
    first_date         TEXT,
    last_date          TEXT
);

-- Sources (5.45s): bounded 90-day heatmap reads.
CREATE TABLE IF NOT EXISTS history_board_source_daily (
    source             TEXT NOT NULL,
    day                TEXT NOT NULL,
    fresh_input_tokens INTEGER NOT NULL,
    cache_read_tokens  INTEGER NOT NULL,
    output_tokens      INTEGER NOT NULL,
    sessions           INTEGER NOT NULL,
    tool_calls         INTEGER NOT NULL,
    PRIMARY KEY (source, day)
);
`;

/**
 * Rebuild the forensic `history_message` table so `ts` is nullable (task 0580
 * D4/R5). The importer used to coerce missing timestamps to the epoch-0
 * sentinel `1970-01-01T00:00:00.000Z` because the column was `NOT NULL`;
 * 0.4.38+ persists NULL instead. SQLite cannot `ALTER TABLE ... DROP NOT
 * NULL`, so this is the standard 12-step rebuild: create shadow, copy, drop,
 * rename, restore the `0009` provenance/run index (a dropped table takes its
 * indexes with it). Guarded by `tsNotNullSkip` — fresh databases already get
 * the nullable column from the importer DDL and journal without rebuilding.
 */
export const HISTORY_MESSAGE_TS_NULLABLE_SCHEMA_SQL = `
CREATE TABLE history_message_rebuild (
    record_hash        TEXT PRIMARY KEY,
    source             TEXT NOT NULL,
    source_file        TEXT NOT NULL,
    source_line        INTEGER NOT NULL,
    session_id         TEXT NOT NULL,
    seq                INTEGER NOT NULL,
    turn_index         INTEGER,
    role               TEXT NOT NULL,
    record_type        TEXT NOT NULL,
    disposition        TEXT NOT NULL,
    ts                 TEXT,
    duration_ms        INTEGER,
    model              TEXT,
    input_tokens       INTEGER,
    output_tokens      INTEGER,
    cache_read_tokens  INTEGER,
    cache_write_tokens INTEGER,
    cost_usd           REAL,
    content_text       TEXT,
    cwd                TEXT,
    provenance         TEXT NOT NULL,
    run_id             TEXT,
    task_wbs           TEXT,
    imported_at        TEXT NOT NULL
);
INSERT INTO history_message_rebuild SELECT
    record_hash, source, source_file, source_line, session_id, seq, turn_index, role,
    record_type, disposition,
    CASE WHEN ts = '1970-01-01T00:00:00.000Z' THEN NULL ELSE ts END,
    duration_ms, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
    cost_usd, content_text, cwd, provenance, run_id, task_wbs, imported_at
FROM history_message;
DROP TABLE history_message;
ALTER TABLE history_message_rebuild RENAME TO history_message;
CREATE INDEX IF NOT EXISTS idx_history_message_provenance_run ON history_message (provenance, run_id);
`;

/**
 * Built-in migrations for compiled binaries and test use. `0000` provisions a
 * fresh database with the full current schema (inbox included); `0001` is the
 * incremental step that adds `inbox_messages` to databases created before team
 * mode; `0002` adds the rule-engine run history tables (`rule_runs`,
 * `rule_eval_runs`) to databases created before task 0040; `0003` adds the
 * planning event ledger (`planning_events`, `task_run_links`); `0004` adds the
 * `queue_jobs` table (`@gobing-ai/ts-infra` `DBJobQueue`/`DBQueueConsumer`, task 0074);
 * `0005` adds the `pid` column to `runs` for subprocess cancellation (task 0140);
 * `0006` adds the `system_events` ledger persisted by the server EventBus tap
 * (observabilities board v1, task 0189 wave A / 0198); `0007` backfills
 * `runs.external_key` for databases whose `runs` table predates that column;
 * `0008` backfills the indexed `system_events` correlation columns
 * (`run_id`, `entity_kind`, `entity_id`, `sequence`) for pre-0369 ledgers.
 * `0009` adds the `(provenance, run_id)` index to `history_message` for the
 * analyze `--run`/`--task` selectors (task 0474).
 * `0010` adds the `coordination_runs` occupant/artifact table (ADR-057 wave 1).
 * `0011` indexes `system_events.sequence` for the follow cursor and
 * auto-assign (task 0531).
 * `0012` adds the `args_raw` column to `history_tool_call` for forensic
 * retention of planning-tool arguments (task 0553, feature E5).
 * `0013` adds the `history_run_session` run→session mapping table (feature E6).
 * `0014` indexes `system_events (event_name, occurred_at)` for the routing
 * aggregate (task 0546).
 * `0015` adds the `call_id` column to `history_tool_call` so omp tool durations
 * survive import (task 0564 R1).
 * `0020` adds measured History Board raw-query indexes (task 0628 R3).
 * `0021` adds measured History Board aggregate read models (task 0629 R2).
 * `0022` adds E9 History data-plane performance indexes (task 0631).
 * `0028` adds the `history_task_session` direct task↔session attribution table (task 0722, feature E6).
 * All are idempotent (`CREATE TABLE IF NOT EXISTS`), so applying them in sequence is
 * safe regardless of the database's age.
 */
/** Reserved agent-instance migration draft (0685 R2); intentionally absent from `CLI_MIGRATIONS`. */
export const AGENT_INSTANCES_MIGRATION_ID_DRAFT = '0026_spur_cli_agent_instances';

export const AGENT_INSTANCES_DDL_DRAFT = `
CREATE TABLE IF NOT EXISTS agent_instances (
    spec_id TEXT PRIMARY KEY,
    team_id TEXT,
    member_key TEXT NOT NULL,
    executor TEXT,
    role TEXT,
    workspace TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('stopped', 'running', 'exited', 'errored')),
    pid INTEGER,
    run_id TEXT,
    generation INTEGER,
    tags TEXT NOT NULL DEFAULT '[]',
    config TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_instances_role ON agent_instances (role);
CREATE INDEX IF NOT EXISTS idx_agent_instances_executor ON agent_instances (executor);
CREATE INDEX IF NOT EXISTS idx_agent_instances_team ON agent_instances (team_id);
`;

/**
 * Migration 0027 (task 0716): retire duplicate active history.refresh rows, drop
 * the pending-only unique index, and create the active (pending/processing) one.
 * The survivor is the deterministically OLDEST active row (`created_at ASC, id ASC`);
 * every other active row becomes terminal `failed` with an audit message in
 * `last_error` — the same retirement shape the queue's own failure path uses, so
 * the consumer never retries a retired row.
 */
export const HISTORY_REFRESH_ACTIVE_UNIQUE_SCHEMA_SQL = `
UPDATE queue_jobs
SET status = 'failed',
    last_error = 'retired by migration 0027_spur_cli_history_refresh_active_unique: superseded duplicate active history refresh',
    processing_at = NULL,
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE type = 'history.refresh'
  AND status IN ('pending', 'processing')
  AND id NOT IN (
      SELECT id FROM queue_jobs
      WHERE type = 'history.refresh' AND status IN ('pending', 'processing')
      ORDER BY created_at ASC, id ASC
      LIMIT 1
  );

DROP INDEX IF EXISTS queue_jobs_history_refresh_pending_unique;

CREATE UNIQUE INDEX IF NOT EXISTS queue_jobs_history_refresh_active_unique ON queue_jobs (type) WHERE type = 'history.refresh' AND status IN ('pending', 'processing');
`;

export const CLI_MIGRATIONS: CliMigration[] = [
    { id: '0000_spur_cli_foundation', sql: CLI_SCHEMA_SQL },
    // Renamed from `0001_spur_team_inbox` so the filename carries the
    // `_spur_cli_` marker that folder-based loads filter on. DBs journaled
    // under the old id re-apply the idempotent DDL once and move on.
    { id: '0001_spur_cli_team_inbox', sql: INBOX_MESSAGES_SCHEMA_SQL },
    { id: '0002_spur_cli_rule_history', sql: RULE_ENGINE_SCHEMA_SQL },
    { id: '0003_spur_cli_planning', sql: PLANNING_SCHEMA_SQL },
    { id: '0004_spur_cli_queue_jobs', sql: QUEUE_JOBS_SCHEMA_SQL },
    {
        id: '0005_spur_cli_run_pid',
        sql: RUN_PID_COLUMN_SCHEMA_SQL,
        addColumnIfMissing: { table: 'runs', column: 'pid' },
    },
    { id: '0006_spur_cli_system_events', sql: SYSTEM_EVENTS_SCHEMA_SQL },
    {
        id: '0007_spur_cli_runs_external_key',
        sql: RUNS_EXTERNAL_KEY_COLUMN_SCHEMA_SQL,
        addColumnIfMissing: { table: 'runs', column: 'external_key' },
    },
    {
        id: '0008_spur_cli_system_events_correlation',
        sql: SYSTEM_EVENTS_CORRELATION_COLUMNS_SCHEMA_SQL,
        addColumnIfMissing: { table: 'system_events', column: 'sequence' },
    },
    { id: '0009_spur_cli_history_message_run_idx', sql: HISTORY_MESSAGE_RUN_INDEX_SCHEMA_SQL },
    { id: '0010_spur_cli_coordination_runs', sql: COORDINATION_RUNS_SCHEMA_SQL },
    { id: '0011_spur_cli_system_events_sequence_idx', sql: SYSTEM_EVENTS_SEQUENCE_INDEX_SCHEMA_SQL },
    {
        id: '0012_spur_cli_history_tool_call_args_raw',
        sql: HISTORY_TOOL_CALL_ARGS_RAW_SCHEMA_SQL,
        addColumnIfMissing: { table: 'history_tool_call', column: 'args_raw' },
    },
    { id: '0013_spur_cli_history_run_session', sql: HISTORY_RUN_SESSION_SCHEMA_SQL },
    {
        id: '0014_spur_cli_system_events_name_occurred_idx',
        sql: SYSTEM_EVENTS_NAME_OCCURRED_INDEX_SCHEMA_SQL,
    },
    {
        id: '0015_spur_cli_history_tool_call_call_id',
        sql: HISTORY_TOOL_CALL_CALL_ID_SCHEMA_SQL,
        addColumnIfMissing: { table: 'history_tool_call', column: 'call_id' },
    },
    {
        id: '0016_spur_cli_history_message_ts_nullable',
        sql: HISTORY_MESSAGE_TS_NULLABLE_SCHEMA_SQL,
    },
    {
        id: '0017_spur_cli_runs_status_completed_to_done',
        sql: "UPDATE runs SET status = 'done' WHERE status = 'completed'",
    },
    {
        id: '0018_spur_cli_history_message_request_id',
        sql: HISTORY_MESSAGE_REQUEST_ID_SCHEMA_SQL,
        addColumnIfMissing: { table: 'history_message', column: 'request_id' },
    },
    { id: '0019_spur_cli_history_etl_tables_drop', sql: HISTORY_ETL_TABLES_DROP_SCHEMA_SQL },
    { id: '0020_spur_cli_history_board_query_indexes', sql: HISTORY_BOARD_QUERY_INDEXES_SCHEMA_SQL },
    { id: '0021_spur_cli_history_board_rollups', sql: HISTORY_BOARD_ROLLUPS_SCHEMA_SQL },
    {
        id: '0022_spur_cli_history_performance_indexes',
        sql: HISTORY_PERFORMANCE_INDEXES_SCHEMA_SQL,
    },
    {
        // renumbered from 0020 on merge (E6 precedent): main took 0020-0022 first
        id: '0023_spur_cli_history_message_request_id_idx',
        sql: HISTORY_MESSAGE_REQUEST_ID_INDEX_SCHEMA_SQL,
    },
    {
        // 0675: file identity for the incremental import short-circuit (ts-libs importer).
        // Two guard-edged entries because addColumnIfMissing takes one column per migration.
        id: '0024_spur_cli_history_checkpoint_identity',
        sql: 'ALTER TABLE history_import_checkpoint ADD COLUMN source_size INTEGER',
        addColumnIfMissing: { table: 'history_import_checkpoint', column: 'source_size' },
    },
    {
        id: '0025_spur_cli_history_checkpoint_identity_mtime',
        sql: 'ALTER TABLE history_import_checkpoint ADD COLUMN source_mtime_ms REAL',
        addColumnIfMissing: { table: 'history_import_checkpoint', column: 'source_mtime_ms' },
    },
    {
        // 0702 R2: assistant-step duration provenance. NULL = the provider's own
        // measurement (or none); 'derived' = an ETL timestamp delta, which includes
        // queue and network time and must never be reported as provider-measured.
        id: '0026_spur_cli_history_message_duration_source',
        sql: 'ALTER TABLE history_message ADD COLUMN duration_source TEXT',
        addColumnIfMissing: { table: 'history_message', column: 'duration_source' },
    },
    {
        // 0716: single-flight for history.refresh — widen the pending-only partial
        // unique index to ACTIVE (pending OR processing) rows. Duplicate active rows
        // from the pre-index era are retired first (oldest active row survives; the
        // rest become terminal `failed` with an auditable last_error) so CREATE
        // UNIQUE INDEX cannot fail, then the pending-only index is dropped.
        id: '0027_spur_cli_history_refresh_active_unique',
        sql: HISTORY_REFRESH_ACTIVE_UNIQUE_SCHEMA_SQL,
    },
    {
        // 0722 (feature E6): direct task↔session attribution authority. Standalone
        // `CREATE TABLE IF NOT EXISTS` DDL — no guarded-column shape, so it applies
        // on any database unconditionally.
        id: '0028_spur_cli_history_task_session',
        sql: HISTORY_TASK_SESSION_SCHEMA_SQL,
    },
];

/** Filename marker for regenerated CLI-owned migrations. */
export const CLI_MIGRATION_FILE_MARKER = '_spur_cli_';

/** Apply CLI-owned migrations with an isolated journal table. */
export async function applyCliMigrations(adapter: DbAdapter, migrations = CLI_MIGRATIONS): Promise<number> {
    await adapter.exec(
        'CREATE TABLE IF NOT EXISTS "__spur_cli_migrations" (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)',
    );

    let applied = 0;
    for (const migration of migrations) {
        const existing = await adapter.queryFirst<{ id: string }>(
            'SELECT id FROM "__spur_cli_migrations" WHERE id = ?',
            migration.id,
        );
        if (existing != null) continue;

        // Legacy foundations were journaled before importer tables joined CLI_SCHEMA_SQL.
        // Migration 0009 cannot create its history_message index until that idempotent
        // package-owned schema has been provisioned. 0024/0025's guarded ALTERs need the
        // same provisioning when the importer table is absent (0678).
        if (
            migration.id === '0009_spur_cli_history_message_run_idx' &&
            !(await tableExists(adapter, 'history_message'))
        ) {
            for (const statement of splitSqlStatements(HISTORY_IMPORT_SCHEMA_SQL)) {
                await adapter.exec(statement);
            }
        }
        if (
            (migration.id === '0024_spur_cli_history_checkpoint_identity' ||
                migration.id === '0025_spur_cli_history_checkpoint_identity_mtime') &&
            !(await tableExists(adapter, 'history_import_checkpoint'))
        ) {
            // Journaled as applied: the fresh-database path never needs the guard — the
            // importer seeds the checkpoint table with both identity columns already in place.
            await adapter.run('INSERT INTO "__spur_cli_migrations" (id, applied_at) VALUES (?, ?)', [
                migration.id,
                Date.now(),
            ]);
            continue;
        }

        const addColumnGuard = migration.addColumnIfMissing;
        const shouldApplySql =
            addColumnGuard === undefined || !(await columnExists(adapter, addColumnGuard.table, addColumnGuard.column));

        // Migration 0016 rebuilds history_message for a nullable ts — skip when the
        // table is absent (legacy/foundation-only DBs, the 0012/0015 shape) or when
        // ts is already nullable (fresh DBs created from the 0.4.38+ importer DDL).
        const tsNullableSkip =
            migration.id === '0016_spur_cli_history_message_ts_nullable' &&
            (!(await tableExists(adapter, 'history_message')) ||
                !(await columnNotNull(adapter, 'history_message', 'ts')));
        // exist. A DB whose journal claims 0000–0008 but has no system_events
        // table (the 0009 simulation shape: foreign/legacy foundation) journals
        // 0011 without executing; the index lands on any DB where the ledger
        // exists (fresh DBs get it from SYSTEM_EVENTS_SCHEMA_SQL, and 0006
        // restores the table for genuinely older ledgers). Never block later
        // migrations on a dropped/missing ledger — the follow tolerates it.
        const sequenceIndexSkip =
            migration.id === '0011_spur_cli_system_events_sequence_idx' &&
            !(await tableExists(adapter, 'system_events'));

        // Migration 0012 adds args_raw to history_tool_call — the importer table
        // may not exist on legacy/foundation-only DBs. Journal without executing
        // if the table is absent; fresh DBs get the column from the importer DDL.
        const argsRawSkip =
            migration.id === '0012_spur_cli_history_tool_call_args_raw' &&
            !(await tableExists(adapter, 'history_tool_call'));

        // Migration 0015 adds call_id to history_tool_call — same table-absence
        // shape as 0012 (task 0564 R1). Journal without executing on
        // legacy/foundation-only DBs; fresh DBs get the column from the importer DDL.
        const callIdSkip =
            migration.id === '0015_spur_cli_history_tool_call_call_id' &&
            !(await tableExists(adapter, 'history_tool_call'));

        // Migration 0014 indexes (event_name, occurred_at) on system_events —
        // same ledger-absence shape as 0011. Journal without executing when the
        // table is missing; the index lands on any DB where the ledger exists
        // (fresh DBs get it from SYSTEM_EVENTS_SCHEMA_SQL, 0006 restores the
        // table for older ledgers).
        const nameOccurredIndexSkip =
            migration.id === '0014_spur_cli_system_events_name_occurred_idx' &&
            !(await tableExists(adapter, 'system_events'));

        const historyBoardQueryIndexesSkip =
            migration.id === '0020_spur_cli_history_board_query_indexes' &&
            (!(await tableExists(adapter, 'history_message')) ||
                !(await columnExists(adapter, 'history_message', 'seq')) ||
                !(await columnExists(adapter, 'history_message', 'duration_ms')) ||
                !(await columnExists(adapter, 'history_message', 'role')) ||
                !(await columnExists(adapter, 'history_message', 'input_tokens')) ||
                !(await columnExists(adapter, 'history_message', 'cache_read_tokens')));

        // Migration 0022 indexes the E9 History read paths — legacy stub
        // history_message tables (the 0000/0001 shape) lack `ts`/`model`, and
        // history_tool_call may be absent. Journal without executing in those
        // shapes; real DBs and fresh DBs (importer DDL) always have the columns.
        const historyPerformanceIndexesSkip =
            migration.id === '0022_spur_cli_history_performance_indexes' &&
            (!(await tableExists(adapter, 'history_message')) ||
                !(await columnExists(adapter, 'history_message', 'ts')) ||
                !(await columnExists(adapter, 'history_message', 'model')) ||
                !(await tableExists(adapter, 'history_tool_call')));

        // Migration 0017 retires the legacy `completed` runs status — a DML
        // against a table foreign/legacy journals may not have (the 0009
        // simulation shape: journaled foundation, no engine tables) or whose
        // `runs` predates the `status` column (the 0000/0001 stub shape). Journal
        // without executing when `runs` is absent or lacks `status`; real DBs
        // always have the column.
        const runsStatusDoneSkip =
            migration.id === '0017_spur_cli_runs_status_completed_to_done' &&
            (!(await tableExists(adapter, 'runs')) || !(await columnExists(adapter, 'runs', 'status')));

        // Migration 0027 retires duplicate ACTIVE history.refresh rows and swaps
        // the pending-only unique index for the active one — DDL/DML against
        // queue_jobs, which the loadSqlMigrations path (drizzle/, which excludes
        // 0004) may never have created. Journal without executing when the table
        // is absent; fresh DBs get the active index from QUEUE_JOBS_SCHEMA_SQL.
        const queueJobsActiveIndexSkip =
            migration.id === '0027_spur_cli_history_refresh_active_unique' &&
            !(await tableExists(adapter, 'queue_jobs'));
        if (
            shouldApplySql &&
            !sequenceIndexSkip &&
            !argsRawSkip &&
            !runsStatusDoneSkip &&
            !nameOccurredIndexSkip &&
            !historyBoardQueryIndexesSkip &&
            !historyPerformanceIndexesSkip &&
            !callIdSkip &&
            !tsNullableSkip &&
            !queueJobsActiveIndexSkip
        ) {
            for (const statement of splitSqlStatements(migration.sql)) {
                await adapter.exec(statement);
            }
        }
        await adapter.run(
            'INSERT INTO "__spur_cli_migrations" (id, applied_at) VALUES (?, ?)',
            migration.id,
            Date.now(),
        );
        applied += 1;
    }
    return applied;
}

/** Load SQL migration files from a regenerated local migration folder. */
export async function loadSqlMigrations(folder: string): Promise<CliMigration[]> {
    const fs = createNodeFileSystem();
    const rawEntries = await fs.readDir(folder);
    const entries = rawEntries
        .filter((entry) => entry.endsWith('.sql') && entry.includes(CLI_MIGRATION_FILE_MARKER))
        .sort((left, right) => left.localeCompare(right));

    const migrations: CliMigration[] = [];
    for (const entry of entries) {
        migrations.push({
            id: entry.replace(/\.sql$/, ''),
            sql: await fs.readFile(join(folder, entry)),
        });
    }

    return migrations.length > 0 ? migrations : CLI_MIGRATIONS;
}

async function columnExists(adapter: DbAdapter, table: string, column: string): Promise<boolean> {
    const rows = await adapter.queryAll<{ name: string }>(`PRAGMA table_info("${table}")`);
    return rows.some((row) => row.name === column);
}

async function columnNotNull(adapter: DbAdapter, table: string, column: string): Promise<boolean> {
    const rows = await adapter.queryAll<{ name: string; notnull: number }>(`PRAGMA table_info("${table}")`);
    return rows.some((row) => row.name === column && row.notnull === 1);
}

async function tableExists(adapter: DbAdapter, table: string): Promise<boolean> {
    const row = await adapter.queryFirst<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        table,
    );
    return row != null;
}

function splitSqlStatements(sql: string): string[] {
    return sql
        .split(';')
        .map((statement) => statement.trim())
        .filter(Boolean);
}
