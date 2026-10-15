/**
 * Golden fixtures for `spur workflow inline <op>` and `spur workflow commit-guard <op>`
 * (script-absorption PR-4, docs/plans/2026-10-14-spur-script-absorption.md §3.4/§4).
 *
 * Each case builds a scratch tree, then runs a sequence of steps. A step names the retired plugin
 * invocation (`old`, the argv after `bun plugins/sp/scripts/<script>.ts`) and the CLI invocation
 * that replaces it (`cli`, the argv after `spur workflow`). `../fixtures/workflow-inline-golden.json`
 * froze the OLD side's exit codes, stdout, stderr and normalized side effects before the scripts
 * were deleted; `workflow-inline-parity.test.ts` replays the `cli` side against it.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Which retired plugin script a step's `old` argv belonged to. */
export type GoldenScript = 'inline-run-setup' | 'inline-run-dispatch' | 'persist-out-check' | 'commit-guard';

/**
 * How strictly a step is compared:
 * - `full`: exit code, stdout and stderr (stderr after the documented rewrites);
 * - `stdout`: exit code and stdout — stderr is a Commander/usage text whose wording changed;
 * - `exit`: exit code only (usage refusals whose message is Commander's, stdout empty on both sides).
 */
export type GoldenCompare = 'full' | 'stdout' | 'exit';

export interface GoldenStep {
    script: GoldenScript;
    old: string[];
    cli: string[];
    /** Working directory relative to the case root (default: the root). */
    cwd?: string;
    compare?: GoldenCompare;
    /** Mutates the tree right before the step runs (both sides run it identically). */
    before?: (root: string) => void;
}

export interface GoldenCase {
    name: string;
    setup: (root: string) => void;
    steps: GoldenStep[];
    /** Files or directories (relative to root) whose normalized content / listing is snapshotted. */
    artifacts?: string[];
    /** SQLite queries against `<root>/<dbDir>/.spur/spur.db` snapshotted after the steps. */
    db?: { dir?: string; queries: string[] };
}

/** Fixed git identity and dates so commit ids (and therefore proof fingerprints) are reproducible. */
export const GIT_ENV: Record<string, string> = {
    GIT_AUTHOR_NAME: 'golden',
    GIT_AUTHOR_EMAIL: 'golden@example.com',
    GIT_COMMITTER_NAME: 'golden',
    GIT_COMMITTER_EMAIL: 'golden@example.com',
    GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
};

function write(root: string, rel: string, content: string): void {
    const path = join(root, rel);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
}

