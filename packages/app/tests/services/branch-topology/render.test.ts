/**
 * render.test — the three pure renderers (task 1218 R2/R3/R4). Fixtures are hand-built
 * {@link BranchTopology} models, so this suite pins the *rendering* contract: json/text carry the same
 * rows, markdown carries the same rows plus one fenced mermaid block, and every emitted graph line
 * stays inside the operator-referenced statement set.
 */
import { describe, expect, test } from 'bun:test';
import type { BranchRow, BranchTopology } from '../../../src/services/branch-topology';
import { type GraphOptions, renderGitGraph, renderMarkdown, renderText } from '../../../src/services/branch-topology';

const BASE = '1111111111111111111111111111111111111111';
const ROOT = '0000000000000000000000000000000000000000';
const TIP = '2222222222222222222222222222222222222222';
const MID = '3333333333333333333333333333333333333333';
const REVERT = '4444444444444444444444444444444444444444';
const STALE = '5555555555555555555555555555555555555555';
// Distinct 7-character prefixes for the deep-fork fixture: C1 is the oldest base commit, C6 the tip.
const C1 = 'aaaaaaa1111111111111111111111111111111111';
const C2 = 'bbbbbbb2222222222222222222222222222222222';
const C3 = 'ccccccc3333333333333333333333333333333333';
const C4 = 'ddddddd4444444444444444444444444444444444';
const C5 = 'eeeeeee5555555555555555555555555555555555';
const C6 = 'fffffff6666666666666666666666666666666666';
const D1 = '1111111d11111111111111111111111111111111';
const D2 = '2222222d22222222222222222222222222222222';
const O1 = '3333333o33333333333333333333333333333333';
const S1 = '4444444s44444444444444444444444444444444';

const GRAPH: GraphOptions = { maxCommits: 3, hideContained: false };

/** Every statement the operator-referenced mermaid syntax subset allows, and nothing else. */
const ALLOWED_STATEMENTS = [
    /^gitGraph$/,
    /^%%\{init: \{ 'theme': '[A-Za-z0-9._/-]+' \} \}%%$/,
    /^ {4}commit id:"[^"]+"( tag:"[^"]+")?( type: (NORMAL|HIGHLIGHT|REVERSE))?$/,
    /^ {4}branch (?:"[^"]+"|[A-Za-z0-9._/-]+)$/,
    /^ {4}checkout (?:"[^"]+"|[A-Za-z0-9._/-]+)$/,
    /^ {4}merge (?:"[^"]+"|[A-Za-z0-9._/-]+)( tag:"[^"]+")?$/,
];

function row(overrides: Partial<BranchRow>): BranchRow {
    return {
        name: 'feature/x',
        kind: 'local',
        tip: TIP,
        forkPoint: BASE,
        ahead: 2,
        behind: 0,
        contained: false,
        lastCommitAt: '2026-10-16T09:00:00-07:00',
        subject: 'feat: tip',
        worktree: null,
        pr: null,
        commits: [],
        ...overrides,
    };
}

/** base row (contained, one tagged commit) + a two-commit feature branch + a contained stale branch. */
function fixture(overrides: Partial<BranchTopology> = {}): BranchTopology {
    return {
        base: 'main',
        generatedAt: '2026-10-16T16:00:00.000Z',
        branches: [
            row({}),
            row({
                name: 'main',
                tip: BASE,
                forkPoint: BASE,
                ahead: 0,
                contained: true,
                subject: 'init',
                worktree: '/repo/main',
                commits: [{ sha: BASE, subject: 'init', tags: ['v0.1.0'] }],
            }),
            row({ name: 'stale', tip: BASE, forkPoint: BASE, ahead: 0, contained: true }),
        ],
        omitted: 0,
        warnings: [],
        ...overrides,
    };
}

