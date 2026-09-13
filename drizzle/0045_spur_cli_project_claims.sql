-- 0836 (feature G62): project_claims — one mutable holder per (project_path, slot);
-- the runtime claim boundary that makes orchestrator ownership exclusive across
-- processes (R3). The composite primary key IS the exclusivity mechanism: a single
-- INSERT … ON CONFLICT(project_path, slot) DO UPDATE … WHERE decides claim/refuse
-- with no read-then-write race. owner_epoch and strategy_version are declared here
-- but only written from 0837/0838 on. SPEC-DRIFT CORRECTION (G61 0833 precedent):
-- the frozen task spec names id 0044_spur_cli_project_claims, but 0043 (0832 inbox
-- mirror) and 0044 (0833 coordination_runs receipt columns) are both registered —
-- the id is 0045_…. Byte-compatible with PROJECT_CLAIMS_SCHEMA_SQL in
-- packages/domain/src/migrations.ts.
CREATE TABLE IF NOT EXISTS project_claims (
    project_path     TEXT    NOT NULL,
    slot             TEXT    NOT NULL,         -- 'orchestrator' (0836) | 'write' (0837)
    holder_id        TEXT    NOT NULL,         -- spec id, verbatim
    owner_epoch      INTEGER NOT NULL DEFAULT 1,
    strategy_version INTEGER,                  -- written by 0838 (NULL until then)
    claimed_at       INTEGER NOT NULL,
    heartbeat_at     INTEGER NOT NULL,
    expires_at       INTEGER NOT NULL,
    PRIMARY KEY (project_path, slot)
);
