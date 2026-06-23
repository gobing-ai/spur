import react from '@astrojs/react';
import honoDevServer from '@hono/vite-dev-server';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

// Unified dev (W5 / 0081): one Astro/Vite dev server on one port serves the
// board (HMR) AND the Hono API in-process — no proxy, no CORS. honoDevServer
// only intercepts API routes; Astro owns everything else (the `/` board, assets,
// HMR). `exclude` matches every path that is NOT /api or /openapi.json so the
// worker's stand-alone `/`→/api/health redirect never shadows the board.
export default defineConfig({
    output: 'static',
    integrations: [react()],
    vite: {
        resolve: {
            alias: { '@': '/src' },
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
