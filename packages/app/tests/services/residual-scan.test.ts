import { describe, expect, test } from 'bun:test';
import * as fsp from 'node:fs';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    blockingAnchors,
    blockingReviewFindings,
    buildReviewGateArtifact,
    classify,
    findUncheckedBoxes,
    foldVerdict,
    locationOf,
    makeItemId,
    normalizeAnchor,
    parseDeferralEntries,
    parseDiffMarkers,
    parseReviewFindings,
    parseScanArgs,
    recordedVerdictPath,
    renderReport,
    scanResiduals,
    verdictDisagreementNote,
} from '../../src/services/residual-scan';

/** Task 1065 R3: fold freshness between run and durable verdict copies. */
describe('verdict copy freshness (task 1065)', () => {
    const scratch = () => {
        const dir = mkdtempSync(join(tmpdir(), 'rs-svc-'));
        mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
        return dir;
    };
    const write = (dir: string, where: 'run' | 'durable', body: string, age = 0): string => {
        const path =
            where === 'run'
                ? join(dir, '.spur', 'run', '1065-verdict.json')
                : join(dir, '.spur', 'memory', 'evidence', '1065-verdict.json');
        mkdirSync(join(path, '..'), { recursive: true });
        writeFileSync(path, body);
        const t = new Date(Date.now() - age * 1000);
        utimesSync(path, t, t);
        return path;
    };
    const PASS = '{"verdict":"PASS","checks":[]}\n';
    const PARTIAL = '{"verdict":"PARTIAL","checks":[]}\n';

    test('newer copy wins; single copies short-circuit (R1)', () => {
        const dir = scratch();
        try {
            const runDir = join(dir, '.spur', 'run');
            const runCopy = join(runDir, '1065-verdict.json');
            const durableCopy = join(dir, '.spur', 'memory', 'evidence', '1065-verdict.json');
            expect(recordedVerdictPath(runDir, '1065', fsp)).toBe(runCopy);
            write(dir, 'durable', PARTIAL, 30);
            expect(recordedVerdictPath(runDir, '1065', fsp)).toBe(durableCopy);
            const run = write(dir, 'run', PASS, 0);
            expect(recordedVerdictPath(runDir, '1065', fsp)).toBe(run); // fresh run beats stale durable
            utimesSync(durableCopy, new Date(Date.now() + 60_000), new Date(Date.now() + 60_000));
            expect(recordedVerdictPath(runDir, '1065', fsp)).toBe(durableCopy); // genuinely newer durable wins
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('disagreement note names both copies and the winner; quiet when equal or absent (R2/R3c)', () => {
        const dir = scratch();
        try {
            const runDir = join(dir, '.spur', 'run');
            expect(verdictDisagreementNote(runDir, '1065', fsp)).toBeNull();
            write(dir, 'durable', PARTIAL, 30);
            write(dir, 'run', PASS, 0);
            const note = verdictDisagreementNote(runDir, '1065', fsp) ?? '';
            expect(note).toContain('(PASS)');
            expect(note).toContain('(PARTIAL)');
            expect(note).toContain('chose run');
            write(dir, 'durable', PASS, 0);
            expect(verdictDisagreementNote(runDir, '1065', fsp)).toBeNull(); // equal bytes
            write(dir, 'durable', PARTIAL, -60); // differing bytes + newer mtime → durable wins
            expect(verdictDisagreementNote(runDir, '1065', fsp) ?? '').toContain('chose durable');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

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

describe('review-finding parser hardening (task 1065 R4)', () => {
    const table = (row: string): string =>
        `### Review\n\n| Priority | Dimension | Location | Finding | Disposition |\n| --- | --- | --- | --- | --- |\n${row}\n`;

    test('range-priority clean-report marker rows are not findings', () => {
        const rows = parseReviewFindings(table('| P1\u2013P3 | none (clean) | \u2014 | no findings here |'));
        expect(rows).toEqual([]);
    });

    test('escaped pipe inside a finding cell keeps the disposition cell recognized', () => {
        const rows = parseReviewFindings(
            table("| P2 | shape | a.ts:1 | tuple ('paused' \\| 'held') widened | RESOLVED: loosened pre-release |"),
        );
        expect(rows).toEqual([]);
    });

    test('same row without a recognized disposition is still a finding', () => {
        const rows = parseReviewFindings(table("| P2 | shape | a.ts:1 | tuple ('paused' \\| 'held') widened | OPEN |"));
        expect(rows).toHaveLength(1);
        expect(rows[0]?.location).toContain('a.ts:1');
    });
});

/** Shared Review-section table head for the task 1122 review-gate tests. */
const gateTable = (rows: string[]): string =>
    ['### Review', '', '| Priority | Finding | Location | Disposition |', '| --- | --- | --- | --- |', ...rows].join(
        '\n',
    );

/** The plugin script's fail-closed exit decision for the review-gate mode (task 1122 R2). */
const gateExit = (counts: { blocking: number }): 0 | 1 => (counts.blocking > 0 ? 1 : 0);

describe('parseDeferralEntries (task 1122)', () => {
    test('keeps string-id entries with a non-blank reason; drops the rest and non-arrays', () => {
        // A blank string id still passes (only the reason must be non-blank); it is inert
        // downstream because classify matches deferrals by exact item id (category:hex8).
        expect(
            parseDeferralEntries([
                { id: 'review-finding:abc123', reason: 'tracked for 1100' },
                { id: '', reason: 'blank id' },
                { id: 'x', reason: '   ' },
                { id: 7, reason: 'numeric id' },
                { reason: 'missing id' },
                'junk',
                null,
            ]),
        ).toEqual([
            { id: 'review-finding:abc123', reason: 'tracked for 1100' },
            { id: '', reason: 'blank id' },
        ]);
        expect(parseDeferralEntries('not an array')).toEqual([]);
        expect(parseDeferralEntries(null)).toEqual([]);
    });
});

describe('blockingReviewFindings (task 1122 R1)', () => {
    test('open P1-P3 block; file-deferred and in-table DEFER P3s are deferrable; P4 advisory', () => {
        const content = gateTable([
            '| P1 (blocker) | Off by one | `src/b.ts:3` | OPEN |',
            '| P2 (major) | Missing validation | `src/c.ts:8` | OPEN |',
            '| P3 | Magic number | `src/a.ts:12` | OPEN |',
            '| P3 | Dead branch | `src/d.ts:4` | DEFER(post-merge regen) |',
            '| P4 (advisory) | Fuzzy name | `src/e.ts:20` | ACCEPTED |',
        ]);
        const items = blockingReviewFindings(content, [
            { id: makeItemId('review-finding', 'src/a.ts:12', 'Magic number'), reason: 'tracked for 1100' },
        ]);
        const byLocation = new Map(items.map((i) => [i.location, i]));
        expect(byLocation.get('src/b.ts:3')?.class).toBe('blocking');
        expect(byLocation.get('src/c.ts:8')?.class).toBe('blocking');
        expect(byLocation.get('src/a.ts:12')?.class).toBe('deferrable'); // file deferral entry
        expect(byLocation.get('src/d.ts:4')?.class).toBe('deferrable'); // in-table DEFER disposition
        expect(byLocation.get('src/e.ts:20')?.class).toBe('advisory'); // P4 never blocks the gate
        expect(items.every((i) => i.category === 'review-finding')).toBe(true);
    });

    test('a deferral whose reason is blank leaves the P3 blocking', () => {
        const items = blockingReviewFindings(gateTable(['| P3 | Magic number | `src/a.ts:12` | OPEN |']), [
            { id: makeItemId('review-finding', 'src/a.ts:12', 'Magic number'), reason: '   ' },
        ]);
        expect(items[0]?.class).toBe('blocking');
    });
});

describe('buildReviewGateArtifact (task 1122 R2)', () => {
    test('open P1-P3: review-only artifact, counts, note with ids+anchors, exit 1', () => {
        const content = [
            '## Requirements',
            '',
            '- [ ] R1. proven at record',
            '',
            gateTable(['| P2 (major) | Missing validation | `src/c.ts:8` | OPEN |']),
        ].join('\n');
        const gate = buildReviewGateArtifact('1122', content, []);
        expect(gate.artifact.wbs).toBe('1122');
        expect(gate.artifact.base).toBeNull();
        expect(gate.artifact.scanned).toEqual({
            'review-finding': true,
            'diff-marker': false,
            'unchecked-box': false,
            'staging-residue': false,
        });
        // Unchecked boxes are not decidable pre-record: the gate artifact stays review-only.
        expect(gate.artifact.items.map((i) => [i.category, i.class])).toEqual([['review-finding', 'blocking']]);
        expect(gate.artifact.counts).toEqual({ blocking: 1, deferrable: 0, advisory: 0, housekeeping: 0 });
        const blocking = gate.artifact.items[0];
        expect(gate.note).toBe(`residual-review-gate: 1122 blocking=1 ids=${blocking?.id} anchors=src/c.ts:8\n`);
        expect(gateExit(gate.artifact.counts)).toBe(1);
        // The payload the script writes to `.spur/run/<wbs>-residuals.json` round-trips.
        expect(JSON.parse(JSON.stringify(gate.artifact, null, 2))).toEqual(gate.artifact);
    });

    test('P4/RESOLVED/none rows: zero blocking, note without ids segment, exit 0', () => {
        const gate = buildReviewGateArtifact(
            '1122',
            gateTable([
                '| P4 (advisory) | Fuzzy name | `src/e.ts:20` | ACCEPTED |',
                '| P2 | Missing validation | `src/c.ts:8` | RESOLVED — fixed in pass |',
                '| P3 |  | none found |  |',
            ]),
            [],
        );
        expect(gate.artifact.items).toHaveLength(1);
        expect(gate.artifact.items[0]?.class).toBe('advisory');
        expect(gate.artifact.counts.blocking).toBe(0);
        expect(gate.note).toBe('residual-review-gate: 1122 blocking=0\n');
        expect(gateExit(gate.artifact.counts)).toBe(0);
    });
});

describe('parseScanArgs', () => {
    test('mode/wbs with flag overrides; defaults from cwd/defaultTmpDir', () => {
        expect(
            parseScanArgs(
                ['review-gate', '1122', '--spur-bin', 'spur', '--root', '/r', '--tmp-dir', '/t'],
                '/cwd',
                '/dtmp',
            ),
        ).toEqual({ mode: 'review-gate', wbs: '1122', spurBin: 'spur', root: '/r', tmpDir: '/t' });
        expect(parseScanArgs(['scan', '1122'], '/cwd', '/dtmp')).toEqual({
            mode: 'scan',
            wbs: '1122',
            spurBin: undefined,
            root: '/cwd',
            tmpDir: '/dtmp',
        });
    });

    test('--help/-h or missing mode/wbs return null; trailing flag falls back; undefined stops parsing', () => {
        expect(parseScanArgs(['--help'], '/cwd', '/dtmp')).toBeNull();
        expect(parseScanArgs(['-h'], '/cwd', '/dtmp')).toBeNull();
        expect(parseScanArgs([], '/cwd', '/dtmp')).toBeNull();
        expect(parseScanArgs(['scan'], '/cwd', '/dtmp')).toBeNull();
        expect(parseScanArgs(['fold', '1122', '--root'], '/cwd', '/dtmp')?.root).toBe('/cwd');
        expect(parseScanArgs(['fold', '1122', '--tmp-dir'], '/cwd', '/dtmp')?.tmpDir).toBe('/dtmp');
        expect(parseScanArgs(['fold', '1122', undefined, '--root', '/r'], '/cwd', '/dtmp')).toEqual({
            mode: 'fold',
            wbs: '1122',
            spurBin: undefined,
            root: '/cwd',
            tmpDir: '/dtmp',
        });
    });
});
