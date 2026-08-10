/**
 * Behavioral checks for the ungraduated-fog gate (task 0472).
 *
 * Run directly while iterating:
 *   bun test packages/app/tests/services/corpus-check.test.ts
 *
 * Two things are pinned here that fixtures alone cannot pin:
 *
 *   1. The parser runs against the EIGHT REAL maps in `docs/features/`, because the heading text
 *      varies in the wild (`### Not yet specified`, `… (fog of war)`, `… — the fog`) and a parser
 *      written to the requirement's literal `## Not yet specified` would have matched nothing.
 *   2. The decision rule is replayed over REAL history (`ee0771ab~1..c9bc177b`), because the fog
 *      edit and its tickets landed in different commits. That span is the whole reason the range
 *      is branch-scoped, and the narrow-range control below shows what happens without it.
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { key, resolveFogRange, runCorpusCheck, sectionLabels, ungraduatedFog } from '../../src/services/corpus-check';

const FOG = /^###\s+Not yet specified\b/;
const OUT_OF_SCOPE = /^###\s+Out of scope\b/;
const REPO = join(import.meta.dir, '..', '..', '..', '..');

function corpusFixture(): string {
    const root = mkdtempSync(join(tmpdir(), 'spur-corpus-check-'));
    mkdirSync(join(root, 'config'), { recursive: true });
    mkdirSync(join(root, 'docs', 'tasks'), { recursive: true });
    writeFileSync(join(root, 'config', 'corpus-baseline.json'), JSON.stringify({ entries: [] }));
    return root;
}

function writeBaseline(root: string, entries: unknown[]): void {
    writeFileSync(join(root, 'config', 'corpus-baseline.json'), JSON.stringify({ entries }));
}

describe('runCorpusCheck', () => {
    test('reconciles a baselined finding and preserves the result contract', async () => {
        const root = corpusFixture();
        write(root, 'docs/tasks/0001_broken.md', 'not task markdown\n');

        const first = await runCorpusCheck(root);
        const finding = first.newErrors[0];
        expect(finding).toBeDefined();
        if (finding === undefined) throw new Error('expected malformed task finding');

        writeBaseline(root, [
            {
                kind: finding.kind,
                id: finding.id,
                code: finding.code,
                reason: 'fixture',
                since: '2026-08-10',
            },
        ]);
        expect(await runCorpusCheck(root)).toEqual({
            observed: first.observed,
            baselined: 1,
            newErrors: [],
            staleEntries: [],
            ok: true,
        });
    });

    test('returns new findings and stale baseline entries as failures', async () => {
        const newRoot = corpusFixture();
        write(newRoot, 'docs/tasks/0001_broken.md', 'not task markdown\n');
        const newResult = await runCorpusCheck(newRoot);
        expect(newResult.ok).toBe(false);
        expect(newResult.newErrors.length).toBeGreaterThan(0);

        const staleRoot = corpusFixture();
        const stale = {
            kind: 'task',
            id: '0999',
            code: 'L1.fixture',
            reason: 'fixture',
            since: '2026-08-10',
        };
        writeBaseline(staleRoot, [stale]);
        expect(await runCorpusCheck(staleRoot)).toMatchObject({
            observed: 0,
            baselined: 1,
            newErrors: [],
            staleEntries: [stale],
            ok: false,
        });
    });

    test('fails hard when the in-process sweep configuration is unparseable', async () => {
        const root = corpusFixture();
        write(root, '.spur/tasks/section-matrix.yaml', 'variants: [\n');
        await expect(runCorpusCheck(root)).rejects.toThrow('could not parse task section matrix');
    });

    test('resolves the project baseline from a nested cwd', async () => {
        const root = corpusFixture();
        write(root, 'docs/tasks/0001_broken.md', 'not task markdown\n');
        const finding = (await runCorpusCheck(root)).newErrors[0];
        expect(finding).toBeDefined();
        if (finding === undefined) throw new Error('expected malformed task finding');
        writeBaseline(root, [{ ...finding, message: undefined, reason: 'fixture', since: '2026-08-10' }]);
        const nested = join(root, 'packages', 'nested');
        mkdirSync(nested, { recursive: true });

        expect((await runCorpusCheck(nested)).ok).toBe(true);
    });
});

function inspectFog(cwd: string, opts: { since?: string; head?: string } = {}) {
    return ungraduatedFog(cwd, { ...opts, report: () => {} });
}

/* ------------------------------------------------------------ real corpus */

