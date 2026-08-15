import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    type BlockedState,
    blockedStateFile,
    classifySyncResult,
    computeFingerprint,
    decideBoundedSync,
    defaultSpurBin,
    type FeatureSyncResult,
    parseBlockedState,
    parseBoundedSyncCliArgs,
    processSyncResult,
    runBoundedCli,
    serializeBlockedState,
    shouldSuppressBlocked,
} from '../scripts/feature-sync-bounded';

describe('defaultSpurBin (monorepo-safe CLI resolution, 0539)', () => {
    const prev = process.env.SPUR_BIN;
    afterEach(() => {
        if (prev === undefined) delete process.env.SPUR_BIN;
        else process.env.SPUR_BIN = prev;
    });

    test('SPUR_BIN env wins over every other rung', () => {
        process.env.SPUR_BIN = '/custom/spur';
        expect(defaultSpurBin()).toBe('/custom/spur');
    });

    test('falls back to the monorepo-local CLI entry before PATH spur', () => {
        delete process.env.SPUR_BIN;
        const repoRoot = join(import.meta.dir, '..', '..', '..');
        expect(defaultSpurBin()).toBe(`bun ${join(repoRoot, 'apps/cli/src/index.ts')}`);
    });
});

// ── fixtures ────────────────────────────────────────────────────────────────────────────

const blockedResult: FeatureSyncResult = {
    proposal: {
        featureId: 'H9',
        from: 'active',
        to: 'done',
        reason: 'L4 gate failed: 2 tasks not done (0411, 0412)',
        gateBlocked: true,
        gateFindings: [
            { wbs: '0411', status: 'wip' },
            { wbs: '0412', status: 'todo' },
        ],
        hops: ['done'],
    },
    applied: false,
    appliedHops: [],
};

const blockedResultPartial: FeatureSyncResult = {
    // Gate-blocked but with a partial hop applied (backlog→active applied, active→done gate-blocked).
    proposal: {
        featureId: 'H9',
        from: 'backlog',
        to: 'done',
        reason: 'L4 gate failed: 2 tasks not done',
        gateBlocked: true,
        gateFindings: [{ wbs: '0411', status: 'wip' }],
        hops: ['active', 'done'],
    },
    applied: true,
    appliedHops: ['active'],
};

const appliedResult: FeatureSyncResult = {
    proposal: {
        featureId: 'H9',
        from: 'active',
        to: 'done',
        reason: 'all tasks done',
        hops: ['done'],
    },
    applied: true,
    appliedHops: ['done'],
};

const noopResult: FeatureSyncResult = {
    proposal: {
        featureId: 'H9',
        from: 'active',
        to: 'active',
        reason: 'already at target status',
    },
    applied: false,
    appliedHops: [],
};

const requireConfirmResult: FeatureSyncResult = {
    // requiresConfirm without gateBlocked → from !== to, not applied.
    // Per R5 this preserves current behavior: classified as blocked (deferred confirmation hop),
    // not no-op.
    proposal: {
        featureId: 'H9',
        from: 'active',
        to: 'done',
        reason: 'requires confirmation (--force-confirm)',
        requiresConfirm: true,
    },
    applied: false,
    appliedHops: [],
};

function fingerprintOf(overrides: Partial<Parameters<typeof computeFingerprint>[0]> = {}): string {
    return computeFingerprint({
        featureContentHash: 'abc123',
        taskStatusVector: ['0411:done', '0412:done'],
        verdictMtimeVector: ['0411:1700000000', '0412:1700000001'],
        ...overrides,
    });
}

function blockedStateOf(
    result: FeatureSyncResult,
    fingerprint: string,
    persistedAt = '2026-08-01T00:00:00.000Z',
): BlockedState {
    return {
        featureId: result.proposal.featureId,
        inputFingerprint: fingerprint,
        proposal: result.proposal,
        classification: 'blocked',
        result,
        persistedAt,
    };
}

// ── classifySyncResult ──────────────────────────────────────────────────────────────────

describe('classifySyncResult — L4 gate-blocked checked first', () => {
    test('gate-blocked with applied:false → blocked', () => {
        expect(classifySyncResult(blockedResult)).toBe('blocked');
    });

    test('gate-blocked with partial hop applied:true → still blocked (critical ordering)', () => {
        expect(classifySyncResult(blockedResultPartial)).toBe('blocked');
    });

    test('applied:true without gate-blocked → applied', () => {
        expect(classifySyncResult(appliedResult)).toBe('applied');
    });

    test('from === to, not applied → no-op', () => {
        expect(classifySyncResult(noopResult)).toBe('no-op');
    });

    test('requiresConfirm (from !== to, not applied, no gate-blocked) → blocked (deferred hop)', () => {
        expect(classifySyncResult(requireConfirmResult)).toBe('blocked');
    });
});

// ── computeFingerprint ──────────────────────────────────────────────────────────────────

