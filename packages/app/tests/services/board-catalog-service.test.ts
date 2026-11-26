import { describe, expect, test } from 'bun:test';
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
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

// ─── Fail-closed canonical verification (task 1208 R1/R3) ───
//
// These tests run against a real temporary tree with a real-path-backed probe, so `/tmp`
// aliases cannot mask the premise: every canonical answer the code sees is the path the
// filesystem would actually open, and the escaping stylesheet is a real symlink.

async function realTree(): Promise<{ root: string; moduleDir: string; cleanup: () => Promise<void> }> {
    const root = await mkdtemp(join(tmpdir(), 'spur-board-1208-'));
    const moduleDir = join(root, 'board', 'kanban');
    await mkdir(moduleDir, { recursive: true });
    await writeFile(join(moduleDir, 'index.js'), 'export const webModule = 1;\n');
    await writeFile(join(moduleDir, 'app.css'), '.kanban{}\n');
    await writeFile(join(root, 'outside.css'), '.secret{}\n');
    await symlink(join(root, 'outside.css'), join(moduleDir, 'escape.css'));
    return { root, moduleDir, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/** A real-filesystem probe whose canonical answers can be overridden per lexical path. */
function realProbe(override?: (path: string) => string | undefined): BoardModuleFileProbe {
    return {
        isFile: async (path) => (await stat(path)).isFile(),
        isDirectory: async (path) => (await stat(path)).isDirectory(),
        realPath: (path) => {
            if (override) return override(path);
            return realpathSync(path);
        },
    };
}

describe('prepareBoardModules fail-closed canonical verification (task 1208 R1)', () => {
    test('an unresolvable project root real path is refused, not accepted lexically', async () => {
        const { root, cleanup } = await realTree();
        try {
            const error = await prepareBoardModules({
                projectRoot: root,
                declarations: [reactModule()],
                host,
                probe: realProbe(() => undefined),
            }).catch((thrown: unknown) => thrown);
            expect(error).toBeInstanceOf(BoardModuleConfigError);
            expect((error as Error).message).toContain('project root');
            expect((error as Error).message).toContain(root);
        } finally {
            await cleanup();
        }
    });

    test('a thrown project root resolution is normalized into a BoardModuleConfigError', async () => {
        const { root, cleanup } = await realTree();
        try {
            const error = await prepareBoardModules({
                projectRoot: root,
                declarations: [reactModule()],
                host,
                probe: {
                    ...realProbe(),
                    realPath: () => {
                        throw new Error('no symlink resolution here');
                    },
                },
            }).catch((thrown: unknown) => thrown);
            expect(error).toBeInstanceOf(BoardModuleConfigError);
            expect((error as Error).message).not.toContain('no symlink resolution here');
            expect((error as Error).message).toContain(root);
        } finally {
            await cleanup();
        }
    });

    test('each undefined or throwing canonical path is refused naming the declaration and path', async () => {
        const { root, moduleDir, cleanup } = await realTree();
        try {
            const cases = [
                { absent: moduleDir, message: 'module directory', styles: [] as string[] },
                { absent: join(moduleDir, 'index.js'), message: 'entry asset', styles: [] },
                { absent: join(moduleDir, 'app.css'), message: 'style asset', styles: ['app.css'] },
            ];
            for (const { absent, message, styles } of cases) {
                for (const failure of ['undefined', 'throw']) {
                    const error = await prepareBoardModules({
                        projectRoot: root,
                        declarations: [reactModule({ styles })],
                        host,
                        probe: realProbe((path) => {
                            if (path !== absent) return realpathSync(path);
                            if (failure === 'throw') throw new Error('canonical path unavailable');
                            return undefined;
                        }),
                    }).catch((thrown: unknown) => thrown);
                    expect(error).toBeInstanceOf(BoardModuleConfigError);
                    expect((error as Error).message).toContain('bootstrap.modules[0]');
                    expect((error as Error).message).toContain('kanban');
                    expect((error as Error).message).toContain(absent);
                    expect((error as Error).message).toContain(message);
                }
            }
        } finally {
            await cleanup();
        }
    });

    test('a module root whose real path escapes the project root is refused', async () => {
        const { root, moduleDir, cleanup } = await realTree();
        try {
            const error = await prepareBoardModules({
                projectRoot: root,
                declarations: [reactModule()],
                host,
                probe: realProbe((path) => (path === moduleDir ? '/elsewhere/kanban' : realpathSync(path))),
            }).catch((thrown: unknown) => thrown);
            expect(error).toBeInstanceOf(BoardModuleConfigError);
            expect((error as Error).message).toContain('resolves outside the project root');
        } finally {
            await cleanup();
        }
    });

    test('a real escaping stylesheet symlink is refused at startup', async () => {
        const { root, cleanup } = await realTree();
        try {
            const error = await prepareBoardModules({
                projectRoot: root,
                declarations: [reactModule({ styles: ['app.css', 'escape.css'] })],
                host,
                probe: realProbe(),
            }).catch((thrown: unknown) => thrown);
            expect(error).toBeInstanceOf(BoardModuleConfigError);
            expect((error as Error).message).toContain('escape.css');
            expect((error as Error).message).toContain('resolves outside');
        } finally {
            await cleanup();
        }
    });

    test('contained real entry and stylesheet symlinks keep working (R3)', async () => {
        const { root, moduleDir, cleanup } = await realTree();
        try {
            await symlink(join(moduleDir, 'index.js'), join(moduleDir, 'boot.js'));
            await symlink(join(moduleDir, 'app.css'), join(moduleDir, 'linked.css'));
            const prepared = await prepareBoardModules({
                projectRoot: root,
                declarations: [reactModule({ entry: 'boot.js', styles: ['linked.css'] })],
                host,
                probe: realProbe(),
            });
            expect(prepared.catalog.modules[0]).toMatchObject({
                entryUrl: '/modules/kanban/boot.js',
                styles: ['/modules/kanban/linked.css'],
            });
        } finally {
            await cleanup();
        }
    });
});

// Task 1455 R3 — the optional backend bundle: project-root confinement rather than the module
// directory `entry`/`styles` are confined to, proven on the real paths like every other asset.
describe('optional module API bundle (task 1455 R3/AC3)', () => {
    /** The R3 fixture tree: one contained module, one project-root api bundle, one escaping symlink. */
    async function apiTree(): Promise<{ root: string; cleanup: () => Promise<void> }> {
        const root = await mkdtemp(join(tmpdir(), 'spur-board-1455-'));
        const outside = await mkdtemp(join(tmpdir(), 'spur-board-1455-outside-'));
        const moduleDir = join(root, 'board', 'kanban');
        await mkdir(moduleDir, { recursive: true });
        await mkdir(join(root, 'api'), { recursive: true });
        await writeFile(join(moduleDir, 'index.js'), 'export const webModule = 1;\n');
        await writeFile(join(root, 'api', 'handler.js'), 'export function fetch() { return new Response("ok"); }\n');
        await writeFile(join(outside, 'handler.js'), 'export function fetch() { return new Response("leak"); }\n');
        await symlink(join(outside, 'handler.js'), join(root, 'api', 'escape.js'));
        return {
            root,
            cleanup: async () => {
                await rm(root, { recursive: true, force: true });
                await rm(outside, { recursive: true, force: true });
            },
        };
    }

    /** `boardModuleProbe`'s shape: a missing path is `false`, never a thrown ENOENT. */
    function statProbe(): BoardModuleFileProbe {
        return {
            isFile: async (path) => (await stat(path).catch(() => null))?.isFile() ?? false,
            isDirectory: async (path) => (await stat(path).catch(() => null))?.isDirectory() ?? false,
            realPath: (path) => realpathSync(path),
        };
    }

    test('a valid project-relative bundle lands on the asset root only', async () => {
        const { root, cleanup } = await apiTree();
        try {
            const prepared = await prepareBoardModules({
                projectRoot: root,
                declarations: [reactModule({ api: 'api/handler.js' })],
                host,
                probe: statProbe(),
            });
            expect(prepared.roots[0]?.apiPath).toBe(join(root, 'api', 'handler.js'));
            expect(prepared.catalog.modules[0]).toMatchObject({ id: 'kanban', type: 'react' });
            expect(JSON.stringify(prepared.catalog)).not.toContain(root);
        } finally {
            await cleanup();
        }
    });

    test('modules sharing one bundle each resolve the same api path', async () => {
        const { root, cleanup } = await apiTree();
        try {
            const second = join(root, 'board', 'notes');
            await mkdir(second, { recursive: true });
            await writeFile(join(second, 'index.js'), 'export const webModule = 2;\n');
            const prepared = await prepareBoardModules({
                projectRoot: root,
                declarations: [
                    reactModule({ api: 'api/handler.js' }),
                    reactModule({ id: 'notes', directory: 'board/notes', api: 'api/handler.js' }),
                ],
                host,
                probe: statProbe(),
            });
            expect(prepared.roots.map((entry) => entry.apiPath)).toEqual([
                join(root, 'api', 'handler.js'),
                join(root, 'api', 'handler.js'),
            ]);
        } finally {
            await cleanup();
        }
    });

    test.each([
        ['an absolute path', join('ABS', 'handler.js'), 'must be relative to the project root'],
        ['a lexical escape', '../outside.js', 'escapes the project root'],
        ['a missing bundle', 'api/missing.js', 'was not found in the project root'],
        ['an escaping symlink', 'api/escape.js', 'resolves outside the project root'],
    ])('%s fails closed naming the module and the reason', async (_label, api, reason) => {
        const { root, cleanup } = await apiTree();
        try {
            const declared = api.startsWith('ABS') ? join(root, 'api', 'handler.js') : api;
            const error = await prepareBoardModules({
                projectRoot: root,
                declarations: [reactModule({ api: declared })],
                host,
                probe: statProbe(),
            }).catch((thrown: unknown) => thrown);
            expect(error).toBeInstanceOf(BoardModuleConfigError);
            expect((error as Error).message).toContain('"kanban"');
            expect((error as Error).message).toContain(reason);
        } finally {
            await cleanup();
        }
    });
});
