/**
 * branch-topology.test — `collectBranchTopology` against a stubbed {@link CommandRunner} built from
 * canned git/gh output (the pr-review test pattern): base resolution, ref folding, scope filters,
 * worktrees, tag/commit windows, `--pr` enrichment + degradation, and the read-only invariant.
 *
 * No real repository and no subprocess: the runner records every command it is asked to run, so the
 * suite can also assert that the collector never issues a mutating git verb (task 1218 R1).
 */
import { describe, expect, test } from 'bun:test';
import {
    BranchTopologyGitError,
    collectBranchTopology,
    GRAPH_COMMIT_WINDOW,
} from '../../../src/services/branch-topology';
import { isBaseRow } from '../../../src/services/branch-topology/render';
import type { CmdResult, CommandRunner } from '../../../src/services/pr-review';

const M0 = 'aaaa0000000000000000000000000000000000000a';
const M1 = 'bbbb1111111111111111111111111111111111111b';
const F1 = 'cccc2222222222222222222222222222222222222c';
const F2 = 'dddd3333333333333333333333333333333333333d';
const L0 = 'eeee4444444444444444444444444444444444444e';
const L1 = 'ffff5555555555555555555555555555555555555f';

const TAG_OBJECT = '9999999999999999999999999999999999999999';
const DATE = '2026-10-16T09:00:00-07:00';
const OLDER = '2026-10-15T09:00:00-07:00';

function ok(stdout: string): CmdResult {
    return { code: 0, stdout, stderr: '' };
}

function failed(stderr: string, code = 128): CmdResult {
    return { code, stdout: '', stderr };
}

/** Routes a command array by its joined string; an unstubbed command fails the test loudly. */
function makeRunner(routes: Record<string, CmdResult>): { runner: CommandRunner; commands: string[] } {
    const commands: string[] = [];
    const runner: CommandRunner = (cmd) => {
        const key = cmd.join(' ');
        commands.push(key);
        const route = routes[key];
        if (route === undefined) throw new Error(`unstubbed command: ${key}`);
        return route;
    };
    return { runner, commands };
}

/** The fixture repo: local `main` (base tip, tagged, at the tagged base commit), local `feature/x`
 * two commits ahead, contained local `stale`, remote-only `origin/legacy`, and folded remote twins. */
