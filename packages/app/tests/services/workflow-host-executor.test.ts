import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ActionRunDao, createMigratedDb, type DbAdapter, RunDao } from '@gobing-ai/spur-domain';
import type { AgentService } from '../../src/services/agent-service';
import type { RuleService } from '../../src/services/rule-service';
import { WorkflowAppService } from '../../src/services/workflow-service';
import { receiptPath } from '../../src/workflow/receipt';

const HOST_FLOW = `name: host-executor-flow
kind: state-machine
initialState: work
states:
  - id: work
    onEnter:
      - kind: agent.run
        options:
          role: coder
          input: "Write .spur/run/host-artifact.txt"
          expectFile: .spur/run/host-artifact.txt
          ownedSections: [Solution]
          inputs:
            - path: docs/tasks5/1232_task.md
              kind: task
  - id: review
    onEnter:
      - kind: agent.run
        options:
          role: reviewer
          input: "Review .spur/run/host-artifact.txt"
          expectFile: .spur/run/host-review.txt
  - id: done
transitions:
  - from: work
    to: review
    guard: { kind: always }
  - from: review
    to: done
    guard: { kind: always }
terminalStates: [done]
`;

const TASK_BODY = '### Solution\n\nImplemented in receipt.ts.\n';

interface Harness {
    svc: WorkflowAppService;
    dir: string;
    db: DbAdapter;
    file: string;
}

async function harness(): Promise<Harness> {
    const dir = mkdtempSync(join(tmpdir(), 'spur-host-executor-'));
    const wfDir = join(dir, '.spur', 'workflows');
    mkdirSync(wfDir, { recursive: true });
    const file = join(wfDir, 'host-executor-flow.yaml');
    writeFileSync(file, HOST_FLOW, 'utf8');
    mkdirSync(join(dir, 'docs', 'tasks5'), { recursive: true });
    writeFileSync(join(dir, 'docs', 'tasks5', '1232_task.md'), TASK_BODY, 'utf8');

    const db = await createMigratedDb({ url: ':memory:' });
    // The fake executor writes the artifacts the fixture stages declare, the way a real one would.
    const produceArtifacts = (): void => {
        writeArtifact(dir, '.spur/run/host-artifact.txt');
        writeArtifact(dir, '.spur/run/host-review.txt');
    };
    const svc = new WorkflowAppService({
        cwd: dir,
        getDb: async () => db,
        agentService: () =>
            ({
                runTraced: async () => {
                    produceArtifacts();
                    return {
                        exitCode: 0,
                        stdout: '',
                        invocation: {
                            agent: 'claude',
                            source: 'default',
                            command: 'claude',
                            argv: ['-p', 'x'],
                            cwd: dir,
                            mode: 'text',
                            outputMode: 'buffered',
                            continue: false,
                            stdinInteractive: false,
                        },
                    };
                },
            }) as unknown as AgentService,
        ruleService: () => ({ evaluate: async () => ({ exitCode: 0, findings: [] }) }) as unknown as RuleService,
        hitlResponder: () => ({ respond: async () => ({ value: 'yes' }) }),
    });
    return { svc, dir, db, file };
}

/** Write the receipt a host session would produce for a paused stage. */
function writeHostReceipt(
    dir: string,
    receipt: {
        runId: string;
        state: string;
        outcome?: string;
        files?: string[];
    },
): string {
    const target = join(dir, '.spur', 'run', 'host-receipt.json');
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(
        target,
        JSON.stringify({
            runId: receipt.runId,
            state: receipt.state,
            executor: 'host',
            outcome: receipt.outcome ?? 'done',
            startedAt: '2026-10-17T10:00:00.000Z',
            finishedAt: '2026-10-17T10:05:00.000Z',
            files: receipt.files ?? [],
            reason: null,
        }),
        'utf8',
    );
    return target;
}

function writeArtifact(dir: string, path: string): void {
    const target = join(dir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, 'produced by the host', 'utf8');
}

