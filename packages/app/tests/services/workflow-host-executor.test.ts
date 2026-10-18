import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ActionRunDao, type DbAdapter, RunDao } from '@gobing-ai/spur-domain';
import { receiptPath } from '../../src/workflow/receipt';
import { HOST_FLOW, harness, writeArtifact, writeHostReceipt } from '../fixtures/workflow-host';

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
    test('a later approval in the same state does not hide the pending host work item', async () => {
        const { svc, file, dir } = await harness();
        writeFileSync(
            file,
            HOST_FLOW.replace('  - id: work\n', '  - id: work\n    pause: true\n').replace(
                '  - id: review',
                `      - kind: hitl.confirm
        options:
          prompt: "Approve host output?"
  - id: review`,
            ),
        );
        const first = await svc.run(file, { vars: { executor: 'host' } });
        expect(first).toMatchObject({ status: 'paused', finalState: 'work' });
        expect((await svc.pendingGate(first.runId))?.kind).toBe('hitl.input');
        writeArtifact(dir, '.spur/run/host-artifact.txt');
        const second = await svc.continuePaused(first.runId, {
            answerText: writeHostReceipt(dir, { runId: first.runId, state: 'work' }),
        });
        expect(second.status).toBe('paused');
        expect(second.finalState).toBe('work');
        expect(second.pause).toBeUndefined();
        expect((await svc.pendingGate(first.runId))?.kind).toBe('hitl.confirm');
        const third = await svc.continuePaused(first.runId, { hitlAnswer: 'yes' });
        expect(third.finalState).toBe('review');
        expect(third.pause?.workItem.state).toBe('review');
    });
    test('a consumer in the same state waits for the host receipt, then runs exactly once', async () => {
        const { svc, file, dir } = await harness();
        writeFileSync(
            file,
            HOST_FLOW.replace(
                '  - id: review',
                `      - kind: shell
        options:
          command: "test -f .spur/run/host-artifact.txt && echo consumed >> .spur/run/consumer.txt"
  - id: review`,
            ),
        );
        const first = await svc.run(file, { vars: { executor: 'host' } });
        expect(first.status).toBe('paused');
        expect(existsSync(join(dir, '.spur/run/consumer.txt'))).toBe(false);
        writeArtifact(dir, '.spur/run/host-artifact.txt');
        const receipt = writeHostReceipt(dir, { runId: first.runId, state: 'work' });
        const second = await svc.continuePaused(first.runId, { answerText: receipt });
        expect(second.status).toBe('paused');
        expect(second.pause?.workItem.state).toBe('review');
        expect(readFileSync(join(dir, '.spur/run/consumer.txt'), 'utf8')).toBe('consumed\n');
    });
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