function git(cwd: string, args: string[]): void {
    const res = Bun.spawnSync(['git', ...args], {
        cwd,
        env: { ...process.env, ...GIT_ENV },
        stdout: 'pipe',
        stderr: 'pipe',
    });
    if (res.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr.toString()}`);
}

/** A committed repo holding `files` at `dir` (relative to root). */
function repo(root: string, files: Record<string, string>, dir = '.'): void {
    const cwd = join(root, dir);
    mkdirSync(cwd, { recursive: true });
    for (const [rel, content] of Object.entries(files)) write(cwd, rel, content);
    git(cwd, ['init', '-q', '-b', 'main']);
    git(cwd, ['add', '-A']);
    git(cwd, ['commit', '-qm', 'init']);
}

const SMOKE_WF = `name: inline-smoke
initialState: start
terminalStates:
    - end
states:
    - id: start
      onEnter:
          - kind: shell
            options:
                command: echo smoke
    - id: end
transitions:
    - from: start
      to: end
      guard:
          kind: always
`;

/** A project tree with one resolvable project-layer workflow at `dir`. */
function project(root: string, dir = '.'): void {
    write(join(root, dir), '.spur/workflows/inline-smoke.yaml', SMOKE_WF);
}

const WF = '.spur/workflows/inline-smoke.yaml';
const setupStep = (runId: string, cwd?: string): GoldenStep => ({
    script: 'inline-run-setup',
    old: ['--run-id', runId, '--file', WF],
    cli: ['inline', 'begin', '--run-id', runId, '--file', WF],
    ...(cwd === undefined ? {} : { cwd }),
});
const actionStep = (runId: string, extra: string[] = ['--duration-ms', '5'], cwd?: string): GoldenStep => {
    const args = [
        '--run-id',
        runId,
        '--node',
        'start',
        '--kind',
        'shell',
        '--status',
        'done',
        '--ok',
        'true',
        ...extra,
    ];
    return {
        script: 'inline-run-setup',
        old: ['--action', ...args],
        cli: ['inline', 'action', ...args],
        ...(cwd === undefined ? {} : { cwd }),
    };
};

const RUNS_DB = [
    'SELECT id, workflow_name, status, terminal_reason FROM runs ORDER BY id',
    'SELECT run_id, node, kind, status, duration_ms, ok FROM action_runs ORDER BY run_id, node, kind',
];

// ─── commit-guard ────────────────────────────────────────────────────────────

const GUARD_REPO = { 'a.txt': 'a\n', 'b.txt': 'b\n', 'docs/readme.md': '# readme\n' };
const guard = (args: string[], compare?: GoldenCompare, before?: (root: string) => void): GoldenStep => ({
    script: 'commit-guard',
    old: args,
    cli: ['commit-guard', ...args],
    ...(compare === undefined ? {} : { compare }),
    ...(before === undefined ? {} : { before }),
});

const COMMIT_GUARD_CASES: GoldenCase[] = [
    {
        name: 'commit-guard: missing --run is a usage error (exit 1)',
        setup: (root) => repo(root, GUARD_REPO),
        steps: [guard(['start']), guard(['check']), guard(['stage', '--', 'a.txt'])],
    },
    {
        name: 'commit-guard: unknown op and excess start/check args are mis-invocations (exit 1)',
        setup: (root) => repo(root, GUARD_REPO),
        steps: [
            guard(['bogus', '--run', 'r1'], 'exit'),
            guard(['start', '--run', 'r1', 'extra'], 'exit'),
            guard(['check', '--run', 'r1', 'extra'], 'exit'),
        ],
    },
    {
        name: 'commit-guard: start → stage refuses the foreign path → check reports it',
        setup: (root) => repo(root, GUARD_REPO),
        steps: [
            guard(['start', '--run', 'r1'], undefined, (root) => write(root, 'b.txt', 'foreign edit\n')),
            guard(['stage', '--run', 'r1', '--', 'a.txt', 'b.txt', 'c.txt'], undefined, (root) => {
                write(root, 'a.txt', 'own edit\n');
                write(root, 'c.txt', 'new file\n');
            }),
            guard(['check', '--run', 'r1']),
            guard(['check', '--run', 'r1', '--base', 'HEAD']),
        ],
        artifacts: ['.spur/run/r1-tree-start.json'],
    },
    {
        name: 'commit-guard: stage with every path written by the run exits 0',
        setup: (root) => repo(root, GUARD_REPO),
        steps: [
            guard(['start', '--run', 'r2']),
            guard(['stage', '--run', 'r2', 'a.txt'], undefined, (root) => write(root, 'a.txt', 'mine\n')),
        ],
    },
    {
        name: 'commit-guard: an unchanged path is refused (exit 2, not foreign)',
        setup: (root) => repo(root, GUARD_REPO),
        steps: [guard(['start', '--run', 'r3']), guard(['stage', '--run', 'r3', '--', 'a.txt'])],
    },
    {
        name: 'commit-guard: conflict markers refuse the whole stage (exit 3)',
        setup: (root) => repo(root, GUARD_REPO),
        steps: [
            guard(['start', '--run', 'r4']),
            guard(['stage', '--run', 'r4', '--', 'a.txt', 'docs/readme.md'], undefined, (root) => {
                write(root, 'a.txt', 'ok\n');
                write(root, 'docs/readme.md', '<<<<<<< ours\nx\n=======\ny\n>>>>>>> theirs\n');
            }),
        ],
    },
    {
        name: 'commit-guard: stage/check without a start snapshot fail closed (exit 1)',
        setup: (root) => repo(root, GUARD_REPO),
        steps: [guard(['stage', '--run', 'nope', '--', 'a.txt']), guard(['check', '--run', 'nope'])],
    },
    {
        name: 'commit-guard: the precheck base anchor is honored',
        setup: (root) => {
            repo(root, GUARD_REPO);
            write(root, 'a.txt', 'second\n');
            git(root, ['commit', '-qam', 'second']);
        },
        steps: [
            guard(['start', '--run', 'r5'], undefined, (root) => {
                const head = Bun.spawnSync(['git', 'rev-parse', 'HEAD~1'], { cwd: root }).stdout.toString().trim();
                write(root, '.spur/run/r5-base.sha', `${head}\n`);
            }),
            guard(['check', '--run', 'r5']),
        ],
    },
    {
        name: 'commit-guard: outside a work tree the probes fail (exit 1)',
        setup: (root) => mkdirSync(join(root, 'plain'), { recursive: true }),
        steps: [{ ...guard(['start', '--run', 'r6']), cwd: 'plain' }],
    },
];

// ─── persist-check ───────────────────────────────────────────────────────────

const check = (args: string[], compare?: GoldenCompare): GoldenStep => ({
    script: 'persist-out-check',
    old: args,
    cli: ['inline', 'persist-check', ...args],
    cwd: 'main',
    ...(compare === undefined ? {} : { compare }),
});

function planes(root: string, files: Record<string, string>): void {
    mkdirSync(join(root, 'main'), { recursive: true });
    mkdirSync(join(root, 'wt'), { recursive: true });
    for (const [rel, content] of Object.entries(files)) write(root, rel, content);
}

const PERSIST_CHECK_CASES: GoldenCase[] = [
    {
        name: 'persist-check: usage errors exit 2',
        setup: (root) => planes(root, {}),
        steps: [
            check([], 'stdout'),
            check(['--from', '../wt'], 'stdout'),
            check(['--from', '../missing', '--run-id', 'r1'], 'stdout'),
            check(['--from', '../wt', '--bogus', 'x'], 'exit'),
        ],
    },
    {
        name: 'persist-check: every owned file persisted with identical bytes passes',
        setup: (root) =>
            planes(root, {
                'wt/.spur/run/r1-receipt.json': '{"ok":true}\n',
                'main/.spur/run/r1-receipt.json': '{"ok":true}\n',
                'wt/.spur/run/r1/nested-r1-x.txt': 'nested\n',
                'main/.spur/run/r1/nested-r1-x.txt': 'nested\n',
                'wt/.spur/memory/evidence/1234-notes.md': 'notes\n',
                'main/.spur/memory/evidence/1234-notes.md': 'notes\n',
                'wt/.spur/memory/evidence/other.md': 'unowned\n',
            }),
        steps: [
            check(['--from', '../wt', '--run-id', 'r1', '--task-file', 'docs/tasks/1234_task.md', '--root', '.']),
            check(['--from', '../wt', '--run-id', 'r1']),
        ],
    },
    {
        name: 'persist-check: missing, divergent and unforwarded evidence block (exit 1)',
        setup: (root) =>
            planes(root, {
                'wt/.spur/run/r1-a.json': 'a\n',
                'wt/.spur/run/r1-b.json': 'b-worktree\n',
                'main/.spur/run/r1-b.json': 'b-main\n',
                'wt/.spur/run/9999-verdict.json': '{"verdict":"PASS"}\n',
            }),
        steps: [check(['--from', '../wt', '--run-id', 'r1', '--root', '.'])],
    },
    {
        name: 'persist-check: persist-out skips are reported and foreign-divergent evidence is excused',
        setup: (root) =>
            planes(root, {
                'wt/.spur/memory/evidence/1234-x.md': 'worktree\n',
                'main/.spur/memory/evidence/1234-x.md': 'main\n',
                'main/.spur/run/persist-out.json': JSON.stringify({
                    ok: true,
                    persisted: 0,
                    skipped: [{ id: 'run-a', reason: 'id-exists' }],
                    evidenceSkipped: [{ name: '1234-x.md', reason: 'foreign-divergent' }],
                }),
            }),
        steps: [check(['--from', '../wt', '--task-file', '1234_t.md', '--root', '.'])],
    },
    {
        name: 'persist-check: --success-json overrides the default persist-out result',
        setup: (root) =>
            planes(root, {
                'wt/.spur/run/r1-a.json': 'a\n',
                'main/.spur/run/r1-a.json': 'a\n',
                'main/custom.json': JSON.stringify({ skipped: [{ id: 'run-z', reason: 'record-conflict:x' }] }),
            }),
        steps: [check(['--from', '../wt', '--run-id', 'r1', '--root', '.', '--success-json', 'custom.json'])],
    },
];

// ─── inline-run-setup / inline-run-dispatch ─────────────────────────────────

/** A confirmed capacity exhaustion (the 1134 incident record) — rides the durable availability path. */
const CAPACITY =
    '429 {"code":"1310","message":"Weekly/Monthly Limit Exhausted. Your limit will reset at 2026-10-13 01:47:29"}';

const INLINE_CASES: GoldenCase[] = [
    {
        name: 'inline begin: an unsafe run id refuses before any write (exit 1)',
        setup: (root) => project(root),
        steps: [
            {
                script: 'inline-run-setup',
                old: ['--run-id', '../evil', '--file', WF],
                cli: ['inline', 'begin', '--run-id', '../evil', '--file', WF],
            },
            {
                script: 'inline-run-setup',
                old: ['--run-id', '$(id)', '--file', WF],
                cli: ['inline', 'begin', '--run-id', '$(id)', '--file', WF],
            },
        ],
        artifacts: ['.spur/run', '.spur/memory'],
    },
    {
        name: 'inline begin: a missing --file is a usage error (exit 2)',
        setup: (root) => project(root),
        steps: [
            {
                script: 'inline-run-setup',
                old: ['--run-id', 'r1'],
                cli: ['inline', 'begin', '--run-id', 'r1'],
                compare: 'stdout',
            },
        ],
    },
    {
        name: 'inline begin: an unresolvable definition fails closed and records the error',
        setup: (root) => mkdirSync(root, { recursive: true }),
        steps: [
            {
                script: 'inline-run-setup',
                old: ['--run-id', 'r-missing', '--file', 'no-such-workflow'],
                cli: ['inline', 'begin', '--run-id', 'r-missing', '--file', 'no-such-workflow'],
            },
        ],
        artifacts: ['.spur/memory/runs/r-missing.state.json'],
    },
    {
        name: 'inline: begin → node-enter → action → actions → close lands rows and the run record',
        setup: (root) => {
            project(root);
            write(
                root,
                'actions.json',
                JSON.stringify([
                    { node: 'implement', kind: 'agent.run', status: 'done', ok: true, durationMs: 1234 },
                    { node: 'test', kind: 'shell', status: 'failed', ok: false, durationMs: 88 },
                ]),
            );
        },
        steps: [
            setupStep('r-flow'),
            setupStep('r-flow'),
            {
                script: 'inline-run-setup',
                old: ['--node-enter', '--run-id', 'r-flow', '--node', 'start'],
                cli: ['inline', 'node-enter', '--run-id', 'r-flow', '--node', 'start'],
            },
            actionStep('r-flow', ['--duration-ms', '5']),
            {
                script: 'inline-run-setup',
                old: [
                    '--estimated',
                    '--action',
                    '--run-id',
                    'r-flow',
                    '--node',
                    'end',
                    '--kind',
                    'agent.run',
                    '--status',
                    'failed',
                    '--ok',
                    'false',
                    '--duration-ms',
                    '7',
                ],
                cli: [
                    'inline',
                    'action',
                    '--estimated',
                    '--run-id',
                    'r-flow',
                    '--node',
                    'end',
                    '--kind',
                    'agent.run',
                    '--status',
                    'failed',
                    '--ok',
                    'false',
                    '--duration-ms',
                    '7',
                ],
            },
            {
                script: 'inline-run-setup',
                old: ['--actions-file', 'actions.json', '--run-id', 'r-flow'],
                cli: ['inline', 'actions', '--file', 'actions.json', '--run-id', 'r-flow'],
            },
            {
                script: 'inline-run-setup',
                old: ['--close', '--run-id', 'r-flow', '--status', 'done', '--no-summary'],
                cli: ['inline', 'close', '--run-id', 'r-flow', '--status', 'done', '--no-summary'],
            },
        ],
        artifacts: ['.spur/memory/runs/r-flow.state.json', '.spur/memory/runs/r-flow.md', '.spur/run'],
        db: { queries: RUNS_DB },
    },
    {
        name: 'inline close: the default close writes the n/a summary when no transcript resolves',
        setup: (root) => project(root),
        steps: [
            setupStep('r-sum'),
            actionStep('r-sum'),
            {
                script: 'inline-run-setup',
                old: ['--close', '--run-id', 'r-sum', '--status', 'paused'],
                cli: ['inline', 'close', '--run-id', 'r-sum', '--status', 'paused'],
            },
        ],
        artifacts: ['.spur/run/r-sum-summary.md', '.spur/memory/runs/r-sum.state.json'],
        db: { queries: RUNS_DB },
    },
    {
        name: 'inline close: zero action rows on a done close exits 1 (NO_ACTION_ROWS); failed needs a reason',
        setup: (root) => project(root),
        steps: [
            setupStep('r-zero'),
            {
                script: 'inline-run-setup',
                old: ['--close', '--run-id', 'r-zero', '--status', 'failed'],
                cli: ['inline', 'close', '--run-id', 'r-zero', '--status', 'failed'],
                compare: 'stdout',
            },
            {
                script: 'inline-run-setup',
                old: ['--close', '--run-id', 'r-zero', '--status', 'done', '--reason', 'bogus'],
                cli: ['inline', 'close', '--run-id', 'r-zero', '--status', 'done', '--reason', 'bogus'],
                compare: 'stdout',
            },
            {
                script: 'inline-run-setup',
                old: ['--close', '--run-id', 'r-zero', '--status', 'done', '--no-summary'],
                cli: ['inline', 'close', '--run-id', 'r-zero', '--status', 'done', '--no-summary'],
            },
        ],
        db: { queries: RUNS_DB },
    },
    {
        name: 'inline: trace ops on a run with no row are loud RUN_NOT_FOUND failures',
        setup: (root) => project(root),
        steps: [
            actionStep('r-ghost', ['--duration-ms', '10']),
            {
                script: 'inline-run-setup',
                old: ['--close', '--run-id', 'r-ghost', '--status', 'done', '--no-summary'],
                cli: ['inline', 'close', '--run-id', 'r-ghost', '--status', 'done', '--no-summary'],
            },
            {
                script: 'inline-run-setup',
                old: ['--node-enter', '--run-id', 'r-ghost', '--node', 'start'],
                cli: ['inline', 'node-enter', '--run-id', 'r-ghost', '--node', 'start'],
            },
        ],
        artifacts: ['.spur/memory/runs/r-ghost.md'],
    },
    {
        name: 'inline action: malformed values are usage errors (exit 2); unsafe ids refuse (exit 1)',
        setup: (root) => project(root),
        steps: [
            setupStep('r-usage'),
            {
                ...actionStep('r-usage', ['--duration-ms', '5']),
                old: actionStep('r-usage').old.map((t) => (t === 'true' ? 'yes' : t)),
                cli: actionStep('r-usage').cli.map((t) => (t === 'true' ? 'yes' : t)),
                compare: 'stdout',
            },
            { ...actionStep('r-usage', ['--duration-ms', '-1']), compare: 'stdout' },
            { ...actionStep('r-usage', ['--duration-ms', 'abc']), compare: 'stdout' },
            {
                script: 'inline-run-setup',
                old: ['--action', '--run-id', 'r-usage', '--node', 'start', '--status', 'done', '--ok', 'true'],
                cli: ['inline', 'action', '--run-id', 'r-usage', '--node', 'start', '--status', 'done', '--ok', 'true'],
                compare: 'stdout',
            },
            { ...actionStep('r-usage', []) },
            {
                script: 'inline-run-setup',
                old: [
                    '--action',
                    '--run-id',
                    'a/b',
                    '--node',
                    'start',
                    '--kind',
                    'shell',
                    '--status',
                    'done',
                    '--ok',
                    'true',
                ],
                cli: [
                    'inline',
                    'action',
                    '--run-id',
                    'a/b',
                    '--node',
                    'start',
                    '--kind',
                    'shell',
                    '--status',
                    'done',
                    '--ok',
                    'true',
                ],
            },
            {
                script: 'inline-run-setup',
                old: ['--estimated', '--close', '--run-id', 'r-usage', '--status', 'done'],
                cli: ['inline', 'close', '--estimated', '--run-id', 'r-usage', '--status', 'done'],
                compare: 'exit',
            },
            {
                script: 'inline-run-setup',
                old: [
                    '--no-summary',
                    '--action',
                    '--run-id',
                    'r-usage',
                    '--node',
                    'start',
                    '--kind',
                    'shell',
                    '--status',
                    'done',
                    '--ok',
                    'true',
                ],
                cli: [
                    'inline',
                    'action',
                    '--no-summary',
                    '--run-id',
                    'r-usage',
                    '--node',
                    'start',
                    '--kind',
                    'shell',
                    '--status',
                    'done',
                    '--ok',
                    'true',
                ],
                compare: 'exit',
            },
            {
                script: 'inline-run-setup',
                old: ['--actions-file', 'nope.json', '--run-id', 'r-usage'],
                cli: ['inline', 'actions', '--file', 'nope.json', '--run-id', 'r-usage'],
            },
        ],
        db: { queries: RUNS_DB },
    },
    {
        name: 'inline fingerprint: prints the proof-input digest; refuses bad input',
        setup: (root) =>
            repo(root, {
                'task.md': '## 0862. Fixture task\n\n### Requirements\n\n- **R1** — fixture requirement\n',
                'feature.md': '# feature\n',
            }),
        steps: [
            {
                script: 'inline-run-setup',
                old: ['--fingerprint', '--task-file', 'task.md'],
                cli: ['inline', 'fingerprint', '--task-file', 'task.md'],
            },
            {
                script: 'inline-run-setup',
                old: ['--fingerprint', '--task-file', 'task.md', '--feature-file', 'feature.md'],
                cli: ['inline', 'fingerprint', '--task-file', 'task.md', '--feature-file', 'feature.md'],
            },
            {
                script: 'inline-run-setup',
                old: ['--fingerprint', '--task-file', 'no-such-task.md'],
                cli: ['inline', 'fingerprint', '--task-file', 'no-such-task.md'],
            },
            {
                script: 'inline-run-setup',
                old: ['--fingerprint', '--task-file', 'task.md', '--run-id', 'x'],
                cli: ['inline', 'fingerprint', '--task-file', 'task.md', '--run-id', 'x'],
                compare: 'exit',
            },
            { script: 'inline-run-setup', old: ['--fingerprint'], cli: ['inline', 'fingerprint'], compare: 'exit' },
        ],
        artifacts: ['.spur/run', '.spur/memory'],
    },
    {
        name: 'inline decide: the switched-off decision maker degrades to the declared default',
        setup: (root) => {
            mkdirSync(root, { recursive: true });
            write(root, '.spur/config.yaml', 'workflows:\n  decideDecisionMaker: false\n');
            write(
                root,
                'decide-options.json',
                JSON.stringify({
                    id: 'recovery-classify',
                    method: 'choice',
                    question: 'retry or stop?',
                    choices: ['retry', 'stop'],
                    default: 'stop',
                    resultFile: '.spur/run/decide-recovery.decision.json',
                }),
            );
            write(
                root,
                'bad-options.json',
                JSON.stringify({
                    id: 'x',
                    method: 'choice',
                    question: 'q',
                    choices: ['a', 'b'],
                    default: 'c',
                    resultFile: 'd.json',
                }),
            );
        },
        steps: [
            {
                script: 'inline-run-setup',
                old: ['--decide', '--run-id', 'r-dec', '--node', 'classify', '--options-json', 'decide-options.json'],
                cli: [
                    'inline',
                    'decide',
                    '--run-id',
                    'r-dec',
                    '--node',
                    'classify',
                    '--options-json',
                    'decide-options.json',
                ],
            },
            {
                script: 'inline-run-setup',
                old: ['--decide', '--run-id', 'r-dec', '--node', 'classify', '--options-json', 'bad-options.json'],
                cli: [
                    'inline',
                    'decide',
                    '--run-id',
                    'r-dec',
                    '--node',
                    'classify',
                    '--options-json',
                    'bad-options.json',
                ],
            },
            {
                script: 'inline-run-setup',
                old: ['--decide', '--run-id', 'r-dec', '--node', 'classify'],
                cli: ['inline', 'decide', '--run-id', 'r-dec', '--node', 'classify'],
                compare: 'stdout',
            },
            {
                script: 'inline-run-setup',
                old: ['--decide', '--run-id', '../x', '--node', 'classify', '--options-json', 'decide-options.json'],
                cli: [
                    'inline',
                    'decide',
                    '--run-id',
                    '../x',
                    '--node',
                    'classify',
                    '--options-json',
                    'decide-options.json',
                ],
            },
        ],
        artifacts: ['.spur/run/decide-recovery.decision.json', '.spur/memory/runs/r-dec.md', 'd.json'],
    },
    {
        name: 'inline persist-out: copies the worktree run into the invoking tree; idempotent re-persist',
        setup: (root) => {
            project(root, 'wt');
            mkdirSync(join(root, 'main'), { recursive: true });
            write(root, 'main/docs/1234_x.md', '## Testing\n\nEvidence: `.spur/run/r-po.md`\n');
            write(root, 'wt/.spur/run/1234-verdict.json', '{"verdict":"PASS"}\n');
        },
        steps: [
            setupStep('r-po', 'wt'),
            actionStep('r-po', ['--duration-ms', '5'], 'wt'),
            {
                script: 'inline-run-setup',
                old: ['--persist-out', '--from', '../wt', '--task-file', 'docs/1234_x.md'],
                cli: ['inline', 'persist-out', '--from', '../wt', '--task-file', 'docs/1234_x.md'],
                cwd: 'main',
            },
            {
                script: 'inline-run-setup',
                old: ['--persist-out', '--from', '../wt'],
                cli: ['inline', 'persist-out', '--from', '../wt'],
                cwd: 'main',
            },
            check(['--from', '../wt', '--task-file', 'docs/1234_x.md', '--run-id', 'r-po', '--root', '.']),
        ],
        artifacts: ['main/.spur/run/persist-out.json', 'main/.spur/run/1234-verdict.json', 'main/.spur/memory/runs'],
        db: { dir: 'main', queries: RUNS_DB },
    },
    {
        name: 'inline persist-out: an unreadable worktree DB fails closed; usage errors exit 2',
        setup: (root) => {
            write(root, 'wt/.spur/spur.db', 'not a database');
            mkdirSync(join(root, 'main'), { recursive: true });
        },
        steps: [
            {
                script: 'inline-run-setup',
                old: ['--persist-out', '--from', '../wt'],
                cli: ['inline', 'persist-out', '--from', '../wt'],
                cwd: 'main',
            },
            {
                script: 'inline-run-setup',
                old: ['--persist-out'],
                cli: ['inline', 'persist-out'],
                cwd: 'main',
                compare: 'exit',
            },
            {
                script: 'inline-run-setup',
                old: ['--persist-out', '--from', ''],
                cli: ['inline', 'persist-out', '--from', ''],
                cwd: 'main',
                compare: 'stdout',
            },
            {
                script: 'inline-run-setup',
                old: ['--persist-out', '--from', '../wt', '--task-file', ''],
                cli: ['inline', 'persist-out', '--from', '../wt', '--task-file', ''],
                cwd: 'main',
                compare: 'stdout',
            },
        ],
    },
    {
        name: 'inline attribution: records the executor identity or the explicit no-attribution marker',
        setup: (root) => mkdirSync(root, { recursive: true }),
        steps: [
            {
                script: 'inline-run-dispatch',
                old: [
                    '--attribution',
                    '--run-id',
                    'r-att',
                    '--stage',
                    'implement',
                    '--executor',
                    'codex',
                    '--agent',
                    'super-coder',
                    '--model',
                    'gpt-x',
                ],
                cli: [
                    'inline',
                    'attribution',
                    '--run-id',
                    'r-att',
                    '--stage',
                    'implement',
                    '--executor',
                    'codex',
                    '--agent',
                    'super-coder',
                    '--model',
                    'gpt-x',
                ],
            },
            {
                script: 'inline-run-dispatch',
                old: ['--attribution', '--run-id', 'r-att', '--stage', 'review'],
                cli: ['inline', 'attribution', '--run-id', 'r-att', '--stage', 'review'],
            },
            {
                script: 'inline-run-dispatch',
                old: ['--attribution', '--run-id', 'r-att'],
                cli: ['inline', 'attribution', '--run-id', 'r-att'],
                compare: 'stdout',
            },
            {
                script: 'inline-run-dispatch',
                old: ['--attribution', '--run-id', '../x', '--stage', 'implement'],
                cli: ['inline', 'attribution', '--run-id', '../x', '--stage', 'implement'],
                compare: 'stdout',
            },
        ],
        artifacts: ['.spur/run/r-att-attribution.jsonl'],
    },
    {
        name: 'inline dispatch-failure: classifies the record and writes the fallback decision',
        setup: (root) => {
            mkdirSync(root, { recursive: true });
            write(root, 'failure.txt', 'Error: model does not support tool use\n');
        },
        steps: [
            {
                script: 'inline-run-dispatch',
                old: [
                    '--dispatch-failure',
                    '--run-id',
                    'r-df',
                    '--stage',
                    'implement',
                    '--decision',
                    'host-inline',
                    '--text-file',
                    'failure.txt',
                    '--executor',
                    'codex',
                ],
                cli: [
                    'inline',
                    'dispatch-failure',
                    '--run-id',
                    'r-df',
                    '--stage',
                    'implement',
                    '--decision',
                    'host-inline',
                    '--text-file',
                    'failure.txt',
                    '--executor',
                    'codex',
                ],
            },
            {
                script: 'inline-run-dispatch',
                old: [
                    '--dispatch-failure',
                    '--run-id',
                    'r-df2',
                    '--stage',
                    'implement',
                    '--decision',
                    'stop',
                    '--text',
                    'You have hit your usage limit. Try again later.',
                ],
                cli: [
                    'inline',
                    'dispatch-failure',
                    '--run-id',
                    'r-df2',
                    '--stage',
                    'implement',
                    '--decision',
                    'stop',
                    '--text',
                    'You have hit your usage limit. Try again later.',
                ],
            },
            {
                script: 'inline-run-dispatch',
                old: [
                    '--dispatch-failure',
                    '--run-id',
                    'r-df3',
                    '--stage',
                    'implement',
                    '--decision',
                    'escalate',
                    '--text',
                    CAPACITY,
                    '--executor',
                    'codex',
                    '--agent',
                    'super-coder',
                    '--model',
                    'gpt-x',
                ],
                cli: [
                    'inline',
                    'dispatch-failure',
                    '--run-id',
                    'r-df3',
                    '--stage',
                    'implement',
                    '--decision',
                    'escalate',
                    '--text',
                    CAPACITY,
                    '--executor',
                    'codex',
                    '--agent',
                    'super-coder',
                    '--model',
                    'gpt-x',
                ],
            },
            {
                script: 'inline-run-dispatch',
                old: ['--dispatch-failure', '--run-id', 'r-df', '--stage', 'implement', '--decision', 'stop'],
                cli: ['inline', 'dispatch-failure', '--run-id', 'r-df', '--stage', 'implement', '--decision', 'stop'],
                compare: 'stdout',
            },
            {
                script: 'inline-run-dispatch',
                old: ['--dispatch-failure', '--run-id', 'r-df', '--stage', 'implement', '--text', 'x'],
                cli: ['inline', 'dispatch-failure', '--run-id', 'r-df', '--stage', 'implement', '--text', 'x'],
                compare: 'stdout',
            },
            {
                script: 'inline-run-dispatch',
                old: ['--attribution', '--dispatch-failure', '--run-id', 'r-df', '--stage', 'implement'],
                cli: ['inline', 'dispatch-failure', '--attribution', '--run-id', 'r-df', '--stage', 'implement'],
                compare: 'exit',
            },
        ],
        artifacts: [
            '.spur/run/r-df-dispatch-fallback.json',
            '.spur/run/r-df2-dispatch-fallback.json',
            '.spur/run/r-df3-dispatch-fallback.json',
        ],
    },
];

export const GOLDEN_CASES: GoldenCase[] = [...COMMIT_GUARD_CASES, ...PERSIST_CHECK_CASES, ...INLINE_CASES];
