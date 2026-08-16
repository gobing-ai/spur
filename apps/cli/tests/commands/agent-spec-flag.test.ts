/**
 * `--spec <id>` occupant addressing (0542 R1).
 *
 * Lives in its own file so the legacy `--agent <spec-id>` drain tests in
 * agent.test.ts cannot consume the first warning before this file asserts on it.
 * A separate file is NOT a separate process, though — `bun test` batches several
 * files into one worker, so the process-global `warnAgentSpecIdOnce` set can
 * arrive warm (green on macOS, red on Linux CI where batching differs). The
 * `beforeEach` reset below is what actually makes "warns once, second call
 * silent" deterministic.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AgentConfig, TeamService } from '@gobing-ai/spur-app';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import { saveAgentSpec } from '@gobing-ai/ts-ai-runner';
import { _resetAgentFlagShimsForTest, runAgentRun } from '../../src/commands/agent';
import { type CliContext, createCliContext } from '../../src/context';
import type { CommandOutput } from '../../src/output';

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

describe('runAgentRun --spec occupant addressing (0542 R1)', () => {
    // The warn-once marker is process-global and bun batches test files per
    // worker process — never inherit another file's marker state.
    beforeEach(() => _resetAgentFlagShimsForTest());

    async function setupSpecCtx(): Promise<{
        tempDir: string;
        output: CommandOutput & { stdout: string[]; stderr: string[] };
        customCtx: ReturnType<typeof createCliContext>;
        run: ReturnType<typeof mock>;
    }> {
        const tempDir = mkdtempSync(join(tmpdir(), 'spur-agent-spec-flag-'));
        const db = await createMigratedDb({ url: ':memory:' });
        const output = captureOutput();
        const ctx = createCliContext({
            cwd: tempDir,
            output,
            db,
            agentConfig: {
                executors: [{ name: 'codex-sol', agent: 'codex', model: 'gpt-5.6-sol', tier: 'capable-3' }],
            } as AgentConfig,
        });
        await saveAgentSpec(
            {
                id: 'demo-spec',
                name: 'Verifier',
                type: 'codex',
                executor: 'codex-sol',
                workspace: tempDir,
                purpose: 'Second opinion',
                tags: ['team:demo', 'spur:generated'],
                config: { model: 'gpt-5.6-sol' },
            },
            join(tempDir, '.spur', 'agents'),
        );
        const run = mock((_prompt: string | undefined, _flags: Record<string, unknown>) => Promise.resolve(0));
        const customCtx = {
            ...ctx,
            agentService: () => ({ run }) as unknown as ReturnType<CliContext['agentService']>,
        };
        return { tempDir, output, customCtx, run };
    }

    test('--spec <id> --drain drives the drain path with the occupant pin (R1)', async () => {
        const { tempDir, output, customCtx, run } = await setupSpecCtx();
        try {
            const ctx = customCtx as ReturnType<typeof createCliContext>;
            await new TeamService(ctx).sendMessage(null, 'demo-spec', 'Do step 1');
            const code = await runAgentRun('Main task prompt', customCtx, { drain: true, spec: 'demo-spec' });
            expect(code).toBe(0);
            expect(run).toHaveBeenCalledTimes(1);
            const [prompt, flags] = run.mock.calls[0] as [string | undefined, Record<string, unknown>];
            expect(flags['spec-id']).toBe('demo-spec');
            expect(flags.agent).toBe('codex-sol');
            expect(prompt).toContain('Pending messages');
            expect(prompt).toContain('Do step 1');
            // Canonical surface never warns about the legacy flag.
            expect(output.stderr.join('\n')).not.toContain('addressing a team spec via --agent');
        } finally {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('legacy --agent <spec-id> warns once and behaves identically (R1)', async () => {
        const { tempDir, output, customCtx, run } = await setupSpecCtx();
        try {
            const code = await runAgentRun('Main task prompt', customCtx, { drain: true, agent: 'demo-spec' });
            expect(code).toBe(0);
            expect(run).toHaveBeenCalledTimes(1);
            const [, flags] = run.mock.calls[0] as [string | undefined, Record<string, unknown>];
            expect(flags['spec-id']).toBe('demo-spec');
            expect(flags.agent).toBe('codex-sol');
            // Fresh process: the first legacy use warns.
            expect(output.stderr.join('\n')).toContain('addressing a team spec via --agent <spec-id> is deprecated');
            // Second run warns no more (warn-once per process).
            await runAgentRun('again', customCtx, { drain: true, agent: 'demo-spec' });
            expect(output.stderr.join('\n').split('is deprecated').length - 1).toBe(1);
        } finally {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('--spec with an unknown id fails loud without spawning (R1)', async () => {
        const { tempDir, output, customCtx, run } = await setupSpecCtx();
        try {
            const code = await runAgentRun('prompt', customCtx, { drain: true, spec: 'no-such-spec' });
            expect(code).toBe(2);
            expect(run).not.toHaveBeenCalled();
            expect(output.stderr.join('\n')).toContain('--spec "no-such-spec" does not match a team agent spec');
        } finally {
            rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
