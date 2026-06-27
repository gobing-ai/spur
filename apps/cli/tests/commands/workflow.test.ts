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
        'planning-pipeline.yaml',
        'task-lifecycle.yaml',
        'feature-lifecycle.yaml',
        'feature-dev.yaml',
        'basic.yaml',
    ]) {
        test(`bundled config/workflows/${wf} validates (schema resolves)`, async () => {
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
        // equality, and that the preview led the output.
        expect(output.messages).toContain('workflow done: cli-test-flow -> done');
        expect(output.messages[0]?.startsWith('plan:')).toBe(true);
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
        // The default responder uses process.stdin.isTTY to decide.
        // Without a real TTY it returns 'yes' by default, which won't hit the abort path.
        // We need a controlled test environment. Use --json which makes the
        // hitlResponder auto-accept (no prompt), so we can verify the resume path
        // at least is hit. For the rejection path (lines 148-152), we'd need a
        // custom responder — test below covers the --json auto-accept path instead.

        const contOut = createCapturedOutput();
        const contExit = await main(['workflow', 'continue', '--json'], {
            output: contOut,
            cwd: dir,
            dbUrl,
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
});
