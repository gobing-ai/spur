/**
 * Thin-wrapper integration tests for apps/cli/src/commands/agent.ts.
 * Behavioral tests for AgentService live in packages/app/tests/services/agent-service.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { runAgentCommand } from '../../src/commands/agent';
import { createCliContext } from '../../src/context';
import type { CommandOutput } from '../../src/output';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

describe('runAgentCommand dispatch', () => {
    test('unknown subcommand returns 1', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const exitCode = await runAgentCommand('unknown-cmd', ctx, {}, []);
        expect(exitCode).toBe(1);
    });

    test('list subcommand returns a number', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const exitCode = await runAgentCommand('list', ctx, {}, []);
        expect(typeof exitCode).toBe('number');
    });

    test('run subcommand with no prompt → exit 2', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const exitCode = await runAgentCommand('run', ctx, {}, []);
        expect(exitCode).toBe(2);
    });
});