async function actionRowCount(db: DbAdapter, runId: string): Promise<number> {
    return (await new ActionRunDao(db).actionRowsByRunId(runId)).length;
}

describe('host executor pause (D65 1232 R1)', () => {
    test('a host-resolved agent.run pauses the run and returns the work item as the pause payload', async () => {
        const { svc, dir, file } = await harness();

        const result = await svc.run(file, { runId: 'run-host', vars: { executor: 'host' } });

        expect(result.status).toBe('paused');
        expect(result.finalState).toBe('work');
        // Additive payload: the engine's own result fields keep their shape.
        expect(result.runId).toBe('run-host');
        expect(result.pause).toEqual({
            kind: 'input',
            workItem: {
                runId: 'run-host',
                state: 'work',
                skill: null,
                prompt: 'Write .spur/run/host-artifact.txt',
                inputs: [{ path: 'docs/tasks5/1232_task.md', kind: 'task' }],
                expectFiles: ['.spur/run/host-artifact.txt'],
                ownedSections: ['Solution'],
            },
        });
        expect(readFileSync(join(dir, '.spur', 'run', 'run-host', 'work-item.json'), 'utf8')).toContain(
            '"state": "work"',
        );
    });

    // R4: executor selection is the var — unset keeps the existing tier resolution.
    test('with no executor var the stage dispatches as today and the run completes', async () => {
        const { svc, dir, file } = await harness();

        const result = await svc.run(file, { runId: 'run-default' });

        expect(result.status).toBe('done');
        expect(result.pause).toBeUndefined();
        expect(existsSync(join(dir, '.spur', 'run', 'run-default', 'work-item.json'))).toBe(false);
    });

    test('executor: fleet is not the host surface', async () => {
        const { svc, dir, file } = await harness();

        const result = await svc.run(file, { runId: 'run-fleet', vars: { executor: 'fleet' } });

        expect(result.status).not.toBe('paused');
        expect(result.pause).toBeUndefined();
        expect(existsSync(join(dir, '.spur', 'run', 'run-fleet', 'work-item.json'))).toBe(false);
    });

    test('the host pause does not change the run identity the definition stamps', async () => {
        const host = await harness();
        const hostRun = await host.svc.run(host.file, { runId: 'run-host', vars: { executor: 'host' } });

        const plain = await harness();
        const plainRun = await plain.svc.run(plain.file, { runId: 'run-plain' });

        expect(hostRun.definitionDigest).toBe(plainRun.definitionDigest);
        // The stamped identity is the untransformed definition's digest.
        const row = await new RunDao(host.db).traceRowById('run-host');
        expect(JSON.parse(row?.metadata_json ?? '{}').definitionDigest).toBe(plainRun.definitionDigest ?? null);
    });
});

