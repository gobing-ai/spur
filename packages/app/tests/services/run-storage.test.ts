import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { applyCliMigrations } from '@gobing-ai/spur-domain';
import { createDbAdapter } from '@gobing-ai/ts-db';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { computeAggregate, readVerdictArtifact } from '../../src/services/done-transition-guard';
import { runLightGate } from '../../src/services/quality-gate';
import {
    ensureDurablePlaneIgnored,
    type MigrateRunStorageInput,
    migrateRunStorage,
    type RunStorageMigrationEntry,
    resolveRunRecordDir,
    runArtifactsDir,
    runSessionsDir,
    runStoragePaths,
} from '../../src/services/run-storage';
import { deriveVerifiedOutcome } from '../../src/services/verified-outcome';
import { readWorkflowRunRecord } from '../../src/workflow/run-record';

/** The gate tees its PASS line to stdout; mute it so test runners show no leaked gate output. */
function silenceStdout<T>(run: () => T): T {
    const originalWrite = process.stdout.write;
    process.stdout.write = () => true;
    try {
        return run();
    } finally {
        process.stdout.write = originalWrite;
    }
}

test('run storage root never latches onto the shared OS temp dir, marker or not', () => {
    const root = mkdtempSync(join(tmpdir(), 'run-storage-tmpguard-'));
    const sharedSpur = join(tmpdir(), '.spur');
    const created = !existsSync(sharedSpur);
    try {
        if (created) mkdirSync(sharedSpur, { recursive: true });
        // With the marker present, the walk must still refuse tmpdir() as project root:
        // otherwise every unmarked temp project re-roots to the shared dir (CI: /tmp).
        expect(runStoragePaths(root).projectRoot).toBe(root);
    } finally {
        if (created) rmSync(sharedSpur, { recursive: true, force: true });
        rmSync(root, { recursive: true, force: true });
    }
});

/** Temp project root with a `.spur/run` scratch plane; package.json pins the project-root walk. */
function makeProject(): { root: string; scratch: string; dirs: ReturnType<typeof runStoragePaths> } {
    const root = mkdtempSync(join(tmpdir(), 'run-storage-'));
    writeFileSync(join(root, 'package.json'), '{ "name": "run-storage-fixture" }\n');
    const scratch = join(root, '.spur', 'run');
    mkdirSync(scratch, { recursive: true });
    return { root, scratch, dirs: runStoragePaths(root) };
}

function statusMap(rows: Record<string, string>): MigrateRunStorageInput['readRunStatus'] {
    return async (runId) => rows[runId] ?? null;
}

function outcome(result: { entries: RunStorageMigrationEntry[] }, identity: string): RunStorageMigrationEntry {
    const entry = result.entries.find((e) => e.identity === identity);
    if (entry === undefined) throw new Error(`no entry for ${identity}: ${JSON.stringify(result.entries)}`);
    return entry;
}

function receipt(featureId: string, runId: string, workdir: string) {
    return {
        schemaVersion: 1,
        featureId,
        runId,
        workdir,
        verifier: {
            name: 'feature-verification',
            sourcePath: ['config', 'workflows', 'feature-verification.yaml'].join('/'),
            layer: 'project',
            definitionDigest: `sha256:${'a'.repeat(64)}`,
        },
        verificationCmd: 'bun test',
        inputDigest: `sha256:${'b'.repeat(64)}`,
        status: 'PASS',
        startedAt: '2026-10-01T00:00:00Z',
        completedAt: '2026-10-01T00:01:00Z',
    };
}

