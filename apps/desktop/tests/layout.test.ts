import { describe, expect, test } from 'bun:test';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
    findRepoRoot,
    type LayoutFs,
    nodeLayoutFs,
    parseProjectArg,
    platformBinarySuffix,
    resolveDesktopMode,
    resolveLayout,
} from '../src/layout';

function fsFrom(dirs: readonly string[], files: readonly string[] = []): LayoutFs {
    const dirSet = new Set(dirs);
    const fileSet = new Set(files);
    return {
        exists: (path) => dirSet.has(path) || fileSet.has(path),
        isDirectory: (path) => dirSet.has(path),
    };
}

const repo = '/repo';
const marker = '/repo/apps/cli/src/index.ts';
const work = '/work';

describe('layout', () => {
    test('platform suffixes match shipped bun targets', () => {
        expect(platformBinarySuffix('linux', 'x64')).toBe('linux-x64');
        expect(platformBinarySuffix('darwin', 'arm64')).toBe('darwin-arm64');
        expect(platformBinarySuffix('win32', 'x64')).toBe('windows-x64');
        expect(platformBinarySuffix('win32', 'ia32')).toBeUndefined();
        expect(platformBinarySuffix('freebsd', 'x64')).toBeUndefined();
    });

    test('parseProjectArg reads both spellings', () => {
        expect(parseProjectArg(['electron', '.', '--project', '/work'])).toBe('/work');
        expect(parseProjectArg(['--project=/work'])).toBe('/work');
        expect(parseProjectArg(['--project'])).toBeUndefined();
        expect(parseProjectArg(['--project='])).toBeUndefined();
        expect(parseProjectArg(['--other', 'x'])).toBeUndefined();
    });

    test('resolveDesktopMode defaults from packaged state and rejects junk', () => {
        expect(resolveDesktopMode(undefined, false)).toBe('dev');
        expect(resolveDesktopMode('  ', true)).toBe('prod');
        expect(resolveDesktopMode('prod', false)).toBe('prod');
        expect(resolveDesktopMode('dev', true)).toBe('dev');
        expect(() => resolveDesktopMode('staging', false)).toThrow(/SPUR_DESKTOP_MODE/);
    });

    test('dev layout serves the checkout unless a project is set', () => {
        const fs = fsFrom([repo, work], [marker]);
        const dev = resolveLayout(
            { isPackaged: false, cwd: work, execDir: '/repo/apps/desktop/dist', env: {}, argv: [] },
            fs,
        );
        expect(dev).toEqual({ mode: 'dev', repoRoot: repo, projectRoot: repo, resourcesDir: undefined });

        const pointed = resolveLayout(
            {
                isPackaged: false,
                cwd: repo,
                execDir: '/repo/apps/desktop/dist',
                env: { SPUR_PROJECT_ROOT: 'nested' },
                argv: ['--project', work],
            },
            fs,
        );
        expect(pointed.projectRoot).toBe(work);
        expect(pointed.repoRoot).toBe(repo);
    });

    test('prod packaged layout uses Electron resources, not the checkout stage dir', () => {
        const fs = fsFrom([work], []);
        const layout = resolveLayout(
            {
                isPackaged: true,
                cwd: work,
                execDir: '/app/resources/app.asar/dist',
                resourcesPath: '/app/resources',
                env: { SPUR_PROJECT_ROOT: work },
                argv: [],
            },
            fs,
        );
        expect(layout.mode).toBe('prod');
        expect(layout.repoRoot).toBeUndefined();
        expect(layout.projectRoot).toBe(work);
        expect(layout.resourcesDir).toBe('/app/resources/spur');
    });

    test('prod unpackaged layout stages beside the checkout', () => {
        const fs = fsFrom([repo, work], [marker]);
        const layout = resolveLayout(
            {
                isPackaged: false,
                cwd: work,
                execDir: '/repo/apps/desktop/dist',
                resourcesPath: '/usr/lib/electron/resources',
                env: { SPUR_DESKTOP_MODE: 'prod', SPUR_PROJECT_ROOT: work },
                argv: [],
            },
            fs,
        );
        expect(layout.resourcesDir).toBe('/repo/apps/desktop/resources/spur');
        expect(layout.projectRoot).toBe(work);
    });

    test('missing project root is an error', () => {
        const fs = fsFrom([repo], [marker]);
        expect(() =>
            resolveLayout(
                {
                    isPackaged: false,
                    cwd: repo,
                    execDir: '/repo/apps/desktop',
                    env: { SPUR_PROJECT_ROOT: '/missing' },
                    argv: [],
                },
                fs,
            ),
        ).toThrow(/not a directory/);
    });

    test('findRepoRoot walks parents, stops at root, and gives up when the tree is too deep', () => {
        expect(findRepoRoot('/nowhere/child', { exists: () => false, isDirectory: () => false })).toBeUndefined();
        const deep = `/${Array.from({ length: 40 }, (_, i) => `d${i}`).join('/')}`;
        expect(findRepoRoot(deep, { exists: () => false, isDirectory: () => false })).toBeUndefined();
        expect(findRepoRoot('/repo/apps/desktop', fsFrom([], [marker]))).toBe(repo);
    });

    test('node layout fs sees this checkout and a missing directory', () => {
        const root = findRepoRoot(import.meta.dir);
        expect(root).toBe(resolve(import.meta.dir, '../../..'));
        expect(nodeLayoutFs().exists(join(import.meta.dir, 'layout.test.ts'))).toBe(true);
        expect(nodeLayoutFs().isDirectory(join(tmpdir(), 'spur-desktop-missing-dir'))).toBe(false);
    });
});

test('packaged launches cannot silently use Finder cwd as a project', () => {
    expect(() =>
        resolveLayout(
            {
                isPackaged: true,
                cwd: '/',
                execDir: '/app/dist',
                env: {},
                argv: [],
            },
            fsFrom(['/']),
        ),
    ).toThrow(/Choose a project/);
});
