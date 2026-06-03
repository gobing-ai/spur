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
        // DDL for the domain tables is generated from the defineTable definitions
        // (quoted identifiers), so match the table name with optional quotes
        // rather than the exact hand-written format.
        const hasCreateTable = (table: string): boolean =>
            new RegExp(`CREATE TABLE IF NOT EXISTS "?${table}"?`).test(CLI_SCHEMA_SQL);

        test('contains workspaces table', () => {
            expect(hasCreateTable('workspaces')).toBe(true);
        });

        test('contains runs table', () => {
            expect(hasCreateTable('runs')).toBe(true);
        });

        test('contains phase_runs table', () => {
            expect(hasCreateTable('phase_runs')).toBe(true);
        });

        test('contains transition_runs table', () => {
            expect(hasCreateTable('transition_runs')).toBe(true);
        });

        test('contains workflow_states table', () => {
            expect(hasCreateTable('workflow_states')).toBe(true);
        });

        test('contains artifacts table', () => {
            expect(hasCreateTable('artifacts')).toBe(true);
        });

        test('contains inbox_messages table', () => {
            expect(hasCreateTable('inbox_messages')).toBe(true);
        });
    });

    describe('CLI_MIGRATIONS', () => {
        test('has foundation and team-inbox migrations', () => {
            expect(CLI_MIGRATIONS).toHaveLength(2);
            expect(CLI_MIGRATIONS[0]?.id).toBe('0000_spur_cli_foundation');
            expect(CLI_MIGRATIONS[1]?.id).toBe('0001_spur_team_inbox');
        });

        test('foundation migration SQL matches CLI_SCHEMA_SQL', () => {
            expect(CLI_MIGRATIONS[0]?.sql).toBe(CLI_SCHEMA_SQL);
        });

        test('team-inbox migration creates inbox_messages', () => {
            expect(CLI_MIGRATIONS[1]?.sql).toContain('CREATE TABLE IF NOT EXISTS inbox_messages');
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

        test('inbox_messages table is usable after migration', async () => {
            const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
            await applyCliMigrations(adapter);
            await adapter.run(
                'INSERT INTO inbox_messages (id, to_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
                'm1',
                'planner',
                'hi',
                Date.now(),
                Date.now(),
            );
            const rows = await adapter.queryAll<{ status: string }>(
                'SELECT status FROM inbox_messages WHERE to_id = ?',
                'planner',
            );
            expect(rows).toHaveLength(1);
            // status defaults to 'queued' per the package schema.
            expect(rows[0]?.status).toBe('queued');
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
