import { afterEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGatewayHandler, type PreparedBoardModules, prepareBoardModules } from '@gobing-ai/spur-app';
import { type BoardModuleDeclaration, projectEntrySchema } from '@gobing-ai/spur-config';
import type { BoardHostRuntime } from '@gobing-ai/spur-contracts';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { createApp } from '../src/bootstrap';
import type { ServerContext } from '../src/context';
import { splitModuleApiPath } from '../src/modules/board';
import { boardModuleProbe } from '../src/serve';

// Task 1455 R4/R5/R6 — a module's optional Web-Fetch bundle mounted at `/api/modules/<id>/*`
// inside the project's own server: rewritten dispatch, fail-closed 404s, 500 isolation,
// mtime-driven reload, and same-origin access through the gateway.

const host: BoardHostRuntime = {
    manifestVersion: 1,
    contributionApiVersion: 1,
    reactVersion: '19.0.0',
    reactDomVersion: '19.0.0',
    reactRouterVersion: '7.0.0',
    imports: { react: '/_astro/board-facade-react.js' },
    reservedModules: [],
};

/** One handler bundle: echoes what the server rewrote, so the dispatch contract is observable. */
const ECHO_BUNDLE = `
export function fetch(request, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/version') return Response.json({ version: 'v1' });
    if (url.pathname === '/echo') {
        return request.arrayBuffer().then((body) => Response.json({
            path: url.pathname,
            search: url.search,
            method: request.method,
            body: new TextDecoder().decode(body),
            projectPath: ctx.projectPath,
            moduleId: ctx.moduleId,
        }));
    }
    return Response.json({
        path: url.pathname,
        search: url.search,
        method: request.method,
        header: request.headers.get('x-probe'),
        projectPath: ctx.projectPath,
        moduleId: ctx.moduleId,
    });
}
`;

/** A bundle that counts its own evaluations, so a shared/uncached import is observable. */
const COUNTING_BUNDLE = `
globalThis.__spurBoardApiImports = (globalThis.__spurBoardApiImports ?? 0) + 1;
export function fetch() {
    return Response.json({ imports: globalThis.__spurBoardApiImports });
}
`;

const THROWING_BUNDLE = 'export function fetch() { throw new Error("module blew up"); }\n';
const NO_FETCH_BUNDLE = 'export const notAHandler = 1;\n';

function declaration(overrides: Partial<BoardModuleDeclaration> = {}): BoardModuleDeclaration {
    return {
        id: 'demo',
        name: 'Demo',
        icon: 'D',
        type: 'react',
        directory: 'board/demo',
        entry: 'index.js',
        styles: [],
        enabled: true,
        api: 'api/handler.js',
        ...overrides,
    } as BoardModuleDeclaration;
}

