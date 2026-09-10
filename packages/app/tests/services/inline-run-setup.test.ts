import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactDao } from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import {
    computeProofInputFingerprint,
    createOrAttachInlineRun,
    type InlineRunProjectDb,
    openInlineRunProjectDb,
    resolveWorkflowDefinition,
} from '../../src';
import { RunArtifactActionRunner } from '../../src/workflow/actions/run-artifact';

/**
 * Task 0804 R1 / AC1: the inline full-pipeline driver's run setup must persist an
 * AUTHORITATIVE workflow run row (through the real setup path, not a hand-inserted row)
 * so a subsequent bound `run.artifact` record accepts the inline run — and every identity
 * mismatch still refuses.
 */

const WBS = 't9002';
const RUN_ID = 'run-inline-0804';
const DEFINITION = '.spur/workflows/inline-smoke.yaml';

const WORKFLOW_V1 = `name: inline-smoke
initialState: start
terminalStates:
    - end
states:
    - id: start
      onEnter:
          - kind: shell
            options:
                command: echo smoke
    - id: end
transitions:
    - from: start
      to: end
      guard:
          kind: always
`;

const WORKFLOW_V2 = WORKFLOW_V1.replace('echo smoke', 'echo smoke-v2');

interface Row {
    id: string;
    workflow_name: string;
    mode: string;
    status: string;
    metadata_json: string;
}

