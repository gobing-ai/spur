import { describe, expect, test } from 'bun:test';
import {
    blockingAnchors,
    classify,
    findUncheckedBoxes,
    foldVerdict,
    locationOf,
    makeItemId,
    normalizeAnchor,
    parseDiffMarkers,
    renderReport,
    scanResiduals,
} from '../../src/services/residual-scan';

describe('makeItemId', () => {
    test('deterministic, category+location+text keyed', () => {
        const a = makeItemId('review-finding', 'src/a.ts:12', '  duplicated   logic ');
        const b = makeItemId('review-finding', 'src/a.ts:12', 'duplicated logic');
        expect(a).toBe(b);
        expect(a.startsWith('review-finding:')).toBe(true);
    });
});

describe('normalizeAnchor / locationOf', () => {
    test('range anchors collapse to line anchors', () => {
        expect(normalizeAnchor('src/a.ts:12-18')).toBe('src/a.ts:12');
        expect(normalizeAnchor('src/a.ts:12')).toBe('src/a.ts:12');
    });
    test('location cell wins, else first backticked anchor from finding', () => {
        expect(locationOf('src/a.ts:3', 'see `src/b.ts:9` first')).toBe('src/a.ts:3');
        expect(locationOf('', 'see `src/b.ts:9` first')).toBe('src/b.ts:9');
    });
});

describe('findUncheckedBoxes', () => {
    test('finds unchecked requirement and AC rows with locations', () => {
        const boxes = findUncheckedBoxes(['## Requirements', '', '- [ ] R1. Do the thing.'].join('\n'));
        expect(boxes).toHaveLength(1);
        expect(boxes[0]?.text).toContain('R1.');
    });
});

describe('classify', () => {
    test('review P4 and staging residue are advisory/housekeeping; deferred P3-like becomes deferrable', () => {
        const p3 = { category: 'review-finding' as const, location: 'a.ts:1', text: 't', priority: 'P3' };
        const p4 = { category: 'review-finding' as const, location: 'a.ts:2', text: 'u', priority: 'P4' };
        const residue = { category: 'staging-residue' as const, location: 'a.ts:3', text: 'v' };
        const [i1, i2, i3] = classify(
            [p3, p4, residue],
            [{ id: makeItemId('review-finding', 'a.ts:1', 't'), reason: 'tracked for 1007' }],
        );
        expect(i1?.class).toBe('deferrable');
        expect(i2?.class).toBe('advisory');
        expect(i3?.class).toBe('housekeeping');
    });
});

describe('scanResiduals', () => {
    test('assembles artifact and omits diff-marker claim without base sha', () => {
        const taskContent = ['## Requirements', '- [x] R1. done.'].join('\n');
        const artifact = scanResiduals({
            wbs: '1003',
            taskContent,
            addedLines: [],
            stagingResidue: [],
            deferrals: [],
            base: null,
        });
        expect(artifact.wbs).toBe('1003');
        expect(artifact.items).toHaveLength(0);
    });
});

describe('blockingAnchors / foldVerdict', () => {
    test('blocking anchors extract file:line; fold flips PASS to PARTIAL and replaces residual-sweep check', () => {
        const [b] = classify([{ category: 'unchecked-box' as const, location: 'docs/tasks5/t.md:5', text: 'R2' }], []);
        expect(b?.class).toBe('blocking');
        expect(blockingAnchors([b as NonNullable<typeof b>])).toEqual(['docs/tasks5/t.md:5']);

        const verdict = { verdict: 'PASS', checks: [{ name: 'residual-sweep', status: 'pass', evidence: 'old' }] };
        const scan = scanResiduals({
            wbs: '1003',
            taskContent: ['## Requirements', '- [ ] R9. pending.'].join('\n'),
            addedLines: [],
            stagingResidue: [],
            deferrals: [],
            base: null,
        });
        const folded = foldVerdict(verdict, scan, 'pre-existing src/x.ts:1 ');
        expect(folded.verdict).toBe('PARTIAL');
        expect(folded.checks.find((c) => c.name === 'residual-sweep')?.status).toBe('fail');
        expect(folded.findings).toContain('src/x.ts:1');
    });

    test('PASS with zero blocking stays PASS and check flips to pass', () => {
        const verdict = { verdict: 'PASS', checks: [{ name: 'residual-sweep', status: 'fail', evidence: 'old' }] };
        const scan = scanResiduals({
            wbs: '1003',
            taskContent: '## Requirements',
            addedLines: [],
            stagingResidue: [],
            deferrals: [],
            base: null,
        });
        expect(foldVerdict(verdict, scan, '').verdict).toBe('PASS');
    });
});