describe('computeFingerprint — deterministic, input-sensitive', () => {
    test('identical inputs → identical fingerprint', () => {
        const a = computeFingerprint({
            featureContentHash: 'abc',
            taskStatusVector: ['01:done', '02:wip'],
            verdictMtimeVector: ['01:100'],
        });
        const b = computeFingerprint({
            featureContentHash: 'abc',
            taskStatusVector: ['01:done', '02:wip'],
            verdictMtimeVector: ['01:100'],
        });
        expect(a).toBe(b);
    });

    test('changed feature content → different fingerprint', () => {
        const a = fingerprintOf({ featureContentHash: 'aaa' });
        const b = fingerprintOf({ featureContentHash: 'bbb' });
        expect(a).not.toBe(b);
    });

    test('changed task status → different fingerprint', () => {
        const a = fingerprintOf({ taskStatusVector: ['0411:wip'] });
        const b = fingerprintOf({ taskStatusVector: ['0411:done'] });
        expect(a).not.toBe(b);
    });

    test('changed verdict mtime → different fingerprint', () => {
        const a = fingerprintOf({ verdictMtimeVector: ['0411:100'] });
        const b = fingerprintOf({ verdictMtimeVector: ['0411:200'] });
        expect(a).not.toBe(b);
    });

    test('task status order-insensitive (sorted internally)', () => {
        const a = computeFingerprint({
            featureContentHash: 'x',
            taskStatusVector: ['01:done', '02:wip'],
            verdictMtimeVector: [],
        });
        const b = computeFingerprint({
            featureContentHash: 'x',
            taskStatusVector: ['02:wip', '01:done'],
            verdictMtimeVector: [],
        });
        expect(a).toBe(b);
    });

    test('32 hex chars', () => {
        expect(fingerprintOf()).toMatch(/^[0-9a-f]{32}$/);
    });
});

// ── shouldSuppressBlocked ───────────────────────────────────────────────────────────────

describe('shouldSuppressBlocked — retry-suppression policy', () => {
    test('no prior state → do not suppress', () => {
        expect(shouldSuppressBlocked(null, fingerprintOf()).suppress).toBe(false);
    });

    test('prior state + identical fingerprint → suppress + replay prior result', () => {
        const fp = fingerprintOf();
        const prior = blockedStateOf(blockedResult, fp);
        const r = shouldSuppressBlocked(prior, fp);
        expect(r.suppress).toBe(true);
        expect(r.replay).toEqual(blockedResult);
    });

    test('prior state + changed fingerprint → do not suppress (R3: retry allowed)', () => {
        const prior = blockedStateOf(blockedResult, fingerprintOf({ taskStatusVector: ['0411:wip'] }));
        const r = shouldSuppressBlocked(prior, fingerprintOf({ taskStatusVector: ['0411:done'] }));
        expect(r.suppress).toBe(false);
        expect(r.replay).toBeUndefined();
    });
});

// ── decideBoundedSync ───────────────────────────────────────────────────────────────────

describe('decideBoundedSync — orchestration decision', () => {
    test('no prior → invoke', () => {
        expect(decideBoundedSync(null, fingerprintOf()).kind).toBe('invoke');
    });

    test('prior + identical fingerprint → suppress + replay', () => {
        const fp = fingerprintOf();
        const r = decideBoundedSync(blockedStateOf(blockedResult, fp), fp);
        expect(r.kind).toBe('suppress');
        if (r.kind === 'suppress') expect(r.replay).toEqual(blockedResult);
    });

    test('prior + changed fingerprint → invoke (R3)', () => {
        const prior = blockedStateOf(blockedResult, fingerprintOf({ taskStatusVector: ['0411:wip'] }));
        expect(decideBoundedSync(prior, fingerprintOf({ taskStatusVector: ['0411:done'] })).kind).toBe('invoke');
    });
});

// ── processSyncResult ───────────────────────────────────────────────────────────────────

describe('processSyncResult — classification + persistence', () => {
    test('blocked (live) → persist blocked state, annotate as live', () => {
        const fp = fingerprintOf();
        const r = processSyncResult(blockedResult, fp, '2026-08-01T10:00:00.000Z', false);
        expect(r.classification).toBe('blocked');
        expect(r.emit).toEqual(blockedResult);
        expect(r.persist).toBeDefined();
        if (r.persist) {
            expect(r.persist.featureId).toBe('H9');
            expect(r.persist.inputFingerprint).toBe(fp);
            expect(r.persist.result).toEqual(blockedResult);
            expect(r.persist.persistedAt).toBe('2026-08-01T10:00:00.000Z');
        }
        expect(r.annotation).toContain('blocked proposal');
        expect(r.annotation).not.toContain('suppressed');
    });

    test('blocked (suppressed) → persist blocked state, annotate as suppressed', () => {
        const fp = fingerprintOf();
        const r = processSyncResult(blockedResult, fp, '2026-08-01T10:00:00.000Z', true);
        expect(r.classification).toBe('blocked');
        expect(r.persist).toBeDefined();
        expect(r.annotation).toContain('suppressed');
    });

    test('applied → no persist, no annotation', () => {
        const r = processSyncResult(appliedResult, fingerprintOf(), '2026-08-01T10:00:00.000Z', false);
        expect(r.classification).toBe('applied');
        expect(r.persist).toBeUndefined();
        expect(r.annotation).toBe('');
    });

    test('no-op → no persist, no annotation (R5: success/no-op preserved)', () => {
        const r = processSyncResult(noopResult, fingerprintOf(), '2026-08-01T10:00:00.000Z', false);
        expect(r.classification).toBe('no-op');
        expect(r.persist).toBeUndefined();
        expect(r.annotation).toBe('');
    });
});

