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
    function makeProject(workflowBody: string): {
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
        writeFileSync(join(workdir, '.gitignore'), '.spur/\nspec.md\n');
        writeFileSync(join(workdir, 'README.md'), 'tracked\n');
        writeFileSync(definitionPath, workflowBody);
        execSync('git init -q && git config user.email t@example.com && git config user.name t', { cwd: workdir });
        execSync('git add -A && git commit -qm init', { cwd: workdir });
        const specContent = '---\nwbs: t9002\n---\n\n### Requirements\n- [ ] R1. authoritative inline identity\n';
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
        // queryFirst surfaces a missing row as null (despite its `T | undefined` type).
        expect(row == null).toBe(true);
    });
});
