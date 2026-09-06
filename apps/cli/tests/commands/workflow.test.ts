/**
 * Thin-wrapper integration tests for apps/cli/src/commands/workflow.ts.
 * Behavioral tests for WorkflowAppService live in packages/app/tests/services/workflow-service.test.ts.
 */
import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { appendFile, chmod, exists, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    _resetAgentServiceShimsForTest,
    buildWorkflowSteps,
    type TimelineEvent,
    WorkflowSteeringController,
    type WorkflowTraceTimeline,
} from '@gobing-ai/spur-app';
import type { ActionCost, ActionCostAttribution } from '@gobing-ai/spur-domain';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import { loadWorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import {
    followRunLog,
    followTrace,
    formatActionCost,
    formatTraceTimeline,
    InvalidRunIdError,
    submitSteeringLine,
    validateRunId,
    waitForRunRegistration,
} from '../../src/commands/workflow';
import { main } from '../../src/index';
import type { CommandOutput } from '../../src/output';
import { renderWorkflowMermaid } from '../../src/workflow/mermaid-render';
import { createCapturedOutput, createTempProject, runCli } from '../helpers';

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

/**
 * Create an in-memory DB pre-seeded with a `runs` row so an `--async` launcher's
 * registration confirmation (`waitForRunRegistration`) resolves. The detached worker
 * spawned from the in-process test runner cannot register into this DB — its
 * `resolveSpurBin()` points at the test entry, not the CLI — so seeding the row
 * isolates flag-forwarding / started-message assertions from the child's real
 * registration (task 0484 R2). The failure branch is covered directly by the
 * `waitForRunRegistration` describe block.
 */
async function seededAsyncDb(runId: string) {
    const db = await createMigratedDb({ url: ':memory:' });
    const now = Date.now();
    await db.run(
        'INSERT INTO runs (id, workflow_name, mode, status, started_at, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [runId, 'cli-test-flow', 'async', 'running', now, '{}', now, now],
    );
    return db;
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
        'idea-pipeline.yaml',
        'docs-pipeline.yaml',
        'wrapup-pipeline.yaml',
        'wayfinder-resolution.yaml',
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

    // 0610 R4: an agent inside a pipeline step inherits the running workflow process's environment,
    // so a pipeline that starts another pipeline recurses — forking a worktree and an agent run per
    // level, unbounded. Before this the only protection was a prose NOTE in task-pipeline.yaml.
    test('run refuses when already inside an active workflow run, before any side effect', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();
        const prior = process.env.SPUR_WORKFLOW_RUN_ACTIVE;
        process.env.SPUR_WORKFLOW_RUN_ACTIVE = '1';
        try {
            const exitCode = await main(['workflow', 'run', workflowFile], { output, cwd: dir, dbUrl: ':memory:' });

            expect(exitCode).toBe(1);
            expect(output.errors.join('\n')).toContain('refusing to start');
            expect(output.errors.join('\n')).toContain('SPUR_WORKFLOW_RUN_ACTIVE=1');
            // Refusal precedes execution: nothing was run, so no summary line was emitted.
            expect(output.messages.join('\n')).not.toContain('workflow');
        } finally {
            if (prior === undefined) delete process.env.SPUR_WORKFLOW_RUN_ACTIVE;
            else process.env.SPUR_WORKFLOW_RUN_ACTIVE = prior;
            await rm(dir, { recursive: true, force: true });
        }
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

    // ── continue --answer (0433: HITL answer injection) ──
    const TASTE_GATE_CLI_YAML = `name: cli-taste-gate
kind: state-machine
initialState: start
states:
  - id: start
    onEnter:
      - kind: note
        options:
          message: go
  - id: gate
    pause: true
    onEnter:
      - kind: hitl.confirm
        options:
          prompt: "Approve?"
  - id: approved
  - id: rejected
transitions:
  - from: start
    to: gate
    guard: { kind: always }
  - from: gate
    to: approved
    guard:
      kind: shell
      options:
        command: 'test "\${vars.__hitlAnswer}" = yes'
  - from: gate
    to: rejected
    guard:
      kind: shell
      options:
        command: 'test "\${vars.__hitlAnswer}" = no'
terminalStates:
  - approved
  - rejected
`;

    test('continue --answer yes overrides persisted default and takes approve edge', async () => {
        const dir = await createTempProject();
        const wfDir = join(dir, '.spur', 'workflows');
        await mkdir(wfDir, { recursive: true });
        await writeFile(join(wfDir, 'taste-gate.yaml'), TASTE_GATE_CLI_YAML);
        const dbUrl = join(dir, 'spur.db');
        const wf = join(wfDir, 'taste-gate.yaml');

        // Run pauses at gate. Under --json the DefaultHitlResponder fires;
        // SPUR_HITL_AUTO_APPROVE is NOT set, so it answers "no" by default.
        await main(['workflow', 'run', '--run-id', 'ans-1', wf, '--json'], {
            output: nullOutput(),
            cwd: dir,
            dbUrl,
        });

        // Resume with --answer yes -> approved (exit 0 because done).
        const out = createCapturedOutput();
        const exit = await main(['workflow', 'continue', 'ans-1', '--yes', '--answer', 'yes', '--json'], {
            output: out,
            cwd: dir,
            dbUrl,
        });
        expect(exit).toBe(0);
        const parsed = JSON.parse(out.messages.at(-1) ?? '{}');
        expect(parsed.status).toBe('done');
        expect(parsed.finalState).toBe('approved');
        await rm(dir, { recursive: true, force: true });
    });

    test('continue --answer no takes the reject edge', async () => {
        const dir = await createTempProject();
        const wfDir = join(dir, '.spur', 'workflows');
        await mkdir(wfDir, { recursive: true });
        await writeFile(join(wfDir, 'taste-gate.yaml'), TASTE_GATE_CLI_YAML);
        const dbUrl = join(dir, 'spur.db');
        const wf = join(wfDir, 'taste-gate.yaml');

        await main(['workflow', 'run', '--run-id', 'ans-2', wf, '--json'], {
            output: nullOutput(),
            cwd: dir,
            dbUrl,
            env: { SPUR_HITL_AUTO_APPROVE: '1' }, // auto-approve -> gate persists "yes" then pauses
        });

        // Resume with --answer no -> rejected (done, but not the approved path).
        const out = createCapturedOutput();
        const exit = await main(['workflow', 'continue', 'ans-2', '--yes', '--answer', 'no', '--json'], {
            output: out,
            cwd: dir,
            dbUrl,
        });
        expect(exit).toBe(0);
        const parsed = JSON.parse(out.messages.at(-1) ?? '{}');
        expect(parsed.status).toBe('done');
        expect(parsed.finalState).toBe('rejected');
        await rm(dir, { recursive: true, force: true });
    });

    test('continue --answer with invalid value exits 2', async () => {
        const dir = await createTempProject();
        const exit = await main(['workflow', 'continue', 'some-run', '--yes', '--answer', 'maybe', '--json'], {
            output: nullOutput(),
            cwd: dir,
            dbUrl: join(dir, 'spur.db'),
        });
        expect(exit).toBe(2);
        await rm(dir, { recursive: true, force: true });
    });

    test('continue --answer does not imply --yes (still asks confirmation when run-id omitted)', async () => {
        // R3: --answer is distinct from --yes. Without --yes and without a run-id,
        // the CLI asks for resume confirmation. Under --json the DefaultHitlResponder
        // denies -> exit 1. --answer alone must not bypass this.
        const dir = await createTempProject();
        const wfDir = join(dir, '.spur', 'workflows');
        await mkdir(wfDir, { recursive: true });
        await writeFile(join(wfDir, 'taste-gate.yaml'), TASTE_GATE_CLI_YAML);
        const dbUrl = join(dir, 'spur.db');
        const wf = join(wfDir, 'taste-gate.yaml');

        await main(['workflow', 'run', '--run-id', 'ans-3', wf, '--json'], {
            output: nullOutput(),
            cwd: dir,
            dbUrl,
        });

        // --answer yes WITHOUT --yes and without run-id -> confirmation prompt fires.
        // DefaultHitlResponder (under --json) denies -> "Aborted" -> exit 1.
        const out = createCapturedOutput();
        const exit = await main(['workflow', 'continue', '--answer', 'yes', '--json'], {
            output: out,
            cwd: dir,
            dbUrl,
        });
        expect(exit).toBe(1);
        expect(out.errors.some((e) => e.includes('Aborted'))).toBe(true);
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
        expect(output.messages.some((message) => message.startsWith('plan ('))).toBe(true);
        await rm(dir, { recursive: true, force: true });
    });

    // ── 0425 R2: failure terminal → status failed + non-zero exit ──────────────
    const FAILURE_TERMINAL_YAML = `name: cli-fail-term
kind: state-machine
initialState: start
states:
  - id: start
  - id: done
  - id: failed
transitions:
  - from: start
    to: failed
    guard: { kind: always }
terminalStates:
  - done
  - failed
failureStates:
  - failed
`;

    test('run landing in a failure terminal exits non-zero and reports status failed (0425 R2)', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'fail-term.yaml');
        await writeFile(workflowFile, FAILURE_TERMINAL_YAML);
        const output = createCapturedOutput();

        const exitCode = await main(['workflow', 'run', '--run-id', 'cli-fail-term-1', workflowFile, '--json'], {
            output,
            cwd: dir,
            dbUrl: join(dir, 'spur.db'),
        });

        expect(exitCode).toBe(1);
        const parsed = JSON.parse(output.messages.at(-1) ?? '{}') as {
            status?: string;
            finalState?: string;
            reason?: string;
        };
        expect(parsed.status).toBe('failed');
        expect(parsed.finalState).toBe('failed');
        expect(parsed.reason).toBe('terminal:failed');
        await rm(dir, { recursive: true, force: true });
    });

    test('run without failureStates still reports done when landing on a terminal named failed', async () => {
        // Backward-compat: absent failureStates keeps today's lifecycle.done behaviour.
        const dir = await createTempProject();
        const workflowFile = join(dir, 'legacy-fail-name.yaml');
        await writeFile(workflowFile, FAILURE_TERMINAL_YAML.replace(/\nfailureStates:\n {2}- failed\n/, '\n'));
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'run', '--run-id', 'cli-legacy-fail-name', workflowFile, '--json'], {
            output,
            cwd: dir,
            dbUrl: join(dir, 'spur.db'),
        });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(output.messages.at(-1) ?? '{}') as {
            status?: string;
            finalState?: string;
        };
        expect(parsed.status).toBe('done');
        expect(parsed.finalState).toBe('failed');
        await rm(dir, { recursive: true, force: true });
    });

    // ── 0425 R4: concurrent runs do not share gate artifacts ──────────────────
    /**
     * A workflow template placeholder. The escaped `\${` keeps TypeScript from interpolating,
     * so the literal `${vars.<name>}` text reaches the YAML for the engine to resolve.
     */
    const yamlVar = (name: string) => `\${vars.${name}}`;

    const RUN_SCOPED_GATE_YAML = [
        'name: cli-run-scoped-gate',
        'kind: state-machine',
        'initialState: probe',
        'states:',
        '  - id: probe',
        '    onEnter:',
        '      - kind: shell',
        '        options:',
        '          command: >-',
        '            mkdir -p .spur/run &&',
        `            printf '%s\\n' "${yamlVar('outcome')}" > ".spur/run/${yamlVar('__runId')}-gate.status"`,
        '  - id: done',
        '  - id: failed',
        'transitions:',
        '  - from: probe',
        '    to: done',
        '    guard:',
        '      kind: shell',
        '      options:',
        `        command: 'test "$(cat .spur/run/${yamlVar('__runId')}-gate.status 2>/dev/null)" = PASS'`,
        '  - from: probe',
        '    to: failed',
        '    guard:',
        '      kind: always',
        'terminalStates: [done, failed]',
        'failureStates: [failed]',
        'vars:',
        '  outcome: "PASS"',
        '  __runId: ""',
        '',
    ].join('\n');

    test('concurrent runs with opposite gate outcomes each read only their own artifacts (0425 R4)', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'run-scoped-gate.yaml');
        await writeFile(workflowFile, RUN_SCOPED_GATE_YAML);
        // Separate DB files per run: the regression under test is .spur/run artifact
        // isolation (both runs share `cwd: dir`), NOT DB migration concurrency. Two
        // in-process `main()` calls migrating the same fresh file race UNIQUE on
        // __spur_cli_migrations — pre-existing infra behaviour, out of scope here.
        const passDb = join(dir, 'pass.db');
        const failDb = join(dir, 'fail.db');

        const passOut = createCapturedOutput();
        const failOut = createCapturedOutput();
        const [passExit, failExit] = await Promise.all([
            main(['workflow', 'run', '--run-id', 'gate-pass', '--vars', '{"outcome":"PASS"}', workflowFile, '--json'], {
                output: passOut,
                cwd: dir,
                dbUrl: passDb,
            }),
            main(['workflow', 'run', '--run-id', 'gate-fail', '--vars', '{"outcome":"FAIL"}', workflowFile, '--json'], {
                output: failOut,
                cwd: dir,
                dbUrl: failDb,
            }),
        ]);

        expect(passExit).toBe(0);
        expect(failExit).toBe(1);
        const passParsed = JSON.parse(passOut.messages.at(-1) ?? '{}') as {
            status?: string;
            finalState?: string;
        };
        const failParsed = JSON.parse(failOut.messages.at(-1) ?? '{}') as {
            status?: string;
            finalState?: string;
        };
        expect(passParsed).toMatchObject({ status: 'done', finalState: 'done' });
        expect(failParsed).toMatchObject({ status: 'failed', finalState: 'failed' });

        // Each run wrote its own status file; neither overwrote the other.
        const passStatus = await readFile(join(dir, '.spur', 'run', 'gate-pass-gate.status'), 'utf8');
        const failStatus = await readFile(join(dir, '.spur', 'run', 'gate-fail-gate.status'), 'utf8');
        expect(passStatus.trim()).toBe('PASS');
        expect(failStatus.trim()).toBe('FAIL');
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

    // 0709: a terminally failed run projects ONE canonical escalation packet
    // from existing run evidence (run-log sink + system ledger unaffected).
    test('run subcommand projects an escalation packet when the run fails terminally', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'failing.yaml');
        await writeFile(
            workflowFile,
            [
                'name: cli-esc-flow',
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

        const exitCode = await main(['workflow', 'run', '--run-id', 'esc-1', workflowFile], {
            output,
            cwd: dir,
            dbUrl: ':memory:',
        });

        expect(exitCode).toBe(1);
        const packetPath = join(dir, '.spur', 'run', 'esc-1-escalation.json');
        expect(await exists(packetPath)).toBe(true);
        const packet = JSON.parse(await readFile(packetPath, 'utf8')) as Record<string, unknown>;
        expect(packet.schemaVersion).toBe(1);
        expect(packet.trigger).toBe('terminal-failure');
        expect((packet.decision as Record<string, unknown>).kind).toBe('inspect_failure');
        // The failing shell action stays visible in the run log; the packet is
        // additional, not a replacement (R7).
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

    // R6 / 0753 R2: validateRunId must reject run IDs that escape their
    // `.spur/run/<id>...` confinement. The pre-repair CLI handed
    // `options.runId` straight to path construction at `workflow.ts:424` and
    // `:512` (F-6). Assert the named error class plus every escape vector.
    test('validateRunId rejects path-separator / traversal / absolute / shell-meta IDs (R6)', () => {
        const cases = [
            'foo/bar', // unix separator
            'foo\\bar', // windows separator
            '..', // literal traversal
            '../etc/passwd', // traversal from outside
            'foo/../bar', // embedded traversal
            '/etc/passwd', // unix absolute
            'C:\\foo', // windows absolute
            'foo bar', // shell metacharacter (space)
            'foo;rm', // shell metacharacter (semicolon)
            'foo`bar`', // shell metacharacter (backtick)
            '.', // dot-only (traversal adjacent)
        ];
        for (const id of cases) {
            expect(() => validateRunId(id)).toThrow(InvalidRunIdError);
        }
    });

    test('validateRunId accepts UUID-like and dash-aliased IDs (R6)', () => {
        const ok = [
            'run-1',
            'a1b2c3d4-e5f6-7890-abcd-ef1234567890', // canonical UUID
            'cli-fail-term-1',
            'esc-1',
            'retain-log-run',
        ];
        for (const id of ok) {
            expect(validateRunId(id)).toBe(id);
        }
        // Empty / undefined input lets the caller mint a UUID; not invalid.
        expect(validateRunId(undefined)).toBe('');
        expect(validateRunId('')).toBe('');
    });

    test('run subcommand rejects a path-separator --run-id and never constructs a path from it', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'wf.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();

        // Path-separator: must be rejected at the CLI boundary, exit non-zero,
        // and produce no run log under `.spur/run/`.
        const exitCode = await main(['workflow', 'run', '--run-id', 'foo/bar', workflowFile], {
            output,
            cwd: dir,
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(1);
        // No path artifact was constructed from the rejected ID.
        expect(await exists(join(dir, '.spur', 'run', 'foo'))).toBe(false);
        expect(await exists(join(dir, '.spur', 'run', 'bar'))).toBe(false);
        // The error surfaces to the operator (R2 AC: a named error, not silent).
        const lastError = output.errors[output.errors.length - 1] ?? '';
        expect(lastError).toContain('run ID must contain only alphanumerics and dashes');
        await rm(dir, { recursive: true, force: true });
    });

    test('run subcommand rejects a traversal-segment --run-id (R6)', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'wf.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();

        const exitCode = await main(['workflow', 'run', '--run-id', '..', workflowFile], {
            output,
            cwd: dir,
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(1);
        // No `.spur/run/..` path was constructed (and the parent `.spur/run` was
        // not created either — validation rejects before any path operation).
        expect(await exists(join(dir, '.spur'))).toBe(false);
        await rm(dir, { recursive: true, force: true });
    });

    test('run subcommand rejects an absolute-path --run-id (R6)', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'wf.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();

        const exitCode = await main(['workflow', 'run', '--run-id', '/etc/passwd', workflowFile], {
            output,
            cwd: dir,
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(1);
        await rm(dir, { recursive: true, force: true });
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

    test('run retains the consolidated run log by default after a terminal run (0427 R6)', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);

        const exitCode = await main(['workflow', 'run', '--run-id', 'retain-log-run', workflowFile], {
            output: nullOutput(),
            cwd: dir,
            dbUrl: ':memory:',
        });

        expect(exitCode).toBe(0);
        const logPath = join(dir, '.spur', 'run', 'retain-log-run.log');
        expect((await readFile(logPath, 'utf8')).length).toBeGreaterThan(0);
        await rm(dir, { recursive: true, force: true });
    });

    test('run --no-log opts out of writing the consolidated run log (0427 R7)', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);

        const exitCode = await main(['workflow', 'run', '--no-log', '--run-id', 'no-log-run', workflowFile], {
            output: nullOutput(),
            cwd: dir,
            dbUrl: ':memory:',
        });

        expect(exitCode).toBe(0);
        const logPath = join(dir, '.spur', 'run', 'no-log-run.log');
        await expect(readFile(logPath, 'utf8')).rejects.toThrow();
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
                '          role: coder',
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
        // 0536 R3: the fake `claude` binary has no executor entry → one bare-binary
        // transition warning, no other errors.
        expect(errors.filter((e) => e.includes('bare coding-agent binary name'))).toHaveLength(1);
        expect(errors.filter((e) => !e.includes('bare coding-agent binary name'))).toEqual([]);
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

    test('trace --output requires --follow and rejects --json', async () => {
        expect(
            await main(['workflow', 'trace', 'run-1', '--output'], { output: nullOutput(), dbUrl: ':memory:' }),
        ).toBe(1);
        expect(
            await main(['workflow', 'trace', 'run-1', '--follow', '--output', '--json'], {
                output: nullOutput(),
                dbUrl: ':memory:',
            }),
        ).toBe(1);
        // --follow --output without a run-id is rejected by the shared follow rule.
        expect(
            await main(['workflow', 'trace', '--follow', '--output'], { output: nullOutput(), dbUrl: ':memory:' }),
        ).toBe(1);
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
        expect(output.messages.some((m) => m.includes(dir.slice(dir.lastIndexOf('/') + 1)))).toBe(true);

        output.messages.length = 0;
        const exitCode2 = await main(['workflow', 'trace', 'trace-test-run'], { output, cwd: dir, dbUrl });
        expect(exitCode2).toBe(0);
        expect(output.messages.some((m) => m.includes('trace-test-run'))).toBe(true);
        expect(output.messages.some((m) => m.includes('note'))).toBe(true);
        expect(output.messages.some((m) => m.includes('Project:'))).toBe(true);
        expect(output.messages.some((m) => m.includes('started=') && m.includes('outcome='))).toBe(true);

        output.messages.length = 0;
        const jsonExit = await main(['workflow', 'trace', 'trace-test-run', '--json'], {
            output,
            cwd: dir,
            dbUrl,
        });
        expect(jsonExit).toBe(0);
        const trace = JSON.parse(output.messages.join('')) as WorkflowTraceTimeline;
        expect(trace.run.runId).toBe('trace-test-run');
        expect(trace.run.workflowName).toBe('cli-action-flow');
        expect(trace.run.project).toEqual({ name: dir.slice(dir.lastIndexOf('/') + 1), root: dir });
        expect(trace.run).toHaveProperty('durationMs');
        expect(trace.run).toHaveProperty('outcome');
        expect(trace.events.find((event) => event.kind === 'transition')).toMatchObject({
            from: 'start',
            to: 'done',
        });
        expect(trace.events.find((event) => event.kind === 'action')).toMatchObject({
            actionKind: 'note',
            startedAt: expect.any(String),
            completedAt: expect.any(String),
            outcome: 'success',
        });
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

    // ── list with bundled: path (read-time expansion via bundledConfigRoot) ──

    test('list subcommand expands bundled: paths against the installed package config root', async () => {
        const dir = await createTempProject();
        await mkdir(join(dir, '.spur'), { recursive: true });
        await writeFile(join(dir, '.spur', 'config.yaml'), 'workflows:\n  paths:\n    - bundled:workflows\n');
        const output = createCapturedOutput();

        const exitCode = await main(['workflow', 'list', '--json'], { output, cwd: dir, dbUrl: ':memory:' });

        expect(exitCode).toBe(0);
        const parsed = JSON.parse(output.messages[0] ?? '{}');
        const names = ((parsed.entries ?? []) as Array<{ name: string }>).map((entry) => entry.name);
        // The repository's bundled workflow catalog ships task-pipeline.yaml.
        expect(names).toContain('task-pipeline');
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
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean'], { output, cwd, dbUrl: ':memory:' });
        expect(exitCode).toBe(0);
        expect(output.messages).toContain('No stale runs older than 30m.');
        // Dual-scope housekeeping: the log-reclamation scope also ran.
        expect(output.messages).toContain('No retained run logs older than 30d.');
    });

    test('clean --dry-run works on empty DB', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean', '--dry-run'], { output, cwd, dbUrl: ':memory:' });
        expect(exitCode).toBe(0);
        expect(output.messages).toContain('No stale runs older than 30m.');
    });

    test('clean --json works on empty DB', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean', '--json'], { output, cwd, dbUrl: ':memory:' });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(output.messages[0] ?? '{}');
        expect(parsed).toHaveProperty('cleaned');
        expect(Array.isArray(parsed.cleaned)).toBe(true);
        // Dual-scope JSON: log reclamation rides along under `logs`.
        expect(parsed.logs).toHaveProperty('reclaimed');
        expect(Array.isArray(parsed.logs.reclaimed)).toBe(true);
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

    test('clean --logs scopes to log reclamation and skips stale-run finalization', async () => {
        const cwd = await createTempProject();
        const runDir = join(cwd, '.spur', 'run');
        await mkdir(runDir, { recursive: true });
        const oldLog = join(runDir, 'wf_old.log');
        const freshLog = join(runDir, 'wf_fresh.log');
        await writeFile(oldLog, 'old');
        await writeFile(freshLog, 'fresh');
        const oldMtime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
        await utimes(oldLog, oldMtime, oldMtime);

        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean', '--logs'], { output, cwd, dbUrl: ':memory:' });

        expect(exitCode).toBe(0);
        // Only the log scope ran — no stale-run line at all.
        expect(output.messages.some((m) => m.includes('stale run'))).toBe(false);
        expect(output.messages.some((m) => m.includes('Reclaimed 1 retained run log(s) (>30d):'))).toBe(true);
        expect(await exists(oldLog)).toBe(false);
        expect(await exists(freshLog)).toBe(true);
    });

    test('clean --logs --dry-run lists old logs without deleting', async () => {
        const cwd = await createTempProject();
        const runDir = join(cwd, '.spur', 'run');
        await mkdir(runDir, { recursive: true });
        const oldLog = join(runDir, 'wf_old.log');
        await writeFile(oldLog, 'old');
        const oldMtime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
        await utimes(oldLog, oldMtime, oldMtime);

        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean', '--logs', '--dry-run'], {
            output,
            cwd,
            dbUrl: ':memory:',
        });

        expect(exitCode).toBe(0);
        expect(output.messages.some((m) => m.includes('Would reclaim 1 retained run log(s) (>30d):'))).toBe(true);
        expect(await exists(oldLog)).toBe(true); // dry-run unlinked nothing
    });

    test('clean without --logs runs both scopes in one invocation', async () => {
        const cwd = await createTempProject();
        const runDir = join(cwd, '.spur', 'run');
        await mkdir(runDir, { recursive: true });
        const oldLog = join(runDir, 'wf_old.log');
        await writeFile(oldLog, 'old');
        const oldMtime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
        await utimes(oldLog, oldMtime, oldMtime);

        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean'], { output, cwd, dbUrl: ':memory:' });

        expect(exitCode).toBe(0);
        expect(output.messages).toContain('No stale runs older than 30m.'); // stale scope ran
        expect(output.messages.some((m) => m.includes('Reclaimed 1 retained run log(s) (>30d):'))).toBe(true); // log scope ran
        expect(await exists(oldLog)).toBe(false);
    });

    test('clean honors workflow.logRetentionDays from .spur/config.yaml', async () => {
        const cwd = await createTempProject();
        const runDir = join(cwd, '.spur', 'run');
        await mkdir(runDir, { recursive: true });
        const log = join(runDir, 'wf_mid.log');
        await writeFile(log, 'mid');
        // 10 days old: within the default 30d, past a 7d override.
        const mtime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
        await utimes(log, mtime, mtime);
        await writeFile(join(cwd, '.spur', 'config.yaml'), 'workflow:\n  logRetentionDays: 7\n');

        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean', '--logs'], { output, cwd, dbUrl: ':memory:' });

        expect(exitCode).toBe(0);
        expect(output.messages.some((m) => m.includes('Reclaimed 1 retained run log(s) (>7d):'))).toBe(true);
        expect(await exists(log)).toBe(false);
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
        const db = await seededAsyncDb('async-seeded-1');

        const exitCode = await main(['workflow', 'run', '--async', '--run-id', 'async-seeded-1', workflowFile], {
            output,
            cwd: dir,
            db,
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
        const db = await seededAsyncDb('async-seeded-2');

        const exitCode = await main(
            ['workflow', 'run', '--async', '--json', '--run-id', 'async-seeded-2', workflowFile],
            { output, cwd: dir, db },
        );

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
        const db = await seededAsyncDb('async-seeded-3');

        // --vars are forwarded to the spawned command argv; the parent verifies the
        // run registered (seeded) and exits cleanly (the child is detached and may
        // fail, but the parent doesn't wait for it).
        const exitCode = await main(
            ['workflow', 'run', '--async', '--vars', '{"wbs":"0116"}', '--run-id', 'async-seeded-3', workflowFile],
            { output, cwd: dir, db },
        );

        expect(exitCode).toBe(0);
        expect(output.messages[0] ?? '').toMatch(/^Started async run:/);
        await rm(dir, { recursive: true, force: true });
    });

    test('run --async --dry-run forwards dry-run to the spawned command', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();
        const db = await seededAsyncDb('async-seeded-4');

        const exitCode = await main(
            ['workflow', 'run', '--async', '--dry-run', '--run-id', 'async-seeded-4', workflowFile],
            { output, cwd: dir, db },
        );

        expect(exitCode).toBe(0);
        expect(output.messages[0] ?? '').toMatch(/^Started async run:/);
        await rm(dir, { recursive: true, force: true });
    });

    test('run --async --run-id uses the given run ID', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();
        const db = await seededAsyncDb('async-custom-id');

        const exitCode = await main(['workflow', 'run', '--async', '--run-id', 'async-custom-id', workflowFile], {
            output,
            cwd: dir,
            db,
        });

        expect(exitCode).toBe(0);
        expect(output.messages[0] ?? '').toContain('async-custom-id');
        await rm(dir, { recursive: true, force: true });
    });

    test('run --async propagates --no-log to the detached worker argv (0427 R3)', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();
        const db = await seededAsyncDb('async-seeded-6');
        const runSpy = spyOn(NodeProcessExecutor.prototype, 'run').mockResolvedValue({ exitCode: 0 } as never);
        try {
            const exitCode = await main(
                ['workflow', 'run', '--async', '--no-log', '--run-id', 'async-seeded-6', workflowFile],
                { output, cwd: dir, db },
            );
            expect(exitCode).toBe(0);
            expect(output.messages[0] ?? '').toMatch(/^Started async run:/);
            expect(runSpy).toHaveBeenCalledTimes(1);
            const args = runSpy.mock.calls[0]?.[0]?.args as string[] | undefined;
            expect(args?.join(' ')).toContain('--no-log');
        } finally {
            runSpy.mockRestore();
        }
        await rm(dir, { recursive: true, force: true });
    });

    // ── clean --force (0116) ──

    test('clean --force reports no stale runs on empty DB', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean', '--force'], { output, cwd, dbUrl: ':memory:' });
        expect(exitCode).toBe(0);
        // --force sets minutes=0, so the message has no age qualifier
        expect(output.messages).toContain('No stale runs.');
    });

    test('clean --force --dry-run works on empty DB', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean', '--force', '--dry-run'], { output, cwd, dbUrl: ':memory:' });
        expect(exitCode).toBe(0);
        expect(output.messages).toContain('No stale runs.');
    });

    test('clean --force --json works on empty DB', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean', '--force', '--json'], { output, cwd, dbUrl: ':memory:' });
        expect(exitCode).toBe(0);
        const parsed = JSON.parse(output.messages[0] ?? '{}');
        expect(parsed).toHaveProperty('cleaned');
        expect(parsed.olderThanMinutes).toBe(0);
    });

    test('clean --force overrides --older-than', async () => {
        const cwd = await createTempProject();
        const output = createCapturedOutput();
        // --force overrides --older-than: minutes=0 regardless
        const exitCode = await main(['workflow', 'clean', '--force', '--older-than', '999'], {
            output,
            cwd,
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

    // ── clean with actual stale runs (covers cleaned.map formatter) ──

    test('clean finalizes stale non-terminal runs and lists them in human output', async () => {
        const cwd = await createTempProject();
        const dbPath = join(cwd, '.spur', 'spur.db');
        await mkdir(join(cwd, '.spur'), { recursive: true });
        const db = await createMigratedDb({ url: dbPath });
        const now = Date.now();
        // Insert a non-terminal run that listStaleRuns will match.
        await db.run(
            'INSERT INTO runs (id, status, started_at, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
            ['stale-run-1', 'running', now, '{}', now, now],
        );
        db.close();

        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean'], { output, cwd, dbUrl: dbPath });

        expect(exitCode).toBe(0);
        expect(output.messages.some((m) => m.includes('Finalized 1 stale run(s)'))).toBe(true);
        expect(output.messages.some((m) => m.includes('stale-run-1'))).toBe(true);
        await rm(cwd, { recursive: true, force: true });
    });

    // ── trace --follow via CLI (covers inline write arrows in the follow branch) ──

    test('trace --follow writes timeline for an already-terminal run and exits', async () => {
        const cwd = await createTempProject();
        const dbPath = join(cwd, '.spur', 'spur.db');
        await mkdir(join(cwd, '.spur'), { recursive: true });
        const db = await createMigratedDb({ url: dbPath });
        const now = Date.now();
        await db.run(
            'INSERT INTO runs (id, workflow_name, mode, status, started_at, completed_at, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            ['terminal-run-1', 'test-flow', 'sync', 'done', now, now, '{}', now, now],
        );
        db.close();

        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'trace', '--follow', 'terminal-run-1', '--poll', '50'], {
            output,
            cwd,
            dbUrl: dbPath,
        });

        expect(exitCode).toBe(0);
        expect(output.messages.length).toBeGreaterThan(0);
        await rm(cwd, { recursive: true, force: true });
    });

    test('trace --follow --output emits no-log message for a terminal run without a log file', async () => {
        const cwd = await createTempProject();
        const dbPath = join(cwd, '.spur', 'spur.db');
        await mkdir(join(cwd, '.spur'), { recursive: true });
        const db = await createMigratedDb({ url: dbPath });
        const now = Date.now();
        await db.run(
            'INSERT INTO runs (id, workflow_name, mode, status, started_at, completed_at, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            ['terminal-run-2', 'test-flow', 'sync', 'done', now, now, '{}', now, now],
        );
        db.close();

        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'trace', '--follow', '--output', 'terminal-run-2', '--poll', '50'], {
            output,
            cwd,
            dbUrl: dbPath,
        });

        expect(exitCode).toBe(0);
        expect(output.messages.some((m) => m.includes('No run log') && m.includes('--no-log'))).toBe(true);
        await rm(cwd, { recursive: true, force: true });
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
            inputTokens: 12500,
            outputTokens: 3200,
            cacheReadTokens: 2000,
            cacheWriteTokens: 500,
            costUsd: 0,
            records: 1,
            recordsWithUsage: 1,
            messages: 1,
            toolCalls: 0,
            durationMs: 0,
            durationUnmeasured: 0,
        },
        cacheHit: 0.25,
        estimated: false,
        ...overrides,
    };
}