describe('parseReviewFindings (via scanResiduals inputs)', () => {
    const task = [
        '## 9001. Fixture',
        '',
        '### Requirements',
        '',
        '- [x] R1. Done thing.',
        '',
        '### Review',
        '',
        '| Priority | Location | Finding | Disposition |',
        '| --- | --- | --- | --- |',
        '| P1 | `src/a.ts:12` | duplicated logic |',
        '| P3 | `src/b.ts:3` | deferred polish | Deferred — follow-up task 9999 |',
        '| P3 |  | none found |  |',
        '| P1 | `src/c.ts:1` | already fixed | Fixed |',
        '',
        '### Acceptance Criteria',
        '',
        '| Item | Detail |',
        '| --- | --- |',
        '| x | y |',
        '',
    ].join('\n');

    test('open + deferred findings kept; none/resolved dropped', () => {
        const scan = scanResiduals({
            wbs: '9001',
            base: null,
            taskContent: task,
            addedLines: [],
            stagingResidue: [],
            deferrals: [],
        });
        const review = scan.items.filter((i) => i.category === 'review-finding');
        expect(review).toHaveLength(2);
        expect(review[0]?.text).toBe('duplicated logic');
        expect(review[1]?.text).toBe('deferred polish');
        expect(review[1]?.class).toBe('deferrable');
    });

    test('a non-Priority table in the Review section is skipped', () => {
        const only = task.replace(
            /\| Priority[^\n]*\n/,
            '| Item | Detail |\n| --- | --- |\n| a | b |\n\n| Priority | Location | Finding | Disposition |\n',
        );
        const scan = scanResiduals({
            wbs: '9001',
            base: null,
            taskContent: only,
            addedLines: [],
            stagingResidue: [],
            deferrals: [],
        });
        expect(scan.items.filter((i) => i.category === 'review-finding')).toHaveLength(2);
    });
});

describe('parseDiffMarkers', () => {
    test('excluded paths, allow pragma, and non-markers are filtered', () => {
        const markers = parseDiffMarkers([
            { file: 'src/a.ts', line: 1, text: '// TODO: fix' },
            { file: 'docs/features/generated.ts', line: 2, text: '// TODO: ok' },
            { file: 'src/b.ts', line: 3, text: '// TODO: ok residual-scan:allow' },
            { file: 'src/c.ts', line: 4, text: '// clean line' },
        ]);
        expect(markers).toHaveLength(1);
        expect(markers[0]?.location).toBe('src/a.ts:1');
    });
});

describe('scanResiduals full inputs', () => {
    test('review rows, diff markers, unchecked boxes, staging residue, and deferrals combine', () => {
        const task = [
            '### Requirements',
            '',
            '- [ ] R1. Open thing.',
            '',
            '### Review',
            '',
            '| Priority | Location | Finding | Disposition |',
            '| --- | --- | --- | --- |',
            '| P1 | `src/a.ts:12` | duplicated logic |',
            '',
        ].join('\n');
        const scan = scanResiduals({
            wbs: '9001',
            base: 'abc123',
            taskContent: task,
            addedLines: [{ file: 'src/a.ts', line: 20, text: '// FIXME: hack' }],
            stagingResidue: ['untracked stray.ts'],
            deferrals: [{ id: makeItemId('diff-marker', 'src/a.ts:20', '// FIXME: hack'), reason: 'known deferral' }],
        });
        const categories = new Set(scan.items.map((i) => i.category));
        expect(categories.has('review-finding')).toBe(true);
        expect(categories.has('diff-marker')).toBe(true);
        expect(categories.has('unchecked-box')).toBe(true);
        expect(categories.has('staging-residue')).toBe(true);
        expect(scan.scanned['diff-marker']).toBe(true);
        expect(scan.counts.deferrable).toBeGreaterThanOrEqual(1);
        expect(scan.wbs).toBe('9001');
        expect(scan.base).toBe('abc123');
    });
});

describe('renderReport', () => {
    test('renders header and escapes pipes in text', () => {
        const report = renderReport(
            '9001',
            [{ id: 'x', category: 'review-finding', class: 'blocking', location: 'src/a.ts:12', text: 'a|b' }],
            2,
        );
        expect(report).toContain('# Residual report — 9001');
        expect(report).toContain('Attempt: 2');
        expect(report).toContain('| review-finding | blocking | src/a.ts:12 | a\\|b |');
    });
});