// ── serialize / parse blocked state round-trip ──────────────────────────────────────────

describe('blocked state serialization', () => {
    test('round-trip preserves all fields', () => {
        const fp = fingerprintOf();
        const state = blockedStateOf(blockedResult, fp);
        const raw = serializeBlockedState(state);
        expect(parseBlockedState(raw)).toEqual(state);
    });

    test('empty string → null', () => {
        expect(parseBlockedState('')).toBeNull();
    });

    test('whitespace only → null', () => {
        expect(parseBlockedState('   \n  ')).toBeNull();
    });

    test('malformed JSON → null', () => {
        expect(parseBlockedState('{not json')).toBeNull();
    });

    test('valid JSON missing required fields → null', () => {
        expect(parseBlockedState('{"featureId":"H9"}')).toBeNull();
    });

    test('blockedStateFile path construction', () => {
        expect(blockedStateFile('H9', '.spur/run')).toBe('.spur/run/feature-sync-blocked-H9.json');
        expect(blockedStateFile('H9', '.spur/run/')).toBe('.spur/run/feature-sync-blocked-H9.json');
    });
});

// ── CLI args parsing ────────────────────────────────────────────────────────────────────

describe('parseBoundedSyncCliArgs', () => {
    test('minimal: featureId only, defaults applied', () => {
        const a = parseBoundedSyncCliArgs(['H9']);
        expect(a.featureId).toBe('H9');
        expect(a.spurBin).toBe(defaultSpurBin()); // 0539: default is monorepo-local, not PATH spur
        expect(a.runDir).toBe('.spur/run');
        expect(a.json).toBe(false);
        expect(a.help).toBe(false);
    });

    test('all flags', () => {
        const a = parseBoundedSyncCliArgs([
            'H9',
            '--spur-bin',
            'bun apps/cli/src/index.ts',
            '--run-dir',
            '.spur/run',
            '--json',
        ]);
        expect(a.featureId).toBe('H9');
        expect(a.spurBin).toBe('bun apps/cli/src/index.ts');
        expect(a.runDir).toBe('.spur/run');
        expect(a.json).toBe(true);
    });

    test('--help / -h sets help flag', () => {
        expect(parseBoundedSyncCliArgs(['--help']).help).toBe(true);
        expect(parseBoundedSyncCliArgs(['-h']).help).toBe(true);
    });

    test('no featureId → empty string', () => {
        expect(parseBoundedSyncCliArgs(['--json']).featureId).toBe('');
    });
});

// ── Regression: the 5 paths from task 0411 (R6) ─────────────────────────────────────────

describe('task 0411 regression paths', () => {
    test('PATH 1 — blocked: live sync returns gate-blocked → classify + persist', () => {
        const fp = fingerprintOf();
        // No prior state.
        expect(decideBoundedSync(null, fp).kind).toBe('invoke');

        // Live sync returns blocked.
        const r = processSyncResult(blockedResult, fp, '2026-08-01T00:00:00.000Z', false);
        expect(r.classification).toBe('blocked');
        expect(r.persist).toBeDefined();
    });

    test('PATH 2 — unchanged-retry: identical blocked inputs → suppress (no new sync)', () => {
        const fp = fingerprintOf();
        const prior = blockedStateOf(blockedResult, fp);

        const decision = decideBoundedSync(prior, fp);
        expect(decision.kind).toBe('suppress');
        if (decision.kind === 'suppress') {
            // Replayed result is the exact prior blocked result, not a fresh sync.
            expect(decision.replay).toEqual(blockedResult);
        }
    });

    test('PATH 3 — changed-input-retry: inputs changed → invoke (retry allowed, R3)', () => {
        const fp1 = fingerprintOf({ taskStatusVector: ['0411:wip', '0412:done'] });
        const prior = blockedStateOf(blockedResult, fp1);

        // Task 0411 completes → status vector changes → fingerprint changes.
        const fp2 = fingerprintOf({ taskStatusVector: ['0411:done', '0412:done'] });
        expect(decideBoundedSync(prior, fp2).kind).toBe('invoke');
    });

    test('PATH 4 — success: applied result passes through, no suppression', () => {
        const fp = fingerprintOf();
        const r = processSyncResult(appliedResult, fp, '2026-08-01T00:00:00.000Z', false);
        expect(r.classification).toBe('applied');
        expect(r.persist).toBeUndefined();
        // An applied result means inputs will differ next time (feature advanced), so no
        // suppression can occur regardless.
        expect(decideBoundedSync(null, fp).kind).toBe('invoke');
    });

    test('PATH 5 — no-op: from===to passes through unchanged (R5)', () => {
        const r = processSyncResult(noopResult, fingerprintOf(), '2026-08-01T00:00:00.000Z', false);
        expect(r.classification).toBe('no-op');
        expect(r.persist).toBeUndefined();
        expect(r.annotation).toBe('');
    });
});

