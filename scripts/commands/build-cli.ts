/**
 * Source-build entrypoint for the checkout's CLI (A93 1354).
 *
 * The compile implementation lives in `@gobing-ai/spur-app/builder` (compiled into every shipped
 * artifact). This module stays as the repository's *thin* forwarder so package scripts and CI keep
 * working before the CLI's generated config bundle exists — importing the whole CLI just to build it
 * would make the build depend on its own generated output. It carries no compile logic.
 */
import { fileURLToPath } from 'node:url';
import { buildCli } from '@gobing-ai/spur-app/builder';

/** Repo root: scripts/commands → repo (package scripts run from a workspace cwd). */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Compile the local `spur` binary from this checkout. */
export async function buildCliBinary(): Promise<void> {
    await buildCli({ sourceRoot: REPO_ROOT, cwd: REPO_ROOT });
}