const UNJOINED_COST: ActionCostAttribution = {
    exact: null,
    estimated: null,
};

function makeActionEvent(cost?: ActionCostAttribution): TimelineEvent {
    return {
        kind: 'action',
        actionId: 'act-1',
        node: 'n1',
        actionKind: 'agent.run',
        status: 'done',
        duration: '120ms',
        durationMs: 120,
        startedAt: '2026-01-15T10:00:00.000Z',
        completedAt: '2026-01-15T10:00:00.120Z',
        ok: true,
        outcome: 'success',
        result: null,
        invocation: null,
        error: null,
        artifacts: [],
        label: ' ✓',
        cost,
    };
}

describe('formatActionCost', () => {
    test('returns empty string for non-action events', () => {
        const event: TimelineEvent = { kind: 'transition', from: 'a', to: 'b', trigger: null, at: '1' };
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

    test('renders token figures and cache-hit for an exact mapping (R1)', () => {
        expect(formatActionCost(makeActionEvent({ exact: makeCost(), estimated: null }))).toBe(
            ' · 12.5k in / 3.2k out · cache 25%',
        );
    });

    test('marks estimated mappings with the ~ prefix (R2)', () => {
        const est = makeCost({
            estimated: true,
            totals: { ...makeCost().totals, inputTokens: 5000, outputTokens: 1100 },
        });
        expect(formatActionCost(makeActionEvent({ exact: null, estimated: est }))).toBe(
            ' · ~5.0k in / ~1.1k out · cache ~25%',
        );
    });

    test('renders exact and estimated figures apart — never summed (R2)', () => {
        const est = makeCost({
            estimated: true,
            totals: { ...makeCost().totals, inputTokens: 5000, outputTokens: 1100 },
        });
        expect(formatActionCost(makeActionEvent({ exact: makeCost(), estimated: est }))).toBe(
            ' · 12.5k in / 3.2k out · cache 25% · ~5.0k in / ~1.1k out · cache ~25%',
        );
    });

    test('renders `cache n/a` when records matched but carry no cache dimensions', () => {
        const cost = makeCost({ cacheHit: null });
        expect(formatActionCost(makeActionEvent({ exact: cost, estimated: null }))).toBe(
            ' · 12.5k in / 3.2k out · cache n/a',
        );
    });

    test('never emits a currency value (R3)', () => {
        const rendered = formatActionCost(makeActionEvent({ exact: makeCost(), estimated: null }));
        expect(rendered).not.toMatch(/\$|USD|cost_usd/i);
    });

    test('renders `cost n/a` for matched rows without token data (0281/0284 never-fabricate)', () => {
        const noUsage = makeCost({ cacheHit: null, totals: { ...makeCost().totals, recordsWithUsage: 0 } });
        expect(formatActionCost(makeActionEvent({ exact: noUsage, estimated: null }))).toBe(' · cost n/a');
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
                project: { name: 'project', root: '/project' },
                durationMs: 300000,
                outcome: 'success',
            },
            events,
        };
    }

    test('appends a `history import` hint when a step has no joinable usage (R6, AC2)', () => {
        const out = formatTraceTimeline(makeTimeline([makeActionEvent(UNJOINED_COST)]));
        expect(out).toContain('spur history import');
    });

    test('omits the hint when every agent.run step is joined', () => {
        const out = formatTraceTimeline(makeTimeline([makeActionEvent({ exact: makeCost(), estimated: null })]));
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
                project: { name: 'project', root: '/project' },
                durationMs: null,
                outcome: 'running',
            },
            events: [],
            ...overrides,
        };
    }

    test('points the operator at the live run log when present', () => {
        const out = formatTraceTimeline(makeTimeline({ outputArtifact: '.spur/run/r1.log' }));
        expect(out).toContain('Run log: .spur/run/r1.log');
        expect(out).toContain('tail -f');
    });

    test('omits the artifact line when no capture exists', () => {
        const out = formatTraceTimeline(makeTimeline());
        expect(out).not.toContain('Agent output');
    });

    test('renders allow-listed result, invocation, error, artifact, and next action (0528)', () => {
        const action = makeActionEvent();
        if (action.kind !== 'action') throw new Error('expected action event');
        const out = formatTraceTimeline(
            makeTimeline({
                run: {
                    ...makeTimeline().run,
                    nextAction: { label: 'Follow run', kind: 'command', value: 'spur workflow trace r1 --follow' },
                },
                events: [
                    {
                        ...action,
                        result: { agent: 'codex', exitCode: 1 },
                        invocation: { command: 'codex', model: 'gpt-5' },
                        error: 'failed safely',
                        artifacts: ['.spur/run/r1-work-partial.md'],
                        nextAction: {
                            label: 'Inspect partial work',
                            kind: 'path',
                            value: '.spur/run/r1-work-partial.md',
                        },
                    },
                ],
            }),
        );
        expect(out).toContain('result=agent=codex exitCode=1');
        expect(out).toContain('invocation=command=codex model=gpt-5');
        expect(out).toContain('error=failed safely');
        expect(out).toContain('artifact=.spur/run/r1-work-partial.md');
        expect(out).toContain('Next: Inspect partial work');
        expect(out).toContain('Next: Follow run');
    });
});

