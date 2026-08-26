-- _spur_cli_ history import checkpoint identity (task 0675), second column.
-- Companion of 0024. Nullable by design: pre-existing rows carry no identity and
-- self-heal on their first post-migration read — never backfill.
ALTER TABLE history_import_checkpoint ADD COLUMN source_mtime_ms REAL;