describe('sectionLabels against the real maps', () => {
    const maps = readdirSync(join(REPO, 'docs', 'features'))
        .filter((f) => f.endsWith('.md'))
        .map((f) => ({ f, md: readFileSync(join(REPO, 'docs', 'features', f), 'utf8') }))
        .filter(({ md }) => /^###\s+Not yet specified/m.test(md));

    test('finds a fog section in every map, in both heading spellings', () => {
        expect(maps.length).toBeGreaterThanOrEqual(8);
        const spellings = new Set<string>();
        let bullets = 0;
        for (const { f, md } of maps) {
            const labels = sectionLabels(md, FOG);
            // Non-null is the assertion that matters: a map whose fog is deliberately empty
            // (M3 writes `_(none — fog cleared by 0269)_`) parses to an empty set, and "empty"
            // must stay distinguishable from "section not found".
            expect(labels, `${f} has a fog heading but no parsed section`).not.toBeNull();
            bullets += (labels as Map<string, string>).size;
            spellings.add(md.match(/^###\s+Not yet specified.*$/m)?.[0] as string);
        }
        expect(bullets).toBeGreaterThan(0);
        // The plain heading and at least one decorated variant both exist in the corpus.
        expect(spellings.has('### Not yet specified')).toBe(true);
        expect([...spellings].some((s) => s !== '### Not yet specified')).toBe(true);
    });

    test('stops at the next heading rather than swallowing the rest of the map', () => {
        const md = maps.find(({ f }) => f.startsWith('M_'))?.md as string;
        const labels = sectionLabels(md, FOG) as Map<string, string>;
        const cut = sectionLabels(md, OUT_OF_SCOPE) as Map<string, string>;
        expect(labels.size).toBeGreaterThan(0);
        expect(cut.size).toBeGreaterThan(0);
        for (const key of cut.keys()) expect(labels.has(key)).toBe(false);
    });
});

describe('shrinkage measure', () => {
    const original = [
        '### Not yet specified (fog of war)',
        '',
        '- **Retention and volume** — 590k lines today, growing 10.4 MB/day.',
        '- **Redaction posture** — unmeasured against real transcripts.',
        '- **Cost attribution** — reruns are double counted.',
        '',
    ].join('\n');

    test('rewrapping, rewording, and reordering bullets is not shrinkage', () => {
        const reflowed = [
            '### Not yet specified',
            '',
            '- **Cost attribution** — reruns double count, which the ledger does not model at all',
            '  and probably never will without a run id.',
            '- **Redaction posture** — completely rewritten body text with different words in it.',
            '- **Retention and volume** — 590k lines today,',
            '  growing 10.4 MB/day.',
            '',
        ].join('\n');
        const before = sectionLabels(original, FOG) as Map<string, string>;
        const after = sectionLabels(reflowed, FOG) as Map<string, string>;
        expect([...before.keys()].filter((k) => !after.has(k))).toEqual([]);
    });

    test('removing a bullet is shrinkage', () => {
        const trimmed = original
            .split('\n')
            .filter((l) => !l.includes('Redaction'))
            .join('\n');
        const before = sectionLabels(original, FOG) as Map<string, string>;
        const after = sectionLabels(trimmed, FOG) as Map<string, string>;
        expect([...before.keys()].filter((k) => !after.has(k))).toEqual(['redaction posture']);
    });

    test('a bullet with no bold label falls back to its first clause', () => {
        const labels = sectionLabels('### Not yet specified\n\n- Retention policy — undecided.\n', FOG);
        expect([...(labels as Map<string, string>).values()]).toEqual(['Retention policy']);
    });

    test('an absent section is null, not an empty set', () => {
        expect(sectionLabels('## Notes\n\n- nothing here\n', FOG)).toBeNull();
    });
});

/* ------------------------------------------------------- synthetic repos */

function git(root: string, args: string[]): void {
    const p = Bun.spawnSync(['git', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], {
        cwd: root,
        stdout: 'pipe',
        stderr: 'pipe',
    });
    if (p.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${p.stderr.toString()}`);
}

function write(root: string, rel: string, content: string): void {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
}

function mapMd(fog: string[], outOfScope: string[] = []): string {
    return [
        '---',
        'name: Synthetic map',
        '---',
        '',
        '## Notes',
        '',
        '### Not yet specified (fog of war)',
        '',
        ...fog.map((f) => `- **${f}** — sketched, not yet sharp enough to ticket.`),
        '',
        '### Out of scope',
        '',
        ...outOfScope.map((o) => `- **${o}** — ruled beyond the destination.`),
        '',
    ].join('\n');
}

const MAP_FILE = 'docs/features/Z1_synthetic-map.md';

function taskMd(featureId: string): string {
    return `---\ntemplate: default\nfeature_id: ${featureId}\nstatus: todo\n---\n\n### Background\nsynthetic\n`;
}

/**
 * A repo whose `main` holds the base state and whose `work` branch holds the change, so the
 * default branch-scoped range has something to measure. `after` runs on the work branch.
 */
function scaffold(base: (root: string) => void, after: (root: string) => void, commitAfter = true): string {
    const root = mkdtempSync(join(tmpdir(), 'spur-fog-'));
    git(root, ['init']);
    git(root, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
    git(root, ['config', 'user.email', 'test@example.com']);
    git(root, ['config', 'user.name', 'Test']);
    // The fog check scans the task folders the project configures (no-hardcoded-planning-folder).
    // Fixtures configure the legacy trio so graduation tickets land in a scanned dir.
    write(
        root,
        '.spur/config.yaml',
        [
            'tasks:',
            '  active: docs/tasks',
            '  folders:',
            '    docs/tasks:',
            '      baseCounter: 0',
            '    docs/tasks2:',
            '      baseCounter: 100',
            '    docs/tasks3:',
            '      baseCounter: 200',
            '',
        ].join('\n'),
    );
    base(root);
    git(root, ['add', '-A']);
    git(root, ['commit', '-m', 'base']);
    git(root, ['checkout', '-b', 'work']);
    after(root);
    if (commitAfter) {
        git(root, ['add', '-A']);
        git(root, ['commit', '-m', 'session', '--allow-empty']);
    } else {
        // Keep the edit uncommitted but still diverge, so the working-tree half of the range is
        // what carries the change.
        write(root, 'docs/notes.md', 'unrelated\n');
        git(root, ['add', 'docs/notes.md']);
        git(root, ['commit', '-m', 'unrelated']);
    }
    return root;
}

const FOG_3 = ['Retention and volume', 'Redaction posture', 'Cost attribution'];
const FOG_2 = ['Retention and volume', 'Cost attribution'];

describe('ungraduatedFog decision table', () => {
    test('row 4 — fog shrank, no ticket, no scope cut: fails with the feature, the fog, and both remedies', async () => {
        const root = scaffold(
            (r) => write(r, MAP_FILE, mapMd(FOG_3)),
            (r) => write(r, MAP_FILE, mapMd(FOG_2)),
        );
        const errors = await inspectFog(root);
        expect(errors).toHaveLength(1);
        const [e] = errors;
        expect(e?.kind).toBe('feature');
        expect(e?.id).toBe('Z1');
        expect(e?.code).toBe('corpus.ungraduated-fog');
        expect(e?.message).toContain('Redaction posture');
        expect(e?.message).toContain('spur task create');
        expect(e?.message).toContain('### Out of scope');
    });

    test('row 2 — fog graduated into a new ticket passes', async () => {
        const root = scaffold(
            (r) => write(r, MAP_FILE, mapMd(FOG_3)),
            (r) => {
                write(r, MAP_FILE, mapMd(FOG_2));
                write(r, 'docs/tasks3/0900_redaction-posture.md', taskMd('Z1'));
            },
        );
        expect(await inspectFog(root)).toEqual([]);
    });

    test('row 3 — fog ruled out of scope passes', async () => {
        const root = scaffold(
            (r) => write(r, MAP_FILE, mapMd(FOG_3)),
            (r) => write(r, MAP_FILE, mapMd(FOG_2, ['Redaction posture'])),
        );
        expect(await inspectFog(root)).toEqual([]);
    });

    test('row 1 — reflowed fog passes (nothing was removed)', async () => {
        const root = scaffold(
            (r) => write(r, MAP_FILE, mapMd(FOG_3)),
            (r) => write(r, MAP_FILE, mapMd([...FOG_3].reverse().map((f) => f.toUpperCase()))),
        );
        expect(await inspectFog(root)).toEqual([]);
    });

    test('row 2 — re-parenting an existing ticket counts as graduation', async () => {
        const root = scaffold(
            (r) => {
                write(r, MAP_FILE, mapMd(FOG_3));
                write(r, 'docs/tasks3/0900_redaction-posture.md', taskMd('Q7'));
            },
            (r) => {
                write(r, MAP_FILE, mapMd(FOG_2));
                write(r, 'docs/tasks3/0900_redaction-posture.md', taskMd('Z1'));
            },
        );
        expect(await inspectFog(root)).toEqual([]);
    });

    test('a ticket that already belonged to the feature is not a graduation', async () => {
        const root = scaffold(
            (r) => {
                write(r, MAP_FILE, mapMd(FOG_3));
                write(r, 'docs/tasks3/0900_older-ticket.md', taskMd('Z1'));
            },
            (r) => write(r, MAP_FILE, mapMd(FOG_2)),
        );
        expect(await inspectFog(root)).toHaveLength(1);
    });

    test('the working tree is part of the range, not just committed history', async () => {
        const root = scaffold(
            (r) => write(r, MAP_FILE, mapMd(FOG_3)),
            (r) => write(r, MAP_FILE, mapMd(FOG_2)),
            false,
        );
        expect(await inspectFog(root)).toHaveLength(1);
    });

    test('a violation is baselineable through the shared identity, not a second mechanism', async () => {
        const root = scaffold(
            (r) => write(r, MAP_FILE, mapMd(FOG_3)),
            (r) => write(r, MAP_FILE, mapMd(FOG_2)),
        );
        const [error] = await inspectFog(root);
        // `corpusCheck` diffs observed errors against `config/corpus-baseline.json` on exactly this
        // triple, and that two-sided diff (unexpected fails, stale fails) is pre-existing shared
        // code. What is new here is that a fog finding carries an identity it can match on.
        const baselineEntry = { kind: 'feature', id: 'Z1', code: 'corpus.ungraduated-fog' };
        expect(key(error as { kind: string; id: string; code: string })).toBe(key(baselineEntry));
    });

    test('a map created inside the range cannot shrink', async () => {
        const root = scaffold(
            (r) => write(r, 'docs/features/Z2_other.md', '## Notes\n'),
            (r) => write(r, MAP_FILE, mapMd(FOG_3)),
        );
        expect(await inspectFog(root)).toEqual([]);
    });
});

/* ------------------------------------------------- range + degradation */

describe('resolveFogRange', () => {
    test('names the range it evaluated', async () => {
        const root = scaffold(
            (r) => write(r, MAP_FILE, mapMd(FOG_3)),
            (r) => write(r, MAP_FILE, mapMd(FOG_2)),
        );
        const range = await resolveFogRange(root);
        expect('base' in range).toBe(true);
        expect(range.spec).toContain('merge-base(main, HEAD)');
        expect(range.spec).toContain('(working tree)');
    });

    test('an explicit --since overrides the default range', async () => {
        const root = scaffold(
            (r) => write(r, MAP_FILE, mapMd(FOG_3)),
            (r) => write(r, MAP_FILE, mapMd(FOG_2)),
        );
        const range = await resolveFogRange(root, 'HEAD~1');
        expect('base' in range).toBe(true);
        expect(range.spec).toBe('HEAD~1..(working tree)');
    });

    test('skips, still naming the range, when HEAD has not diverged from the default branch', async () => {
        const root = scaffold(
            (r) => write(r, MAP_FILE, mapMd(FOG_3)),
            () => {},
        );
        git(root, ['checkout', 'main']);
        const range = await resolveFogRange(root);
        expect('skip' in range && range.skip).toContain('no divergence');
        expect(range.spec).toContain('..');
    });

    test('skips outside a git repository', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-fog-nogit-'));
        write(root, MAP_FILE, mapMd(FOG_3));
        const range = await resolveFogRange(root);
        expect('skip' in range && range.skip).toContain('not a git repository');
        expect(range.spec).toContain('..');
    });

    test('skips on a shallow clone rather than measuring a truncated history', async () => {
        const source = scaffold(
            (r) => write(r, MAP_FILE, mapMd(FOG_3)),
            (r) => write(r, MAP_FILE, mapMd(FOG_2)),
        );
        const dest = join(mkdtempSync(join(tmpdir(), 'spur-fog-shallow-')), 'clone');
        git(source, ['clone', '--depth', '1', '--branch', 'work', `file://${source}`, dest]);
        const range = await resolveFogRange(dest);
        expect('skip' in range && range.skip).toContain('shallow');
        expect(range.spec).toContain('..');
    });

    test('skips when no default branch exists to bound the range', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-fog-nomain-'));
        git(root, ['init']);
        git(root, ['symbolic-ref', 'HEAD', 'refs/heads/work']);
        git(root, ['config', 'user.email', 'test@example.com']);
        git(root, ['config', 'user.name', 'Test']);
        write(root, MAP_FILE, mapMd(FOG_3));
        git(root, ['add', '-A']);
        git(root, ['commit', '-m', 'base']);
        const range = await resolveFogRange(root);
        expect('skip' in range && range.skip).toContain('no default branch');
        expect(range.spec).toContain('..');
    });

    test('skips when --since names a ref that does not resolve', async () => {
        const root = scaffold(
            (r) => write(r, MAP_FILE, mapMd(FOG_3)),
            (r) => write(r, MAP_FILE, mapMd(FOG_2)),
        );
        const range = await resolveFogRange(root, 'no-such-ref');
        expect('skip' in range && range.skip).toContain('does not resolve');
    });

    test('a skipped range produces no findings and says so on stdout', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-fog-nogit-'));
        write(root, MAP_FILE, mapMd(FOG_3));
        const lines: string[] = [];
        expect(await ungraduatedFog(root, { report: (message) => lines.push(message) })).toEqual([]);
        expect(lines.join('\n')).toContain('SKIPPED');
        expect(lines.join('\n')).toContain('..');
    });
});

/* -------------------------------------------------------- real history */

describe('replay of the E1 graduation', () => {
    const reachable = ['ee0771ab~1', 'ee0771ab', 'c9bc177b'].every(
        (ref) =>
            Bun.spawnSync(['git', 'rev-parse', '--verify', `${ref}^{commit}`], {
                cwd: REPO,
                stdout: 'pipe',
                stderr: 'pipe',
            }).exitCode === 0,
    );

    test.if(reachable)('the whole session span passes — the fog edit and its tickets are both inside', async () => {
        expect(await inspectFog(REPO, { since: 'ee0771ab~1', head: 'c9bc177b' })).toEqual([]);
    });

    test.if(reachable)(
        'a range that stops at the fog commit false-positives — why the range is branch-scoped',
        async () => {
            const errors = await inspectFog(REPO, { since: 'ee0771ab~1', head: 'ee0771ab' });
            expect(errors.map((e) => e.id)).toEqual(['E1']);
        },
    );
});
