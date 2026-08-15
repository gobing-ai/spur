-- _spur_cli_system_events_name_occurred_idx: composite (event_name,
-- occurred_at) index so the routing aggregate (task 0546 R2) drives its
-- access path from the event family instead of walking the occurred_at
-- window across every family (heartbeats included) before a residual
-- event_name filter. Measured on bun:sqlite 3.51: with only the
-- single-column indexes the optimizer chose idx_system_events_occurred_at.
--
-- Fresh databases get the index from SYSTEM_EVENTS_SCHEMA_SQL (0000 / 0006
-- incremental table). This file covers ledgers created before that index
-- existed. CREATE INDEX IF NOT EXISTS is idempotent (`0011` precedent).

CREATE INDEX IF NOT EXISTS idx_system_events_name_occurred ON system_events (event_name, occurred_at);
