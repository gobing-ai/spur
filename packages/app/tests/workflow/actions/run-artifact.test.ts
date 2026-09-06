import { describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactDao, applyCliMigrations, type DbAdapter } from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { RunArtifactActionRunner } from '../../../src/workflow/actions/run-artifact';
import { computeProofInputFingerprint } from '../../../src/workflow/proof-input-fingerprint';

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

    test('records a path-only (unbound) artifact in ArtifactDao when the file exists', async () => {
        const workdir = join(tmpdir(), `test-art-ok-${crypto.randomUUID()}`);
        const fs = createNodeFileSystem(workdir);
        await fs.ensureDir(join(workdir, '.spur', 'run'));
        const artifactPath = '.spur/run/verdict.json';
        await fs.writeFile(join(workdir, artifactPath), '{"verdict":"PASS"}');

        const db = await setupDb();
        const artifactDao = new ArtifactDao(db);
        // artifacts.run_id has an FK on runs.id — open the run row the records attach to.
        await db.run(
            "INSERT INTO runs (id, status, started_at, created_at, updated_at) VALUES ('run-123', 'running', '2026-08-19T00:00:00.000Z', 1000, 1000)",
        );

        // 0785 R3: without a declared proofBinding the registration stays path-only —
        // no proof evidence is demanded and none is claimed.
        const runner = new RunArtifactActionRunner(async () => db, fs, artifactDao);
        const res = await runner.execute(
            { path: artifactPath, artifactKind: 'verify-verdict', requireExisting: true },
            { runId: 'run-123', stateOrNodeId: 's1', workdir, vars: {}, env: {} },
        );

        expect(res.ok).toBe(true);
        const data = res.data as { kind?: string; runId?: string } | undefined;
        expect(data?.kind).toBe('verify-verdict');
        expect(data?.runId).toBe('run-123');

        const rows = await artifactDao.artifactsByRunId('run-123');
        expect(rows.length).toBe(1);
        expect(rows[0]?.kind).toBe('verify-verdict');
        expect(rows[0]?.path).toContain('verdict.json');

        db.close();
    });

    test('rejects a symlink escape beneath .spur/run/ (0785 R2)', async () => {
        const base = mkdtempSync(join(tmpdir(), 'test-art-escape-'));
        try {
            const workdir = join(base, 'wt');
            mkdirSync(join(workdir, '.spur', 'run'), { recursive: true });
            const outside = join(base, 'outside');
            mkdirSync(outside);
            writeFileSync(join(outside, 'secret.txt'), 'exfiltrated');
            symlinkSync(outside, join(workdir, '.spur', 'run', 'link'));

            const runner = new RunArtifactActionRunner();
            const res = await runner.execute(
                { path: '.spur/run/link/secret.txt', artifactKind: 'test', requireExisting: true },
                { runId: 'r1', stateOrNodeId: 's1', workdir, vars: {}, env: {} },
            );
            expect(res.ok).toBe(false);
            expect(res.error).toContain('escapes');
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });

    test('rejects a dangling symlink beneath .spur/run/ (0785 R2)', async () => {
        const base = mkdtempSync(join(tmpdir(), 'test-art-dangling-'));
        try {
            const workdir = join(base, 'wt');
            mkdirSync(join(workdir, '.spur', 'run'), { recursive: true });
            symlinkSync(join(base, 'gone'), join(workdir, '.spur', 'run', 'dangling.json'));

            const runner = new RunArtifactActionRunner();
            const res = await runner.execute(
                { path: '.spur/run/dangling.json', artifactKind: 'test', requireExisting: true },
                { runId: 'r1', stateOrNodeId: 's1', workdir, vars: {}, env: {} },
            );
            expect(res.ok).toBe(false);
            expect(res.error).toContain('dangling symlink');
        } finally {
            rmSync(base, { recursive: true, force: true });
        }
    });
});

// ── Bound registration (0785 R3/R4) ────────────────────────────────────────────────
// Supersedes the 0751 R4 var-only enforcement: a declared proofBinding 'current' now
// demands a FRESH capture over the canonical inputs agreeing with the run's declared
// digest, a raw-verdict proof block validated against the authoritative RunDao row, and
// a run-scoped review-completion marker — all BEFORE any ledger row exists.

