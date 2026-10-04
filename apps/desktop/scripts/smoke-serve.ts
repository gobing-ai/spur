import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEnvVars } from '@gobing-ai/spur-config';
import { findRepoRoot, resolveLayout } from '../src/layout';
import { startDesktopServer } from '../src/server-process';

/**
 * Headless smoke: spawn `bun run apps/cli/src/index.ts serve` against a temp
 * project, wait for `/api/health`, then kill the child. Does not open Electron
 * or a second database in this process.
 */
const repo = findRepoRoot(import.meta.dir);
if (!repo) throw new Error('Could not find the spur repo root (apps/cli/src/index.ts).');

const project = await mkdtemp(join(tmpdir(), 'spur-desktop-smoke-'));
let server: Awaited<ReturnType<typeof startDesktopServer>> | undefined;
try {
    const layout = resolveLayout({
        isPackaged: false,
        cwd: repo,
        execDir: join(repo, 'apps', 'desktop'),
        env: { ...getEnvVars(), SPUR_PROJECT_ROOT: project, SPUR_DESKTOP_MODE: 'dev' },
        argv: [],
    });
    server = await startDesktopServer({
        layout,
        healthTimeoutMs: 90_000,
        stdio: 'inherit',
    });
    const response = await fetch(`${server.url}/api/health`);
    const body = (await response.json()) as { status?: string };
    console.log(
        JSON.stringify({
            url: server.url,
            board: `${server.url}/board`,
            health: body.status,
            pid: server.pid,
            project,
        }),
    );
    if (body.status !== 'ok') throw new Error(`health status was ${String(body.status)}`);
} finally {
    await server?.stop();
    await rm(project, { recursive: true, force: true });
}