/** A project tree with one contained native module and the fixture bundles beside it. */
async function projectTree(): Promise<{ root: string; cleanup: () => Promise<void> }> {
    const root = await mkdtemp(join(tmpdir(), 'spur-board-api-1455-'));
    await mkdir(join(root, 'board', 'demo'), { recursive: true });
    await mkdir(join(root, 'api'), { recursive: true });
    await writeFile(join(root, 'board', 'demo', 'index.js'), 'export const webModule = 1;\n');
    await writeFile(join(root, 'api', 'handler.js'), ECHO_BUNDLE);
    await writeFile(join(root, 'api', 'shared.js'), COUNTING_BUNDLE);
    await writeFile(join(root, 'api', 'throwing.js'), THROWING_BUNDLE);
    await writeFile(join(root, 'api', 'no-fetch.js'), NO_FETCH_BUNDLE);
    return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

async function prepare(root: string, declarations: readonly BoardModuleDeclaration[]): Promise<PreparedBoardModules> {
    return prepareBoardModules({
        projectRoot: root,
        declarations,
        host,
        probe: boardModuleProbe(createNodeFileSystem(root)),
    });
}

/** The shipped app with a prepared module snapshot — the same wiring `serve.ts` performs. */
function appWith(root: string, prepared: PreparedBoardModules) {
    return createApp(undefined, {
        ctx: {
            cwd: root,
            webDistPath: join(import.meta.dir, 'fixtures', 'web-dist'),
            boardModules: prepared,
            fs: createNodeFileSystem(root),
            logger: { warn: () => {}, info: () => {}, error: () => {}, debug: () => {} },
        } as unknown as ServerContext,
    });
}

const shutdown: Array<() => void> = [];

afterEach(() => {
    for (const stop of shutdown.splice(0)) stop();
});

describe('module API path splitting (R4)', () => {
    test.each([
        ['/api/modules/demo', { id: 'demo', suffix: '' }],
        ['/api/modules/demo/', { id: 'demo', suffix: '/' }],
        ['/api/modules/demo/items', { id: 'demo', suffix: '/items' }],
        ['/api/modules/demo/a/b', { id: 'demo', suffix: '/a/b' }],
    ])('%s splits into its id and module-relative suffix', (pathname, expected) => {
        expect(splitModuleApiPath(pathname)).toEqual(expected);
    });

    test.each(['/api/modules', '/api/modules/', '/api/modules//x', '/modules/demo', '/api/board/modules'])(
        '%s is not a module API path',
        (pathname) => {
            expect(splitModuleApiPath(pathname)).toBeUndefined();
        },
    );
});

describe('module API dispatch (R4/AC4)', () => {
    test('GET dispatches a rewritten request with the query string intact', async () => {
        const { root, cleanup } = await projectTree();
        try {
            const app = appWith(root, await prepare(root, [declaration()]));
            const response = await app.request('/api/modules/demo/items?limit=5', {
                headers: { 'x-probe': 'yes' },
            });
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({
                path: '/items',
                search: '?limit=5',
                method: 'GET',
                header: 'yes',
                projectPath: root,
                moduleId: 'demo',
            });
        } finally {
            await cleanup();
        }
    });

    test('the mount root defaults to "/" for the module handler', async () => {
        const { root, cleanup } = await projectTree();
        try {
            const app = appWith(root, await prepare(root, [declaration()]));
            const body = (await (await app.request('/api/modules/demo')).json()) as { path: string };
            expect(body.path).toBe('/');
        } finally {
            await cleanup();
        }
    });

    test('POST preserves the method and the request body', async () => {
        const { root, cleanup } = await projectTree();
        try {
            const app = appWith(root, await prepare(root, [declaration()]));
            const response = await app.request('/api/modules/demo/echo?dry=1', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ action: 'sync' }),
            });
            const body = (await response.json()) as Record<string, unknown>;
            expect(body).toMatchObject({
                path: '/echo',
                search: '?dry=1',
                method: 'POST',
                body: JSON.stringify({ action: 'sync' }),
                moduleId: 'demo',
            });
        } finally {
            await cleanup();
        }
    });

    test('unknown, disabled and API-less modules all answer 404 JSON', async () => {
        const { root, cleanup } = await projectTree();
        try {
            await mkdir(join(root, 'board', 'plain'), { recursive: true });
            await writeFile(join(root, 'board', 'plain', 'index.js'), 'export const webModule = 1;\n');
            const app = appWith(
                root,
                await prepare(root, [
                    declaration(),
                    declaration({ id: 'plain', directory: 'board/plain', api: undefined }),
                    declaration({ id: 'offline', enabled: false }),
                ]),
            );
            for (const path of ['/api/modules/plain/items', '/api/modules/offline/items', '/api/modules/nope']) {
                const response = await app.request(path);
                expect(response.status).toBe(404);
                expect((await response.json()) as object).toMatchObject({ ok: false });
            }
        } finally {
            await cleanup();
        }
    });

    test('a throwing handler and a fetch-less bundle answer 500 JSON without stopping the server', async () => {
        const { root, cleanup } = await projectTree();
        try {
            const app = appWith(
                root,
                await prepare(root, [
                    declaration({ id: 'boom', api: 'api/throwing.js' }),
                    declaration({ id: 'mute', api: 'api/no-fetch.js' }),
                ]),
            );
            for (const path of ['/api/modules/boom/x', '/api/modules/mute/x']) {
                const response = await app.request(path);
                expect(response.status).toBe(500);
                expect((await response.json()) as object).toMatchObject({ ok: false });
            }
            // The server is still serving: the next request answers normally.
            expect((await app.request('/api/modules/boom/x')).status).toBe(500);
            expect((await app.request('/api/health')).status).toBe(200);
        } finally {
            await cleanup();
        }
    });

    test('a symlink outside the project root introduced after startup is refused at request time', async () => {
        const { root, cleanup } = await projectTree();
        const outside = await mkdtemp(join(tmpdir(), 'spur-board-api-1455-outside-'));
        try {
            await writeFile(join(outside, 'handler.js'), ECHO_BUNDLE);
            const prepared = await prepare(root, [declaration()]);
            const app = appWith(root, prepared);
            expect((await app.request('/api/modules/demo/items')).status).toBe(200);

            await rm(join(root, 'api', 'handler.js'));
            await symlink(join(outside, 'handler.js'), join(root, 'api', 'handler.js'));
            const refused = await app.request('/api/modules/demo/items');
            expect(refused.status).toBe(404);
            expect((await refused.json()) as object).toMatchObject({ ok: false });
        } finally {
            await rm(outside, { recursive: true, force: true });
            await cleanup();
        }
    });
});

