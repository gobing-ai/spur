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

function captureOutput(): { output: CommandOutput; lines: string[] } {
    const lines: string[] = [];
    return {
        lines,
        output: { write: (m: string) => lines.push(m), error: () => {} },
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
