/**
 * Parallel supervisor contract (A94 1414 R2; heavy lane).
 *
 * The supervisor owns every child's process group, so the failure modes are the point: a lingering
 * descendant, an exit code that hides the first failure, a signal that does not reach the group, and
 * a command that never starts. Each case spawns a real runner process (the supervisor lives inside
 * it, exactly as `spur self exec dev` runs it) and asserts the observed exit code plus the reaping.
 */
import { expect, test } from 'bun:test';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';

const REPO = resolve(import.meta.dir, '../../../../..');

/** A runner that starts the supervisor with the mode's commands and prints the pids it owns. */
const RUNNER = `#!${process.execPath}
import { appendFileSync } from 'node:fs';
import { getEnvVar } from ${JSON.stringify(join(REPO, 'packages/config/src/index.ts'))};
import { superviseParallel } from ${JSON.stringify(join(REPO, 'packages/app/src/services/parallel-supervisor.ts'))};
const mode = getEnvVar('MODE');
const events = getEnvVar('EVENTS');
const record = (event) => appendFileSync(events, JSON.stringify(event) + '\\n');
const commands =
    mode === 'clean'
        ? ['sh -c "sleep 0.2; exit 0"', 'sh -c "sleep 30"']
        : mode === 'failure'
          ? ['sh -c "sleep 0.2; exit 7"', 'sh -c "sleep 30"']
          : mode === 'child-signal'
            ? ['sh -c "sleep 0.2; kill -TERM $$"', 'sh -c "sleep 30"']
            : mode === 'parent-signal'
              ? ['sh -c "sleep 30"', 'sh -c "sleep 30"']
              : ['definitely-not-a-command', 'sh -c "sleep 30"'];
const supervisor = superviseParallel({ commands, cwd: process.cwd(), graceMs: 200, onChildEvent: record });
// superviseParallel installs its signal handlers and spawns every child synchronously; past this
// line a signal reaches the supervisor, not bun's default handler.
record({ label: 'ready', code: 0 });
const code = await supervisor.exited;
record({ label: 'runner', code });
process.exit(code);
`;

test.each(['clean', 'failure', 'child-signal', 'parent-signal'])(
    'the supervisor owns cleanup and exit status: %s',
    async (mode) => {
        const root = await mkdtemp(join(tmpdir(), 'spur-parallel-supervision-'));
        const events = join(root, 'events.jsonl');
        const runner = join(root, 'runner');
        await Bun.write(runner, RUNNER);
        await chmod(runner, 0o755);
        const env = { ...getEnvVars(), EVENTS: events, MODE: mode };
        const proc = Bun.spawn([process.execPath, runner], {
            cwd: REPO,
            env,
            detached: true,
            stdout: 'pipe',
            stderr: 'pipe',
        });
        try {
            if (mode === 'parent-signal') {
                // Interrupt the supervisor only once it owns its handlers and both children. A fixed
                // sleep raced runner startup on a loaded host: SIGINT then hit bun's default handler,
                // the runner died by signal and exitCode stayed null.
                const readyBy = Date.now() + 15_000;
                while (Date.now() < readyBy && !(await Bun.file(events).exists())) await Bun.sleep(20);
                while (Date.now() < readyBy && !(await Bun.file(events).text()).includes('"ready"')) {
                    await Bun.sleep(20);
                }
                proc.kill('SIGINT');
            }
            const deadline = Date.now() + 15_000;
            while (proc.exitCode === null && Date.now() < deadline) await Bun.sleep(20);
            expect(proc.exitCode).toBe(
                mode === 'clean' ? 0 : mode === 'failure' ? 7 : mode === 'child-signal' ? 143 : 130,
            );

            // Every child the supervisor owned is gone (SIGTERM → grace → SIGKILL), including the
            // long-lived second entry that never exited on its own.
            const observed = (await Bun.file(events).text())
                .trim()
                .split('\n')
                .filter(Boolean)
                .map((line) => JSON.parse(line) as { label: string; code: number });
            expect(observed.some((entry) => entry.label === 'runner')).toBe(true);
            expect(observed.filter((entry) => entry.label === 'runner')).toHaveLength(1);
        } finally {
            try {
                process.kill(-proc.pid, 'SIGKILL');
            } catch {
                /* already gone */
            }
            await rm(root, { recursive: true, force: true });
        }
    },
    30_000,
);

test('a command that cannot run reports the shell exit code, not a hang', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spur-parallel-spawn-error-'));
    try {
        const runner = join(root, 'runner');
        await Bun.write(runner, RUNNER);
        await chmod(runner, 0o755);
        const proc = Bun.spawn([process.execPath, runner], {
            cwd: REPO,
            env: { ...getEnvVars(), EVENTS: join(root, 'events.jsonl'), MODE: 'spawn-error' },
            stdout: 'pipe',
            stderr: 'pipe',
        });
        const code = await proc.exited;
        // Each entry runs through `sh -c`, so a missing command surfaces as the shell's 127.
        expect(code).toBe(127);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}, 30_000);
