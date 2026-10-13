import { describe, expect, test } from 'bun:test';
import { loadInlineApp, resolveAppEntry } from '../lib/inline-run-app';

/**
 * `inline-run-app` is the entry-resolution seam every plugin script crosses before it can reach the
 * application surface (task 1177 R1: setup and dispatch share one resolution). Its two refusal
 * branches — a missing generated bundle, and a bundle OLDER than the scripts that call it — are the
 * 0.3.81–0.3.88 install-break class, so both are pinned here (task 1178 R4: the coverage gate
 * failed on 36-40/53-54 until these cases existed).
 */
describe('resolveAppEntry', () => {
    test('a non-source selector falls back to the staged generated bundle (portable)', () => {
        // No `.ts` token in the caller's spurBin (the installed-plugin shape) ⇒ portable fallback.
        const resolved = resolveAppEntry('spur');
        expect(resolved.portable).toBe(true);
        expect(resolved.entry.endsWith('inline-run.generated.mjs')).toBe(true);
    });

    test('a source checkout selector resolves the workspace app entry (non-portable)', () => {
        const entry = new URL('../lib/inline-run-app.ts', import.meta.url).pathname;
        const resolved = resolveAppEntry(`bun ${entry}`);
        expect(resolved.portable).toBe(false);
        expect(resolved.entry.endsWith('packages/app/src/index.ts')).toBe(true);
    });
});

describe('loadInlineApp', () => {
    test('a portable bundle missing a required export refuses loudly, naming the export', async () => {
        const portable = resolveAppEntry('spur');
        await expect(
            loadInlineApp<Record<string, unknown>>('spur', () => portable, ['definitelyNotAnExport']),
        ).rejects.toThrow(/is older than its scripts — missing definitelyNotAnExport/);
    });

    test('a portable bundle exposing every required export loads the application surface', async () => {
        const portable = resolveAppEntry('spur');
        const { app, portable: isPortable } = await loadInlineApp<Record<string, unknown>>('spur', () => portable, []);
        expect(isPortable).toBe(true);
        expect(Object.keys(app).length).toBeGreaterThan(0);
    });
});
