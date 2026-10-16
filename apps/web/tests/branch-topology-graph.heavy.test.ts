/**
 * Branch-topology gitGraph proof (task 1218 R3 / AC3, Plan step 4) — `test:heavy` only.
 *
 * The renderer suite pins the emitted text against an allow-list of permitted statements; this proof
 * pins that **mermaid itself** accepts it and rejects the shapes the renderer exists to avoid. The
 * graph text is not a hand-written fixture: a throwaway git repository is built here and the
 * source-local CLI renders it, so the parsed bytes are exactly what `spur builder show-branches`
 * prints. mermaid comes from apps/web's own dependency (the Board renders these blocks with it) — no
 * new dependency and no mermaid import in another workspace.
 *
 * Claim confidence (sp:source-driven-development; every external-API claim below is HIGH —
 * measured this session against the pinned source, which is the anchor on each line):
 *
 * - `mermaid@11.15.0` (`apps/web/package.json:28`; resolved to node_modules/.bun/mermaid@11.15.0) is
 *   the version the Board imports (`apps/web/src/modules/task-kanban/MarkdownBody.tsx:61`) and the
 *   one these assertions exercise.
 * - gitGraph's label sanitizer needs a DOM: with none registered, `mermaid.parse` throws
 *   `DOMPurify.sanitize is not a function` (measured against 11.15.0 this session, no shims).
 *   happy-dom supplies it. The DOMPurify shims (`./dompurify-happy-dom.ts:1`) are apps/web's own
 *   repair for DOMPurify's node-accessor reads under happy-dom, so a rendered-label assertion cannot
 *   pass or fail by accident.
 * - The four rejected shapes in `REJECTED_SHAPES` and the repeated-tag label count are the 11.15.0
 *   behaviours `renderGitGraph` is shaped around; each assertion carries its measured diagnostic.
 *
 * A failure that is only about the missing DOM is reported as an environment limitation and never
 * counted as a pass; a genuine lexer/parser/db rejection fails the proof. If a machine cannot build
 * the DOM at all, the allow-list test in the renderer suite stays the certified R3 check.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installDompurifyShims } from './dompurify-happy-dom';
import { registerHappyDom, teardownHappyDom } from './happy-dom';

type Mermaid = typeof import('mermaid').default;

/** Every statement the operator-referenced mermaid syntax subset allows, and nothing else (R3). */
const ALLOWED_STATEMENTS = [
    /^gitGraph$/,
    /^%%\{init: \{ 'theme': '[A-Za-z0-9._/-]+' \} \}%%$/,
    /^ {4}commit id:"[^"]+"( tag:"[^"]+")?( type: (NORMAL|HIGHLIGHT|REVERSE))?$/,
    /^ {4}branch (?:"[^"]+"|[A-Za-z0-9._/-]+)$/,
    /^ {4}checkout (?:"[^"]+"|[A-Za-z0-9._/-]+)$/,
    /^ {4}merge (?:"[^"]+"|[A-Za-z0-9._/-]+)( tag:"[^"]+")?$/,
];

/**
 * The mermaid behaviours the renderer's emitted shape depends on (all measured against mermaid
 * 11.15.0 this session): a lexer-invalid token, an equal-head merge, re-creating the implicit `main`
 * branch, and a second `branch` of the same name. Each must stay rejected, or the renderer's
 * workarounds (`checkout main`, one commit per join, de-duplicated ref tokens) would be dead code
 * hiding a silent rendering defect.
 */
const REJECTED_SHAPES: Array<[name: string, graph: string, diagnostic: string]> = [
    ['a branch token that cannot start a mermaid REFERENCE', 'gitGraph\n    branch 9362210', 'Parse error'],
    [
        'a merge whose heads are equal',
        ['gitGraph', '    commit id:"a1"', '    branch x', '    checkout main', '    merge x'].join('\n'),
        'Both branches have same head',
    ],
    [
        're-creating the implicit main branch',
        ['gitGraph', '    branch main', '    commit id:"a1"'].join('\n'),
        'existing branch',
    ],
    [
        'a second branch of the same name',
        ['gitGraph', '    commit id:"a1"', '    branch x', '    checkout main', '    branch x'].join('\n'),
        'existing branch',
    ],
];

