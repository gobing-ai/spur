import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactDao, applyCliMigrations, RunDao } from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { RunArtifactActionRunner } from '../../../src/workflow/actions/run-artifact';

describe('RunArtifactActionRunner', () => {
    async function setupDb() {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        return adapter;
    }

    test('rejects missing or empty path', async () => {
        const runner = new RunArtifactActionRunner();
        const res = await runner.execute(
            { artifactKind: 'test' },
            { runId: 'r1', stateOrNodeId: 's1', workdir: process.cwd(), vars: {}, env: {} },
        );
        expect(res.ok).toBe(false);
        expect(res.error).toContain('Action option "path" must be a non-empty string');
    });

    test('rejects missing or empty artifactKind', async () => {
        const runner = new RunArtifactActionRunner();
        const res = await runner.execute(
            { path: '.spur/run/test.json' },
            { runId: 'r1', stateOrNodeId: 's1', workdir: process.cwd(), vars: {}, env: {} },
        );
        expect(res.ok).toBe(false);
        expect(res.error).toContain('Action option "artifactKind" must be a non-empty string');
    });

    test('rejects path outside .spur/run/', async () => {
        const runner = new RunArtifactActionRunner();
        const res = await runner.execute(
            { path: 'outside.json', artifactKind: 'test' },
            { runId: 'r1', stateOrNodeId: 's1', workdir: process.cwd(), vars: {}, env: {} },
        );
        expect(res.ok).toBe(false);
        expect(res.error).toContain('path must resolve beneath .spur/run/');
    });

    test('fails when requireExisting is true and file is missing', async () => {
        const workdir = join(tmpdir(), `test-art-missing-${crypto.randomUUID()}`);
        const fs = createNodeFileSystem(workdir);
        await fs.ensureDir(join(workdir, '.spur', 'run'));

        const runner = new RunArtifactActionRunner(undefined, fs);
        const res = await runner.execute(
            { path: '.spur/run/missing.json', artifactKind: 'test', requireExisting: true },
            { runId: 'r1', stateOrNodeId: 's1', workdir, vars: {}, env: {} },
        );
        expect(res.ok).toBe(false);
        expect(res.error).toContain('required file does not exist');
    });

    test('records artifact successfully in ArtifactDao when file exists', async () => {
        const workdir = join(tmpdir(), `test-art-ok-${crypto.randomUUID()}`);
        const fs = createNodeFileSystem(workdir);
        await fs.ensureDir(join(workdir, '.spur', 'run'));
        const artifactPath = '.spur/run/verdict.json';
        await fs.writeFile(join(workdir, artifactPath), '{"verdict":"PASS"}');

        const db = await setupDb();
        const runDao = new RunDao(db);
        await runDao.open({ status: 'running' });
        await db.run(
            "INSERT INTO runs (id, status, started_at, created_at, updated_at) VALUES ('run-123', 'running', '2026-08-19T00:00:00.000Z', 1000, 1000)",
        );
        const artifactDao = new ArtifactDao(db);

        const runner = new RunArtifactActionRunner(async () => db, fs, artifactDao);
        const res = await runner.execute(
            {
                path: artifactPath,
                artifactKind: 'verify-verdict',
                proofBinding: 'current',
                requireExisting: true,
            },
            { runId: 'run-123', stateOrNodeId: 's1', workdir, vars: {}, env: {} },
        );

        expect(res.ok).toBe(true);
        const data = res.data as { kind?: string; proofBinding?: string; runId?: string } | undefined;
        expect(data?.kind).toBe('verify-verdict');
        expect(data?.proofBinding).toBe('current');
        expect(data?.runId).toBe('run-123');

        const rows = await artifactDao.artifactsByRunId('run-123');
        expect(rows.length).toBe(1);
        expect(rows[0]?.kind).toBe('verify-verdict');
        expect(rows[0]?.path).toContain('verdict.json');

        db.close();
    });
});
