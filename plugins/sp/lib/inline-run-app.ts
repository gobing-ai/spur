/**
 * Stale-bundle guard for inline-run scripts (1120).
 *
 * WHY: `superskill install sp` stages `lib/*.generated.mjs` bundles that can lag
 * the installed scripts after a release refresh; the first missing export then
 * surfaces as a bare `app.readInstalledInventory is not a function`. This helper
 * names the skew (bundle path, missing exports, both remedies) instead. Covers the
 * installed portable bundle only — source entries (`--spur-bin`) keep their exact
 * previous behavior (0809 delegate fixtures load minimal partial source modules).
 */

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolve the application entry an inline-run script should load (task 1177 R1: one resolution for
 * setup and dispatch, which each carried their own copy).
 *
 * `--spur-bin` pointing at a repo checkout selects the source app entry (`portable: false`, and the
 * stale-bundle export check is skipped — source fixtures load partial modules). Anything else uses
 * the staged generated bundle and is `portable: true`, so a bundle older than its scripts is named
 * instead of failing as a bare `is not a function`.
 */
export function resolveAppEntry(spurBin: string): { entry: string; portable: boolean } {
    const fallback = fileURLToPath(new URL('../../../apps/cli/src/index.ts', import.meta.url));
    const candidates = spurBin !== '' ? [spurBin] : [fallback];
    for (const candidate of candidates) {
        const tokens = candidate.split(/\s+/).filter(Boolean);
        // Main module = last path-like token; only a .ts source entry proves a repo checkout.
        const mainModule = [...tokens].reverse().find((t) => t.endsWith('.ts'));
        if (mainModule === undefined || !existsSync(mainModule)) continue;
        const repoRoot = resolve(dirname(mainModule), '..', '..', '..');
        const appEntry = join(repoRoot, 'packages', 'app', 'src', 'index.ts');
        if (existsSync(appEntry)) return { entry: appEntry, portable: false };
    }
    const entry = fileURLToPath(new URL('./inline-run.generated.mjs', import.meta.url));
    if (!existsSync(entry)) {
        throw new Error('inline application bundle is missing — rebuild/install the sp plugin before running inline');
    }
    return { entry, portable: true };
}

export async function loadInlineApp<T extends object>(
    spurBin: string,
    resolveAppEntry: (spurBin: string) => { entry: string; portable: boolean },
    required: readonly (keyof T)[],
): Promise<{ app: T; portable: boolean }> {
    const { entry, portable } = resolveAppEntry(spurBin);
    const app = (await import(entry)) as T;
    const missing = portable ? required.filter((name) => typeof app[name] !== 'function') : [];
    if (missing.length > 0) {
        throw new Error(
            `inline application bundle ${entry} is older than its scripts — missing ${missing.join(', ')}. ` +
                'Reinstall sp with a superskill release that stages lib/ (commit b42961b), or pass ' +
                '--spur-bin <spur checkout>/apps/cli/src/index.ts.',
        );
    }
    return { app, portable };
}
