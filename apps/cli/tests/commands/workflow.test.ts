/**
 * Thin-wrapper integration tests for apps/cli/src/commands/workflow.ts.
 * Behavioral tests for WorkflowAppService live in packages/app/tests/services/workflow-service.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runWorkflowCommand } from '../../src/commands/workflow';
import { createCliContext } from '../../src/context';
import type { CommandOutput } from '../../src/output';
import { createCapturedOutput, createTempProject } from '../helpers';

const MINIMAL_WORKFLOW_YAML = `name: cli-test-flow
kind: state-machine
initialState: start
states:
  - id: start
  - id: done
transitions:
  - from: start
    to: done
terminalStates:
  - done
`;

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

    test('list subcommand (plain) formats persisted workflow runs', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();
        const ctx = createCliContext({ output, cwd: dir, dbUrl: ':memory:' });

        await runWorkflowCommand('run', ctx, { 'run-id': 'list-run' }, [workflowFile]);
        output.messages.length = 0;
        const exitCode = await runWorkflowCommand('list', ctx, {}, []);

        expect(exitCode).toBe(0);
        expect(output.messages).toEqual(['list-run done cli-test-flow']);
        await rm(dir, { recursive: true, force: true });
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

    test('validate throws when workflow file argument is missing', async () => {
        const ctx = createCliContext({ output: nullOutput(), dbUrl: ':memory:' });
        await expect(runWorkflowCommand('validate', ctx, {}, [])).rejects.toThrow('Workflow file path is required');
    });

    test('validate of a valid workflow reports the workflow name', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();
        const ctx = createCliContext({ output, cwd: dir, dbUrl: ':memory:' });

        const exitCode = await runWorkflowCommand('validate', ctx, {}, [workflowFile]);

        expect(exitCode).toBe(0);
        expect(output.messages).toEqual(['workflow valid: cli-test-flow']);
        await rm(dir, { recursive: true, force: true });
    });

    test('validate json forwards the no-schema flag', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();
        const ctx = createCliContext({ output, cwd: dir, dbUrl: ':memory:' });

        const exitCode = await runWorkflowCommand('validate', ctx, { json: true, 'no-schema': true }, [workflowFile]);

        expect(exitCode).toBe(0);
        expect(JSON.parse(output.messages[0] ?? '{}')).toMatchObject({
            ok: true,
            valid: true,
            workflow: { name: 'cli-test-flow' },
        });
        await rm(dir, { recursive: true, force: true });
    });

    test('run throws when workflow file argument is missing', async () => {
        const ctx = createCliContext({ output: nullOutput(), dbUrl: ':memory:' });
        await expect(runWorkflowCommand('run', ctx, {}, [])).rejects.toThrow('Workflow file path is required');
    });

    test('run subcommand formats a completed workflow in plain mode', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();
        const ctx = createCliContext({ output, cwd: dir, dbUrl: ':memory:' });

        const exitCode = await runWorkflowCommand('run', ctx, { 'run-id': 'plain-run' }, [workflowFile]);

        expect(exitCode).toBe(0);
        expect(output.messages).toEqual(['workflow done: cli-test-flow -> done']);
        await rm(dir, { recursive: true, force: true });
    });

    test('run subcommand writes json for a completed workflow', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();
        const ctx = createCliContext({ output, cwd: dir, dbUrl: ':memory:' });

        const exitCode = await runWorkflowCommand('run', ctx, { json: true, 'run-id': 'json-run' }, [workflowFile]);

        expect(exitCode).toBe(0);
        expect(JSON.parse(output.messages[0] ?? '{}')).toMatchObject({
            status: 'done',
            workflowName: 'cli-test-flow',
            finalState: 'done',
        });
        await rm(dir, { recursive: true, force: true });
    });
});
