import { describe, expect, test } from 'bun:test';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { RunDao } from '../../src/dao/run-dao';
import { applyCliMigrations } from '../../src/migrations';

describe('RunDao.stampRunIdentity (0768)', () => {
    async function setup() {
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        return adapter;
    }

    async function insertRunRow(db: Awaited<ReturnType<typeof setup>>, runId: string, metadataJson: string) {
        const now = Date.now();
        await db.run(
            `INSERT INTO runs (id, workflow_name, mode, status, started_at, metadata_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            runId,
            'test-wf',
            'state-machine',
            'running',
            new Date(now).toISOString(),
            metadataJson,
            now,
            now,
        );
    }

    test('records a null workflowVersion instead of deleting it (json_patch RFC-7396 regression)', async () => {
        const db = await setup();
        const dao = new RunDao(db);
        await insertRunRow(db, 'r1', '{}');

        await dao.stampRunIdentity('r1', 'sha256:abc', null);

        const row = await dao.traceRowById('r1');
        const meta = JSON.parse(row?.metadata_json ?? '{}');
        expect(meta.definitionDigest).toBe('sha256:abc');
        // The whole point: a known-unversioned run records the key as null.
        expect(meta.workflowVersion).toBeNull();
    });

    test('preserves sibling metadata and fills an absent identity in place', async () => {
        const db = await setup();
        const dao = new RunDao(db);
        await insertRunRow(db, 'r2', '{"dryRun":true}');

        await dao.stampRunIdentity('r2', 'sha256:new', '1.0.0');

        const row = await dao.traceRowById('r2');
        const meta = JSON.parse(row?.metadata_json ?? '{}');
        expect(meta.dryRun).toBe(true);
        expect(meta.definitionDigest).toBe('sha256:new');
        expect(meta.workflowVersion).toBe('1.0.0');
    });

    test('refuses to overwrite an already-stamped digest (0784 R1 identity immutability)', async () => {
        const db = await setup();
        const dao = new RunDao(db);
        await insertRunRow(db, 'r3', '{"definitionDigest":"sha256:launch","workflowVersion":"0.1.0"}');

        // An attach/race re-resolution must never rewrite the launch identity.
        await dao.stampRunIdentity('r3', 'sha256:later', '9.9.9', {
            path: '/tmp/other.yaml',
            layer: 'project',
            workdir: '/tmp',
        });

        const row = await dao.traceRowById('r3');
        const meta = JSON.parse(row?.metadata_json ?? '{}');
        expect(meta.definitionDigest).toBe('sha256:launch');
        expect(meta.workflowVersion).toBe('0.1.0');
        expect(meta.definitionSource).toBeUndefined();
    });

    test('stamps the launch source alongside the digest in one merge (0784 R1)', async () => {
        const db = await setup();
        const dao = new RunDao(db);
        await insertRunRow(db, 'r4', '{"dryRun":false}');

        await dao.stampRunIdentity('r4', 'sha256:launch', null, {
            path: '/repo/.spur/workflows/my-pipeline.yaml',
            layer: 'project',
            workdir: '/repo',
        });

        const row = await dao.traceRowById('r4');
        const meta = JSON.parse(row?.metadata_json ?? '{}');
        expect(meta.definitionDigest).toBe('sha256:launch');
        expect(meta.workflowVersion).toBeNull();
        expect(meta.dryRun).toBe(false);
        expect(meta.definitionSource).toEqual({
            path: '/repo/.spur/workflows/my-pipeline.yaml',
            layer: 'project',
            workdir: '/repo',
        });
    });
});
