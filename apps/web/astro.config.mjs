import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
    output: 'static',
    integrations: [react()],
    vite: {
        plugins: [tailwindcss()],
        // TEMPORARY proxy — removed in W5 (0081 unified Vite dev server).
        // Kept so `astro dev` still hits the local API during W1-W4.
        server: {
            proxy: {
                '/api': 'http://localhost:3000',
                '/openapi.json': 'http://localhost:3000',
            },
        },
    },
});
