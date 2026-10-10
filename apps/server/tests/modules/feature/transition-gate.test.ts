// Task 1137 R2 / R5(c)(d)(e) — the server feature.transition gate. The generic
// HTTP `feature.transition` handler and the 1132 task→feature reopen hook both
// route through `ctx.transitionFeature` → `transitionFeatureGuarded`, so an
// unguarded `PlanningWriteService` (no lifecycle adapter) can no longer apply a
// lifecycle-invalid status over oRPC. Denials throw GuardDeniedError, which the
// error handler maps to HTTP 409 GUARD_DENIED (covered by middleware tests).
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    captureFeatureReceiptDigest,
    completeFeatureVerificationReceipt,
    DEFAULT_FEATURE_VERIFICATION_CMD,
    featureReceiptPaths,
    GuardDeniedError,
    resolveWorkflowDefinition,
    type SectionMatrix,
    startFeatureVerificationReceipt,
} from '@gobing-ai/spur-app';
import { ArtifactDao } from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { createServerContext, type ServerContext } from '../../../src/context';
import { createFeatureHandlers } from '../../../src/modules/feature';
import { mockRuntime } from '../../middleware/helpers';

/** Minimal task matrix (mirrors the 1132 server guard test): task create validates against it. */
const MATRIX: SectionMatrix = {
    variants: {
        'feature-impl': {
            backlog: { required: ['Background'], optional: ['Requirements', 'Acceptance Criteria', 'Design', 'Plan'] },
            todo: { required: ['Background', 'Acceptance Criteria', 'Design', 'Plan'] },
        },
    },
};

const FEATURE = (id: string, status: string): string =>
    [
        '---',
        'schema_version: 1',
        `id: ${id}`,
        `name: Feature ${id}`,
        `status: ${status}`,
        'created_at: 2026-10-01T00:00:00Z',
        'updated_at: 2026-10-01T00:00:00Z',
        '---',
        `# ${id} Feature ${id}`,
        '## Goal',
        'g',
        '## Scope',
        's',
        '## Acceptance Criteria',
        'ac',
        '## Tasks',
        '',
    ].join('\n');

/**
 * Strict-clean feature fixture: every static lifecycle check passes, so only the
 * D63 completion receipt can deny the verifying → done hop.
 */
const CLEAN_FEATURE = (id: string, status: string): string =>
    [
        '---',
        'schema_version: 1',
        `id: ${id}`,
        `name: Feature ${id}`,
        `status: ${status}`,
        'created_at: 2026-10-01T00:00:00Z',
        'updated_at: 2026-10-01T00:00:00Z',
        '---',
        `# ${id} Feature ${id}`,
        '## Goal',
        'goal body',
        '## Scope',
        'In: guarded transitions',
        'Out: everything else',
        '## Acceptance Criteria',
        '- [ ] a strict-clean checklist item',
        '## Tasks',
        '',
    ].join('\n');

/** Hermetic synthetic project; dir names deliberately avoid the real corpus layout. */
function makeCtx(features: Record<string, string>, content: (id: string, status: string) => string = FEATURE) {
    const root = mkdtempSync(join(tmpdir(), 'spur-1137-server-'));
    const tasksDir = join(root, 'spur-feat-gate', 'tasks');
    const featuresDir = join(root, 'spur-feat-gate', 'features');
    mkdirSync(tasksDir, { recursive: true });
    mkdirSync(featuresDir, { recursive: true });
    for (const [id, status] of Object.entries(features)) {
        writeFileSync(join(featuresDir, `${id}_feature.md`), content(id, status));
    }
    const ctx = createServerContext(mockRuntime(), {
        cwd: root,
        fs: createNodeFileSystem(root),
        dbUrl: ':memory:',
        sectionMatrix: MATRIX,
        folders: {
            tasksDir,
            featuresDir,
            foldersConfig: { active_folder: tasksDir, folders: { [tasksDir]: { baseCounter: 0 } } },
        },
    });
    return {
        ctx,
        root,
        featuresDir,
        featurePath: (id: string) => join(featuresDir, `${id}_feature.md`),
        cleanup: () => rmSync(root, { recursive: true, force: true }),
    };
}

/**
 * Record a current PASS receipt backed by a terminal run row + registered
 * artifact, exactly as the production verification pass would (D63 task 0915).
 * The guard's in-process check captures its digest against the PROCESS cwd, so
 * the fixture mirrors that while the receipt itself lives under the project's
 * run dir and the server's own DB holds the recording run.
 */
async function recordServerReceipt(
    ctx: ServerContext,
    root: string,
    featureFile: string,
    featureId: string,
): Promise<void> {
    const fs = createNodeFileSystem();
    const raw = readFileSync(featureFile, 'utf8');
    let learnings: string | undefined;
    try {
        learnings = readFileSync(join(process.cwd(), '.spur', 'context', 'learnings.md'), 'utf8');
    } catch {
        learnings = undefined;
    }
    const inputDigest = await captureFeatureReceiptDigest(process.cwd(), raw, learnings);
    const selected = await resolveWorkflowDefinition(process.cwd(), 'feature-verification');
    const vars = selected.workflow.vars as { verificationCmd?: unknown } | undefined;
    const verificationCmd =
        typeof vars?.verificationCmd === 'string' && vars.verificationCmd.length > 0
            ? vars.verificationCmd
            : DEFAULT_FEATURE_VERIFICATION_CMD;
    const runId = `run-${featureId.toLowerCase()}`;
    const running = await startFeatureVerificationReceipt(fs, ctx.runDir, {
        featureId,
        runId,
        workdir: root,
        verifier: {
            name: 'feature-verification',
            sourcePath: selected.path,
            layer: selected.layer,
            definitionDigest: selected.digest,
        },
        verificationCmd,
        inputDigest,
    });
    await completeFeatureVerificationReceipt(fs, ctx.runDir, running, { status: 'PASS', inputDigest });
    // Run-store mirror: the wired run port refuses a receipt whose run row is
    // absent or not terminal, so the fixture records what the engine would.
    const db = await ctx.getDb();
    const now = Date.now();
    await db.run(
        'INSERT OR REPLACE INTO runs (id, workflow_name, mode, status, started_at, completed_at, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
            runId,
            'feature-verification',
            'state-machine',
            'done',
            now,
            now,
            JSON.stringify({ definitionDigest: selected.digest }),
            now,
            now,
        ],
    );
    await new ArtifactDao(db).record({
        runId,
        path: featureReceiptPaths(ctx.runDir, featureId, runId).runScoped,
        kind: 'feature-verification',
    });
}

