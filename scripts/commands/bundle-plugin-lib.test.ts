import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundlePluginLib } from './bundle-plugin-lib';

describe('bundle-plugin-lib (task 0669)', () => {
    test('generated artifacts exist and are committed', () => {
        const mjs = join(import.meta.dir, '../../plugins/sp/lib/artifact-digest.generated.mjs');
        const dmts = join(import.meta.dir, '../../plugins/sp/lib/artifact-digest.generated.d.mts');
        expect(existsSync(mjs)).toBeTrue();
        expect(existsSync(dmts)).toBeTrue();
    });

    test('regeneration is deterministic and exports the digest', async () => {
        const before = readFileSync(
            join(import.meta.dir, '../../plugins/sp/lib/artifact-digest.generated.mjs'),
            'utf8',
        );
        const result = await bundlePluginLib();
        expect(result.mjs.endsWith('artifact-digest.generated.mjs')).toBeTrue();
        expect(result.dmts.endsWith('artifact-digest.generated.d.mts')).toBeTrue();
        const after = readFileSync(join(import.meta.dir, '../../plugins/sp/lib/artifact-digest.generated.mjs'), 'utf8');
        expect(after).toContain('semanticArtifactDigest');
        expect(after).toBe(before);
    });
});
