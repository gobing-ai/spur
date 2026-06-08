/**
 * Copy the repo-root `config/` tree into a package's `dist/config/` for the npm
 * tarball, excluding assets that are not real config: rule-engine test fixtures
 * (`rules/fixtures/`), OS junk (`.DS_Store`), and editor temp files. The CLI's
 * `seedGlobalConfig` only ever reads `.yaml`/`.json`, so shipping `.ts` fixtures
 * would bloat the tarball without ever being used.
 */
import { cp, rm } from 'node:fs/promises';

const SOURCE = new URL('../../config', import.meta.url).pathname;

// Skip anything that is not a shippable config asset. `cp`'s filter runs per
// entry: returning false prunes the entry (and, for a directory, its subtree).
const EXCLUDE = /(^|\/)(\.DS_Store|fixtures)($|\/)/;

/** Bundle `config/` into `target`, excluding fixtures and OS junk. */
export async function bundleConfig(target: string | undefined): Promise<void> {
    if (!target) {
        throw new Error('Usage: spur-dev bundle-config <dist-config-dir>');
    }
    await rm(target, { recursive: true, force: true });
    await cp(SOURCE, target, {
        recursive: true,
        filter: (src) => !EXCLUDE.test(src.slice(SOURCE.length)),
    });
    console.log(`Bundled config -> ${target} (fixtures and OS junk excluded)`);
}
