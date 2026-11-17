import react from '@astrojs/react';
import honoDevServer from '@hono/vite-dev-server';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import { boardRuntime } from './scripts/board-runtime';

// Unified dev (W5 / 0081): one Astro/Vite dev server on one port serves the
// board (HMR) AND the Hono API in-process — no proxy, no CORS. honoDevServer
// only intercepts API routes; Astro owns everything else (the `/` board, assets,
// HMR). `exclude` matches every path that is NOT /api or /openapi.json so the
// worker's stand-alone `/`→/api/health redirect never shadows the board.
export default defineConfig({
    output: 'static',
    integrations: [react(), boardRuntime()],
    vite: {
        resolve: {
            alias: {
                '@': '/src',
                // The Board resolves the UI-kit specifier to its own kit module, so the facade plugin
                // sees a client-graph id instead of an unexternalized bare specifier (ADR-150).
                '@gobing-ai/spur/board/ui': '/src/components/module-kit/index.ts',
            },
        },
        // B2 (feature K4): under the project gateway the Board is mounted at `/<prefix>/`, so chunk
        // and preload URLs must stay relative instead of the default root-absolute `"/" + file`.
        // HTML keeps root-absolute URLs — the gateway rebases those (task 1360); rewriting JS bytes
        // at the edge is the alternative this avoids.
        experimental: {
            renderBuiltUrl(_filename, { hostType }) {
                return hostType === 'html' ? undefined : { relative: true };
            },
        },
        plugins: [
            tailwindcss(),
            honoDevServer({
                entry: '../server/src/worker.ts',
                exclude: [/^(?!\/api(\/|$)|\/openapi\.json$).*/],
            }),
        ],
    },
});
