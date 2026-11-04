/**
 * Unit tests for the helpers `spur feature` verbs share (apps/cli/src/commands/feature/shared.ts).
 * Verb behaviour is covered end-to-end by the sibling `<verb>.test.ts` files.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FeatureService } from '@gobing-ai/spur-app';
import { makeReceiptRunPort, makeService } from '../../../src/commands/feature/shared';
import { createCliContext } from '../../../src/context';
import { createCapturedOutput } from '../../helpers';

const roots: string[] = [];
async function project(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'spur-feature-shared-'));
    roots.push(root);
    await mkdir(join(root, 'docs', 'features'), { recursive: true });
    await mkdir(join(root, 'docs', 'tasks'), { recursive: true });
    return root;
}

afterEach(async () => {
    for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('makeService', () => {
    test('defaults to the configured features folder', async () => {
        const root = await project();
        const service = await makeService(createCliContext({ cwd: root, output: createCapturedOutput() }));
        expect(service).toBeInstanceOf(FeatureService);
        await service.create('Default Folder');
        expect((await readdir(join(root, 'docs', 'features'))).some((f) => f.endsWith('.md'))).toBe(true);
    });

    test('folderOverride redirects writes away from the configured folder', async () => {
        const root = await project();
        const override = join(root, 'elsewhere');
        await mkdir(override, { recursive: true });
        const service = await makeService(createCliContext({ cwd: root, output: createCapturedOutput() }), override);
        await service.create('Override Folder');
        expect((await readdir(override)).some((f) => f.endsWith('.md'))).toBe(true);
        expect((await readdir(join(root, 'docs', 'features'))).some((f) => f.endsWith('.md'))).toBe(false);
    });
});

describe('makeReceiptRunPort', () => {
    test('an unknown run id reads as absent (fail-closed at the completion boundary)', async () => {
        const root = await project();
        const port = await makeReceiptRunPort(createCliContext({ cwd: root, output: createCapturedOutput() }));
        expect(port.readRunRow).toBeDefined();
        expect(await port.readRunRow?.('no-such-run')).toBeUndefined();
    });
});