describe('RunArtifactActionRunner bound verify-verdict registration (task 0785 R3/R4)', () => {
    const WBS = 't9001';
    const RUN_ID = 'run-bind';
    const DEFINITION = `sha256:${'c'.repeat(64)}`;
    const RESUME_DEFINITION = `sha256:${'d'.repeat(64)}`;

    interface Fixture {
        workdir: string;
        dao: ArtifactDao;
        adapter: DbAdapter;
        digest: string;
        specPath: string;
        verdictPath: string;
        cleanup: () => void;
    }

    /** Real git workdir + spec + PASS verdict with a fully valid raw proof block + marker. */
    async function setup(opts?: { definitionDigest?: string; reviewStatus?: string }): Promise<Fixture> {
        const base = mkdtempSync(join(tmpdir(), 'test-art-bound-'));
        const cleanup = () => rmSync(base, { recursive: true, force: true });
        const workdir = join(base, 'wt');
        mkdirSync(join(workdir, '.spur', 'run'), { recursive: true });
        // Fresh capture folds the git tree — the fixture needs at least one real commit. Mirror
        // production: `.spur/` run artifacts are gitignored, and the task spec is excluded from
        // the tree half (it is folded in explicitly as normalized content, like `docs/tasks*`).
        writeFileSync(join(workdir, '.gitignore'), '.spur/\nspec.md\n');
        writeFileSync(join(workdir, 'README.md'), 'tracked\n');
        execSync('git init -q && git config user.email t@example.com && git config user.name t', { cwd: workdir });
        execSync('git add -A && git commit -qm init', { cwd: workdir });

        const specPath = join(workdir, 'spec.md');
        const specContent = '---\nwbs: t9001\n---\n\n### Requirements\n- [ ] R1. x\n';
        writeFileSync(specPath, specContent);

        const digest = await computeProofInputFingerprint({ cwd: workdir, taskContent: specContent });

        const verdictPath = join(workdir, '.spur', 'run', `${WBS}-verdict.json`);
        writeFileSync(
            verdictPath,
            JSON.stringify({
                wbs: WBS,
                verdict: 'PASS',
                requirements: [],
                acceptanceCriteria: [],
                proof: {
                    digest,
                    runId: RUN_ID,
                    definitionDigest: opts?.definitionDigest ?? DEFINITION,
                    capturePoint: 'quality-gate-entry',
                    stages: {
                        qualityGate: { status: 'PASS', digest },
                        review: { status: opts?.reviewStatus ?? 'completed', digest },
                        verification: { status: 'PASS', digest },
                    },
                },
            }),
        );

        // Run-scoped review-completion marker written by the review stage (0785 R4).
        writeFileSync(join(workdir, '.spur', 'run', `${RUN_ID}-review-proof.digest`), digest);

        const adapter = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        await applyCliMigrations(adapter);
        await adapter.run(
            `INSERT INTO runs (id, status, started_at, created_at, updated_at, metadata_json)
             VALUES ('${RUN_ID}', 'running', '2026-09-20T00:00:00.000Z', 1000, 1000, ?)`,
            [JSON.stringify({ definitionDigest: opts?.definitionDigest ?? DEFINITION })],
        );
        const dao = new ArtifactDao(adapter);
        return { workdir, dao, adapter, digest, specPath, verdictPath, cleanup };
    }

    const ctxWith = (workdir: string, vars: Record<string, string>) => ({
        runId: RUN_ID,
        stateOrNodeId: 'record',
        workdir,
        vars,
        env: {},
    });

    const boundOptions = (fixture: Fixture) => ({
        path: `.spur/run/${WBS}-verdict.json`,
        artifactKind: 'verify-verdict',
        proofBinding: 'current',
        taskFile: fixture.specPath,
        featureFile: '',
    });

    test('happy path binds against a fresh capture, records the ledger row, and republishes the digest', async () => {
        const f = await setup();
        try {
            const runner = new RunArtifactActionRunner(async () => f.adapter, createNodeFileSystem(), f.dao);
            const res = await runner.execute(boundOptions(f), ctxWith(f.workdir, { proofDigest: f.digest, wbs: WBS }));
            expect(res.ok).toBe(true);
            const data = res.data as { proofDigest?: string; proofBinding?: string };
            expect(data.proofDigest).toBe(f.digest);
            expect(data.proofBinding).toBe('current');
            expect(res.setVars?.proofDigestNow).toBe(f.digest);
            const rows = await f.dao.artifactsByRunId(RUN_ID);
            expect(rows).toHaveLength(1);
            expect(rows[0]?.kind).toBe('verify-verdict');
        } finally {
            f.adapter.close();
            f.cleanup();
        }
    });

    test('a stale or forged var (well-formed but not the fresh capture) refuses and persists NO row', async () => {
        const f = await setup();
        try {
            const forged = `sha256:${'b'.repeat(64)}`;
            const runner = new RunArtifactActionRunner(async () => f.adapter, createNodeFileSystem(), f.dao);
            const res = await runner.execute(boundOptions(f), ctxWith(f.workdir, { proofDigest: forged, wbs: WBS }));
            expect(res.ok).toBe(false);
            expect(res.error).toContain('stale or forged');
            expect(await f.dao.artifactsByRunId(RUN_ID)).toHaveLength(0);
        } finally {
            f.adapter.close();
            f.cleanup();
        }
    });

    test('a run with no proof digest var refuses — a proof that was never captured cannot bind', async () => {
        const f = await setup();
        try {
            const runner = new RunArtifactActionRunner(async () => f.adapter, createNodeFileSystem(), f.dao);
            const res = await runner.execute(boundOptions(f), ctxWith(f.workdir, { wbs: WBS }));
            expect(res.ok).toBe(false);
            expect(res.error).toContain('no current proof input digest');
            expect(await f.dao.artifactsByRunId(RUN_ID)).toHaveLength(0);
        } finally {
            f.adapter.close();
            f.cleanup();
        }
    });

    test('a malformed digest var refuses before any ledger write', async () => {
        const f = await setup();
        try {
            const runner = new RunArtifactActionRunner(async () => f.adapter, createNodeFileSystem(), f.dao);
            for (const bad of ['not-a-digest', '']) {
                const res = await runner.execute(boundOptions(f), ctxWith(f.workdir, { proofDigest: bad, wbs: WBS }));
                expect(res.ok).toBe(false);
            }
            expect(await f.dao.artifactsByRunId(RUN_ID)).toHaveLength(0);
        } finally {
            f.adapter.close();
            f.cleanup();
        }
    });

    test('missing or unreadable taskFile refuses with a named error (0785 R1)', async () => {
        const f = await setup();
        try {
            const runner = new RunArtifactActionRunner(async () => f.adapter, createNodeFileSystem(), f.dao);
            const missing = await runner.execute(
                { ...boundOptions(f), taskFile: join(f.workdir, 'nope.md') },
                ctxWith(f.workdir, { proofDigest: f.digest, wbs: WBS }),
            );
            expect(missing.ok).toBe(false);
            expect(missing.error).toContain('taskFile does not exist');
            // A directory is not a regular file.
            const dir = await runner.execute(
                { ...boundOptions(f), taskFile: join(f.workdir, '.spur') },
                ctxWith(f.workdir, { proofDigest: f.digest, wbs: WBS }),
            );
            expect(dir.ok).toBe(false);
            expect(dir.error).toContain('not a regular file');
            expect(await f.dao.artifactsByRunId(RUN_ID)).toHaveLength(0);
        } finally {
            f.adapter.close();
            f.cleanup();
        }
    });

    test('bound registration requires the composed database context', async () => {
        const f = await setup();
        try {
            const runner = new RunArtifactActionRunner(undefined, createNodeFileSystem(), f.dao);
            const res = await runner.execute(boundOptions(f), ctxWith(f.workdir, { proofDigest: f.digest, wbs: WBS }));
            expect(res.ok).toBe(false);
            expect(res.error).toContain('requires the composed database context');
            expect(await f.dao.artifactsByRunId(RUN_ID)).toHaveLength(0);
        } finally {
            f.adapter.close();
            f.cleanup();
        }
    });

    test('a non verify-verdict kind with proofBinding current is unsupported', async () => {
        const f = await setup();
        try {
            const runner = new RunArtifactActionRunner(async () => f.adapter, createNodeFileSystem(), f.dao);
            const res = await runner.execute(
                { ...boundOptions(f), artifactKind: 'other' },
                ctxWith(f.workdir, { proofDigest: f.digest, wbs: WBS }),
            );
            expect(res.ok).toBe(false);
            expect(res.error).toContain('only supported for the verify-verdict artifact kind');
        } finally {
            f.adapter.close();
            f.cleanup();
        }
    });

    test('bound registration requires a non-empty taskFile option', async () => {
        const f = await setup();
        try {
            const runner = new RunArtifactActionRunner(async () => f.adapter, createNodeFileSystem(), f.dao);
            const res = await runner.execute(
                { ...boundOptions(f), taskFile: '' },
                ctxWith(f.workdir, { proofDigest: f.digest, wbs: WBS }),
            );
            expect(res.ok).toBe(false);
            expect(res.error).toContain('requires a non-empty "taskFile"');
        } finally {
            f.adapter.close();
            f.cleanup();
        }
    });

    test('a non-PASS verdict refuses to bind', async () => {
        const f = await setup();
        try {
            const raw = await createNodeFileSystem(f.workdir).readFile(f.verdictPath);
            await createNodeFileSystem(f.workdir).writeFile(
                f.verdictPath,
                raw.replace('"verdict":"PASS"', '"verdict":"PARTIAL"'),
            );
            const runner = new RunArtifactActionRunner(async () => f.adapter, createNodeFileSystem(), f.dao);
            const res = await runner.execute(boundOptions(f), ctxWith(f.workdir, { proofDigest: f.digest, wbs: WBS }));
            expect(res.ok).toBe(false);
            expect(res.error).toContain('not PASS');
            expect(await f.dao.artifactsByRunId(RUN_ID)).toHaveLength(0);
        } finally {
            f.adapter.close();
            f.cleanup();
        }
    });

    test('a verdict naming a different wbs refuses', async () => {
        const f = await setup();
        try {
            const raw = await createNodeFileSystem(f.workdir).readFile(f.verdictPath);
            await createNodeFileSystem(f.workdir).writeFile(
                f.verdictPath,
                raw.replace(`"wbs":"${WBS}"`, '"wbs":"t9999"'),
            );
            const runner = new RunArtifactActionRunner(async () => f.adapter, createNodeFileSystem(), f.dao);
            const res = await runner.execute(boundOptions(f), ctxWith(f.workdir, { proofDigest: f.digest, wbs: WBS }));
            expect(res.ok).toBe(false);
            expect(res.error).toContain('names wbs "t9999"');
        } finally {
            f.adapter.close();
            f.cleanup();
        }
    });

    test('a raw proof block whose digest differs from the fresh capture refuses', async () => {
        const f = await setup();
        try {
            const other = `sha256:${'e'.repeat(64)}`;
            const raw = await createNodeFileSystem(f.workdir).readFile(f.verdictPath);
            await createNodeFileSystem(f.workdir).writeFile(f.verdictPath, raw.replace(f.digest, other));
            const runner = new RunArtifactActionRunner(async () => f.adapter, createNodeFileSystem(), f.dao);
            const res = await runner.execute(boundOptions(f), ctxWith(f.workdir, { proofDigest: f.digest, wbs: WBS }));
            expect(res.ok).toBe(false);
            expect(res.error).toContain('proof.digest');
        } finally {
            f.adapter.close();
            f.cleanup();
        }
    });

    test('a raw proof block naming a different run refuses', async () => {
        const f = await setup();
        try {
            const raw = await createNodeFileSystem(f.workdir).readFile(f.verdictPath);
            await createNodeFileSystem(f.workdir).writeFile(
                f.verdictPath,
                raw.replace(`"runId":"${RUN_ID}"`, '"runId":"run-other"'),
            );
            const runner = new RunArtifactActionRunner(async () => f.adapter, createNodeFileSystem(), f.dao);
            const res = await runner.execute(boundOptions(f), ctxWith(f.workdir, { proofDigest: f.digest, wbs: WBS }));
            expect(res.ok).toBe(false);
            expect(res.error).toContain('proof.runId');
        } finally {
            f.adapter.close();
            f.cleanup();
        }
    });

    test('a verdict without a raw proof block refuses (the canonical parser strips unknown fields)', async () => {
        const f = await setup();
        try {
            const parsed = JSON.parse(await createNodeFileSystem(f.workdir).readFile(f.verdictPath));
            delete parsed.proof;
            await createNodeFileSystem(f.workdir).writeFile(f.verdictPath, JSON.stringify(parsed));
            const runner = new RunArtifactActionRunner(async () => f.adapter, createNodeFileSystem(), f.dao);
            const res = await runner.execute(boundOptions(f), ctxWith(f.workdir, { proofDigest: f.digest, wbs: WBS }));
            expect(res.ok).toBe(false);
            expect(res.error).toContain('no raw proof block');
        } finally {
            f.adapter.close();
            f.cleanup();
        }
    });

    test('the raw definitionDigest must match the run row — launch digest and resume digest alike', async () => {
        const f = await setup();
        try {
            const runner = new RunArtifactActionRunner(async () => f.adapter, createNodeFileSystem(), f.dao);
            // Wrong definition digest in the artifact (var digest agrees with fresh capture,
            // so the refusal must come from the RunDao comparison).
            const wrongDef = `sha256:${'f'.repeat(64)}`;
            const raw = await createNodeFileSystem(f.workdir).readFile(f.verdictPath);
            await createNodeFileSystem(f.workdir).writeFile(f.verdictPath, raw.replace(DEFINITION, wrongDef));
            const mismatch = await runner.execute(
                boundOptions(f),
                ctxWith(f.workdir, { proofDigest: f.digest, wbs: WBS }),
            );
            expect(mismatch.ok).toBe(false);
            expect(mismatch.error).toContain('definitionDigest');

            // A resumed run carries metadata.resumeDefinitionDigest — the artifact must name THAT.
            await f.adapter.run(`UPDATE runs SET metadata_json = ? WHERE id = ?`, [
                JSON.stringify({ definitionDigest: DEFINITION, resumeDefinitionDigest: RESUME_DEFINITION }),
                RUN_ID,
            ]);
            const raw2 = await createNodeFileSystem(f.workdir).readFile(f.verdictPath);
            await createNodeFileSystem(f.workdir).writeFile(f.verdictPath, raw2.replace(wrongDef, DEFINITION));
            const staleResume = await runner.execute(
                boundOptions(f),
                ctxWith(f.workdir, { proofDigest: f.digest, wbs: WBS }),
            );
            expect(staleResume.ok).toBe(false);
            expect(staleResume.error).toContain('resume');
            await createNodeFileSystem(f.workdir).writeFile(f.verdictPath, raw2.replace(wrongDef, RESUME_DEFINITION));
            const resumed = await runner.execute(
                boundOptions(f),
                ctxWith(f.workdir, { proofDigest: f.digest, wbs: WBS }),
            );
            expect(resumed.ok).toBe(true);
        } finally {
            f.adapter.close();
            f.cleanup();
        }
    });

    test('stage digests and statuses must agree with the fresh capture (0785 R4)', async () => {
        const f = await setup();
        try {
            const fs = createNodeFileSystem(f.workdir);
            const runner = new RunArtifactActionRunner(async () => f.adapter, fs, f.dao);
            const raw = await fs.readFile(f.verdictPath);

            // A stage naming an older digest is stale evidence.
            const other = `sha256:${'9'.repeat(64)}`;
            const parsed = JSON.parse(raw) as { proof: { stages: { verification: { digest: string } } } };
            parsed.proof.stages.verification.digest = other;
            await fs.writeFile(f.verdictPath, JSON.stringify(parsed));
            const staleStage = await runner.execute(
                boundOptions(f),
                ctxWith(f.workdir, { proofDigest: f.digest, wbs: WBS }),
            );
            expect(staleStage.ok).toBe(false);
            expect(staleStage.error).toContain('proof.stages.verification.digest');

            // A red quality gate is not completion evidence.
            const parsedQg = JSON.parse(raw) as {
                proof: { stages: { qualityGate: { status: string; digest: string } } };
            };
            parsedQg.proof.stages.qualityGate.status = 'FAIL';
            await fs.writeFile(f.verdictPath, JSON.stringify(parsedQg));
            const redGate = await runner.execute(
                boundOptions(f),
                ctxWith(f.workdir, { proofDigest: f.digest, wbs: WBS }),
            );
            expect(redGate.ok).toBe(false);
            expect(redGate.error).toContain('qualityGate.status');

            // Review stamped skipped in the raw proof is never completed evidence.
            const parsedRv = JSON.parse(raw) as { proof: { stages: { review: { status: string; digest: string } } } };
            parsedRv.proof.stages.review.status = 'skipped';
            await fs.writeFile(f.verdictPath, JSON.stringify(parsedRv));
            const skippedReview = await runner.execute(
                boundOptions(f),
                ctxWith(f.workdir, { proofDigest: f.digest, wbs: WBS }),
            );
            expect(skippedReview.ok).toBe(false);
            expect(skippedReview.error).toContain('not completed evidence');
            expect(await f.dao.artifactsByRunId(RUN_ID)).toHaveLength(0);
        } finally {
            f.adapter.close();
            f.cleanup();
        }
    });

    test('the review-completion marker is independent evidence: missing or stale marker refuses (0785 R4)', async () => {
        const f = await setup();
        try {
            const fs = createNodeFileSystem(f.workdir);
            const markerPath = join(f.workdir, '.spur', 'run', `${RUN_ID}-review-proof.digest`);
            const runner = new RunArtifactActionRunner(async () => f.adapter, fs, f.dao);

            // Raw proof says completed, but the run-scoped marker is missing.
            rmSync(markerPath);
            const noMarker = await runner.execute(
                boundOptions(f),
                ctxWith(f.workdir, { proofDigest: f.digest, wbs: WBS }),
            );
            expect(noMarker.ok).toBe(false);
            expect(noMarker.error).toContain('review-proof marker');

            // A marker from an earlier digest does not certify this run.
            writeFileSync(markerPath, `sha256:${'8'.repeat(64)}`);
            const staleMarker = await runner.execute(
                boundOptions(f),
                ctxWith(f.workdir, { proofDigest: f.digest, wbs: WBS }),
            );
            expect(staleMarker.ok).toBe(false);
            expect(staleMarker.error).toContain('review-proof marker');
            expect(await f.dao.artifactsByRunId(RUN_ID)).toHaveLength(0);
        } finally {
            f.adapter.close();
            f.cleanup();
        }
    });

    test('bound registration still refuses a symlink escape beneath .spur/run/ (0785 R2)', async () => {
        const f = await setup();
        try {
            const outside = join(f.workdir, '..', 'outside-bound');
            mkdirSync(outside, { recursive: true });
            writeFileSync(join(outside, 'v.json'), '{"verdict":"PASS"}');
            symlinkSync(outside, join(f.workdir, '.spur', 'run', 'link'));
            const runner = new RunArtifactActionRunner(async () => f.adapter, createNodeFileSystem(), f.dao);
            const res = await runner.execute(
                { ...boundOptions(f), path: '.spur/run/link/v.json' },
                ctxWith(f.workdir, { proofDigest: f.digest, wbs: WBS }),
            );
            expect(res.ok).toBe(false);
            expect(res.error).toContain('escapes');
            expect(await f.dao.artifactsByRunId(RUN_ID)).toHaveLength(0);
        } finally {
            f.adapter.close();
            f.cleanup();
        }
    });

    test('an unknown binding value is rejected, not silently accepted', async () => {
        const f = await setup();
        try {
            const runner = new RunArtifactActionRunner(async () => f.adapter, createNodeFileSystem(), f.dao);
            const res = await runner.execute(
                { ...boundOptions(f), proofBinding: 'best-effort' },
                ctxWith(f.workdir, { proofDigest: f.digest, wbs: WBS }),
            );
            expect(res.ok).toBe(false);
            expect(res.error).toContain('unsupported proofBinding');
            expect(await f.dao.artifactsByRunId(RUN_ID)).toHaveLength(0);
        } finally {
            f.adapter.close();
            f.cleanup();
        }
    });
});