describe('waitForRunRegistration', () => {
    test('returns true once the run row is traceable (0484 R2)', async () => {
        const trace = async () => undefined;
        await expect(waitForRunRegistration({ trace } as never, 'r', 1000, 50)).resolves.toBe(true);
    });

    test('returns false when the run never registers (phantom async spawn)', async () => {
        const trace = async () => {
            throw new Error('Run not found: r');
        };
        await expect(waitForRunRegistration({ trace } as never, 'r', 120, 30)).resolves.toBe(false);
    });

    test('SPUR_ASYNC_REGISTER_TIMEOUT_MS overrides the default budget; junk falls back', async () => {
        // The default is only reachable via the CLI branch, so assert the parser directly
        // through the exported helper: a tiny override must return false fast rather than
        // waiting the built-in 5s, and an unparseable value must not disable the check.
        const trace = async () => {
            throw new Error('Run not found: r');
        };
        const prev = process.env.SPUR_ASYNC_REGISTER_TIMEOUT_MS;
        try {
            process.env.SPUR_ASYNC_REGISTER_TIMEOUT_MS = '60';
            const started = Date.now();
            await expect(waitForRunRegistration({ trace } as never, 'r', undefined, 20)).resolves.toBe(false);
            expect(Date.now() - started).toBeLessThan(2000);
        } finally {
            if (prev === undefined) delete process.env.SPUR_ASYNC_REGISTER_TIMEOUT_MS;
            else process.env.SPUR_ASYNC_REGISTER_TIMEOUT_MS = prev;
        }
    });
});

