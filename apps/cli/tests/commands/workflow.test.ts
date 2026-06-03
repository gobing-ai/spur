/**
 * Thin-wrapper integration tests for apps/cli/src/commands/workflow.ts.
 * Behavioral tests for WorkflowAppService live in packages/app/tests/services/workflow-service.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { runWorkflowCommand } from '../../src/commands/workflow';
import { createCliContext } from '../../src/context';
import type { CommandOutput } from '../../src/output';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

describe('runWorkflowCommand dispatch', () => {
    test('unknown subcommand returns 1', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const exitCode = await runWorkflowCommand('unknown-cmd', ctx, {}, []);
        expect(exitCode).toBe(1);
    });

    test('no subcommand prints usage and returns 1', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const exitCode = await runWorkflowCommand(undefined, ctx, {}, []);
        expect(exitCode).toBe(1);
    });

    test('list subcommand (json) returns 0', async () => {
        const ctx = createCliContext({ output: nullOutput(), dbUrl: ':memory:' });
        const exitCode = await runWorkflowCommand('list', ctx, { json: true }, []);
        expect(exitCode).toBe(0);
    });

    test('list subcommand (plain) formats an empty run list', async () => {
        const lines: string[] = [];
        const ctx = createCliContext({
            output: { write: (m) => lines.push(m), error: () => {} },
            dbUrl: ':memory:',
        });
        const exitCode = await runWorkflowCommand('list', ctx, {}, []);
        expect(exitCode).toBe(0);
        expect(lines).toContain('No workflow runs.');
    });

    test('validate of a missing file (plain) returns 1 and reports invalid', async () => {
        const errors: string[] = [];
        const ctx = createCliContext({
            output: { write: () => {}, error: (m) => errors.push(m) },
            dbUrl: ':memory:',
        });
        const exitCode = await runWorkflowCommand('validate', ctx, {}, ['/tmp/spur-missing-workflow.yaml']);
        expect(exitCode).toBe(1);
        expect(errors.some((e) => e.startsWith('workflow invalid:'))).toBe(true);
    });

    test('validate of a missing file (json) returns 1', async () => {
        const ctx = createCliContext({ output: nullOutput(), dbUrl: ':memory:' });
        const exitCode = await runWorkflowCommand('validate', ctx, { json: true }, ['/tmp/spur-missing-workflow.yaml']);
        expect(exitCode).toBe(1);
    });
});