function repoRoutes(overrides: Record<string, CmdResult> = {}): Record<string, CmdResult> {
    const refs = [
        `refs/heads/main\u0000${M1}`,
        `refs/heads/feature/x\u0000${F2}`,
        `refs/heads/stale\u0000${M1}`,
        `refs/remotes/origin/HEAD\u0000${M1}`,
        `refs/remotes/origin/main\u0000${M1}`,
        `refs/remotes/origin/feature/x\u0000${F2}`,
        `refs/remotes/origin/legacy\u0000${L1}`,
    ].join('\n');
    const worktrees = [
        'worktree /repo/main',
        `HEAD ${M1}`,
        'branch refs/heads/main',
        '',
        'worktree /repo/linked',
        `HEAD ${F2}`,
        'branch refs/heads/feature/x',
        '',
    ].join('\n');
    return {
        'git symbolic-ref --short refs/remotes/origin/HEAD': ok('origin/main\n'),
        'git rev-parse --verify --quiet origin/main^{commit}': ok(`${M1}\n`),
        'git for-each-ref --format=%(refname)%00%(objectname) refs/heads refs/remotes': ok(refs),
        'git for-each-ref --format=%(refname)%00%(objectname) refs/heads': ok(refs.split('\n').slice(0, 3).join('\n')),
        'git for-each-ref --format=%(refname)%00%(objectname) refs/remotes': ok(refs.split('\n').slice(3).join('\n')),
        'git worktree list --porcelain': ok(worktrees),
        'git for-each-ref --format=%(objectname) %(*objectname) %(refname:short) refs/tags': ok(
            `${M1}  v0.1.0\n${TAG_OBJECT} ${L1} annotated\n`,
        ),
        'git symbolic-ref --short -q HEAD': ok('main\n'),
        [`git merge-base ${M1} ${M1}`]: ok(`${M1}\n`),
        [`git merge-base ${M1} ${F2}`]: ok(`${M1}\n`),
        [`git merge-base ${M1} ${L1}`]: ok(`${L0}\n`),
        [`git rev-list --left-right --count ${M1}...${M1}`]: ok('0\t0\n'),
        [`git rev-list --left-right --count ${M1}...${F2}`]: ok('0\t2\n'),
        [`git rev-list --left-right --count ${M1}...${L1}`]: ok('1\t3\n'),
        [`git log -1 --format=%H%x00%cI%x00%s ${M1}`]: ok(`${M1}\u0000${DATE}\u0000init\n`),
        [`git log -1 --format=%H%x00%cI%x00%s ${F2}`]: ok(`${F2}\u0000${DATE}\u0000feat: two\n`),
        [`git log -1 --format=%H%x00%cI%x00%s ${L1}`]: ok(`${L1}\u0000${OLDER}\u0000legacy: one\n`),
        [`git log -n ${GRAPH_COMMIT_WINDOW} --format=%H%x00%s ${M1}`]: ok(`${M1}\u0000init\n${M0}\u0000root\n`),
        [`git log -n ${GRAPH_COMMIT_WINDOW} --format=%H%x00%s ${F2}`]: ok(
            `${F2}\u0000feat: two\n${F1}\u0000feat: one\n${M1}\u0000init\n`,
        ),
        [`git log -n ${GRAPH_COMMIT_WINDOW} --format=%H%x00%s ${L1}`]: ok(
            `${L1}\u0000legacy: one\n${L0}\u0000legacy: base\n`,
        ),
        ...overrides,
    };
}

const GH_PR_LIST = 'gh pr list --state open --json number,headRefName,state,reviewDecision --limit 200';