/** A graph naming one tag twice: mermaid draws the label once per statement (measured 11.15.0). */
const DUPLICATE_TAG_GRAPH = [
    'gitGraph',
    '    commit id:"a1" tag:"v1.0.0" type: HIGHLIGHT',
    '    commit id:"b2" tag:"v1.0.0"',
].join('\n');

const CLI_ENTRY = join(import.meta.dir, '..', '..', '..', 'apps', 'cli', 'src', 'index.ts');
const TIMEOUT_MS = 60_000;

interface Attempt<T> {
    status: 'ok' | 'error' | 'dom-unavailable';
    message: string;
    value?: T;
}

registerHappyDom();
installDompurifyShims();
afterAll(teardownHappyDom);

const roots: string[] = [];

afterAll(() => {
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Hermetic git: identity and signing arrive per command, so no ambient config can change the exit. */
function git(cwd: string, args: string[]): string {
    const result = Bun.spawnSync(
        ['git', '-c', 'commit.gpgsign=false', '-c', 'user.name=Proof', '-c', 'user.email=proof@example.com', ...args],
        { cwd },
    );
    if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`);
    return result.stdout.toString();
}

function commit(cwd: string, file: string, message: string): void {
    writeFileSync(join(cwd, file), `${message}\n`);
    git(cwd, ['add', '.']);
    git(cwd, ['commit', '-q', '-m', message]);
}

/** The fixture repo: a tagged base, an open branch, a revert, a join, and hard-to-tokenize names. */
function mkRepo(): string {
    const repo = mkdtempSync(join(tmpdir(), 'spur-graph-proof-'));
    roots.push(repo);
    git(repo, ['init', '-q', '-b', 'main', '.']);
    commit(repo, 'a.txt', 'init');
    git(repo, ['tag', 'v1.0.0']);
    git(repo, ['checkout', '-q', '-b', 'feature/topology']);
    commit(repo, 'b.txt', 'feat: one');
    git(repo, ['revert', '--no-edit', 'HEAD']);
    commit(repo, 'c.txt', 'feat: two');
    git(repo, ['checkout', '-q', 'main']);
    git(repo, ['branch', 'stale/branch']);
    git(repo, ['branch', '1.x']);
    git(repo, ['branch', 'fix/quote"name']);
    return repo;
}

/**
 * A third fixture for the deep-fork case: `main` has five commits and `deep` forked at its second
 * (behind 3), so with the default `--max-commits 3` the fork point sits strictly outside the window
 * the base line draws — the shape whose fork node used to be drawn right of the base tip.
 */
function mkDeepForkRepo(): string {
    const repo = mkdtempSync(join(tmpdir(), 'spur-graph-deep-'));
    roots.push(repo);
    git(repo, ['init', '-q', '-b', 'main', '.']);
    commit(repo, 'a.txt', 'c1');
    commit(repo, 'b.txt', 'c2');
    git(repo, ['checkout', '-q', '-b', 'deep']);
    commit(repo, 'd.txt', 'deep: one');
    git(repo, ['checkout', '-q', 'main']);
    commit(repo, 'c.txt', 'c3');
    commit(repo, 'e.txt', 'c4');
    commit(repo, 'f.txt', 'c5');
    return repo;
}

/**
 * A second fixture for the case the artifact run hit: a remote exists, origin/HEAD points at
 * `origin/main`, and the local `main` has diverged from it. The base line is then `origin/main`
 * while a row named `main` is drawn through mermaid's implicit branch.
 */
function mkDivergedRepo(): string {
    const repo = mkRepo();
    const origin = mkdtempSync(join(tmpdir(), 'spur-graph-origin-'));
    roots.push(origin);
    git(origin, ['init', '-q', '--bare', '.']);
    git(repo, ['remote', 'add', 'origin', origin]);
    git(repo, ['push', '-q', 'origin', 'main', 'feature/topology']);
    commit(repo, 'd.txt', 'chore: local-only commit');
    commit(repo, 'e.txt', 'chore: another local commit');
    git(repo, ['fetch', '-q', 'origin']);
    git(repo, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
    return repo;
}

/** Run the verb in `repo` and return stdout (the proof only reads reports, never writes). */
function runReport(repo: string, args: string[] = []): string {
    const run = spawnSync(process.execPath, [CLI_ENTRY, 'builder', 'show-branches', '--no-logo', ...args], {
        cwd: repo,
        encoding: 'utf8',
    });
    if (run.status !== 0) {
        throw new Error(`builder show-branches failed (exit ${run.status}): ${(run.stderr ?? '').trim()}`);
    }
    return run.stdout ?? '';
}

/** The body of the report's single fenced mermaid block. */
function renderGraph(repo: string): string {
    const lines = runReport(repo).split('\n');
    const start = lines.indexOf('```mermaid');
    expect(start).toBeGreaterThan(-1);
    return lines.slice(start + 1, lines.indexOf('```', start + 1)).join('\n');
}

/** Classify a mermaid call: a graph rejection is a failure; a DOM-only error is the environment. */
async function attempt<T>(action: () => Promise<T>): Promise<Attempt<T>> {
    try {
        return { status: 'ok', message: '', value: await action() };
    } catch (err) {
        const message = (err instanceof Error ? err.message : String(err)).split('\n')[0] ?? '';
        // DOMPurify without a usable DOM is the one failure that says nothing about the graph.
        return { status: message.includes('DOMPurify') ? 'dom-unavailable' : 'error', message };
    }
}

/** Parse a graph it must accept; a rejection carries the rendered text for the gate log. */
async function expectParsed(mermaid: Mermaid, text: string): Promise<void> {
    const result = await attempt(() => mermaid.parse(text));
    if (result.status === 'dom-unavailable') {
        throw new Error(
            `environment limitation: mermaid.parse could not run — ${result.message}. ` +
                'The allow-list test below remains the certified R3 check on such a host.',
        );
    }
    if (result.status === 'error') {
        throw new Error(`mermaid rejected the CLI-rendered graph: ${result.message}\n${text}`);
    }
    expect(result.status).toBe('ok');
}

/** Render a diagram to SVG (a DOM-only failure is the environment, never a graph verdict). */
async function renderedSvg(mermaid: Mermaid, text: string, id: string): Promise<string> {
    const result = await attempt(async () => (await mermaid.render(id, text)).svg);
    if (result.status === 'dom-unavailable') {
        throw new Error(`environment limitation: mermaid.render could not run — ${result.message}.`);
    }
    if (result.status === 'error' || result.value === undefined) {
        throw new Error(`mermaid could not render the graph: ${result.message}`);
    }
    return result.value;
}

/** The `<text>` labels of a rendered diagram — what a reader actually sees. */
async function renderedLabels(mermaid: Mermaid, text: string, id: string): Promise<string[]> {
    return [...(await renderedSvg(mermaid, text, id)).matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(
        (match) => match[1] ?? '',
    );
}

/**
 * label → x of a rendered diagram. mermaid@11.15.0 (`apps/web/package.json:28`, HIGH — measured this
 * session) lays commit statements out left to right in statement order, which is the premise the
 * base-line ordering in `renderGitGraph` relies on; the deep-fork test below asserts it in-tree.
 */
async function renderedX(mermaid: Mermaid, text: string, id: string): Promise<Record<string, number>> {
    const positions: Record<string, number> = {};
    for (const match of (await renderedSvg(mermaid, text, id)).matchAll(
        /<text[^>]*x="([\d.]+)"[^>]*>([^<]*)<\/text>/g,
    )) {
        const label = (match[2] ?? '').trim();
        if (label.length > 0) positions[label] = Number(match[1]);
    }
    return positions;
}

describe('branch-topology gitGraph against the pinned mermaid', () => {
    let mermaid: Mermaid;
    let graph: string;
    let diverged: string;

    beforeAll(async () => {
        mermaid = (await import('mermaid')).default;
        // The Board's own initialization (MarkdownBody.tsx): 'strict' would strip HTML labels.
        mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
        graph = renderGraph(mkRepo());
        diverged = renderGraph(mkDivergedRepo());
    }, TIMEOUT_MS);

    test(
        'the CLI-rendered graph matches the allowed statement set',
        () => {
            expect(graph.split('\n')[0]).toBe('gitGraph');
            // The fixture exercises the quoted-branch form and a join, so the allow-list check is real.
            expect(graph).toContain('    branch "1.x"');
            expect(graph).toContain('    merge "1.x"');
            expect(graph).toContain('    branch fix/quote-name');
            for (const line of graph.split('\n')) {
                expect(ALLOWED_STATEMENTS.some((pattern) => pattern.test(line))).toBe(true);
            }
        },
        TIMEOUT_MS,
    );

    test(
        'mermaid parses the CLI-rendered graph',
        async () => {
            await expectParsed(mermaid, graph);
        },
        TIMEOUT_MS,
    );

    test(
        'mermaid parses a graph whose base is origin/main with a diverged local main',
        async () => {
            expect(diverged).toContain('    branch origin/main');
            expect(diverged).toContain('    checkout main\n');
            await expectParsed(mermaid, diverged);
        },
        TIMEOUT_MS,
    );

    test(
        'a fork deeper than the shown window is drawn left of every base-window commit',
        async () => {
            const repo = mkDeepForkRepo();
            const report = JSON.parse(runReport(repo, ['--format', 'json'])) as {
                branches: Array<{
                    name: string;
                    behind: number;
                    forkPoint: string;
                    commits: Array<{ sha: string }>;
                }>;
            };
            const base = report.branches.find((row) => row.name === 'main');
            const deep = report.branches.find((row) => row.name === 'deep');
            expect(base?.commits).toHaveLength(5);
            expect(deep?.behind).toBe(3);
            // The window the graph draws: maxCommits 3 of the base row.
            const window = (base?.commits ?? []).slice(0, 3).map((commit) => commit.sha.slice(0, 7));
            expect(window).toHaveLength(3);
            expect(window).not.toContain(deep?.forkPoint.slice(0, 7) ?? '');

            const graphText = renderGraph(repo);
            const positions = await renderedX(mermaid, graphText, 'probe-deep-fork');
            const forkX = positions[deep?.forkPoint.slice(0, 7) ?? ''];

            // The premise the base-line order depends on: declaring commits in age order draws them in
            // age order, because mermaid advances the diagram in statement order.
            const declared = [...graphText.matchAll(/commit id:"([^"]+)"/g)].map((match) => match[1] ?? '');
            const xs = declared.map((label) => positions[label] ?? Number.NaN);
            expect(declared).toHaveLength(5);
            expect(xs.every((x) => Number.isFinite(x))).toBe(true);
            expect(xs).toEqual([...xs].sort((a, b) => a - b));

            expect(typeof forkX).toBe('number');
            for (const sha of window) {
                expect(typeof positions[sha]).toBe('number');
                expect(forkX).toBeLessThan(positions[sha] ?? Number.NEGATIVE_INFINITY);
            }
        },
        TIMEOUT_MS,
    );

    test(
        'a repeated tag renders two labels, which is why the renderer claims each tag once',
        async () => {
            const duplicated = await renderedLabels(mermaid, DUPLICATE_TAG_GRAPH, 'probe-duplicate-tag');
            const ours = await renderedLabels(mermaid, graph, 'probe-rendered-tag');
            const ourTags = [...graph.matchAll(/tag:"([^"]+)"/g)].map((match) => match[1] ?? '');

            // Control: mermaid does draw the label once per statement naming it.
            expect(duplicated.filter((label) => label === 'v1.0.0')).toHaveLength(2);
            expect(ourTags.length).toBeGreaterThan(0);
            for (const tag of ourTags) {
                expect(ours.filter((label) => label === tag)).toHaveLength(1);
            }
        },
        TIMEOUT_MS,
    );

    test.each(REJECTED_SHAPES)(
        'mermaid still rejects %s (the renderer works around it)',
        async (_name, text, diagnostic) => {
            const result = await attempt(() => mermaid.parse(text));

            expect(result.status).toBe('error');
            expect(result.message).toContain(diagnostic);
        },
        TIMEOUT_MS,
    );
});
