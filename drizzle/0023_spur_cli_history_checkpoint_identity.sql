-- _spur_cli_ history import checkpoint identity (task 0675).
-- Additive file-identity columns backing the incremental short-circuit in
-- @gobing-ai/ts-llm-jsonl-importer. Nullable by design: pre-existing rows carry no
-- identity and self-heal on their first post-migration read — never backfill.
ALTER TABLE history_import_checkpoint ADD COLUMN source_size INTEGER;
ALTER TABLE history_import_checkpoint ADD COLUMN source_mtime_ms REAL;