// ── Batch loop simulation: the H9 defect ────────────────────────────────────────────────

describe('batch loop simulation — H9 dogfood defect (4 redundant syncs)', () => {
    test('Call 1 (no state) → run → blocked → persist', () => {
        const fp = fingerprintOf();
        // Call 1: no prior state.
        const d1 = decideBoundedSync(null, fp);
        expect(d1.kind).toBe('invoke');

        // Sync runs, returns blocked.
        const p1 = processSyncResult(blockedResult, fp, '2026-08-01T01:00:00.000Z', false);
        expect(p1.classification).toBe('blocked');
        expect(p1.persist).toBeDefined();
    });

    test('Call 2 (same fingerprint) → suppress (redundant sync avoided)', () => {
        const fp = fingerprintOf();
        const prior = blockedStateOf(blockedResult, fp);

        const d2 = decideBoundedSync(prior, fp);
        expect(d2.kind).toBe('suppress');
        if (d2.kind === 'suppress') expect(d2.replay).toEqual(blockedResult);
    });

    test('Call 3 (verdict mtime changed) → run → blocked → re-persist', () => {
        const fp1 = fingerprintOf({ verdictMtimeVector: ['0411:100', '0412:100'] });
        const prior = blockedStateOf(blockedResult, fp1);

        // A task completes in the batch → its verdict file mtime changes.
        const fp2 = fingerprintOf({ verdictMtimeVector: ['0411:200', '0412:100'] });
        const d3 = decideBoundedSync(prior, fp2);
        expect(d3.kind).toBe('invoke');

        const p3 = processSyncResult(blockedResult, fp2, '2026-08-01T02:00:00.000Z', false);
        expect(p3.classification).toBe('blocked');
        expect(p3.persist).toBeDefined();
        if (p3.persist) expect(p3.persist.inputFingerprint).toBe(fp2);
    });

    test('Call 4 (same fingerprint as Call 3) → suppress again', () => {
        const fp = fingerprintOf({ verdictMtimeVector: ['0411:200', '0412:100'] });
        const prior = blockedStateOf(blockedResult, fp);

        const d4 = decideBoundedSync(prior, fp);
        expect(d4.kind).toBe('suppress');
    });

    test('Full sequence: invoke→suppress→invoke→suppress (3 syncs reduced from 4)', () => {
        const fpA = fingerprintOf({ verdictMtimeVector: ['0411:100'] });
        const fpB = fingerprintOf({ verdictMtimeVector: ['0411:200'] });

        const decisions: string[] = [];

        // Call 1: fresh.
        decisions.push(decideBoundedSync(null, fpA).kind);
        const p1 = processSyncResult(blockedResult, fpA, 't1', false);
        const state1 = p1.persist ?? null;

        // Call 2: same fingerprint → suppress.
        decisions.push(decideBoundedSync(state1, fpA).kind);

        // Call 3: fingerprint changed → invoke.
        const state2Base = state1 ? blockedStateOf(blockedResult, fpA) : null;
        decisions.push(decideBoundedSync(state2Base, fpB).kind);
        const p3 = processSyncResult(blockedResult, fpB, 't3', false);
        const state3 = p3.persist ?? null;

        // Call 4: same fingerprint as call 3 → suppress.
        decisions.push(decideBoundedSync(state3, fpB).kind);

        // Of 4 batch calls, only 2 actually invoke feature sync (Call 1 + Call 3).
        // Without the wrapper all 4 would invoke. Defect: 4 redundant → now 2 meaningful.
        expect(decisions).toEqual(['invoke', 'suppress', 'invoke', 'suppress']);
        expect(decisions.filter((d) => d === 'invoke').length).toBe(2);
    });
});

// ── I/O layer: runBoundedCli, invokeLiveSync, emitResult, file I/O ─────────────────────
//
// Monkey-patches Bun.spawnSync to control subprocess responses and captures
// process.stdout/stderr to verify emitResult output. Uses real temp dirs for
// state file persistence. Covers the same I/O pattern that the workflow
// agent.run integration exercises in production.

