/**
 * Source-build entrypoint for the six release binaries (A93 1354). Thin forwarder over the shared
 * app-owned release-asset service; the names and `SHA256SUMS` format are pinned by the service's
 * tests, not re-implemented here.
 */
import { fileURLToPath } from 'node:url';
import { buildBinaries } from '@gobing-ai/spur-app/builder';

/** Repo root: scripts/commands → repo (package scripts run from a workspace cwd). */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Cross-compile every release target from this checkout. */
export async function buildReleaseBinaries(): Promise<void> {
    await buildBinaries({ sourceRoot: REPO_ROOT, cwd: REPO_ROOT });
}
