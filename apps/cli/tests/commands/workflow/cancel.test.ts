/**
 * Thin-wrapper integration tests for `spur workflow cancel` (apps/cli/src/commands/workflow/cancel.ts).
 * Behavioral tests for WorkflowAppService live in packages/app/tests/services/workflow-service.test.ts.
 */
import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _resetAgentServiceShimsForTest, WorkflowAppService } from '@gobing-ai/spur-app';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import { main } from '../../../src/index';
import { createCapturedOutput, createTempProject, runCli } from '../../helpers';

// Warn-once shim markers (bare-binary, legacy executor) are process-global; bun
// batches test files per worker process — never inherit another file's state.
beforeEach(() => {
    _resetAgentServiceShimsForTest();
});

describe('workflow command (main)', () => {
    test('async run self-records its worker pid; cancel SIGTERMs the whole process group', async () => {
        const cwd = await createTempProject();
        // A workflow whose only step shells a long sleep — a real grandchild of
        // the detached worker, so cancelling must reach beyond the worker itself.
        const wfPath = join(cwd, 'sleeper.yaml');
        await writeFile(
            wfPath,
            [
                'name: sleeper-flow',
                'kind: state-machine',
                'initialState: work',
                'states:',
                '  - id: work',
                '    onEnter:',
                '      - kind: shell',
                '        options:',
                '          command: "sleep 30"',
                '  - id: done',
                'transitions:',
                '  - from: work',
                '    to: done',
                'terminalStates:',
                '  - done',
            ].join('\n'),
        );

        // Launch async via the real CLI subprocess (exercises child_process.spawn
        // detached + SPUR_ASYNC_WORKER plumbing). The launcher exits immediately.
        const started = await runCli(['workflow', 'run', wfPath, '--async', '--json'], cwd);
        expect(started.code).toBe(0);
        const runId = (started.json as { runId?: string } | undefined)?.runId;
        expect(typeof runId).toBe('string');
        if (typeof runId !== 'string') return;

        // Poll the shared file DB until the worker self-records its pid (Defect A:
        // without the fix this stays null forever because the racy launcher write
        // missed the not-yet-created row).
        const db = await createMigratedDb({ url: join(cwd, '.spur', 'spur.db') });
        let pid: number | null = null;
        for (let i = 0; i < 100 && pid == null; i++) {
            const row = await db.queryFirst<{ pid: number | null }>('SELECT pid FROM runs WHERE id = ?', runId);
            pid = row?.pid ?? null;
            if (pid == null) await Bun.sleep(50);
        }
        expect(pid).not.toBeNull();
        if (pid == null) return;

        // The worker (group leader) is alive — `kill(pid, 0)` does not throw.
        expect(() => process.kill(pid, 0)).not.toThrow();

        // Cancel: marks failed AND signals the worker's process group (-pid),
        // reaching the `sleep 30` grandchild (Defect B).
        const cancelled = await runCli(['workflow', 'cancel', runId, '--json'], cwd);
        expect(cancelled.code).toBe(0);
        expect((cancelled.json as { killed?: boolean } | undefined)?.killed).toBe(true);

        // The whole group dies: poll until signalling the group throws ESRCH.
        let groupGone = false;
        for (let i = 0; i < 100 && !groupGone; i++) {
            try {
                process.kill(-pid, 0); // probe the group, no signal sent
                await Bun.sleep(50);
            } catch {
                groupGone = true; // ESRCH — no process in the group remains
            }
        }
        expect(groupGone).toBe(true);

        // Run record is finalized failed.
        const finalRow = await db.queryFirst<{ status: string }>('SELECT status FROM runs WHERE id = ?', runId);
        expect(finalRow?.status).toBe('failed');

        // Safety net: if the worker somehow survived, reap the single pid (not the
        // group — group kill of a non-leader or of pid 0 would hit the test runner).
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            // already gone — fine
        }
        await rm(cwd, { recursive: true, force: true });
    }, 20_000);
    test('cancel without --json reports not_found for nonexistent run', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'cancel', 'nonexistent-run-id'], {
            output,
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(1);
        expect(output.errors).toContain('Run nonexistent-run-id not found.');
    });
});

describe('workflow cancel — text outcomes', () => {
    type CancelResult = Awaited<ReturnType<WorkflowAppService['cancel']>>;
    async function cancelWith(result: Partial<CancelResult>, json = false) {
        const cancel = spyOn(WorkflowAppService.prototype, 'cancel').mockResolvedValue(result as CancelResult);
        try {
            const output = createCapturedOutput();
            const code = await main(['workflow', 'cancel', 'run-7', ...(json ? ['--json'] : [])], {
                output,
                dbUrl: ':memory:',
            });
            return { code, output };
        } finally {
            cancel.mockRestore();
        }
    }

    test('a finalized cancel reports the process-group signal when one was sent', async () => {
        const killed = await cancelWith({ status: 'failed', finalized: true, killed: true });
        expect(killed.code).toBe(0);
        expect(killed.output.messages.at(-1)).toBe(
            'Cancelled run run-7 (marked failed + signalled worker process group).',
        );
        const quiet = await cancelWith({ status: 'failed', finalized: true, killed: false });
        expect(quiet.output.messages.at(-1)).toBe('Cancelled run run-7 (marked failed).');
    });

    test('an already-terminal run is a no-op; --json prints the result as-is', async () => {
        const done = await cancelWith({ status: 'done', finalized: false });
        expect(done.code).toBe(0);
        expect(done.output.messages.at(-1)).toBe('Run run-7 already terminal (done) — no change.');
        const json = await cancelWith({ status: 'not_found', finalized: false }, true);
        expect(json.code).toBe(0);
        expect(JSON.parse(json.output.messages.at(-1) ?? '{}')).toMatchObject({ status: 'not_found' });
    });
});
