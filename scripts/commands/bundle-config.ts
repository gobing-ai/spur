/**
 * Source-bundle entrypoint for the checkout's `config/` tree (A93 1355).
 *
 * The implementation lives in `@gobing-ai/spur-app/builder`. This forwarder keeps the
 * `scripts/spur-dev.ts bundle-config <out>` route and every package script working without
 * importing the CLI (which needs the very generated output this step produces).
 */
import { fileURLToPath } from 'node:url';
import { bundleConfig } from '@gobing-ai/spur-app/builder';

/** Repo root: scripts/commands → repo. The FORWARDER anchors the checkout; the service takes it. */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Stage `config/` into `target`, returning the destination and the injected-schema count. */
export async function bundleConfigOutput(target: string | undefined): Promise<{ target: string; injected: number }> {
    if (!target) throw new Error('Usage: spur-dev bundle-config <dist-config-dir>');
    const result = await bundleConfig(target, { sourceRoot: REPO_ROOT });
    return { target: result.target, injected: result.injected };
}
