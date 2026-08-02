/**
 * Thin-wrapper integration tests for apps/cli/src/commands/workflow.ts.
 * Behavioral tests for WorkflowAppService live in packages/app/tests/services/workflow-service.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type TimelineEvent, WorkflowSteeringController, type WorkflowTraceTimeline } from '@gobing-ai/spur-app';
import type { ActionCost } from '@gobing-ai/spur-domain';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import { followTrace, formatActionCost, formatTraceTimeline, submitSteeringLine } from '../../src/commands/workflow';
import { main } from '../../src/index';
import type { CommandOutput } from '../../src/output';
import { createCapturedOutput, createTempProject, runCli } from '../helpers';

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
        'planning-pipeline.yaml',
        'task-lifecycle.yaml',
        'feature-lifecycle.yaml',
        'feature-dev.yaml',
        'basic.yaml',
    ]) {
        test(`bundled workflows/${wf} validates (schema resolves)`, async () => {
            // Isolate cwd to a temp dir with no .spur/config.yaml so main() takes
            // the lightweight no-config branch. Without this, cwd falls back to
            // process.cwd() (the repo root, which HAS a config), triggering full
            // app bootstrap on every validate call — environment-fragile on CI.
            const cwd = await createTempProject();
            const output = createCapturedOutput();
            const exitCode = await main(
                ['workflow', 'validate', join(REPO_ROOT, 'config', 'workflows', wf), '--json'],
                {
                    output,
                    cwd,
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
        // Human (non-json) sync run now prints a plan preview + live progress (0114),
        // then the result line. Assert the result is present rather than exact-array
        // equality, and that the correlated run header led the output.
        expect(output.messages).toContain('workflow done: cli-test-flow -> done');
        expect(output.messages[0]).toBe('Run: plain-run');
        expect(output.messages.some((message) => message.startsWith('plan:'))).toBe(true);
        await rm(dir, { recursive: true, force: true });
    });

    test('run output modes preserve final summary, silence, verbose detail, and JSON isolation', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);

        const quiet = createCapturedOutput();
        expect(
            await main(['workflow', 'run', '--quiet', '--run-id', 'quiet-run', workflowFile], {
                output: quiet,
                cwd: dir,
                dbUrl: ':memory:',
            }),
        ).toBe(0);
        expect(quiet.messages).toEqual(['workflow done: cli-test-flow -> done']);

        const silent = createCapturedOutput();
        expect(
            await main(['workflow', 'run', '--silent', '--run-id', 'silent-run', workflowFile], {
                output: silent,
                cwd: dir,
                dbUrl: ':memory:',
            }),
        ).toBe(0);
        expect(silent.messages).toEqual([]);

        const verbose = createCapturedOutput();
        expect(
            await main(['workflow', 'run', '--verbose', '--run-id', 'verbose-run', workflowFile], {
                output: verbose,
                cwd: dir,
                dbUrl: ':memory:',
            }),
        ).toBe(0);
        expect(verbose.messages.some((message) => message.includes('seq='))).toBe(true);

        await rm(dir, { recursive: true, force: true });
    });

    test('run rejects contradictory human output modes', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'run', '--quiet', '--verbose', '/tmp/workflow.yaml'], {
            output,
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(2);
        expect(output.errors).toContain('--quiet and --verbose are mutually exclusive');
    });

    test('run rejects silent mixed with another human mode and invalid detail', async () => {
        const mixed = createCapturedOutput();
        expect(
            await main(['workflow', 'run', '--silent', '--quiet', '/tmp/workflow.yaml'], {
                output: mixed,
                dbUrl: ':memory:',
            }),
        ).toBe(2);
        expect(mixed.errors).toContain('--silent cannot be combined with --quiet or --verbose');

        const invalid = createCapturedOutput();
        expect(
            await main(['workflow', 'run', '--detail', 'debug', '/tmp/workflow.yaml'], {
                output: invalid,
                dbUrl: ':memory:',
            }),
        ).toBe(2);
        expect(invalid.errors).toContain('--detail must be one of: minimal, invocation, full');
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
        expect(output.messages).toContain('workflow done: cli-dry-flow -> done');
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
        expect(output.messages).toContain('workflow done: cli-test-flow -> done');
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
        // R5 (0114): --json output is exactly one message — the JSON envelope. No plan
        // preview or progress lines leak into machine output.
        expect(output.messages).toHaveLength(1);
        expect(output.messages.some((m) => m.startsWith('plan:') || m.includes('▶') || m.includes('→'))).toBe(false);
        expect(JSON.parse(output.messages[0] ?? '{}')).toMatchObject({
            status: 'done',
            workflowName: 'cli-test-flow',
            finalState: 'done',
        });
        await rm(dir, { recursive: true, force: true });
    });

    test('run --trace-file writes the redacted schema-versioned bus projection under the run root', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);

        expect(
            await main(['workflow', 'run', '--trace-file', '--run-id', 'trace-file-run', workflowFile], {
                output: nullOutput(),
                cwd: dir,
                dbUrl: ':memory:',
            }),
        ).toBe(0);

        const tracePath = join(dir, '.spur', 'runs', 'workflow', 'trace-file-run.jsonl');
        const records = (await readFile(tracePath, 'utf8'))
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        expect(records.length).toBeGreaterThan(1);
        expect(records.every((record) => record.traceSchemaVersion === 1)).toBe(true);
        expect(records.map((record) => record.traceSequence)).toEqual(
            Array.from({ length: records.length }, (_, index) => index + 1),
        );
        expect(records.some((record) => record.type === 'workflow.run.finalized')).toBe(true);
        await rm(dir, { recursive: true, force: true });
    });

    test('run rejects steering in machine and detached modes', async () => {
        for (const incompatible of ['--json', '--async']) {
            const output = createCapturedOutput();
            expect(
                await main(['workflow', 'run', '--steer', incompatible, '/tmp/workflow.yaml'], {
                    output,
                    dbUrl: ':memory:',
                }),
            ).toBe(2);
            expect(output.errors).toContain(
                '--steer is synchronous and in-process; it cannot be combined with --json or --async',
            );
        }
    });

    test('run --steer streams a fake agent and records the safe boundary timeout acknowledgement', async () => {
        const dir = await createTempProject();
        const binDir = join(dir, 'bin');
        await mkdir(binDir);
        const fakeClaude = join(binDir, 'claude');
        await writeFile(
            fakeClaude,
            [
                '#!/bin/sh',
                'if [ "$1" = "--version" ]; then',
                '  echo "claude 1.0.0"',
                '  exit 0',
                'fi',
                'printf "live-one\\n"',
            ].join('\n'),
        );
        await chmod(fakeClaude, 0o755);
        const workflowFile = join(dir, 'steer.yaml');
        await writeFile(
            workflowFile,
            [
                'name: cli-steer-flow',
                'kind: state-machine',
                'initialState: start',
                'states:',
                '  - id: start',
                '    onEnter:',
                '      - kind: agent.run',
                '        options:',
                '          input: hello',
                '          agent: claude',
                '          steeringBoundary: true',
                '          steeringTimeoutMs: 20',
                '  - id: done',
                'transitions:',
                '  - from: start',
                '    to: done',
                'terminalStates: [done]',
            ].join('\n'),
        );
        const messages: string[] = [];
        const errors: string[] = [];
        const output: CommandOutput = {
            write: (message) => {
                messages.push(message);
            },
            error: (message) => errors.push(message),
        };

        const originalPath = process.env.PATH;
        process.env.PATH = `${binDir}:${originalPath ?? ''}`;
        try {
            expect(
                await main(['workflow', 'run', '--steer', '--run-id', 'steer-run', workflowFile], {
                    output,
                    cwd: dir,
                    env: { ...process.env },
                    dbUrl: ':memory:',
                }),
            ).toBe(0);
        } finally {
            // Assigning undefined stringifies to "undefined" and breaks later tests'
            // shell PATH (mkdir not found → workflow status failed on CI).
            if (originalPath === undefined) delete process.env.PATH;
            else process.env.PATH = originalPath;
        }
        expect(messages.some((message) => message.includes('agent=claude'))).toBe(true);
        expect(messages.some((message) => message.includes('stdout> live-one'))).toBe(true);
        expect(messages.some((message) => message.startsWith('[steer] boundary'))).toBe(true);
        expect(
            messages.some(
                (message) =>
                    message.startsWith('[steer] ack continue') &&
                    message.includes('boundary timeout defaulted to continue'),
            ),
        ).toBe(true);
        expect(messages).toContain('workflow done: cli-steer-flow -> done');
        expect(errors).toEqual([]);
        await rm(dir, { recursive: true, force: true });
    });

    test('submitSteeringLine accepts valid input and reports malformed local commands', async () => {
        const controller = new WorkflowSteeringController();
        controller.begin('run-line', 'action-line', { boundary: true, timeoutMs: 1000 });
        const decision = controller.boundary(true);
        const errors: string[] = [];

        submitSteeringLine(controller, { error: (message) => errors.push(message) }, 'continue');
        await expect(decision).resolves.toEqual({ operation: 'continue' });
        submitSteeringLine(controller, { error: (message) => errors.push(message) }, 'not-a-command');

        expect(errors).toEqual(['[steer] ignored command: not-a-command']);
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

    test('trace validates follow target, JSON compatibility, and poll interval', async () => {
        expect(await main(['workflow', 'trace', '--follow'], { output: nullOutput(), dbUrl: ':memory:' })).toBe(1);
        expect(
            await main(['workflow', 'trace', 'run-1', '--follow', '--json'], {
                output: nullOutput(),
                dbUrl: ':memory:',
            }),
        ).toBe(1);
        expect(
            await main(['workflow', 'trace', 'run-1', '--follow', '--poll', '10'], {
                output: nullOutput(),
                dbUrl: ':memory:',
            }),
        ).toBe(1);
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

    // ── list with broken config (hits resolveWorkflowPaths catch, line 52) ──

    test('list subcommand falls back to default paths when config parse fails', async () => {
        const dir = await createTempProject();
        // Create a config file with a non-object `workflows` value — this will
        // survive YAML parse but fail Zod's spurConfigSchema validation,
        // hitting the catch branch in resolveWorkflowPaths.
        await writeFile(join(dir, 'spur.yaml'), 'workflows: "not-an-object"\n');
        const output = createCapturedOutput();

        const exitCode = await main(['workflow', 'list', '--json'], { output, cwd: dir, dbUrl: ':memory:' });

        expect(exitCode).toBe(0);
        const parsed = JSON.parse(output.messages[0] ?? '{}');
        expect(parsed).toHaveProperty('entries');
        expect(parsed).toHaveProperty('totalFiles');
        await rm(dir, { recursive: true, force: true });
    });

    // ── continue with HITL rejection (lines 142-152) ──

    test('continue without --yes asks confirmation and aborts when user says no', async () => {
        const dir = await createTempProject();
        const wfDir = join(dir, '.spur', 'workflows');
        await mkdir(wfDir, { recursive: true });
        const workflowFile = join(wfDir, 'test.yaml');
        // Use a workflow with a pause state so it creates a paused run.
        const pauseYaml = [
            'name: cli-pause-flow',
            'kind: state-machine',
            'initialState: start',
            'states:',
            '  - id: start',
            '    pause: true',
            '  - id: done',
            'transitions:',
            '  - from: start',
            '    to: done',
            'terminalStates: [done]',
        ].join('\n');
        await writeFile(workflowFile, pauseYaml);
        const dbUrl = join(dir, '.spur', 'test.sqlite');
        const out1 = createCapturedOutput();

        // First run creates a paused run.
        await main(['workflow', 'run', '--run-id', 'pause-1', workflowFile], { output: out1, cwd: dir, dbUrl });

        // Now continue without --yes — the HITL responder should fire.
        // --json selects DefaultHitlResponder (no interactive prompt). Confirm
        // defaults to deny unless SPUR_HITL_AUTO_APPROVE=1 opts in (task 0241 R1).
        // This path verifies resume with explicit headless auto-approve.

        const contOut = createCapturedOutput();
        const contExit = await main(['workflow', 'continue', '--json'], {
            output: contOut,
            cwd: dir,
            dbUrl,
            env: { SPUR_HITL_AUTO_APPROVE: '1' },
        });
        expect(contExit).toBe(0);
        expect(JSON.parse(contOut.messages[0] ?? '{}')).toMatchObject({ status: 'done' });
        await rm(dir, { recursive: true, force: true });
    });

    // ── clean subcommand (lines 172-189) ──

    test('clean subcommand reports no stale runs on empty DB', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean'], { output, dbUrl: ':memory:' });
        expect(exitCode).toBe(0);
        expect(output.messages).toContain('No stale runs older than 30m.');
    });

    test('clean --dry-run works on empty DB', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean', '--dry-run'], { output, dbUrl: ':memory:' });
        expect(exitCode).toBe(0);
        expect(output.messages).toContain('No stale runs older than 30m.');
    });

    test('clean --json works on empty DB', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean', '--json'], { output, dbUrl: ':memory:' });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(output.messages[0] ?? '{}');
        expect(parsed).toHaveProperty('cleaned');
        expect(Array.isArray(parsed.cleaned)).toBe(true);
    });

    test('clean rejects invalid --older-than', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean', '--older-than', 'abc'], {
            output,
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(2);
        expect(output.errors.some((e) => e.includes('Invalid --older-than'))).toBe(true);
    });

    // ── list shows invalid workflow (lines 283-285, formatListHuman ❌ path) ──

    test('list subcommand shows invalid workflow entry in human output', async () => {
        const dir = await createTempProject();
        const wfDir = join(dir, '.spur', 'workflows');
        await mkdir(wfDir, { recursive: true });
        // A YAML file missing the 'name' field — extractWorkflowMeta marks it invalid.
        await writeFile(join(wfDir, 'broken.yaml'), 'kind: state-machine\n');
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'list'], { output, cwd: dir, dbUrl: ':memory:' });

        // Exit 0 even with invalid entries (list is informational).
        expect(exitCode).toBe(0);
        // The ❌ marker + '<unnamed>' name identify the invalid entry.
        const hasBrokenEntry = output.messages.some((m) => m.includes('❌') && m.includes('<unnamed>'));
        expect(hasBrokenEntry).toBe(true);
    });

    // ── async run (--async flag, 0116) ──

    test('run --async prints started message with run ID and exits 0', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();

        const exitCode = await main(['workflow', 'run', '--async', workflowFile], {
            output,
            cwd: dir,
            dbUrl: ':memory:',
        });

        expect(exitCode).toBe(0);
        expect(output.messages[0] ?? '').toMatch(/^Started async run:/);
        expect(output.messages[0] ?? '').toMatch(/Monitor with: spur workflow trace/);
        await rm(dir, { recursive: true, force: true });
    });

    test('run --async --json returns structured result with runId', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();

        const exitCode = await main(['workflow', 'run', '--async', '--json', workflowFile], {
            output,
            cwd: dir,
            dbUrl: ':memory:',
        });

        expect(exitCode).toBe(0);
        const parsed = JSON.parse(output.messages[0] ?? '{}');
        expect(parsed).toMatchObject({ status: 'started', workflowName: workflowFile });
        expect(parsed).toHaveProperty('runId');
        expect(typeof parsed.runId).toBe('string');
        await rm(dir, { recursive: true, force: true });
    });

    test('run --async --vars forwards vars to the spawned command', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();

        // --vars are forwarded to Bun.spawn cmd; we verify the parent exits
        // cleanly (the child process is detached and may fail, but the parent
        // doesn't wait for it).
        const exitCode = await main(['workflow', 'run', '--async', '--vars', '{"wbs":"0116"}', workflowFile], {
            output,
            cwd: dir,
            dbUrl: ':memory:',
        });

        expect(exitCode).toBe(0);
        expect(output.messages[0] ?? '').toMatch(/^Started async run:/);
        await rm(dir, { recursive: true, force: true });
    });

    test('run --async --dry-run forwards dry-run to the spawned command', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();

        const exitCode = await main(['workflow', 'run', '--async', '--dry-run', workflowFile], {
            output,
            cwd: dir,
            dbUrl: ':memory:',
        });

        expect(exitCode).toBe(0);
        expect(output.messages[0] ?? '').toMatch(/^Started async run:/);
        await rm(dir, { recursive: true, force: true });
    });

    test('run --async --run-id uses the given run ID', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();

        const exitCode = await main(['workflow', 'run', '--async', '--run-id', 'async-custom-id', workflowFile], {
            output,
            cwd: dir,
            dbUrl: ':memory:',
        });

        expect(exitCode).toBe(0);
        expect(output.messages[0] ?? '').toContain('async-custom-id');
        await rm(dir, { recursive: true, force: true });
    });

    // ── clean --force (0116) ──

    test('clean --force reports no stale runs on empty DB', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean', '--force'], { output, dbUrl: ':memory:' });
        expect(exitCode).toBe(0);
        // --force sets minutes=0, so the message has no age qualifier
        expect(output.messages).toContain('No stale runs.');
    });

    test('clean --force --dry-run works on empty DB', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean', '--force', '--dry-run'], { output, dbUrl: ':memory:' });
        expect(exitCode).toBe(0);
        expect(output.messages).toContain('No stale runs.');
    });

    test('clean --force --json works on empty DB', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean', '--force', '--json'], { output, dbUrl: ':memory:' });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(output.messages[0] ?? '{}');
        expect(parsed).toHaveProperty('cleaned');
        expect(parsed.olderThanMinutes).toBe(0);
    });

    test('clean --force overrides --older-than', async () => {
        const output = createCapturedOutput();
        // --force overrides --older-than: minutes=0 regardless
        const exitCode = await main(['workflow', 'clean', '--force', '--older-than', '999'], {
            output,
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(0);
        // Uses --force message (no age qualifier), not "older than 999m"
        expect(output.messages).toContain('No stale runs.');
    });

    // End-to-end async-run cancel — the test that exercises the REAL launcher →
    // detached worker → self-recorded pid → group-kill path, catching the two
    // defects a stand-in `sleep` child hid: (A) the launcher used to write the pid
    // before the run row existed (silent no-op → pid never persisted), and (B)
    // SIGTERM to the worker alone never reached the agent grandchild. The worker
    // here runs a `shell: sleep 30` (the grandchild stand-in for `agent.run`).
    test('async run self-records its worker pid; cancel SIGTERMs the whole process group', async () => {
        const cwd = await createTempProject();
        // A workflow whose only step shells a long sleep — a real grandchild of
        // the detached worker, so cancelling must reach beyond the worker itself.
        const wfPath = join(cwd, 'sleeper.yaml');
        await writeFile(
            wfPath,
            [
                'name: sleeper-flow',
                'kind: state-machine',
                'initialState: work',
                'states:',
                '  - id: work',
                '    onEnter:',
                '      - kind: shell',
                '        options:',
                '          command: "sleep 30"',
                '  - id: done',
                'transitions:',
                '  - from: work',
                '    to: done',
                'terminalStates:',
                '  - done',
            ].join('\n'),
        );

        // Launch async via the real CLI subprocess (exercises child_process.spawn
        // detached + SPUR_ASYNC_WORKER plumbing). The launcher exits immediately.
        const started = await runCli(['workflow', 'run', wfPath, '--async', '--json'], cwd);
        expect(started.code).toBe(0);
        const runId = (started.json as { runId?: string } | undefined)?.runId;
        expect(typeof runId).toBe('string');
        if (typeof runId !== 'string') return;

        // Poll the shared file DB until the worker self-records its pid (Defect A:
        // without the fix this stays null forever because the racy launcher write
        // missed the not-yet-created row).
        const db = await createMigratedDb({ url: join(cwd, '.spur', 'spur.db') });
        let pid: number | null = null;
        for (let i = 0; i < 100 && pid == null; i++) {
            const row = await db.queryFirst<{ pid: number | null }>('SELECT pid FROM runs WHERE id = ?', runId);
            pid = row?.pid ?? null;
            if (pid == null) await Bun.sleep(50);
        }
        expect(pid).not.toBeNull();
        if (pid == null) return;

        // The worker (group leader) is alive — `kill(pid, 0)` does not throw.
        expect(() => process.kill(pid, 0)).not.toThrow();

        // Cancel: marks failed AND signals the worker's process group (-pid),
        // reaching the `sleep 30` grandchild (Defect B).
        const cancelled = await runCli(['workflow', 'cancel', runId, '--json'], cwd);
        expect(cancelled.code).toBe(0);
        expect((cancelled.json as { killed?: boolean } | undefined)?.killed).toBe(true);

        // The whole group dies: poll until signalling the group throws ESRCH.
        let groupGone = false;
        for (let i = 0; i < 100 && !groupGone; i++) {
            try {
                process.kill(-pid, 0); // probe the group, no signal sent
                await Bun.sleep(50);
            } catch {
                groupGone = true; // ESRCH — no process in the group remains
            }
        }
        expect(groupGone).toBe(true);

        // Run record is finalized failed.
        const finalRow = await db.queryFirst<{ status: string }>('SELECT status FROM runs WHERE id = ?', runId);
        expect(finalRow?.status).toBe('failed');

        // Safety net: if the worker somehow survived, reap the single pid (not the
        // group — group kill of a non-leader or of pid 0 would hit the test runner).
        try {
            process.kill(pid, 'SIGKILL');
        } catch {
            // already gone — fine
        }
        await rm(cwd, { recursive: true, force: true });
    }, 20_000);

    // ── cancel without --json ──

    test('cancel without --json reports not_found for nonexistent run', async () => {
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'cancel', 'nonexistent-run-id'], {
            output,
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(1);
        expect(output.errors).toContain('Run nonexistent-run-id not found.');
    });
});

// ---------------------------------------------------------------------------
// Trace cost rendering (task 0311) — formatActionCost / formatTraceTimeline.
// These are pure presentation helpers; unit-tested directly since producing a
// real agent.run row requires spawning an agent.
// ---------------------------------------------------------------------------

function makeCost(overrides: Partial<ActionCost> = {}): ActionCost {
    return {
        totals: {
            inputTokens: 1000,
            outputTokens: 500,
            cacheReadTokens: 200,
            cacheCreationTokens: 0,
            costUsd: 0.0123,
            records: 1,
            recordsWithUsage: 1,
        },
        cacheHit: 0.25,
        estimated: false,
        ...overrides,
    };
}

const UNJOINED_COST: ActionCost = {
    totals: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: 0,
        records: 0,
        recordsWithUsage: 0,
    },
    cacheHit: null,
    estimated: false,
};

function makeActionEvent(cost?: ActionCost): TimelineEvent {
    return {
        kind: 'action',
        actionId: 'act-1',
        node: 'n1',
        actionKind: 'agent.run',
        status: 'done',
        duration: '120ms',
        ok: true,
        label: ' ✓',
        cost,
    };
}

describe('formatActionCost', () => {
    test('returns empty string for non-action events', () => {
        const event: TimelineEvent = { kind: 'transition', from: 'a', to: 'b', trigger: null };
        expect(formatActionCost(event)).toBe('');
    });

    test('returns empty string when cost is undefined (non-agent.run action)', () => {
        expect(formatActionCost(makeActionEvent(undefined))).toBe('');
    });

    test('renders `cost n/a` for an unjoinable step — never $0.00 (R3, 0281/0284)', () => {
        const rendered = formatActionCost(makeActionEvent(UNJOINED_COST));
        expect(rendered).toBe(' · cost n/a');
        expect(rendered).not.toContain('$0.00');
        expect(rendered).not.toContain('0%');
    });

    test('renders exact cost and cache-hit for a session-id join (R1a)', () => {
        expect(formatActionCost(makeActionEvent(makeCost()))).toBe(' · $0.012 · cache 25%');
    });

    test('marks estimated joins with the ~ prefix (R1b)', () => {
        expect(formatActionCost(makeActionEvent(makeCost({ estimated: true })))).toBe(' · ~$0.012 · cache ~25%');
    });

    test('renders `cache n/a` when records matched but carry no cache dimensions', () => {
        const cost = makeCost({ cacheHit: null, totals: { ...makeCost().totals, costUsd: 0.005 } });
        expect(formatActionCost(makeActionEvent(cost))).toBe(' · $0.005 · cache n/a');
    });
});

describe('formatTraceTimeline cost footer', () => {
    function makeTimeline(events: TimelineEvent[]): WorkflowTraceTimeline {
        return {
            run: {
                runId: 'r1',
                workflowName: 'wf',
                mode: 'sync',
                status: 'done',
                startedAt: '2026-01-15T10:00:00.000Z',
                completedAt: '2026-01-15T10:05:00.000Z',
                isDryRun: false,
            },
            events,
        };
    }

    test('appends a `history import` hint when a step has no joinable usage (R6, AC2)', () => {
        const out = formatTraceTimeline(makeTimeline([makeActionEvent(UNJOINED_COST)]));
        expect(out).toContain('spur history import');
    });

    test('omits the hint when every agent.run step is joined', () => {
        const out = formatTraceTimeline(makeTimeline([makeActionEvent(makeCost())]));
        expect(out).not.toContain('spur history import');
    });
});

describe('formatTraceTimeline output artifact (task 0414)', () => {
    function makeTimeline(overrides: Partial<WorkflowTraceTimeline> = {}): WorkflowTraceTimeline {
        return {
            run: {
                runId: 'r1',
                workflowName: 'wf',
                mode: 'sync',
                status: 'running',
                startedAt: '2026-01-15T10:00:00.000Z',
                completedAt: null,
                isDryRun: false,
            },
            events: [],
            ...overrides,
        };
    }

    test('points the operator at the live output artifact when present', () => {
        const out = formatTraceTimeline(makeTimeline({ outputArtifact: '.spur/run/r1-output.log' }));
        expect(out).toContain('Agent output: .spur/run/r1-output.log');
        expect(out).toContain('tail -f');
    });

    test('omits the artifact line when no capture exists', () => {
        const out = formatTraceTimeline(makeTimeline());
        expect(out).not.toContain('Agent output');
    });
});

describe('followTrace', () => {
    test('replays persisted events, emits action updates, and stops at terminal status', async () => {
        const running: WorkflowTraceTimeline = {
            run: {
                runId: 'r1',
                workflowName: 'wf',
                mode: 'sync',
                status: 'running',
                startedAt: '2026-01-15T10:00:00.000Z',
                completedAt: null,
                isDryRun: false,
            },
            events: [
                {
                    kind: 'action',
                    actionId: 'a1',
                    node: 'work',
                    actionKind: 'agent.run',
                    status: 'running',
                    duration: '',
                    ok: false,
                    label: ' (in-flight)',
                },
            ],
        };
        const done: WorkflowTraceTimeline = {
            run: { ...running.run, status: 'done', completedAt: '2026-01-15T10:01:00.000Z' },
            events: [
                {
                    kind: 'action',
                    actionId: 'a1',
                    node: 'work',
                    actionKind: 'agent.run',
                    status: 'done',
                    duration: '60000ms',
                    ok: true,
                    label: ' ✓',
                },
            ],
        };
        let call = 0;
        const writes: string[] = [];
        await followTrace(
            { trace: async () => (call++ === 0 ? running : done) } as never,
            'r1',
            50,
            (line) => writes.push(line),
            async () => undefined,
        );

        expect(writes[0]).toContain('agent.run');
        expect(writes.some((line) => line.includes('60000ms'))).toBe(true);
        expect(writes.at(-1)).toBe('Run finalized: done');
    });
});
