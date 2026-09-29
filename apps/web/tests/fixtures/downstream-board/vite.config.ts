import { defineConfig } from 'vite';

/**
 * Downstream module build (task 0988 R3).
 *
 * Externals are exactly the bare specifiers the installed Board advertises in
 * `board-runtime.json` — including `react/jsx-dev-runtime` for development artifacts. Everything
 * else the module imports is bundled into its own output rather than becoming an unsupported bare
 * import.
 *
 * `emptyOutDir: false` keeps `dist/own-react.js` from the companion build (the own-React pass runs
 * first); the referenced asset uses `?no-inline` because a library build inlines assets.
 *
 * `base` is the fixed test asset path the harness serves this build from: asset URLs are emitted
 * root-relative, so without it the referenced asset would point at the board's own root (a real
 * deployment supplies its published asset URL the same way).
 */
export default defineConfig({
    base: '/__test__/downstream/',
    build: {
        outDir: 'dist',
        emptyOutDir: false,
        target: 'es2022',
        minify: false,
        lib: {
            entry: {
                index: 'contribution/index.tsx',
                malformed: 'contribution/malformed.ts',
                throwing: 'contribution/throwing.ts',
            },
            formats: ['es'],
            fileName: (_format, entryName) => `${entryName}.js`,
            cssFileName: 'style',
        },
        rollupOptions: {
            external: [
                'react',
                'react/jsx-runtime',
                'react/jsx-dev-runtime',
                'react-dom',
                'react-dom/client',
                'react-router',
                'react-router/dom',
            ],
            output: {
                // The stylesheet stays at the root (the adapter loads it explicitly by URL);
                // other assets live under assets/.
                assetFileNames: (asset) =>
                    asset.names?.some((name) => name.endsWith('.css')) ? '[name][extname]' : 'assets/[name][extname]',
                chunkFileNames: '[name].js',
            },
        },
    },
});
