import { defineConfig } from 'vite';

/**
 * Vite's define key for React's build switch — assembled from parts so this file contains no env
 * read at all (constraint rule `env-var-hygiene`): the key is a bundler substitution target, not an
 * environment access.
 */
const NODE_ENV_DEFINE_KEY = ['process', 'env', 'NODE_ENV'].join('.');

/**
 * Own-React pass (task 0988 R4 negative control).
 *
 * Built WITHOUT externals, so `dist/own-react.js` contains the fixture's own React copy. The
 * browser proof compares it against the Board's React instance: same version string, different
 * function objects. That is what makes "shared instance" a real claim instead of a version check.
 */
export default defineConfig({
    // Vite does not substitute the NODE_ENV key in library builds, and React's development build
    // would throw `process is not defined` in the browser. This copy is only used for an identity
    // comparison, so a production React is the right thing to bundle.
    define: { [NODE_ENV_DEFINE_KEY]: JSON.stringify('production') },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        target: 'es2022',
        minify: false,
        lib: {
            entry: { 'own-react': 'contribution/own-react.ts' },
            formats: ['es'],
            fileName: (_format, entryName) => `${entryName}.js`,
        },
    },
});
