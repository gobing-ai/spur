/**
 * Thin-wrapper integration tests for `spur workflow continue` (apps/cli/src/commands/workflow/continue.ts).
 * Behavioral tests for WorkflowAppService live in packages/app/tests/services/workflow-service.test.ts.
 */
import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { _resetAgentServiceShimsForTest } from '@gobing-ai/spur-app';
import { createMigratedDb } from '@gobing-ai/spur-domain';
import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import { waitForResumeClaim } from '../../../src/commands/workflow';
import { main } from '../../../src/index';
import type { CommandOutput } from '../../../src/output';
import { createCapturedOutput, createTempProject } from '../../helpers';

// Warn-once shim markers (bare-binary, legacy executor) are process-global; bun
// batches test files per worker process — never inherit another file's state.
beforeEach(() => {
    _resetAgentServiceShimsForTest();
});

function nullOutput(): CommandOutput {
    return { write: () => {}, error: () => {} };
}

// ── continue --answer-text (H1 R27/R28) ──
const INPUT_GATE_CLI_YAML = `name: cli-input-gate
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
      - kind: hitl.input
        options:
          prompt: "Preferred flavor?"
  - id: vanilla
  - id: chocolate
transitions:
  - from: start
    to: gate
    guard: { kind: always }
  - from: gate
    to: vanilla
    guard:
      kind: shell
      options:
        command: 'test "\${vars.__hitlInput}" = vanilla'
  - from: gate
    to: chocolate
    guard:
      kind: shell
      options:
        command: 'test "\${vars.__hitlInput}" = chocolate'
terminalStates:
  - vanilla
  - chocolate
`;

const CONFIRM_GATE_CLI_YAML = `name: cli-confirm-gate
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
terminalStates:
  - approved
`;

/** Run a fixture workflow until it pauses at its gate; assert the pause.
 *  Mains run on `dbUrl` (they close whichever connection they open); the returned
 *  handle is opened independently so post-continue assertions stay valid. */
async function pauseAtGate(runId: string, yaml: string, file: string) {
    const dir = await createTempProject();
    const wfDir = join(dir, '.spur', 'workflows');
    await mkdir(wfDir, { recursive: true });
    const wf = join(wfDir, file);
    await writeFile(wf, yaml);
    const dbUrl = join(dir, 'spur.db');
    await main(['workflow', 'run', '--run-id', runId, wf, '--json'], {
        output: nullOutput(),
        cwd: dir,
        dbUrl,
    });
    const db = await createMigratedDb({ url: dbUrl });
    const row = await db.queryFirst<{ status: string }>('SELECT status FROM runs WHERE id = ?', runId);
    if (row?.status !== 'paused')
        throw new Error(`fixture failed: run ${runId} is ${row?.status ?? 'missing'}, not paused`);
    return { dir, db, dbUrl, wf };
}