describe('createOrAttachInlineRun (task 0804 R1)', () => {
    let base: string;
    let projectDb: InlineRunProjectDb;

    /**
     * Fixture project: real git workdir + task spec + project-layer workflow definition,
     * mirroring the production inline driver layout (`.spur/workflows/`, `.spur/run/`).
     */
    function makeProject(
        workflowBody: string,
        /** Ignore rules for the fixture; the drift fixture tracks the workflow (task 0809 R4). */
        gitignore = '.spur/\nspec.md\n',
    ): {
        workdir: string;
        specPath: string;
        specContent: string;
        definitionPath: string;
        cleanup: () => void;
    } {
        const root = mkdtempSync(join(tmpdir(), 'spur-0804-setup-'));
        const workdir = join(root, 'wt');
        const definitionPath = join(workdir, ...DEFINITION.split('/'));
        mkdirSync(join(workdir, '.spur', 'workflows'), { recursive: true });
        mkdirSync(join(workdir, '.spur', 'run'), { recursive: true });
        writeFileSync(join(workdir, '.gitignore'), gitignore);
        writeFileSync(join(workdir, 'README.md'), 'tracked\n');
        writeFileSync(definitionPath, workflowBody);
        execSync('git init -q && git config user.email t@example.com && git config user.name t', { cwd: workdir });
        execSync('git add -A && git commit -qm init', { cwd: workdir });
        const specContent =
            '---\nwbs: t9002\n---\n\n## t9002. Inline run fixture\n\n### Requirements\n- [ ] R1. authoritative inline identity\n';
        const specPath = join(workdir, 'spec.md');
        writeFileSync(specPath, specContent);
        return {
            workdir,
            specPath,
            specContent,
            definitionPath,
            cleanup: () => rmSync(root, { recursive: true, force: true }),
        };
    }

    beforeAll(async () => {
        base = mkdtempSync(join(tmpdir(), 'spur-0804-db-'));
        projectDb = await openInlineRunProjectDb(base);
    });

    afterAll(() => {
        projectDb.close();
        rmSync(base, { recursive: true, force: true });
    });

    beforeEach(async () => {
        // Tests share one project DB; each case owns its run-id namespace. Artifacts are
        // FK children of runs and must go first.
        await projectDb.adapter.run('DELETE FROM artifacts');
        await projectDb.adapter.run('DELETE FROM runs');
    });

    function setup(workdir: string, runId: string = RUN_ID) {
        return createOrAttachInlineRun({
            workdir,
            getDb: async () => projectDb.adapter,
            file: DEFINITION,
            runId,
        });
    }

    async function rowById(runId: string): Promise<Row> {
        const row = await projectDb.adapter.queryFirst<Row>(
            `SELECT id, workflow_name, mode, status, metadata_json FROM runs WHERE id = ?`,
            [runId],
        );
        expect(row).not.toBeNull();
        return row as unknown as Row;
    }

    test('AC1: setup creates the authoritative row, and bound run.artifact record then ACCEPTS the inline run', async () => {
        const p = makeProject(WORKFLOW_V1);
        try {
            const res = await setup(p.workdir);
            expect(res.ok).toBe(true);
            if (!res.ok) return;
            expect(res.attached).toBe(false);
            expect(res.status).toBe('running');
            expect(res.layer).toBe('project');
            expect(res.workflowName).toBe('inline-smoke');
            expect(res.definitionDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
            expect(res.resolvedPath).toBe(p.definitionPath);

            const row = await rowById(RUN_ID);
            expect(row.workflow_name).toBe('inline-smoke');
            expect(row.mode).toBe('state-machine');
            expect(row.status).toBe('running');
            const metadata = JSON.parse(row.metadata_json) as {
                definitionDigest?: string;
                workflowVersion?: string | null;
                definitionSource?: { path?: string; layer?: string; workdir?: string };
            };
            expect(metadata.definitionDigest).toBe(res.definitionDigest);
            expect(metadata.definitionSource).toMatchObject({ layer: 'project', workdir: p.workdir });

            // The bound-record half of AC1: record the verdict against the row the SETUP
            // path created — no hand-inserted row, and the vars are exactly what the
            // driver derives from the setup result plus a fresh capture.
            const digest = await computeProofInputFingerprint({ cwd: p.workdir, taskContent: p.specContent });
            const verdictPath = join(p.workdir, '.spur', 'run', `${WBS}-verdict.json`);
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
                        definitionDigest: res.definitionDigest,
                        capturePoint: 'quality-gate-entry',
                        stages: {
                            qualityGate: { status: 'PASS', digest },
                            review: { status: 'completed', digest },
                            verification: { status: 'PASS', digest },
                        },
                    },
                }),
            );
            writeFileSync(join(p.workdir, '.spur', 'run', `${RUN_ID}-review-proof.digest`), digest);

            const runner = new RunArtifactActionRunner(
                async () => projectDb.adapter,
                createNodeFileSystem(),
                new ArtifactDao(projectDb.adapter),
            );
            const record = await runner.execute(
                {
                    path: `.spur/run/${WBS}-verdict.json`,
                    artifactKind: 'verify-verdict',
                    proofBinding: 'current',
                    taskFile: p.specPath,
                    featureFile: '',
                },
                {
                    runId: RUN_ID,
                    stateOrNodeId: 'record',
                    workdir: p.workdir,
                    vars: { proofDigest: digest, wbs: WBS },
                    env: {},
                },
            );
            expect(record.ok).toBe(true);
            const artifacts = await new ArtifactDao(projectDb.adapter).artifactsByRunId(RUN_ID);
            expect(artifacts).toHaveLength(1);
            expect(artifacts[0]?.kind).toBe('verify-verdict');
        } finally {
            p.cleanup();
        }
    });

    test('identical resume is idempotent: attaches without duplicating the row', async () => {
        const p = makeProject(WORKFLOW_V1);
        try {
            expect((await setup(p.workdir)).ok).toBe(true);
            const second = await setup(p.workdir);
            expect(second).toMatchObject({ ok: true, attached: true, runId: RUN_ID });
            const count = await projectDb.adapter.queryFirst<{ n: number }>(
                `SELECT COUNT(*) AS n FROM runs WHERE id = ?`,
                [RUN_ID],
            );
            expect(Number(count?.n)).toBe(1);
        } finally {
            p.cleanup();
        }
    });

    test('a changed definition refuses instead of silently re-attaching (explicit resume rules own changes)', async () => {
        const p = makeProject(WORKFLOW_V1);
        try {
            const first = await setup(p.workdir);
            expect(first.ok).toBe(true);
            writeFileSync(p.definitionPath, WORKFLOW_V2);
            const second = await setup(p.workdir);
            expect(second.ok).toBe(false);
            if (second.ok) return;
            expect(second.error).toContain('changed definition must resume through the explicit resume rules');
            // Refusal leaves the row untouched.
            const row = await rowById(RUN_ID);
            const metadata = JSON.parse(row.metadata_json) as { definitionDigest?: string };
            expect(metadata.definitionDigest).toBe(first.ok ? first.definitionDigest : undefined);
        } finally {
            p.cleanup();
        }
    });

    test('an explicit resume digest matching the resolved definition attaches (same precedence as run.artifact)', async () => {
        const p = makeProject(WORKFLOW_V1);
        try {
            expect((await setup(p.workdir)).ok).toBe(true);
            // The definition changes; the explicit resume rules (0768) stamp the new
            // digest into resumeDefinitionDigest — setup must then attach to V2.
            writeFileSync(p.definitionPath, WORKFLOW_V2);
            const probed = await setup(p.workdir, `${RUN_ID}-v2`);
            expect(probed.ok).toBe(true);
            if (!probed.ok) return;
            await projectDb.adapter.run(
                `UPDATE runs SET metadata_json = json_set(metadata_json, '$.resumeDefinitionDigest', ?) WHERE id = ?`,
                [probed.definitionDigest, RUN_ID],
            );
            const afterResume = await setup(p.workdir);
            expect(afterResume).toMatchObject({ ok: true, attached: true, runId: RUN_ID });
        } finally {
            p.cleanup();
        }
    });

    test('a run id owned by a different workflow refuses (conflicting run identity)', async () => {
        const p1 = makeProject(WORKFLOW_V1);
        // Renaming the workflow necessarily changes the canonical digest (the digest
        // covers the parsed definition, name included), so the digest check fires before
        // the workflow-name hardening check — this asserts the observable refusal.
        const p2 = makeProject(WORKFLOW_V1.replace('name: inline-smoke', 'name: inline-smoke-b'));
        try {
            expect((await setup(p1.workdir)).ok).toBe(true);
            const second = await setup(p2.workdir);
            expect(second.ok).toBe(false);
            if (second.ok) return;
            expect(second.error).toContain('does not match the run');
        } finally {
            p1.cleanup();
            p2.cleanup();
        }
    });

    test('a run id owned by a different project/workdir refuses (conflicting project identity)', async () => {
        const p1 = makeProject(WORKFLOW_V1);
        const p2 = makeProject(WORKFLOW_V1);
        try {
            expect((await setup(p1.workdir)).ok).toBe(true);
            const second = await setup(p2.workdir);
            expect(second.ok).toBe(false);
            if (second.ok) return;
            expect(second.error).toContain('conflicting project/workdir identity');
        } finally {
            p1.cleanup();
            p2.cleanup();
        }
    });

    test('a row with malformed metadata_json refuses (identity cannot be verified)', async () => {
        const p = makeProject(WORKFLOW_V1);
        try {
            expect((await setup(p.workdir)).ok).toBe(true);
            await projectDb.adapter.run(`UPDATE runs SET metadata_json = 'not-json' WHERE id = ?`, [RUN_ID]);
            const second = await setup(p.workdir);
            expect(second.ok).toBe(false);
            if (second.ok) return;
            expect(second.error).toContain('malformed metadata_json');
        } finally {
            p.cleanup();
        }
    });

    test('a pre-identity legacy row (no digest) refuses instead of attaching an unverifiable identity', async () => {
        const p = makeProject(WORKFLOW_V1);
        try {
            expect((await setup(p.workdir)).ok).toBe(true);
            await projectDb.adapter.run(`UPDATE runs SET metadata_json = '{}' WHERE id = ?`, [RUN_ID]);
            const second = await setup(p.workdir);
            expect(second.ok).toBe(false);
            if (second.ok) return;
            expect(second.error).toContain('carries no definition digest');
        } finally {
            p.cleanup();
        }
    });

    test('an empty runId refuses without touching the database', async () => {
        const res = await createOrAttachInlineRun({
            workdir: base,
            getDb: async () => projectDb.adapter,
            file: DEFINITION,
            runId: '   ',
        });
        expect(res).toMatchObject({ ok: false });
    });

    /** Adapter wrapper whose engine `INSERT INTO runs` fails before the write, or right after it. */
    function insertFailingAdapter(adapter: InlineRunProjectDb['adapter'], mode: 'before' | 'after') {
        return {
            db: adapter.db,
            exec: (sql: string) => adapter.exec(sql),
            run: async (sql: string, ...params: unknown[]) => {
                if (sql.includes('INSERT INTO runs')) {
                    if (mode === 'before') throw new Error(`injected ${mode}-insert failure`);
                    await adapter.run(sql, ...params);
                    throw new Error(`injected ${mode}-insert failure`);
                }
                return adapter.run(sql, ...params);
            },
            queryFirst: <T>(sql: string, ...params: unknown[]) => adapter.queryFirst<T>(sql, ...params),
            queryAll: <T>(sql: string, ...params: unknown[]) => adapter.queryAll<T>(sql, ...params),
            batch: (operations: Parameters<InlineRunProjectDb['adapter']['batch']>[0]) => adapter.batch(operations),
            close: () => adapter.close(),
        };
    }

    test('AC1 (0809 R1): an interruption right after the initial insert leaves a fully identified row', async () => {
        const p = makeProject(WORKFLOW_V1);
        try {
            // An insertion failure fails closed by THROWING (the delegate's main().catch turns
            // it into the exit-1 failure path) — never by resolving a synthetic outcome.
            let thrown: unknown;
            try {
                await createOrAttachInlineRun({
                    workdir: p.workdir,
                    getDb: async () => insertFailingAdapter(projectDb.adapter, 'after'),
                    file: DEFINITION,
                    runId: `${RUN_ID}-atomic`,
                });
            } catch (error) {
                thrown = error;
            }
            expect((thrown as Error).message).toContain('injected after-insert failure');

            // The durable row already carries the COMPLETE launch identity — canonical
            // digest, explicit null version (unversioned workflow) and the full source.
            const row = await projectDb.adapter.queryFirst<Row>(
                `SELECT id, workflow_name, mode, status, metadata_json FROM runs WHERE id = ?`,
                [`${RUN_ID}-atomic`],
            );
            expect(row == null).toBe(false);
            const metadata = JSON.parse(row?.metadata_json ?? '') as {
                definitionDigest?: string;
                workflowVersion?: string | null;
                definitionSource?: { path?: string; layer?: string; workdir?: string };
            };
            expect(metadata.definitionDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
            expect(metadata.workflowVersion).toBeNull();
            expect(metadata.definitionSource).toMatchObject({
                path: p.definitionPath,
                layer: 'project',
                workdir: p.workdir,
            });
            expect(row?.status).toBe('running');

            // Retry after the interruption attaches the SAME identity — idempotent, no duplicate.
            const retry = await setup(p.workdir, `${RUN_ID}-atomic`);
            expect(retry).toMatchObject({ ok: true, attached: true, runId: `${RUN_ID}-atomic` });
            const count = await projectDb.adapter.queryFirst<{ n: number }>(
                `SELECT COUNT(*) AS n FROM runs WHERE id = ?`,
                [`${RUN_ID}-atomic`],
            );
            expect(Number(count?.n)).toBe(1);
        } finally {
            p.cleanup();
        }
    });

    test('AC1 (0809 R1): an insert failure before the write leaves no row at all', async () => {
        const p = makeProject(WORKFLOW_V1);
        try {
            let thrown: unknown;
            try {
                await createOrAttachInlineRun({
                    workdir: p.workdir,
                    getDb: async () => insertFailingAdapter(projectDb.adapter, 'before'),
                    file: DEFINITION,
                    runId: `${RUN_ID}-norow`,
                });
            } catch (error) {
                thrown = error;
            }
            expect((thrown as Error).message).toContain('injected before-insert failure');
            const row = await projectDb.adapter.queryFirst<{ id: string }>(`SELECT id FROM runs WHERE id = ?`, [
                `${RUN_ID}-norow`,
            ]);
            expect(row == null).toBe(true);
        } finally {
            p.cleanup();
        }
    });

    test('AC4 (0809 R4): a tracked workflow edit before capture changes the input fingerprint, not the launch identity — A-proof binds, B-proof refuses', async () => {
        // The fixture tracks the workflow (ignore only .spur/run/ + the spec) so editing the
        // definition YAML is a Git-visible input change.
        const p = makeProject(WORKFLOW_V1, '.spur/run/\nspec.md\n');
        try {
            const res = await setup(p.workdir);
            expect(res.ok).toBe(true);
            const identityA = res.ok ? res.definitionDigest : '';
            const digestBefore = await computeProofInputFingerprint({ cwd: p.workdir, taskContent: p.specContent });

            // Source-only edit of tracked YAML BEFORE quality-gate capture: the fresh input
            // fingerprint changes, the frozen launch identity does not, and no resume stamp
            // is manufactured.
            writeFileSync(p.definitionPath, WORKFLOW_V2);
            const digestFresh = await computeProofInputFingerprint({ cwd: p.workdir, taskContent: p.specContent });
            expect(digestFresh).not.toBe(digestBefore);
            const identityB = (await resolveWorkflowDefinition(p.workdir, DEFINITION, { validateSchema: true })).digest;
            expect(identityB).not.toBe(identityA);

            const runner = new RunArtifactActionRunner(
                async () => projectDb.adapter,
                createNodeFileSystem(),
                new ArtifactDao(projectDb.adapter),
            );
            const verdictBody = (proofDefinitionDigest: string) =>
                JSON.stringify({
                    wbs: WBS,
                    verdict: 'PASS',
                    requirements: [],
                    acceptanceCriteria: [],
                    proof: {
                        digest: digestFresh,
                        runId: RUN_ID,
                        definitionDigest: proofDefinitionDigest,
                        capturePoint: 'quality-gate-entry',
                        stages: {
                            qualityGate: { status: 'PASS', digest: digestFresh },
                            review: { status: 'completed', digest: digestFresh },
                            verification: { status: 'PASS', digest: digestFresh },
                        },
                    },
                });
            const verdictPath = join(p.workdir, '.spur', 'run', `${WBS}-verdict.json`);

            // Fresh proof carrying the changed input fingerprint plus A's setup identity — binds.
            writeFileSync(verdictPath, verdictBody(identityA));
            writeFileSync(join(p.workdir, '.spur', 'run', `${RUN_ID}-review-proof.digest`), digestFresh);
            const record = await runner.execute(
                {
                    path: `.spur/run/${WBS}-verdict.json`,
                    artifactKind: 'verify-verdict',
                    proofBinding: 'current',
                    taskFile: p.specPath,
                    featureFile: '',
                },
                {
                    runId: RUN_ID,
                    stateOrNodeId: 'record',
                    workdir: p.workdir,
                    vars: { proofDigest: digestFresh, wbs: WBS },
                    env: {},
                },
            );
            expect(record.ok).toBe(true);
            const metadata = JSON.parse((await rowById(RUN_ID)).metadata_json) as { resumeDefinitionDigest?: unknown };
            expect(metadata.resumeDefinitionDigest).toBeUndefined();
            expect(await new ArtifactDao(projectDb.adapter).artifactsByRunId(RUN_ID)).toHaveLength(1);

            // A forged artifact claiming the on-disk B identity against the A row refuses.
            writeFileSync(verdictPath, verdictBody(identityB));
            const forged = await runner.execute(
                {
                    path: `.spur/run/${WBS}-verdict.json`,
                    artifactKind: 'verify-verdict',
                    proofBinding: 'current',
                    taskFile: p.specPath,
                    featureFile: '',
                },
                {
                    runId: RUN_ID,
                    stateOrNodeId: 'record',
                    workdir: p.workdir,
                    vars: { proofDigest: digestFresh, wbs: WBS },
                    env: {},
                },
            );
            expect(forged.ok).toBe(false);
            if (forged.ok) return;
            expect(forged.error).toContain('stale-definition artifact cannot certify this run');
            expect(await new ArtifactDao(projectDb.adapter).artifactsByRunId(RUN_ID)).toHaveLength(1);
        } finally {
            p.cleanup();
        }
    });

    test('an unresolvable workflow refuses with the resolver error (no row is created)', async () => {
        const res = await createOrAttachInlineRun({
            workdir: base,
            getDb: async () => projectDb.adapter,
            file: 'no-such-workflow',
            runId: 'run-inline-0804-missing',
        });
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.error).toContain('could not resolve the workflow definition');
        const row = await projectDb.adapter.queryFirst<{ id: string }>(`SELECT id FROM runs WHERE id = ?`, [
            'run-inline-0804-missing',
        ]);
        // queryFirst returns undefined for no row (SQLite null → undefined, @gobing-ai/ts-db 0.4.62).
        expect(row).toBeUndefined();
    });
});
