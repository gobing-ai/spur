/**
 * `test-lanes` generator seams (feature H161, task 1459 R1; spawn-cost receipt, task 1475 R1).
 *
 * The classifier is pure and lives in `packages/app`; this module owns the two things around it that
 * can silently destroy evidence: preserving the manifest's other sections when regenerating, and
 * keeping the scan honest about the bunfig ignore list. The spawn-cost receipt adds a third: the
 * before/after pair is only comparable while its sort and its child buckets are deterministic.
 */
import { describe, expect, test } from 'bun:test';
import { classifySpawnKind, emptySpawnCounts, tallySpawnLines } from './spawn-cost-preload';
import { renderManifest, renderSpawnCostReceipt, type SpawnCostRow } from './test-lanes';

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

describe('classifySpawnKind', () => {
    test('counts a CLI child as spur-cli even when bun launches it', () => {
        expect(classifySpawnKind(['bun', 'run', 'apps/cli/src/index.ts', '--json'])).toBe('spur-cli');
        expect(classifySpawnKind(['/Users/x/.bun/bin/spur', 'task', 'check', '0042'])).toBe('spur-cli');
    });

    test('separates git, bun, sh and everything else', () => {
        expect(classifySpawnKind(['git', 'init'])).toBe('git');
        expect(classifySpawnKind(['bun', 'test', 'a.test.ts'])).toBe('bun');
        expect(classifySpawnKind(['sh', '-c', 'echo hi'])).toBe('sh');
        expect(classifySpawnKind(['python3', '-V'])).toBe('other');
        expect(classifySpawnKind([])).toBe('other');
    });
});

describe('tallySpawnLines', () => {
    test('counts one line per child and treats junk as other', () => {
        const counts = tallySpawnLines([
            '{"kind":"git"}',
            '{"kind":"git"}',
            '{"kind":"spur-cli"}',
            'not json',
            '',
            '{"kind":"unknown"}',
        ]);
        expect(counts).toEqual({ 'spur-cli': 1, git: 2, bun: 0, sh: 0, other: 2 });
    });

    test('starts from a zeroed counter when no child was spawned', () => {
        expect(tallySpawnLines([])).toEqual(emptySpawnCounts());
    });
});

describe('renderSpawnCostReceipt', () => {
    const row = (path: string, wallMs: number, children = emptySpawnCounts()): SpawnCostRow => ({
        path,
        wallMs,
        testCount: 1,
        failCount: 0,
        skipCount: 0,
        exitCode: 0,
        children,
    });

    test('sorts by wall time descending, then by path', () => {
        const receipt = renderSpawnCostReceipt([row('b.test.ts', 10), row('a.test.ts', 90), row('c.test.ts', 10)], {
            generatedAt: 'now',
            cores: 10,
        });
        expect(receipt.files.map((file) => file.path)).toEqual(['a.test.ts', 'b.test.ts', 'c.test.ts']);
        expect(receipt.totals).toEqual({ files: 3, wallMs: 110, children: emptySpawnCounts() });
    });

    test('sums child counts across files by kind', () => {
        const first = row('a.test.ts', 1, { ...emptySpawnCounts(), git: 2, 'spur-cli': 1 });
        const second = row('b.test.ts', 1, { ...emptySpawnCounts(), sh: 1, 'spur-cli': 3 });
        const receipt = renderSpawnCostReceipt([first, second], { generatedAt: 'now', cores: 10 });
        expect(receipt.totals.children).toEqual({ 'spur-cli': 4, git: 2, bun: 0, sh: 1, other: 0 });
    });
});
