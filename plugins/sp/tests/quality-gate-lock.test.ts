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

// Task 1127 acceptance: these drive the SHIPPED entrypoint (`bun plugins/sp/scripts/quality-gate.ts
// run`) as concurrent host processes against one shared SPUR_GATE_LOCK_DIR — the overlap shape the
// host-wide lock exists to serialize. In-process suites run under tests/setup.ts, which preloads a
// per-process lock dir so ordinary tests never contend with a `spur-check` gate holding the lock.
// Explicit per-test timeouts: each scenario waits out multi-second sleeps on purpose; bun's 5s
// default would kill the test long before the gate child finishes.

const SCRIPT = join(import.meta.dir, '..', 'scripts', 'quality-gate.ts');
const CHILD_TIMEOUT_MS = 120_000;

const dirs: string[] = [];
afterAll(() => {
    if (getEnvVar('SPUR_GATE_LOCK_TEST_KEEP') === '1') return; // keep artifacts for post-mortem
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function scratch(prefix: string, task = true): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    // Only task dirs carry the .spur/run layout — a lock dir must start empty.
    if (task) mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
    dirs.push(dir);
    return dir;
}

interface GateChild {
    pid: number;
    code: Promise<number>;
    /** Unix-second interval [start, end] of the gate command's own execution. */
    interval: Promise<{ start: number; end: number }>;
}

/** Spawn one full-gate run; the gate command stamps its own start/end Unix seconds. */
function spawnGateRun(
    taskDir: string,
    lockDir: string,
    env: Record<string, string>,
    off = false,
    extra: Record<string, string> = {},
): GateChild {
    const cmd = 'echo start $(date +%s); sleep 3; echo end $(date +%s)';
    const child = spawn('bun', [SCRIPT, 'run'], {
        cwd: taskDir,
        env: {
            ...getEnvVars(),
            PATH: getEnvVar('PATH'),
            HOME: getEnvVar('HOME'),
            wbs: env.wbs,
            runId: env.runId,
            proofDigest: env.proofDigest ?? '',
            qualityGateCmd: cmd,
            SPUR_GATE_LOCK_DIR: lockDir,
            SPUR_GATE_LOCK_POLL_MS: env.pollMs ?? '300',
            ...extra,
            ...(off ? { SPUR_GATE_LOCK: 'off' } : {}),
        },
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
        stderr += String(chunk);
    });
    child.stdout.resume(); // drain so the child never stalls on a full pipe
    const code = new Promise<number>((resolve) =>
        child.on('close', (c) => {
            if (c !== 0) process.stderr.write(`[${env.wbs} gate child stderr]\n${stderr}\n`);
            resolve(c ?? 1);
        }),
    );
    // The start/end stamps land in the wbs-scoped gate log too; read them from the child's log
    // once the process closes (stdout may still be buffering when the promise is built).
    const interval = code.then(() => {
        const log = readFileSync(join(taskDir, '.spur', 'run', `${env.wbs}-test-gate.log`), 'utf8');
        return {
            start: Number(/start (\d+)/.exec(log)?.[1] ?? Number.NaN),
            end: Number(/end (\d+)/.exec(log)?.[1] ?? Number.NaN),
        };
    });
    return { pid: child.pid ?? 0, code, interval };
}

function gateLog(taskDir: string, wbs: string): string {
    const path = join(taskDir, '.spur', 'run', `${wbs}-test-gate.log`);
    return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

describe('quality-gate host-wide lock (task 1127)', () => {
    test(
        'AC1: concurrent full-gate runs serialize — disjoint intervals, exactly one holder line',
        async () => {
            const lockDir = scratch('spur-lock-ac1-', false);
            const a = scratch('spur-lock-ac1-a-');
            const b = scratch('spur-lock-ac1-b-');
            const childA = spawnGateRun(a, lockDir, { wbs: '1127a', runId: 'run-a' });
            const childB = spawnGateRun(b, lockDir, { wbs: '1127b', runId: 'run-b' });
            const [codeA, codeB, ivA, ivB] = await Promise.all([
                childA.code,
                childB.code,
                childA.interval,
                childB.interval,
            ]);
            expect(codeA).toBe(0);
            expect(codeB).toBe(0);
            const disjoint = ivA.end <= ivB.start || ivB.end <= ivA.start;
            expect(disjoint).toBe(true);
            const holderLine = /quality gate lock: waiting for holder \((.*)\)\n/.exec(
                gateLog(a, '1127a') + gateLog(b, '1127b'),
            );
            expect(holderLine).not.toBeNull();
            // Exactly one holder line across both runs (AC1), naming the FIRST run's wbs and cwd.
            const first = holderLine?.[1]?.includes('1127a') ? a : b;
            const secondWbs = first === a ? '1127b' : '1127a';
            const text = gateLog(a, '1127a') + gateLog(b, '1127b');
            expect(text.match(/waiting for holder/g)?.length).toBe(1);
            expect(holderLine?.[1]).toContain(`wbs ${first === a ? '1127a' : '1127b'}`);
            expect(holderLine?.[1]).toContain(`cwd ${realpathSync(first)}`);
            // The queued run observes a positive queue wait (AC3's log line is the AC1 receipt twin).
            const queuedLog = gateLog(first === a ? b : a, secondWbs);
            expect(queuedLog).toMatch(/quality gate lock: queueWaitMs=\d+/);
        },
        CHILD_TIMEOUT_MS,
    );

    test('AC1b: a claim whose lock dir was reclaimed underneath it is never held (review P2-1)', async () => {
        const parent = scratch('spur-lock-p21-', false);
        // The lock dir does NOT pre-exist: the creator creates it itself at the top of its hold
        // window, so its appearance is the in-window signal — no timing guesswork.
        const lockDir = join(parent, 'full-gate.lock');
        const task = scratch('spur-lock-p21-t-');
        // The creator pauses between its `mkdir` and its marker write. That is the window a
        // reclaiming waiter exploits: it reads the dir as claimless, removes it and recreates
        // it, so the creator's marker lands in the WAITER's dir. Ownership must therefore be
        // verified, not inferred from "my mkdir succeeded" — otherwise both hold and two gates
        // overlap (R1/AC1). The hold seam is what makes the interleaving deterministic.
        const child = spawnGateRun(task, lockDir, { wbs: '1127p', runId: 'run-p', proofDigest: 'p21' }, false, {
            SPUR_GATE_LOCK_TEST_MKDIR_HOLD_MS: '1500',
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
        const foreign = `${process.pid}-foreign`;
        writeFileSync(
            join(lockDir, foreign),
            JSON.stringify({
                pid: process.pid,
                startedAt: Date.now(),
                wbs: 'foreign',
                runId: 'foreign',
                cwd: process.cwd(),
            }),
        );

        const acquired = await Promise.race([
            child.code.then(() => true),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 6500)),
        ]);
        expect(acquired, 'the creator held the lock from inside a foreign live claim — P2-1 regressed').toBe(false);
        expect(existsSync(join(task, '.spur', 'run', '1127p-check-receipt.json'))).toBe(false);

        // Release the foreign claim: the creator must recover and finish green (no livelock).
        rmSync(join(lockDir, foreign), { force: true });
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
            const lockDir = scratch('spur-lock-ac2-', false);
            const task = scratch('spur-lock-ac2-t-');
            // A real pid that has already exited: the shell prints its own pid, then exits.
            const dead = spawnSync('sh', ['-c', 'echo $$; exit 0']);
            const deadPid = Number(String(dead.stdout).trim());
            expect(deadPid).toBeGreaterThan(0);
            writeFileSync(
                join(lockDir, `${deadPid}-stale`),
                JSON.stringify({
                    pid: deadPid,
                    startedAt: Date.now() - 60_000,
                    wbs: 'ghost',
                    runId: 'ghost',
                    cwd: '/gone',
                }),
            );
            const child = spawnGateRun(task, lockDir, { wbs: '1127s', runId: 'run-s' });
            expect(await child.code).toBe(0);
            const log = gateLog(task, '1127s');
            expect(log).toContain(`reclaimed stale claim (pid ${deadPid})`);
            expect(log).toMatch(/start \d+/); // the gate itself ran after reclaiming
        },
        CHILD_TIMEOUT_MS,
    );

    test(
        'AC3: receipts separate queue wait from gate runtime for first and queued runs',
        async () => {
            const lockDir = scratch('spur-lock-ac3-', false);
            const a = scratch('spur-lock-ac3-a-');
            const b = scratch('spur-lock-ac3-b-');
            const childA = spawnGateRun(a, lockDir, { wbs: '1127a', runId: 'run-a', proofDigest: 'd1' });
            const childB = spawnGateRun(b, lockDir, { wbs: '1127b', runId: 'run-b', proofDigest: 'd1' });
            const [codeA, codeB] = await Promise.all([childA.code, childB.code]);
            expect(codeA).toBe(0);
            expect(codeB).toBe(0);
            const receipts = [
                JSON.parse(readFileSync(join(a, '.spur', 'run', '1127a-check-receipt.json'), 'utf8')),
                JSON.parse(readFileSync(join(b, '.spur', 'run', '1127b-check-receipt.json'), 'utf8')),
            ];
            const queued = receipts.filter((r) => (r.queueWaitMs ?? 0) >= 2500);
            const firsts = receipts.filter((r) => (r.queueWaitMs ?? 0) < 1000);
            expect(queued.length).toBe(1);
            expect(firsts.length).toBe(1);
            for (const receipt of receipts) {
                // The gate command sleeps 3s: runtime is the sleep, not the queue wait (R3).
                expect(receipt.gateRuntimeMs).toBeLessThan(5000);
                expect(receipt.queueWaitMs).toBeNumber();
            }
            expect(queued[0]?.gateRuntimeMs).toBeGreaterThanOrEqual(2500);
            const queuedLog = gateLog(
                queued[0]?.wbs === '1127a' ? a : b,
                queued[0]?.wbs === '1127a' ? '1127a' : '1127b',
            );
            expect(queuedLog).toContain(
                `quality gate lock: queueWaitMs=${queued[0]?.queueWaitMs} gateRuntimeMs=${queued[0]?.gateRuntimeMs}`,
            );
        },
        CHILD_TIMEOUT_MS,
    );

    test(
        'AC6: light and status paths stay lock-free while a full-gate holder is live',
        async () => {
            const lockDir = scratch('spur-lock-ac6l-', false);
            const holder = scratch('spur-lock-ac6l-h-');
            const lightTask = scratch('spur-lock-ac6l-l-');
            const statusTask = scratch('spur-lock-ac6l-s-');
            const holderChild = spawnGateRun(holder, lockDir, { wbs: '1127h', runId: 'run-h' });
            await new Promise((resolve) => setTimeout(resolve, 1000)); // let the holder take the lock
            // Both lock-free modes: the light tier and the receipt-status read.
            const lockFree = async (mode: string, task: string, wbs: string) => {
                const started = Date.now();
                const proc = spawn('bun', [SCRIPT, mode], {
                    cwd: task, // not a git repo: empty scope, trivial PASS — the point is locklessness
                    env: {
                        ...getEnvVars(),
                        PATH: getEnvVar('PATH'),
                        HOME: getEnvVar('HOME'),
                        wbs,
                        SPUR_GATE_LOCK_DIR: lockDir,
                    },
                });
                proc.stdout.resume();
                const code = await new Promise<number>((resolve) => proc.on('close', (c) => resolve(c ?? 1)));
                return { code, wall: Date.now() - started };
            };
            const light = await lockFree('light', lightTask, '1127l');
            const status = await lockFree('status', statusTask, '1127x');
            // The holder's gate sleeps 3s from ~1s before these started: finishing under 2s proves
            // neither mode ever waited on the holder's claim.
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
        'AC5: the gate child re-enters the lock via the exported token — nested acquire < 1s',
        async () => {
            const lockDir = scratch('spur-lock-ac5-', false);
            const task = scratch('spur-lock-ac5-t-');
            const wrapper = join(import.meta.dir, '..', '..', '..', 'scripts', 'commands', 'gate-lock.ts');
            const child = spawn('bun', [SCRIPT, 'run'], {
                cwd: task,
                env: {
                    ...getEnvVars(),
                    PATH: getEnvVar('PATH'),
                    HOME: getEnvVar('HOME'),
                    wbs: '1127n',
                    runId: 'run-n',
                    qualityGateCmd: `bun ${wrapper} -- echo gate-lock-nested-ok`,
                    SPUR_GATE_LOCK_DIR: lockDir,
                    SPUR_GATE_LOCK_POLL_MS: '300',
                },
            });
            child.stdout.resume(); // drain so the child never stalls on a full pipe
            const code = await new Promise<number>((resolve) => child.on('close', (c) => resolve(c ?? 1)));
            expect(code).toBe(0);
            const log = gateLog(task, '1127n');
            expect(log).toContain('gate-lock-nested-ok'); // the nested command ran, not deadlocked
            const acquired = /gate-lock: acquired in (\d+)ms/.exec(log)?.[1];
            expect(acquired).toBeDefined();
            expect(Number(acquired)).toBeLessThan(1000); // re-entry: no wait behind our own holder
            expect(log).not.toContain('waiting for holder');
        },
        CHILD_TIMEOUT_MS,
    );

    test(
        'AC4: SPUR_GATE_LOCK=off restores unlocked behavior — overlapping runs, no lock lines',
        async () => {
            const lockDir = scratch('spur-lock-ac6-', false);
            const a = scratch('spur-lock-ac6-a-');
            const b = scratch('spur-lock-ac6-b-');
            const offA = spawnGateRun(a, lockDir, { wbs: '1127c', runId: 'run-c' }, true);
            const offB = spawnGateRun(b, lockDir, { wbs: '1127d', runId: 'run-d' }, true);
            const [ivA, ivB] = await Promise.all([offA.interval, offB.interval]);
            expect(await offA.code).toBe(0);
            expect(await offB.code).toBe(0);
            // Both gates ran concurrently (overlap) — no serialization happened. Off mode still
            // records zero-cost queue-wait lines; only contention lines must be absent.
            expect(ivA.start).toBeLessThan(ivB.end);
            expect(ivB.start).toBeLessThan(ivA.end);
            const text = gateLog(a, '1127c') + gateLog(b, '1127d');
            expect(text).not.toContain('waiting for holder');
            expect(text).not.toContain('reclaimed stale claim');
        },
        CHILD_TIMEOUT_MS,
    );
});
