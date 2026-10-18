import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVar, removeEnvVar, setEnvVar } from '@gobing-ai/ts-utils';
import {
    acquireGateLock,
    GATE_LOCK_DIR_ENV,
    GATE_LOCK_OFF_ENV,
    GATE_LOCK_POLL_MS_ENV,
    GATE_LOCK_TIMEOUT_MS_ENV,
    GATE_LOCK_TOKEN_ENV,
    GateLockTimeoutError,
    qualityGateMain,
    runLightGate,
    runQualityGate,
} from '../../src/services/quality-gate';

// D65 1235 R1/R2 (restored from task 1127): the host-wide full-gate lock's failure modes, in
// process and without timing luck — every wait is bounded by an explicit
// SPUR_GATE_LOCK_TIMEOUT_MS, so a regression fails here instead of hanging the suite.

const ENV_KEYS = [
    GATE_LOCK_DIR_ENV,
    GATE_LOCK_POLL_MS_ENV,
    GATE_LOCK_OFF_ENV,
    GATE_LOCK_TOKEN_ENV,
    GATE_LOCK_TIMEOUT_MS_ENV,
] as const;

const saved = new Map<string, string | undefined>();
beforeEach(() => {
    for (const key of ENV_KEYS) {
        saved.set(key, getEnvVar(key));
        removeEnvVar(key);
    }
});
afterEach(() => {
    for (const key of ENV_KEYS) setEnvVar(key, saved.get(key));
});

