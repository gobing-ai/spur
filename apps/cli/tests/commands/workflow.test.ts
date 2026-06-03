import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runWorkflowCommand } from '../../src/commands/workflow';
import { createCliContext } from '../../src/context';
import type { CommandOutput } from '../../src/output';

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

function captureOutput(): { output: CommandOutput; lines: string[]; errors: string[] } {
    const lines: string[] = [];
    const errors: string[] = [];
    return {
        lines,
        errors,
        output: { write: (m: string) => lines.push(m), error: (m: string) => errors.push(m) },
    };
}

const MINIMAL_WORKFLOW_YAML = `name: test-flow
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

describe('workflow command', () => {
    test('no subcommand shows usage', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const exitCode = await runWorkflowCommand(undefined, ctx, {}, []);
        expect(exitCode).toBe(1);
    });

    test('invalid subcommand shows usage', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        const exitCode = await runWorkflowCommand('unknown', ctx, {}, []);
        expect(exitCode).toBe(1);
    });

    test('validate subcommand parses workflow file', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-wf-test-'));
        const path = join(dir, 'test.yaml');
        await writeFile(path, MINIMAL_WORKFLOW_YAML);

        const { lines, output } = captureOutput();
        const ctx = createCliContext({ output });
        const exitCode = await runWorkflowCommand('validate', ctx, {}, [path]);
        expect(exitCode).toBe(0);
        expect(lines.some((l) => l.includes('workflow valid'))).toBe(true);
        await rm(dir, { recursive: true });
    });

    test('validate with --json returns JSON', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-wf-test-'));
        const path = join(dir, 'test.yaml');
        await writeFile(path, MINIMAL_WORKFLOW_YAML);

        const { lines, output } = captureOutput();
        const ctx = createCliContext({ output });
        const exitCode = await runWorkflowCommand('validate', ctx, { json: true }, [path]);
        expect(exitCode).toBe(0);
        expect(lines.some((l) => l.includes('"ok"'))).toBe(true);
        await rm(dir, { recursive: true });
    });

    test('validate with missing file throws', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        await expect(runWorkflowCommand('validate', ctx, {}, [])).rejects.toThrow('Workflow file path is required');
    });

    test('validate reports a non-existent file as invalid with exit 1', async () => {
        const { lines, output } = captureOutput();
        const ctx = createCliContext({ output });
        const exitCode = await runWorkflowCommand('validate', ctx, { json: true }, ['/tmp/no-such-workflow.yaml']);
        expect(exitCode).toBe(1);
        // JSON output (even when invalid) goes to stdout for machine consumption.
        expect(JSON.parse(lines.at(-1) ?? '{}')).toMatchObject({ valid: false });
        expect(lines.at(-1)).toContain('File not found');
    });

    test('validate reports invalid workflow as human-readable text on stderr', async () => {
        const { errors, output } = captureOutput();
        const ctx = createCliContext({ output });
        const exitCode = await runWorkflowCommand('validate', ctx, {}, ['/tmp/no-such-workflow-human.yaml']);
        expect(exitCode).toBe(1);
        expect(errors.at(-1)).toContain('workflow invalid');
        expect(errors.at(-1)).toContain('File not found');
    });

    test('validate reports a workflow with an unknown transition target as invalid', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-wf-bad-'));
        const path = join(dir, 'bad.yaml');
        await writeFile(
            path,
            [
                'name: broken',
                'kind: state-machine',
                'initialState: start',
                'states:',
                '  - id: start',
                '  - id: done',
                'transitions:',
                '  - from: start',
                '    to: ghost',
                'terminalStates: [done]',
            ].join('\n'),
        );
        const { lines, output } = captureOutput();
        const ctx = createCliContext({ output });
        const exitCode = await runWorkflowCommand('validate', ctx, { json: true }, [path]);
        expect(exitCode).toBe(1);
        const result = JSON.parse(lines.at(-1) ?? '{}');
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toContain('ghost');
        await rm(dir, { recursive: true });
    });

    test('list subcommand works', async () => {
        const { lines, output } = captureOutput();
        const ctx = createCliContext({ output, dbUrl: ':memory:' });
        const exitCode = await runWorkflowCommand('list', ctx, {}, []);
        expect(exitCode).toBe(0);
        expect(lines.some((l) => l.includes('No workflow runs'))).toBe(true);
    });

    test('list with --json returns JSON', async () => {
        const { lines, output } = captureOutput();
        const ctx = createCliContext({ output, dbUrl: ':memory:' });
        const exitCode = await runWorkflowCommand('list', ctx, { json: true }, []);
        expect(exitCode).toBe(0);
        expect(lines.some((l) => l.includes('"runs"'))).toBe(true);
    });

    test('run subcommand with missing file throws', async () => {
        const ctx = createCliContext({ output: nullOutput() });
        await expect(runWorkflowCommand('run', ctx, {}, [])).rejects.toThrow('Workflow file path is required');
    });
});
