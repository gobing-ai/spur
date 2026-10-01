import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { FeatureService } from '../../src/services/feature-service';
import {
    blockedStateFile,
    computeSyncFingerprint,
    parseBlockedState,
    readVerdictMtimeVector,
    serializeBlockedState,
} from '../../src/services/feature-sync-suppression';
import { PlanningWriteService } from '../../src/services/planning-write-service';

// 1004 R3: behavioral port of the deleted bounded-sync wrapper test suite —
// the wrapper is gone; fingerprinting/serialization are pure units here and the
// suppress/replay/persist policy is exercised end-to-end through FeatureService.syncFeature.

let root: string;
let featuresDir: string;
let tasksDir: string;
let runDir: string;
let svc: FeatureService;

const writeTask = (wbs: string, name: string, status: string, featureId: string): void => {
    writeFileSync(
        join(tasksDir, `${wbs}_${name.toLowerCase().replace(/\s+/g, '-')}-task.md`),
        `---
schema_version: 1
wbs: "${wbs}"
name: "${name}"
status: "${status}"
feature_id: "${featureId}"
created_at: "${new Date().toISOString()}"
updated_at: "${new Date().toISOString()}"
---
# ${wbs}: ${name}
`,
    );
};

/** done feature + a wip task → deriveFeatureStatus proposes requiresConfirm reopen (BLOCKED deferral). */
async function makeBlockedFeature(name: string, wbs: string): Promise<string> {
    const feat = await svc.create(name);
    await svc.transition(feat.ref.id, 'active');
    await svc.transition(feat.ref.id, 'verifying');
    await svc.transition(feat.ref.id, 'done');
    writeTask(wbs, `${name} Task`, 'wip', feat.ref.id);
    return feat.ref.id;
}

beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'spur-sync-suppression-'));
    featuresDir = join(root, 'features');
    tasksDir = join(root, 'tasks');
    runDir = join(root, '.spur', 'run');
    const fs = createNodeFileSystem(root);
    await fs.ensureDir(featuresDir);
    await fs.ensureDir(tasksDir);
    svc = new FeatureService({ fs, featuresDir, tasksDir, writeService: new PlanningWriteService({ fs }) });
});

afterAll(() => {
    rmSync(root, { recursive: true, force: true });
});

describe('computeSyncFingerprint (1004 R3)', () => {
    const fingerprintOf = (over: Partial<Parameters<typeof computeSyncFingerprint>[0]> = {}): string =>
        computeSyncFingerprint({
            featureContentHash: 'abc',
            taskStatusVector: ['01:done', '02:wip'],
            verdictMtimeVector: ['01:100'],
            ...over,
        });

    test('identical inputs → identical fingerprint', () => {
        const a = fingerprintOf();
        const b = fingerprintOf();
        expect(a).toBe(b);
    });

    test('changed feature content → different fingerprint', () => {
        expect(fingerprintOf({ featureContentHash: 'aaa' })).not.toBe(fingerprintOf({ featureContentHash: 'bbb' }));
    });

    test('changed task status → different fingerprint', () => {
        expect(fingerprintOf({ taskStatusVector: ['0411:wip'] })).not.toBe(
            fingerprintOf({ taskStatusVector: ['0411:done'] }),
        );
    });

    test('changed verdict mtime → different fingerprint', () => {
        expect(fingerprintOf({ verdictMtimeVector: ['0411:100'] })).not.toBe(
            fingerprintOf({ verdictMtimeVector: ['0411:200'] }),
        );
    });

    test('task status order-insensitive (sorted internally)', () => {
        const a = fingerprintOf({ taskStatusVector: ['01:done', '02:wip'] });
        const b = fingerprintOf({ taskStatusVector: ['02:wip', '01:done'] });
        expect(a).toBe(b);
    });

    test('32 hex chars', () => {
        expect(fingerprintOf()).toMatch(/^[0-9a-f]{32}$/);
    });
});

describe('blocked state serialization (1004 R3, 0411 JSON shape)', () => {
    test('blockedStateFile path construction', () => {
        expect(blockedStateFile('F1', '/repo/.spur/run')).toBe('/repo/.spur/run/feature-sync-blocked-F1.json');
        expect(blockedStateFile('F1', '/repo/.spur/run/')).toBe('/repo/.spur/run/feature-sync-blocked-F1.json');
    });

    test('round-trip preserves all fields', () => {
        const state = {
            featureId: 'A1',
            inputFingerprint: 'f'.repeat(32),
            proposal: {
                featureId: 'A1',
                from: 'done',
                to: 'active',
                reason: 'linked tasks reopened',
                requiresConfirm: true,
            },
            classification: 'blocked' as const,
            result: {
                proposal: {
                    featureId: 'A1',
                    from: 'done',
                    to: 'active',
                    reason: 'linked tasks reopened',
                    requiresConfirm: true,
                },
                applied: false,
                appliedHops: [],
            },
            persistedAt: '2026-09-29T00:00:00.000Z',
        };
        const parsed = parseBlockedState(serializeBlockedState(state));
        expect(parsed).toEqual(state);
    });

    test('empty string, whitespace, malformed JSON, and missing fields → null', () => {
        expect(parseBlockedState('')).toBeNull();
        expect(parseBlockedState('   \n')).toBeNull();
        expect(parseBlockedState('not-json')).toBeNull();
        expect(parseBlockedState('{"featureId":"A1"}')).toBeNull();
    });
});

