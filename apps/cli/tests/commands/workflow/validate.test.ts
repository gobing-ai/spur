/**
 * Thin-wrapper integration tests for `spur workflow validate` (apps/cli/src/commands/workflow/validate.ts).
 * Behavioral tests for WorkflowAppService live in packages/app/tests/services/workflow-service.test.ts.
 */
import { beforeEach, describe, expect, test } from 'bun:test';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _resetAgentServiceShimsForTest } from '@gobing-ai/spur-app';
import { main } from '../../../src/index';
import type { CommandOutput } from '../../../src/output';
import { createCapturedOutput, createTempProject } from '../../helpers';

// Warn-once shim markers (bare-binary, legacy executor) are process-global; bun
// batches test files per worker process — never inherit another file's state.
beforeEach(() => {
    _resetAgentServiceShimsForTest();
});

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

describe('workflow command (main)', () => {
    // 0822 (ADR-115): a shell program of N `echo` lines measures N logical commands.
    // 6 commands → warn band; 11 → error band.
    const compositionFixture = (commands: number): string => `name: cli-composition-flow
kind: state-machine
initialState: start
states:
  - id: start
    onEnter:
      - kind: shell
        options:
          command: |
${Array.from({ length: commands }, (_, i) => `            echo step-${i}`).join('\n')}
  - id: done
transitions:
  - from: start
    to: done
terminalStates: [done]
`;

    test('validate of a missing file (plain) returns 1 and reports invalid', async () => {
        const errors: string[] = [];
        const exitCode = await main(['workflow', 'validate', '/tmp/spur-missing-workflow.yaml'], {
            output: { write: () => {}, error: (m) => errors.push(m) },
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(1);
        expect(errors.some((e) => e.startsWith('workflow invalid:'))).toBe(true);
    });
    test('validate of a missing file (json) returns 1', async () => {
        const exitCode = await main(['workflow', 'validate', '--json', '/tmp/spur-missing-workflow.yaml'], {
            output: nullOutput(),
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(1);
    });
    test('validate throws when workflow file argument is missing', async () => {
        const exitCode = await main(['workflow', 'validate'], { output: nullOutput(), dbUrl: ':memory:' });
        expect(exitCode).toBe(1);
    });
    test('validate of a valid workflow reports the workflow name', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();

        const exitCode = await main(['workflow', 'validate', workflowFile], { output, cwd: dir, dbUrl: ':memory:' });

        expect(exitCode).toBe(0);
        expect(output.messages).toEqual(['workflow valid: cli-test-flow (unversioned)']);
        await rm(dir, { recursive: true, force: true });
    });
    test('validate exits 0 on warn-only composition findings, in both modes (0822 R1)', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'warn.yaml');
        await writeFile(workflowFile, compositionFixture(6));

        const human = createCapturedOutput();
        const humanExit = await main(['workflow', 'validate', workflowFile], {
            output: human,
            cwd: dir,
            dbUrl: ':memory:',
        });
        expect(humanExit).toBe(0);
        expect(human.messages[0]).toContain('workflow valid: cli-composition-flow');
        expect(human.errors.join('\n')).toContain('composition warn: start:onEnter:0');
        expect(human.errors.join('\n')).toContain('6 logical commands (threshold 5)');
        expect(human.errors.join('\n')).not.toContain('composition error:');

        const json = createCapturedOutput();
        const jsonExit = await main(['workflow', 'validate', workflowFile, '--json'], {
            output: json,
            cwd: dir,
            dbUrl: ':memory:',
        });
        expect(jsonExit).toBe(0);
        const parsed = JSON.parse(json.messages.at(-1) ?? '{}');
        expect(parsed.valid).toBe(true);
        expect(parsed.composition.findings).toHaveLength(1);
        expect(parsed.composition.findings[0].level).toBe('warn');
        expect(parsed.composition.findings[0].measure.kind).toBe('shell-lines');
        await rm(dir, { recursive: true, force: true });
    });
    test('validate exits 1 on an error-level composition finding, in both modes (0822 R1)', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'error.yaml');
        await writeFile(workflowFile, compositionFixture(11));

        const human = createCapturedOutput();
        const humanExit = await main(['workflow', 'validate', workflowFile], {
            output: human,
            cwd: dir,
            dbUrl: ':memory:',
        });
        expect(humanExit).toBe(1);
        expect(human.messages[0]).toContain('workflow valid: cli-composition-flow');
        expect(human.errors.join('\n')).toContain('composition error: start:onEnter:0');
        expect(human.errors.join('\n')).toContain('11 logical commands (threshold 10)');

        const json = createCapturedOutput();
        const jsonExit = await main(['workflow', 'validate', workflowFile, '--json'], {
            output: json,
            cwd: dir,
            dbUrl: ':memory:',
        });
        expect(jsonExit).toBe(1);
        const parsed = JSON.parse(json.messages.at(-1) ?? '{}');
        expect(parsed.valid).toBe(true);
        expect(parsed.composition.findings[0].level).toBe('error');
        expect(parsed.composition.findings[0].measure).toMatchObject({
            kind: 'shell-lines',
            measured: 11,
            threshold: 10,
        });
        await rm(dir, { recursive: true, force: true });
    });
    test('validate still exits 1 on an invalid definition (0822 R1)', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'broken.yaml');
        await writeFile(workflowFile, 'name: cli-broken\nkind: state-machine\n'); // no states/transitions
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'validate', workflowFile], { output, cwd: dir, dbUrl: ':memory:' });
        expect(exitCode).toBe(1);
        expect(output.errors.join('\n')).toContain('workflow invalid');
        await rm(dir, { recursive: true, force: true });
    });
    test('validate rejects an agent.run step with no role (0538 R2)', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'no-role.yaml');
        await writeFile(
            workflowFile,
            [
                'name: cli-no-role-flow',
                'kind: state-machine',
                'initialState: start',
                'states:',
                '  - id: start',
                '    onEnter:',
                '      - kind: agent.run',
                '        options:',
                '          input: hello',
                '          agent: claude',
                '  - id: done',
                'transitions:',
                '  - from: start',
                '    to: done',
                'terminalStates: [done]',
            ].join('\n'),
        );
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'validate', workflowFile], { output, cwd: dir, dbUrl: ':memory:' });
        expect(exitCode).not.toBe(0);
        expect(output.errors.join('\n')).toMatch(/role/i);
        await rm(dir, { recursive: true, force: true });
    });
    test('validate rejects an agent.run step with an unknown role (0538 R2)', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'bad-role.yaml');
        await writeFile(
            workflowFile,
            [
                'name: cli-bad-role-flow',
                'kind: state-machine',
                'initialState: start',
                'states:',
                '  - id: start',
                '    onEnter:',
                '      - kind: agent.run',
                '        options:',
                '          input: hello',
                '          agent: claude',
                '          role: sorcerer',
                '  - id: done',
                'transitions:',
                '  - from: start',
                '    to: done',
                'terminalStates: [done]',
            ].join('\n'),
        );
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'validate', workflowFile], { output, cwd: dir, dbUrl: ':memory:' });
        expect(exitCode).not.toBe(0);
        expect(output.errors.join('\n')).toMatch(/sorcerer|role/i);
        await rm(dir, { recursive: true, force: true });
    });
    test('validate json forwards the no-schema flag', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();

        const exitCode = await main(['workflow', 'validate', '--json', '--no-schema', workflowFile], {
            output,
            cwd: dir,
            dbUrl: ':memory:',
        });

        expect(exitCode).toBe(0);
        expect(JSON.parse(output.messages[0] ?? '{}')).toMatchObject({
            ok: true,
            valid: true,
            workflow: { name: 'cli-test-flow' },
        });
        await rm(dir, { recursive: true, force: true });
    });
});
