import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    type MigrateRunStorageInput,
    migrateRunStorage,
    type RunStorageMigrationEntry,
    runStoragePaths,
} from '../../src/services/run-storage';

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

describe('migrateRunStorage (E71/1025)', () => {
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
            writeFileSync(target, JSON.stringify({ verdict: 'FAIL' }));
            const result = await migrateRunStorage({ dirs, readRunStatus: statusMap({}), dryRun: false });
            expect(outcome(result, '1025').outcome).toBe('failed');
            expect(result.failures.length).toBeGreaterThan(0);
            expect(readFileSync(target, 'utf8')).toBe(JSON.stringify({ verdict: 'FAIL' }));
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
            expect(outcome(result, '9001').outcome).toBe('failed');
            expect(outcome(result, 'E71').outcome).toBe('failed');
            expect(result.failures.length).toBe(2);
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
            writeFileSync(join(scratch, 'loose.log'), 'unowned scratch');
            const result = await migrateRunStorage({
                dirs,
                readRunStatus: statusMap({ R0: 'running', R1: 'paused', R2: 'interrupted' }),
                dryRun: false,
            });
            expect(outcome(result, 'R0').outcome).toBe('preserved');
            expect(outcome(result, 'R1').outcome).toBe('preserved');
            expect(outcome(result, 'R2').outcome).toBe('preserved');
            const loose = result.entries.find((e) => e.source.endsWith('loose.log'));
            expect(loose?.outcome).toBe('preserved');
            expect(loose?.target).toBeNull();
            expect(loose?.identity).toBeNull();
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
