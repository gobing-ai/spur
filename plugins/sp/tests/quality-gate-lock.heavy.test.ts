import { afterAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVar, getEnvVars } from '../lib/env';

// Task 1127 acceptance (restored by D65 1235 after f1d3c2caa deleted it): these drive the SHIPPED
// entrypoint (`spur task gate <wbs> <mode>`) as concurrent host processes against one shared
// SPUR_GATE_LOCK_DIR — the overlap shape the host-wide lock exists to serialize. Task 1127 drove
// the retired `scripts/commands/gate-lock.ts` + `plugins/sp/scripts/quality-gate.ts` pair; the
// scenarios are unchanged, the process surface is today's verb.
//
// Isolation: every gate runs in its own scratch git repo (own `.spur`, own `spur.db`, own
// untracked-ignored tree) with a scratch HOME and a per-scenario lock dir. Nothing here can take
// the host lock, touch this worktree's `.spur`, or block a real gate on the operator's machine.
// In-process suites are isolated by the tests/setup.ts preload (per-process SPUR_GATE_LOCK_DIR).
// Explicit per-test timeouts: each scenario waits out multi-second sleeps on purpose; bun's 5s
// default would kill the test long before the gate child finishes.

const CLI = join(import.meta.dir, '..', '..', '..', 'apps', 'cli', 'src', 'index.ts');
const CHILD_TIMEOUT_MS = 120_000;
/** Both runs stamp their own start/end so the test can prove the intervals are disjoint. */
const TIMED_GATE_CMD = 'echo start $(date +%s); sleep 3; echo end $(date +%s)';

