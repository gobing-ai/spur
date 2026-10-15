import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractWorkflowMeta, newestMtime, scanWorkflowFiles } from '../../src/services/workflow-catalog-scan';

const roots: string[] = [];
async function tempDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'spur-wf-scan-'));
    roots.push(dir);
    return dir;
}
afterEach(async () => {
    for (const dir of roots.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('newestMtime', () => {
    test('a file reports its own mtime; a tree reports its newest entry; an empty dir its own', async () => {
        const dir = await tempDir();
        await mkdir(join(dir, 'empty'));
        await writeFile(join(dir, 'a.yaml'), 'x');
        const file = await newestMtime(join(dir, 'a.yaml'));
        expect(typeof file).toBe('number');
        expect(await newestMtime(dir)).toBeGreaterThanOrEqual(file ?? 0);
        expect(typeof (await newestMtime(join(dir, 'empty')))).toBe('number');
    });

    test('a tree containing .git is not a catalogue tree (null)', async () => {
        const dir = await tempDir();
        await mkdir(join(dir, 'nested', '.git'), { recursive: true });
        expect(await newestMtime(dir)).toBeNull();
    });
});

describe('scanWorkflowFiles', () => {
    test('walks nested YAML files, tagging path and layer, and skips other files', async () => {
        const dir = await tempDir();
        await mkdir(join(dir, 'sub'));
        await writeFile(join(dir, 'one.yaml'), 'name: one\n');
        await writeFile(join(dir, 'sub', 'two.yml'), 'name: two\n');
        await writeFile(join(dir, 'notes.md'), '# not a workflow\n');
        const entries = await scanWorkflowFiles(dir, 'project', async (path) => ({
            ...(await extractWorkflowMeta(path)),
        }));
        expect(entries.map((e) => [e.path, e.name, e.source]).sort()).toEqual([
            ['one.yaml', 'one', 'project'],
            [join('sub', 'two.yml'), 'two', 'project'],
        ]);
    });

    test('a missing root yields no entries', async () => {
        const dir = await tempDir();
        expect(await scanWorkflowFiles(join(dir, 'absent'), 'project', extractWorkflowMeta)).toEqual([]);
    });
});

describe('extractWorkflowMeta', () => {
    async function meta(text: string) {
        const dir = await tempDir();
        await writeFile(join(dir, 'wf.yaml'), text);
        return extractWorkflowMeta(join(dir, 'wf.yaml'));
    }

    test('reads name and kind, defaulting kind to state-machine', async () => {
        expect(await meta('name: demo\nkind: pipeline\n')).toEqual({
            name: 'demo',
            kind: 'pipeline',
            valid: true,
            description: null,
        });
        expect((await meta('name: demo\n')).kind).toBe('state-machine');
    });

    test('flags an unnamed, non-object or unreadable file as invalid', async () => {
        expect(await meta('kind: pipeline\n')).toMatchObject({ name: '<unnamed>', kind: 'pipeline', valid: false });
        expect((await meta('name: ""\n')).kind).toBe('state-machine');
        expect(await meta('- a\n- b\n')).toMatchObject({ name: '<unparseable>', valid: false });
        const missing = await extractWorkflowMeta(join(await tempDir(), 'absent.yaml'));
        expect(missing).toMatchObject({ name: '<unparseable>', kind: 'unknown', valid: false });
        expect(typeof missing.error).toBe('string');
    });
});
