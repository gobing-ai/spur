/**
 * Source-bundle entrypoint for the built Board assets (A93 1355). Thin forwarder over the shared
 * app-owned service; the default `dist/web` auto-build stays with the service.
 */
import { fileURLToPath } from 'node:url';
import { bundleWeb } from '@gobing-ai/spur-app/builder';

/** Repo root: scripts/commands → repo (package scripts run from a workspace cwd). */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Copy the checkout's built board assets into `target` (default `<root>/apps/cli/web`). */
export async function bundleWebOutput(target?: string): Promise<{ source: string; target: string }> {
    const result = await bundleWeb({
        sourceRoot: REPO_ROOT,
        ...(target !== undefined ? { target } : {}),
    });
    return { source: result.source, target: result.target };
}