/** Capture stdout/stderr.write during a callback. */
function captureOutput<T>(fn: () => T): { out: string; err: string; result: T } {
    const realOut = process.stdout.write.bind(process.stdout);
    const realErr = process.stderr.write.bind(process.stderr);
    let out = '';
    let err = '';
    process.stdout.write = ((s: string) => {
        out += s;
        return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((s: string) => {
        err += s;
        return true;
    }) as typeof process.stderr.write;
    try {
        const result = fn();
        return { out, err, result };
    } finally {
        process.stdout.write = realOut;
        process.stderr.write = realErr;
    }
}

/** Replacement for Bun.spawnSync that responds to known commands. */
type SpawnHandler = (cmd: string[]) => { stdout: string; stderr: string; exitCode: number };

function mockSpawnSync(handler: SpawnHandler): () => void {
    const real = Bun.spawnSync;
    Bun.spawnSync = ((opts: { cmd?: string[] }) => {
        const cmd = Array.isArray(opts?.cmd) ? opts.cmd : [];
        return handler(cmd);
    }) as unknown as typeof Bun.spawnSync;
    return () => {
        Bun.spawnSync = real;
    };
}

describe('runBoundedCli — I/O layer (subprocess mocking)', () => {
    let tmpDir: string;
    let restoreSpawn: (() => void) | null = null;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'fsb-test-'));
    });

    afterEach(() => {
        if (restoreSpawn) restoreSpawn();
        restoreSpawn = null;
        rmSync(tmpDir, { recursive: true, force: true });
    });

    test('--help prints usage, exits 0', () => {
        const { out, result } = captureOutput(() => runBoundedCli(['--help']));
        expect(result.exitCode).toBe(0);
        expect(out).toBe('');
        expect(result.stderr).toContain('Usage:');
    });

    test('no featureId → usage on stderr, exit 1', () => {
        const { result } = captureOutput(() => runBoundedCli(['--json']));
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('Usage:');
    });

    test('pre-check fails (feature show errors) → fallback to live sync', () => {
        // feature show fails → featureContentHash = null → fallback
        restoreSpawn = mockSpawnSync((cmd) => {
            if (cmd.includes('show')) return { stdout: '', stderr: 'error', exitCode: 1 };
            if (cmd.includes('sync')) return { stdout: JSON.stringify(blockedResult), stderr: '', exitCode: 0 };
            return { stdout: '', stderr: '', exitCode: 1 };
        });

        const statePath = blockedStateFile('H9', tmpDir);
        const { err, result } = captureOutput(() => runBoundedCli(['H9', '--run-dir', tmpDir, '--json']));
        expect(result.exitCode).toBe(0);
        // Fallback path still ran feature sync and got blocked → should persist state.
        expect(parseBlockedState(readFileSync(statePath, 'utf8'))).not.toBeNull();
        expect(err).toContain('blocked proposal');
    });

    test('pre-check fails (task list errors) → fallback to live sync', () => {
        // feature show succeeds, task list fails → taskStatusVector = null → fallback
        restoreSpawn = mockSpawnSync((cmd) => {
            if (cmd.includes('show')) return { stdout: JSON.stringify({ content: 'feat' }), stderr: '', exitCode: 0 };
            if (cmd.includes('list')) return { stdout: '', stderr: 'err', exitCode: 1 };
            if (cmd.includes('sync')) return { stdout: JSON.stringify(appliedResult), stderr: '', exitCode: 0 };
            return { stdout: '', stderr: '', exitCode: 1 };
        });

        const { out, result } = captureOutput(() => runBoundedCli(['H9', '--run-dir', tmpDir, '--json']));
        expect(result.exitCode).toBe(0);
        // Applied result → no persistence, no annotation.
        expect(JSON.parse(out).applied).toBe(true);
    });

    test('live sync returns blocked → persists state, emits annotation', () => {
        restoreSpawn = mockSpawnSync((cmd) => {
            if (cmd.includes('show')) return { stdout: JSON.stringify({ content: 'feat' }), stderr: '', exitCode: 0 };
            if (cmd.includes('list'))
                return { stdout: JSON.stringify([{ wbs: '0411', status: 'done' }]), stderr: '', exitCode: 0 };
            if (cmd.includes('sync')) return { stdout: JSON.stringify(blockedResult), stderr: '', exitCode: 0 };
            return { stdout: '', stderr: '', exitCode: 0 };
        });

        const statePath = blockedStateFile('H9', tmpDir);
        const { out, err, result } = captureOutput(() => runBoundedCli(['H9', '--run-dir', tmpDir, '--json']));
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(out).proposal.featureId).toBe('H9');
        expect(err).toContain('blocked proposal');
        // State persisted.
        const stateRaw = readFileSync(statePath, 'utf8');
        expect(parseBlockedState(stateRaw)?.classification).toBe('blocked');
    });

    test('live sync returns no-op → no persistence, no annotation', () => {
        restoreSpawn = mockSpawnSync((cmd) => {
            if (cmd.includes('show')) return { stdout: JSON.stringify({ content: 'feat' }), stderr: '', exitCode: 0 };
            if (cmd.includes('list'))
                return { stdout: JSON.stringify([{ wbs: '0411', status: 'done' }]), stderr: '', exitCode: 0 };
            if (cmd.includes('sync')) return { stdout: JSON.stringify(noopResult), stderr: '', exitCode: 0 };
            return { stdout: '', stderr: '', exitCode: 0 };
        });

        const statePath = blockedStateFile('H9', tmpDir);
        const { err, result } = captureOutput(() => runBoundedCli(['H9', '--run-dir', tmpDir, '--json']));
        expect(result.exitCode).toBe(0);
        expect(err).toBe('');
        // No state file.
        expect(Bun.file(statePath).size).toBe(0);
    });

    test('live sync envelope missing proposal → loud structured failure, no TypeError (review F1)', () => {
        restoreSpawn = mockSpawnSync((cmd) => {
            if (cmd.includes('show')) return { stdout: JSON.stringify({ content: 'feat' }), stderr: '', exitCode: 0 };
            if (cmd.includes('list'))
                return { stdout: JSON.stringify([{ wbs: '0411', status: 'done' }]), stderr: '', exitCode: 0 };
            // Parseable JSON that is NOT a FeatureSyncResult (plain ack, no `proposal`).
            if (cmd.includes('sync')) return { stdout: JSON.stringify({ ok: true }), stderr: '', exitCode: 0 };
            return { stdout: '', stderr: '', exitCode: 0 };
        });

        const statePath = blockedStateFile('H9', tmpDir);
        const { result } = captureOutput(() => runBoundedCli(['H9', '--run-dir', tmpDir, '--json']));
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('"ok":true'); // raw envelope surfaced, not swallowed
        expect(result.stderr).toContain('missing proposal'); // loud reason, not a TypeError
        expect(Bun.file(statePath).size).toBe(0); // nothing persisted from garbage
    });

    test('second call with identical inputs → suppresses (no feature sync invoked)', () => {
        const syncCalls: string[][] = [];
        restoreSpawn = mockSpawnSync((cmd) => {
            if (cmd.includes('sync')) syncCalls.push(cmd);
            if (cmd.includes('show')) return { stdout: JSON.stringify({ content: 'feat' }), stderr: '', exitCode: 0 };
            if (cmd.includes('list'))
                return { stdout: JSON.stringify([{ wbs: '0411', status: 'done' }]), stderr: '', exitCode: 0 };
            if (cmd.includes('sync')) return { stdout: JSON.stringify(blockedResult), stderr: '', exitCode: 0 };
            return { stdout: '', stderr: '', exitCode: 0 };
        });

        const argv = ['H9', '--run-dir', tmpDir, '--json'];

        // Call 1: no prior state → invoke live sync.
        const r1 = captureOutput(() => runBoundedCli(argv));
        expect(r1.err).toContain('blocked proposal');

        // Call 2: identical inputs → suppress (replay), no new sync call.
        const before = syncCalls.length;
        const r2 = captureOutput(() => runBoundedCli(argv));
        expect(syncCalls.length).toBe(before); // no new feature sync
        expect(r2.err).toContain('suppressed');
        expect(r2.result.exitCode).toBe(0);
    });

    test('second call after task status changes → re-invokes (not suppressed)', () => {
        let taskListResponse: object[] = [{ wbs: '0411', status: 'wip' }];
        restoreSpawn = mockSpawnSync((cmd) => {
            if (cmd.includes('show')) return { stdout: JSON.stringify({ content: 'feat' }), stderr: '', exitCode: 0 };
            if (cmd.includes('list')) return { stdout: JSON.stringify(taskListResponse), stderr: '', exitCode: 0 };
            if (cmd.includes('sync')) return { stdout: JSON.stringify(blockedResult), stderr: '', exitCode: 0 };
            return { stdout: '', stderr: '', exitCode: 0 };
        });

        const argv = ['H9', '--run-dir', tmpDir, '--json'];

        // Call 1: task is wip → blocked → persist.
        captureOutput(() => runBoundedCli(argv));

        // Task completes → status vector changes → fingerprint differs.
        taskListResponse = [{ wbs: '0411', status: 'done' }];

        // Call 2: inputs changed → invoke (not suppress).
        const { err, result } = captureOutput(() => runBoundedCli(argv));
        expect(result.exitCode).toBe(0);
        expect(err).toContain('blocked proposal'); // live blocked, not suppressed
        expect(err).not.toContain('suppressed');
    });

    test('live sync fails (non-zero exit) → surfaces stderr verbatim', () => {
        restoreSpawn = mockSpawnSync((cmd) => {
            if (cmd.includes('show')) return { stdout: JSON.stringify({ content: 'feat' }), stderr: '', exitCode: 0 };
            if (cmd.includes('list'))
                return { stdout: JSON.stringify([{ wbs: '0411', status: 'done' }]), stderr: '', exitCode: 0 };
            if (cmd.includes('sync')) return { stdout: '', stderr: 'sync exploded', exitCode: 3 };
            return { stdout: '', stderr: '', exitCode: 0 };
        });

        const { result } = captureOutput(() => runBoundedCli(['H9', '--run-dir', tmpDir, '--json']));
        expect(result.exitCode).toBe(3);
        expect(result.stderr).toContain('sync exploded');
    });

    test('live sync returns unparseable output → surfaces raw stdout', () => {
        restoreSpawn = mockSpawnSync((cmd) => {
            if (cmd.includes('show')) return { stdout: JSON.stringify({ content: 'feat' }), stderr: '', exitCode: 0 };
            if (cmd.includes('list'))
                return { stdout: JSON.stringify([{ wbs: '0411', status: 'done' }]), stderr: '', exitCode: 0 };
            if (cmd.includes('sync')) return { stdout: 'not json', stderr: '', exitCode: 0 };
            return { stdout: '', stderr: '', exitCode: 0 };
        });

        const { result } = captureOutput(() => runBoundedCli(['H9', '--run-dir', tmpDir, '--json']));
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('not json');
    });

    test('text mode (no --json) emits human-readable result line', () => {
        restoreSpawn = mockSpawnSync((cmd) => {
            if (cmd.includes('show')) return { stdout: JSON.stringify({ content: 'feat' }), stderr: '', exitCode: 0 };
            if (cmd.includes('list'))
                return { stdout: JSON.stringify([{ wbs: '0411', status: 'done' }]), stderr: '', exitCode: 0 };
            if (cmd.includes('sync')) return { stdout: JSON.stringify(appliedResult), stderr: '', exitCode: 0 };
            return { stdout: '', stderr: '', exitCode: 0 };
        });

        const { out } = captureOutput(() => runBoundedCli(['H9', '--run-dir', tmpDir]));
        expect(out).toContain('H9:');
        expect(out).toContain('applied=true');
    });

    test('suppressed blocked result in text mode includes suppressed annotation', () => {
        restoreSpawn = mockSpawnSync((cmd) => {
            if (cmd.includes('show')) return { stdout: JSON.stringify({ content: 'feat' }), stderr: '', exitCode: 0 };
            if (cmd.includes('list'))
                return { stdout: JSON.stringify([{ wbs: '0411', status: 'done' }]), stderr: '', exitCode: 0 };
            if (cmd.includes('sync')) return { stdout: JSON.stringify(blockedResult), stderr: '', exitCode: 0 };
            return { stdout: '', stderr: '', exitCode: 0 };
        });

        const argv = ['H9', '--run-dir', tmpDir];

        // Call 1: live blocked.
        captureOutput(() => runBoundedCli(argv));

        // Call 2: suppressed.
        const { err } = captureOutput(() => runBoundedCli(argv));
        expect(err).toContain('suppressed');
    });
});