describe('renderMarkdown', () => {
    test('prints the title, the table, and exactly one fenced mermaid block', () => {
        const markdown = renderMarkdown(fixture(), GRAPH);

        expect(markdown).toContain('## Branch topology vs `main`');
        expect(markdown).toContain('Generated 2026-10-16T16:00:00.000Z.');
        expect(markdown).toContain('| branch | ahead | behind | contained | last commit | worktree | PR |');
        expect(markdown).toContain('| feature/x | 2 | 0 | no | 2026-10-16 | - | - |');
        expect(markdown).toContain('| main | 0 | 0 | yes | 2026-10-16 | /repo/main | - |');
        expect(markdown.match(/```mermaid/g)).toHaveLength(1);
        expect(markdown.split('```mermaid')[1]?.split('\n')[1]).toBe('gitGraph');
    });

    test('renders warnings and the omitted-branch footer', () => {
        const markdown = renderMarkdown(
            fixture({ warnings: ['--pr: gh pr list failed: gh auth login'], omitted: 4 }),
            GRAPH,
        );

        expect(markdown).toContain('> warning: --pr: gh pr list failed: gh auth login');
        expect(markdown).toContain('_Omitted: 4 branches beyond --limit._');
    });

    test('carries the pull-request cell when a row has state', () => {
        const markdown = renderMarkdown(
            fixture({
                branches: [row({ pr: { number: 581, state: 'OPEN', reviewDecision: null } })],
            }),
            GRAPH,
        );

        expect(markdown).toContain('| feature/x | 2 | 0 | no | 2026-10-16 | - | #581 OPEN |');
    });
});

describe('renderText', () => {
    test('prints the same rows as an aligned table with no mermaid', () => {
        const text = renderText(fixture());

        expect(text).not.toContain('gitGraph');
        expect(text).not.toContain('```');
        expect(text.startsWith('base: main\ngenerated: 2026-10-16T16:00:00.000Z\n')).toBe(true);
        for (const model of fixture().branches) {
            const line = text.split('\n').find((candidate) => candidate.startsWith(model.name));
            expect(line).toBeDefined();
            expect(line).toContain(String(model.ahead));
        }
        expect(text.split('\n').find((line) => line.startsWith('main'))).toContain('/repo/main');
    });

    test('prints warnings and the omitted footer', () => {
        const text = renderText(fixture({ warnings: ['git worktree list failed: boom'], omitted: 1 }));

        expect(text).toContain('warning: git worktree list failed: boom');
        expect(text).toContain('Omitted: 1 branch beyond --limit.');
    });
});

describe('renderGitGraph', () => {
    test('every emitted line matches the allowed statement set', () => {
        const rich = fixture({
            base: 'release/1.x',
            branches: [
                row({
                    name: 'fix/quote"name',
                    ahead: 9,
                    commits: [
                        { sha: TIP, subject: 'feat: tip', tags: ['v1.2.3'] },
                        { sha: REVERT, subject: 'Revert "feat: one"', tags: [] },
                        { sha: MID, subject: 'feat: middle', tags: [] },
                    ],
                }),
                row({
                    name: 'main',
                    tip: BASE,
                    forkPoint: BASE,
                    ahead: 0,
                    contained: true,
                    commits: [{ sha: BASE, subject: 'init', tags: ['v0.1.0'] }],
                }),
                row({
                    name: '1.x',
                    tip: BASE,
                    forkPoint: ROOT,
                    ahead: 0,
                    contained: true,
                    commits: [],
                }),
            ],
        });
        const lines = renderGitGraph(rich, { maxCommits: 3, hideContained: false, theme: 'neutral' });

        expect(lines.split('\n')[0]).toBe("%%{init: { 'theme': 'neutral' } }%%");
        expect(lines.split('\n')[1]).toBe('gitGraph');
        for (const line of lines.split('\n')) {
            expect(ALLOWED_STATEMENTS.some((pattern) => pattern.test(line))).toBe(true);
        }
    });

    test('draws the base line, one branch statement per non-contained row, and a join per contained row', () => {
        const graph = renderGitGraph(fixture(), GRAPH).split('\n');

        expect(graph).toContain('    commit id:"1111111" tag:"v0.1.0" type: HIGHLIGHT');
        expect(graph).toContain('    branch feature/x');
        expect(graph.filter((line) => line === '    branch main')).toEqual([]);
        expect(graph).toContain('    branch stale');
        // A contained branch needs a commit of its own before it can merge back (mermaid refuses
        // equal heads), so its node repeats the base commit under a de-duplicated id.
        expect(graph).toContain('    commit id:"1111111-2"');
        expect(graph).toContain('    merge stale');
        // The base commit already claimed v0.1.0, so the join does not repeat it.
        expect(graph.filter((line) => line.includes('tag:"v0.1.0"'))).toHaveLength(1);
    });

    test('--hide-contained drops contained branches from the graph only', () => {
        const hidden = renderGitGraph(fixture(), { ...GRAPH, hideContained: true });

        expect(hidden).not.toContain('branch stale');
        expect(renderMarkdown(fixture(), { ...GRAPH, hideContained: true })).toContain('| stale |');
    });

    test('caps commit nodes with a +N earlier summary node and highlights the tip', () => {
        const topology = fixture({
            branches: [
                row({
                    ahead: 5,
                    commits: [
                        { sha: TIP, subject: 'feat: five', tags: [] },
                        { sha: REVERT, subject: 'feat: four', tags: [] },
                        { sha: MID, subject: 'feat: three', tags: [] },
                        { sha: ROOT, subject: 'feat: two', tags: [] },
                    ],
                }),
                row({ name: 'main', tip: BASE, forkPoint: BASE, ahead: 0, contained: true, commits: [] }),
            ],
        });
        const graph = renderGitGraph(topology, GRAPH).split('\n');
        const commits = graph.filter((line) => line.startsWith('    commit')).map((line) => line.trim());

        // The base row carries no window here, so its fork point opens the base line first.
        expect(commits).toEqual([
            'commit id:"1111111"',
            'commit id:"+2 earlier"',
            'commit id:"3333333"',
            'commit id:"4444444"',
            'commit id:"2222222" type: HIGHLIGHT',
        ]);
        expect(commits.filter((line) => line.includes('HIGHLIGHT'))).toHaveLength(1);
    });

    test('marks a shown revert as REVERSE and keeps a revert tip HIGHLIGHT', () => {
        const topology = fixture({
            branches: [
                row({
                    ahead: 2,
                    commits: [
                        { sha: TIP, subject: 'feat: tip', tags: [] },
                        { sha: REVERT, subject: 'Revert "feat: one"', tags: [] },
                    ],
                }),
                row({ name: 'main', tip: BASE, forkPoint: BASE, ahead: 0, contained: true, commits: [] }),
                row({ name: 'stale', tip: BASE, forkPoint: BASE, ahead: 0, contained: true }),
            ],
        });
        const graph = renderGitGraph(topology, GRAPH);

        expect(graph).toContain('    commit id:"4444444" type: REVERSE');
        expect(graph).toContain('    commit id:"2222222" type: HIGHLIGHT');

        const revertTip = renderGitGraph(
            fixture({
                branches: [
                    row({ ahead: 1, commits: [{ sha: REVERT, subject: 'Revert "feat: one"', tags: [] }] }),
                    row({ name: 'main', tip: BASE, forkPoint: BASE, ahead: 0, contained: true, commits: [] }),
                    row({ name: 'stale', tip: BASE, forkPoint: BASE, ahead: 0, contained: true }),
                ],
            }),
            GRAPH,
        );
        expect(revertTip).toContain('    commit id:"4444444" type: HIGHLIGHT');
    });

    test('sanitizes quotes and quotes a name that cannot start a mermaid token', () => {
        const topology = fixture({
            branches: [
                row({ name: 'fix/quote"name', ahead: 1, commits: [{ sha: TIP, subject: 'feat: tip', tags: [] }] }),
                row({ name: '1.x', tip: BASE, forkPoint: BASE, ahead: 0, contained: true }),
                row({ name: 'main', tip: BASE, forkPoint: BASE, ahead: 0, contained: true, commits: [] }),
            ],
        });
        const graph = renderGitGraph(topology, GRAPH);

        expect(graph).toContain('    branch fix/quote-name');
        expect(graph).toContain('    branch "1.x"');
        expect(graph).toContain('    merge "1.x"');
    });

    test('emits one de-duplicated base node per distinct fork point inside the window', () => {
        // Both rows fork at MID, which the base window already draws one commit behind the tip.
        const topology = fixture({
            branches: [
                row({
                    name: 'one',
                    ahead: 1,
                    behind: 1,
                    forkPoint: MID,
                    commits: [{ sha: TIP, subject: 'feat: one', tags: [] }],
                }),
                row({
                    name: 'two',
                    ahead: 1,
                    behind: 1,
                    forkPoint: MID,
                    commits: [{ sha: TIP, subject: 'feat: two', tags: [] }],
                }),
                row({
                    name: 'main',
                    tip: BASE,
                    forkPoint: BASE,
                    ahead: 0,
                    contained: true,
                    commits: [
                        { sha: BASE, subject: 'init', tags: [] },
                        { sha: MID, subject: 'earlier', tags: [] },
                    ],
                }),
                row({ name: 'stale', tip: BASE, forkPoint: BASE, ahead: 0, contained: true }),
            ],
        });
        const graph = renderGitGraph(topology, GRAPH);

        expect(graph.match(/commit id:"3333333"/g)).toHaveLength(1);
        // A fork point the window draws is never repeated as a separate statement.
        expect(graph).not.toContain('checkout main\n    commit id:"3333333"');
    });

    test('a fork deeper than the base window is drawn before it, deepest first', () => {
        // main = C1..C6 (window with maxCommits 3 = C4, C5, C6, tip last); `older` forked at C1
        // (behind 5), `deep` at C2 (behind 4) and `shallow` at C5 (behind 1, inside the window).
        const commits = (shas: string[]) => shas.map((sha) => ({ sha, subject: sha.slice(0, 7), tags: [] }));
        const topology: BranchTopology = {
            base: 'main',
            generatedAt: '2026-10-16T16:00:00.000Z',
            omitted: 0,
            warnings: [],
            branches: [
                // Listed newest-commit-first, so the hoist order can only come from the comparator.
                row({ name: 'deep', tip: D2, forkPoint: C2, ahead: 2, behind: 4, commits: commits([D2, D1]) }),
                row({ name: 'older', tip: O1, forkPoint: C1, ahead: 1, behind: 5, commits: commits([O1]) }),
                row({ name: 'shallow', tip: S1, forkPoint: C5, ahead: 1, behind: 1, commits: commits([S1]) }),
                row({
                    name: 'main',
                    tip: C6,
                    forkPoint: C6,
                    ahead: 0,
                    contained: true,
                    commits: commits([C6, C5, C4, C3, C2, C1]),
                }),
                row({ name: 'stale', tip: C6, forkPoint: C6, ahead: 0, contained: true }),
            ],
        };
        const lines = renderGitGraph(topology, GRAPH).split('\n');
        const firstCheckout = lines.findIndex((line) => line.startsWith('    checkout'));
        // Graph ids are 7-character abbreviations of the commit shas.
        const id = (sha: string): string => sha.slice(0, 7);
        const baseLineIds = lines
            .slice(0, firstCheckout)
            .filter((line) => line.startsWith('    commit'))
            .map((line) => line.match(/id:"([^"]+)"/)?.[1] ?? '');

        // Strictly increasing in age, deepest fork first, base tip last — mermaid draws in this order.
        expect(baseLineIds).toEqual([C1, C2, C4, C5, C6].map(id));
        expect(lines.filter((line) => line.includes(`id:"${id(C5)}"`))).toHaveLength(1);
        expect(lines.find((line) => line.includes(`id:"${id(C6)}"`))).toContain('type: HIGHLIGHT');
        // Every base-line commit is declared before the deep fork's branch statement.
        const forkIndex = lines.findIndex((line) => line.includes(`id:"${id(C1)}"`));
        const deepBranchIndex = lines.indexOf('    branch deep');
        expect(forkIndex).toBeLessThan(deepBranchIndex);
    });

    test('a single-branch repository renders the base line only', () => {
        const graph = renderGitGraph(
            fixture({
                branches: [
                    row({
                        name: 'main',
                        tip: BASE,
                        forkPoint: BASE,
                        ahead: 0,
                        contained: true,
                        commits: [{ sha: BASE, subject: 'init', tags: [] }],
                    }),
                ],
            }),
            GRAPH,
        );

        expect(graph).toBe('gitGraph\n    commit id:"1111111" type: HIGHLIGHT');
    });

    test('a branch sitting on its own fork point is drawn with one node, not a duplicate', () => {
        const graph = renderGitGraph(
            fixture({
                branches: [
                    row({
                        name: 'main',
                        tip: BASE,
                        forkPoint: BASE,
                        ahead: 0,
                        contained: true,
                        commits: [{ sha: BASE, subject: 'init', tags: [] }],
                    }),
                    row({ name: 'stale', tip: STALE, forkPoint: STALE, ahead: 0, contained: true, commits: [] }),
                ],
            }),
            GRAPH,
        );

        expect(graph).toContain('    branch stale\n    commit id:"5555555"');
        expect(graph).toContain('    merge stale');
        expect(graph.match(/commit id:"5555555"/g)).toHaveLength(1);
    });

    test('a join without a known tag carries no tag at all', () => {
        const graph = renderGitGraph(
            fixture({
                branches: [
                    row({ name: 'main', tip: BASE, forkPoint: BASE, ahead: 0, contained: true, commits: [] }),
                    row({ name: 'stale', tip: STALE, forkPoint: BASE, ahead: 0, contained: true, commits: [] }),
                ],
            }),
            GRAPH,
        );

        expect(graph.endsWith('    merge stale')).toBe(true);
    });

    test('a join whose commit carries a tag names it on the branch tip node, never twice', () => {
        const graph = renderGitGraph(
            fixture({
                branches: [
                    row({
                        ahead: 5,
                        commits: [
                            { sha: TIP, subject: 'feat: tip', tags: [] },
                            { sha: MID, subject: 'feat: mid', tags: [] },
                            { sha: STALE, subject: 'feat: deep', tags: ['v9.9.9'] },
                        ],
                    }),
                    row({
                        name: 'main',
                        tip: BASE,
                        forkPoint: BASE,
                        ahead: 0,
                        contained: true,
                        commits: [{ sha: BASE, subject: 'init', tags: [] }],
                    }),
                    row({ name: 'stale', tip: STALE, forkPoint: BASE, ahead: 0, contained: true, commits: [] }),
                ],
            }),
            { maxCommits: 2, hideContained: false },
        );

        expect(graph).toContain('    commit id:"5555555" tag:"v9.9.9"');
        expect(graph.endsWith('    merge stale')).toBe(true);
        expect(graph.match(/tag:"v9\.9\.9"/g)).toHaveLength(1);
    });

    test('a diverged local twin of the base is drawn as its own branch, not folded into the base', () => {
        // base = origin/main (exact row) while the local main sits 3 commits ahead of it.
        const graph = renderGitGraph(
            {
                base: 'origin/main',
                generatedAt: '2026-10-16T16:00:00.000Z',
                branches: [
                    row({
                        name: 'origin/main',
                        kind: 'remote',
                        tip: BASE,
                        forkPoint: BASE,
                        ahead: 0,
                        contained: true,
                        commits: [{ sha: BASE, subject: 'init', tags: [] }],
                    }),
                    row({
                        name: 'main',
                        ahead: 3,
                        behind: 0,
                        forkPoint: BASE,
                        commits: [
                            { sha: TIP, subject: 'feat: tip', tags: [] },
                            { sha: MID, subject: 'feat: mid', tags: [] },
                        ],
                    }),
                ],
                omitted: 0,
                warnings: [],
            },
            GRAPH,
        );

        expect(graph.split('\n')[0]).toBe('gitGraph');
        expect(graph).toContain('    branch origin/main');
        expect(graph).toContain('    commit id:"1111111" type: HIGHLIGHT');
        // mermaid owns the implicit `main` branch, so the row is drawn by checking it out.
        expect(graph).toContain('    checkout main\n    commit id:"+1 earlier"');
        expect(graph).toContain('    commit id:"2222222" type: HIGHLIGHT');
    });

    test('two refs that sanitize onto one token still get one branch each', () => {
        const graph = renderGitGraph(
            fixture({
                branches: [
                    row({ name: 'fix/quote"name', ahead: 1, commits: [{ sha: TIP, subject: 'feat: tip', tags: [] }] }),
                    row({ name: 'fix/quote-name', tip: BASE, forkPoint: BASE, ahead: 0, contained: true }),
                    row({ name: 'main', tip: BASE, forkPoint: BASE, ahead: 0, contained: true, commits: [] }),
                ],
            }),
            GRAPH,
        );

        expect(graph).toContain('    branch fix/quote-name\n');
        expect(graph).toContain('    branch fix/quote-name-2');
        expect(graph).toContain('    merge fix/quote-name-2');
    });

    test('a long ref name is drawn whole: truncation is a commit-id rule only', () => {
        const long = 'origin/chore/task-1211-absorption-handoff';
        const graph = renderGitGraph(
            fixture({
                branches: [
                    row({ name: long, ahead: 1, commits: [{ sha: TIP, subject: 'feat: tip', tags: [] }] }),
                    row({ name: 'main', tip: BASE, forkPoint: BASE, ahead: 0, contained: true, commits: [] }),
                ],
            }),
            GRAPH,
        );

        expect(graph).toContain(`    branch ${long}`);
        // The pre-fix renderer cut the label at 40 characters, which misreports the ref name.
        expect(graph).not.toContain('handof\n');
    });

    test('never emits the same tag value twice in one diagram', () => {
        // Two rows whose tips are the same tagged commit: only the first statement may name the tag.
        const graph = renderGitGraph(
            fixture({
                branches: [
                    row({ name: 'one', ahead: 1, commits: [{ sha: TIP, subject: 'feat: one', tags: ['v1.2.3'] }] }),
                    row({ name: 'two', ahead: 1, commits: [{ sha: TIP, subject: 'feat: two', tags: ['v1.2.3'] }] }),
                    row({
                        name: 'main',
                        tip: BASE,
                        forkPoint: BASE,
                        ahead: 0,
                        contained: true,
                        commits: [{ sha: BASE, subject: 'init', tags: ['v1.2.3'] }],
                    }),
                    row({ name: 'stale', tip: BASE, forkPoint: BASE, ahead: 0, contained: true }),
                ],
            }),
            GRAPH,
        );

        expect(graph.match(/tag:"v1\.2\.3"/g)).toHaveLength(1);
        expect(graph).toContain('    commit id:"1111111" tag:"v1.2.3"');
    });
});
