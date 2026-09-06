import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactDao, applyCliMigrations, RunDao } from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { RunArtifactActionRunner } from '../../../src/workflow/actions/run-artifact';

describe('RunArtifactActionRunner', () => {
    test('rejects sibling prefixes and the run directory even without an existence probe (0781)', async () => {
        for (const path of ['.spur/run-other/verdict.json', '.spur/run/../run-other/verdict.json', '.spur/run']) {
            const result = await new RunArtifactActionRunner().execute(
                { path, artifactKind: 'test', requireExisting: false },
                { runId: 'r1', stateOrNodeId: 's1', workdir: process.cwd(), vars: {}, env: {} },
            );
            expect(result.ok).toBe(false);
            expect(result.error).toContain('must resolve beneath .spur/run/');
        }
    });

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
            // 0751 R4: a declared 'current' binding only holds when the run carries a
            // well-formed proof digest — the happy path must seed one.
            {
                runId: 'run-123',
                stateOrNodeId: 's1',
                workdir,
                vars: { proofDigest: `sha256:${'a'.repeat(64)}` },
                env: {},
            },
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

// Task 0751 R4: proofBinding used to be decorative — echoed into result data without ever being
// checked, so an artifact could claim a proof binding that did not hold and still reach the ledger
// (ADR-071 proof-chain symmetry). Enforcement lives at the write, BEFORE dao.record, so a failed
// binding never persists an artifact record.
describe('RunArtifactActionRunner proofBinding enforcement (task 0751 R4)', () => {
    const GOOD = `sha256:${'a'.repeat(64)}`;

    async function setup() {
        const workdir = join(tmpdir(), `test-art-bind-${crypto.randomUUID()}`);
        const fs = createNodeFileSystem(workdir);
        await fs.ensureDir(join(workdir, '.spur', 'run'));
        const artifactPath = '.spur/run/verdict.json';
        await fs.writeFile(join(workdir, artifactPath), '{"verdict":"PASS"}');
        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        // artifacts.run_id has an FK on runs.id — open the run row the records attach to.
        await adapter.run(
            "INSERT INTO runs (id, status, started_at, created_at, updated_at) VALUES ('run-bind', 'running', '2026-09-03T00:00:00.000Z', 1000, 1000)",
        );
        const dao = new ArtifactDao(adapter);
        return { workdir, fs, artifactPath, dao, adapter };
    }

    const ctxWith = (workdir: string, vars: Record<string, string>) => ({
        runId: 'run-bind',
        stateOrNodeId: 's1',
        workdir,
        vars,
        env: {},
    });

    test("declared 'current' without any proof digest rejects and persists NO ledger row", async () => {
        const { workdir, artifactPath, dao, adapter } = await setup();
        const runner = new RunArtifactActionRunner(undefined, createNodeFileSystem(), dao);
        const res = await runner.execute(
            { path: artifactPath, artifactKind: 'verify-verdict', proofBinding: 'current' },
            ctxWith(workdir, {}),
        );
        expect(res.ok).toBe(false);
        expect(res.error).toContain('proofBinding "current" does not hold');
        expect(await dao.artifactsByRunId('run-bind')).toHaveLength(0);
        adapter.close();
    });

    test('malformed proof digest rejects the binding', async () => {
        const { workdir, artifactPath, dao, adapter } = await setup();
        const runner = new RunArtifactActionRunner(undefined, createNodeFileSystem(), dao);
        for (const bad of ['not-a-digest', `sha256:${'zz'.repeat(32)}`, '']) {
            const res = await runner.execute(
                { path: artifactPath, artifactKind: 'verify-verdict', proofBinding: 'current' },
                ctxWith(workdir, { proofDigest: bad }),
            );
            expect(res.ok).toBe(false);
        }
        expect(await dao.artifactsByRunId('run-bind')).toHaveLength(0);
        adapter.close();
    });

    test("a well-formed proofDigestNow (preferred) or proofDigest satisfies the 'current' binding", async () => {
        const { workdir, artifactPath, dao, adapter } = await setup();
        const runner = new RunArtifactActionRunner(undefined, createNodeFileSystem(), dao);
        const okNow = await runner.execute(
            { path: artifactPath, artifactKind: 'verify-verdict', proofBinding: 'current' },
            ctxWith(workdir, { proofDigestNow: GOOD, proofDigest: 'garbage' }),
        );
        expect(okNow.ok).toBe(true);
        adapter.close();
    });

    test('an unknown binding value is rejected, not silently accepted', async () => {
        const { workdir, artifactPath, dao, adapter } = await setup();
        const runner = new RunArtifactActionRunner(undefined, createNodeFileSystem(), dao);
        const res = await runner.execute(
            { path: artifactPath, artifactKind: 'verify-verdict', proofBinding: 'best-effort' },
            ctxWith(workdir, { proofDigest: GOOD }),
        );
        expect(res.ok).toBe(false);
        expect(res.error).toContain('unsupported proofBinding');
        expect(await dao.artifactsByRunId('run-bind')).toHaveLength(0);
        adapter.close();
    });

    test('no proofBinding declared: behavior unchanged (digest not required)', async () => {
        const { workdir, artifactPath, dao, adapter } = await setup();
        const runner = new RunArtifactActionRunner(undefined, createNodeFileSystem(), dao);
        const res = await runner.execute({ path: artifactPath, artifactKind: 'verify-verdict' }, ctxWith(workdir, {}));
        expect(res.ok).toBe(true);
        adapter.close();
    });
});
