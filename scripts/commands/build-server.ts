/**
 * Source-build entrypoint for the standalone server (A93 1354). Thin forwarder over the shared
 * app-owned compile service; see `build-cli.ts` for why the repository keeps an entrypoint.
 */
import { fileURLToPath } from 'node:url';
import { buildServer } from '@gobing-ai/spur-app/builder';

/** Repo root: scripts/commands → repo (package scripts run from a workspace cwd). */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Compile the standalone server from this checkout. */
export async function buildServerBinary(): Promise<void> {
    await buildServer({ sourceRoot: REPO_ROOT, cwd: REPO_ROOT });
}
