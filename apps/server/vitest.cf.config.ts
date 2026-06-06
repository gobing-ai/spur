import { fileURLToPath } from 'node:url';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [
        cloudflareTest({
            wrangler: { configPath: './wrangler.toml' },
            miniflare: {
                bindings: {
                    NODE_ENV: 'test',
                },
            },
        }),
    ],
    resolve: {
        alias: {
            // spur-plugin-sdk is an unbuilt workspace package: its exports map points
            // import/default at ./dist/index.js (only the `bun` condition reaches src).
            // Vite's Workers runtime ignores the `bun` condition, so alias to source.
            '@gobing-ai/spur-plugin-sdk': fileURLToPath(
                new URL('../../packages/plugin-sdk/src/index.ts', import.meta.url),
            ),
        },
    },
    test: {
        include: ['tests/cf/**/*.cf.ts'],
    },
});