describe('module API bundle loading (R5/AC5)', () => {
    test('a rebuilt bundle takes effect on the next request', async () => {
        const { root, cleanup } = await projectTree();
        try {
            const app = appWith(root, await prepare(root, [declaration()]));
            const first = (await (await app.request('/api/modules/demo/version')).json()) as { version: string };
            expect(first.version).toBe('v1');

            const rebuilt = join(root, 'api', 'handler.js');
            await writeFile(rebuilt, ECHO_BUNDLE.replace("version: 'v1'", "version: 'v2'"));
            // A same-tick rewrite can land on the same mtime; advancing it is what a real rebuild does.
            const future = new Date(Date.now() + 5_000);
            await utimes(rebuilt, future, future);

            const second = (await (await app.request('/api/modules/demo/version')).json()) as { version: string };
            expect(second.version).toBe('v2');
        } finally {
            await cleanup();
        }
    });

    test('two modules sharing one bundle share one loaded instance', async () => {
        const { root, cleanup } = await projectTree();
        try {
            await mkdir(join(root, 'board', 'notes'), { recursive: true });
            await writeFile(join(root, 'board', 'notes', 'index.js'), 'export const webModule = 2;\n');
            delete (globalThis as Record<string, unknown>).__spurBoardApiImports;
            const app = appWith(
                root,
                await prepare(root, [
                    declaration({ api: 'api/shared.js' }),
                    declaration({ id: 'notes', directory: 'board/notes', api: 'api/shared.js' }),
                ]),
            );
            const first = (await (await app.request('/api/modules/demo/version')).json()) as { imports: number };
            const second = (await (await app.request('/api/modules/notes/version')).json()) as { imports: number };
            expect(first.imports).toBe(1);
            expect(second.imports).toBe(1);
        } finally {
            await cleanup();
        }
    });
});

describe('module API through the gateway (R6/AC6)', () => {
    test('GET and POST reach the module handler same-origin with no CORS setup', async () => {
        const { root, cleanup } = await projectTree();
        const upstream = Bun.serve({ port: 0, fetch: appWith(root, await prepare(root, [declaration()])).fetch });
        shutdown.push(() => upstream.stop(true));
        try {
            const project = projectEntrySchema.parse({ name: 'proj', path: root });
            const handler = createGatewayHandler({
                port: 3999,
                listProjects: async () => [project],
                ensureUpstream: async () => upstream.port ?? 0,
            });

            const got = await handler(new Request('http://gw.test/proj/api/modules/demo/items?limit=5'));
            expect(got.status).toBe(200);
            const gotBody = (await got.json()) as Record<string, unknown>;
            expect(gotBody).toMatchObject({ path: '/items', search: '?limit=5', moduleId: 'demo', projectPath: root });
            // No CORS header was configured anywhere on this path.
            expect(got.headers.get('access-control-allow-origin')).toBeNull();

            const posted = await handler(
                new Request('http://gw.test/proj/api/modules/demo/echo', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ hello: 'gateway' }),
                }),
            );
            expect(posted.status).toBe(200);
            expect((await posted.json()) as Record<string, unknown>).toMatchObject({
                path: '/echo',
                method: 'POST',
                body: JSON.stringify({ hello: 'gateway' }),
            });
        } finally {
            await cleanup();
        }
    });
});