describe('collectBranchTopology — rows', () => {
    test('resolves the base from origin/HEAD and folds a remote ref into its local twin', () => {
        const { runner, commands } = makeRunner(repoRoutes());
        const topology = collectBranchTopology(runner, { scope: 'all', pr: false, limit: 30 });

        expect(topology.base).toBe('origin/main');
        expect(topology.branches.map((row) => row.name)).toEqual(['feature/x', 'main', 'stale', 'origin/legacy']);
        expect(topology.branches.map((row) => row.kind)).toEqual(['local', 'local', 'local', 'remote']);
        expect(topology.omitted).toBe(0);
        expect(topology.warnings).toEqual([]);
        expect(Number.isNaN(Date.parse(topology.generatedAt))).toBe(false);
        // origin/HEAD is a symbolic ref, never a row.
        expect(commands).toContain('git symbolic-ref --short refs/remotes/origin/HEAD');
    });

    test('each row carries fork point, ahead/behind, containment, last commit and worktree', () => {
        const { runner } = makeRunner(repoRoutes());
        const topology = collectBranchTopology(runner, { scope: 'all', pr: false, limit: 30 });
        const [feature, main, stale, legacy] = topology.branches;

        expect(feature).toMatchObject({
            tip: F2,
            forkPoint: M1,
            ahead: 2,
            behind: 0,
            contained: false,
            lastCommitAt: DATE,
            subject: 'feat: two',
            worktree: '/repo/linked',
            pr: null,
        });
        expect(main).toMatchObject({ forkPoint: M1, ahead: 0, behind: 0, contained: true, worktree: '/repo/main' });
        // Zero commits ahead of the base is what makes a stale branch visible.
        expect(stale).toMatchObject({ ahead: 0, contained: true, worktree: null });
        expect(legacy).toMatchObject({ forkPoint: L0, ahead: 3, behind: 1, contained: false, worktree: null });
    });

    test('rows sort by last-commit desc then name, and --limit reports the omitted count', () => {
        const { runner } = makeRunner(repoRoutes());
        const topology = collectBranchTopology(runner, { scope: 'all', pr: false, limit: 2 });

        // legacy is older than the three DATE rows; the DATE rows tie and sort by name.
        expect(topology.branches.map((row) => row.name)).toEqual(['feature/x', 'main']);
        expect(topology.omitted).toBe(2);
    });

    test('--local and --remote filter the ref namespace before folding', () => {
        const local = collectBranchTopology(makeRunner(repoRoutes()).runner, { scope: 'local', pr: false, limit: 30 });
        expect(local.branches.map((row) => row.kind)).toEqual(['local', 'local', 'local']);

        const remote = collectBranchTopology(makeRunner(repoRoutes()).runner, {
            scope: 'remote',
            pr: false,
            limit: 30,
        });
        expect(remote.branches.map((row) => row.name)).toEqual(['origin/feature/x', 'origin/main', 'origin/legacy']);
        expect(remote.branches.every((row) => row.kind === 'remote')).toBe(true);
    });

    test('a detached HEAD adds a row named by its short sha, mapped to its worktree', () => {
        const worktrees = ['worktree /repo/detached', `HEAD ${F2}`, 'detached', ''].join('\n');
        const { runner } = makeRunner(
            repoRoutes({
                'git symbolic-ref --short -q HEAD': failed('fatal: ref HEAD is not a symbolic ref'),
                'git rev-parse --verify --quiet HEAD^{commit}': ok(`${F2}\n`),
                'git worktree list --porcelain': ok(worktrees),
                [`git merge-base ${M1} ${F2}`]: ok(`${M1}\n`),
                [`git rev-list --left-right --count ${M1}...${F2}`]: ok('0\t2\n'),
                [`git log -1 --format=%H%x00%cI%x00%s ${F2}`]: ok(`${F2}\u0000${DATE}\u0000feat: two\n`),
            }),
        );
        const topology = collectBranchTopology(runner, { scope: 'all', pr: false, limit: 30 });
        const detached = topology.branches.find((row) => row.kind === 'detached');

        expect(detached).toMatchObject({
            name: F2.slice(0, 7),
            tip: F2,
            ahead: 2,
            contained: false,
            worktree: '/repo/detached',
        });
    });

    test('a contained branch keeps its commits empty while the base row keeps its window', () => {
        const { runner } = makeRunner(repoRoutes());
        const topology = collectBranchTopology(runner, { scope: 'all', pr: false, limit: 30 });
        const byName = new Map(topology.branches.map((row) => [row.name, row]));

        expect(byName.get('stale')?.commits).toEqual([]);
        expect(byName.get('main')?.commits.map((commit) => commit.sha)).toEqual([M1, M0]);
        // Lightweight tag → the commit itself; the annotated tag peels through %(*objectname).
        expect(byName.get('main')?.commits[0]?.tags).toEqual(['v0.1.0']);
        expect(byName.get('origin/legacy')?.commits[0]?.tags).toEqual(['annotated']);
        expect(byName.get('feature/x')?.commits.map((commit) => commit.sha)).toEqual([F2, F1, M1]);
    });

    test('base resolution falls back to main when origin/HEAD is absent', () => {
        const { runner } = makeRunner(
            repoRoutes({
                'git symbolic-ref --short refs/remotes/origin/HEAD': failed(
                    'fatal: ref refs/remotes/origin/HEAD is not a symbolic ref',
                ),
                'git rev-parse --verify --quiet main^{commit}': ok(`${M1}\n`),
            }),
        );
        const topology = collectBranchTopology(runner, { scope: 'all', pr: false, limit: 30 });

        expect(topology.base).toBe('main');
        expect(topology.branches.map((row) => row.name)).toContain('main');
    });

    test('an unresolvable default base is a usage error naming what was tried', () => {
        const { runner } = makeRunner(
            repoRoutes({
                'git symbolic-ref --short refs/remotes/origin/HEAD': failed(
                    'fatal: ref refs/remotes/origin/HEAD is not a symbolic ref',
                ),
                'git rev-parse --verify --quiet main^{commit}': failed('fatal: Needed a single revision'),
            }),
        );
        expect(() => collectBranchTopology(runner, { scope: 'all', pr: false, limit: 30 })).toThrow(
            "unknown base ref 'main' (no --base given; tried origin/HEAD, then main)",
        );
    });

    test('an unknown --base ref is a usage error naming the ref', () => {
        const { runner } = makeRunner({
            'git rev-parse --verify --quiet nope^{commit}': failed('fatal: Needed a single revision'),
        });
        expect(() => collectBranchTopology(runner, { base: 'nope', scope: 'all', pr: false, limit: 30 })).toThrow(
            "unknown base ref 'nope'",
        );
    });

    test('a missing git binary and a non-repository are git errors', () => {
        const missing = makeRunner(
            repoRoutes({
                'git symbolic-ref --short refs/remotes/origin/HEAD': {
                    code: 1,
                    stdout: '',
                    stderr: '',
                    error: 'spawnSync git ENOENT',
                },
                'git rev-parse --verify --quiet main^{commit}': {
                    code: 1,
                    stdout: '',
                    stderr: '',
                    error: 'spawnSync git ENOENT',
                },
            }),
        );
        expect(() => collectBranchTopology(missing.runner, { scope: 'all', pr: false, limit: 30 })).toThrow(
            BranchTopologyGitError,
        );

        const noRepo = makeRunner(
            repoRoutes({
                'git rev-parse --verify --quiet origin/main^{commit}': failed(
                    'fatal: not a git repository (or any of the parent directories): .git',
                ),
            }),
        );
        expect(() => collectBranchTopology(noRepo.runner, { scope: 'all', pr: false, limit: 30 })).toThrow(
            'not a git repository',
        );
    });

    test('--base skips the origin/HEAD lookup', () => {
        const { runner, commands } = makeRunner(
            repoRoutes({ 'git rev-parse --verify --quiet main^{commit}': ok(`${M1}\n`) }),
        );
        const topology = collectBranchTopology(runner, {
            base: 'main',
            scope: 'all',
            pr: false,
            limit: 30,
        });

        expect(topology.base).toBe('main');
        expect(commands).not.toContain('git symbolic-ref --short refs/remotes/origin/HEAD');
        expect(commands).toContain('git rev-parse --verify --quiet main^{commit}');
    });

    test('the base row is the local twin of an origin/-qualified base', () => {
        const rows = [
            { name: 'main', kind: 'local' as const },
            { name: 'origin/main', kind: 'remote' as const },
        ].map((row) => ({ ...row, commits: [], contained: true }) as never);
        expect(isBaseRow('origin/main', rows[0] as never)).toBe(true);
        expect(isBaseRow('main', rows[1] as never)).toBe(false);
    });
});

