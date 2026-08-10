/**
 * Unit coverage for the pre-publish version-drift guard (task 0500 R6).
 *
 * The guard must fail when marketplace/plugin versions differ from the CLI
 * package version, because the packed tarball would then advertise a stale
 * plugin version to superskill/Claude Code. Release keeps these in lockstep via
 * syncMarketplaceAndPlugins; the guard catches drift that slips through.
 */
import { describe, expect, test } from 'bun:test';

import { findMarketplaceVersionDrift, findMarketplaceVersionDriftFrom } from './check-marketplace-version';
import { verifyPackExtract } from './verify-pack';

describe('findMarketplaceVersionDrift', () => {
    test('returns empty when marketplace and plugin versions match the package', async () => {
        const drift = await findMarketplaceVersionDrift();
        const pkg = JSON.parse(await Bun.file('apps/cli/package.json').text()) as { version?: string };
        expect(pkg.version).toBeDefined();
        expect(drift).toEqual([]);
    });

    test('reports a marketplace plugin whose version differs from the package', () => {
        const text = JSON.stringify({ plugins: [{ name: 'sp', version: '9.9.9' }] });
        const drift = findMarketplaceVersionDriftFrom(text, '0.3.41', '0.3.41');
        expect(drift).toEqual(['marketplace plugin "sp": 9.9.9 (package is 0.3.41)']);
    });

    test('reports a plugin.json whose version differs from the package', () => {
        const drift = findMarketplaceVersionDriftFrom('{"plugins":[]}', '0.3.42', '0.3.41');
        expect(drift).toEqual(['plugins/sp/plugin.json: 0.3.42 (package is 0.3.41)']);
    });
});

describe('verifyPackExtract', () => {
    test('rejects an extracted tree missing the marketplace manifest', async () => {
        await expect(verifyPackExtract('definitely-not-a-real-extracted-package-root')).rejects.toThrow();
    });
});
