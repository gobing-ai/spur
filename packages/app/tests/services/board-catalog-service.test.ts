import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { BoardModuleConfigError, type BoardModuleDeclaration } from '@gobing-ai/spur-config';
import {
    type BoardModuleFileProbe,
    declaredBoardModules,
    isInsideRoot,
    prepareBoardModules,
} from '../../src/services/board-catalog-service';

// Task 0989 R3/AC2 — the app-layer seam of the catalog deliverable. A recording probe stands in
// for the filesystem, so "disabled declarations perform structural validation and require no
// files" is asserted as "no probe call at all", which a real-fs test cannot show.

const host = {
    manifestVersion: 1,
    contributionApiVersion: 1,
    reactVersion: '19.0.0',
    reactDomVersion: '19.0.0',
    reactRouterVersion: '7.0.0',
    imports: {},
    reservedModules: [],
};

/** Probe recording every path it was asked about, over a fixed set of existing files. */
function recordingProbe(existing: readonly string[]): BoardModuleFileProbe & { readonly calls: string[] } {
    const calls: string[] = [];
    const files = new Set(existing);
    const dirs = new Set(existing.map((path) => join(path, '..')));
    return {
        calls,
        isFile: async (path: string) => {
            calls.push(`file:${path}`);
            return files.has(path);
        },
        isDirectory: async (path: string) => {
            calls.push(`dir:${path}`);
            return dirs.has(path) || calls.some((call) => call.startsWith(`file:${path}`));
        },
        realPath: (path: string) => {
            calls.push(`real:${path}`);
            return path;
        },
    };
}

const reactModule = (overrides: Partial<BoardModuleDeclaration> = {}): BoardModuleDeclaration =>
    ({
        id: 'kanban',
        name: 'Kanban',
        icon: 'K',
        type: 'react',
        directory: 'board/kanban',
        entry: 'index.js',
        styles: [],
        enabled: true,
        ...overrides,
    }) as BoardModuleDeclaration;

describe('declaredBoardModules (R1 seam)', () => {
    test('an absent bootstrap section means no modules', () => {
        expect(declaredBoardModules(undefined)).toEqual([]);
        expect(declaredBoardModules({})).toEqual([]);
    });

    test('declarations are passed through in order', () => {
        expect(declaredBoardModules({ bootstrap: { modules: [reactModule()] } })).toHaveLength(1);
    });
});

describe('prepareBoardModules (R3/AC2)', () => {
    test('a disabled declaration is dropped before any IO happens', async () => {
        const probe = recordingProbe([]);
        const prepared = await prepareBoardModules({
            projectRoot: '/project',
            declarations: [reactModule({ enabled: false, directory: 'board/missing', entry: 'gone.js' })],
            host,
            probe,
        });
        expect(prepared.catalog.modules).toEqual([]);
        expect(prepared.roots).toEqual([]);
        expect(probe.calls).toEqual([]);
    });

    test('an enabled module publishes public URLs and keeps its roots server-side', async () => {
        const probe = recordingProbe(['/project/board/kanban/index.js']);
        const prepared = await prepareBoardModules({
            projectRoot: '/project',
            declarations: [reactModule()],
            host,
            probe,
        });
        expect(prepared.catalog.modules[0]).toMatchObject({
            id: 'kanban',
            type: 'react',
            route: '/modules/kanban',
            entryUrl: '/modules/kanban/index.js',
        });
        expect(prepared.roots[0]).toMatchObject({ id: 'kanban', root: '/project/board/kanban' });
    });

    test('an iframe declaration needs no asset IO at all', async () => {
        const probe = recordingProbe([]);
        const prepared = await prepareBoardModules({
            projectRoot: '/project',
            declarations: [
                { id: 'docs', name: 'Docs', icon: 'D', type: 'iframe', url: 'https://docs.example.com', enabled: true },
            ],
            host,
            probe,
        });
        expect(prepared.catalog.modules[0]).toMatchObject({ type: 'iframe', url: 'https://docs.example.com' });
        expect(probe.calls).toEqual([]);
    });

    test('a missing module directory fails with the declaration index and id', async () => {
        const error = await prepareBoardModules({
            projectRoot: '/project',
            declarations: [reactModule({ directory: 'board/absent' })],
            host,
            probe: recordingProbe([]),
        }).catch((thrown: unknown) => thrown);
        expect(error).toBeInstanceOf(BoardModuleConfigError);
        expect((error as Error).message).toBe(
            'bootstrap.modules[0] ("kanban"): module directory "board/absent" was not found',
        );
    });

    test('an escaping entry path is refused as a configuration error', async () => {
        const error = await prepareBoardModules({
            projectRoot: '/project',
            declarations: [reactModule({ entry: '../../etc/passwd' })],
            host,
            probe: recordingProbe([]),
        }).catch((thrown: unknown) => thrown);
        expect(error).toBeInstanceOf(BoardModuleConfigError);
        expect((error as Error).message).toContain('escapes the module directory');
    });

    test('a symlinked entry leaving its module directory is refused', async () => {
        const probe: BoardModuleFileProbe = {
            isFile: async () => true,
            isDirectory: async () => true,
            realPath: (path) => (path.endsWith('index.js') ? '/elsewhere/index.js' : path),
        };
        const error = await prepareBoardModules({
            projectRoot: '/project',
            declarations: [reactModule()],
            host,
            probe,
        }).catch((thrown: unknown) => thrown);
        expect(error).toBeInstanceOf(BoardModuleConfigError);
        expect((error as Error).message).toContain('resolves outside the project root');
    });

    test('containment is a plain lexical question for the request layer too', () => {
        expect(isInsideRoot('/project/board', '/project/board/index.js')).toBe(true);
        expect(isInsideRoot('/project/board', '/project/board')).toBe(false);
        expect(isInsideRoot('/project/board', '/project/elsewhere.js')).toBe(false);
    });
});
