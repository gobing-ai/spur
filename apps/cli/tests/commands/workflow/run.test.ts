/**
 * Thin-wrapper integration tests for `spur workflow run` (apps/cli/src/commands/workflow/run.ts).
 * Behavioral tests for WorkflowAppService live in packages/app/tests/services/workflow-service.test.ts.
 */
import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { access, chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
    _resetAgentServiceShimsForTest,
    resolveWorkflowDefinition,
    WorkflowSteeringController,
} from '@gobing-ai/spur-app';
import { getEnvVar, getEnvVars, removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import {
    asyncRegisterTimeoutMs,
    InvalidRunIdError,
    submitSteeringLine,
    validateRunId,
    waitForRunRegistration,
} from '../../../src/commands/workflow';
import { EMBEDDED_SPUR_SCHEMAS } from '../../../src/config/embedded-schemas';
import { main } from '../../../src/index';
import type { CommandOutput } from '../../../src/output';
import { createCapturedOutput, createTempProject } from '../../helpers';

/** `fs/promises.exists` is Bun-only and absent from the @types/node shipped with @types/bun 1.4.x. */
const exists = (path: string): Promise<boolean> =>
    access(path).then(
        () => true,
        () => false,
    );

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
    test('a step under the async-worker env sees neither the expected digest nor the worker flag (1117 AC1)', async () => {
        const dir = await createTempProject();
        const envProbe = join(dir, 'env-probe.txt');
        const workflowFile = join(dir, 'async-env.yaml');
        await writeFile(
            workflowFile,
            `name: cli-async-env-flow
kind: state-machine
initialState: start
states:
  - id: start
    onEnter:
      - kind: shell
        options:
          command: |
            if [ -n "$SPUR_EXPECTED_DEFINITION_DIGEST" ]; then d=set; else d=unset; fi
            if [ -n "$SPUR_ASYNC_WORKER" ]; then w=set; else w=unset; fi
            printf '%s %s\\n' "$d" "$w" > '${envProbe}'
  - id: done
transitions:
  - from: start
    to: done
terminalStates:
  - done
`,
        );
        // The real digest so the worker's own startup check passes and the step runs.
        const { digest } = await resolveWorkflowDefinition(dir, workflowFile, {
            embeddedSchemas: EMBEDDED_SPUR_SCHEMAS,
        });
        const priorDigest = getEnvVar('SPUR_EXPECTED_DEFINITION_DIGEST');
        const priorWorker = getEnvVar('SPUR_ASYNC_WORKER');
        setEnvVar('SPUR_EXPECTED_DEFINITION_DIGEST', digest);
        setEnvVar('SPUR_ASYNC_WORKER', '1');
        const output = createCapturedOutput();
        try {
            const exitCode = await main(['workflow', 'run', '--run-id', 'async-env-1', workflowFile], {
                output,
                cwd: dir,
                dbUrl: ':memory:',
            });

            expect(exitCode).toBe(0);
            expect((await readFile(envProbe, 'utf8')).trim()).toBe('unset unset');
        } finally {
            if (priorDigest === undefined) removeEnvVar('SPUR_EXPECTED_DEFINITION_DIGEST');
            else setEnvVar('SPUR_EXPECTED_DEFINITION_DIGEST', priorDigest);
            if (priorWorker === undefined) removeEnvVar('SPUR_ASYNC_WORKER');
            else setEnvVar('SPUR_ASYNC_WORKER', priorWorker);
            await rm(dir, { recursive: true, force: true });
        }
    });
    test('a nested workflow run on a different definition completes under the async worker (1117 AC2)', async () => {
        const dir = await createTempProject();
        const outerFile = join(dir, 'outer.yaml');
        const nestedFile = join(dir, 'nested.yaml');
        await writeFile(nestedFile, MINIMAL_WORKFLOW_YAML);
        const nestedOut = join(dir, 'nested-out.json');
        const nestedErr = join(dir, 'nested-err.txt');
        const nestedExit = join(dir, 'nested-exit.txt');
        const cliEntry = join(join(import.meta.dir, '..'), '..', '..', 'src', 'index.ts');
        await writeFile(
            outerFile,
            `name: cli-nested-outer-flow
kind: state-machine
initialState: start
states:
  - id: start
    onEnter:
      - kind: shell
        options:
          command: |
            unset SPUR_WORKFLOW_RUN_ACTIVE
            bun run '${cliEntry}' workflow run '${nestedFile}' --run-id nested-1117 --json > '${nestedOut}' 2> '${nestedErr}'
            echo $? > '${nestedExit}'
  - id: done
transitions:
  - from: start
    to: done
terminalStates:
  - done
`,
        );
        const { digest } = await resolveWorkflowDefinition(dir, outerFile, {
            embeddedSchemas: EMBEDDED_SPUR_SCHEMAS,
        });
        const priorDigest = getEnvVar('SPUR_EXPECTED_DEFINITION_DIGEST');
        const priorWorker = getEnvVar('SPUR_ASYNC_WORKER');
        setEnvVar('SPUR_EXPECTED_DEFINITION_DIGEST', digest);
        setEnvVar('SPUR_ASYNC_WORKER', '1');
        const output = createCapturedOutput();
        try {
            const exitCode = await main(['workflow', 'run', '--run-id', 'nested-outer-1', outerFile], {
                output,
                cwd: dir,
                dbUrl: ':memory:',
            });

            expect(exitCode).toBe(0);
            // The nested run on the different definition completed instead of refusing.
            expect((await readFile(nestedExit, 'utf8')).trim()).toBe('0');
            const nestedOutput = `${await readFile(nestedOut, 'utf8')}\n${await readFile(nestedErr, 'utf8')}`;
            expect(nestedOutput).not.toContain('refusing to start');
            expect(nestedOutput).not.toContain('differs from the expected digest');
            expect(JSON.parse(await readFile(nestedOut, 'utf8'))).toMatchObject({ status: 'done' });
        } finally {
            if (priorDigest === undefined) removeEnvVar('SPUR_EXPECTED_DEFINITION_DIGEST');
            else setEnvVar('SPUR_EXPECTED_DEFINITION_DIGEST', priorDigest);
            if (priorWorker === undefined) removeEnvVar('SPUR_ASYNC_WORKER');
            else setEnvVar('SPUR_ASYNC_WORKER', priorWorker);
            await rm(dir, { recursive: true, force: true });
        }
    });
    test('a genuine expected-digest mismatch still refuses before any state runs (1117 AC3)', async () => {
        const dir = await createTempProject();
        const marker = join(dir, 'marker.txt');
        const workflowFile = join(dir, 'mismatch.yaml');
        await writeFile(
            workflowFile,
            `name: cli-digest-mismatch-flow
kind: state-machine
initialState: start
states:
  - id: start
    onEnter:
      - kind: shell
        options:
          command: |
            printf 'ran' > '${marker}'
  - id: done
transitions:
  - from: start
    to: done
terminalStates:
  - done
`,
        );
        const priorDigest = getEnvVar('SPUR_EXPECTED_DEFINITION_DIGEST');
        const priorWorker = getEnvVar('SPUR_ASYNC_WORKER');
        setEnvVar(
            'SPUR_EXPECTED_DEFINITION_DIGEST',
            'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        );
        setEnvVar('SPUR_ASYNC_WORKER', '1');
        const output = createCapturedOutput();
        try {
            const exitCode = await main(['workflow', 'run', '--run-id', 'digest-mismatch-1', workflowFile], {
                output,
                cwd: dir,
                dbUrl: ':memory:',
            });

            expect(exitCode).toBe(1);
            expect(output.errors.join('\n')).toContain('differs from the expected digest');
            expect(await exists(marker)).toBe(false);
        } finally {
            if (priorDigest === undefined) removeEnvVar('SPUR_EXPECTED_DEFINITION_DIGEST');
            else setEnvVar('SPUR_EXPECTED_DEFINITION_DIGEST', priorDigest);
            if (priorWorker === undefined) removeEnvVar('SPUR_ASYNC_WORKER');
            else setEnvVar('SPUR_ASYNC_WORKER', priorWorker);
            await rm(dir, { recursive: true, force: true });
        }
    });
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
    test('run throws when workflow file argument is missing', async () => {
        const exitCode = await main(['workflow', 'run'], { output: nullOutput(), dbUrl: ':memory:' });
        expect(exitCode).toBe(1);
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
        const mdPath = join(dir, '.spur', 'memory', 'runs', 'retain-log-run.md');
        expect((await readFile(mdPath, 'utf8')).length).toBeGreaterThan(0);
        expect(await exists(join(dir, '.spur', 'run', 'retain-log-run.log'))).toBe(false);
        const state = JSON.parse(
            await readFile(join(dir, '.spur', 'memory', 'runs', 'retain-log-run.state.json'), 'utf8'),
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
        await expect(readFile(join(dir, '.spur', 'memory', 'runs', 'no-log-run.md'), 'utf8')).rejects.toThrow();
        await expect(readFile(join(dir, '.spur', 'memory', 'runs', 'no-log-run.state.json'), 'utf8')).rejects.toThrow();
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
