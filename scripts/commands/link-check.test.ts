/**
 * Behavioral checks for the linked-package staleness guard.
 *
 * NOTE: `scripts/` is outside the default `bun run test` roots (same as
 * `corpus-check`), so run this explicitly:
 *   bun test scripts/commands/link-check.test.ts
 *
 * The staleness comparison is the whole point of the module and its sense is
 * easy to invert (it was, once, before this test existed), so each case pins
 * the direction rather than just "returns an array".
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findStaleLinks } from './link-check';

/** Seconds since epoch — utimesSync takes seconds, not ms. */
const T0 = 1_700_000_000;

/**
 * Build a consumer repo whose node_modules/@gobing-ai/pkg symlinks to a source
 * tree, with explicit mtimes so the comparison is deterministic.
 */
function scaffold(opts: { srcAge: number; distAge: number | null; srcName?: string }): string {
    const root = mkdtempSync(join(tmpdir(), 'spur-linkcheck-'));
    const pkg = join(root, 'linked-pkg');
    mkdirSync(join(pkg, 'src'), { recursive: true });
    mkdirSync(join(pkg, 'dist'), { recursive: true });

    const srcFile = join(pkg, 'src', opts.srcName ?? 'index.ts');
    writeFileSync(srcFile, 'export const a = 1;');
    utimesSync(srcFile, opts.srcAge, opts.srcAge);

    if (opts.distAge !== null) {
        const distFile = join(pkg, 'dist', 'index.js');
        writeFileSync(distFile, 'export const a = 1;');
        utimesSync(distFile, opts.distAge, opts.distAge);
    }

    const scope = join(root, 'consumer', 'node_modules', '@gobing-ai');
    mkdirSync(scope, { recursive: true });
    symlinkSync(pkg, join(scope, 'ts-fake'));
    return join(root, 'consumer');
}

describe('findStaleLinks', () => {
    test('flags a linked package whose dist is older than its src', () => {
        const cwd = scaffold({ srcAge: T0 + 500, distAge: T0 });
        const stale = findStaleLinks(cwd);
        expect(stale).toHaveLength(1);
        expect(stale[0]?.pkg).toBe('@gobing-ai/ts-fake');
        expect(stale[0]?.src.rel).toBe('index.ts');
    });

    test('passes a linked package whose dist is newer than its src', () => {
        const cwd = scaffold({ srcAge: T0, distAge: T0 + 500 });
        expect(findStaleLinks(cwd)).toHaveLength(0);
    });

    test('passes when dist and src share an mtime (a build that just ran)', () => {
        const cwd = scaffold({ srcAge: T0, distAge: T0 });
        expect(findStaleLinks(cwd)).toHaveLength(0);
    });

    test('flags a linked package that was never built at all', () => {
        const cwd = scaffold({ srcAge: T0, distAge: null });
        const stale = findStaleLinks(cwd);
        expect(stale).toHaveLength(1);
        expect(stale[0]?.dist).toBeNull();
    });

    // Every ts-libs package builds `include: ["src/**/*.ts"]` with tests in a
    // sibling `tests/` dir, so anything under src/ IS a build input. An earlier
    // draft skipped `*.test.ts` here; that filter matched nothing real and
    // failed in the dangerous direction (missing a staleness rather than
    // over-reporting one), so a colocated test now counts like any other input.
    test('counts every src .ts as a build input, including a colocated test file', () => {
        const cwd = scaffold({ srcAge: T0 + 500, distAge: T0, srcName: 'mappers.test.ts' });
        expect(findStaleLinks(cwd)).toHaveLength(1);
    });

    test('returns empty when the consumer has no @gobing-ai scope dir', () => {
        expect(findStaleLinks(mkdtempSync(join(tmpdir(), 'spur-linkcheck-bare-')))).toHaveLength(0);
    });

    // Bun store copies are symlinks too, and these packages publish `src/`
    // alongside `dist/`, so only the escape-the-repo test separates them.
    // Their extraction mtimes are arbitrary and would false-alarm every install.
    test('ignores a Bun store copy, whose realpath stays inside node_modules', () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-linkcheck-store-'));
        const consumer = join(root, 'consumer');
        const store = join(consumer, 'node_modules', '.bun', 'ts-fake@0.1.0', 'node_modules', '@gobing-ai', 'ts-fake');
        mkdirSync(join(store, 'src'), { recursive: true });
        mkdirSync(join(store, 'dist'), { recursive: true });
        // Deliberately "stale": src newer than dist, as tarball extraction can leave it.
        const srcFile = join(store, 'src', 'index.ts');
        writeFileSync(srcFile, 'export const a = 1;');
        utimesSync(srcFile, T0 + 500, T0 + 500);
        const distFile = join(store, 'dist', 'index.js');
        writeFileSync(distFile, 'export const a = 1;');
        utimesSync(distFile, T0, T0);

        const scope = join(consumer, 'node_modules', '@gobing-ai');
        mkdirSync(scope, { recursive: true });
        symlinkSync(store, join(scope, 'ts-fake'));

        expect(findStaleLinks(consumer)).toHaveLength(0);
    });
});
