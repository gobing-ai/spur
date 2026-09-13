-- 0838 (feature G62): project_strategy — ONE row per project holding the
-- persisted dispatch strategy. Runtime state that must outlive every claim:
-- `project_claims` rows expire while the strategy survives with nobody holding
-- anything, and `fleet.json` stays operator-authored (a runtime writer would
-- fight the operator's editor). strategy_version increments on EVERY set —
-- including a no-op re-set of the same name — so 0837's stale-strategy fence
-- stays monotonic. SPEC-DRIFT CORRECTION (0833/0836 precedent): the frozen task
-- spec names id 0045_spur_cli_project_strategy, but 0045 is taken by 0836's
-- project_claims — the id is 0046_…. Byte-compatible with
-- PROJECT_STRATEGY_SCHEMA_SQL in packages/domain/src/migrations.ts.
CREATE TABLE IF NOT EXISTS project_strategy (
    project_path     TEXT    PRIMARY KEY,
    strategy         TEXT    NOT NULL,
    strategy_version INTEGER NOT NULL DEFAULT 1,
    updated_at       INTEGER NOT NULL
);
