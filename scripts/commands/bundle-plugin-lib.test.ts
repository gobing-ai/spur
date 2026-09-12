import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bundleIdeaHandoffLib, bundlePluginLib } from './bundle-plugin-lib';

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

describe('bundleIdeaHandoffLib (task 0824)', () => {
    // Regeneration resolves workspace deps through the repo gate invocation (`bun test ./scripts`
    // or `bun run build:plugin-lib`); Bun's resolver quirks on the explicit single-file form.
    test('generated artifacts exist and are committed', () => {
        const mjs = join(import.meta.dir, '../../plugins/sp/lib/idea-handoff.generated.mjs');
        const dmts = join(import.meta.dir, '../../plugins/sp/lib/idea-handoff.generated.d.mts');
        expect(existsSync(mjs)).toBeTrue();
        expect(existsSync(dmts)).toBeTrue();
    });

    test('regeneration is deterministic and exports the handoff CLI entry', async () => {
        const before = readFileSync(join(import.meta.dir, '../../plugins/sp/lib/idea-handoff.generated.mjs'), 'utf8');
        const result = await bundleIdeaHandoffLib();
        expect(result.mjs.endsWith('idea-handoff.generated.mjs')).toBeTrue();
        expect(result.dmts.endsWith('idea-handoff.generated.d.mts')).toBeTrue();
        const after = readFileSync(join(import.meta.dir, '../../plugins/sp/lib/idea-handoff.generated.mjs'), 'utf8');
        expect(after).toContain('runIdeaHandoffCli');
        expect(after).toBe(before);
    });

    test('the bundle carries no truthy import.meta.main guard', () => {
        // The `import.meta.main: false` define must hold: importing the bundle (the twin does)
        // must never trigger the CLI entrypoint — the twin calls runIdeaHandoffCli itself.
        const mjs = readFileSync(join(import.meta.dir, '../../plugins/sp/lib/idea-handoff.generated.mjs'), 'utf8');
        expect(mjs).not.toContain('import.meta.main');
    });
});