describe('writeBlockedState / readBlockedState — file I/O', () => {
    let tmpDir: string;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'fsb-io-'));
    });

    afterEach(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    test('runBoundedCli persists and reads blocked state across calls', () => {
        // This is an integration test of the file I/O round-trip via the CLI,
        // covering writeBlockedState (341-348) and readBlockedState (350-358)
        // through the orchestration layer.
        const restore = mockSpawnSync((cmd) => {
            if (cmd.includes('show')) return { stdout: JSON.stringify({ content: 'feat' }), stderr: '', exitCode: 0 };
            if (cmd.includes('list'))
                return { stdout: JSON.stringify([{ wbs: '0411', status: 'done' }]), stderr: '', exitCode: 0 };
            if (cmd.includes('sync')) return { stdout: JSON.stringify(blockedResult), stderr: '', exitCode: 0 };
            return { stdout: '', stderr: '', exitCode: 0 };
        });

        try {
            const argv = ['H9', '--run-dir', tmpDir, '--json'];
            const statePath = blockedStateFile('H9', tmpDir);

            // Before: no state file.
            expect(Bun.file(statePath).size).toBe(0);

            // Call 1: invoke → blocked → persist.
            captureOutput(() => runBoundedCli(argv));
            const raw = readFileSync(statePath, 'utf8');
            const state = parseBlockedState(raw);
            expect(state?.classification).toBe('blocked');
            expect(state?.proposal.featureId).toBe('H9');

            // Call 2: readBlockedState succeeds → suppress.
            const { err } = captureOutput(() => runBoundedCli(argv));
            expect(err).toContain('suppressed');
        } finally {
            restore();
        }
    });
});

