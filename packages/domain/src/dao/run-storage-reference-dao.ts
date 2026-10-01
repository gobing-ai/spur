import type { DbAdapter } from '@gobing-ai/ts-db';
import { normalizeSourceFilePaths } from '@gobing-ai/ts-llm-jsonl-importer';

export interface RunStorageReferenceMove {
    source: string;
    target: string;
    sourceSize?: number;
    sourceMtimeMs?: number;
}

/** Redirect only classified path values; preserve ids, proof digests and history checkpoints. */
export async function redirectRunStorageReferences(
    db: DbAdapter,
    moves: readonly RunStorageReferenceMove[],
): Promise<void> {
    const paths = new Map(moves.map((move) => [move.source, move.target]));
    const rewrite = (value: unknown): unknown => {
        if (typeof value === 'string') return paths.get(value) ?? value;
        if (Array.isArray(value)) return value.map(rewrite);
        if (value !== null && typeof value === 'object') {
            return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item)]));
        }
        return value;
    };
    await db.exec('SAVEPOINT spur_storage_references');
    try {
        const activeArtifacts = await db.queryAll<{ path: string }>(
            "SELECT a.path FROM artifacts a JOIN runs r ON r.id=a.run_id WHERE r.status NOT IN ('done','failed','cancelled')",
        );
        if (activeArtifacts.some((row) => paths.has(row.path))) throw new Error('live artifact consumer');
        for (const [table, column, owner] of [
            ['runs', 'metadata_json', 'id'],
            ['workflow_states', 'data_json', 'run_id'],
        ] as const) {
            const live = await db.queryAll<{ value: string }>(
                `SELECT t.${column} AS value FROM ${table} t
                 WHERE t.${owner} IN (SELECT id FROM runs WHERE status NOT IN ('done','failed','cancelled'))`,
            );
            for (const row of live) {
                if (!moves.some((move) => row.value.includes(move.source))) continue;
                const original: unknown = JSON.parse(row.value);
                if (JSON.stringify(rewrite(original)) !== JSON.stringify(original)) {
                    throw new Error('live session or checkpoint consumer');
                }
            }
        }
        for (const { source, target } of moves) {
            await db.run('UPDATE artifacts SET path = ? WHERE path = ?', target, source);
        }
        for (const [table, column, owner] of [
            ['runs', 'metadata_json', 'id'],
            ['workflow_states', 'data_json', 'run_id'],
            ['action_runs', 'result_json', 'run_id'],
        ] as const) {
            const rows = await db.queryAll<{ id: string; value: string }>(
                `SELECT t.id, t.${column} AS value FROM ${table} t
                 WHERE t.${owner} IN (SELECT id FROM runs WHERE status IN ('done', 'failed', 'cancelled'))
                 AND t.${column} IS NOT NULL`,
            );
            for (const row of rows) {
                if (!moves.some((move) => row.value.includes(move.source))) continue;
                const value = JSON.stringify(rewrite(JSON.parse(row.value)));
                if (value !== row.value) await db.run(`UPDATE ${table} SET ${column} = ? WHERE id = ?`, value, row.id);
            }
        }
        const history = await db.queryFirst<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='history_import_checkpoint'",
        );
        if (history !== undefined) {
            await normalizeSourceFilePaths(db, (path) => paths.get(path) ?? path);
            for (const move of moves) {
                if (move.sourceSize === undefined || move.sourceMtimeMs === undefined) continue;
                await db.run(
                    'UPDATE history_import_checkpoint SET source_size = ?, source_mtime_ms = ? WHERE source_file = ?',
                    move.sourceSize,
                    move.sourceMtimeMs,
                    move.target,
                );
            }
        }
        await db.exec('RELEASE spur_storage_references');
    } catch (error) {
        await db.exec('ROLLBACK TO spur_storage_references');
        await db.exec('RELEASE spur_storage_references');
        throw error;
    }
}
