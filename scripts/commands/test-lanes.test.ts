/**
 * `test-lanes` generator seams (feature H161, task 1459 R1).
 *
 * The classifier is pure and lives in `packages/app`; this module owns the two things around it that
 * can silently destroy evidence: preserving the manifest's other sections when regenerating, and
 * keeping the scan honest about the bunfig ignore list.
 */
import { describe, expect, test } from 'bun:test';
import { renderManifest } from './test-lanes';

const entry = { path: 'apps/cli/tests/a.test.ts', reason: 'direct' as const };

describe('renderManifest', () => {
    test('preserves top-level sections it does not own', () => {
        const rendered = renderManifest([entry], {
            version: 1,
            root: { subprocess: [] },
            heavy: [{ path: 'apps/web/tests/x.heavy.test.ts' }],
        });
        expect(rendered.heavy).toEqual([{ path: 'apps/web/tests/x.heavy.test.ts' }]);
        expect(rendered.root.subprocess).toEqual([entry]);
    });

    test('starts a manifest when none is committed', () => {
        expect(renderManifest([entry], undefined)).toEqual({ version: 1, root: { subprocess: [entry] } });
    });
});