describe('writeBlockedState — persistence failure is surfaced, not silent', () => {
    let restoreSpawn: (() => void) | null = null;

    afterEach(() => {
        if (restoreSpawn) restoreSpawn();
        restoreSpawn = null;
    });

    // A silent persistence failure degrades suppression to "invoke every time" — which is
    // indistinguishable from the defect this wrapper exists to fix. The failure must be audible.
    test('unwritable run dir emits a warning and still returns the live result', () => {
        restoreSpawn = mockSpawnSync((cmd) => {
            if (cmd.includes('show')) return { stdout: JSON.stringify({ content: 'feat' }), stderr: '', exitCode: 0 };
            if (cmd.includes('list'))
                return { stdout: JSON.stringify([{ wbs: '0411', status: 'done' }]), stderr: '', exitCode: 0 };
            if (cmd.includes('sync')) return { stdout: JSON.stringify(blockedResult), stderr: '', exitCode: 0 };
            return { stdout: '', stderr: '', exitCode: 0 };
        });

        // /dev/null is a file, so mkdirSync of a child path fails with ENOTDIR.
        const { err, result } = captureOutput(() => runBoundedCli(['H9', '--run-dir', '/dev/null/nope', '--json']));

        expect(err).toContain('could not persist blocked state');
        // The live sync result is still correct and still reported.
        expect(err).toContain('blocked proposal for H9');
        expect(result.exitCode).toBe(0);
    });
});

