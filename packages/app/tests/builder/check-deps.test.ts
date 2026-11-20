/**
 * `check-deps` composition (A94 1411): one findings list from the stale-link and drift checks, the
 * scope contract, and the input errors the verb turns into exit 2.
 *
 * The two individual checks keep their own suites (`link-check.test.ts`,
 * `dependency-drift-check.test.ts`); this one pins the merge, the empty-scope skip, and the
 * scope-selection rule that replaced the hardcoded `@gobing-ai` prefix.
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDeps, inScope, lockKeyInScope } from '../../src/builder/check-deps';

const T0 = 1_700_000_000;

/** A project with one stale linked package and one lockfile drift. */
function scaffold(): string {
    const root = mkdtempSync(join(tmpdir(), 'spur-checkdeps-'));
    const linked = join(root, '..', `${root.split('/').pop()}-linked`);
    mkdirSync(join(linked, 'src'), { recursive: true });
    mkdirSync(join(linked, 'dist'), { recursive: true });
    writeFileSync(join(linked, 'package.json'), JSON.stringify({ version: '1.0.0', exports: './dist/index.js' }));
    writeFileSync(join(linked, 'src', 'index.ts'), 'export const a = 1;');
    writeFileSync(join(linked, 'dist', 'index.js'), 'export const a = 1;');
    utimesSync(join(linked, 'src', 'index.ts'), T0 + 500, T0 + 500);
    utimesSync(join(linked, 'dist', 'index.js'), T0, T0);

    mkdirSync(join(root, 'node_modules', '@acme'), { recursive: true });
    symlinkSync(linked, join(root, 'node_modules', '@acme', 'ui'));

    writeFileSync(
        join(root, 'bun.lock'),
        JSON.stringify({ packages: { '@acme/ui': ['@acme/ui@1.0.0'], '@acme/core': ['@acme/core@2.0.0'] } }),
    );
    mkdirSync(join(root, 'node_modules', '@acme', 'core'), { recursive: true });
    writeFileSync(join(root, 'node_modules', '@acme', 'core', 'package.json'), JSON.stringify({ version: '1.9.0' }));
    return root;
}

describe('checkDeps', () => {
    test('merges a stale link and a drift into one findings list', () => {
        const root = scaffold();
        try {
            const findings = checkDeps({ cwd: root, scope: ['@acme/*'] });
            const kinds = findings.map((finding) => `${finding.kind}:${finding.package}`).sort();
            expect(kinds).toEqual(['drift:@acme/core', 'stale-link:@acme/ui']);
            for (const finding of findings) expect(finding.detail.length).toBeGreaterThan(10);
        } finally {
            rmSync(root, { recursive: true, force: true });
            rmSync(join(root, '..', `${root.split('/').pop()}-linked`), { recursive: true, force: true });
        }
    });

    test('an empty scope reports nothing and reads no lockfile', () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-checkdeps-empty-'));
        try {
            expect(checkDeps({ cwd: root, scope: [] })).toEqual([]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('a non-empty scope without a lockfile is an input error, not a silent pass', () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-checkdeps-nolock-'));
        try {
            expect(() => checkDeps({ cwd: root, scope: ['@acme/*'] })).toThrow(/cannot read .*bun\.lock/);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('scope selection', () => {
    test('a package matches its glob and nothing else', () => {
        expect(inScope('@acme/ui', ['@acme/*'])).toBe(true);
        expect(inScope('@acme/ui', ['@other/*'])).toBe(false);
        expect(inScope('@acme/ui', ['@acme/u*'])).toBe(true);
    });

    test('a nested resolution belongs to its in-scope parent', () => {
        expect(lockKeyInScope('@acme/ui', ['@acme/*'])).toBe(true);
        // `@acme/ui/zod` is `ui`'s nested copy of `zod`; the parent decides scope.
        expect(lockKeyInScope('@acme/ui/zod', ['@acme/*'])).toBe(true);
        expect(lockKeyInScope('@other/ui/zod', ['@acme/*'])).toBe(false);
    });
});
