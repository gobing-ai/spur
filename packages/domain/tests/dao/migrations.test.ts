import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDbAdapter } from '@gobing-ai/ts-db';
import {
    applyCliMigrations,
    CLI_MIGRATION_FILE_MARKER,
    CLI_MIGRATIONS,
    CLI_SCHEMA_SQL,
    loadSqlMigrations,
} from '../../src/migrations';

describe('db migrations', () => {
    describe('CLI_SCHEMA_SQL', () => {
        test('contains workspaces table', () => {
            expect(CLI_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS workspaces');
        });

        test('contains runs table', () => {
            expect(CLI_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS runs');
        });

        test('contains phase_runs table', () => {
            expect(CLI_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS phase_runs');
        });

        test('contains transition_runs table', () => {
            expect(CLI_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS transition_runs');
        });

        test('contains workflow_states table', () => {
            expect(CLI_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS workflow_states');
        });

        test('contains artifacts table', () => {
            expect(CLI_SCHEMA_SQL).toContain('CREATE TABLE IF NOT EXISTS artifacts');
        });
    });

    describe('CLI_MIGRATIONS', () => {
        test('has foundation migration', () => {
            expect(CLI_MIGRATIONS).toHaveLength(1);
            expect(CLI_MIGRATIONS[0]?.id).toBe('0000_spur_cli_foundation');
        });

        test('migration SQL matches CLI_SCHEMA_SQL', () => {
            expect(CLI_MIGRATIONS[0]?.sql).toBe(CLI_SCHEMA_SQL);
        });
    });

    describe('CLI_MIGRATION_FILE_MARKER', () => {
        test('contains expected marker string', () => {
            expect(CLI_MIGRATION_FILE_MARKER).toBe('_spur_cli_');
        });
    });

    describe('applyCliMigrations', () => {
        test('applies schema to fresh database', async () => {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            const count = await applyCliMigrations(adapter);
            expect(count).toBeGreaterThan(0);
            adapter.close();
        });

        test('returns 0 when already applied', async () => {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyCliMigrations(adapter);
            const count = await applyCliMigrations(adapter);
            expect(count).toBe(0);
            adapter.close();
        });

        test('creates __spur_cli_migrations table', async () => {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyCliMigrations(adapter);
            const row = await adapter.queryFirst<{ id: string }>(
                'SELECT id FROM "__spur_cli_migrations" WHERE id = ?',
                '0000_spur_cli_foundation',
            );
            expect(row?.id).toBe('0000_spur_cli_foundation');
            adapter.close();
        });

        test('tables are usable after migration', async () => {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyCliMigrations(adapter);
            // Should not throw
            await adapter.run(
                'INSERT INTO workspaces (id, name, root, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
                'ws1',
                'test',
                '/tmp',
                Date.now(),
                Date.now(),
            );
            const rows = await adapter.queryAll('SELECT * FROM workspaces');
            expect(rows).toHaveLength(1);
            adapter.close();
        });
    });

    describe('loadSqlMigrations', () => {
        test('falls back to embedded migrations for empty folder', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-cli-test-migrations-'));
            const migrations = await loadSqlMigrations(dir);
            expect(migrations.length).toBeGreaterThan(0);
            expect(migrations[0]?.id).toBe('0000_spur_cli_foundation');
            await rm(dir, { recursive: true });
        });

        test('loads migration files with marker', async () => {
            const dir = await mkdtemp(join(tmpdir(), 'spur-cli-test-migrations-'));
            await writeFile(
                join(dir, '0001_spur_cli_test.sql'),
                'CREATE TABLE IF NOT EXISTS test_t (id TEXT PRIMARY KEY);',
            );
            // Non-marker file should be ignored
            await writeFile(join(dir, '0002_other.sql'), 'CREATE TABLE IF NOT EXISTS ignored (id TEXT);');

            const migrations = await loadSqlMigrations(dir);
            expect(migrations).toHaveLength(1);
            expect(migrations[0]?.id).toBe('0001_spur_cli_test');
            expect(migrations[0]?.sql).toContain('test_t');
            await rm(dir, { recursive: true });
        });
    });
});