describe('migrateRunStorage (E71/1025)', () => {
    test('a linked owned session subtree is preserved without copying its target', async () => {
        const { root, scratch, dirs } = makeProject();
        const outside = mkdtempSync(join(tmpdir(), 'run-storage-linked-sessions-'));
        try {
            const subtree = join(scratch, 'closed');
            mkdirSync(subtree);
            writeFileSync(join(outside, 'session.jsonl'), 'unsettled session');
            symlinkSync(outside, join(subtree, 'agent-sessions'));
            const result = await migrateRunStorage({ dirs, readRunStatus: statusMap({ closed: 'done' }) });
            expect(result.failures).toEqual([]);
            expect(outcome(result, 'closed')).toMatchObject({
                outcome: 'preserved',
                reason: 'symlink-owned-subtree',
                target: null,
            });
            expect(readFileSync(join(outside, 'session.jsonl'), 'utf8')).toBe('unsettled session');
            expect(existsSync(join(dirs.recordsDir, 'closed/agent-sessions/session.jsonl'))).toBe(false);
            expect(
                JSON.parse(readFileSync(join(root, '.spur/memory/run-storage-migration.json'), 'utf8')).complete,
            ).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
            rmSync(outside, { recursive: true, force: true });
        }
    });

    test('foreign verdict and state identities fail; proof and feature receipt live owners remain protected', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            writeFileSync(join(scratch, '1025-verdict.json'), JSON.stringify({ wbs: '9999', verdict: 'PASS' }));
            writeFileSync(join(scratch, 'closed.md'), 'record');
            writeFileSync(join(scratch, 'closed.state.json'), '{"runId":"foreign"}');
            writeFileSync(join(scratch, 'E71-feature-verification.json'), JSON.stringify(receipt('E71', 'live', root)));
            writeFileSync(
                join(scratch, '1026-verdict.json'),
                JSON.stringify({ wbs: '1026', verdict: 'PASS', proof: { runId: 'live' } }),
            );
            const result = await migrateRunStorage({
                dirs,
                readRunStatus: statusMap({ closed: 'done', live: 'paused' }),
            });
            expect(outcome(result, '1025').outcome).toBe('failed');
            expect(outcome(result, 'closed').outcome).toBe('failed');
            expect(outcome(result, 'E71').outcome).toBe('preserved');
            expect(outcome(result, '1026').outcome).toBe('preserved');
            expect(existsSync(join(dirs.recordsDir, 'closed.state.json'))).toBe(false);
            const manifest = JSON.parse(readFileSync(join(root, '.spur/memory/run-storage-migration.json'), 'utf8'));
            expect(manifest.complete).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('registered generic output requires reference ownership and redirects only after byte publication', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            const path = join(scratch, 'handoff.txt');
            writeFileSync(path, 'retained');
            const input = {
                dirs,
                readRunStatus: statusMap({ closed: 'done' }),
                registeredArtifacts: [{ path, runId: 'closed' }],
            };
            const refused = await migrateRunStorage(input);
            expect(refused.failures[0]?.reason).toContain('reference owner unavailable');
            expect(existsSync(join(dirs.recordsDir, 'closed/artifacts/handoff.txt'))).toBe(false);
            let redirected = false;
            const applied = await migrateRunStorage({
                ...input,
                redirectReferences: async (entries) => {
                    const entry = entries.find((entry) => entry.source === path);
                    expect(readFileSync(entry?.target as string, 'utf8')).toBe('retained');
                    redirected = true;
                },
            });
            expect(applied.failures).toEqual([]);
            expect(redirected).toBe(true);
            const failed = await migrateRunStorage({
                ...input,
                redirectReferences: async () => {
                    throw new Error('owner refused');
                },
            });
            expect(failed.failures[0]?.reason).toContain('reference-redirect');
            expect(readFileSync(path, 'utf8')).toBe('retained');
            expect(
                JSON.parse(readFileSync(join(root, '.spur/memory/run-storage-migration.json'), 'utf8')).complete,
            ).toBe(false);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('dry-run reports would-migrate and writes nothing', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            writeFileSync(join(scratch, '1025-verdict.json'), JSON.stringify({ verdict: 'PASS' }));
            const result = await migrateRunStorage({ dirs, readRunStatus: statusMap({}), dryRun: true });
            const entry = outcome(result, '1025');
            expect(entry.outcome).toBe('would-migrate');
            expect(existsSync(entry.target as string)).toBeFalse();
            expect(existsSync(join(scratch, '1025-verdict.json'))).toBeTrue();
            expect(existsSync(join(root, '.spur', 'memory', 'run-storage-migration.json'))).toBeFalse();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('applied migration copies atomically and is idempotent', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            writeFileSync(join(scratch, '1025-verdict.json'), JSON.stringify({ verdict: 'PASS' }));
            const first = await migrateRunStorage({ dirs, readRunStatus: statusMap({}), dryRun: false });
            const target = outcome(first, '1025').target as string;
            expect(outcome(first, '1025').outcome).toBe('migrated');
            expect(readFileSync(target, 'utf8')).toBe(JSON.stringify({ verdict: 'PASS' }));
            expect(existsSync(join(scratch, '1025-verdict.json'))).toBeTrue();
            const manifest = JSON.parse(
                readFileSync(join(root, '.spur', 'memory', 'run-storage-migration.json'), 'utf8'),
            );
            expect(manifest.version).toBe(1);
            const second = await migrateRunStorage({ dirs, readRunStatus: statusMap({}), dryRun: false });
            expect(outcome(second, '1025').outcome).toBe('already-present');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('existing target with different bytes fails closed and never overwrites', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            writeFileSync(join(scratch, '1025-verdict.json'), JSON.stringify({ verdict: 'PASS' }));
            const target = join(root, '.spur', 'memory', 'evidence', '1025-verdict.json');
            mkdirSync(join(root, '.spur', 'memory', 'evidence'), { recursive: true });
            writeFileSync(target, 'not valid json');
            const result = await migrateRunStorage({ dirs, readRunStatus: statusMap({}), dryRun: false });
            expect(outcome(result, '1025').outcome).toBe('failed');
            expect(result.failures.length).toBeGreaterThan(0);
            expect(result.failures[0]?.reason).toBe('target-mismatch');
            expect(result.failures[0]?.remedy).toBe('repair the durable file by hand');
            expect(readFileSync(target, 'utf8')).toBe('not valid json');
            const preview = await migrateRunStorage({ dirs, readRunStatus: statusMap({}), dryRun: true });
            expect(preview.failures[0]?.reason).toBe('target-mismatch');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('identical target behind a stale proof binding is already-present (F1/AC3)', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            const verdictContent = JSON.stringify({
                wbs: '1025',
                verdict: 'PASS',
                proof: { runId: 'stale-wrong-run-id' },
            });
            writeFileSync(join(scratch, '1025-verdict.json'), verdictContent);
            const target = join(root, '.spur', 'memory', 'evidence', '1025-verdict.json');
            mkdirSync(join(root, '.spur', 'memory', 'evidence'), { recursive: true });
            writeFileSync(target, verdictContent);
            const result = await migrateRunStorage({ dirs, readRunStatus: statusMap({}), dryRun: false });
            expect(outcome(result, '1025').outcome).toBe('already-present');
            expect(result.failures.length).toBe(0);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('valid durable target that differs is superseded and preserved (F2/AC3)', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            writeFileSync(join(scratch, '1025-verdict.json'), JSON.stringify({ wbs: '1025', verdict: 'PASS' }));
            const target = join(root, '.spur', 'memory', 'evidence', '1025-verdict.json');
            mkdirSync(join(root, '.spur', 'memory', 'evidence'), { recursive: true });
            writeFileSync(target, JSON.stringify({ wbs: '1025', verdict: 'FAIL' }));
            const result = await migrateRunStorage({ dirs, readRunStatus: statusMap({}), dryRun: false });
            expect(outcome(result, '1025').outcome).toBe('superseded');
            expect(outcome(result, '1025').reason).toBe('durable canonical');
            expect(result.failures.length).toBe(0);
            expect(readFileSync(target, 'utf8')).toBe(JSON.stringify({ wbs: '1025', verdict: 'FAIL' }));
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('unparseable or check-result-shaped verdict with no durable counterpart is preserved unclassified (F3/AC3)', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            const checkResultShape = JSON.stringify({ hasVerdict: true, verdictIsPass: true });
            writeFileSync(join(scratch, '2f720cbc-7e9f-40c2-98cf-af32ed9a01a6-verdict.json'), checkResultShape);
            const result = await migrateRunStorage({ dirs, readRunStatus: statusMap({}), dryRun: false });
            const entry = outcome(result, '2f720cbc-7e9f-40c2-98cf-af32ed9a01a6');
            expect(entry.outcome).toBe('preserved');
            expect(entry.reason).toContain('unclassified');
            expect(result.failures.length).toBe(0);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('run-record .md whose sibling exists in memory/runs is already-present (F4/AC3)', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            const runId = '201a166a-3e31-4c3b-a425-3b0d1316a489';
            writeFileSync(join(scratch, `${runId}.md`), '# Run 201a');
            const runsDir = join(root, '.spur', 'memory', 'runs');
            mkdirSync(runsDir, { recursive: true });
            writeFileSync(join(runsDir, `${runId}.md`), '# Run 201a');
            writeFileSync(join(runsDir, `${runId}.state.json`), JSON.stringify({ runId }));
            const result = await migrateRunStorage({
                dirs,
                readRunStatus: statusMap({ [runId]: 'done' }),
                dryRun: false,
            });
            expect(outcome(result, runId).outcome).toBe('already-present');
            expect(result.failures.length).toBe(0);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('valid durable receipt with different bytes is superseded, not failed (R3b)', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            writeFileSync(
                join(scratch, 'E71-feature-verification.json'),
                JSON.stringify(receipt('E71', 'run-a', root)),
            );
            const target = join(root, '.spur', 'memory', 'evidence', 'E71-feature-verification.json');
            mkdirSync(dirname(target), { recursive: true });
            // Durable copy is a valid receipt for the same feature, a *different* run — canonical.
            writeFileSync(target, JSON.stringify(receipt('E71', 'run-b', root)));
            const result = await migrateRunStorage({
                dirs,
                readRunStatus: statusMap({ 'run-a': 'done' }),
                dryRun: false,
            });
            const entry = result.entries.find((e) => e.family === 'feature-receipt' && e.identity === 'E71');
            expect(entry?.outcome).toBe('superseded');
            expect(entry?.reason).toBe('durable canonical');
            expect(result.failures.length).toBe(0);
            expect(JSON.parse(readFileSync(target, 'utf8')).runId).toBe('run-b');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('unparseable receipt with no durable copy is preserved unclassified (R3c)', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            writeFileSync(join(scratch, 'E71-feature-verification.json'), JSON.stringify({ featureId: 'E71' }));
            const result = await migrateRunStorage({ dirs, readRunStatus: statusMap({}), dryRun: false });
            const entry = result.entries.find((e) => e.family === 'feature-receipt');
            expect(entry?.outcome).toBe('preserved');
            expect(entry?.reason).toContain('unclassified');
            expect(result.failures.length).toBe(0);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('run-record pair with a valid but different durable pair is superseded (R3b)', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            writeFileSync(join(scratch, 'run-s.md'), 'scratch record');
            writeFileSync(join(scratch, 'run-s.state.json'), JSON.stringify({ runId: 'run-s' }));
            const runsDir = join(root, '.spur', 'memory', 'runs');
            mkdirSync(runsDir, { recursive: true });
            writeFileSync(join(runsDir, 'run-s.md'), 'durable record');
            writeFileSync(join(runsDir, 'run-s.state.json'), JSON.stringify({ runId: 'run-s' }));
            const result = await migrateRunStorage({
                dirs,
                readRunStatus: statusMap({ 'run-s': 'done' }),
                dryRun: false,
            });
            const entries = result.entries.filter((e) => e.identity === 'run-s');
            expect(entries.length).toBe(2);
            for (const entry of entries) expect(entry.outcome).toBe('superseded');
            expect(result.failures.length).toBe(0);
            expect(readFileSync(join(runsDir, 'run-s.md'), 'utf8')).toBe('durable record');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('an invalid proof owner binding whose durable copy is valid is superseded, not failed (R3b)', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            // Unsafe owner id (`bad/id`) — the owner gate cannot validate it, but the durable
            // verdict is a valid same-family member, so durable wins.
            writeFileSync(
                join(scratch, '1025-verdict.json'),
                JSON.stringify({ wbs: '1025', verdict: 'PASS', proof: { runId: 'bad/id' } }),
            );
            const target = join(root, '.spur', 'memory', 'evidence', '1025-verdict.json');
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, JSON.stringify({ wbs: '1025', verdict: 'FAIL' }));
            const result = await migrateRunStorage({ dirs, readRunStatus: statusMap({}), dryRun: false });
            expect(outcome(result, '1025').outcome).toBe('superseded');
            expect(result.failures.length).toBe(0);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('an invalid owner id with no durable copy fails with an owner-identity remedy (R3 failure set)', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            writeFileSync(
                join(scratch, '1025-verdict.json'),
                JSON.stringify({ wbs: '1025', verdict: 'PASS', proof: { runId: 'bad/id' } }),
            );
            const result = await migrateRunStorage({ dirs, readRunStatus: statusMap({}), dryRun: false });
            expect(outcome(result, '1025').outcome).toBe('failed');
            expect(result.failures[0]?.reason).toContain('owner identity');
            expect(result.failures[0]?.remedy).toBe('inspect source file and durable storage');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('a durable pair whose state.json is invalid leaves the scratch pair failed, not superseded (R3 failure set)', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            writeFileSync(join(scratch, 'run-b.md'), 'scratch record');
            writeFileSync(join(scratch, 'run-b.state.json'), JSON.stringify({ runId: 'run-b' }));
            const runsDir = join(root, '.spur', 'memory', 'runs');
            mkdirSync(runsDir, { recursive: true });
            writeFileSync(join(runsDir, 'run-b.md'), 'durable record');
            writeFileSync(join(runsDir, 'run-b.state.json'), JSON.stringify({ runId: 'OTHER' }));
            const result = await migrateRunStorage({
                dirs,
                readRunStatus: statusMap({ 'run-b': 'done' }),
                dryRun: false,
            });
            const entries = result.entries.filter((e) => e.identity === 'run-b');
            expect(entries.every((e) => e.outcome === 'failed')).toBe(true);
            expect(result.failures.every((f) => f.reason === 'target-mismatch')).toBe(true);
            expect(result.failures[0]?.remedy).toBe('repair the durable file by hand');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('a state.json whose runId is not the unit identity fails with the run-state reason (R3 failure set)', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            writeFileSync(join(scratch, 'run-c.md'), 'record body');
            writeFileSync(join(scratch, 'run-c.state.json'), JSON.stringify({ runId: 'foreign' }));
            const result = await migrateRunStorage({
                dirs,
                readRunStatus: statusMap({ 'run-c': 'done' }),
                dryRun: false,
            });
            expect(outcome(result, 'run-c').outcome).toBe('failed');
            expect(result.failures[0]?.reason).toContain('run-state identity or shape');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('a write-failed migration carries its remedy', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            writeFileSync(join(scratch, '1025-verdict.json'), JSON.stringify({ wbs: '1025', verdict: 'PASS' }));
            const result = await migrateRunStorage({
                dirs,
                readRunStatus: statusMap({}),
                dryRun: false,
                atomicCopy: () => {
                    throw new Error('disk full');
                },
            });
            expect(result.failures[0]?.reason).toBe('write-failed');
            expect(result.failures[0]?.remedy).toBe('check permissions/disk');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('an incomplete run-record pair whose differing .md and full durable pair exist is already-present (R3d)', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            writeFileSync(join(scratch, 'run-d.md'), 'scratch record');
            const runsDir = join(root, '.spur', 'memory', 'runs');
            mkdirSync(runsDir, { recursive: true });
            writeFileSync(join(runsDir, 'run-d.md'), 'durable record');
            writeFileSync(join(runsDir, 'run-d.state.json'), JSON.stringify({ runId: 'run-d' }));
            const result = await migrateRunStorage({
                dirs,
                readRunStatus: statusMap({ 'run-d': 'done' }),
                dryRun: false,
            });
            expect(outcome(result, 'run-d').outcome).toBe('already-present');
            expect(result.failures.length).toBe(0);
            expect(readFileSync(join(runsDir, 'run-d.md'), 'utf8')).toBe('durable record');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('a malformed scratch verdict with a valid durable copy is superseded (R3b shape failure)', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            writeFileSync(join(scratch, '1025-verdict.json'), '{ truncated');
            const target = join(root, '.spur', 'memory', 'evidence', '1025-verdict.json');
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, JSON.stringify({ wbs: '1025', verdict: 'PASS' }));
            const result = await migrateRunStorage({ dirs, readRunStatus: statusMap({}), dryRun: false });
            expect(outcome(result, '1025').outcome).toBe('superseded');
            expect(result.failures.length).toBe(0);
            expect(readFileSync(target, 'utf8')).toContain('PASS');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('a malformed scratch receipt with an invalid durable copy fails as target-mismatch', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            writeFileSync(join(scratch, 'E71-feature-verification.json'), '{ truncated');
            const target = join(root, '.spur', 'memory', 'evidence', 'E71-feature-verification.json');
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, 'also not a receipt');
            const result = await migrateRunStorage({ dirs, readRunStatus: statusMap({}), dryRun: false });
            const entry = result.entries.find((e) => e.family === 'feature-receipt');
            expect(entry?.outcome).toBe('failed');
            expect(result.failures[0]?.reason).toBe('target-mismatch');
            expect(readFileSync(target, 'utf8')).toBe('also not a receipt');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('a receipt whose identity does not match the whole unit fails with a receipt-identity reason', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            // Prefix names E71 but the body claims feature F99 / run run-z, which matches neither
            // the prefix nor the owner — an identity failure, not a shape failure.
            writeFileSync(
                join(scratch, 'E71-feature-verification.json'),
                JSON.stringify(receipt('F99', 'run-z', root)),
            );
            const result = await migrateRunStorage({ dirs, readRunStatus: statusMap({}), dryRun: false });
            const entry = result.entries.find((e) => e.family === 'feature-receipt');
            expect(entry?.outcome).toBe('failed');
            expect(result.failures[0]?.reason).toContain('receipt identity');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('a verdict whose proof owner binding differs from the recorded owner fails', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            writeFileSync(
                join(scratch, '1025-verdict.json'),
                JSON.stringify({
                    wbs: '1025',
                    verdict: 'PASS',
                    // A non-string `proof.runId` cannot bind the recorded owner (which falls back to
                    // `pipelineRunId`), so the proof row is classified as an identity failure.
                    proof: { runId: 123 },
                    pipelineRunId: 'owner-run',
                }),
            );
            const result = await migrateRunStorage({
                dirs,
                readRunStatus: statusMap({ 'owner-run': 'done' }),
                dryRun: false,
            });
            expect(outcome(result, '1025').outcome).toBe('failed');
            expect(result.failures[0]?.reason).toContain('proof owner binding');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('a non-JSON run-record state sibling is a shape failure, not a copy', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            writeFileSync(join(scratch, 'run-e.md'), 'record body');
            writeFileSync(join(scratch, 'run-e.state.json'), 'not json at all');
            const result = await migrateRunStorage({
                dirs,
                readRunStatus: statusMap({ 'run-e': 'done' }),
                dryRun: false,
            });
            const entry = result.entries.find((e) => e.identity === 'run-e');
            expect(entry?.outcome).toBe('preserved');
            expect(entry?.reason).toContain('unclassified');
            expect(result.failures.length).toBe(0);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('an identity-failing verdict whose durable copy is valid is superseded (R3b identity failure)', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            // Scratch claims a foreign wbs behind the same filename; the durable copy is the
            // valid same-identity verdict, so durable canonical wins rather than failing.
            writeFileSync(
                join(scratch, '1025-verdict.json'),
                JSON.stringify({ wbs: '9999', verdict: 'PASS', proof: { runId: 'r' } }),
            );
            const target = join(root, '.spur', 'memory', 'evidence', '1025-verdict.json');
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, JSON.stringify({ wbs: '1025', verdict: 'FAIL' }));
            const result = await migrateRunStorage({
                dirs,
                readRunStatus: statusMap({ r: 'done' }),
                dryRun: false,
            });
            const entry = result.entries.find((e) => e.identity === '1025');
            expect(entry?.outcome).toBe('superseded');
            expect(result.failures.length).toBe(0);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('an incomplete run-record pair with no durable pair fails with a re-record remedy', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            writeFileSync(join(scratch, 'ghostly.md'), 'record without state');
            const result = await migrateRunStorage({
                dirs,
                readRunStatus: statusMap({ ghostly: 'done' }),
                dryRun: false,
            });
            expect(outcome(result, 'ghostly').outcome).toBe('failed');
            expect(result.failures[0]?.reason).toContain('missing-required-item');
            expect(result.failures[0]?.remedy).toBe('re-record the run');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('migration rejects escaping scratch and durable roots without touching external data', async () => {
        for (const plane of ['scratch', 'evidence'] as const) {
            const { root, scratch, dirs } = makeProject();
            const outside = mkdtempSync(join(tmpdir(), 'run-storage-outside-'));
            try {
                const file = '1025-verdict.json';
                writeFileSync(join(outside, file), '{"verdict":"PASS"}');
                if (plane === 'scratch') {
                    rmSync(scratch, { recursive: true });
                    symlinkSync(outside, scratch);
                } else {
                    writeFileSync(join(scratch, file), '{"verdict":"FAIL"}');
                    mkdirSync(dirname(dirs.evidenceDir), { recursive: true });
                    symlinkSync(outside, dirs.evidenceDir);
                }
                const result = await migrateRunStorage({ dirs, readRunStatus: statusMap({}) });
                expect(result.failures.length).toBeGreaterThan(0);
                expect(readFileSync(join(outside, file), 'utf8')).toBe('{"verdict":"PASS"}');
            } finally {
                rmSync(root, { recursive: true, force: true });
                rmSync(outside, { recursive: true, force: true });
            }
        }
    });

    test('run subtrees, run-scoped receipts and unowned files classify correctly (1026 R4)', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            // Per-file run-subtree units (1026 R4): agent-sessions + artifacts under one run dir.
            mkdirSync(join(scratch, 'run-1', 'agent-sessions'), { recursive: true });
            mkdirSync(join(scratch, 'run-1', 'artifacts'), { recursive: true });
            writeFileSync(join(scratch, 'run-1', 'agent-sessions', 'omp.jsonl'), '{}\n');
            writeFileSync(join(scratch, 'run-1', 'artifacts', 'art.bin'), 'bytes');
            // Run-scoped receipt (runId === prefix) vs plain feature receipt.
            writeFileSync(join(scratch, '9002-feature-verification.json'), JSON.stringify(receipt('F', '9002', root)));
            writeFileSync(join(scratch, '9003-feature-verification.json'), JSON.stringify({ runId: 'other' }));
            // Unowned scratch files stay preserved with no family/identity.
            writeFileSync(join(scratch, 'notes.txt'), 'scratch');

            // Unknown owner status → run-scoped units are preserved, never migrated.
            const result = await migrateRunStorage({ dirs, readRunStatus: statusMap({}), dryRun: false });
            const subtree = result.entries.filter((e) => e.identity === 'run-1');
            expect(subtree.length).toBe(2);
            for (const entry of subtree) {
                expect(entry.family).toBe('run-record');
                expect(entry.outcome).toBe('preserved');
            }
            expect(outcome(result, 'F').family).toBe('feature-receipt');
            expect(outcome(result, 'F').outcome).toBe('preserved');
            expect(outcome(result, '9003').family).toBe('feature-receipt');
            const unowned = result.entries.find((e) => (e.source as string).endsWith('notes.txt'));
            expect(unowned?.family).toBeNull();
            expect(unowned?.outcome).toBe('preserved');
            expect(existsSync(join(scratch, 'run-1', 'artifacts', 'art.bin'))).toBeTrue();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('malformed verdict and receipt JSON are rejected, not copied', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            writeFileSync(join(scratch, '9001-verdict.json'), 'not json');
            writeFileSync(join(scratch, 'E71-feature-verification.json'), '{ truncated');
            const result = await migrateRunStorage({ dirs, readRunStatus: statusMap({}), dryRun: false });
            expect(outcome(result, '9001').outcome).toBe('preserved');
            expect(outcome(result, '9001').reason).toContain('unclassified');
            expect(outcome(result, 'E71').outcome).toBe('preserved');
            expect(outcome(result, 'E71').reason).toContain('unclassified');
            expect(result.failures.length).toBe(0);
            expect(existsSync(join(dirs.evidenceDir, '9001-verdict.json'))).toBeFalse();
            expect(existsSync(join(dirs.evidenceDir, 'E71-feature-verification.json'))).toBeFalse();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('live, paused, interrupted and unknown owners are preserved', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            for (const [i] of ['running', 'paused', 'interrupted'].entries()) {
                writeFileSync(join(scratch, `R${i}.md`), `record ${i}`);
                writeFileSync(join(scratch, `R${i}.state.json`), '{}');
            }
            writeFileSync(join(scratch, 'loose.log'), 'legacy unowned log');
            const result = await migrateRunStorage({
                dirs,
                readRunStatus: statusMap({ R0: 'running', R1: 'paused', R2: 'interrupted' }),
                dryRun: false,
            });
            expect(outcome(result, 'R0').outcome).toBe('preserved');
            expect(outcome(result, 'R1').outcome).toBe('preserved');
            expect(outcome(result, 'R2').outcome).toBe('preserved');
            // 1026: loose `<name>.log` units get a legacy-log identity (`<name>`) even when
            // their owner is unknown — fail-closed preservation keeps them in scratch.
            const loose = result.entries.find((e) => e.source.endsWith('loose.log'));
            expect(loose?.outcome).toBe('preserved');
            expect(loose?.target).toBeNull();
            expect(loose?.identity).toBe('loose');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('terminal run records migrate as a two-file unit', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            writeFileSync(join(scratch, 'run-1.md'), 'record');
            writeFileSync(join(scratch, 'run-1.state.json'), '{}');
            const result = await migrateRunStorage({
                dirs,
                readRunStatus: statusMap({ 'run-1': 'done' }),
                dryRun: false,
            });
            expect(outcome(result, 'run-1').outcome).toBe('migrated');
            expect(existsSync(join(root, '.spur', 'memory', 'runs', 'run-1.md'))).toBeTrue();
            expect(existsSync(join(root, '.spur', 'memory', 'runs', 'run-1.state.json'))).toBeTrue();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('run-record pair missing a required sibling fails closed when the run row exists', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            writeFileSync(join(scratch, 'ghost.md'), 'record without state');
            const result = await migrateRunStorage({
                dirs,
                readRunStatus: statusMap({ ghost: 'done' }),
                dryRun: false,
            });
            expect(outcome(result, 'ghost').outcome).toBe('failed');
            expect(result.failures[0]?.reason).toContain('missing-required-item');
            expect(existsSync(join(root, '.spur', 'memory', 'runs'))).toBeFalse();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('divergent existing target fails the whole run-record pair closed', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            writeFileSync(join(scratch, 'run-9.md'), 'new record');
            writeFileSync(join(scratch, 'run-9.state.json'), '{}');
            const runsDir = join(root, '.spur', 'memory', 'runs');
            mkdirSync(runsDir, { recursive: true });
            writeFileSync(join(runsDir, 'run-9.md'), 'divergent bytes');
            const result = await migrateRunStorage({
                dirs,
                readRunStatus: statusMap({ 'run-9': 'done' }),
                dryRun: false,
            });
            expect(outcome(result, 'run-9').outcome).toBe('failed');
            expect(result.failures.length).toBe(2);
            expect(readFileSync(join(runsDir, 'run-9.md'), 'utf8')).toBe('divergent bytes');
            expect(existsSync(join(runsDir, 'run-9.state.json'))).toBeFalse();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('orphan .state.json for an unknown owner is preserved, not migrated', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            writeFileSync(join(scratch, 'orphan.state.json'), '{}');
            const result = await migrateRunStorage({ dirs, readRunStatus: statusMap({}), dryRun: false });
            const entry = result.entries.find((e) => e.identity === 'orphan');
            expect(entry?.outcome).toBe('preserved');
            expect(existsSync(join(root, '.spur', 'memory', 'runs', 'orphan.state.json'))).toBeFalse();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('injected copy failure lands in entries and failures without deleting sources', async () => {
        const { root, scratch, dirs } = makeProject();
        try {
            writeFileSync(join(scratch, '1025-verdict.json'), JSON.stringify({ verdict: 'PASS' }));
            const result = await migrateRunStorage({
                dirs,
                readRunStatus: statusMap({}),
                dryRun: false,
                atomicCopy: () => {
                    throw new Error('injected disk failure');
                },
            });
            expect(outcome(result, '1025').outcome).toBe('failed');
            expect(result.failures.length).toBeGreaterThan(0);
            expect(existsSync(join(scratch, '1025-verdict.json'))).toBeTrue();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

/** Task record body the analytics plane can fold into a verified result. */
const DISPOSAL_TASK_BODY = `---
wbs: "1027"
status: done
---

## History

- 2026-09-30T10:00:00.000Z todo → wip (system)
- 2026-09-30T10:05:00.000Z wip → testing (system)
- 2026-09-30T11:00:00.000Z testing → done (system)

## Testing

- [x] R1. covered
  - Verdict: PASS (from verdict artifact)
`;

/**
 * 1027 decisive disposal-equivalence proof (AC1/AC2): removing a completed run's
 * scratch changes nothing observable — the verdict resolves from durable evidence,
 * analytics derive identically, run records/artifacts/sessions stay inspectable
 * (success AND failure AND paused terminals), a symlink escaping scratch cannot take its target
 * along, and the next temporary gate recreates scratch. Stale-PASS, missing-
 * artifact, migration-write-failure and paused-recovery-resume scenarios are owned
 * by their existing suites (done-transition-guard, quality-gate, the 1025
 * migration tests above, workflow-service staleness checks) and are not duplicated.
 */
describe('completed scratch disposal equivalence (E71/1027)', () => {
    test('removing completed scratch twice preserves acceptance, verified analytics, inspection and session bytes', async () => {
        const { root, scratch, dirs } = makeProject();
        const db = await createDbAdapter({ driver: 'bun-sqlite', url: ':memory:' });
        try {
            // Durable acceptance evidence registered via migration; the scratch copy stays
            // behind as the completed run's last physical trace until disposal.
            writeFileSync(
                join(scratch, '1027-verdict.json'),
                JSON.stringify({
                    wbs: '1027',
                    verdict: 'PASS',
                    proofDigest: `sha256:${'a'.repeat(64)}`,
                    requirements: [{ id: 'R1', status: 'MET', evidence: 'disposal fixture' }],
                    acceptanceCriteria: [],
                    checks: [],
                }),
            );
            await migrateRunStorage({ dirs, readRunStatus: statusMap({}), dryRun: false });
            // Record pairs live flat under the durable records dir (1026 R1); sessions and
            // artifacts live in the per-run subtree.
            mkdirSync(dirs.recordsDir, { recursive: true });
            const okRun = 'wfr-dispose-ok';
            const badRun = 'wfr-dispose-failed';
            const pausedRun = 'wfr-dispose-paused';
            for (const [runId, status] of [
                [okRun, 'done'],
                [badRun, 'failed'],
                [pausedRun, 'paused'],
            ] as const) {
                writeFileSync(join(dirs.recordsDir, `${runId}.md`), `# ${runId}\n`);
                writeFileSync(join(dirs.recordsDir, `${runId}.state.json`), JSON.stringify({ runId, status }));
            }
            const artifactPath = join(runArtifactsDir(root, okRun), 'result.json');
            mkdirSync(dirname(artifactPath), { recursive: true });
            writeFileSync(artifactPath, '{"ok":true}');
            const sessionPath = join(runSessionsDir(root, okRun), 's1.jsonl');
            mkdirSync(dirname(sessionPath), { recursive: true });
            writeFileSync(sessionPath, '{"t":1}\n');
            // No live owner occupies this disposable fixture. An escaping link must be unlinked,
            // without deleting the external file it points at.
            const victim = join(root, 'outside-victim.txt');
            writeFileSync(victim, 'keep');
            symlinkSync(victim, join(scratch, 'escape-link'));
            // Analytics plane: real task record + completed pipeline run linked to the wbs.
            mkdirSync(join(root, 'tasks'));
            const taskFile = join(root, 'tasks', '1027_disposal.md');
            writeFileSync(taskFile, DISPOSAL_TASK_BODY);
            await applyCliMigrations(db);
            db.run(
                `INSERT INTO runs (id, workflow_name, mode, status, agent, started_at, completed_at, metadata_json)
                 VALUES (?, 'task-pipeline', 'auto', 'done', NULL, ?, ?, '{}')`,
                'run_1027',
                '2026-09-30T10:00:00.000Z',
                '2026-09-30T11:00:00.000Z',
            );
            db.run(
                `INSERT INTO task_run_links (id, wbs, run_id, kind, created_at) VALUES ('link_1', '1027', ?, 'pipeline', ?)`,
                'run_1027',
                '2026-09-30T11:00:00.000Z',
            );

            const fs = createNodeFileSystem(root);
            const status = (runId: string): string => {
                const read = readWorkflowRunRecord(resolveRunRecordDir(root, runId), runId);
                return read.kind === 'pair' ? String(read.state.status) : read.kind;
            };
            const snapshot = async () => {
                const verdict = await readVerdictArtifact(fs, dirs.scratchDir, '1027');
                return {
                    verdictPass: verdict.artifact?.verdict === 'PASS',
                    verdictAggregate: verdict.artifact ? computeAggregate(verdict.artifact) : 'UNKNOWN',
                    verdictFromDurable: verdict.path.includes(join('.spur', 'memory', 'evidence')),
                    stat: JSON.stringify(
                        await deriveVerifiedOutcome(
                            {
                                db,
                                cwd: root,
                                locator: {
                                    findByWbs: async (wbs: string) => ({
                                        wbs,
                                        name: '1027_disposal.md',
                                        filePath: taskFile,
                                    }),
                                },
                                fs,
                            },
                            {},
                        ),
                    ),
                    ok: status(okRun),
                    failed: status(badRun),
                    paused: status(pausedRun),
                    bytes: existsSync(artifactPath) ? readFileSync(artifactPath, 'utf8') : null,
                    session: existsSync(sessionPath) ? readFileSync(sessionPath, 'utf8') : null,
                };
            };
            const before = await snapshot();
            expect(before.verdictPass).toBeTrue();
            expect(before.verdictAggregate).toBe('PASS');
            expect(before.ok).toBe('done');
            expect(JSON.parse(before.stat).taskDenominator).toBe(1);
            expect(JSON.parse(before.stat).verifiedResults).toBe(1);

            // Disposal of the completed scratch trace.
            rmSync(scratch, { recursive: true, force: true });
            const after = await snapshot();
            expect(after).toEqual(before); // durable-first evidence, identical analytics + inspection

            // Repeated removal is a no-op.
            rmSync(scratch, { recursive: true, force: true });
            expect(await snapshot()).toEqual(before);

            // Directory disposal unlinks the escaping link and leaves its target intact.
            expect(readFileSync(victim, 'utf8')).toBe('keep');
            expect(status(badRun)).toBe('failed');
            expect(status(pausedRun)).toBe('paused');

            // A later temporary gate recreates scratch and writes back into it.
            silenceStdout(() => runLightGate({ wbs: '1027' }, { cwd: root }));
            expect(existsSync(join(scratch, '1027-light-gate.log'))).toBeTrue();
            expect(existsSync(join(scratch, '1027-check-receipt.json'))).toBeTrue();

            // Missing durable artifact degrades bytes honestly; inspection plane unaffected.
            rmSync(runArtifactsDir(root, okRun), { recursive: true, force: true });
            const degraded = await snapshot();
            expect(degraded.bytes).toBeNull();
            expect(degraded.session).toBe(before.session);
            expect(degraded.ok).toBe('done');
        } finally {
            db.close();
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('ensureDurablePlaneIgnored (E71/1027)', () => {
    test('installs the exclusion in a managed (linked) worktree via the common gitdir', () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-durable-plane-'));
        const exec = (args: string, cwd: string) => {
            Bun.spawnSync(['bash', '-c', args], { cwd });
        };
        try {
            const repo = join(root, 'repo');
            mkdirSync(repo);
            exec(
                'git init -q && git config user.email t@t && git config user.name t && touch seed && git add -A && git commit -qm seed',
                repo,
            );
            const worktree = join(root, 'wt');
            exec(`git worktree add -q "${worktree}"`, repo);
            // Simulate the managed-worktree shape: `.git` is a pointer file, so the plain
            // join(workdir, '.git', 'info', 'exclude') path is unusable.
            expect(readFileSync(join(worktree, '.git'), 'utf8')).toContain('gitdir:');

            ensureDurablePlaneIgnored(worktree);

            const exclude = readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8');
            expect(exclude).toContain('.spur/memory/');
            // The durable plane is invisible to `git add -A` from the worktree...
            mkdirSync(join(worktree, '.spur', 'memory', 'runs'), { recursive: true });
            writeFileSync(join(worktree, '.spur', 'memory', 'runs', 'r.state.json'), '{}');
            const status = Bun.spawnSync(['git', 'status', '--porcelain'], { cwd: worktree });
            expect(status.stdout.toString()).not.toContain('.spur/memory');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