describe('readVerdictMtimeVector — verdict mtime scanning', () => {
    let tmpDir: string;
    let restoreSpawn: (() => void) | null = null;

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'fsb-verdict-'));
    });

    afterEach(() => {
        if (restoreSpawn) restoreSpawn();
        restoreSpawn = null;
        rmSync(tmpDir, { recursive: true, force: true });
    });

    // These two use REAL verdict files and REAL statSync — not a mocked `stat` subprocess.
    // The original tests mocked the very `stat -f %m` call whose BSD-only syntax was the defect,
    // so they passed on every platform while the verdict signal was silently lost on Linux.
    test('verdict mtime change between calls invalidates suppression', () => {
        restoreSpawn = mockSpawnSync((cmd) => {
            if (cmd.includes('show')) return { stdout: JSON.stringify({ content: 'feat' }), stderr: '', exitCode: 0 };
            if (cmd.includes('list'))
                return { stdout: JSON.stringify([{ wbs: '0411', status: 'done' }]), stderr: '', exitCode: 0 };
            if (cmd.includes('sync')) return { stdout: JSON.stringify(blockedResult), stderr: '', exitCode: 0 };
            return { stdout: '', stderr: '', exitCode: 0 };
        });

        const verdictPath = join(tmpDir, '0411-verdict.json');
        writeFileSync(verdictPath, '{"verdict":"PASS"}');
        utimesSync(verdictPath, new Date(1_700_000_000_000), new Date(1_700_000_000_000));

        const argv = ['H9', '--run-dir', tmpDir, '--json'];

        // Call 1: blocked → persist with the current verdict mtime in the fingerprint.
        captureOutput(() => runBoundedCli(argv));

        // The verdict artifact is rewritten → mtime differs → fingerprint differs → invoke (R3).
        utimesSync(verdictPath, new Date(1_800_000_000_000), new Date(1_800_000_000_000));
        const { err } = captureOutput(() => runBoundedCli(argv));
        expect(err).toContain('blocked proposal');
        expect(err).not.toContain('suppressed');
    });

    test('verdict mtime stable across calls → suppression holds', () => {
        restoreSpawn = mockSpawnSync((cmd) => {
            if (cmd.includes('show')) return { stdout: JSON.stringify({ content: 'feat' }), stderr: '', exitCode: 0 };
            if (cmd.includes('list'))
                return { stdout: JSON.stringify([{ wbs: '0411', status: 'done' }]), stderr: '', exitCode: 0 };
            if (cmd.includes('sync')) return { stdout: JSON.stringify(blockedResult), stderr: '', exitCode: 0 };
            return { stdout: '', stderr: '', exitCode: 0 };
        });

        const verdictPath = join(tmpDir, '0411-verdict.json');
        writeFileSync(verdictPath, '{"verdict":"PASS"}');
        utimesSync(verdictPath, new Date(1_700_000_000_000), new Date(1_700_000_000_000));

        const argv = ['H9', '--run-dir', tmpDir, '--json'];

        // Call 1: blocked → persist.
        captureOutput(() => runBoundedCli(argv));

        // Call 2: all inputs identical → suppress.
        const { err } = captureOutput(() => runBoundedCli(argv));
        expect(err).toContain('suppressed');
    });
});

describe('spur-bin splitting — multi-word bin strings', () => {
    test('spurBin with spaces is split into cmd + args', () => {
        // runSpurJson splits "bun apps/cli/src/index.ts" into ["bun", "apps/cli/src/index.ts"].
        // Verify by capturing what cmd the mock receives.
        const seenCmds: string[][] = [];
        const restore = mockSpawnSync((cmd) => {
            seenCmds.push(cmd);
            if (cmd.includes('show')) return { stdout: JSON.stringify({ content: 'feat' }), stderr: '', exitCode: 0 };
            if (cmd.includes('list'))
                return { stdout: JSON.stringify([{ wbs: '0411', status: 'done' }]), stderr: '', exitCode: 0 };
            if (cmd.includes('sync')) return { stdout: JSON.stringify(noopResult), stderr: '', exitCode: 0 };
            return { stdout: '', stderr: '', exitCode: 0 };
        });

        const tmp = mkdtempSync(join(tmpdir(), 'fsb-bin-'));
        try {
            captureOutput(() =>
                runBoundedCli(['H9', '--run-dir', tmp, '--spur-bin', 'bun apps/cli/src/index.ts', '--json']),
            );
            // At least one call should start with ["bun", "apps/cli/src/index.ts", ...].
            const binCalls = seenCmds.filter((c) => c[0] === 'bun' && c[1] === 'apps/cli/src/index.ts');
            expect(binCalls.length).toBeGreaterThan(0);
        } finally {
            restore();
            rmSync(tmp, { recursive: true, force: true });
        }
    });
});
