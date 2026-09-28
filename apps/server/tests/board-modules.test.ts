import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareBoardModules } from '@gobing-ai/spur-app';
import { BoardModuleConfigError, type BoardModuleDeclaration, boardModuleRoute } from '@gobing-ai/spur-config';
import type { BoardHostRuntime } from '@gobing-ai/spur-contracts';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { createApp } from '../src/bootstrap';
import type { ServerContext } from '../src/context';
import { boardModuleProbe, readBoardHostRuntime } from '../src/serve';

// Task 0989 R3/R4/R5/R6 — the serve-path halves of the catalog deliverable:
// already-validated declarations become one frozen per-server snapshot, that snapshot answers
// the read-only procedure, and the asset mount refuses everything outside a declared tree.

const fixtureDist = join(import.meta.dir, 'fixtures', 'web-dist');

/** Host distribution facts, as `board-runtime.json` would supply them. */
const host: BoardHostRuntime = {
    manifestVersion: 1,
    contributionApiVersion: 1,
    reactVersion: '19.0.0',
    reactDomVersion: '19.0.0',
    reactRouterVersion: '7.0.0',
    imports: { react: '/_astro/board-facade-react.js' },
    reservedModules: [{ id: 'workspace', route: '/board/projects', retired: true, redirectTo: '/board/projects' }],
};

/** Declarations the config layer would have produced for one enabled native module. */
function declarations(overrides: Partial<BoardModuleDeclaration> = {}): BoardModuleDeclaration[] {
    return [
        {
            id: 'kanban',
            name: 'Kanban',
            icon: 'K',
            type: 'react',
            directory: 'board/kanban',
            entry: 'index.js',
            styles: ['app.css'],
            enabled: true,
            ...overrides,
        } as BoardModuleDeclaration,
    ];
}

