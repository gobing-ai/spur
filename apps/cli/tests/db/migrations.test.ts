import { describe, expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { applyCliMigrations, loadSqlMigrations } from '../../src/db/migrations';

describe('db migrations', () => {
    test('applyCliMigrations applies schema', async () => {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        const count = await applyCliMigrations(adapter);
        expect(count).toBeGreaterThan(0);
        adapter.close();
    });

    test('loadSqlMigrations from temp directory', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-cli-test-migrations-'));
        const migrations = await loadSqlMigrations(dir);
        // Falls back to embedded migrations for empty folder
        expect(migrations.length).toBeGreaterThan(0);
    });
});
