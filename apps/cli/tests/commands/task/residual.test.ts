/**
 * Thin-wrapper tests for `spur task residual` (apps/cli/src/commands/task/residual.ts). The sweep's
 * behavioral suite lives in packages/app/tests/services/residual-scan-run.test.ts; these pin the
 * in-process task port (show / create / update --section) and the verb's exit codes.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../../../src/index';
import { createCapturedOutput } from '../../helpers';

let cwd: string;
let wbs: string;
const env = {};

beforeAll(async () => {
    cwd = join(import.meta.dir, '..', '..', `.tmp-residual-task-test-${Date.now()}`);
    mkdirSync(join(cwd, 'docs', 'tasks'), { recursive: true });
    mkdirSync(join(cwd, '.spur', 'run'), { recursive: true });
    mkdirSync(join(cwd, 'tmp'), { recursive: true });
    const output = createCapturedOutput();
    expect(await main(['task', 'create', '--skip-ready', 'Residual source'], { cwd, output, env })).toBe(0);
    const line = output.messages.find((m) => m.startsWith('Created task')) ?? '';
    const path = line.split(': ')[1] ?? '';
    wbs = /(\d{4})_/.exec(path)?.[1] ?? '';
    // One in-table DEFER-ed P3 in the template's Review section: exactly one deferrable item.
    const review = join(cwd, 'tmp', 'review.md');
    writeFileSync(
        review,
        '| Priority | Finding | Location | Disposition |\n| --- | --- | --- | --- |\n| P3 | Soft spot | src/a.ts:1 | DEFER(post-merge) |\n',
    );
    const args = ['task', 'update', wbs, '--section', 'Review', '--from-file', review];
    expect(await main(args, { cwd, output: createCapturedOutput(), env })).toBe(0);
    void path;
});

afterAll(() => {
    rmSync(cwd, { recursive: true, force: true });
});

const args = (step: string): string[] => ['task', 'residual', wbs, step, '--root', cwd, '--tmp-dir', join(cwd, 'tmp')];

describe('spur task residual', () => {
    test('scan reads the task in-process and writes the artifact', async () => {
        const output = createCapturedOutput();
        expect(await main(args('scan'), { cwd, output, env })).toBe(0);
        expect(output.messages.join('\n')).toContain(`residual-scan: ${wbs} blocking=0 deferrable=1`);
        expect(existsSync(join(cwd, '.spur', 'run', `${wbs}-residuals.json`))).toBe(true);
    });

    test('review-gate passes a DEFER-ed P3', async () => {
        expect(await main(args('review-gate'), { cwd, output: createCapturedOutput(), env })).toBe(0);
    });

    test('settle files one unlinked follow-up with the Background written', async () => {
        const output = createCapturedOutput();
        expect(await main(args('settle'), { cwd, output, env })).toBe(0);
        const filed = /filed follow-up (\d{4})/.exec(output.messages.join('\n'))?.[1];
        expect(filed).toBeDefined();
        const show = createCapturedOutput();
        expect(await main(['task', 'show', filed ?? '', '--json'], { cwd, output: show, env })).toBe(0);
        const task = JSON.parse(show.messages.join('')) as { name: string; content: string; frontmatter: object };
        expect(task.name).toBe(`Residuals from ${wbs}`);
        expect(task.content).toContain(`Source task: ${wbs}`);
        expect(task.frontmatter).not.toHaveProperty('feature_id');
    });

    test('an unknown task fails closed and a bad step is a usage error', async () => {
        const output = createCapturedOutput();
        expect(await main(['task', 'residual', '9999', 'review-gate', '--root', cwd], { cwd, output, env })).toBe(1);
        expect(await main(['task', 'residual', wbs, 'bogus'], { cwd, output, env })).toBe(2);
        expect(output.errors.join('\n')).toContain('usage: spur task residual');
    });
});
