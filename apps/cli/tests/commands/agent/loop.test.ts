/**
 * Tests for `spur agent` (apps/cli/src/commands/agent/).
 */
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetAgentServiceShimsForTest, AgentCoordinationService } from '@gobing-ai/spur-app';
import { spurConfigSchema } from '@gobing-ai/spur-config';
import { createMigratedDb, type DbAdapter, InboxMessageDao } from '@gobing-ai/spur-domain';
import { AgentDetector } from '@gobing-ai/ts-ai-runner';
import { runAgentLoop } from '../../../src/commands/agent';
import { type CliContext, createCliContext } from '../../../src/context';
import { main } from '../../../src/index';
import type { CommandOutput } from '../../../src/output';

/**
 * CLI-spawning / fingerprint tests: `agent doctor` measures ~1.5s on a quiet host and 7-8s while
 * the agent fleet runs, against bun's 5000ms default — the calibration is recorded here once.
 */
const slowTest = (name: string, fn: () => Promise<void> | void): void => void test(name, fn, 30_000);

function captureOutput(): CommandOutput & { stdout: string[]; stderr: string[] } {
    const stdout: string[] = [];
    const stderr: string[] = [];
    return {
        stdout,
        stderr,
        write: (msg: string) => {
            stdout.push(msg);
        },
        error: (msg: string) => {
            stderr.push(msg);
        },
    };
}

// Warn-once shim markers are process-global; bun batches test files per worker
// process, so never inherit another file's marker state.
beforeEach(() => {
    _resetAgentServiceShimsForTest();
});

// ---------------------------------------------------------------------------
// 0893 R4: doctor availability provenance + usage snapshot, end-to-end through
// main() — the real AgentService renders whatever the project config and the
// producer snapshot contain (no service shims in this describe).
// ---------------------------------------------------------------------------