describe('host pause resume (D65 1232 R2)', () => {
    test('a done receipt advances the run to the next host stage, then to done', async () => {
        const { svc, dir, file } = await harness();
        const run = await svc.run(file, { runId: 'run-advance', vars: { executor: 'host' } });

        writeArtifact(dir, '.spur/run/host-artifact.txt');
        const first = writeHostReceipt(dir, { runId: 'run-advance', state: 'work' });
        const resumed = await svc.continuePaused('run-advance', { answerText: first });

        expect(resumed.status).toBe('paused');
        expect(resumed.finalState).toBe('review');
        expect(resumed.pause?.workItem.state).toBe('review');

        writeArtifact(dir, '.spur/run/host-review.txt');
        const second = writeHostReceipt(dir, { runId: 'run-advance', state: 'review' });
        const done = await svc.continuePaused('run-advance', { answerText: second });

        expect(done.status).toBe('done');
        expect(done.finalState).toBe('done');
        expect(run.status).toBe('paused');
        // The canonical receipt for each host stage is the durable evidence.
        expect(readFileSync(receiptPath(dir, 'run-advance', 'work'), 'utf8')).toContain('"executor": "host"');
    });

    test('a missing receipt is refused and the run stays paused with no side effects', async () => {
        const { svc, db, file } = await harness();
        await svc.run(file, { runId: 'run-missing', vars: { executor: 'host' } });
        const before = await actionRowCount(db, 'run-missing');

        await expect(svc.continuePaused('run-missing', { answerText: '.spur/run/never-written.json' })).rejects.toThrow(
            /receipt .*could not be read/,
        );

        expect((await new RunDao(db).traceRowById('run-missing'))?.status).toBe('paused');
        expect(await actionRowCount(db, 'run-missing')).toBe(before);
    });

    test('a receipt that only partly covers expectFiles is refused, naming the missing file', async () => {
        const { svc, db, dir, file } = await harness();
        await svc.run(file, { runId: 'run-partial', vars: { executor: 'host' } });
        const before = await actionRowCount(db, 'run-partial');
        const receipt = writeHostReceipt(dir, { runId: 'run-partial', state: 'work' });

        await expect(svc.continuePaused('run-partial', { answerText: receipt })).rejects.toThrow(
            /expected file\(s\) missing after the host run: \.spur\/run\/host-artifact\.txt/,
        );

        expect((await new RunDao(db).traceRowById('run-partial'))?.status).toBe('paused');
        expect(await actionRowCount(db, 'run-partial')).toBe(before);
    });

    // ADR-126 A4: only `done` completes a work item — a timeout is outcome-unknown.
    test('an outcome-unknown receipt is refused, naming the outcome', async () => {
        const { svc, db, dir, file } = await harness();
        await svc.run(file, { runId: 'run-unknown', vars: { executor: 'host' } });
        writeArtifact(dir, '.spur/run/host-artifact.txt');
        const receipt = writeHostReceipt(dir, { runId: 'run-unknown', state: 'work', outcome: 'outcome-unknown' });

        await expect(svc.continuePaused('run-unknown', { answerText: receipt })).rejects.toThrow(
            /outcome 'outcome-unknown'/,
        );

        expect((await new RunDao(db).traceRowById('run-unknown'))?.status).toBe('paused');
    });

    test('a stale receipt — another run or another state — is refused', async () => {
        const { svc, dir, file } = await harness();
        await svc.run(file, { runId: 'run-stale', vars: { executor: 'host' } });
        writeArtifact(dir, '.spur/run/host-artifact.txt');

        const otherRun = writeHostReceipt(dir, { runId: 'run-other', state: 'work' });
        await expect(svc.continuePaused('run-stale', { answerText: otherRun })).rejects.toThrow(
            /runId 'run-other' does not match run 'run-stale'/,
        );

        const otherState = writeHostReceipt(dir, { runId: 'run-stale', state: 'precheck' });
        await expect(svc.continuePaused('run-stale', { answerText: otherState })).rejects.toThrow(
            /state 'precheck' does not match paused state 'work'/,
        );
    });

    test('a second continue on the finished run is refused as not resumable, with no side effects', async () => {
        const { svc, db, dir, file } = await harness();
        await svc.run(file, { runId: 'run-twice', vars: { executor: 'host' } });
        writeArtifact(dir, '.spur/run/host-artifact.txt');
        const first = writeHostReceipt(dir, { runId: 'run-twice', state: 'work' });
        await svc.continuePaused('run-twice', { answerText: first });
        writeArtifact(dir, '.spur/run/host-review.txt');
        const second = writeHostReceipt(dir, { runId: 'run-twice', state: 'review' });
        await svc.continuePaused('run-twice', { answerText: second });
        const beforeRows = await actionRowCount(db, 'run-twice');

        await expect(svc.continuePaused('run-twice', { answerText: second })).rejects.toThrow(/not resumable/);

        expect((await new RunDao(db).traceRowById('run-twice'))?.status).toBe('done');
        expect(await actionRowCount(db, 'run-twice')).toBe(beforeRows);
    });
});
