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
