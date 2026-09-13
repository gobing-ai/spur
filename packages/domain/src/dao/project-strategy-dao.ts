import type { DbAdapter } from '@gobing-ai/ts-db';

// ── Types (0838, feature G62 — persisted rest/GTD strategy runtime) ──

/** Raw project_strategy row (snake_case, as read from SQLite). */
export interface ProjectStrategyRow {
    project_path: string;
    strategy: string;
    strategy_version: number;
    updated_at: number;
}

/** The persisted strategy for one project. One row per project — never per claim. */
export interface ProjectStrategy {
    projectPath: string;
    strategy: string;
    /** Increments on EVERY set — including a no-op re-set of the same name. */
    strategyVersion: number;
    updatedAt: number;
}

function toStrategy(row: ProjectStrategyRow): ProjectStrategy {
    return {
        projectPath: row.project_path,
        strategy: row.strategy,
        strategyVersion: row.strategy_version,
        updatedAt: row.updated_at,
    };
}

// ── DAO ──

/**
 * DAO for the `project_strategy` table (0838). Strategy is runtime state that
 * must outlive every claim and survive with nobody holding anything, so it is
 * one row per project — the smallest thing that satisfies R1. `set` is ONE
 * guarded-upsert statement whose `strategy_version` increments on EVERY call
 * (same-name re-sets included): 0837's `stale-strategy` fence must stay
 * monotonic and never depend on the value having changed — a decision taken
 * before a rest→gtd→rest cycle must read stale even when the names match again.
 */
export class ProjectStrategyDao {
    constructor(private readonly db: DbAdapter) {}

    /** The persisted strategy row, or null when the project has none (default: `rest`). */
    async get(projectPath: string): Promise<ProjectStrategy | null> {
        const row = await this.db.queryFirst<ProjectStrategyRow>(
            `SELECT project_path, strategy, strategy_version, updated_at
             FROM project_strategy
             WHERE project_path = ?`,
            projectPath,
        );
        return row === undefined ? null : toStrategy(row);
    }

    /**
     * Persist `strategy` for the project, bumping `strategy_version` on every
     * call. ONE statement decides and reports: `RETURNING` emits the row THIS
     * statement wrote (the `ProjectClaimDao.claim` precedent — no post-write
     * re-read that a concurrent writer could alias).
     */
    async set(projectPath: string, strategy: string): Promise<ProjectStrategy> {
        const row = await this.db.queryFirst<ProjectStrategyRow>(
            `INSERT INTO project_strategy (project_path, strategy, strategy_version, updated_at)
             VALUES (?, ?, 1, ?)
             ON CONFLICT(project_path) DO UPDATE SET
                 strategy = excluded.strategy,
                 strategy_version = project_strategy.strategy_version + 1,
                 updated_at = excluded.updated_at
             RETURNING project_path, strategy, strategy_version, updated_at`,
            projectPath,
            strategy,
            Date.now(),
        );
        if (row === undefined) throw new Error(`ProjectStrategyDao.set wrote no row for ${projectPath}`);
        return toStrategy(row);
    }
}