const scratchDirs: string[] = [];
function scratch(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    scratchDirs.push(dir);
    return dir;
}
afterAll(() => {
    for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

/** A lock dir with one claim marker, as a live or dead holder leaves it. */
function claim(lockDir: string, marker: string, pid: number, wbs = 'holder'): void {
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(
        join(lockDir, marker),
        JSON.stringify({ pid, startedAt: Date.now() - 5_000, wbs, runId: 'run-holder', cwd: '/elsewhere' }),
    );
}

/** A pid that has certainly exited: the shell prints its own pid, then exits. */
function deadPid(): number {
    const dead = spawnSync('sh', ['-c', 'echo $$; exit 0']);
    return Number(String(dead.stdout).trim());
}

describe('gate lock (D65 1235)', () => {
    test('acquires under SPUR_GATE_LOCK_DIR and release removes the claim', () => {
        const lockDir = join(scratch('spur-lock-unit-'), 'full-gate.lock');
        setEnvVar(GATE_LOCK_DIR_ENV, lockDir);
        const lock = acquireGateLock({ wbs: '1235' });
        try {
            expect(lock.queueWaitMs).toBeLessThan(500); // uncontended: no wait, no poll
            expect(readdirSync(lockDir)).toEqual([lock.token]);
        } finally {
            lock.release();
        }
        expect(existsSync(lockDir)).toBe(false);
    });

    test('SPUR_GATE_LOCK=off never creates a claim', () => {
        const lockDir = join(scratch('spur-lock-off-'), 'full-gate.lock');
        setEnvVar(GATE_LOCK_DIR_ENV, lockDir);
        setEnvVar(GATE_LOCK_OFF_ENV, 'off');
        const lock = acquireGateLock({ wbs: '1235' });
        lock.release();
        expect(lock.token).toBe('');
        expect(lock.queueWaitMs).toBe(0);
        expect(existsSync(lockDir)).toBe(false);
    });

    test('the live holder token re-enters; a foreign token waits and times out naming the holder', () => {
        const lockDir = join(scratch('spur-lock-token-'), 'full-gate.lock');
        const holderMarker = `${process.pid}-holder`;
        claim(lockDir, holderMarker, process.pid, '1127h');
        setEnvVar(GATE_LOCK_DIR_ENV, lockDir);
        setEnvVar(GATE_LOCK_TOKEN_ENV, holderMarker);
        const reentered = acquireGateLock({ wbs: '1235' });
        // Re-entry: no wait, no write, no release — the parent still owns the claim.
        expect(reentered.token).toBe(holderMarker);
        expect(reentered.queueWaitMs).toBeLessThan(1000);
        reentered.release();
        expect(readdirSync(lockDir)).toEqual([holderMarker]);

        // A token that is not the CURRENT holder's marker is not re-entry: it waits.
        setEnvVar(GATE_LOCK_TOKEN_ENV, `${process.pid}-stale`);
        setEnvVar(GATE_LOCK_TIMEOUT_MS_ENV, '150');
        setEnvVar(GATE_LOCK_POLL_MS_ENV, '50');
        let error: unknown;
        try {
            acquireGateLock({ wbs: '1235' });
        } catch (caught) {
            error = caught;
        }
        expect(error).toBeInstanceOf(GateLockTimeoutError);
        const message = (error as Error).message;
        expect(message).toContain(`pid ${process.pid}`);
        expect(message).toContain('wbs 1127h');
        expect(message).toContain(GATE_LOCK_TIMEOUT_MS_ENV);
    });

    test('a dead holder claim is reclaimed and named in the log', () => {
        const lockDir = join(scratch('spur-lock-dead-'), 'full-gate.lock');
        const pid = deadPid();
        claim(lockDir, `${pid}-stale`, pid);
        setEnvVar(GATE_LOCK_DIR_ENV, lockDir);
        const lines: string[] = [];
        const lock = acquireGateLock({ wbs: '1235' }, (line) => lines.push(line));
        try {
            expect(lines.join('')).toContain(`reclaimed stale claim (pid ${pid})`);
            expect(readdirSync(lockDir)).toEqual([lock.token]);
        } finally {
            lock.release();
        }
    });

    test('a lock dir with no readable claim polls visibly, is never destroyed, then times out', () => {
        const lockDir = join(scratch('spur-lock-junk-'), 'full-gate.lock');
        mkdirSync(lockDir, { recursive: true });
        // Junk can be a live creator between its mkdir and its marker write, so it must never be
        // reclaimed — the waiter reports it and the deadline ends the wait.
        writeFileSync(join(lockDir, 'junk'), 'not a claim');
        setEnvVar(GATE_LOCK_DIR_ENV, lockDir);
        setEnvVar(GATE_LOCK_TIMEOUT_MS_ENV, '120');
        setEnvVar(GATE_LOCK_POLL_MS_ENV, '40');
        const lines: string[] = [];
        let error: unknown;
        try {
            acquireGateLock({ wbs: '1235' }, (line) => lines.push(line));
        } catch (caught) {
            error = caught;
        }
        expect(error).toBeInstanceOf(GateLockTimeoutError);
        expect(lines.join('')).toContain('no readable claim');
        expect((error as Error).message).toContain('no readable claim');
        expect(readdirSync(lockDir)).toEqual(['junk']);
        rmSync(lockDir, { recursive: true, force: true });
    });

    test('run and recheck both take the lock; light and status never do', () => {
        const lockDir = join(scratch('spur-lock-tiers-'), 'full-gate.lock');
        const task = scratch('spur-lock-tiers-task-');
        claim(lockDir, `${process.pid}-live`, process.pid);
        setEnvVar(GATE_LOCK_DIR_ENV, lockDir);
        setEnvVar(GATE_LOCK_TIMEOUT_MS_ENV, '100');
        setEnvVar(GATE_LOCK_POLL_MS_ENV, '25');
        const tree = { cwd: task, captureGitTree: () => ({ ok: true, tree: 'tree-1' }) as const };
        // A held lock refuses both full tiers — they run the same `qualityGateCmd`.
        // Capture every tier's diagnostics so they stay asserted without leaking into the reporter.
        const lines: string[] = [];
        const originalWrite = process.stdout.write;
        process.stdout.write = (chunk: unknown): boolean => {
            lines.push(String(chunk));
            return true;
        };
        try {
            expect(() => runQualityGate('run', { wbs: '1235', qualityGateCmd: 'true' }, tree)).toThrow(
                GateLockTimeoutError,
            );
            expect(() => runQualityGate('recheck', { wbs: '1235', qualityGateCmd: 'true' }, tree)).toThrow(
                GateLockTimeoutError,
            );

            // The lock-free tiers answer while the claim is held.
            expect(runLightGate({ wbs: '1235' }, tree).status).toBe('PASS');
            expect(qualityGateMain(['status'], { wbs: '1235' }, tree)).toBe(0);
        } finally {
            process.stdout.write = originalWrite;
        }
        expect(lines.join('')).toContain('light gate PASS');
        expect(lines.join('')).toContain(JSON.stringify({ reuse: false, reason: 'light-only' }));
    });

    test('a failing gate releases the claim, so the next gate takes it without waiting', () => {
        const lockDir = join(scratch('spur-lock-fail-'), 'full-gate.lock');
        const task = scratch('spur-lock-fail-task-');
        setEnvVar(GATE_LOCK_DIR_ENV, lockDir);
        const options = { cwd: task, captureGitTree: () => ({ ok: true, tree: 'tree-1' }) as const };
        const originalWrite = process.stdout.write;
        process.stdout.write = () => true;
        let verdict: ReturnType<typeof runQualityGate>;
        try {
            verdict = runQualityGate('run', { wbs: '1235', qualityGateCmd: 'exit 1' }, options);
        } finally {
            process.stdout.write = originalWrite;
        }
        expect(verdict.status).toBe('FAIL');
        expect(existsSync(lockDir)).toBe(false);

        const next = acquireGateLock({ wbs: '1235' });
        try {
            expect(next.queueWaitMs).toBeLessThan(1000);
        } finally {
            next.release();
        }
        // 1127 R3: the receipt separates the queue wait from the gate's own runtime. A released
        // claim means no queueing, so the wait stays far below one poll interval — the exact
        // millisecond is a clock artifact under a parallel suite, not the behaviour under test.
        const receipt = JSON.parse(readFileSync(join(task, '.spur/run/1235-check-receipt.json'), 'utf8'));
        expect(receipt.queueWaitMs).toBeLessThan(100);
        expect(receipt.gateRuntimeMs).toBeGreaterThanOrEqual(0);
    });
});
