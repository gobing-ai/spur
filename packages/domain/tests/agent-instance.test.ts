import { describe, expect, test } from 'bun:test';

import { AGENT_INSTANCES_DDL_DRAFT, AGENT_INSTANCES_MIGRATION_ID_DRAFT, CLI_MIGRATIONS, specRole } from '../src/index';

/**
 * 0685 R2: specRole is the structural Layer-1 role accessor the domain can
 * offer without importing @gobing-ai/ts-ai-runner — its null-folding behavior
 * is what byRole filtering and --role vocabulary rely on.
 */
describe('specRole', () => {
    test('returns the configured role when it is a non-empty string', () => {
        expect(specRole({ config: { role: 'reviewer' } })).toBe('reviewer');
    });

    test('folds every non-role shape to null', () => {
        expect(specRole({ config: {} })).toBeNull();
        expect(specRole({ config: { role: '' } })).toBeNull();
        expect(specRole({ config: { role: 42 } })).toBeNull();
        expect(specRole(null)).toBeNull();
        expect(specRole(undefined)).toBeNull();
    });

    test('freezes the complete reserved DDL without registering the migration', () => {
        expect(AGENT_INSTANCES_MIGRATION_ID_DRAFT).toBe('0026_spur_cli_agent_instances');
        expect(AGENT_INSTANCES_DDL_DRAFT).toContain('CREATE TABLE IF NOT EXISTS agent_instances');
        for (const column of [
            'member_key TEXT NOT NULL',
            'workspace TEXT NOT NULL',
            'status TEXT NOT NULL',
            'pid INTEGER',
            'tags TEXT NOT NULL',
            'config TEXT NOT NULL',
            'created_at INTEGER NOT NULL',
            'updated_at INTEGER NOT NULL',
        ]) {
            expect(AGENT_INSTANCES_DDL_DRAFT).toContain(column);
        }
        expect(AGENT_INSTANCES_DDL_DRAFT.match(/CREATE INDEX IF NOT EXISTS/g)).toHaveLength(3);
        expect(CLI_MIGRATIONS.some((migration) => migration.id === AGENT_INSTANCES_MIGRATION_ID_DRAFT)).toBe(false);
    });
});
