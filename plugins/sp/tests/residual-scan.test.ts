import { describe, expect, test } from 'bun:test';
import * as fsp from 'node:fs';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    utimesSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    blockingAnchors,
    blockingReviewFindings,
    classify,
    collectAddedLines,
    findUncheckedBoxes,
    foldVerdict,
    listStagingResidue,
    main,
    makeItemId,
    parseDiffMarkers,
    parseReviewFindings,
    RESIDUAL_SCAN_USAGE,
    type ResidualArtifact,
    recordedVerdictPath,
    renderReport,
    scanResiduals,
} from '../scripts/residual-scan';

function scratch(prefix: string): { dir: string; cleanup: () => void } {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
    return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

function gitInit(dir: string): void {
    const run = (args: string[]) => Bun.spawnSync(['git', '-C', dir, ...args], { stdout: 'pipe', stderr: 'pipe' });
    run(['init', '-q']);
    run(['config', 'user.email', 't@t']);
    run(['config', 'user.name', 't']);
    writeFileSync(join(dir, 'base.txt'), 'kept\n');
    run(['add', '.']);
    run(['commit', '-q', '-m', 'base']);
}

function gitHead(dir: string): string {
    const r = Bun.spawnSync(['git', '-C', dir, 'rev-parse', 'HEAD'], { stdout: 'pipe' });
    return r.stdout.toString().trim();
}

const REVIEW_BOTH_ORDERS = `
### Review

| Priority | Dimension | Location | Finding |
| --- | --- | --- | --- |
| P3 | style | src/a.ts:12 | Magic number |
| none | — | — | none |
| P4 (advisory) | naming | src/a.ts:20-25 | Fuzzy name |
| P1 | correctness | \`src/b.ts:3\` | Off by one |

### Other

| # | Priority | Dimension | Finding | Location |
| --- | --- | --- | --- | --- |
| 1 | P2 | api | Missing validation | src/c.ts:8 |
`;

describe('parseReviewFindings', () => {
    test('parses both column orders, skips none rows, keeps priority suffixes', () => {
        const rows = parseReviewFindings(REVIEW_BOTH_ORDERS);
        expect(rows).toHaveLength(3);
        expect(rows[0]).toEqual({ priority: 'P3', location: 'src/a.ts:12', text: 'Magic number' });
        expect(rows[1]?.priority).toBe('P4 (advisory)');
        expect(rows[1]?.location).toBe('src/a.ts:20');
        expect(rows[2]).toEqual({ priority: 'P1', location: 'src/b.ts:3', text: 'Off by one' });
    });

    // Clean-review placeholder rows ("None found (…)") are not findings (0964 false positive);
    // full 0977 Design behavior table — unknown phrasings fail safe toward blocking.
    test('skips placeholder no-finding rows but keeps findings that start with "None"', () => {
        const rows = parseReviewFindings(
            [
                '### Review',
                '',
                '| Priority | Finding | Evidence | Disposition |',
                '| --- | --- | --- | --- |',
                // Placeholder no-finding cells (dropped).
                '| P1 | None | x | n/a |',
                '| P1 | none. | x | n/a |',
                '| P1 | None found | x | n/a |',
                '| P1 | None found (3 independent review cycles) | x | n/a |',
                '| P2 | No findings. | x | n/a |',
                '| P2 | No finding | x | n/a |',
                '| P2 | No issues found | x | n/a |',
                '| P2 | No issue | x | n/a |',
                '| P2 | — | x | n/a |',
                // Real findings (kept, text unchanged).
                '| P3 | None of the callers validate input | `src/d.ts:4` | open |',
                '| P3 | None found (x) but callers skip validation | `src/d.ts:9` | open |',
                '| P3 | No findings; see P2 | `src/d.ts:14` | open |',
                '| P3 | Nothing to report | `src/d.ts:19` | open |',
                '| P4 (advisory) | N/A | `src/d.ts:24` | open |',
            ].join('\n'),
        );
        expect(rows.map((r) => r.text)).toEqual([
            'None of the callers validate input',
            'None found (x) but callers skip validation',
            'No findings; see P2',
            'Nothing to report',
            'N/A',
        ]);
    });

    test('falls back to first backticked anchor when Location missing', () => {
        const rows = parseReviewFindings(
            '### Review\n\n| Priority | Finding |\n| --- | --- |\n| P3 | See `x/y.ts:9` |',
        );
        expect(rows[0]?.location).toBe('x/y.ts:9');
    });

    // Resolved findings must not need a hand-written deferral file (D64 0940/0942/0947).
    test('honors the disposition column: FIXED dropped, DEFER becomes an in-table deferral', () => {
        const review = [
            '### Review',
            '',
            '| ID | Priority | Finding | Disposition |',
            '| --- | --- | --- | --- |',
            '| F1 | P3 | Stamp bypassed `a.ts:1` | FIXED: runner-local reason |',
            '| F2 | P3 | Placeholders `b.ts:2` | DEFER — resolved by closing chain |',
            '| F3 | P2 | Real bug `c.ts:3` | open |',
            '',
            '| Priority | Finding | Location | Action |',
            '| --- | --- | --- | --- |',
            '| P3 | Bundle drift | `d.mjs` | RESOLVED — regenerated in main tree |',
        ].join('\n');
        const rows = parseReviewFindings(review);
        expect(rows.map((r) => r.text)).toEqual(['Placeholders `b.ts:2`', 'Real bug `c.ts:3`']);
        expect(rows[0]?.deferral).toBe('DEFER — resolved by closing chain');
        expect(rows[1]?.deferral).toBeUndefined();

        const { dir, cleanup } = scratch('rs-disp-');
        const art = scanResiduals(dir, '0998', tmpdir(), review, {});
        cleanup();
        const classes = art.items.filter((i) => i.category === 'review-finding').map((i) => [i.priority, i.class]);
        expect(classes).toEqual([
            ['P3', 'deferrable'],
            ['P2', 'blocking'],
        ]);
    });
});

describe('diff markers', () => {
    test('collects added lines with line numbers, includes untracked, excludes paths and allow pragma', () => {
        const { dir, cleanup } = scratch('rs-diff-');
        try {
            gitInit(dir);
            writeFileSync(join(dir, 'base.txt'), 'kept\nTODO pre-existing\n');
            writeFileSync(join(dir, 'new.ts'), 'export const x = 1; // FIXME now\n');
            const other = join(dir, 'other.ts');
            writeFileSync(other, 'let a = 1;\n// TODO later\n');
            const run = (args: string[]) =>
                Bun.spawnSync(['git', '-C', dir, ...args], { stdout: 'pipe', stderr: 'pipe' });
            run(['add', 'base.txt']);
            run(['commit', '-q', '-m', 't1']);
            const base = gitHead(dir);
            writeFileSync(join(dir, 'base.txt'), 'kept\nTODO pre-existing\n// TODO added-in-tracked\n');
            mkdirSync(join(dir, 'docs', 'features'), { recursive: true });
            writeFileSync(join(dir, 'docs', 'features', 'x.md'), 'TODO docs\n');
            writeFileSync(join(dir, 'allowed.ts'), '// TODO residual-scan:allow\n');
            const added = collectAddedLines(dir, base);
            const markers = parseDiffMarkers(added);
            const locs = markers.map((m) => m.location);
            expect(locs).toContain('base.txt:3');
            expect(locs).toContain('new.ts:1');
            expect(locs).toContain('other.ts:2');
            expect(locs.some((l) => l.startsWith('docs/features/'))).toBe(false);
            expect(locs).not.toContain('allowed.ts:1');
        } finally {
            cleanup();
        }
    });

    test('missing base means collectAddedLines is never called by scan (scanned flag false)', () => {
        const { dir, cleanup } = scratch('rs-nobase-');
        try {
            writeFileSync(join(dir, 't.md'), '- [ ] open\n');
            const art = scanResiduals(dir, '0999', tmpdir(), '- [ ] open\n', {});
            expect(art.scanned['diff-marker']).toBe(false);
            expect(art.base).toBeNull();
            expect(art.items.some((i) => i.category === 'diff-marker')).toBe(false);
        } finally {
            cleanup();
        }
    });
});

describe('unchecked boxes and staging residue', () => {
    test('finds unchecked boxes with line numbers', () => {
        const boxes = findUncheckedBoxes('- [x] done\n- [ ] open one\n- [ ] open two');
        expect(boxes).toHaveLength(2);
        expect(boxes[0]).toEqual({ location: 'task-file:2', text: '- [ ] open one' });
    });

    test('lists only regular files with wbs prefix', () => {
        const dir = mkdtempSync(join(tmpdir(), 'rs-tmp-'));
        try {
            writeFileSync(join(dir, '0949-a.txt'), '');
            mkdirSync(join(dir, '0949-dir'));
            writeFileSync(join(dir, '0950-b.txt'), '');
            expect(listStagingResidue(dir, '0949')).toEqual([join(dir, '0949-a.txt')]);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('classification', () => {
    const mk = (category: ResidualArtifact['items'][number]['category'], priority?: string) => ({
        category,
        priority,
        location: 'src/x.ts:1',
        text: 'thing',
    });

    test('P1/P2 findings and unchecked boxes are never deferrable; P3/diff-marker are', () => {
        const items = [
            mk('review-finding', 'P1'),
            mk('review-finding', 'P2'),
            mk('review-finding', 'P3'),
            mk('diff-marker'),
            mk('unchecked-box'),
            mk('staging-residue'),
        ];
        const ids = items.map((i) => makeItemId(i.category, i.location, i.text));
        const deferrals = ids.slice(0, 5).map((id) => ({ id, reason: 'post-merge regen' }));
        const out = classify(items, deferrals);
        expect(out.map((i) => i.class)).toEqual([
            'blocking',
            'blocking',
            'deferrable',
            'deferrable',
            'blocking',
            'housekeeping',
        ]);
    });

    test('empty reason does not defer; P4 is advisory', () => {
        const p3 = mk('review-finding', 'P3');
        const id = makeItemId('review-finding', p3.location, p3.text);
        const [out] = classify([p3], [{ id, reason: '  ' }]);
        expect(out?.class).toBe('blocking');
        const [p4] = classify([mk('review-finding', 'P4')], []);
        expect(p4?.class).toBe('advisory');
    });

    test('ids are stable across re-scans and differ per text/location', () => {
        expect(makeItemId('diff-marker', 'a.ts:1', 'TODO x')).toBe(makeItemId('diff-marker', 'a.ts:1', ' TODO   x '));
        expect(makeItemId('diff-marker', 'a.ts:1', 'TODO x')).not.toBe(makeItemId('diff-marker', 'a.ts:2', 'TODO x'));
    });
});

describe('foldVerdict', () => {
    const scan = (
        classes: Array<ResidualArtifact['items'][number]['class']>,
        loc = 'src/a.ts:1',
    ): ResidualArtifact => ({
        wbs: '0949',
        base: 'b',
        scanned: { 'review-finding': true, 'diff-marker': true, 'unchecked-box': true, 'staging-residue': true },
        items: classes.map((klass, i) => ({
            id: `x${i}`,
            category: 'review-finding',
            class: klass,
            priority: 'P3',
            location: `${loc.slice(0, -1)}${i + 1}`,
            text: 't',
        })),
        counts: {
            blocking: classes.filter((c) => c === 'blocking').length,
            deferrable: classes.filter((c) => c === 'deferrable').length,
            advisory: 0,
            housekeeping: 0,
        },
    });

    test('PASS downgrades to PARTIAL when blocking > 0; check fails with ids in evidence', () => {
        const verdict = { verdict: 'PASS', checks: [{ name: 'tests-pass', status: 'pass', evidence: 'ok' }] };
        const out = foldVerdict(verdict, scan(['blocking']), '');
        expect(out.verdict).toBe('PARTIAL');
        expect(out.checks.find((c) => c.name === 'residual-sweep')?.status).toBe('fail');
        expect(out.checks.find((c) => c.name === 'residual-sweep')?.evidence).toContain('blocking=1');
        expect(out.checks.find((c) => c.name === 'residual-sweep')?.evidence).toContain('x0');
    });

    test('clean scan keeps PASS, check passes; PARTIAL/FAIL unchanged', () => {
        const pass = foldVerdict({ verdict: 'PASS', checks: [] }, scan([]), '');
        expect(pass.verdict).toBe('PASS');
        expect(pass.checks[0]?.status).toBe('pass');
        expect(foldVerdict({ verdict: 'PARTIAL', checks: [] }, scan([]), '').verdict).toBe('PARTIAL');
        expect(foldVerdict({ verdict: 'FAIL', checks: [] }, scan(['blocking']), '').verdict).toBe('FAIL');
    });

    test('merges blocking anchors into findings: unique, sorted, capped, idempotent', () => {
        const withBlocking = scan(['blocking', 'blocking'], 'src/b.ts:9');
        const first = foldVerdict({ verdict: 'PASS', checks: [] }, withBlocking, 'src/a.ts:2 src/a.ts:2 ');
        const anchors = first.findings.split(/\s+/).filter((a) => a.length > 0);
        expect(anchors[0]).toBe('src/a.ts:2');
        expect(anchors).toContain('src/b.ts:1');
        const second = foldVerdict({ verdict: 'PASS', checks: [] }, withBlocking, first.findings);
        expect(second.findings).toBe(first.findings);
        const many = foldVerdict({ verdict: 'PASS', checks: [] }, scan(['blocking']), '', 1);
        expect(many.findings.split(/\s+/).filter((a) => a.length > 0)).toHaveLength(1);
    });

    test('blockingAnchors only yields file.ext:line-shaped anchors', () => {
        const items: ResidualArtifact['items'] = [
            { id: '1', category: 'unchecked-box', class: 'blocking', location: 'task-file:2', text: '- [ ] x' },
            { id: '2', category: 'diff-marker', class: 'blocking', location: 'src/a.ts:7', text: 'TODO' },
        ];
        expect(blockingAnchors(items)).toEqual(['src/a.ts:7']);
    });
});

/** Task 1065 R3: fold freshness between run and durable verdict copies. */
describe('verdict copy freshness', () => {
    const artifact: ResidualArtifact = {
        wbs: '1065',
        base: 'b',
        scanned: { 'review-finding': false, 'diff-marker': false, 'unchecked-box': false, 'staging-residue': false },
        items: [],
        counts: { blocking: 0, deferrable: 0, advisory: 0, housekeeping: 0 },
    };
    const writeVerdict = (dir: string, where: 'run' | 'durable', verdict: string, ageSeconds: number): string => {
        const path =
            where === 'run'
                ? join(dir, '.spur', 'run', '1065-verdict.json')
                : join(dir, '.spur', 'memory', 'evidence', '1065-verdict.json');
        mkdirSync(join(path, '..'), { recursive: true });
        writeFileSync(path, `${JSON.stringify({ verdict, checks: [] }, null, 2)}\n`);
        const t = new Date(Date.now() - ageSeconds * 1000);
        utimesSync(path, t, t);
        return path;
    };
    const capture = () => {
        const lines: string[] = [];
        return { lines, io: { out: (line: string) => lines.push(line), err: () => {} } };
    };
    const seeded = (prefix: string) => {
        const { dir, cleanup } = scratch(prefix);
        writeFileSync(join(dir, '.spur', 'run', '1065-residuals.json'), `${JSON.stringify(artifact)}\n`);
        return { dir, cleanup };
    };

    test('newer mtime wins — fresh run copy over stale durable (R1)', () => {
        const { dir, cleanup } = scratch('rs-fresh-');
        try {
            writeVerdict(dir, 'durable', 'PARTIAL', 60);
            const run = writeVerdict(dir, 'run', 'PASS', 0);
            expect(recordedVerdictPath(join(dir, '.spur', 'run'), '1065', fsp)).toBe(run);
        } finally {
            cleanup();
        }
    });

    test('fresh run PASS + stale durable PARTIAL → fold resolves PASS and says why (R3a)', () => {
        const { dir, cleanup } = seeded('rs-pass-');
        try {
            writeVerdict(dir, 'durable', 'PARTIAL', 60);
            const run = writeVerdict(dir, 'run', 'PASS', 0);
            const cap = capture();
            expect(main(['fold', '1065', '--root', dir], {}, cap)).toBe(0);
            const reported = cap.lines.join('');
            expect(reported).toContain('verdict copies disagree');
            expect(reported).toContain('chose run');
            expect(JSON.parse(readFileSync(run, 'utf8')).verdict).toBe('PASS');
        } finally {
            cleanup();
        }
    });

    test('fresh run PARTIAL + stale durable PASS → fold resolves PARTIAL (R3b)', () => {
        const { dir, cleanup } = seeded('rs-part-');
        try {
            writeVerdict(dir, 'durable', 'PASS', 60);
            const run = writeVerdict(dir, 'run', 'PARTIAL', 0);
            const cap = capture();
            expect(main(['fold', '1065', '--root', dir], {}, cap)).toBe(0);
            const reported = cap.lines.join('');
            expect(reported).toContain('durable');
            expect(reported).toContain('chose run');
            expect(JSON.parse(readFileSync(run, 'utf8')).verdict).toBe('PARTIAL');
        } finally {
            cleanup();
        }
    });

    test('equal copies fold silently (R3c)', () => {
        const { dir, cleanup } = seeded('rs-equal-');
        try {
            writeVerdict(dir, 'durable', 'PASS', 60);
            writeVerdict(dir, 'run', 'PASS', 0);
            const cap = capture();
            expect(main(['fold', '1065', '--root', dir], {}, cap)).toBe(0);
            expect(cap.lines.join('')).not.toContain('disagree');
        } finally {
            cleanup();
        }
    });
});

const SILENT = { io: { out: () => {}, err: () => {} } } as const;

describe('CLI modes', () => {
    test('usage on bad args', () => {
        expect(main([], {}, SILENT)).toBe(2);
    });

    test('scan via main writes artifact; report is no-op on passing sweep, writes on failing', () => {
        const { dir, cleanup } = scratch('rs-cli-');
        try {
            const stub = join(dir, 'stub-spur.sh');
            writeFileSync(
                stub,
                `#!/bin/sh\ncase "$2" in\n  show) echo '{"content":"### Review\\\\n\\\\n| Priority | Finding |\\\\n| --- | --- |\\\\n| P3 | Bad |","frontmatter":{"feature_id":"F96"}}' ;;\nesac\n`,
            );
            chmodSync(stub, 0o755);
            const argv = ['scan', '0949', '--spur-bin', stub, '--root', dir];
            expect(main(argv, {}, SILENT)).toBe(0);
            const artPath = join(dir, '.spur', 'run', '0949-residuals.json');
            expect(existsSync(artPath)).toBe(true);
            const art = JSON.parse(readFileSync(artPath, 'utf8')) as ResidualArtifact;
            expect(art.counts.blocking).toBe(1);
            // verdict PASS + clean scan → report no-op
            writeFileSync(
                join(dir, '.spur', 'run', '0949-verdict.json'),
                JSON.stringify({
                    verdict: 'PASS',
                    checks: [{ name: 'residual-sweep', status: 'pass', evidence: 'blocking=0' }],
                }),
            );
            expect(main(['report', '0949', '--spur-bin', stub, '--root', dir], {}, SILENT)).toBe(0);
            expect(existsSync(join(dir, '.spur', 'run', '0949-residual-report.md'))).toBe(false);
            // failing sweep → report written
            writeFileSync(
                join(dir, '.spur', 'run', '0949-verdict.json'),
                JSON.stringify({
                    verdict: 'PARTIAL',
                    checks: [{ name: 'residual-sweep', status: 'fail', evidence: 'blocking=1' }],
                }),
            );
            writeFileSync(join(dir, '.spur', 'run', '0949-test-fix-attempt'), '2\n');
            expect(main(['report', '0949', '--spur-bin', stub, '--root', dir], {}, SILENT)).toBe(0);
            const report = readFileSync(join(dir, '.spur', 'run', '0949-residual-report.md'), 'utf8');
            expect(report).toContain('Attempt: 2');
            expect(report).toContain('review-finding');
            expect(report).toContain('Bad');
        } finally {
            cleanup();
        }
    });

    test('fold via main rewrites verdict + findings files', () => {
        const { dir, cleanup } = scratch('rs-fold-');
        try {
            const runDir = join(dir, '.spur', 'run');
            const scanArt: ResidualArtifact = {
                wbs: '0949',
                base: null,
                scanned: {
                    'review-finding': true,
                    'diff-marker': false,
                    'unchecked-box': true,
                    'staging-residue': true,
                },
                items: [{ id: 'd1', category: 'diff-marker', class: 'blocking', location: 'src/z.ts:4', text: 'TODO' }],
                counts: { blocking: 1, deferrable: 0, advisory: 0, housekeeping: 0 },
            };
            writeFileSync(join(runDir, '0949-residuals.json'), JSON.stringify(scanArt));
            writeFileSync(
                join(runDir, '0949-verdict.json'),
                JSON.stringify({ verdict: 'PASS', checks: [{ name: 'tests-pass', status: 'pass', evidence: 'ok' }] }),
            );
            writeFileSync(join(runDir, '0949-test-gate.findings'), 'src/y.ts:1 ');
            const durable = join(dir, '.spur/memory/evidence/0949-verdict.json');
            mkdirSync(join(dir, '.spur/memory/evidence'), { recursive: true });
            writeFileSync(durable, readFileSync(join(runDir, '0949-verdict.json')));
            // Pin the freshness relation (1065): two back-to-back writes can land on equal mtimes,
            // which resolves to the run copy and skips the durable sync — the fold's durable-newer path.
            const stale = new Date(Date.now() - 60_000);
            utimesSync(join(runDir, '0949-verdict.json'), stale, stale);
            utimesSync(durable, new Date(), new Date());
            expect(main(['fold', '0949', '--root', dir], {}, SILENT)).toBe(0);
            const verdict = JSON.parse(readFileSync(join(runDir, '0949-verdict.json'), 'utf8')) as {
                verdict: string;
                checks: Array<{ name: string; status: string }>;
            };
            expect(verdict.verdict).toBe('PARTIAL');
            expect(JSON.parse(readFileSync(durable, 'utf8'))).toEqual(verdict);
            expect(verdict.checks.find((c) => c.name === 'residual-sweep')?.status).toBe('fail');
            expect(readFileSync(join(runDir, '0949-test-gate.findings'), 'utf8').trim().split(/\s+/).sort()).toEqual([
                'src/y.ts:1',
                'src/z.ts:4',
            ]);
        } finally {
            cleanup();
        }
    });

    test('settle files follow-up once (idempotent) and cleans only wbs-prefixed tmp files', () => {
        const { dir, cleanup } = scratch('rs-settle-');
        try {
            const calls: string[] = [];
            const stub = join(dir, 'stub-spur.sh');
            writeFileSync(
                stub,
                `#!/bin/sh\necho "$3 $4 $5 $6" >> ${JSON.stringify(join(dir, 'calls.log'))}\ncase "$2" in\n  show) echo '{"content":"- [ ] box","frontmatter":{"feature_id":"F96"}}' ;;\n  create) echo '{"wbs":"0960"}' ;;\n  update) echo '{}' ;;\nesac\n`,
            );
            chmodSync(stub, 0o755);
            // unchecked box stays blocking → no deferrals → no create; tmp cleanup still runs
            writeFileSync(join(tmpdir(), `0949-leftover.txt`), 'x');
            const otherTmp = join(tmpdir(), `9999-keep.txt`);
            writeFileSync(otherTmp, 'x');
            const tmpScoped = join(dir, 'tmpdir');
            mkdirSync(tmpScoped);
            const argv = ['settle', '0949', '--spur-bin', stub, '--root', dir, '--tmp-dir', tmpScoped];
            expect(main(argv, {}, SILENT)).toBe(0);
            expect(main(argv, {}, SILENT)).toBe(0);
            expect(existsSync(join(tmpScoped, '0949-leftover.txt'))).toBe(false);
            expect(existsSync(otherTmp)).toBe(true);
            // deferral path: mark the box deferrable via deferrals file, settle creates task once
            // unchecked boxes are immune; use a diff-marker instead
            writeFileSync(
                stub,
                `#!/bin/sh\necho "$@" >> ${JSON.stringify(join(dir, 'calls.log'))}\ncase "$2" in\n  show) echo '{"content":"### Review\\\\n\\\\n| Priority | Finding |\\\\n| --- | --- |\\\\n| P3 | Soft |","frontmatter":{"feature_id":"F96"}}' ;;\n  create) echo '{"wbs":"0961"}' ;;\n  update) echo '{}' ;;\nesac\n`,
            );
            const p3Id = makeItemId('review-finding', '', 'Soft');
            writeFileSync(
                join(dir, '.spur', 'run', '0949-residual-deferrals.json'),
                JSON.stringify([{ id: p3Id, reason: 'post-merge' }]),
            );
            expect(main(argv, {}, SILENT)).toBe(0);
            const callsTxt = readFileSync(join(dir, 'calls.log'), 'utf8');
            expect(callsTxt).toContain('create');
            // The follow-up is filed unlinked: a feature edge to the completing feature would fail
            // that feature's done-gate (L4.verifying-incomplete-tasks) as soon as a residual defers.
            const createLine = callsTxt.split('\n').find((l) => l.includes('create')) ?? '';
            expect(createLine).toContain('Residuals from 0949');
            expect(createLine).not.toContain('--feature');
            expect(main(argv, {}, SILENT)).toBe(0);
            const callsAfterSecond = readFileSync(join(dir, 'calls.log'), 'utf8');
            expect(callsAfterSecond.split('\n').filter((l) => l.includes('create'))).toHaveLength(1);
            const residuals = JSON.parse(readFileSync(join(dir, '.spur', 'run', '0949-residuals.json'), 'utf8')) as {
                followUp?: string;
            };
            expect(residuals.followUp).toBe('0961');
            void calls;
        } finally {
            cleanup();
        }
    });

    test('usage constant exported', () => {
        expect(RESIDUAL_SCAN_USAGE).toContain('scan|fold|settle|report');
        expect(RESIDUAL_SCAN_USAGE).toContain('review-gate');
    });
});

/**
 * Task 1122 R1: the review-time gate reuses the record sweep's classifier on the review-finding
 * slice only — same parse, same classify, same deferrals — so the early check and the record sweep
 * cannot disagree. Unchecked boxes and diff markers are not decidable before record and stay out.
 */
describe('blockingReviewFindings (task 1122 R1)', () => {
    test('review-only content classifies identically to the record sweep review slice', () => {
        const { dir, cleanup } = scratch('rs-brf-');
        try {
            const sweep = scanResiduals(dir, '1122', dir, REVIEW_BOTH_ORDERS, {});
            const slice = sweep.items.filter((i) => i.category === 'review-finding');
            expect(blockingReviewFindings(REVIEW_BOTH_ORDERS, [])).toEqual(slice);
        } finally {
            cleanup();
        }
    });

    test('file deferrals reclassify a P3 the same way the sweep does; P2 stays blocking', () => {
        const review = [
            '### Review',
            '',
            '| Priority | Finding | Location | Disposition |',
            '| --- | --- | --- | --- |',
            '| P3 | Magic number | `src/a.ts:12` | OPEN |',
            '| P2 | Missing validation | `src/c.ts:8` | OPEN |',
        ].join('\n');
        const deferred = blockingReviewFindings(review, [
            { id: makeItemId('review-finding', 'src/a.ts:12', 'Magic number'), reason: 'post-merge regen' },
        ]);
        expect(deferred.map((i) => [i.priority, i.class])).toEqual([
            ['P3', 'deferrable'],
            ['P2', 'blocking'],
        ]);
        // In-table DEFER dispositions apply without a deferrals file (same as scanResiduals).
        const inTable = blockingReviewFindings(
            [
                '### Review',
                '',
                '| Priority | Finding | Location | Disposition |',
                '| --- | --- | --- | --- |',
                '| P3 | Magic number | `src/a.ts:12` | DEFER(post-merge regen) |',
                '| P2 | Missing validation | `src/c.ts:8` | OPEN |',
            ].join('\n'),
            [],
        );
        expect(inTable[0]?.class).toBe('deferrable');
    });

    test('ignores unchecked boxes even alongside P4-only findings', () => {
        const content =
            '## Requirements\n\n- [ ] R1. proven later\n\n### Review\n\n| Priority | Finding |\n| --- | --- |\n| P4 (advisory) | Note |';
        expect(blockingReviewFindings(content, []).every((i) => i.class !== 'blocking')).toBe(true);
    });
});

/**
 * Task 1122 R2/AC1: the review-gate mode is the PASS-edge gate — exit 0 for P4-only, DEFER-ed P3,
 * RESOLVED rows, and unchecked boxes; exit 1 for an open P1-P3 with its anchor; the artifact holds
 * only review-finding items so the test-fix hop's existing hand-off feeds /sp:dev-fixall.
 */
describe('review-gate mode (task 1122 R2/AC1)', () => {
    const REVIEW_TABLE_HEAD =
        '### Review\n\n| Priority | Finding | Location | Disposition |\n| --- | --- | --- | --- |\n';
    const stubSpurShow = (dir: string, content: string): string => {
        const stub = join(dir, 'stub-spur.sh');
        const payload = JSON.stringify({ content, frontmatter: { feature_id: 'H15' } }).replaceAll("'", "'\\''");
        writeFileSync(stub, `#!/bin/sh\ncase "$2" in\n  show) printf '%s' '${payload}' ;;\nesac\n`);
        chmodSync(stub, 0o755);
        return stub;
    };
    const capture = () => {
        const lines: string[] = [];
        return { lines, io: { out: (line: string) => lines.push(line), err: () => {} } };
    };

    test.each([
        ['P4-only rows pass', `${REVIEW_TABLE_HEAD}| P4 (advisory) | Fuzzy name | src/a.ts:20 | ACCEPTED |\n`, 0, ''],
        [
            'DEFER-ed P3 passes',
            `${REVIEW_TABLE_HEAD}| P3 | Magic number | src/a.ts:12 | DEFER(post-merge regen) |\n`,
            0,
            '',
        ],
        [
            'RESOLVED P2 passes',
            `${REVIEW_TABLE_HEAD}| P2 | Missing validation | src/c.ts:8 | RESOLVED — fixed in pass |\n`,
            0,
            '',
        ],
        [
            'unchecked boxes with P4-only rows pass',
            `## Requirements\n\n- [ ] R1. proven at record\n\n${REVIEW_TABLE_HEAD}| P4 (advisory) | Note | src/d.ts:1 | ACCEPTED |\n`,
            0,
            '',
        ],
        [
            'OPEN P2 fails with its anchor',
            `${REVIEW_TABLE_HEAD}| P2 (major) | Missing validation | src/c.ts:8 | OPEN |\n`,
            1,
            'src/c.ts:8',
        ],
        ['OPEN P1 fails', `${REVIEW_TABLE_HEAD}| P1 (blocker) | Off by one | src/b.ts:3 | OPEN |\n`, 1, 'src/b.ts:3'],
    ] as const)('review-gate: %s', (_name, content, expected, anchor) => {
        const { dir, cleanup } = scratch('rs-gate-');
        try {
            const stub = stubSpurShow(dir, content);
            const cap = capture();
            expect(main(['review-gate', '1122', '--spur-bin', stub, '--root', dir], {}, { io: cap.io })).toBe(expected);
            const art = JSON.parse(
                readFileSync(join(dir, '.spur', 'run', '1122-residuals.json'), 'utf8'),
            ) as ResidualArtifact;
            expect(art.items.every((i) => i.category === 'review-finding')).toBe(true);
            expect(art.scanned).toEqual({
                'review-finding': true,
                'diff-marker': false,
                'unchecked-box': false,
                'staging-residue': false,
            });
            if (expected === 1) {
                expect(art.counts.blocking).toBe(1);
                expect(cap.lines.join('')).toContain('blocking=1');
                expect(cap.lines.join('')).toContain(anchor);
            } else {
                expect(art.counts.blocking).toBe(0);
            }
        } finally {
            cleanup();
        }
    });

    test('file deferrals apply: a deferred P3 exits 0', () => {
        const { dir, cleanup } = scratch('rs-gate-def-');
        try {
            const content = `${REVIEW_TABLE_HEAD}| P3 | Magic number | src/a.ts:12 | OPEN |\n`;
            const stub = stubSpurShow(dir, content);
            const id = makeItemId('review-finding', 'src/a.ts:12', 'Magic number');
            writeFileSync(
                join(dir, '.spur', 'run', '1122-residual-deferrals.json'),
                `${JSON.stringify([{ id, reason: 'post-merge regen' }])}\n`,
            );
            expect(main(['review-gate', '1122', '--spur-bin', stub, '--root', dir], {}, SILENT)).toBe(0);
        } finally {
            cleanup();
        }
    });

    test('task load failure fails closed (non-zero)', () => {
        const { dir, cleanup } = scratch('rs-gate-err-');
        try {
            const stub = join(dir, 'stub-fail.sh');
            writeFileSync(stub, '#!/bin/sh\nexit 3\n');
            chmodSync(stub, 0o755);
            expect(() => main(['review-gate', '1122', '--spur-bin', stub, '--root', dir], {}, SILENT)).toThrow();
        } finally {
            cleanup();
        }
    });
});

describe('renderReport', () => {
    test('renders blocking rows with location and text', () => {
        const md = renderReport(
            '0949',
            [{ id: 'i', category: 'diff-marker', class: 'blocking', location: 'a.ts:1', text: 'TODO fix | carefully' }],
            3,
        );
        expect(md).toContain('# Residual report — 0949');
        expect(md).toContain('a.ts:1');
        expect(md).toContain('TODO fix \\| carefully');
    });
});
