/**
 * Thin-wrapper integration tests for apps/cli/src/commands/workflow.ts.
 * Behavioral tests for WorkflowAppService live in packages/app/tests/services/workflow-service.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src/index';
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

const ACTION_WORKFLOW_YAML = `name: cli-action-flow
kind: state-machine
initialState: start
states:
  - id: start
    onEnter:
      - kind: note
        options:
          message: trace me
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
    test('unknown subcommand returns 1', async () => {
        const exitCode = await main(['workflow', 'unknown-cmd'], { output: nullOutput() });
        expect(exitCode).toBe(1);
    });

    // Bundled workflow YAMLs must validate with FULL JSON-Schema resolution (no
    // --no-schema). This catches a dead `$schema` ref (e.g. pointing at a package
    // that ships no schemas dir) — the 0062 task-pipeline regression.
    const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');
    for (const wf of [
        'task-pipeline.yaml',
        'task-lifecycle.yaml',
        'feature-lifecycle.yaml',
        'feature-dev.yaml',
        'basic.yaml',
    ]) {
        test(`bundled config/workflows/${wf} validates (schema resolves)`, async () => {
            const output = createCapturedOutput();
            const exitCode = await main(
                ['workflow', 'validate', join(REPO_ROOT, 'config', 'workflows', wf), '--json'],
                {
                    output,
                    dbUrl: ':memory:',
                },
            );
            expect(exitCode).toBe(0);
            const parsed = JSON.parse(output.messages.at(-1) ?? '{}');
            expect(parsed.valid).toBe(true);
        });
    }

    test('no subcommand prints usage and returns 1', async () => {
        const exitCode = await main(['workflow'], { output: nullOutput() });
        expect(exitCode).toBe(1);
    });

    test('list subcommand (json) returns 0', async () => {
        const exitCode = await main(['workflow', 'list', '--json'], { output: nullOutput(), dbUrl: ':memory:' });
        expect(exitCode).toBe(0);
    });

    test('list subcommand (plain) shows empty when no workflows found', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-wf-list-empty-'));
        const lines: string[] = [];
        const exitCode = await main(['workflow', 'list'], {
            output: { write: (m) => lines.push(m), error: () => {} },
            cwd: dir,
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(0);
        expect(lines).toContain('No workflows found.');
        await rm(dir, { recursive: true, force: true });
    });

    test('list subcommand (plain) discovers workflow YAML files', async () => {
        const dir = await createTempProject();
        const wfDir = join(dir, '.spur', 'workflows');
        await mkdir(wfDir, { recursive: true });
        await writeFile(join(wfDir, 'test.yaml'), MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();

        const exitCode = await main(['workflow', 'list'], { output, cwd: dir, dbUrl: ':memory:' });

        expect(exitCode).toBe(0);
        expect(output.messages.some((m) => m.includes('cli-test-flow'))).toBe(true);
        expect(output.messages.some((m) => m.includes('state-machine'))).toBe(true);
        await rm(dir, { recursive: true, force: true });
    });

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
        expect(output.messages).toEqual(['workflow valid: cli-test-flow']);
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

    test('run throws when workflow file argument is missing', async () => {
        const exitCode = await main(['workflow', 'run'], { output: nullOutput(), dbUrl: ':memory:' });
        expect(exitCode).toBe(1);
    });

    // ── continue (HITL resume, 0063) ──
    const PAUSING_WORKFLOW_YAML = `name: cli-pauser
kind: state-machine
initialState: start
states:
  - id: start
  - id: gate
    pause: true
  - id: done
transitions:
  - from: start
    to: gate
    guard: { kind: always }
  - from: gate
    to: done
    guard: { kind: always }
terminalStates:
  - done
`;

    test('continue with no paused run returns 1', async () => {
        const dir = await createTempProject();
        const errors: string[] = [];
        const exitCode = await main(['workflow', 'continue', '--yes'], {
            output: { write: () => {}, error: (m) => errors.push(m) },
            cwd: dir,
            dbUrl: join(dir, 'spur.db'),
        });
        expect(exitCode).toBe(1);
        expect(errors.some((e) => e.includes('No paused'))).toBe(true);
        await rm(dir, { recursive: true, force: true });
    });

    test('continue --yes discovers the latest paused run and resumes it to done', async () => {
        const dir = await createTempProject();
        const wfDir = join(dir, '.spur', 'workflows');
        await mkdir(wfDir, { recursive: true });
        await writeFile(join(wfDir, 'pauser.yaml'), PAUSING_WORKFLOW_YAML);
        const dbUrl = join(dir, 'spur.db');

        // Run it → pauses at gate.
        const runOut = createCapturedOutput();
        const runExit = await main(['workflow', 'run', '--run-id', 'cli-p1', join(wfDir, 'pauser.yaml'), '--json'], {
            output: runOut,
            cwd: dir,
            dbUrl,
        });
        expect(runExit).toBe(1); // paused != done → exit 1
        expect(JSON.parse(runOut.messages.at(-1) ?? '{}').status).toBe('paused');

        // Continue --yes → resume to done → exit 0.
        const contOut = createCapturedOutput();
        const contExit = await main(['workflow', 'continue', '--yes', '--json'], { output: contOut, cwd: dir, dbUrl });
        expect(contExit).toBe(0);
        expect(JSON.parse(contOut.messages.at(-1) ?? '{}').status).toBe('done');
        await rm(dir, { recursive: true, force: true });
    });

    test('continue <run-id> resumes a specific paused run', async () => {
        const dir = await createTempProject();
        const wfDir = join(dir, '.spur', 'workflows');
        await mkdir(wfDir, { recursive: true });
        await writeFile(join(wfDir, 'pauser.yaml'), PAUSING_WORKFLOW_YAML);
        const dbUrl = join(dir, 'spur.db');
        await main(['workflow', 'run', '--run-id', 'cli-p2', join(wfDir, 'pauser.yaml'), '--json'], {
            output: nullOutput(),
            cwd: dir,
            dbUrl,
        });
        const out = createCapturedOutput();
        const exitCode = await main(['workflow', 'continue', 'cli-p2', '--json'], { output: out, cwd: dir, dbUrl });
        expect(exitCode).toBe(0);
        expect(JSON.parse(out.messages.at(-1) ?? '{}').status).toBe('done');
        await rm(dir, { recursive: true, force: true });
    });

    test('continue of a non-paused run returns 1', async () => {
        const dir = await createTempProject();
        const exitCode = await main(['workflow', 'continue', 'ghost-run', '--json'], {
            output: nullOutput(),
            cwd: dir,
            dbUrl: join(dir, 'spur.db'),
        });
        expect(exitCode).toBe(1);
        await rm(dir, { recursive: true, force: true });
    });

    test('run subcommand formats a completed workflow in plain mode', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();

        const exitCode = await main(['workflow', 'run', '--run-id', 'plain-run', workflowFile], {
            output,
            cwd: dir,
            dbUrl: ':memory:',
        });

        expect(exitCode).toBe(0);
        expect(output.messages).toEqual(['workflow done: cli-test-flow -> done']);
        await rm(dir, { recursive: true, force: true });
    });

    test('run subcommand forwards --dry-run so failing actions are not executed', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'failing.yaml');
        // exit 1 fails a real run; a forwarded --dry-run skips the action and completes.
        await writeFile(
            workflowFile,
            [
                'name: cli-dry-flow',
                'kind: state-machine',
                'initialState: start',
                'states:',
                '  - id: start',
                '    onEnter:',
                '      - kind: shell',
                '        options:',
                '          command: exit 1',
                '  - id: done',
                'transitions:',
                '  - from: start',
                '    to: done',
                'terminalStates: [done]',
            ].join('\n'),
        );
        const output = createCapturedOutput();

        const exitCode = await main(['workflow', 'run', '--dry-run', '--run-id', 'dry-run-1', workflowFile], {
            output,
            cwd: dir,
            dbUrl: ':memory:',
        });

        expect(exitCode).toBe(0);
        expect(output.messages).toEqual(['workflow done: cli-dry-flow -> done']);
        await rm(dir, { recursive: true, force: true });
    });

    test('run subcommand accepts a valid --vars override and completes', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();

        const exitCode = await main(
            ['workflow', 'run', '--run-id', 'vars-run', '--vars', '{"taskId":"0042"}', workflowFile],
            { output, cwd: dir, dbUrl: ':memory:' },
        );

        expect(exitCode).toBe(0);
        expect(output.messages).toEqual(['workflow done: cli-test-flow -> done']);
        await rm(dir, { recursive: true, force: true });
    });

    test('run subcommand rejects malformed --vars JSON with exit 1', async () => {
        const exitCode = await main(['workflow', 'run', '--vars', '{not json', '/tmp/x.yaml'], {
            output: nullOutput(),
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(1);
    });

    test('run subcommand rejects a non-object --vars value with exit 1', async () => {
        const exitCode = await main(['workflow', 'run', '--vars', '["a","b"]', '/tmp/x.yaml'], {
            output: nullOutput(),
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(1);
    });

    test('run subcommand rejects a non-string --vars value with exit 1', async () => {
        const exitCode = await main(['workflow', 'run', '--vars', '{"n":1}', '/tmp/x.yaml'], {
            output: nullOutput(),
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(1);
    });

    test('run subcommand writes json for a completed workflow', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();

        const exitCode = await main(['workflow', 'run', '--json', '--run-id', 'json-run', workflowFile], {
            output,
            cwd: dir,
            dbUrl: ':memory:',
        });

        expect(exitCode).toBe(0);
        expect(JSON.parse(output.messages[0] ?? '{}')).toMatchObject({
            status: 'done',
            workflowName: 'cli-test-flow',
            finalState: 'done',
        });
        await rm(dir, { recursive: true, force: true });
    });

    // ── trace ──

    test('trace subcommand (json) returns 0', async () => {
        const exitCode = await main(['workflow', 'trace', '--json'], { output: nullOutput(), dbUrl: ':memory:' });
        expect(exitCode).toBe(0);
    });

    test('trace subcommand (plain) shows empty run list', async () => {
        const lines: string[] = [];
        const exitCode = await main(['workflow', 'trace'], {
            output: { write: (m) => lines.push(m), error: () => {} },
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(0);
        expect(lines).toContain('No workflow runs.');
    });

    test('trace subcommand rejects invalid --last', async () => {
        const exitCode = await main(['workflow', 'trace', '--last', '0'], { output: nullOutput(), dbUrl: ':memory:' });
        expect(exitCode).toBe(1);
    });

    test('trace subcommand rejects invalid --status', async () => {
        const exitCode = await main(['workflow', 'trace', '--status', 'bogus'], {
            output: nullOutput(),
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(1);
    });

    test('trace subcommand accepts --status done', async () => {
        const exitCode = await main(['workflow', 'trace', '--status', 'done'], {
            output: nullOutput(),
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(0);
    });

    test('trace subcommand (plain) lists runs and shows run-id timeline', async () => {
        const dir = await createTempProject();
        const wfDir = join(dir, '.spur', 'workflows');
        await mkdir(wfDir, { recursive: true });
        const workflowFile = join(wfDir, 'test.yaml');
        await writeFile(workflowFile, ACTION_WORKFLOW_YAML);
        const output = createCapturedOutput();
        const dbUrl = join(dir, '.spur', 'test.sqlite');

        await main(['workflow', 'run', '--run-id', 'trace-test-run', workflowFile], { output, cwd: dir, dbUrl });
        output.messages.length = 0;

        const exitCode = await main(['workflow', 'trace'], { output, cwd: dir, dbUrl });
        expect(exitCode).toBe(0);
        expect(output.messages.some((m) => m.includes('trace-test-run'))).toBe(true);

        output.messages.length = 0;
        const exitCode2 = await main(['workflow', 'trace', 'trace-test-run'], { output, cwd: dir, dbUrl });
        expect(exitCode2).toBe(0);
        expect(output.messages.some((m) => m.includes('trace-test-run'))).toBe(true);
        expect(output.messages.some((m) => m.includes('note'))).toBe(true);
        await rm(dir, { recursive: true, force: true });
    });
});
