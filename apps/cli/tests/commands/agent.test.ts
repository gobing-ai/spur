/**
 * Thin-wrapper integration tests for apps/cli/src/commands/agent.ts.
 * Behavioral tests for AgentService live in packages/app/tests/services/agent-service.test.ts.
 */
import { describe, expect, mock, test } from 'bun:test';
import { runAgentRun } from '../../src/commands/agent';
import type { CliContext } from '../../src/context';
import { main } from '../../src/index';
import type { CommandOutput } from '../../src/output';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

describe('agent command (main)', () => {
    test('unknown subcommand returns 1', async () => {
        const exitCode = await main(['agent', 'unknown-cmd'], { output: nullOutput() });
        expect(exitCode).toBe(1);
    });

    test(
        'list subcommand returns a number',
        async () => {
            const exitCode = await main(['agent', 'list'], { output: nullOutput() });
            expect(typeof exitCode).toBe('number');
        },
        { timeout: 15000 },
    );

    test('run subcommand with no prompt → exit 1', async () => {
        const exitCode = await main(['agent', 'run'], { output: nullOutput() });
        expect(exitCode).toBe(1);
    });
});

describe('runAgentRun service wiring (0126)', () => {
    // Regression: runAgentRun must resolve through context.agentService() so the
    // validated `agent` config (executors + phase map) reaches resolution. A bare
    // `new AgentService(...)` here silently drops agentConfig and disables phase-aware auto.
    test('routes through context.agentService(), not a bare service', async () => {
        const run = mock(() => Promise.resolve(0));
        const agentService = mock(() => ({ run }) as unknown as ReturnType<CliContext['agentService']>);
        const context = {
            cwd: process.cwd(),
            env: {},
            output: nullOutput(),
            agentService,
        } as unknown as CliContext;

        const code = await runAgentRun('/sp:dev-run 0126', context, { agent: 'auto' });
        expect(code).toBe(0);
        expect(agentService).toHaveBeenCalledTimes(1);
        expect(run).toHaveBeenCalledWith('/sp:dev-run 0126', { agent: 'auto' }, undefined);
    });
});
