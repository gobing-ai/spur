import { expect, test } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { main } from '../../src/index';
import { createCapturedOutput, createTempProject } from '../helpers';

test('D66: the bundled idea pipeline records host discovery, pauses for the operator, and cancels explicitly', async () => {
    const dir = await createTempProject();
    const runId = 'idea-consolidation-e2e';
    const runDir = join(dir, '.spur', 'run');
    const dbUrl = join(dir, 'spur.db');
    const workflow = resolve(import.meta.dir, '../../../../config', 'workflows', 'idea-pipeline.yaml');
    const invoke = async (args: string[]) => {
        const output = createCapturedOutput();
        await main(['workflow', ...args, '--json'], { cwd: dir, dbUrl, output });
        expect(output.messages.length, output.errors.join('\n')).toBeGreaterThan(0);
        return JSON.parse(output.messages.at(-1) ?? '{}');
    };
    try {
        await mkdir(join(dir, '.spur'), { recursive: true });
        await writeFile(join(dir, '.spur', 'config.yaml'), 'workflow:\n  decideDecisionMaker: false\n');
        const discovery = await invoke([
            'run',
            workflow,
            '--run-id',
            runId,
            '--vars',
            JSON.stringify({ executor: 'host', profile: 'standard', idea: 'Add a preview command' }),
        ]);
        expect(discovery).toMatchObject({ status: 'paused', finalState: 'discovery' });
        const item = discovery.pause.workItem;
        expect(item).toMatchObject({ runId, state: 'discovery' });
        expect(await readFile(join(runDir, `${runId}-idea-precheck-doctor.status`), 'utf8')).toBe('PASS\n');
        expect(await readFile(join(runDir, `${runId}-idea-input.md`), 'utf8')).toBe('Add a preview command\n');

        await writeFile(join(runDir, `${runId}-idea-eval-report.md`), '## Recommendation\n\nproceed\n');
        await writeFile(join(runDir, `${runId}-idea-needs-design.json`), '{"needs_design":false}\n');
        const receipt = join(runDir, 'discovery-receipt.json');
        await writeFile(
            receipt,
            JSON.stringify({
                runId,
                state: 'discovery',
                executor: 'host',
                outcome: 'done',
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
                files: item.expectFiles,
                reason: null,
            }),
        );
        const approval = await invoke(['continue', runId, '--yes', '--answer-text', receipt]);
        expect(approval).toMatchObject({ status: 'paused', finalState: 'idea-eval' });
        expect(approval.pause).toMatchObject({ reason: 'hitl-pause', kind: 'hitl.confirm' });
        for (const [id, suffix] of [
            ['idea-recommendation', 'idea-recommendation'],
            ['needs-design', 'idea-needs-design'],
        ]) {
            const row = JSON.parse(await readFile(join(runDir, `${runId}-${suffix}.decision`), 'utf8'));
            expect(row.id).toBe(id);
        }
        expect(await readFile(join(runDir, `${runId}-idea-recommendation.txt`), 'utf8')).toBe('proceed\n');

        const cancelled = await invoke(['continue', runId, '--yes', '--answer', 'cancel']);
        expect(cancelled).toMatchObject({ status: 'failed', finalState: 'cancelled' });
        const trace = await invoke(['trace', runId]);
        expect(trace.run).toMatchObject({ runId, status: 'failed' });
        expect(await readFile(join(runDir, `${runId}-idea-eval-answer.txt`), 'utf8')).toContain('cancel');
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}, 30_000);
