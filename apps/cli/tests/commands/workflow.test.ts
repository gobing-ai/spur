/**
 * Thin-wrapper integration tests for apps/cli/src/commands/workflow.ts.
 * Behavioral tests for WorkflowAppService live in packages/app/tests/services/workflow-service.test.ts.
 */
import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { appendFile, chmod, exists, mkdir, mkdtemp, readFile, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    _resetAgentServiceShimsForTest,
    buildWorkflowSteps,
    projectWorkflowProgress,
    type TimelineActionDecision,
    type TimelineEvent,
    type WorkflowProgressProjection,
    WorkflowSteeringController,
    type WorkflowTraceTimeline,
} from '@gobing-ai/spur-app';
import { getEnvVar, getEnvVars, removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import type { ActionCost, ActionCostAttribution } from '@gobing-ai/spur-domain';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import { loadWorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import {
    asyncRegisterTimeoutMs,
    followRunLog,
    followTrace,
    formatActionCost,
    formatTraceTimeline,
    InvalidRunIdError,
    submitSteeringLine,
    validateRunId,
    waitForResumeClaim,
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

/** The `workflow validate --json` envelope subset the bundled gate reads. */
interface ValidateJson {
    valid?: boolean;
    composition?: {
        findings?: Array<{
            level?: string;
            workflow?: string;
            state?: string;
            actionKey?: string;
            measure: { kind: string; measured: number };
        }>;
    };
}

/**
 * Validate one workflow file exactly as the bundled-definition loop does: an isolated
 * no-config cwd, `:memory:` DB, and FULL JSON-Schema resolution. `errorFindings` flattens
 * the error-level composition findings to `workflow state actionKey kind=measured` lines,
 * so a gate failure names its finding (0826 R1; ADR-115).
 */
async function validateWorkflowFile(
    file: string,
): Promise<{ exitCode: number; parsed: ValidateJson; errorFindings: string[] }> {
    // Isolate cwd to a temp dir with no .spur/config.yaml so main() takes the
    // lightweight no-config branch. Without this, cwd falls back to process.cwd()
    // (the repo root, which HAS a config), triggering full app bootstrap on every
    // validate call — environment-fragile on CI.
    const cwd = await createTempProject();
    const output = createCapturedOutput();
    const exitCode = await main(['workflow', 'validate', file, '--json'], { output, cwd, dbUrl: ':memory:' });
    const parsed = JSON.parse(output.messages.at(-1) ?? '{}') as ValidateJson;
    const errorFindings = (parsed.composition?.findings ?? [])
        .filter((f) => f.level === 'error')
        .map((f) => `${f.workflow} ${f.state} ${f.actionKey} ${f.measure.kind}=${f.measure.measured}`);
    return { exitCode, parsed, errorFindings };
}

/**
 * In-memory DB + a spawn mock that REGISTERS the run row when the --async launcher
 * spawns its worker (task 0484 R2). 0901 R1 changed the fixture: `run --async` now
 * refuses a pre-existing run id, so the old trick of seeding the row before the
 * launcher runs reads as a terminal-id collision. The mock restores the real
 * sequencing instead — no row at launch, row appears as a consequence of spawn,
 * and the parent's registration poll (`waitForRunRegistration`) sees it after.
 */
async function spawnRegistersRun(runId: string) {
    const db = await createMigratedDb({ url: ':memory:' });
    const now = Date.now();
    const runSpy = spyOn(NodeProcessExecutor.prototype, 'run').mockImplementation(async () => {
        await db.run(
            'INSERT INTO runs (id, workflow_name, mode, status, started_at, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [runId, 'cli-test-flow', 'async', 'running', now, '{}', now, now],
        );
        return { exitCode: 0 } as never;
    });
    return { db, runSpy };
}

describe('workflow command (main)', () => {
    test('unknown subcommand returns 1', async () => {
        const exitCode = await main(['workflow', 'unknown-cmd'], { output: nullOutput() });
        expect(exitCode).toBe(1);
    });

    // Bundled definitions validate with full schema resolution and carry no error-level
    // composition finding (ADR-115 gate over the bundled shared-workflow layer, 0826).
    const REPO_ROOT = join(import.meta.dir, '..', '..', '..', '..');
    const bundledWorkflows = readdirSync(join(REPO_ROOT, 'config', 'workflows'))
        .filter((f) => /\.ya?ml$/.test(f))
        .sort();
    for (const wf of bundledWorkflows) {
        test(`bundled workflows/${wf} validates (schema resolves)`, async () => {
            const { exitCode, parsed, errorFindings } = await validateWorkflowFile(
                join(REPO_ROOT, 'config', 'workflows', wf),
            );
            // Findings before the exit code, so a failure names the workflow, state and action.
            expect(parsed.valid).toBe(true);
            expect(errorFindings).toEqual([]);
            expect(exitCode).toBe(0);
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

    test('list subcommand (plain) always lists the project layer header, even when empty (0819 R2)', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'spur-wf-list-empty-'));
        const lines: string[] = [];
        const exitCode = await main(['workflow', 'list'], {
            output: { write: (m) => lines.push(m), error: () => {} },
            cwd: dir,
            dbUrl: ':memory:',
        });
        expect(exitCode).toBe(0);
        const text = lines.join('\n');
        // 0819 R2: the project layer header + its empty marker print even with no
        // workflows; the shared layer (shipped catalog) is still listed.
        expect(text).toContain('project/');
        expect(text).toContain('(no workflows)');
        expect(text).toContain('shared/');
        await rm(dir, { recursive: true, force: true });
    });

    test('list subcommand (plain) labels entries per layer, including registered extras (0819 R1/R3)', async () => {
        const dir = await createTempProject();
        const wfDir = join(dir, '.spur', 'workflows');
        const regDir = join(dir, 'ops-workflows');
        await mkdir(wfDir, { recursive: true });
        await mkdir(regDir, { recursive: true });
        await writeFile(join(wfDir, 'test.yaml'), MINIMAL_WORKFLOW_YAML);
        await writeFile(
            join(regDir, 'ops.yaml'),
            MINIMAL_WORKFLOW_YAML.replace('name: cli-test-flow', 'name: cli-ops-flow'),
        );
        await writeFile(join(dir, '.spur', 'config.yaml'), `workflows:\n  paths:\n    - ops-workflows\n`);
        const output = createCapturedOutput();

        const exitCode = await main(['workflow', 'list'], { output, cwd: dir, dbUrl: ':memory:' });

        expect(exitCode).toBe(0);
        const text = output.messages.join('\n');
        expect(text).toContain('project/');
        expect(text).toContain('registered/');
        expect(text).toContain('shared/');
        expect(text).toContain('cli-test-flow');
        expect(text).toContain('cli-ops-flow');
        expect(text).toContain('[registered layer]');
        expect(text).toContain('[shared layer]');
        expect(text).not.toContain('global');
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
        const prior = getEnvVar('SPUR_WORKFLOW_RUN_ACTIVE');
        setEnvVar('SPUR_WORKFLOW_RUN_ACTIVE', '1');
        try {
            const exitCode = await main(['workflow', 'run', workflowFile], { output, cwd: dir, dbUrl: ':memory:' });

            expect(exitCode).toBe(1);
            expect(output.errors.join('\n')).toContain('refusing to start');
            expect(output.errors.join('\n')).toContain('SPUR_WORKFLOW_RUN_ACTIVE=1');
            // Refusal precedes execution: nothing was run, so no summary line was emitted.
            expect(output.messages.join('\n')).not.toContain('workflow');
        } finally {
            if (prior === undefined) removeEnvVar('SPUR_WORKFLOW_RUN_ACTIVE');
            else setEnvVar('SPUR_WORKFLOW_RUN_ACTIVE', prior);
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

    test('the bundled composition gate fails on error-level findings and ignores warn-level ones (0826 R1)', async () => {
        const dir = await createTempProject();
        const errorFile = join(dir, 'error.yaml');
        await writeFile(errorFile, compositionFixture(11));
        const errorRun = await validateWorkflowFile(errorFile);
        // `workflow` is the fixture file's basename without extension (collectCompositionAdvisory).
        expect(errorRun.errorFindings).toEqual(['error start start:onEnter:0 shell-lines=11']);
        expect(errorRun.exitCode).toBe(1);

        const warnFile = join(dir, 'warn.yaml');
        await writeFile(warnFile, compositionFixture(6));
        const warnRun = await validateWorkflowFile(warnFile);
        expect(warnRun.errorFindings).toEqual([]);
        expect(warnRun.exitCode).toBe(0);
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

    // 0822 R2: composition findings are validate-path-only. Run, dry-run and
    // continue behave exactly as they do for a definition with no findings —
    // none computes or prints a `composition` line, whatever the finding level.
    test('run, run --dry-run and continue never report composition findings (0822 R2)', async () => {
        const dir = await createTempProject();
        const wfDir = join(dir, '.spur', 'workflows');
        await mkdir(wfDir, { recursive: true });
        // Error-level shell program (11 logical commands) on the start state; the
        // workflow pauses at `gate`, so continue has something to resume.
        const errorPauser = `name: cli-composition-pauser
kind: state-machine
initialState: start
states:
  - id: start
    onEnter:
      - kind: shell
        options:
          command: |
${Array.from({ length: 11 }, (_, i) => `            echo step-${i}`).join('\n')}
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
terminalStates: [done]
`;
        await writeFile(join(wfDir, 'pauser.yaml'), errorPauser);
        await writeFile(join(wfDir, 'plain.yaml'), compositionFixture(11));
        const dbUrl = join(dir, 'spur.db');

        // Plain run executes to done — an error-level finding neither blocks nor reports.
        const runOut = createCapturedOutput();
        const runExit = await main(['workflow', 'run', '--run-id', 'comp-run-1', join(wfDir, 'plain.yaml')], {
            output: runOut,
            cwd: dir,
            dbUrl,
        });
        expect(runExit).toBe(0);
        expect(runOut.messages.join('\n')).toContain('workflow done: cli-composition-flow');
        expect(runOut.errors.join('\n')).not.toContain('composition');

        // Dry run walks the graph — same no-findings contract.
        const dryOut = createCapturedOutput();
        const dryExit = await main(
            ['workflow', 'run', '--dry-run', '--run-id', 'comp-dry-1', join(wfDir, 'plain.yaml')],
            {
                output: dryOut,
                cwd: dir,
                dbUrl,
            },
        );
        expect(dryExit).toBe(0);
        expect(dryOut.errors.join('\n')).not.toContain('composition');

        // Run to the pause, then continue — resumed like any paused run, no composition output.
        const pauseOut = createCapturedOutput();
        const pauseExit = await main(['workflow', 'run', '--run-id', 'comp-p1', join(wfDir, 'pauser.yaml')], {
            output: pauseOut,
            cwd: dir,
            dbUrl,
        });
        expect(pauseExit).toBe(1); // paused != done — unchanged baseline behavior
        expect(pauseOut.errors.join('\n')).not.toContain('composition');

        const contOut = createCapturedOutput();
        const contExit = await main(['workflow', 'continue', '--yes', '--answer', 'yes'], {
            output: contOut,
            cwd: dir,
            dbUrl,
        });
        expect(contExit).toBe(0);
        expect(contOut.errors.join('\n')).not.toContain('composition');
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
        const exitCode = await main(['workflow', 'continue', '--yes', '--answer', 'yes'], {
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
        const contExit = await main(['workflow', 'continue', '--yes', '--answer', 'yes', '--json'], {
            output: contOut,
            cwd: dir,
            dbUrl,
        });
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
        const exitCode = await main(['workflow', 'continue', 'cli-p2', '--answer', 'yes', '--json'], {
            output: out,
            cwd: dir,
            dbUrl,
        });
        expect(exitCode).toBe(0);
        expect(JSON.parse(out.messages.at(-1) ?? '{}').status).toBe('done');
        await rm(dir, { recursive: true, force: true });
    });

    // A workflow that records an observable side effect, then pauses at the gate.
    const RECORD_RESUME_WORKFLOW_YAML = `name: cli-record-pauser
kind: state-machine
initialState: start
states:
  - id: start
    onEnter:
      - kind: shell
        options:
          command: 'echo "tick" >> counter.txt'
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

    test('continue keeps run identity: appends only new record sections, repeats no side effect, settles state (0926 AC1)', async () => {
        const dir = await createTempProject();
        const wfDir = join(dir, '.spur', 'workflows');
        await mkdir(wfDir, { recursive: true });
        await writeFile(join(wfDir, 'record-pauser.yaml'), RECORD_RESUME_WORKFLOW_YAML);
        const dbUrl = join(dir, 'spur.db');
        const counter = join(dir, 'counter.txt');
        const mdPath = join(dir, '.spur', 'run', 'cli-rec1.md');
        const statePath = join(dir, '.spur', 'run', 'cli-rec1.state.json');

        const runExit = await main(['workflow', 'run', '--run-id', 'cli-rec1', join(wfDir, 'record-pauser.yaml')], {
            output: nullOutput(),
            cwd: dir,
            dbUrl,
        });
        expect(runExit).toBe(1); // paused at the gate
        // The recorded external effect ran exactly once.
        expect((await readFile(counter, 'utf8')).trim().split('\n')).toEqual(['tick']);
        const mdAfterRun = await readFile(mdPath, 'utf8');
        expect(JSON.parse(await readFile(statePath, 'utf8'))).toMatchObject({ runId: 'cli-rec1', status: 'paused' });

        const contExit = await main(['workflow', 'continue', 'cli-rec1', '--yes', '--answer', 'yes'], {
            output: createCapturedOutput(),
            cwd: dir,
            dbUrl,
        });
        expect(contExit).toBe(0);

        // Same run id, append-only record: original bytes intact, new sections after.
        const mdAfterResume = await readFile(mdPath, 'utf8');
        expect(mdAfterResume.startsWith(mdAfterRun)).toBe(true);
        expect(mdAfterResume.length).toBeGreaterThan(mdAfterRun.length);
        // Record recovery did not repeat the prior external effect.
        expect((await readFile(counter, 'utf8')).trim().split('\n')).toEqual(['tick']);
        // State atomically follows the authoritative trace outcome.
        expect(JSON.parse(await readFile(statePath, 'utf8'))).toMatchObject({
            schemaVersion: 1,
            runId: 'cli-rec1',
            status: 'done',
        });
        await rm(dir, { recursive: true, force: true });
    });

    test('continue --no-log writes nothing to the pair (0926 AC2/R4)', async () => {
        const dir = await createTempProject();
        const wfDir = join(dir, '.spur', 'workflows');
        await mkdir(wfDir, { recursive: true });
        await writeFile(join(wfDir, 'pauser.yaml'), PAUSING_WORKFLOW_YAML);
        const dbUrl = join(dir, 'spur.db');
        await main(['workflow', 'run', '--run-id', 'cli-rec2', join(wfDir, 'pauser.yaml')], {
            output: nullOutput(),
            cwd: dir,
            dbUrl,
        });
        const mdPath = join(dir, '.spur', 'run', 'cli-rec2.md');
        const statePath = join(dir, '.spur', 'run', 'cli-rec2.state.json');
        const mdBefore = await readFile(mdPath, 'utf8');
        const stateBefore = await readFile(statePath, 'utf8');

        const contExit = await main(['workflow', 'continue', 'cli-rec2', '--yes', '--answer', 'yes', '--no-log'], {
            output: createCapturedOutput(),
            cwd: dir,
            dbUrl,
        });
        expect(contExit).toBe(0);

        // The explicit opt-out suppresses the resume's record writes entirely.
        expect(await readFile(mdPath, 'utf8')).toBe(mdBefore);
        expect(await readFile(statePath, 'utf8')).toBe(stateBefore);
        await rm(dir, { recursive: true, force: true });
    });

    test('continue of a non-paused run returns 1', async () => {
        const dir = await createTempProject();
        const exitCode = await main(['workflow', 'continue', 'ghost-run', '--answer', 'yes', '--json'], {
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

    test('partial --vars keeps other declared defaults (0948 R2)', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        const outFile = join(dir, 'vars.out');
        await writeFile(
            workflowFile,
            [
                'name: vars-merge',
                'kind: state-machine',
                'initialState: start',
                'vars:',
                '  featureId: "X"',
                '  verificationCmd: "bun run spur-check-feature"',
                '  keepMe: "yes"',
                'states:',
                '  - id: start',
                '    onEnter:',
                '      - kind: shell',
                '        options:',
                `          command: 'printf "%s\\n" "$verificationCmd" "$keepMe" > ${outFile}'`,
                '  - id: done',
                'transitions:',
                '  - from: start',
                '    to: done',
                '    guard:',
                '      kind: always',
                'terminalStates:',
                '  - done',
                '',
            ].join('\n'),
        );
        const output = createCapturedOutput();
        const exitCode = await main(
            ['workflow', 'run', '--run-id', 'vars-merge-0948', '--vars', '{"featureId":"E7"}', workflowFile],
            { output, cwd: dir, dbUrl: ':memory:' },
        );
        expect(exitCode).toBe(0);
        expect(await readFile(outFile, 'utf8')).toBe('bun run spur-check-feature\nyes\n');
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

        const tracePath = join(dir, '.spur', 'workflow', 'trace-file-run.jsonl');
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

    test('run records the two-file pair by default after a terminal run (0427 R6 / 0925 AC1)', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);

        const exitCode = await main(['workflow', 'run', '--run-id', 'retain-log-run', workflowFile], {
            output: nullOutput(),
            cwd: dir,
            dbUrl: ':memory:',
        });

        expect(exitCode).toBe(0);
        const mdPath = join(dir, '.spur', 'run', 'retain-log-run.md');
        expect((await readFile(mdPath, 'utf8')).length).toBeGreaterThan(0);
        expect(await exists(join(dir, '.spur', 'run', 'retain-log-run.log'))).toBe(false);
        const state = JSON.parse(
            await readFile(join(dir, '.spur', 'run', 'retain-log-run.state.json'), 'utf8'),
        ) as Record<string, unknown>;
        expect(state).toMatchObject({ schemaVersion: 1, runId: 'retain-log-run', status: 'done' });
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
        await expect(readFile(join(dir, '.spur', 'run', 'no-log-run.md'), 'utf8')).rejects.toThrow();
        await expect(readFile(join(dir, '.spur', 'run', 'no-log-run.state.json'), 'utf8')).rejects.toThrow();
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

        const originalPath = getEnvVar('PATH');
        setEnvVar('PATH', `${binDir}:${originalPath ?? ''}`);
        try {
            expect(
                await main(['workflow', 'run', '--steer', '--run-id', 'steer-run', workflowFile], {
                    output,
                    cwd: dir,
                    env: { ...getEnvVars() },
                    dbUrl: ':memory:',
                }),
            ).toBe(0);
        } finally {
            // Assigning undefined stringifies to "undefined" and breaks later tests'
            // shell PATH (mkdir not found → workflow status failed on CI).
            if (originalPath === undefined) removeEnvVar('PATH');
            else setEnvVar('PATH', originalPath);
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

    test('0930 R2 — trace rejects --timeout without --follow (VALIDATION_FAILED)', async () => {
        const output = createCapturedOutput();
        expect(await main(['workflow', 'trace', 'run-1', '--timeout', '5000'], { output, dbUrl: ':memory:' })).toBe(1);
        expect(output.errors.join('')).toContain('--timeout requires --follow');

        const jsonOutput = createCapturedOutput();
        expect(
            await main(['workflow', 'trace', 'run-1', '--timeout', '5000', '--json', '--json-envelope'], {
                output: jsonOutput,
                dbUrl: ':memory:',
            }),
        ).toBe(1);
        expect(JSON.parse(jsonOutput.messages.at(-1) ?? '{}')).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    });

    test('0930 R2 — trace rejects a --timeout that is not a positive integer of milliseconds', async () => {
        for (const bad of ['0', '-5', 'abc', '1.5', '']) {
            const output = createCapturedOutput();
            // Omit --json: --follow --json is rejected first and would hide this guard.
            expect(
                await main(['workflow', 'trace', 'run-1', '--follow', '--timeout', bad], {
                    output,
                    dbUrl: ':memory:',
                }),
            ).toBe(1);
            expect(output.errors.join('')).toContain('--timeout must be a positive integer of milliseconds');
        }
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

        // Now continue without --yes — the HITL responder would fire interactively.
        // 0901 R3: a headless continue still needs an explicit --answer; the env
        // auto-approve alone no longer bypasses the guard (task 0241 R1 semantics
        // apply to the responder, not the launch guard).
        const contOut = createCapturedOutput();
        const contExit = await main(['workflow', 'continue', '--answer', 'yes', '--json'], {
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
        const oldMd = join(runDir, 'wf_old.md');
        const oldState = join(runDir, 'wf_old.state.json');
        await writeFile(oldLog, 'old');
        await writeFile(freshLog, 'fresh');
        await writeFile(oldMd, 'old record');
        await writeFile(oldState, '{"status":"done"}');
        const oldMtime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
        await utimes(oldLog, oldMtime, oldMtime);
        await utimes(oldMd, oldMtime, oldMtime);
        await utimes(oldState, oldMtime, oldMtime);

        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean', '--logs'], { output, cwd, dbUrl: ':memory:' });

        expect(exitCode).toBe(0);
        // Only the log scope ran — no stale-run line at all.
        expect(output.messages.some((m) => m.includes('stale run'))).toBe(false);
        expect(output.messages.some((m) => m.includes('Reclaimed 1 retained run log(s) (>30d):'))).toBe(true);
        expect(await exists(oldLog)).toBe(false);
        expect(await exists(freshLog)).toBe(true);
        // 0925 AC3: the pair is out of cleanup scope until a retention policy exists.
        expect(await exists(oldMd)).toBe(true);
        expect(await exists(oldState)).toBe(true);
    });

    test('clean --logs --dry-run lists old logs without deleting', async () => {
        const cwd = await createTempProject();
        const runDir = join(cwd, '.spur', 'run');
        await mkdir(runDir, { recursive: true });
        const oldLog = join(runDir, 'wf_old.log');
        const oldMd = join(runDir, 'wf_old.md');
        const oldState = join(runDir, 'wf_old.state.json');
        await writeFile(oldLog, 'old');
        await writeFile(oldMd, 'old record');
        await writeFile(oldState, '{"status":"done"}');
        const oldMtime = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
        await utimes(oldLog, oldMtime, oldMtime);
        await utimes(oldMd, oldMtime, oldMtime);
        await utimes(oldState, oldMtime, oldMtime);

        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'clean', '--logs', '--dry-run'], {
            output,
            cwd,
            dbUrl: ':memory:',
        });

        expect(exitCode).toBe(0);
        expect(output.messages.some((m) => m.includes('Would reclaim 1 retained run log(s) (>30d):'))).toBe(true);
        expect(await exists(oldLog)).toBe(true); // dry-run unlinked nothing
        // 0925 AC3: only the eligible .log is reported — the pair stays out.
        expect(await exists(oldMd)).toBe(true);
        expect(await exists(oldState)).toBe(true);
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
        const { db, runSpy } = await spawnRegistersRun('async-seeded-1');
        try {
            const exitCode = await main(['workflow', 'run', '--async', '--run-id', 'async-seeded-1', workflowFile], {
                output,
                cwd: dir,
                db,
            });

            expect(exitCode).toBe(0);
            expect(output.messages[0] ?? '').toMatch(/^Started async run:/);
            expect(output.messages[0] ?? '').toMatch(/Monitor with: spur workflow trace/);
        } finally {
            runSpy.mockRestore();
        }
        await rm(dir, { recursive: true, force: true });
    });

    test('run --async --json returns structured result with runId', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();
        const { db, runSpy } = await spawnRegistersRun('async-seeded-2');
        try {
            const exitCode = await main(
                ['workflow', 'run', '--async', '--json', '--run-id', 'async-seeded-2', workflowFile],
                { output, cwd: dir, db },
            );

            expect(exitCode).toBe(0);
            const parsed = JSON.parse(output.messages[0] ?? '{}');
            expect(parsed).toMatchObject({ status: 'started', workflowName: workflowFile });
            expect(parsed).toHaveProperty('runId');
            expect(typeof parsed.runId).toBe('string');
        } finally {
            runSpy.mockRestore();
        }
        await rm(dir, { recursive: true, force: true });
    });

    test('run --async --vars forwards vars to the spawned command', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();
        const { db, runSpy } = await spawnRegistersRun('async-seeded-3');
        try {
            // --vars are forwarded to the spawned command argv; the mock registers
            // the run at spawn time so the parent's registration poll resolves.
            const exitCode = await main(
                ['workflow', 'run', '--async', '--vars', '{"wbs":"0116"}', '--run-id', 'async-seeded-3', workflowFile],
                { output, cwd: dir, db },
            );

            expect(exitCode).toBe(0);
            expect(output.messages[0] ?? '').toMatch(/^Started async run:/);
        } finally {
            runSpy.mockRestore();
        }
        await rm(dir, { recursive: true, force: true });
    });

    test('run --async --dry-run forwards dry-run to the spawned command', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();
        const { db, runSpy } = await spawnRegistersRun('async-seeded-4');
        try {
            const exitCode = await main(
                ['workflow', 'run', '--async', '--dry-run', '--run-id', 'async-seeded-4', workflowFile],
                { output, cwd: dir, db },
            );

            expect(exitCode).toBe(0);
            expect(output.messages[0] ?? '').toMatch(/^Started async run:/);
        } finally {
            runSpy.mockRestore();
        }
        await rm(dir, { recursive: true, force: true });
    });

    test('run --async --run-id uses the given run ID', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();
        const { db, runSpy } = await spawnRegistersRun('async-custom-id');
        try {
            const exitCode = await main(['workflow', 'run', '--async', '--run-id', 'async-custom-id', workflowFile], {
                output,
                cwd: dir,
                db,
            });

            expect(exitCode).toBe(0);
            expect(output.messages[0] ?? '').toContain('async-custom-id');
        } finally {
            runSpy.mockRestore();
        }
        await rm(dir, { recursive: true, force: true });
    });

    test('run --async propagates --no-log to the detached worker argv (0427 R3)', async () => {
        const dir = await createTempProject();
        const workflowFile = join(dir, 'workflow.yaml');
        await writeFile(workflowFile, MINIMAL_WORKFLOW_YAML);
        const output = createCapturedOutput();
        const { db, runSpy } = await spawnRegistersRun('async-seeded-6');
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

    test('0930 R1/AC1 — trace --follow --timeout stops at the deadline: checkpoint, exit 1, run untouched', async () => {
        const cwd = await createTempProject();
        const dbPath = join(cwd, '.spur', 'spur.db');
        await mkdir(join(cwd, '.spur'), { recursive: true });
        const db = await createMigratedDb({ url: dbPath });
        const now = Date.now();
        await db.run(
            'INSERT INTO runs (id, workflow_name, mode, status, started_at, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            ['timeout-run-1', 'test-flow', 'sync', 'running', now, '{}', now, now],
        );
        db.close();

        const output = createCapturedOutput();
        const exitCode = await main(
            ['workflow', 'trace', 'timeout-run-1', '--follow', '--poll', '50', '--timeout', '60'],
            {
                output,
                cwd,
                dbUrl: dbPath,
            },
        );

        expect(exitCode).toBe(1);
        const checkpoints = output.messages.filter((m) => m.startsWith('Follow timed out'));
        expect(checkpoints).toHaveLength(1);
        expect(checkpoints[0]).toContain('run timeout-run-1');
        expect(checkpoints[0]).toContain('status=running');
        expect(checkpoints[0]).toContain('resume with spur workflow trace timeout-run-1 --follow');

        // The timeout is the watcher's, never the run's: the run row stays `running`.
        const after = createCapturedOutput();
        await main(['workflow', 'trace', 'timeout-run-1', '--json'], { output: after, cwd, dbUrl: dbPath });
        const trace = JSON.parse(after.messages.at(-1) ?? '{}') as { run: { status: string } };
        expect(trace.run.status).toBe('running');
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

describe('formatTraceTimeline decision provenance (task 0911 R6)', () => {
    test('renders the persisted decision provenance on the action row', () => {
        const decision: TimelineActionDecision = {
            mode: 'evidence',
            outcome: 'deferred',
            reason: 'stale-evidence',
            provider: null,
            confidence: null,
            selectedProbability: null,
            evidenceActionIds: ['act-producer'],
            evidenceDigest: 'sha256:abc',
            artifactId: null,
            durationMs: 12,
        };
        const out = formatTraceTimeline({
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
            events: [
                {
                    ...(makeActionEvent() as Extract<TimelineEvent, { kind: 'action' }>),
                    actionKind: 'hitl.select',
                    decision,
                },
            ],
        });
        expect(out).toContain('decision=mode:evidence outcome:deferred reason:stale-evidence');
        expect(out).toContain('evidence:[act-producer]');
        expect(out).toContain('digest:sha256:abc');
    });

    test('omits the decision line for rows without provenance', () => {
        const out = formatTraceTimeline({
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
            events: [makeActionEvent()],
        });
        expect(out).not.toContain('decision=');
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

    test('bootstrap.options.asyncRegisterTimeoutMs overrides the default budget; junk throws', async () => {
        // The default is only reachable via the CLI branch, so assert the resolver
        // directly through the exported helper: a tiny override must return false fast
        // rather than waiting the built-in 5s, and a malformed value must fail loud.
        const trace = async () => {
            throw new Error('Run not found: r');
        };
        const started = Date.now();
        await expect(waitForRunRegistration({ trace } as never, 'r', 60, 20)).resolves.toBe(false);
        expect(Date.now() - started).toBeLessThan(2000);
        expect(asyncRegisterTimeoutMs(null)).toBe(5000);
        expect(asyncRegisterTimeoutMs({ bootstrap: { options: { asyncRegisterTimeoutMs: 60 } } })).toBe(60);
        expect(() => asyncRegisterTimeoutMs({ bootstrap: { options: { asyncRegisterTimeoutMs: 'junk' } } })).toThrow(
            /asyncRegisterTimeoutMs/,
        );
    });
});

describe('waitForResumeClaim (0901 R4)', () => {
    test('returns true when the resumed row leaves paused/interrupted (claim ack)', async () => {
        const trace = async () => ({ run: { status: 'running' } });
        await expect(waitForResumeClaim({ trace } as never, 'r', 1000, 50)).resolves.toBe(true);
    });

    test('returns false when the row never leaves paused/interrupted (worker never claimed)', async () => {
        const trace = async () => ({ run: { status: 'paused' } });
        const started = Date.now();
        await expect(waitForResumeClaim({ trace } as never, 'r', 100, 30)).resolves.toBe(false);
        expect(Date.now() - started).toBeLessThan(2000);
    });

    test('transient trace failures keep polling until the deadline', async () => {
        const trace = async () => {
            throw new Error('db locked');
        };
        await expect(waitForResumeClaim({ trace } as never, 'r', 90, 30)).resolves.toBe(false);
    });
});

describe('async launcher failure branch (0484 R2)', () => {
    // The helper is unit-tested above, but nothing covered what the COMMAND does when
    // registration fails — which is where the contract actually lives: exit non-zero,
    // name the sync fallback, and above all emit no run id. A phantom id in the JSON
    // payload would let a machine caller poll a run that never existed, which is the
    // whole failure R2 removes; it shipped unnoticed precisely because this gap existed.
    // 80ms register budget via the project config: no seeded run row → the detached
    // worker never registers → failure branch fires fast instead of at the 5s default.
    const withFastTimeout = async (dir: string) => {
        await Bun.write(join(dir, '.spur/config.yaml'), 'bootstrap:\n  options:\n    asyncRegisterTimeoutMs: 80\n');
    };

    test('an unregistered async run exits non-zero with a sync-fallback hint and no run id', async () => {
        const dir = await createTempProject();
        await withFastTimeout(dir);
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

    test('--json failure payload carries status + hint and omits the phantom run id', async () => {
        const dir = await createTempProject();
        await withFastTimeout(dir);
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

describe('continue headless guard (0901 R3)', () => {
    // Bun test stdout is never a TTY, so the headless branch fires deterministically.
    test('a headless continue without --answer is refused (exit 2) even with --yes', async () => {
        const dir = await createTempProject();
        const output = createCapturedOutput();
        const db = await createMigratedDb({ url: ':memory:' });

        const exitCode = await main(['workflow', 'continue', 'some-run', '--json', '--yes'], { output, cwd: dir, db });

        // --json without --json-envelope: writeJsonError routes through output.error.
        expect(exitCode).toBe(2);
        const errText = output.errors.join('\n');
        expect(errText).toContain('Refusing headless');
        expect(errText).toContain('--answer');
        expect(errText).toContain('--yes');
        await rm(dir, { recursive: true, force: true });
    });

    test('an explicit --answer passes the guard (proceeds past it to discovery)', async () => {
        const dir = await createTempProject();
        const output = createCapturedOutput();
        const db = await createMigratedDb({ url: ':memory:' });

        const exitCode = await main(['workflow', 'continue', 'no-such-run', '--json', '--answer', 'yes'], {
            output,
            cwd: dir,
            db,
        });

        // Past the guard (exit 2); fails later on discovery of the unknown run.
        expect(exitCode).not.toBe(2);
        expect(output.messages.join('\n')).not.toContain('Refusing headless');
        await rm(dir, { recursive: true, force: true });
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

    /** Minimal non-terminal timeline fixture for the 0930 deadline tests. */
    function runningTimeline(runId: string): WorkflowTraceTimeline {
        return {
            run: {
                runId,
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
        };
    }

    test('0930 R1 — deadline hit on a non-terminal run writes one checkpoint, never cancels, and reports timeout', async () => {
        let traceCalls = 0;
        let clock = 1000;
        const writes: string[] = [];
        const timedOut = await followTrace(
            {
                trace: async () => {
                    traceCalls++;
                    return runningTimeline('r1');
                },
            } as never,
            'r1',
            2000,
            (line) => writes.push(line),
            async () => {
                clock += 2000;
            },
            () => clock,
            5000,
        );

        expect(timedOut).toBe(true);
        expect(writes.filter((line) => line.startsWith('Follow timed out'))).toEqual([
            'Follow timed out after 6000ms: run r1 status=running — run continues; resume with spur workflow trace r1 --follow',
        ]);
        // Deadline checks ride the poll cycle: observe → wait → observe → wait → observe → stop.
        expect(traceCalls).toBe(4);
    });

    test('0930 R2 — without a deadline the follow stays unbounded until terminal', async () => {
        let polls = 0;
        let clock = 0;
        const writes: string[] = [];
        const timedOut = await followTrace(
            {
                trace: async () => {
                    polls++;
                    if (polls <= 8) return runningTimeline('r2');
                    const done = runningTimeline('r2');
                    return { ...done, run: { ...done.run, status: 'done', outcome: 'success', durationMs: 1 } };
                },
            } as never,
            'r2',
            1,
            (line) => writes.push(line),
            async () => {
                clock += 1_000_000;
            },
            () => clock,
        );

        expect(timedOut).toBe(false);
        expect(writes.some((line) => line.startsWith('Follow timed out'))).toBe(false);
        expect(writes.at(-1)).toBe('Run finalized: done — outcome=success duration=1ms');
    });

    test('0930 R1 — the Run-not-found retry window counts against the deadline', async () => {
        let attempts = 0;
        let clock = 0;
        const writes: string[] = [];
        const timedOut = await followTrace(
            {
                trace: async () => {
                    attempts++;
                    throw new Error(`Run not found: ghost-run (attempt ${attempts})`);
                },
            } as never,
            'ghost-run',
            500,
            (line) => writes.push(line),
            async () => {
                clock += 500;
            },
            () => clock,
            1200,
        );

        expect(timedOut).toBe(true);
        expect(writes).toEqual([
            'Follow timed out after 1500ms: run ghost-run status=pending — run continues; resume with spur workflow trace ghost-run --follow',
        ]);
        expect(attempts).toBeLessThan(20);
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
        expect(writes[0]).toContain('.spur/run/r11.md');
        expect(writes[0]).toContain('--no-log');
        await rm(dir, { recursive: true, force: true });
    });

    test('0926 AC2 — switches from a legacy .log to the resumed run .md when it appears mid-follow', async () => {
        const dir = await createTempProject();
        await mkdir(join(dir, '.spur', 'run'), { recursive: true });
        await writeFile(join(dir, '.spur', 'run', 'r12.log'), 'legacy\n');

        const writes: string[] = [];
        let stepped = false;
        const wait = async () => {
            if (!stepped) {
                stepped = true;
                // The continue of the legacy run creates the pair under the same id.
                await writeFile(join(dir, '.spur', 'run', 'r12.md'), 'resumed section\n');
                await writeFile(join(dir, '.spur', 'run', 'r12.state.json'), '{"runId":"r12"}');
            }
        };
        let traceCalls = 0;
        const trace = async () => {
            traceCalls++;
            return { run: { status: traceCalls >= 4 ? 'done' : 'running' } } as never;
        };

        await followRunLog({ trace }, 'r12', dir, 5, (line) => writes.push(line), wait);

        // The tail moved to the new record instead of tracking the stale legacy file.
        expect(writes).toEqual(['legacy', 'resumed section']);
        await rm(dir, { recursive: true, force: true });
    });

    test('0948 R6 — a legacy→md switch does not reprint a shared prefix', async () => {
        const dir = await createTempProject();
        await mkdir(join(dir, '.spur', 'run'), { recursive: true });
        await writeFile(join(dir, '.spur', 'run', 'r15.log'), 'legacy\n');

        const writes: string[] = [];
        let stepped = false;
        const wait = async () => {
            if (!stepped) {
                stepped = true;
                await writeFile(join(dir, '.spur', 'run', 'r15.md'), 'legacy\nresumed section\n');
                await writeFile(join(dir, '.spur', 'run', 'r15.state.json'), '{"runId":"r15"}');
            }
        };
        let traceCalls = 0;
        const trace = async () => {
            traceCalls++;
            return { run: { status: traceCalls >= 4 ? 'done' : 'running' } } as never;
        };

        await followRunLog({ trace }, 'r15', dir, 5, (line) => writes.push(line), wait);

        expect(writes).toEqual(['legacy', 'resumed section']);
        await rm(dir, { recursive: true, force: true });
    });

    test('0948 R6 — an empty legacy log is not described as --no-log', async () => {
        const dir = await createTempProject();
        await mkdir(join(dir, '.spur', 'run'), { recursive: true });
        await writeFile(join(dir, '.spur', 'run', 'r16.log'), '');

        const writes: string[] = [];
        await followRunLog({ trace: serviceTrace(() => true) }, 'r16', dir, 5, (line) => writes.push(line));

        expect(writes).toHaveLength(1);
        expect(writes[0]).toContain('is empty');
        expect(writes[0]).not.toContain('--no-log');
        await rm(dir, { recursive: true, force: true });
    });

    test('0926 AC2 — reports a missing pair state as an incomplete record, never as success', async () => {
        const dir = await createTempProject();
        await mkdir(join(dir, '.spur', 'run'), { recursive: true });
        await writeFile(join(dir, '.spur', 'run', 'r13.md'), 'record body\n');
        // No state file: the pair is incomplete by definition.

        const writes: string[] = [];
        await followRunLog({ trace: serviceTrace(() => true) }, 'r13', dir, 5, (line) => writes.push(line));

        expect(writes).toEqual([
            'record body',
            `Run record incomplete (state-missing) at ${join(dir, '.spur', 'run', 'r13.state.json')} — the workflow DB trace remains the completion authority.`,
        ]);
        await rm(dir, { recursive: true, force: true });
    });

    test('0930 R1 — deadline hit on a non-terminal run writes one checkpoint and reports timeout', async () => {
        const dir = await createTempProject();
        await mkdir(join(dir, '.spur', 'run'), { recursive: true });
        await writeFile(join(dir, '.spur', 'run', 'r14.md'), 'section one\n');

        const writes: string[] = [];
        let clock = 0;
        const timedOut = await followRunLog(
            { trace: async () => ({ run: { status: 'running' } }) as never },
            'r14',
            dir,
            1,
            (line) => writes.push(line),
            async () => {
                clock += 2000;
            },
            () => clock,
            5000,
        );

        expect(timedOut).toBe(true);
        expect(writes).toEqual([
            'section one',
            'Follow timed out after 6000ms: run r14 status=running — run continues; resume with spur workflow trace r14 --follow',
        ]);
        await rm(dir, { recursive: true, force: true });
    });
});

describe('spur workflow progress (D62 / 0867)', () => {
    const PROGRESS_WORKFLOW_YAML = `name: progress-flow
kind: state-machine
initialState: start
states:
  - id: start
    onEnter:
      - kind: note
        options:
          message: start
  - id: mid
    onEnter:
      - kind: note
        options:
          message: mid
  - id: done
transitions:
  - from: start
    to: mid
    description: start passed
  - from: mid
    to: done
    description: mid passed
terminalStates:
  - done
`;

    /** Temp project holding the `progress-flow` definition and its own migrated DB. */
    async function progressFixture(): Promise<{ dir: string; dbUrl: string }> {
        const dir = await createTempProject();
        const wfDir = join(dir, '.spur', 'workflows');
        await mkdir(wfDir, { recursive: true });
        await writeFile(join(wfDir, 'progress-flow.yaml'), PROGRESS_WORKFLOW_YAML);
        return { dir, dbUrl: join(dir, '.spur', 'spur.db') };
    }

    test('R1/R3: --json is the projectWorkflowProgress projection, unmodified', async () => {
        const { dir, dbUrl } = await progressFixture();
        const output = createCapturedOutput();
        await main(
            ['workflow', 'run', '--run-id', 'progress-complete', join(dir, '.spur', 'workflows', 'progress-flow.yaml')],
            { output, cwd: dir, dbUrl },
        );
        output.messages.length = 0;

        const exitCode = await main(['workflow', 'progress', 'progress-complete', '--json'], {
            output,
            cwd: dir,
            dbUrl,
        });
        expect(exitCode).toBe(0);
        const projection = JSON.parse(output.messages.join('')) as WorkflowProgressProjection;
        expect(projection.schemaVersion).toBe(1);
        expect(projection.runId).toBe('progress-complete');
        expect(projection.workflow).toBe('progress-flow');
        expect(projection.status).toBe('completed');
        expect(projection.currentState).toBe('done');
        expect(projection.transitions.map((t) => `${t.from}->${t.to}`)).toEqual(['start->mid', 'mid->done']);

        // R2: each declared action carries its recorded attempts.
        const start = projection.states.find((s) => s.state === 'start');
        expect(start?.actions[0]?.actionKey).toBe('start:onEnter:0');
        expect(start?.actions[0]?.status).toBe('passed');
        expect(start?.actions[0]?.attempts[0]).toMatchObject({
            actionRunId: expect.any(String),
            ok: true,
        });

        // R3: rendering only — the CLI payload IS the projection, byte-for-byte apart
        // from the projection timestamp each call stamps.
        const db = await createMigratedDb({ url: dbUrl });
        const direct = await projectWorkflowProgress('progress-complete', { db, projectRoot: dir });
        db.close();
        const withoutTimestamp = (p: WorkflowProgressProjection) => ({ ...p, projectedAt: '<ignored>' });
        expect(withoutTimestamp(projection)).toEqual(withoutTimestamp(direct));
        await rm(dir, { recursive: true, force: true });
    });

    test('R2/R4: a running run exits 0, names state + attempts + next transitions, marks gaps unknown', async () => {
        const { dir, dbUrl } = await progressFixture();
        const db = await createMigratedDb({ url: dbUrl });
        const now = Date.now();
        await db.run(
            "INSERT INTO runs (id, workflow_name, mode, status, started_at, metadata_json, created_at, updated_at) VALUES ('progress-running', 'progress-flow', 'sync', 'running', ?, '{}', ?, ?)",
            [now, now, now],
        );
        await db.run(
            "INSERT INTO transition_runs (id, run_id, from_state, to_state, trigger, status, created_at, updated_at) VALUES ('tr-1', 'progress-running', 'start', 'mid', 'start passed', 'completed', ?, ?)",
            [now, now],
        );
        await db.run(
            "INSERT INTO action_runs (id, run_id, node, kind, status, ok, duration_ms, started_at, completed_at, created_at) VALUES ('ar-1', 'progress-running', 'mid', 'note', 'running', NULL, NULL, NULL, NULL, ?)",
            [now + 1],
        );
        db.close();

        const output = createCapturedOutput();
        const exitCode = await main(['workflow', 'progress', 'progress-running', '--json'], {
            output,
            cwd: dir,
            dbUrl,
        });
        expect(exitCode).toBe(0);
        const projection = JSON.parse(output.messages.join('')) as WorkflowProgressProjection;
        expect(projection.status).toBe('running');
        expect(projection.currentState).toBe('mid');
        // Unanswered data stays null/unknown rather than being invented.
        expect(projection.definitionDigest).toBeNull();
        expect(projection.diagnostics.some((d) => d.code === 'definition-digest-missing')).toBe(true);
        const mid = projection.states.find((s) => s.state === 'mid');
        expect(mid?.actions[0]?.status).toBe('running');
        expect(mid?.actions[0]?.attempts[0]).toMatchObject({
            actionRunId: 'ar-1',
            status: 'running',
            durationMs: null,
            completedAt: null,
        });

        output.messages.length = 0;
        const humanExit = await main(['workflow', 'progress', 'progress-running'], { output, cwd: dir, dbUrl });
        expect(humanExit).toBe(0);
        const human = output.messages.join('\n');
        expect(human).toContain('Current state: mid');
        expect(human).toContain('Definition: version unknown · digest unknown');
        expect(human).toContain('attempt ar-1: running ok=unknown unknown');
        expect(human).toContain('mid → done [blocked] — mid passed');
        await rm(dir, { recursive: true, force: true });
    });

    test('R4: an incomplete run whose definition is unresolvable still exits 0 and names the gap', async () => {
        const { dir, dbUrl } = await progressFixture();
        const db = await createMigratedDb({ url: dbUrl });
        const now = Date.now();
        await db.run(
            "INSERT INTO runs (id, workflow_name, mode, status, started_at, metadata_json, created_at, updated_at) VALUES ('progress-ghost', 'ghost-flow', 'sync', 'running', ?, '{}', ?, ?)",
            [now, now, now],
        );
        db.close();

        const output = createCapturedOutput();
        expect(await main(['workflow', 'progress', 'progress-ghost'], { output, cwd: dir, dbUrl })).toBe(0);
        const human = output.messages.join('\n');
        expect(human).toContain('Current state: unknown');
        expect(human).toContain('States: none recorded');
        expect(human).toContain('Next transitions: none');
        expect(human).toContain('definition-unavailable');
        await rm(dir, { recursive: true, force: true });
    });

    test('R5: an unknown run id is a named NOT_FOUND error, never an empty success', async () => {
        const { dir, dbUrl } = await progressFixture();

        const plain = createCapturedOutput();
        expect(await main(['workflow', 'progress', 'no-such-run'], { output: plain, cwd: dir, dbUrl })).toBe(1);
        expect(plain.errors.join('\n')).toContain('Run no-such-run not found.');
        expect(plain.messages).toEqual([]);

        const json = createCapturedOutput();
        expect(await main(['workflow', 'progress', 'no-such-run', '--json'], { output: json, cwd: dir, dbUrl })).toBe(
            1,
        );
        expect(json.errors.join('\n')).toContain('Run no-such-run not found.');
        expect(json.messages).toEqual([]);

        // ADR-091: the enveloped machine consumer gets a structured NOT_FOUND, still no success.
        const enveloped = createCapturedOutput();
        expect(
            await main(['workflow', 'progress', 'no-such-run', '--json', '--json-envelope'], {
                output: enveloped,
                cwd: dir,
                dbUrl,
            }),
        ).toBe(1);
        const doc = JSON.parse(enveloped.messages.join('')) as { ok: boolean; error: { code: string } };
        expect(doc.ok).toBe(false);
        expect(doc.error.code).toBe('NOT_FOUND');
        await rm(dir, { recursive: true, force: true });
    });
});

describe('spur workflow show', () => {
    test('R4: show resolves registered-only names in both formats', async () => {
        const dir = await createTempProject();
        await mkdir(join(dir, '.spur'), { recursive: true });
        await mkdir(join(dir, 'ops'), { recursive: true });
        await writeFile(join(dir, '.spur', 'config.yaml'), 'workflows:\n  paths:\n    - ops\n');
        const wf = join(dir, 'ops', 'custom.yaml');
        await writeFile(wf, MINIMAL_WORKFLOW_YAML);
        try {
            for (const format of ['mermaid', 'todo']) {
                const result = await runCli(['workflow', 'show', 'cli-test-flow', '--format', format, '--json'], dir);
                expect(result.code).toBe(0);
                expect(result.json).toMatchObject({ source: { layer: 'registered', path: await realpath(wf) } });
            }
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

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
                '- [ ] A. start — initial',
                '- [ ] B. work — pause · loop-back',
                '- [ ] C. done — terminal · conditional',
                '- [ ] D. failed — terminal · failure · conditional',
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
            // 0819 R4: explicit paths always resolve from the project layer.
            source: { layer: 'project', path: wf },
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
            // 0819 R4: explicit paths always resolve from the project layer.
            source: { layer: 'project', path: wf },
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

describe('formatTraceTimeline executor/session columns (task 0895 R2)', () => {
    function timeline(events: TimelineEvent[]): WorkflowTraceTimeline {
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

    test('renders the executor, session id, session mode, and pin re-resolution on the action row', () => {
        const event = makeActionEvent() as Extract<TimelineEvent, { kind: 'action' }>;
        event.result = {
            agent: 'claude',
            exitCode: 0,
            executor: 'claude-b',
            sessionId: 'sess-1',
            session: 'fresh',
            pinReresolved: true,
            pinReresolvedFrom: 'claude-a',
            pinReresolvedOwner: 'drain',
            pinReresolvedReason: 'quota exhausted',
        };
        const out = formatTraceTimeline(timeline([event]));
        expect(out).toContain('executor=claude-b');
        expect(out).toContain('sessionId=sess-1');
        expect(out).toContain('session=fresh');
        expect(out).toContain('pinReresolved=true');
        expect(out).toContain('pinReresolvedFrom=claude-a');
        expect(out).toContain('pinReresolvedOwner=drain');
        expect(out).toContain('pinReresolvedReason=quota exhausted');
    });
});