describe('agent command (main)', () => {
    slowTest('list renders detected agent state through the CLI JSON action', async () => {
        // Installation probes have separate detector coverage. This command
        // fixture must not depend on every coding agent installed on the host.
        const agents = [{ name: 'claude' as const, installed: true, version: '1.0.0', channels: [], error: null }];
        const detect = spyOn(AgentDetector.prototype, 'detectAll').mockResolvedValue(agents);
        const output = captureOutput();
        try {
            const exitCode = await main(['agent', 'list', '--json'], { output });
            expect(exitCode).toBe(0);
            expect(JSON.parse(output.stdout.join(''))).toEqual({ agents });
            expect(detect).toHaveBeenCalledTimes(1);
        } finally {
            detect.mockRestore();
        }
    });

    test('loop subcommand action dispatches correctly', async () => {
        const tempDir = mkdtempSync(join(tmpdir(), 'spur-agent-loop-action-'));
        const db = await createMigratedDb({ url: ':memory:' });
        try {
            const output = captureOutput();
            const ctx = createCliContext({ cwd: tempDir, output, db });
            const team = new AgentCoordinationService(ctx);
            await team.createAgentSpec({ id: 'worker-1', type: 'claude-code', executor: 'claude' });

            const program = new (await import('@commander-js/extra-typings')).Command();
            let exitCode = 0;
            const customCtx = {
                ...ctx,
                setExitCode: (code: number) => {
                    exitCode = code;
                },
                agentService: () =>
                    ({ run: () => Promise.resolve(0) }) as unknown as ReturnType<CliContext['agentService']>,
            };

            const { registerAgentCommand } = await import('../../../src/commands/agent');
            registerAgentCommand(program, customCtx);
            const parsePromise = program.parseAsync([
                'node',
                'test',
                'agent',
                'loop',
                '--spec',
                'worker-1',
                '--poll',
                '1',
            ]);
            setTimeout(() => process.emit('SIGINT'), 10);
            await parsePromise;
            expect(exitCode).toBe(0);
        } finally {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });
});

describe('runAgentLoop', () => {
    let tempDir: string;
    let db: DbAdapter;

    beforeEach(async () => {
        tempDir = mkdtempSync(join(tmpdir(), 'spur-agent-loop-test-'));
        db = await createMigratedDb({ url: ':memory:' });
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    test('loop requires explicit --spec <id>', async () => {
        const output = captureOutput();
        const exitCode = await main(['agent', 'loop'], {
            cwd: tempDir,
            output,
            db,
        });
        // 0542 R3: missing occupant address exits 2, matching the run-level error path.
        expect(exitCode).toBe(2);
    });

    test('runAgentLoop errors when --spec is missing or auto', async () => {
        const output = captureOutput();
        const ctx = createCliContext({ cwd: tempDir, output, db });
        const code1 = await runAgentLoop(ctx, {});
        expect(code1).toBe(2);
        // 0542 R3: the loop addresses the occupant via --spec <id>.
        expect(output.stderr.join('\n')).toContain(
            'agent loop requires an explicit --spec <id> matching a fleet agent spec',
        );

        const output2 = captureOutput();
        const ctx2 = createCliContext({ cwd: tempDir, output: output2, db });
        const code2 = await runAgentLoop(ctx2, { spec: 'auto' });
        expect(code2).toBe(2);
        expect(output2.stderr.join('\n')).toContain(
            'agent loop requires an explicit --spec <id> matching a fleet agent spec',
        );
    });

    test('drain refuses a spec without an executor field, naming the fix (shim removed)', async () => {
        const output = captureOutput();
        const ctx = createCliContext({ cwd: tempDir, output, db });
        const team = new AgentCoordinationService(ctx);
        await team.createAgentSpec({ id: 'legacy-worker', type: 'claude-code' });
        await team.sendMessage('operator', 'legacy-worker', 'Process task #101');
        const run = mock(() => Promise.resolve(0));
        const customCtx = {
            ...ctx,
            agentService: () => ({ run }) as unknown as ReturnType<CliContext['agentService']>,
        };
        let caught = '';
        try {
            await runAgentLoop(customCtx, { spec: 'legacy-worker', poll: '100' }, { maxIterations: 1 });
        } catch (error) {
            caught = error instanceof Error ? error.message : String(error);
        }
        const text = [caught, ...output.stderr].join('\n');
        expect(text).toContain('Spec "legacy-worker" has no executor field');
        expect(text).toContain('executor: <name>');
        expect(run).not.toHaveBeenCalled();
    });

    test('runAgentLoop drains inbox when messages exist and runs agent', async () => {
        const output = captureOutput();
        const ctx = createCliContext({
            cwd: tempDir,
            output,
            db,
            spurConfig: spurConfigSchema.parse({
                agent: { executors: [{ name: 'claude-code', agent: 'claude-code' }] },
            }),
        });
        const team = new AgentCoordinationService(ctx);
        await team.createAgentSpec({ id: 'loop-worker', type: 'claude-code', executor: 'claude-code' });
        await team.sendMessage('operator', 'loop-worker', 'Process task #100');

        const run = mock((prompt: string | undefined) => {
            expect(prompt).toContain('Process task #100');
            return Promise.resolve(0);
        });

        const customCtx = {
            ...ctx,
            agentService: () => ({ run }) as unknown as ReturnType<CliContext['agentService']>,
        };

        // 0839: no sleep seam — the pre-queued message is drained on the `--poll`
        // backstop wake (no ledger event precedes it; R5 keeps the drain bounded).
        const code = await runAgentLoop(customCtx, { spec: 'loop-worker', poll: '100' }, { maxIterations: 1 });
        expect(code).toBe(0);
        expect(run).toHaveBeenCalledTimes(1);
    });

    // 0834 R2/R7: restart with in-flight work through the real call path — the
    // loop reconciles BEFORE its first drain, marks the over-budget row failed
    // (its only write), names the receipt-less row outcome-unknown, and never
    // gates on the report.
    test('0834: loop startup reconciles in-flight work before its first drain', async () => {
        const output = captureOutput();
        const ctx = createCliContext({ cwd: tempDir, output, db });
        const team = new AgentCoordinationService(ctx);
        await team.createAgentSpec({ id: 'reconcile-worker', type: 'claude-code', executor: 'claude' });
        const inbox = new InboxMessageDao(db);
        // In-flight: consumed by a previous drain that never settled (no receipt).
        const stuck = await inbox.enqueue('operator', 'reconcile-worker', 'ambiguous work');
        await inbox.drainPending('reconcile-worker');
        // Over-budget redelivery still waiting in the queue.
        const overBudget = await inbox.enqueue('operator', 'reconcile-worker', 'exhausted work');
        await db.run('UPDATE inbox_messages SET inject_attempts = ?1 WHERE id = ?2', 3, overBudget);

        const run = mock(() => Promise.resolve(0));
        const customCtx = {
            ...ctx,
            agentService: () => ({ run }) as unknown as ReturnType<CliContext['agentService']>,
        };

        const code = await runAgentLoop(customCtx, { spec: 'reconcile-worker', poll: '100' }, { maxIterations: 1 });
        expect(code).toBe(0);
        const stdout = output.stdout.join('\n');
        expect(stdout).toContain('reconcile: scanned=2 unresolved=2 exhausted=1');
        expect(stdout).toContain(`${stuck} outcome-unknown`);
        expect(stdout).toContain(`${overBudget} attempts-exhausted`);
        // The reconciler's only write: the budget row is terminally failed.
        const row = await inbox.getById(overBudget);
        expect(row?.status).toBe('failed');
        expect(row?.injectError).toBe('attempts exhausted after 3 deliveries');
        // Reconciliation preceded dispatch: nothing re-claimed, no agent run.
        expect(run).not.toHaveBeenCalled();
    });

    test('0839: idle backstop wake drains nothing and never runs the agent', async () => {
        const output = captureOutput();
        const ctx = createCliContext({ cwd: tempDir, output, db });
        const team = new AgentCoordinationService(ctx);
        await team.createAgentSpec({ id: 'idle-worker-default-sleep', type: 'claude-code', executor: 'claude' });

        const run = mock(() => Promise.resolve(0));
        const customCtx = {
            ...ctx,
            agentService: () => ({ run }) as unknown as ReturnType<CliContext['agentService']>,
        };

        const code = await runAgentLoop(
            customCtx,
            { spec: 'idle-worker-default-sleep', poll: '1' },
            { maxIterations: 1 },
        );
        expect(code).toBe(0);
        expect(run).toHaveBeenCalledTimes(0);
    });

    test('runAgentLoop loopSleep abort listener clears timer', async () => {
        const output = captureOutput();
        const ctx = createCliContext({ cwd: tempDir, output, db });
        const team = new AgentCoordinationService(ctx);
        await team.createAgentSpec({ id: 'abort-worker', type: 'claude-code', executor: 'claude' });

        const run = mock(() => Promise.resolve(0));
        const customCtx = {
            ...ctx,
            agentService: () => ({ run }) as unknown as ReturnType<CliContext['agentService']>,
        };

        // 0839: the abort cuts the wake wait (no 5s backstop) — the loop exits 0.
        const controller = new AbortController();
        const loopPromise = runAgentLoop(
            customCtx,
            { spec: 'abort-worker', poll: '5000' },
            { signal: controller.signal },
        );
        setTimeout(() => controller.abort(), 10);
        const code = await loopPromise;
        expect(code).toBe(0);
    });

    test('runAgentLoop exits immediately when AbortSignal is pre-aborted', async () => {
        const output = captureOutput();
        const ctx = createCliContext({ cwd: tempDir, output, db });
        const controller = new AbortController();
        controller.abort();

        const code = await runAgentLoop(ctx, { spec: 'worker-1' }, { signal: controller.signal });
        expect(code).toBe(0);
    });
});
