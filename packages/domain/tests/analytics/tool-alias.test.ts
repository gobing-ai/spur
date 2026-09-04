import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { loadToolAliasMap, resolveToolAlias, resolveToolAliasFromDb } from '../../src/analytics/tool-alias';
import { applyCliMigrations } from '../../src/migrations';

describe('tool-alias (0739 R4/R19/R20)', () => {
    test('resolveToolAlias falls through to identity when mapping is absent (R4)', () => {
        expect(resolveToolAlias('claude', 'Bash')).toBe('Bash');
        expect(resolveToolAlias('codex', 'exec_command')).toBe('exec_command');
        expect(resolveToolAlias('pi', 'read')).toBe('read');
    });

    test('resolveToolAlias uses map when provided', () => {
        const map = new Map<string, string>();
        map.set('claude\0Bash', 'shell');
        map.set('codex\0exec_command', 'shell');

        expect(resolveToolAlias('claude', 'Bash', map)).toBe('shell');
        expect(resolveToolAlias('codex', 'exec_command', map)).toBe('shell');
        // Unmapped tool falls through to identity
        expect(resolveToolAlias('pi', 'read', map)).toBe('read');
    });

    test('loadToolAliasMap loads entries from history_tool_alias_map', async () => {
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(db);

        await db.run(
            'INSERT INTO history_tool_alias_map (source, effective_tool_name, alias) VALUES (?, ?, ?)',
            'claude',
            'Bash',
            'shell',
        );
        await db.run(
            'INSERT INTO history_tool_alias_map (source, effective_tool_name, alias) VALUES (?, ?, ?)',
            'codex',
            'exec_command',
            'shell',
        );

        const map = await loadToolAliasMap(db);
        expect(map.size).toBe(2);
        expect(map.get('claude\0Bash')).toBe('shell');
        expect(map.get('codex\0exec_command')).toBe('shell');

        const resolvedFromDb = await resolveToolAliasFromDb(db, 'claude', 'Bash');
        expect(resolvedFromDb).toBe('shell');

        const unmappedFromDb = await resolveToolAliasFromDb(db, 'pi', 'read');
        expect(unmappedFromDb).toBe('read');

        db.close();
    });
});
