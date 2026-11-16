import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Externalize EXACTLY the bare specifiers the installed Board advertises.
 *
 * `board-runtime.json` is the host's resolution promise, so reading it here means the module can
 * never externalize a specifier the Board does not serve (which would fail to load) or bundle a
 * copy of one it does (a second React instance). Install `@gobing-ai/spur` before building.
 */
function advertisedExternals(): string[] {
    // Walk up from the project the way Node resolves a dependency: the manifest ships inside the
    // installed package at `web/board-runtime.json`.
    const require = createRequire(import.meta.url);
    const searched: string[] = [];
    for (const base of [process.cwd(), dirname(require.resolve('vite'))]) {
        let dir = base;
        for (;;) {
            const candidate = join(dir, 'node_modules', '@gobing-ai', 'spur', 'web', 'board-runtime.json');
            searched.push(candidate);
            if (existsSync(candidate)) return importKeys(candidate);
            const parent = dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }
    }
    throw new Error(
        `no board-runtime.json found for @gobing-ai/spur — install the package in this project first. Looked in:\n${searched.join('\n')}`,
    );
}

/** The host's advertised bare specifiers: exactly what this build must externalize. */
function importKeys(manifestPath: string): string[] {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { imports?: Record<string, string> };
    const externals = Object.keys(manifest.imports ?? {});
    if (externals.length === 0) {
        throw new Error(`no import map in ${manifestPath} — is @gobing-ai/spur installed with a Board distribution?`);
    }
    return externals;
}

export default defineConfig({
    build: {
        target: 'es2022',
        lib: {
            entry: 'src/index.tsx',
            formats: ['es'],
            fileName: () => 'entry.js',
            cssFileName: 'style',
        },
        rollupOptions: { external: advertisedExternals() },
    },
});