describe('async launcher failure branch (0484 R2)', () => {
    // The helper is unit-tested above, but nothing covered what the COMMAND does when
    // registration fails — which is where the contract actually lives: exit non-zero,
    // name the sync fallback, and above all emit no run id. A phantom id in the JSON
    // payload would let a machine caller poll a run that never existed, which is the
    // whole failure R2 removes; it shipped unnoticed precisely because this gap existed.
    const withFastTimeout = async (fn: () => Promise<void>) => {
        const prev = process.env.SPUR_ASYNC_REGISTER_TIMEOUT_MS;
        process.env.SPUR_ASYNC_REGISTER_TIMEOUT_MS = '80';
        try {
            await fn();
        } finally {
            if (prev === undefined) delete process.env.SPUR_ASYNC_REGISTER_TIMEOUT_MS;
            else process.env.SPUR_ASYNC_REGISTER_TIMEOUT_MS = prev;
        }
    };

    test('an unregistered async run exits non-zero with a sync-fallback hint and no run id', async () => {
        await withFastTimeout(async () => {
            const dir = await createTempProject();
            const workflowFile = join(dir, 'workflow.yaml');
            await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
            const output = createCapturedOutput();
            // No seeded run row → the detached worker never registers → failure branch.
            const db = await createMigratedDb({ url: ':memory:' });
            const runId = 'phantom-run-text';

            const exitCode = await main(['workflow', 'run', '--async', '--run-id', runId, workflowFile], {
                output,
                cwd: dir,
                db,
            });

            expect(exitCode).toBe(1);
            const text = output.messages.join('\n');
            expect(text).toContain('async spawn failed');
            expect(text).toContain('omit --async');
            expect(text, 'must not hand back a run id trace cannot resolve').not.toContain(runId);
            expect(text).not.toMatch(/^Started async run:/m);
            await rm(dir, { recursive: true, force: true });
        });
    });

    test('--json failure payload carries status + hint and omits the phantom run id', async () => {
        await withFastTimeout(async () => {
            const dir = await createTempProject();
            const workflowFile = join(dir, 'workflow.yaml');
            await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
            const output = createCapturedOutput();
            const db = await createMigratedDb({ url: ':memory:' });
            const runId = 'phantom-run-json';

            const exitCode = await main(['workflow', 'run', '--async', '--json', '--run-id', runId, workflowFile], {
                output,
                cwd: dir,
                db,
            });

            expect(exitCode).toBe(1);
            const parsed = JSON.parse(output.messages[0] ?? '{}');
            expect(parsed.status).toBe('failed');
            expect(parsed.reason).toContain('failed to start or register');
            expect(parsed.hint).toContain('omit --async');
            expect(parsed, 'a machine caller reading .runId would poll a phantom run').not.toHaveProperty('runId');
            await rm(dir, { recursive: true, force: true });
        });
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
                project: { name: 'project', root: '/project' },
                durationMs: null,
                outcome: 'running',
            },
            events: [
                {
                    kind: 'action',
                    actionId: 'a1',
                    node: 'work',
                    actionKind: 'agent.run',
                    status: 'running',
                    duration: '',
                    durationMs: null,
                    startedAt: '2026-01-15T10:00:00.000Z',
                    completedAt: null,
                    ok: null,
                    outcome: 'running',
                    result: null,
                    invocation: null,
                    error: null,
                    artifacts: [],
                    label: ' (in-flight)',
                },
            ],
        };
        const done: WorkflowTraceTimeline = {
            run: {
                ...running.run,
                status: 'done',
                completedAt: '2026-01-15T10:01:00.000Z',
                durationMs: 60000,
                outcome: 'success',
            },
            events: [
                {
                    kind: 'action',
                    actionId: 'a1',
                    node: 'work',
                    actionKind: 'agent.run',
                    status: 'done',
                    duration: '60000ms',
                    durationMs: 60000,
                    startedAt: '2026-01-15T10:00:00.000Z',
                    completedAt: '2026-01-15T10:01:00.000Z',
                    ok: true,
                    outcome: 'success',
                    result: null,
                    invocation: null,
                    error: null,
                    artifacts: [],
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
        expect(writes.at(-1)).toBe('Run finalized: done — outcome=success duration=60000ms');
    });
});

describe('followRunLog', () => {
    /** status: 'running' until `terminal` flips true. */
    function serviceTrace(terminal: () => boolean) {
        return async () => ({ run: { status: terminal() ? 'done' : 'running' } }) as never;
    }

    test('tails appended lines and exits at terminal status', async () => {
        const dir = await createTempProject();
        await mkdir(join(dir, '.spur', 'run'), { recursive: true });
        const logPath = join(dir, '.spur', 'run', 'r9.log');
        await writeFile(logPath, 'first\n');

        const writes: string[] = [];
        let appended = false;
        const wait = async () => {
            if (!appended) {
                appended = true;
                await appendFile(logPath, 'second\n\nthird\n');
            }
        };
        let traceCalls = 0;
        const trace = async () => {
            traceCalls++;
            return { run: { status: traceCalls >= 3 ? 'done' : 'running' } } as never;
        };

        await followRunLog({ trace }, 'r9', dir, 5, (line) => writes.push(line), wait);

        expect(writes).toEqual(['first', 'second', '', 'third']);
        await rm(dir, { recursive: true, force: true });
    });

    test('holds back a trailing partial line until a newline lands', async () => {
        const dir = await createTempProject();
        await mkdir(join(dir, '.spur', 'run'), { recursive: true });
        const logPath = join(dir, '.spur', 'run', 'r10.log');
        await writeFile(logPath, 'complete\npartial');

        const writes: string[] = [];
        let appended = false;
        const wait = async () => {
            if (!appended) {
                appended = true;
                await appendFile(logPath, '-finished\n');
            }
        };
        let traceCalls = 0;
        const trace = async () => {
            traceCalls++;
            return { run: { status: traceCalls >= 3 ? 'done' : 'running' } } as never;
        };

        await followRunLog({ trace }, 'r10', dir, 5, (line) => writes.push(line), wait);

        expect(writes).toEqual(['complete', 'partial-finished']);
        await rm(dir, { recursive: true, force: true });
    });

    test('emits a clear message when the log never appears and the run ends terminal', async () => {
        const dir = await createTempProject();
        const writes: string[] = [];
        await followRunLog({ trace: serviceTrace(() => true) }, 'r11', dir, 5, (line) => writes.push(line));

        expect(writes).toHaveLength(1);
        expect(writes[0]).toContain('.spur/run/r11.log');
        expect(writes[0]).toContain('--no-log');
        await rm(dir, { recursive: true, force: true });
    });
});

describe('spur workflow show', () => {
    test('renders a fenced mermaid diagram for a valid definition', async () => {
        const dir = await createTempProject();
        const wf = join(dir, 'wf.yaml');
        await writeFile(wf, MINIMAL_WORKFLOW_YAML);
        const res = await runCli(['workflow', 'show', wf], dir);
        expect(res.code).toBe(0);
        expect(res.stdout).toContain('```mermaid');
        expect(res.stdout).toContain('flowchart TD');
        expect(res.stdout).toContain('start["start"]');
        expect(res.stdout).toContain('done(["done"])');
        expect(res.stdout).toContain('class done terminal;');
        expect(res.stdout).toContain('start --> done');
        await rm(dir, { recursive: true, force: true });
    });

    test('exits non-zero naming the file on a missing definition with no partial diagram', async () => {
        const dir = await createTempProject();
        const res = await runCli(['workflow', 'show', join(dir, 'missing.yaml')], dir);
        expect(res.code).not.toBe(0);
        expect(res.stderr + res.stdout).toContain('missing.yaml');
        expect(res.stdout).not.toContain('```mermaid');
        await rm(dir, { recursive: true, force: true });
    });

    const TODO_WORKFLOW_YAML = `name: cli-todo-flow
kind: state-machine
initialState: start
terminalStates:
  - done
  - failed
failureStates:
  - failed
states:
  - id: start
  - id: work
    pause: true
  - id: done
  - id: failed
transitions:
  - from: start
    to: work
  - from: work
    to: done
    guard:
      kind: approved
  - from: work
    to: failed
    guard:
      kind: always
  - from: work
    to: work
`;

    test('bare invocation is byte-identical to --format mermaid and the renderer output (0695 R1)', async () => {
        const dir = await createTempProject();
        const wf = join(dir, 'wf.yaml');
        await writeFile(wf, MINIMAL_WORKFLOW_YAML);
        const bare = createCapturedOutput();
        const explicit = createCapturedOutput();
        expect(await main(['workflow', 'show', wf], { output: bare, cwd: dir, dbUrl: ':memory:' })).toBe(0);
        expect(
            await main(['workflow', 'show', wf, '--format', 'mermaid'], {
                output: explicit,
                cwd: dir,
                dbUrl: ':memory:',
            }),
        ).toBe(0);
        expect(bare.messages).toEqual(explicit.messages);
        const def = await loadWorkflowDef(wf, { validateSchema: true });
        expect(bare.messages).toEqual([renderWorkflowMermaid(def)]);
        await rm(dir, { recursive: true, force: true });
    });

    test('--format todo renders the declared-step checklist with markers (0695 R3)', async () => {
        const dir = await createTempProject();
        const wf = join(dir, 'wf.yaml');
        await writeFile(wf, TODO_WORKFLOW_YAML);
        const output = createCapturedOutput();
        expect(await main(['workflow', 'show', wf, '--format', 'todo'], { output, cwd: dir, dbUrl: ':memory:' })).toBe(
            0,
        );
        // The renderer returns one multi-line string — the whole checklist as a single message.
        expect(output.messages).toEqual([
            [
                '# cli-todo-flow (state-machine) — declared steps',
                '',
                'Declared step inventory in declaration order, not a predicted execution path.',
                '',
                '- [ ] start — initial',
                '- [ ] work — pause · loop-back',
                '- [ ] done — terminal · conditional',
                '- [ ] failed — terminal · failure · conditional',
            ].join('\n'),
        ]);
        await rm(dir, { recursive: true, force: true });
    });

    test('--format todo --json emits { name, kind, format, steps } with markers (0695 R4)', async () => {
        const dir = await createTempProject();
        const wf = join(dir, 'wf.yaml');
        await writeFile(wf, TODO_WORKFLOW_YAML);
        const output = createCapturedOutput();
        expect(
            await main(['workflow', 'show', wf, '--format', 'todo', '--json'], { output, cwd: dir, dbUrl: ':memory:' }),
        ).toBe(0);
        expect(JSON.parse(output.messages.join('\n'))).toEqual({
            name: 'cli-todo-flow',
            kind: 'state-machine',
            format: 'todo',
            definitionDigest: 'sha256:671f9be44a311087ce05057074e7b8b5ca0ccdd4bc2ecc5b79f8d5ccfa1620ac',
            version: null,
            steps: [
                {
                    id: 'start',
                    initial: true,
                    terminal: false,
                    failure: false,
                    pause: false,
                    loopBack: false,
                    conditional: false,
                },
                {
                    id: 'work',
                    initial: false,
                    terminal: false,
                    failure: false,
                    pause: true,
                    loopBack: true,
                    conditional: false,
                },
                {
                    id: 'done',
                    initial: false,
                    terminal: true,
                    failure: false,
                    pause: false,
                    loopBack: false,
                    conditional: true,
                },
                {
                    id: 'failed',
                    initial: false,
                    terminal: true,
                    failure: true,
                    pause: false,
                    loopBack: false,
                    conditional: true,
                },
            ],
        });
        await rm(dir, { recursive: true, force: true });
    });

    test('bare --json emits the mermaid envelope with the exact diagram (0695 R4)', async () => {
        const dir = await createTempProject();
        const wf = join(dir, 'wf.yaml');
        await writeFile(wf, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();
        expect(await main(['workflow', 'show', wf, '--json'], { output, cwd: dir, dbUrl: ':memory:' })).toBe(0);
        expect(JSON.parse(output.messages.join('\n'))).toEqual({
            name: 'cli-test-flow',
            kind: 'state-machine',
            format: 'mermaid',
            definitionDigest: 'sha256:2cd0a58183d3f75b3fc783e28e1adbe566da06af53938ecb067b738196e3774b',
            version: null,
            diagram: renderWorkflowMermaid(await loadWorkflowDef(wf, { validateSchema: true })),
        });
        await rm(dir, { recursive: true, force: true });
    });

    test('unknown --format exits non-zero naming both accepted values (0695 R7)', async () => {
        const dir = await createTempProject();
        const wf = join(dir, 'wf.yaml');
        await writeFile(wf, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();
        expect(
            await main(['workflow', 'show', wf, '--format', 'outline'], { output, cwd: dir, dbUrl: ':memory:' }),
        ).toBe(1);
        expect(output.errors).toEqual(["workflow show: unknown --format 'outline' — expected mermaid or todo"]);
        await rm(dir, { recursive: true, force: true });
    });

    test('unresolvable path exits 1 with the same message under every format (0695 R8)', async () => {
        const dir = await createTempProject();
        const missing = join(dir, 'missing.yaml');
        const mermaid = createCapturedOutput();
        const todo = createCapturedOutput();
        expect(await main(['workflow', 'show', missing], { output: mermaid, cwd: dir, dbUrl: ':memory:' })).toBe(1);
        expect(
            await main(['workflow', 'show', missing, '--format', 'todo'], {
                output: todo,
                cwd: dir,
                dbUrl: ':memory:',
            }),
        ).toBe(1);
        expect(todo.errors).toEqual(mermaid.errors);
        expect(todo.messages).toEqual([]);
        await rm(dir, { recursive: true, force: true });
    });

    test('a definition failing schema validation exits 1 identically under every format (0695 R8)', async () => {
        const dir = await createTempProject();
        const bad = join(dir, 'bad.yaml');
        await writeFile(bad, 'name: broken\nkind: state-machine\ninitialState: start\nstates: []\ntransitions: []\n');
        const mermaid = createCapturedOutput();
        const todo = createCapturedOutput();
        expect(await main(['workflow', 'show', bad], { output: mermaid, cwd: dir, dbUrl: ':memory:' })).toBe(1);
        expect(
            await main(['workflow', 'show', bad, '--format', 'todo'], { output: todo, cwd: dir, dbUrl: ':memory:' }),
        ).toBe(1);
        expect(todo.errors).toEqual(mermaid.errors);
        expect(todo.errors[0]).toContain('cannot read or parse');
        await rm(dir, { recursive: true, force: true });
    });

    test('--format todo renders the same sequence buildWorkflowSteps derives (0695 R5)', async () => {
        const dir = await createTempProject();
        const wf = join(dir, 'wf.yaml');
        await writeFile(wf, TODO_WORKFLOW_YAML);
        const output = createCapturedOutput();
        expect(
            await main(['workflow', 'show', wf, '--format', 'todo', '--json'], { output, cwd: dir, dbUrl: ':memory:' }),
        ).toBe(0);
        const def = await loadWorkflowDef(wf, { validateSchema: true });
        expect(JSON.parse(output.messages.join('\n'))).toMatchObject({ steps: buildWorkflowSteps(def) });
        await rm(dir, { recursive: true, force: true });
    });

    test('R2: CLI workflow run passes spurConfig through makeSvc resolving default agent (task 0752)', async () => {
        const dir = await createTempProject();
        const wf = join(dir, 'wf.yaml');
        await writeFile(wf, MINIMAL_WORKFLOW_YAML);
        await mkdir(join(dir, '.spur'), { recursive: true });
        await writeFile(join(dir, '.spur', 'config.yaml'), 'agent:\n  default: coder\n');
        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'run', wf, '--dry-run'], {
            output,
            cwd: dir,
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(0);
        await rm(dir, { recursive: true, force: true });
    });
});