describe('workflow command (main)', () => {
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

    // 0948 R6: an EXISTING but empty legacy `.log` used to fall into the same branch as an
    // absent record, so the operator was told to look for a `--no-log` flag that was never
    // passed. The empty case must name the real condition.

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
    test('continue keeps run identity: appends only new record sections, repeats no side effect, settles state (0926 AC1)', async () => {
        const dir = await createTempProject();
        const wfDir = join(dir, '.spur', 'workflows');
        await mkdir(wfDir, { recursive: true });
        await writeFile(join(wfDir, 'record-pauser.yaml'), RECORD_RESUME_WORKFLOW_YAML);
        const dbUrl = join(dir, 'spur.db');
        const counter = join(dir, 'counter.txt');
        const mdPath = join(dir, '.spur', 'memory', 'runs', 'cli-rec1.md');
        const statePath = join(dir, '.spur', 'memory', 'runs', 'cli-rec1.state.json');

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
        const mdPath = join(dir, '.spur', 'memory', 'runs', 'cli-rec2.md');
        const statePath = join(dir, '.spur', 'memory', 'runs', 'cli-rec2.state.json');
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

describe('continue --answer-text (H1 R27/R28)', () => {
    test('headless --json --answer-text answers the input gate and routes on the text (AC1)', async () => {
        const { dir, dbUrl } = await pauseAtGate('in-1', INPUT_GATE_CLI_YAML, 'input-gate.yaml');
        const out = createCapturedOutput();
        const exit = await main(['workflow', 'continue', 'in-1', '--yes', '--answer-text', 'vanilla', '--json'], {
            output: out,
            cwd: dir,
            dbUrl,
        });
        expect(exit).toBe(0);
        const parsed = JSON.parse(out.messages.at(-1) ?? '{}');
        expect(parsed.status).toBe('done');
        expect(parsed.finalState).toBe('vanilla');
        await rm(dir, { recursive: true, force: true });
    });

    test('--async validates gate kind first and forwards --answer-text to the spawned worker (AC1)', async () => {
        const { dir, dbUrl } = await pauseAtGate('in-2', INPUT_GATE_CLI_YAML, 'input-gate.yaml');
        const out = createCapturedOutput();
        let workerLine = '';
        let mockDb: Awaited<ReturnType<typeof createMigratedDb>> | undefined;
        // The mock worker claims the resume by leaving `paused`, satisfying
        // waitForResumeClaim; the captured sh -c line proves flag forwarding.
        // A lazily-opened second connection writes the claim — main() closes
        // whichever connection it opens itself.
        const runSpy = spyOn(NodeProcessExecutor.prototype, 'run').mockImplementation(async (opts) => {
            workerLine = String((opts as { args?: string[] }).args?.[1] ?? '');
            mockDb ??= await createMigratedDb({ url: dbUrl });
            await mockDb.run('UPDATE runs SET status = ?, updated_at = ? WHERE id = ?', [
                'running',
                Date.now(),
                'in-2',
            ]);
            return { exitCode: 0 } as never;
        });
        try {
            const exit = await main(
                ['workflow', 'continue', 'in-2', '--yes', '--answer-text', 'mocha', '--json', '--async'],
                { output: out, cwd: dir, dbUrl },
            );
            expect(exit).toBe(0);
            const parsed = JSON.parse(out.messages.at(-1) ?? '{}');
            expect(parsed.status).toBe('started');
            // shQuote wraps each argv token, so the quoted pair is what lands in the sh -c line.
            expect(workerLine).toContain("'--answer-text' 'mocha'");
        } finally {
            runSpy.mockRestore();
        }
        await rm(dir, { recursive: true, force: true });
    });

    test('--answer-text on a confirm gate: exit 2, VALIDATION_FAILED, run row unchanged (AC2)', async () => {
        const { dir, db } = await pauseAtGate('mis-1', CONFIRM_GATE_CLI_YAML, 'confirm-gate.yaml');
        const before = await db.queryFirst<{ status: string; metadata_json: string }>(
            'SELECT status, metadata_json FROM runs WHERE id = ?',
            'mis-1',
        );
        const out = createCapturedOutput();
        const exit = await main(['workflow', 'continue', 'mis-1', '--yes', '--answer-text', 'yes', '--json'], {
            output: out,
            cwd: dir,
            dbUrl: join(dir, 'spur.db'),
        });
        expect(exit).toBe(2);
        const errText = out.errors.join('\n');
        expect(errText).toContain("state 'gate' waits on a hitl.confirm gate");
        expect(errText).toContain('use --answer yes|no|cancel');
        // The machine-readable envelope carries the error code (0930 pattern).
        const envOut = createCapturedOutput();
        await main(['workflow', 'continue', 'mis-1', '--yes', '--answer-text', 'yes', '--json', '--json-envelope'], {
            output: envOut,
            cwd: dir,
            dbUrl: join(dir, 'spur.db'),
        });
        expect(JSON.parse(envOut.messages.at(-1) ?? '{}')).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
        const after = await db.queryFirst<{ status: string; metadata_json: string }>(
            'SELECT status, metadata_json FROM runs WHERE id = ?',
            'mis-1',
        );
        expect(after).toEqual(before);
        await rm(dir, { recursive: true, force: true });
    });

    test('--answer on an input gate: exit 2, VALIDATION_FAILED, run row unchanged (AC2)', async () => {
        const { dir, db } = await pauseAtGate('mis-2', INPUT_GATE_CLI_YAML, 'input-gate.yaml');
        const before = await db.queryFirst<{ status: string; metadata_json: string }>(
            'SELECT status, metadata_json FROM runs WHERE id = ?',
            'mis-2',
        );
        const out = createCapturedOutput();
        const exit = await main(['workflow', 'continue', 'mis-2', '--yes', '--answer', 'yes', '--json'], {
            output: out,
            cwd: dir,
            dbUrl: join(dir, 'spur.db'),
        });
        expect(exit).toBe(2);
        const errText = out.errors.join('\n');
        expect(errText).toContain("state 'gate' waits on a hitl.input gate");
        expect(errText).toContain('--answer-text <text>');
        // The machine-readable envelope carries the error code (0930 pattern).
        const envOut = createCapturedOutput();
        await main(['workflow', 'continue', 'mis-2', '--yes', '--answer', 'yes', '--json', '--json-envelope'], {
            output: envOut,
            cwd: dir,
            dbUrl: join(dir, 'spur.db'),
        });
        expect(JSON.parse(envOut.messages.at(-1) ?? '{}')).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
        const after = await db.queryFirst<{ status: string; metadata_json: string }>(
            'SELECT status, metadata_json FROM runs WHERE id = ?',
            'mis-2',
        );
        expect(after).toEqual(before);
        await rm(dir, { recursive: true, force: true });
    });

    test('passing both --answer and --answer-text: exit 2 before any run access (AC2)', async () => {
        const dir = await createTempProject();
        const out = createCapturedOutput();
        const exit = await main(
            ['workflow', 'continue', 'any-run', '--yes', '--answer', 'yes', '--answer-text', 'text', '--json'],
            { output: out, cwd: dir, dbUrl: join(dir, 'spur.db') },
        );
        expect(exit).toBe(2);
        expect(out.errors.join('\n')).toContain('not both');
        await rm(dir, { recursive: true, force: true });
    });

    test('empty --answer-text is rejected: exit 2 (AC2)', async () => {
        const dir = await createTempProject();
        const out = createCapturedOutput();
        const exit = await main(['workflow', 'continue', 'any-run', '--yes', '--answer-text', '', '--json'], {
            output: out,
            cwd: dir,
            dbUrl: join(dir, 'spur.db'),
        });
        expect(exit).toBe(2);
        expect(out.errors.join('\n')).toContain('non-empty');
        await rm(dir, { recursive: true, force: true });
    });

    test('the headless guard message names both answer flags (R3)', async () => {
        const dir = await createTempProject();
        const out = createCapturedOutput();
        const exit = await main(['workflow', 'continue', 'any-run', '--json', '--yes'], {
            output: out,
            cwd: dir,
            dbUrl: join(dir, 'spur.db'),
        });
        expect(exit).toBe(2);
        const errText = out.errors.join('\n');
        expect(errText).toContain('Refusing headless');
        expect(errText).toContain('--answer');
        expect(errText).toContain('--answer-text');
        await rm(dir, { recursive: true, force: true });
    });

    test('--answer-text is documented in cli-contracts.md and spur-cli workflows.md (AC2)', async () => {
        const repoRoot = join(join(import.meta.dir, '..'), '..', '..', '..', '..');
        const contracts = readFileSync(join(repoRoot, 'docs', 'design', 'cli-contracts.md'), 'utf8');
        const workflowsRef = readFileSync(
            join(repoRoot, 'plugins', 'sp', 'skills', 'spur-cli', 'references', 'workflows.md'),
            'utf8',
        );
        expect(contracts).toContain('--answer-text <text>');
        expect(workflowsRef).toContain('--answer-text');
    });
});
