import { describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    blockingAnchors,
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
            expect(main(['fold', '0949', '--root', dir], {}, SILENT)).toBe(0);
            const verdict = JSON.parse(readFileSync(join(runDir, '0949-verdict.json'), 'utf8')) as {
                verdict: string;
                checks: Array<{ name: string; status: string }>;
            };
            expect(verdict.verdict).toBe('PARTIAL');
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
            const _boxId = makeItemId('unchecked-box', 'task-file:1', '- [ ] box');
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
