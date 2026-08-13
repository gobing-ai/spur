-- _spur_cli_system_events_sequence_idx: index the system_events.sequence
-- ledger cursor (task 0531). The follow helper keysets `sequence > ?` every
-- poll and SystemEventDao.insert auto-assign reads MAX(sequence) per insert —
-- both want an index, not a table scan.
--
-- Fresh databases get the index from SYSTEM_EVENTS_SCHEMA_SQL (0000 / 0006
-- incremental table). This file covers ledgers created before that index
-- existed. CREATE INDEX IF NOT EXISTS is idempotent (`0009` precedent).

CREATE INDEX IF NOT EXISTS idx_system_events_sequence ON system_events (sequence);