describe('server feature.transition guard (task 1137 R2)', () => {
    test('AC3 — active → verifying is denied (409-mapped GuardDeniedError) and the file is unchanged', async () => {
        const { ctx, featurePath, cleanup } = makeCtx({ F9: 'active' });
        try {
            const before = readFileSync(featurePath('F9'), 'utf8');
            await expect(ctx.transitionFeature({ id: 'F9', to: 'verifying' })).rejects.toThrow(GuardDeniedError);
            expect(readFileSync(featurePath('F9'), 'utf8')).toBe(before);
        } finally {
            cleanup();
        }
    });

    test('AC4 — an undeclared edge (backlog → done) is denied, naming the edge', async () => {
        const { ctx, featurePath, cleanup } = makeCtx({ F9: 'backlog' });
        try {
            const before = readFileSync(featurePath('F9'), 'utf8');
            await expect(ctx.transitionFeature({ id: 'F9', to: 'done' })).rejects.toThrow(GuardDeniedError);
            await expect(ctx.transitionFeature({ id: 'F9', to: 'done' })).rejects.toThrow(
                /undeclared edge backlog → done/,
            );
            expect(readFileSync(featurePath('F9'), 'utf8')).toBe(before);
        } finally {
            cleanup();
        }
    });

    test('AC4 — entering verifying over HTTP is refused with the CLI recovery message', async () => {
        const { ctx, cleanup } = makeCtx({ F9: 'active' });
        try {
            await expect(ctx.transitionFeature({ id: 'F9', to: 'verifying' })).rejects.toThrow(
                'entering `verifying` runs feature verification; use `spur feature update F9 verifying` from the CLI',
            );
        } finally {
            cleanup();
        }
    });

    test('P2 remediation — a receipt-less verifying → done over the server path is denied', async () => {
        // Strict-clean: without wiring runDir + the run-store port, the D63 receipt
        // gate never fires and this hop would commit unguarded.
        const { ctx, featurePath, cleanup } = makeCtx({ F9: 'verifying' }, CLEAN_FEATURE);
        try {
            const before = readFileSync(featurePath('F9'), 'utf8');
            await expect(ctx.transitionFeature({ id: 'F9', to: 'done' })).rejects.toThrow(GuardDeniedError);
            await expect(ctx.transitionFeature({ id: 'F9', to: 'done' })).rejects.toThrow(
                /completion evidence rejected/,
            );
            expect(readFileSync(featurePath('F9'), 'utf8')).toBe(before);
        } finally {
            cleanup();
        }
    });

    test('P2 remediation — a current PASS receipt validates over the server path (runDir + run-store port wired)', async () => {
        const { ctx, root, featurePath, cleanup } = makeCtx({ F9: 'verifying' }, CLEAN_FEATURE);
        try {
            await recordServerReceipt(ctx, root, featurePath('F9'), 'F9');
            const result = await ctx.transitionFeature({ id: 'F9', to: 'done' });
            expect(result.toStatus).toBe('done');
            expect(readFileSync(featurePath('F9'), 'utf8')).toContain('status: done');
        } finally {
            cleanup();
        }
    });

    test('AC5 — the task→feature reopen hook still reopens verifying → active with one History line', async () => {
        const { ctx, featurePath, cleanup } = makeCtx({ F2: 'verifying' });
        try {
            const result = await ctx.taskService().create({
                title: 'server guarded reopen probe',
                featureId: 'F2',
                dedupeWithinSec: null,
            });
            expect(result.featureReopened).toEqual({ id: 'F2', from: 'verifying', to: 'active' });
            const after = readFileSync(featurePath('F2'), 'utf8');
            expect(after).toContain('status: active');
            expect(after.split('\n').filter((l) => /verifying → active/.test(l))).toHaveLength(1);
        } finally {
            cleanup();
        }
    });
});

describe('feature.transition handler routes through the guard', () => {
    test('the handler calls ctx.transitionFeature, not featureService().transition', async () => {
        const calls: Array<{ id: string; to: string; actor?: string }> = [];
        const ctx = {
            featureService: () => ({
                transition: async () => {
                    throw new Error('unguarded path must not be used');
                },
            }),
            transitionFeature: async (input: { id: string; to: string; actor?: string }) => {
                calls.push(input);
                return { ref: { id: input.id, filePath: '/x', kind: 'feature' as const, folder: '.' } };
            },
        } as unknown as ServerContext;
        const handlers = createFeatureHandlers(ctx);
        const fn = handlers.transition['~orpc'].handler as unknown as (opts: {
            input: { id: string; toStatus: string; actor?: string };
        }) => Promise<{ ok: boolean; data: { id: string; status: string } }>;
        const result = await fn({ input: { id: 'F9', toStatus: 'active', actor: 'tester' } });
        expect(result.ok).toBe(true);
        expect(calls).toEqual([{ id: 'F9', to: 'active', actor: 'tester' }]);
    });
});
