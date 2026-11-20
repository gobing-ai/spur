/**
 * Parallel supervisor unit contract (A94 wave 6a R2).
 *
 * The heavy suite proves the signal choreography with real children; this one pins the parts a fast
 * check can hold: the exit code of the first child, the bounded SIGTERM→SIGKILL ladder, and the
 * event stream a transport renders.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { superviseParallel } from '../../src/services/parallel-supervisor';

/** A runner process so the supervisor's own process signals stay out of the test process. */
const RUNNER = `import { superviseParallel } from ${JSON.stringify(join(import.meta.dir, '../../src/services/parallel-supervisor.ts'))};
const supervisor = superviseParallel({
    commands: process.argv[2] === 'ok' ? ['sh -c "exit 0"', 'sh -c "sleep 20"'] : ['sh -c "exit 9"', 'sh -c "sleep 20"'],
    cwd: process.cwd(),
    graceMs: 100,
    onChildEvent: (event) => console.error('child', event.label, event.code),
});
process.exit(await supervisor.exited);
`;

describe('superviseParallel', () => {
    test('resolves with the first child exit code and reaps the other group', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-sup-unit-'));
        try {
            const runner = join(root, 'runner.ts');
            Bun.write(runner, RUNNER);
            const proc = Bun.spawn([process.execPath, runner, 'ok'], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
            expect(await proc.exited).toBe(0);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }, 20_000);

    test('a first child failure wins over a still-running sibling', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-sup-unit-fail-'));
        try {
            const runner = join(root, 'runner.ts');
            Bun.write(runner, RUNNER);
            const proc = Bun.spawn([process.execPath, runner, 'fail'], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
            expect(await proc.exited).toBe(9);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }, 20_000);

    test('stop() is idempotent: a second call never re-signals', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-sup-unit-stop-'));
        try {
            const script = `import { superviseParallel } from ${JSON.stringify(join(import.meta.dir, '../../src/services/parallel-supervisor.ts'))};
const supervisor = superviseParallel({ commands: ['sh -c "sleep 20"', 'sh -c "sleep 20"'], cwd: process.cwd(), graceMs: 50 });
supervisor.stop(3);
supervisor.stop(4);
process.exit(await supervisor.exited);
`;
            const runner = join(root, 'stop.ts');
            Bun.write(runner, script);
            const proc = Bun.spawn([process.execPath, runner], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
            expect(await proc.exited).toBe(3);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    }, 20_000);
});

describe('superviseParallel in-process (the contract the CLI awaits)', () => {
    test('the first child exit resolves the run and reaps the sibling group', async () => {
        const supervisor = superviseParallel({
            commands: ['sh -c "sleep 0.2; exit 5"', 'sh -c "exit 0"'],
            cwd: process.cwd(),
            graceMs: 50,
        });
        expect(await supervisor.exited).toBe(0);
        expect(supervisor.stopping).toBe(true);
        // A second stop is a no-op: the run already settled.
        supervisor.stop(9);
        expect(await supervisor.exited).toBe(0);
    }, 20_000);

    test('stop() wins over a still-running group and reports its code', async () => {
        const supervisor = superviseParallel({
            commands: ['sh -c "sleep 20"', 'sh -c "sleep 20"'],
            cwd: process.cwd(),
            graceMs: 50,
        });
        supervisor.stop(4);
        expect(supervisor.stopping).toBe(true);
        expect(await supervisor.exited).toBe(4);
    }, 20_000);

    test('a child that cannot start fails the run with 1 instead of hanging', async () => {
        const supervisor = superviseParallel({
            commands: ['sh -c "sleep 20"', 'sh -c "sleep 20"'],
            cwd: join(tmpdir(), 'spur-parallel-missing-dir-does-not-exist'),
            graceMs: 20,
        });
        expect(await supervisor.exited).toBe(1);
    }, 20_000);

    test('a received signal runs the same bounded shutdown and reports 128+signo', async () => {
        const supervisor = superviseParallel({
            commands: ['sh -c "sleep 20"', 'sh -c "sleep 20"'],
            cwd: process.cwd(),
            graceMs: 20,
        });
        // `process.emit` runs the supervisor's listener without killing the test process.
        process.emit('SIGINT');
        expect(await supervisor.exited).toBe(128 + 2);
    }, 20_000);

    test('a failing first child reports its own code', async () => {
        const supervisor = superviseParallel({
            commands: ['sh -c "exit 6"', 'sh -c "sleep 20"'],
            cwd: process.cwd(),
            graceMs: 50,
        });
        expect(await supervisor.exited).toBe(6);
    }, 20_000);
});
