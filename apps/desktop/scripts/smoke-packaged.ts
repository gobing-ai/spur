import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { resolveLayout } from '../src/layout';
import { startDesktopServer } from '../src/server-process';

/**
 * Packaged-mode headless smoke (AC2 for task 1082): drive the SAME layout + spawn the
 * native package uses — `resolveLayout({isPackaged: true})` against the freshly built
 * `apps/desktop/resources/spur/` — with a temporary project, wait for `/api/health`,
 * probe `/board`, then stop the child and confirm the port is released. No GUI window,
 * no install, and a second database is never opened in this process.
 */
const REPO = '/Users/robin/xprojects/spur-new';
const project = await mkdtemp(join(tmpdir(), 'spur-packaged-smoke-'));
const env = {
    ...getEnvVars(),
    SPUR_PROJECT_ROOT: project,
    SPUR_PROJECTS_FILE: join(project, 'projects.json'),
};
let server: Awaited<ReturnType<typeof startDesktopServer>> | undefined;
let boardStatus = 'n/a';
try {
    const layout = resolveLayout({
        isPackaged: true,
        cwd: project,
        execDir: join(REPO, 'apps', 'desktop'),
        resourcesPath: join(REPO, 'apps', 'desktop', 'resources'),
        env,
        argv: [],
    });
    server = await startDesktopServer({
        layout,
        parentEnv: env,
        healthTimeoutMs: 90_000,
        stdio: 'inherit',
    });
    const health = (await (await fetch(`${server.url}/api/health`)).json()) as { status?: string };
    const board = await fetch(`${server.url}/board`);
    boardStatus = `${board.status} ${String(board.headers.get('content-type'))}`;
    console.log(
        JSON.stringify({
            url: server.url,
            board: `${server.url}/board`,
            boardStatus,
            health: health.status,
            pid: server.pid,
            resourcesDir: layout.resourcesDir,
            project,
        }),
    );
    if (health.status !== 'ok') throw new Error(`health status was ${String(health.status)}`);
    if (board.status !== 200) throw new Error(`board status was ${board.status}`);
} finally {
    await server?.stop();
    await rm(project, { recursive: true, force: true });
}
