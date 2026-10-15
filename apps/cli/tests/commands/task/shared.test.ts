/**
 * Unit tests for the helpers `spur task` verbs share (apps/cli/src/commands/task/shared.ts).
 * Verb behaviour is covered end-to-end by the sibling `<verb>.test.ts` files.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskCheckService, TaskLocator, TaskService } from '@gobing-ai/spur-app';
import {
    loadTemplateBodies,
    makeCheckService,
    makeService,
    makeTaskLocator,
    templateBodiesCache,
    writeCreateJsonError,
} from '../../../src/commands/task/shared';
import { createCliContext } from '../../../src/context';
import { createCapturedOutput } from '../../helpers';

const roots: string[] = [];
async function project(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'spur-task-shared-'));
    roots.push(root);
    await mkdir(join(root, 'docs', 'tasks'), { recursive: true });
    return root;
}

afterEach(async () => {
    templateBodiesCache.clear();
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('writeCreateJsonError', () => {
    test('raw --json writes one ok:false payload on stdout with the prefix stripped and extras merged', () => {
        const output = createCapturedOutput();
        const context = createCliContext({ output });
        writeCreateJsonError(context, { json: true }, 'duplicate-follow-up', 'Error: already exists', { wbs: '0001' });
        expect(output.errors).toEqual([]);
        expect(JSON.parse(output.messages.join(''))).toEqual({
            ok: false,
            error: { code: 'duplicate-follow-up', message: 'already exists', wbs: '0001' },
        });
    });

    test('--json --json-envelope carries the CLI code in details.cliCode', () => {
        const output = createCapturedOutput();
        writeCreateJsonError(createCliContext({ output }), { json: true, jsonEnvelope: true }, 'cycle', 'loop');
        const envelope = JSON.parse(output.messages.join(''));
        expect(envelope.ok).toBe(false);
        expect(envelope.error.code).toBe('INTERNAL_ERROR');
        expect(envelope.error.message).toBe('loop');
        expect(envelope.error.details).toEqual({ cliCode: 'cycle' });
    });

    test('without --json the prose goes to stderr and stdout stays empty', () => {
        const output = createCapturedOutput();
        writeCreateJsonError(createCliContext({ output }), {}, 'cycle', 'Error: dependency cycle');
        expect(output.messages).toEqual([]);
        expect(output.errors).toEqual(['dependency cycle']);
    });
});

describe('loadTemplateBodies', () => {
    test('prefers the project-local template and caches per variant', async () => {
        const root = await project();
        const dir = join(root, '.spur', 'tasks', 'templates');
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'custom.md'), '## 0000. T\n\n### Background\n\nLocal body.\n');
        const first = loadTemplateBodies(root, 'custom');
        expect(Object.values(first).join('\n')).toContain('Local body.');
        await writeFile(join(dir, 'custom.md'), '## 0000. T\n\n### Background\n\nChanged.\n');
        expect(loadTemplateBodies(root, 'custom')).toBe(first);
        expect(templateBodiesCache.has('custom')).toBe(true);
    });

    test('an unknown variant with no local or bundled template yields {}', async () => {
        const root = await project();
        expect(loadTemplateBodies(root, 'no-such-variant-xyz')).toEqual({});
    });
});

describe('service factories', () => {
    test('makeService, makeTaskLocator and makeCheckService build over the active folder', async () => {
        const root = await project();
        const context = createCliContext({ cwd: root, output: createCapturedOutput() });
        expect(await makeService(context)).toBeInstanceOf(TaskService);
        expect(await makeService(context, 'docs/tasks', true, true)).toBeInstanceOf(TaskService);
        expect(await makeTaskLocator(context)).toBeInstanceOf(TaskLocator);
        expect(await makeCheckService(context)).toBeInstanceOf(TaskCheckService);
    });
});
