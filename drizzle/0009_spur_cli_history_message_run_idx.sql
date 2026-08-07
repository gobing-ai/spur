-- _spur_cli_history_message_run_idx: add the one missing selector index on the
-- forensic `history_message` table (task 0474, R3). `history_message` is created
-- by HISTORY_IMPORT_SCHEMA_SQL in @gobing-ai/ts-llm-jsonl-importer, which Spur
-- cannot edit, so the index lands Spur-side as an incremental migration — the
-- same reasoning that produced `0005_spur_cli_run_pid` for the engine-owned
-- `runs` table.
--
-- The five 0455 indices (session, ts, tool_call session/tool_name/message_hash)
-- cover every other selector; `run_id` / `task_wbs` alone had no index. Adding
-- `(provenance, run_id)` makes the `--run` / `--task` selectors resolve against
-- an index rather than a scan.
--
-- `CREATE INDEX IF NOT EXISTS` makes the migration idempotent: if the importer
-- later ships this index itself, the duplicate is harmless.

CREATE INDEX IF NOT EXISTS idx_history_message_provenance_run ON history_message (provenance, run_id);