describe('readVerdictMtimeVector (1004 R3)', () => {
    test('durable evidence overrides scratch and remains an input after scratch disposal', async () => {
        const repo = mkdtempSync(join(tmpdir(), 'sync-durable-'));
        try {
            const fs = createNodeFileSystem(repo);
            const scratch = join(repo, '.spur/run');
            const evidence = join(repo, '.spur/memory/evidence');
            await fs.ensureDir(scratch);
            await fs.ensureDir(evidence);
            writeFileSync(join(scratch, '0001-verdict.json'), '{"verdict":"FAIL"}');
            writeFileSync(join(evidence, '0001-verdict.json'), '{"verdict":"PASS"}');
            const before = await readVerdictMtimeVector(fs, scratch);
            expect(before).toHaveLength(1);
            rmSync(scratch, { recursive: true });
            expect(await readVerdictMtimeVector(fs, scratch)).toEqual(before);
            writeFileSync(join(evidence, '0002-verdict.json'), '{"verdict":"FAIL"}');
            expect(await readVerdictMtimeVector(fs, scratch)).toHaveLength(2);
        } finally {
            rmSync(repo, { recursive: true, force: true });
        }
    });

    test('collects <wbs>:<mtimeMs> for -verdict.json files, skips others; missing dir → []', async () => {
        const fs = createNodeFileSystem(root);
        const dir = join(root, 'verdicts');
        await fs.ensureDir(dir);
        writeFileSync(join(dir, '9901-verdict.json'), '{}\n');
        writeFileSync(join(dir, '9902-verdict.json'), '{}\n');
        writeFileSync(join(dir, '9903-notes.txt'), 'x\n');
        const vector = await readVerdictMtimeVector(fs, dir);
        expect(vector).toHaveLength(2);
        expect(vector[0]).toMatch(/^9901:\d+(\.\d+)?$/);
        expect(vector[1]).toMatch(/^9902:\d+(\.\d+)?$/);

        expect(await readVerdictMtimeVector(fs, join(root, 'absent-dir'))).toEqual([]);
    });
});

describe('syncFeature suppression policy (1004 R3 end-to-end)', () => {
    const statePath = (featureId: string): string => blockedStateFile(featureId, runDir);

    test('a BLOCKED outcome persists state; the identical second call replays it (suppressed)', async () => {
        const id = await makeBlockedFeature('Suppress Replay', '9906');

        const first = await svc.syncFeature(id);
        expect(first.applied).toBe(false);
        expect(first.suppressed).toBeUndefined();
        expect(existsSync(statePath(id))).toBe(true);

        const second = await svc.syncFeature(id);
        expect(second.suppressed).toBe(true);
        expect(second.applied).toBe(false);
        expect(second.proposal.from).toBe(first.proposal.from);
        expect(second.proposal.to).toBe(first.proposal.to);
    });

    test('force bypasses the replay and re-derives live', async () => {
        const id = await makeBlockedFeature('Suppress Force', '9907');
        await svc.syncFeature(id);
        expect(existsSync(statePath(id))).toBe(true);

        // force re-runs the live derivation (still defers without forceConfirm — but freshly,
        // re-persisting the blocked state with the fresh fingerprint).
        const forced = await svc.syncFeature(id, { force: true });
        expect(forced.suppressed).toBeUndefined();
        expect(forced.applied).toBe(false);
        expect(existsSync(statePath(id))).toBe(true);

        // force + forceConfirm applies the reopen; a non-BLOCKED outcome clears the state.
        const applied = await svc.syncFeature(id, { force: true, forceConfirm: true });
        expect(applied.applied).toBe(true);
        expect(existsSync(statePath(id))).toBe(false);
    });

    test('a changed input re-invokes live and re-persists with the new fingerprint', async () => {
        const id = await makeBlockedFeature('Suppress Changed', '9908');
        await svc.syncFeature(id);
        const before = parseBlockedState(await (await import('node:fs/promises')).readFile(statePath(id), 'utf8'));

        // Mutate the feature file content → the feature-content hash changes.
        await svc.update(id, 'name', 'Suppress Changed (revised)');
        const third = await svc.syncFeature(id);
        expect(third.suppressed).toBeUndefined();
        expect(third.applied).toBe(false);

        const after = parseBlockedState(await (await import('node:fs/promises')).readFile(statePath(id), 'utf8'));
        expect(after?.inputFingerprint).not.toBe(before?.inputFingerprint);
    });

    test('dry-run stays read-only: never replays, never persists', async () => {
        const id = await makeBlockedFeature('Suppress DryRun', '9909');

        const dry = await svc.syncFeature(id, { dryRun: true });
        expect(dry.applied).toBe(false);
        expect(dry.suppressed).toBeUndefined();
        expect(existsSync(statePath(id))).toBe(false);

        // A blocked state from a live call is NOT replayed into a dry-run (read-only contract).
        await svc.syncFeature(id);
        const drySecond = await svc.syncFeature(id, { dryRun: true });
        expect(drySecond.suppressed).toBeUndefined();
    });
});
