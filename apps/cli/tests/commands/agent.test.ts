/**
 * Thin-wrapper integration tests for apps/cli/src/commands/agent.ts.
 * Behavioral tests for AgentService live in packages/app/tests/services/agent-service.test.ts.
 */
import { describe, expect, test } from 'bun:test';
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

    test('list subcommand returns a number', async () => {
        const exitCode = await main(['agent', 'list'], { output: nullOutput() });
        expect(typeof exitCode).toBe('number');
    });

    test('run subcommand with no prompt → exit 1', async () => {
        const exitCode = await main(['agent', 'run'], { output: nullOutput() });
        expect(exitCode).toBe(1);
    });
});
