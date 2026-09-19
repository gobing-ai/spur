import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [
        cloudflareTest({
            wrangler: { configPath: './wrangler.toml' },
            miniflare: {
                // vitest's in-worker module evaluator imports node:os; app code does not
                compatibilityFlags: ['nodejs_compat'],
                bindings: {
                    NODE_ENV: 'test',
                },
            },
        }),
    ],
    resolve: {},
    test: {
        include: ['tests/cf/**/*.cf.ts'],
    },
});