describe('collectBranchTopology — pull requests', () => {
    const prRoutes = (): Record<string, CmdResult> =>
        repoRoutes({
            [GH_PR_LIST]: ok(
                JSON.stringify([
                    { number: 590, headRefName: 'main', state: 'OPEN', reviewDecision: null },
                    { number: 581, headRefName: 'user/fix.one', state: 'OPEN', reviewDecision: 'APPROVED' },
                ]),
            ),
        });

    test('--pr makes exactly one gh call and maps head refs onto rows', () => {
        const { runner, commands } = makeRunner(prRoutes());
        const topology = collectBranchTopology(runner, { scope: 'all', pr: true, limit: 30 });
        const main = topology.branches.find((row) => row.name === 'main');

        expect(main?.pr).toEqual({ number: 590, state: 'OPEN', reviewDecision: null });
        expect(topology.warnings).toEqual([]);
        expect(commands.filter((cmd) => cmd.startsWith('gh '))).toHaveLength(1);
        expect(commands).not.toContain(GH_PR_LIST.replace('gh pr list', 'gh pr view'));
    });

    test('a remote-only row matches the local head ref `gh` reports', () => {
        const { runner } = makeRunner(
            repoRoutes({
                [GH_PR_LIST]: ok(
                    JSON.stringify([
                        { number: 7, headRefName: 'legacy', state: 'OPEN', reviewDecision: 'REVIEW_REQUIRED' },
                    ]),
                ),
            }),
        );
        const topology = collectBranchTopology(runner, { scope: 'all', pr: true, limit: 30 });

        expect(topology.branches.find((row) => row.name === 'origin/legacy')?.pr).toEqual({
            number: 7,
            state: 'OPEN',
            reviewDecision: 'REVIEW_REQUIRED',
        });
    });

    test("gh's empty reviewDecision (undecided PR) normalizes to null", () => {
        const { runner } = makeRunner(
            repoRoutes({
                [GH_PR_LIST]: ok(
                    JSON.stringify([
                        { number: 12, headRefName: 'feature/x', state: 'OPEN', reviewDecision: '' },
                        { number: 13, headRefName: 'main', state: 'MERGED', reviewDecision: 'APPROVED' },
                    ]),
                ),
            }),
        );
        const topology = collectBranchTopology(runner, { scope: 'all', pr: true, limit: 30 });

        expect(topology.branches.find((row) => row.name === 'feature/x')?.pr).toEqual({
            number: 12,
            state: 'OPEN',
            reviewDecision: null,
        });
        expect(topology.branches.find((row) => row.name === 'main')?.pr).toEqual({
            number: 13,
            state: 'MERGED',
            reviewDecision: 'APPROVED',
        });
    });

    test('a gh failure degrades to null PR fields plus one warning naming the reason', () => {
        const { runner } = makeRunner(
            repoRoutes({ [GH_PR_LIST]: failed('gh: To get started with GitHub CLI, run: gh auth login', 1) }),
        );
        const topology = collectBranchTopology(runner, { scope: 'all', pr: true, limit: 30 });

        expect(topology.branches.every((row) => row.pr === null)).toBe(true);
        expect(topology.warnings).toHaveLength(1);
        expect(topology.warnings[0]).toContain('gh auth login');
    });

    test('a missing gh binary degrades through the spawn error instead of throwing', () => {
        const { runner } = makeRunner(
            repoRoutes({
                [GH_PR_LIST]: { code: 1, stdout: '', stderr: '', error: 'Executable not found in $PATH: "gh"' },
            }),
        );
        const topology = collectBranchTopology(runner, { scope: 'all', pr: true, limit: 30 });

        expect(topology.warnings).toHaveLength(1);
        expect(topology.warnings[0]).toContain('gh');
        expect(topology.branches.every((row) => row.pr === null)).toBe(true);
    });

    test('without --pr no gh call happens and no warning is recorded', () => {
        const { runner, commands } = makeRunner(repoRoutes());
        const topology = collectBranchTopology(runner, { scope: 'all', pr: false, limit: 30 });

        expect(commands.some((cmd) => cmd.startsWith('gh '))).toBe(false);
        expect(topology.warnings).toEqual([]);
    });
});

describe('collectBranchTopology — read-only invariant', () => {
    test('every git command is a read-only verb', () => {
        const { runner, commands } = makeRunner(repoRoutes({ [GH_PR_LIST]: ok('[]') }));
        collectBranchTopology(runner, { scope: 'all', pr: true, limit: 30 });

        const readOnly = new Set([
            'symbolic-ref',
            'rev-parse',
            'for-each-ref',
            'merge-base',
            'rev-list',
            'log',
            'worktree',
        ]);
        const gitVerbs = commands.filter((cmd) => cmd.startsWith('git ')).map((cmd) => cmd.split(' ')[1] ?? '');
        expect(gitVerbs.length).toBeGreaterThan(0);
        expect(gitVerbs.filter((verb) => !readOnly.has(verb))).toEqual([]);
    });
});
