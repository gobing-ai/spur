import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { resolveMcpNamespace } from '../../src';

const tempDirs: string[] = [];

function makeTempProject(): string {
    const dir = mkdtempSync(join(tmpdir(), 'spur-mcp-ns-'));
    tempDirs.push(dir);
    return dir;
}

function writeManifest(projectRoot: string, relativeDir: string, content: unknown): void {
    const dir = join(projectRoot, 'plugins', relativeDir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'plugin.json'), typeof content === 'string' ? content : JSON.stringify(content));
}

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true });
    }
});

describe('resolveMcpNamespace (task 1380)', () => {
    test('configured namespace wins over any plugin manifest', async () => {
        const root = makeTempProject();
        writeManifest(root, 'sp', { name: 'sp' });

        const result = await resolveMcpNamespace({
            configured: 'customns',
            projectRoot: root,
            fs: createNodeFileSystem(root),
        });
        expect(result).toEqual({ namespace: 'customns', source: 'config' });
    });

    test('resolves from a single depth-1 plugins/<name>/plugin.json manifest', async () => {
        const root = makeTempProject();
        writeManifest(root, 'cc', { name: 'cc' });

        const result = await resolveMcpNamespace({
            configured: undefined,
            projectRoot: root,
            fs: createNodeFileSystem(root),
        });
        expect(result).toEqual({ namespace: 'cc', source: 'plugin-manifest' });
    });

    test('returns none when two depth-1 manifests exist (ambiguous)', async () => {
        const root = makeTempProject();
        writeManifest(root, 'sp', { name: 'sp' });
        writeManifest(root, 'cc', { name: 'cc' });

        const result = await resolveMcpNamespace({
            configured: undefined,
            projectRoot: root,
            fs: createNodeFileSystem(root),
        });
        expect(result).toEqual({ namespace: null, source: 'none' });
    });

    test('returns none when only nested (depth-2) manifests exist (knowledge-kit shape)', async () => {
        const root = makeTempProject();
        writeManifest(root, join('generations', 'omni-voice-gen'), { name: 'omnivoice' });

        const result = await resolveMcpNamespace({
            configured: undefined,
            projectRoot: root,
            fs: createNodeFileSystem(root),
        });
        expect(result).toEqual({ namespace: null, source: 'none' });
    });

    test('returns none when the single manifest name fails the namespace grammar', async () => {
        const root = makeTempProject();
        writeManifest(root, 'bad', { name: 'Bad-Name' });

        const result = await resolveMcpNamespace({
            configured: undefined,
            projectRoot: root,
            fs: createNodeFileSystem(root),
        });
        expect(result).toEqual({ namespace: null, source: 'none' });
    });

    test('returns none when no plugins directory exists or manifest JSON is malformed', async () => {
        const emptyRoot = makeTempProject();
        expect(
            await resolveMcpNamespace({
                configured: undefined,
                projectRoot: emptyRoot,
                fs: createNodeFileSystem(emptyRoot),
            }),
        ).toEqual({ namespace: null, source: 'none' });

        const badJsonRoot = makeTempProject();
        writeManifest(badJsonRoot, 'sp', '{not-json');
        expect(
            await resolveMcpNamespace({
                configured: undefined,
                projectRoot: badJsonRoot,
                fs: createNodeFileSystem(badJsonRoot),
            }),
        ).toEqual({ namespace: null, source: 'none' });
    });
});