/** A project tree with one declared module, an undeclared sibling and an escape target. */
async function projectTree(): Promise<{ root: string; cleanup: () => Promise<void> }> {
    const root = await mkdtemp(join(tmpdir(), 'spur-board-0989-'));
    const moduleDir = join(root, 'board', 'kanban');
    await mkdir(moduleDir, { recursive: true });
    await writeFile(join(moduleDir, 'index.js'), 'export const webModule = 1;\n');
    await writeFile(join(moduleDir, 'app.css'), '.kanban{}\n');
    await writeFile(join(root, 'outside.js'), 'export const secret = 1;\n');
    await symlink(join(root, 'outside.js'), join(moduleDir, 'escape.js'));
    const disabledDir = join(root, 'board', 'disabled');
    await mkdir(disabledDir, { recursive: true });
    await writeFile(join(disabledDir, 'index.js'), 'throw new Error("disabled module must never load");\n');
    return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/** The same ts-runtime seam `serve.ts` injects, so the test exercises the shipped probe shape. */
async function prepare(root: string, list: readonly BoardModuleDeclaration[], runtime: BoardHostRuntime | null = host) {
    const fs = createNodeFileSystem(root);
    return prepareBoardModules({
        projectRoot: root,
        declarations: list,
        host: runtime,
        probe: {
            isFile: async (path: string) => (await fs.stat(path))?.isFile() ?? false,
            isDirectory: async (path: string) => (await fs.stat(path))?.isDirectory() ?? false,
            realPath: (path: string) => {
                try {
                    return fs.realPath?.(path);
                } catch {
                    return undefined;
                }
            },
        },
    });
}

function appWith(
    prepared: Awaited<ReturnType<typeof prepare>>,
    projectRoot = prepared.roots[0]?.root ?? process.cwd(),
) {
    return createApp(undefined, {
        ctx: {
            webDistPath: fixtureDist,
            boardModules: prepared,
            fs: createNodeFileSystem(projectRoot),
        } as unknown as ServerContext,
    });
}

describe('project module catalog (R4)', () => {
    test('GET /api/board/modules returns the startup snapshot without filesystem roots', async () => {
        const { root, cleanup } = await projectTree();
        try {
            const prepared = await prepare(root, declarations());
            const body = (await (await appWith(prepared).request('/api/board/modules')).json()) as Record<
                string,
                unknown
            >;

            expect(body.catalogVersion).toBe(1);
            expect(body.host).toMatchObject({ contributionApiVersion: 1, reactVersion: '19.0.0' });
            expect(body.modules).toEqual([
                {
                    id: 'kanban',
                    name: 'Kanban',
                    icon: 'K',
                    type: 'react',
                    route: '/modules/kanban',
                    entryUrl: '/modules/kanban/index.js',
                    styles: ['/modules/kanban/app.css'],
                },
            ]);
            // R4: no project-relative or absolute path reaches the wire.
            expect(JSON.stringify(body)).not.toContain(root);
            expect(JSON.stringify(body)).not.toContain('board/kanban');
        } finally {
            await cleanup();
        }
    });

    test('an iframe declaration is published by its frame source (R1/R4)', async () => {
        const { root, cleanup } = await projectTree();
        try {
            const prepared = await prepare(root, [
                {
                    id: 'docs',
                    name: 'Docs',
                    icon: 'D',
                    type: 'iframe',
                    url: 'https://docs.example.com/board',
                    enabled: true,
                },
            ]);
            const body = (await (await appWith(prepared).request('/api/board/modules')).json()) as {
                modules: Record<string, unknown>[];
            };
            expect(body.modules[0]).toMatchObject({
                id: 'docs',
                type: 'iframe',
                url: 'https://docs.example.com/board',
            });
        } finally {
            await cleanup();
        }
    });

    test('disabled declarations are absent and require no files or code (R3/AC2)', async () => {
        const { root, cleanup } = await projectTree();
        try {
            const prepared = await prepare(root, [
                ...declarations(),
                {
                    id: 'offline',
                    name: 'Offline',
                    icon: 'O',
                    type: 'react',
                    directory: 'board/missing-entirely',
                    entry: 'index.js',
                    styles: [],
                    enabled: false,
                } as BoardModuleDeclaration,
            ]);
            expect(prepared.catalog.modules.map((module) => module.id)).toEqual(['kanban']);
            expect(prepared.roots.map((entry) => entry.id)).toEqual(['kanban']);
            const res = await appWith(prepared).request('/modules/offline/index.js');
            expect(res.status).toBe(404);
        } finally {
            await cleanup();
        }
    });

    test('host runtime facts are exposed as declared when a distribution is installed', async () => {
        const { root, cleanup } = await projectTree();
        try {
            const prepared = await prepare(root, declarations());
            expect(prepared.catalog.host?.reservedModules).toEqual(host.reservedModules);
        } finally {
            await cleanup();
        }
    });

    test('standalone serving answers a valid empty catalog (R6)', async () => {
        const app = createApp(undefined, { ctx: { webDistPath: fixtureDist } as unknown as ServerContext });
        const body = (await (await app.request('/api/board/modules')).json()) as Record<string, unknown>;
        expect(body).toEqual({ catalogVersion: 1, host: null, modules: [] });
    });

    test('the catalog is in the generated OpenAPI document (R4)', async () => {
        const app = createApp(undefined, { ctx: { webDistPath: fixtureDist } as unknown as ServerContext });
        const spec = (await (await app.request('/openapi.json')).json()) as { paths: Record<string, unknown> };
        expect(Object.keys(spec.paths)).toContain('/board/modules');
    });
});

describe('declared module asset serving (R5/AC3)', () => {
    test('a declared asset is served with its real MIME type and no-store', async () => {
        const { root, cleanup } = await projectTree();
        try {
            const res = await appWith(await prepare(root, declarations())).request('/modules/kanban/index.js');
            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toContain('javascript');
            expect(res.headers.get('cache-control')).toBe('no-store');
            expect(await res.text()).toContain('webModule');
        } finally {
            await cleanup();
        }
    });

    test('a missing asset is a real 404, never the SPA document', async () => {
        const { root, cleanup } = await projectTree();
        try {
            const res = await appWith(await prepare(root, declarations())).request('/modules/kanban/nope.js');
            expect(res.status).toBe(404);
            expect(res.headers.get('content-type')).not.toContain('html');
            expect(await res.text()).not.toContain('Stub Board');
        } finally {
            await cleanup();
        }
    });

    test('the module deep route still reaches the SPA fallback', async () => {
        const { root, cleanup } = await projectTree();
        try {
            const res = await appWith(await prepare(root, declarations())).request('/modules/kanban');
            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toContain('text/html');
        } finally {
            await cleanup();
        }
    });

    test('traversal, malformed encoding and symlink escape are refused', async () => {
        const { root, cleanup } = await projectTree();
        try {
            const app = appWith(await prepare(root, declarations()));
            expect((await app.request('/modules/kanban/%2e%2e%2foutside.js')).status).toBe(403);
            expect((await app.request('/modules/kanban/%zz.js')).status).toBe(400);
            expect((await app.request('/modules/kanban/escape.js')).status).toBe(403);
        } finally {
            await cleanup();
        }
    });

    test('an undeclared root is indistinguishable from a missing one', async () => {
        const { root, cleanup } = await projectTree();
        try {
            const app = appWith(await prepare(root, []));
            expect((await app.request('/modules/kanban/index.js')).status).toBe(404);
        } finally {
            await cleanup();
        }
    });
});

describe('startup failures and restart semantics (R6/AC1/AC5)', () => {
    test('a missing enabled asset names the declaration, id and reason', async () => {
        const { root, cleanup } = await projectTree();
        try {
            await rm(join(root, 'board', 'kanban', 'index.js'));
            const failure = prepare(root, declarations()).catch((error: unknown) => error);
            const error = await failure;
            expect(error).toBeInstanceOf(BoardModuleConfigError);
            expect((error as Error).message).toContain('bootstrap.modules[0]');
            expect((error as Error).message).toContain('kanban');
            expect((error as Error).message).toContain('was not found');
        } finally {
            await cleanup();
        }
    });

    test('an enabled contribution without a distribution fails instead of rendering nothing', async () => {
        const { root, cleanup } = await projectTree();
        try {
            const error = await prepare(root, declarations(), null).catch((value: unknown) => value);
            expect(error).toBeInstanceOf(BoardModuleConfigError);
            expect((error as Error).message).toContain('no Board distribution is installed');
        } finally {
            await cleanup();
        }
    });

    test('an incompatible distribution version is refused', async () => {
        const { root, cleanup } = await projectTree();
        try {
            const error = await prepare(root, declarations(), { ...host, contributionApiVersion: 2 }).catch(
                (value: unknown) => value,
            );
            expect(error).toBeInstanceOf(BoardModuleConfigError);
            expect((error as Error).message).toContain('contribution api v2');
        } finally {
            await cleanup();
        }
    });

    test('the catalog stays the startup snapshot when the declaration changes on disk (AC5)', async () => {
        const { root, cleanup } = await projectTree();
        try {
            const app = appWith(await prepare(root, declarations()));
            const before = await (await app.request('/api/board/modules')).json();
            await writeFile(join(root, 'board', 'kanban', 'index.js'), 'export const webModule = 2;\n');
            const after = await (await app.request('/api/board/modules')).json();
            expect(after).toEqual(before);
        } finally {
            await cleanup();
        }
    });

    test('module routes are derived from the id, not declared', () => {
        expect(boardModuleRoute('kanban')).toBe('/modules/kanban');
    });
});

describe('serve-path runtime helpers (R3/R6)', () => {
    test('no web distribution means no host facts', async () => {
        expect(await readBoardHostRuntime(undefined, true)).toBeNull();
    });

    test('a distribution without a manifest is not a failure of its own', async () => {
        const root = await mkdtemp(join(tmpdir(), 'spur-board-dist-'));
        try {
            expect(await readBoardHostRuntime(root, false)).toBeNull();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test('the emitted manifest is read as the host descriptor', async () => {
        const root = await mkdtemp(join(tmpdir(), 'spur-board-dist-'));
        try {
            await writeFile(join(root, 'board-runtime.json'), JSON.stringify(host));
            expect(await readBoardHostRuntime(root, true)).toEqual(host);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test('an unreadable manifest fails only when the project declared contributions', async () => {
        const root = await mkdtemp(join(tmpdir(), 'spur-board-dist-'));
        try {
            await writeFile(join(root, 'board-runtime.json'), '{ not json');
            await expect(readBoardHostRuntime(root, true)).rejects.toThrow(/Selected Board distribution is unusable/);
            expect(await readBoardHostRuntime(root, false)).toBeNull();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test('the probe reports existence and degrades an unresolvable real path', async () => {
        const { root, cleanup } = await projectTree();
        try {
            const probe = boardModuleProbe(createNodeFileSystem(root));
            expect(await probe.isFile(join(root, 'outside.js'))).toBe(true);
            expect(await probe.isFile(join(root, 'board', 'kanban'))).toBe(false);
            expect(await probe.isDirectory(join(root, 'board', 'kanban'))).toBe(true);
            expect(await probe.isDirectory(join(root, 'absent'))).toBe(false);
            expect(probe.realPath(join(root, 'outside.js'))).toContain('outside.js');

            const throwing = boardModuleProbe({
                stat: async () => null,
                realPath: () => {
                    throw new Error('no symlink resolution here');
                },
            } as unknown as Parameters<typeof boardModuleProbe>[0]);
            expect(throwing.realPath('/anything')).toBeUndefined();
        } finally {
            await cleanup();
        }
    });
});