const dirs: string[] = [];
afterAll(() => {
    if (getEnvVar('SPUR_GATE_LOCK_TEST_KEEP') === '1') return; // keep artifacts for post-mortem
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function scratch(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    dirs.push(dir);
    return dir;
}

function git(cwd: string, args: string[]): void {
    const result = spawnSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr)}`);
}

/** A scratch git repo (so the gate can bind its tree receipt) with `.spur` kept out of the tree. */
function taskRepo(prefix: string): string {
    const dir = scratch(prefix);
    mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
    git(dir, ['init', '-q', '.']);
    writeFileSync(join(dir, '.gitignore'), '.spur/\n');
    git(dir, ['add', '.gitignore']);
    git(dir, ['-c', 'user.name=gate-lock', '-c', 'user.email=gate-lock@example.invalid', 'commit', '-qm', 'init']);
    return dir;
}

const HOME_DIR = scratch('spur-lock-home-');
const LOCK_TEST_DIR = scratch('spur-lock-dirs-');

function lockDirFor(name: string): string {
    return join(LOCK_TEST_DIR, name, 'full-gate.lock');
}

interface GateChild {
    pid: number;
    code: Promise<number>;
    /** Everything the gate process wrote to stdout/stderr (holder lines, refusals, failures). */
    output(): string;
}

interface GateSpec {
    wbs: string;
    mode?: 'run' | 'recheck' | 'light' | 'status';
    cmd?: string;
    pollMs?: string;
    extra?: Record<string, string>;
}

/** Spawn one gate as a real host process in its own scratch repo. */
function spawnGate(task: string, lockDir: string, spec: GateSpec): GateChild {
    const args = [CLI, 'task', 'gate', spec.wbs, spec.mode ?? 'run'];
    if (spec.cmd !== undefined) args.push('--cmd', spec.cmd);
    const child = spawn('bun', args, {
        cwd: task,
        env: {
            ...getEnvVars(),
            HOME: HOME_DIR,
            SPUR_GATE_LOCK_DIR: lockDir,
            SPUR_GATE_LOCK_POLL_MS: spec.pollMs ?? '300',
            ...spec.extra,
        },
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
        output += String(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
        output += String(chunk);
    });
    const code = new Promise<number>((resolve) => child.on('close', (c) => resolve(c ?? 1)));
    return { pid: child.pid ?? 0, code, output: () => output };
}

function gateLog(task: string, wbs: string): string {
    const path = join(task, '.spur', 'run', `${wbs}-test-gate.log`);
    return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

/** Unix-second interval [start, end] of the gate command's own execution. */
function interval(task: string, wbs: string): { start: number; end: number } {
    const log = gateLog(task, wbs);
    return {
        start: Number(/start (\d+)/.exec(log)?.[1] ?? Number.NaN),
        end: Number(/end (\d+)/.exec(log)?.[1] ?? Number.NaN),
    };
}

function receipt(task: string, wbs: string): { queueWaitMs?: number; gateRuntimeMs?: number } {
    return JSON.parse(readFileSync(join(task, '.spur', 'run', `${wbs}-check-receipt.json`), 'utf8'));
}

/** The lock wait a gate logged before its attempt loop (1127 R3). */
function queueWaitMs(log: string): number {
    return Number(/quality gate lock: queueWaitMs=(\d+)/.exec(log)?.[1] ?? Number.NaN);
}

/** A pid that has certainly exited: the shell prints its own pid, then exits. */
function deadPid(): number {
    const dead = spawnSync('sh', ['-c', 'echo $$; exit 0']);
    return Number(String(dead.stdout).trim());
}

function claim(lockDir: string, marker: string, pid: number, wbs = 'ghost'): void {
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(
        join(lockDir, marker),
        JSON.stringify({ pid, startedAt: Date.now() - 60_000, wbs, runId: 'run-ghost', cwd: '/gone' }),
    );
}

describe('quality-gate host-wide lock (task 1127, restored by D65 1235)', () => {
    test(
        'AC1: concurrent full-gate runs serialize — disjoint intervals, exactly one holder line',
        async () => {
            const lockDir = lockDirFor('ac1');
            const a = taskRepo('spur-lock-ac1-a-');
            const b = taskRepo('spur-lock-ac1-b-');
            const childA = spawnGate(a, lockDir, { wbs: '1127a', cmd: TIMED_GATE_CMD });
            const childB = spawnGate(b, lockDir, { wbs: '1127b', cmd: TIMED_GATE_CMD });
            const [codeA, codeB] = await Promise.all([childA.code, childB.code]);
            expect(codeA).toBe(0);
            expect(codeB).toBe(0);

            // R1: the two gate commands never ran beside each other.
            const [ivA, ivB] = [interval(a, '1127a'), interval(b, '1127b')];
            expect(ivA.end <= ivB.start || ivB.end <= ivA.start).toBe(true);

            const text = gateLog(a, '1127a') + gateLog(b, '1127b');
            const holderLine = /quality gate lock: waiting for holder \((.*)\)\n/.exec(text);
            expect(holderLine).not.toBeNull();
            // Exactly one holder line across both runs, naming the FIRST run's wbs and cwd.
            expect(text.match(/waiting for holder/g)?.length).toBe(1);
            const first = holderLine?.[1]?.includes('wbs 1127a') ? a : b;
            const firstWbs = first === a ? '1127a' : '1127b';
            expect(holderLine?.[1]).toContain(`wbs ${firstWbs}`);
            expect(holderLine?.[1]).toContain(`cwd ${realpathSync(first)}`);
            // The queued run observed a positive queue wait.
            expect(queueWaitMs(gateLog(first === a ? b : a, first === a ? '1127b' : '1127a'))).toBeGreaterThanOrEqual(
                2000,
            );
            // Release removed the claim, so a later gate finds no wreckage.
            expect(existsSync(lockDir)).toBe(false);
        },
        CHILD_TIMEOUT_MS,
    );

    test('AC1b: a claim whose lock dir was reclaimed underneath it is never held (1127 review P2-1)', async () => {
        // The lock dir does NOT pre-exist: the creator creates it itself at the top of its hold
        // window, so its appearance is the in-window signal — no timing guesswork.
        const lockDir = lockDirFor('p21');
        const task = taskRepo('spur-lock-p21-t-');
        // The creator pauses between its `mkdir` and its marker write. That is the window a
        // reclaiming waiter exploits: it reads the dir as claimless, removes it and recreates
        // it, so the creator's marker lands in the WAITER's dir. Ownership must therefore be
        // verified, not inferred from "my mkdir succeeded" — otherwise both hold and two gates
        // overlap (R1/AC1). The hold seam is what makes the interleaving deterministic.
        const child = spawnGate(task, lockDir, {
            wbs: '1127p',
            cmd: 'echo p21-ran',
            extra: { SPUR_GATE_LOCK_TEST_MKDIR_HOLD_MS: '1500' },
        });
        const deadline = Date.now() + 10_000;
        while (!existsSync(lockDir) && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(existsSync(lockDir), 'the creator never created its lock dir').toBe(true);
        let reclaimed = true;
        let reclaimError = '';
        try {
            rmdirSync(lockDir);
            mkdirSync(lockDir);
        } catch (error) {
            reclaimed = false;
            reclaimError = error instanceof Error ? error.message : String(error);
        }
        expect(
            reclaimed,
            `could not swap the claimless dir (${reclaimError}) — the mkdir→marker hold seam is missing`,
        ).toBe(true);
        // A LIVE foreign claim (this test process) now sits in the dir the creator writes into.
        claim(lockDir, `${process.pid}-foreign`, process.pid, 'foreign');

        const finished = await Promise.race([
            child.code.then(() => true),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 6500)),
        ]);
        expect(finished, 'the creator held the lock from inside a foreign live claim — P2-1 regressed').toBe(false);
        expect(existsSync(join(task, '.spur', 'run', '1127p-check-receipt.json'))).toBe(false);

        // Release the foreign claim: the creator must recover and finish green (no livelock).
        rmSync(join(lockDir, `${process.pid}-foreign`), { force: true });
        try {
            rmdirSync(lockDir);
        } catch {
            // Already gone, or the creator's own re-mkdir owns it now.
        }
        expect(await child.code).toBe(0);
        expect(existsSync(join(task, '.spur', 'run', '1127p-check-receipt.json'))).toBe(true);
    }, 30_000);

    test(
        'AC2: a dead holder is reclaimed with its pid logged and the gate still runs',
        async () => {
            const lockDir = lockDirFor('ac2');
            const task = taskRepo('spur-lock-ac2-t-');
            const pid = deadPid();
            expect(pid).toBeGreaterThan(0);
            claim(lockDir, `${pid}-stale`, pid);
            const child = spawnGate(task, lockDir, { wbs: '1127s', cmd: 'echo gate-ran' });
            expect(await child.code).toBe(0);
            const log = gateLog(task, '1127s');
            expect(log).toContain(`reclaimed stale claim (pid ${pid})`);
            expect(log).toContain('gate-ran'); // the gate itself ran after reclaiming
        },
        CHILD_TIMEOUT_MS,
    );

    test('AC2b: a dead creator’s unreadable claim is reclaimed by its marker-name pid, not waited on forever', async () => {
        const lockDir = lockDirFor('ac2b');
        const task = taskRepo('spur-lock-ac2b-t-');
        const pid = deadPid();
        expect(pid).toBeGreaterThan(0);
        // A creator that crashed mid-write: the marker exists, its JSON is truncated.
        mkdirSync(lockDir, { recursive: true });
        writeFileSync(join(lockDir, `${pid}-torn`), '{"pid":');
        const child = spawnGate(task, lockDir, { wbs: '1127t', cmd: 'echo gate-ran' });
        expect(await child.code).toBe(0);
        const log = gateLog(task, '1127t');
        expect(log).toContain(`reclaimed stale claim (pid ${pid})`);
        expect(log).not.toContain('no readable claim');
        expect(log).toContain('gate-ran');
    }, 30_000);

    test(
        'AC3: receipts separate queue wait from gate runtime for first and queued runs',
        async () => {
            const lockDir = lockDirFor('ac3');
            const a = taskRepo('spur-lock-ac3-a-');
            const b = taskRepo('spur-lock-ac3-b-');
            const childA = spawnGate(a, lockDir, { wbs: '1127a', cmd: TIMED_GATE_CMD });
            const childB = spawnGate(b, lockDir, { wbs: '1127b', cmd: TIMED_GATE_CMD });
            const [codeA, codeB] = await Promise.all([childA.code, childB.code]);
            expect(codeA).toBe(0);
            expect(codeB).toBe(0);
            const receipts = [receipt(a, '1127a'), receipt(b, '1127b')];
            const queued = receipts.filter((r) => (r.queueWaitMs ?? 0) >= 2500);
            const firsts = receipts.filter((r) => (r.queueWaitMs ?? 0) < 1000);
            expect(queued.length).toBe(1);
            expect(firsts.length).toBe(1);
            for (const row of receipts) {
                // The gate command sleeps 3s: runtime is the sleep, not the queue wait (1127 R3).
                expect(row.gateRuntimeMs).toBeLessThan(5000);
                expect(row.queueWaitMs).toBeNumber();
            }
            expect(queued[0]?.gateRuntimeMs).toBeGreaterThanOrEqual(2500);
        },
        CHILD_TIMEOUT_MS,
    );

    test(
        'AC6: light and status paths stay lock-free while a full-gate holder is live',
        async () => {
            const lockDir = lockDirFor('ac6l');
            const holder = taskRepo('spur-lock-ac6l-h-');
            const lightTask = taskRepo('spur-lock-ac6l-l-');
            const statusTask = taskRepo('spur-lock-ac6l-s-');
            const holderChild = spawnGate(holder, lockDir, { wbs: '1127h', cmd: TIMED_GATE_CMD });
            await new Promise((resolve) => setTimeout(resolve, 1000)); // let the holder take the lock

            const timed = async (spec: GateSpec, task: string): Promise<{ code: number; wall: number }> => {
                const started = Date.now();
                const code = await spawnGate(task, lockDir, spec).code;
                return { code, wall: Date.now() - started };
            };
            const light = await timed({ wbs: '1127l', mode: 'light' }, lightTask);
            const status = await timed({ wbs: '1127x', mode: 'status' }, statusTask);
            // The holder's gate sleeps 3s from ~1s before these started: finishing under 2s proves
            // neither tier ever waited on the holder's claim (R4/probe scope).
            expect(light.code).toBe(0);
            expect(light.wall).toBeLessThan(2000);
            expect(status.code).toBe(0);
            expect(status.wall).toBeLessThan(2000);
            expect(gateLog(lightTask, '1127l')).not.toContain('waiting for holder');
            expect(gateLog(statusTask, '1127x')).not.toContain('waiting for holder');
            expect(await holderChild.code).toBe(0);
        },
        CHILD_TIMEOUT_MS,
    );

    test(
        'AC5: a nested gate re-enters via the exported token; a foreign token does not',
        async () => {
            const lockDir = lockDirFor('ac5');
            const task = taskRepo('spur-lock-ac5-t-');
            // The outer gate's own command runs another full gate. Only the current holder's
            // marker may re-enter (SPUR_GATE_LOCK_TOKEN), so this must not deadlock on itself.
            const nested = `bun ${CLI} task gate 1127z run --cmd 'echo nested-ok'; echo outer-done`;
            const child = spawnGate(task, lockDir, { wbs: '1127n', cmd: nested });
            expect(await child.code).toBe(0);
            // The gate's own command ran to completion — a nested gate that waited on its own
            // parent's claim would deadlock here, so reaching 'outer-done' IS the re-entry proof.
            expect(gateLog(task, '1127n')).toContain('outer-done');
            const nestedLog = gateLog(task, '1127z');
            expect(nestedLog).toContain('nested-ok');
            // Re-entry: the nested gate acquired at once instead of queueing behind the outer holder.
            expect(queueWaitMs(nestedLog)).toBeLessThan(500);
            expect(`${gateLog(task, '1127n')}${nestedLog}`).not.toContain('waiting for holder');
        },
        CHILD_TIMEOUT_MS,
    );

    test(
        'AC4: SPUR_GATE_LOCK=off restores unlocked behavior — overlapping runs, no lock lines',
        async () => {
            const lockDir = lockDirFor('ac4');
            const a = taskRepo('spur-lock-ac4-a-');
            const b = taskRepo('spur-lock-ac4-b-');
            const offA = spawnGate(a, lockDir, { wbs: '1127c', cmd: TIMED_GATE_CMD, extra: { SPUR_GATE_LOCK: 'off' } });
            const offB = spawnGate(b, lockDir, { wbs: '1127d', cmd: TIMED_GATE_CMD, extra: { SPUR_GATE_LOCK: 'off' } });
            expect(await offA.code).toBe(0);
            expect(await offB.code).toBe(0);
            // Both gates ran concurrently (overlap) — no serialization happened.
            const [ivA, ivB] = [interval(a, '1127c'), interval(b, '1127d')];
            expect(ivA.start).toBeLessThan(ivB.end);
            expect(ivB.start).toBeLessThan(ivA.end);
            const text = gateLog(a, '1127c') + gateLog(b, '1127d');
            expect(text).not.toContain('waiting for holder');
            expect(text).not.toContain('reclaimed stale claim');
        },
        CHILD_TIMEOUT_MS,
    );

    test(
        'AC7: a failing gate releases the claim — the next gate starts without waiting',
        async () => {
            const lockDir = lockDirFor('ac7');
            const task = taskRepo('spur-lock-ac7-t-');
            const failed = spawnGate(task, lockDir, { wbs: '1127f', cmd: 'echo red; exit 1' });
            expect(await failed.code).toBe(1);
            expect(existsSync(lockDir), 'the failed gate stranded its claim').toBe(false);

            const next = spawnGate(task, lockDir, { wbs: '1127g', cmd: 'echo green' });
            expect(await next.code).toBe(0);
            const log = gateLog(task, '1127g');
            expect(queueWaitMs(log)).toBeLessThan(500);
            expect(log).toContain('green');
        },
        CHILD_TIMEOUT_MS,
    );

    test(
        'AC8: a cancelled gate leaves only a dead-pid claim, which the next gate reclaims',
        async () => {
            const lockDir = lockDirFor('ac8');
            const task = taskRepo('spur-lock-ac8-t-');
            const cancelled = spawnGate(task, lockDir, { wbs: '1127k', cmd: 'echo start $(date +%s); sleep 5' });
            const deadline = Date.now() + 10_000;
            while (!existsSync(lockDir) && Date.now() < deadline) {
                await new Promise((resolve) => setTimeout(resolve, 20));
            }
            expect(existsSync(lockDir), 'the gate never took the lock').toBe(true);
            expect(cancelled.pid).toBeGreaterThan(0);
            process.kill(cancelled.pid, 'SIGTERM');
            await cancelled.code;
            // Cancel is not a release path: the claim survives with a dead pid, so the next gate
            // reclaims it instead of waiting for a pid that will never release.
            const next = spawnGate(task, lockDir, { wbs: '1127m', cmd: 'echo recovered' });
            expect(await next.code).toBe(0);
            const log = gateLog(task, '1127m');
            expect(log).toContain(`reclaimed stale claim (pid ${cancelled.pid})`);
            expect(log).toContain('recovered');
        },
        CHILD_TIMEOUT_MS,
    );

    test(
        'AC9: a bounded waiter fails closed, naming the holder, instead of running beside it',
        async () => {
            const lockDir = lockDirFor('ac9');
            const task = taskRepo('spur-lock-ac9-t-');
            claim(lockDir, `${process.pid}-holder`, process.pid, 'live-holder');
            const child = spawnGate(task, lockDir, {
                wbs: '1127w',
                cmd: 'echo should-not-run',
                extra: { SPUR_GATE_LOCK_TIMEOUT_MS: '300' },
            });
            expect(await child.code).toBe(2); // fail closed: exit 2 (BLOCKED), never a gate verdict
            expect(child.output()).toContain('timed out');
            expect(child.output()).toContain(`pid ${process.pid}`);
            expect(child.output()).toContain('wbs live-holder');
            expect(gateLog(task, '1127w')).not.toContain('should-not-run');
        },
        CHILD_TIMEOUT_MS,
    );
});
