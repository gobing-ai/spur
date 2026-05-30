import cloudflare from '@astrojs/cloudflare';
import { defineConfig } from 'astro/config';

export default defineConfig({
    output: 'server',
    adapter: cloudflare(),
    vite: {
        server: {
            proxy: {
                '/api': 'http://localhost:3000',
                '/openapi.json': 'http://localhost:3000',
            },
        },
    },
});
