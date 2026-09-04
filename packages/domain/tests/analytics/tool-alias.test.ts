import { describe, expect, test } from 'bun:test';
import { createDbAdapter, type DbAdapter } from '@gobing-ai/ts-db';
import { ALIASED_TOOL_NAME_SQL, applyToolAliases, toolSelectionSql } from '../../src/analytics/tool-alias';
import { RESOLVED_TOOL_NAME_SQL } from '../../src/analytics/tool-name-sql';
import { applyCliMigrations } from '../../src/migrations';

interface Call {
    hash: string;
    source: string;
    toolName: string;
    effective: string;
}

const CALLS: Call[] = [
    { hash: 'h1', source: 'claude', toolName: 'Bash', effective: 'Bash' },
    { hash: 'h2', source: 'codex', toolName: 'exec_command', effective: 'exec_command' },
    { hash: 'h3', source: 'claude', toolName: 'Read', effective: 'Read' },
];

async function seed(): Promise<DbAdapter> {
    const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
    await applyCliMigrations(db);
    for (const [i, c] of CALLS.entries()) {
        await db.run(
            `INSERT INTO history_tool_call (record_hash, message_hash, source, source_file, source_line,
                 session_id, seq, tool_name, effective_tool_name, status, imported_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            c.hash,
            `m${i}`,
            c.source,
            'test.jsonl',
            i + 1,
            's1',
            i,
            c.toolName,
            c.effective,
            'success',
            '2026-06-01T00:00:00Z',
        );
    }
    return db;
}

/** The alias-grouped breakdown the board's tool dimension is built from. */
async function aliasBreakdown(db: DbAdapter): Promise<Record<string, number>> {
    const rows = await db.queryAll<{ name: string; n: number }>(
        `SELECT ${ALIASED_TOOL_NAME_SQL} AS name, COUNT(*) AS n
         FROM history_tool_call tc GROUP BY name ORDER BY name`,
    );
    return Object.fromEntries(rows.map((r) => [r.name, r.n]));
}

/** The effective-grouped breakdown forensic `byTool` is built from — R20 says it never moves. */
async function effectiveBreakdown(db: DbAdapter): Promise<Record<string, number>> {
    const rows = await db.queryAll<{ name: string; n: number }>(
        `SELECT ${RESOLVED_TOOL_NAME_SQL} AS name, COUNT(*) AS n
         FROM history_tool_call tc GROUP BY name ORDER BY name`,
    );
    return Object.fromEntries(rows.map((r) => [r.name, r.n]));
}

async function mapAlias(db: DbAdapter, source: string, effective: string, alias: string): Promise<void> {
    await db.run(
        'INSERT INTO history_tool_alias_map (source, effective_tool_name, alias) VALUES (?, ?, ?)',
        source,
        effective,
        alias,
    );
}

describe('tool-alias seam (0739 R4/R6/R7)', () => {
    test('empty mapping table resolves every alias to identity (R4/R6)', async () => {
        const db = await seed();
        const before = await effectiveBreakdown(db);

        await applyToolAliases(db);

        const rows = await db.queryAll<{ tool_name_alias: string; effective_tool_name: string }>(
            'SELECT tool_name_alias, effective_tool_name FROM history_tool_call',
        );
        for (const r of rows) {
            expect(r.tool_name_alias).toBe(r.effective_tool_name);
        }
        // The alias-grouped breakdown is the effective-grouped one, byte for byte.
        expect(await aliasBreakdown(db)).toEqual(before);
        db.close();
    });

    test('a mapping entry regroups the alias breakdown without touching the facts (R7)', async () => {
        const db = await seed();
        await applyToolAliases(db);
        const effectiveBefore = await effectiveBreakdown(db);

        await mapAlias(db, 'claude', 'Bash', 'shell');
        await mapAlias(db, 'codex', 'exec_command', 'shell');
        await applyToolAliases(db);

        expect(await aliasBreakdown(db)).toEqual({ Read: 1, shell: 2 });
        // effective_tool_name is a fact: unchanged, and so is every breakdown grouped by it.
        expect(await effectiveBreakdown(db)).toEqual(effectiveBefore);
        const effectives = await db.queryAll<{ effective_tool_name: string }>(
            'SELECT effective_tool_name FROM history_tool_call ORDER BY record_hash',
        );
        expect(effectives.map((r) => r.effective_tool_name)).toEqual(['Bash', 'exec_command', 'Read']);
        db.close();
    });

    test('removing a mapping restores identity on the next apply (R4)', async () => {
        const db = await seed();
        await mapAlias(db, 'claude', 'Bash', 'shell');
        await applyToolAliases(db);
        expect(await aliasBreakdown(db)).toEqual({ Read: 1, exec_command: 1, shell: 1 });

        // The alias is recomputed from the map, never accumulated — so a deletion is reversible.
        await db.run('DELETE FROM history_tool_alias_map');
        await applyToolAliases(db);
        expect(await aliasBreakdown(db)).toEqual(await effectiveBreakdown(db));
        db.close();
    });

    test('a tool selection matches whether it names an alias or an effective name (R2)', async () => {
        const db = await seed();
        await mapAlias(db, 'claude', 'Bash', 'shell');
        await mapAlias(db, 'codex', 'exec_command', 'shell');
        await applyToolAliases(db);

        const select = async (...names: string[]): Promise<string[]> => {
            const placeholders = names.map(() => '?').join(', ');
            const rows = await db.queryAll<{ record_hash: string }>(
                `SELECT tc.record_hash FROM history_tool_call tc
                 WHERE ${toolSelectionSql('tc', placeholders)} ORDER BY tc.record_hash`,
                ...names,
                ...names,
            );
            return rows.map((r) => r.record_hash);
        };

        // Picked off the board's alias-grouped list.
        expect(await select('shell')).toEqual(['h1', 'h2']);
        // Picked off forensic byTool, which still groups by effective name.
        expect(await select('Bash')).toEqual(['h1']);
        expect(await select('Read')).toEqual(['h3']);
        db.close();
    });
});
