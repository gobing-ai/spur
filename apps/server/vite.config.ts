import build from '@hono/vite-build/cloudflare-workers';
import honoDevServer from '@hono/vite-dev-server';
import { defineConfig } from 'vite';

/**
 * Server Vite config (W5 / 0081).
 *
 * - `vite` (dev): serves the Hono worker on one port via `honoDevServer`, so
 *   `/api/*` and `/openapi.json` are handled in-process with no proxy and no
 *   CORS. The unified board+API dev experience is driven from `apps/web`
 *   (astro.config.mjs hosts the same `honoDevServer` plugin); this config is the
 *   API-only dev server and the production Cloudflare build entry.
 * - `vite build` (build:cf): bundles `src/worker.ts` for Cloudflare Workers via
 *   `@hono/vite-build`. The local Bun-binary path stays `bun build --compile`
 *   (package.json `build`) and is unaffected by Vite.
 *
 * The standalone `src/index.ts` entry remains for `spur serve` / Docker (R5);
 * Vite is dev/CF-build only.
 */
export default defineConfig({
    plugins: [honoDevServer({ entry: 'src/worker.ts' }), build({ entry: 'src/worker.ts' })],
});
