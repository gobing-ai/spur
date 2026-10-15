/**
 * Representative inputs for the PR-5 golden parity proof (see ./harness.ts). Each case pairs the
 * retired plugin-script invocation (`old`) with the absorbing spur command (`new`); the observable
 * behavior of `old` is frozen in `../script-absorption-pr5-golden.json`.
 */

import type { GoldenCase } from './harness';

/** The bundled-workflow source dir, built so the sp-runtime-path rule sees no literal path. */
const BUNDLED_WORKFLOWS = ['config', 'workflows'].join('/');

const RUN = { __runId: 'r1', spurBin: '$STUB' };
const done = (extra: Record<string, unknown> = {}): string =>
    JSON.stringify({ frontmatter: { status: 'done', feature_id: 'F1' }, ...extra });

const wrapup = (op: string): { old: string[]; new: string[] } => ({
    old: ['wrapup-steps.ts', op],
    new: ['task', 'wrapup', op],
});
const probe = { old: ['wrapup-drift-probe.ts'], new: ['task', 'wrapup', 'drift-probe'] };
const preflight = (wbs: string | null, flags: string[]): { old: string[]; new: string[] } => ({
    old: ['batch-preflight.ts', ...(wbs === null ? [] : ['--wbs', wbs]), ...flags],
    new: ['task', 'preflight', ...(wbs === null ? [] : [wbs]), ...flags],
});
const plan = (args: string[]): { old: string[]; new: string[] } => ({
    old: ['batch-plan.ts', ...args],
    new: ['task', 'batch-plan', ...args],
});

const TASKS_FILE = '.spur/run/r1-wrapup-tasks.json';
const solution = (body: string): string => `# T\n\n## Solution\n\n${body}\n\n## Testing\n\nVerdict: PASS\n`;

export const WRAPUP_CASES: GoldenCase[] = [
    {
        id: 'resolve-pass-dedupe',
        env: { ...RUN, tasks: '["0101","0102","0101"]' },
        files: {
            'stub/task-show-0101.out': done(),
            'stub/task-show-0102.out': JSON.stringify({ status: 'cancelled' }),
        },
        steps: [wrapup('resolve')],
    },
    {
        id: 'resolve-invalid-tasks',
        env: { ...RUN, tasks: '[" 0101"]' },
        steps: [wrapup('resolve')],
    },
    {
        id: 'resolve-unresolved',
        env: { ...RUN, tasks: '["0101","0102"]' },
        files: {
            'stub/task-show-0101.out': JSON.stringify({ frontmatter: { status: 'todo' } }),
            'stub/task-show-0102.rc': '1',
        },
        steps: [wrapup('resolve')],
    },
    {
        id: 'resolve-empty-run-id',
        env: { ...RUN, __runId: '', tasks: '["0101"]' },
        steps: [wrapup('resolve')],
    },
    {
        id: 'resolve-preflight-gate-blocked',
        env: { ...RUN, tasks: '["0101"]', feature: 'F1' },
        files: {
            'stub/task-show-0101.out': done(),
            'stub/feature-sync-dry.out': JSON.stringify({
                proposal: {
                    gateBlocked: true,
                    gateFindings: [
                        { severity: 'error', code: 'L2.b' },
                        { severity: 'warning', code: 'L2.w' },
                        { severity: 'error', code: 'L2.a' },
                    ],
                },
            }),
        },
        steps: [wrapup('resolve')],
    },
    {
        id: 'resolve-preflight-done-gate',
        env: { ...RUN, tasks: '["0101"]', feature: 'F1' },
        files: {
            'stub/task-show-0101.out': done(),
            'stub/feature-sync-dry.out': JSON.stringify({ proposal: { from: 'wip', to: 'done' } }),
            'stub/feature-check.out': JSON.stringify([
                {
                    findings: [
                        { severity: 'error', code: 'L4.feature-receipt-missing' },
                        { severity: 'error', code: 'L4.scenario-unverified' },
                    ],
                },
            ]),
            'stub/feature-check.rc': '1',
        },
        steps: [wrapup('resolve')],
    },
    {
        id: 'resolve-preflight-not-done-pass',
        env: { ...RUN, tasks: '["0101"]', feature: 'F1' },
        files: {
            'stub/task-show-0101.out': done(),
            'stub/feature-sync-dry.out': JSON.stringify({ proposal: { from: 'todo', to: 'wip' } }),
        },
        steps: [wrapup('resolve')],
    },
    {
        id: 'resolve-preflight-sync-unreadable',
        env: { ...RUN, tasks: '["0101"]', feature: 'F1' },
        files: { 'stub/task-show-0101.out': done(), 'stub/feature-sync-dry.out': 'not json' },
        steps: [wrapup('resolve')],
    },
    {
        id: 'route-reason-modes',
        env: { ...RUN, tasks: '["0101"]' },
        files: { 'stub/task-show-0101.out': done() },
        steps: [
            wrapup('resolve'),
            { ...wrapup('route-reason'), env: { mode: '' } },
            { ...wrapup('route-reason'), env: { mode: 'fast' } },
            { ...wrapup('route-reason'), env: { mode: 'conflict' } },
            { ...wrapup('route-reason'), env: { mode: 'weird' } },
            {
                ...wrapup('route-reason'),
                env: { mode: 'fast' },
                before: { '.spur/run/r1-drift-probe.json': '{"clean":true,"reasons":[],"paths":[]}' },
            },
        ],
    },
    {
        id: 'route-reason-skipped-and-failed',
        env: { ...RUN, tasks: '[]' },
        steps: [
            wrapup('resolve'),
            wrapup('route-reason'),
            { ...wrapup('route-reason'), before: { '.spur/run/r1-wrapup-resolve.status': 'FAIL\n' } },
        ],
    },
    {
        id: 'route-reason-empty-run-id',
        env: { ...RUN, __runId: '' },
        steps: [wrapup('route-reason')],
    },
    {
        id: 'metrics-verdict-sources',
        env: { ...RUN },
        files: {
            [TASKS_FILE]: '["0101","0102","0103","0104","0105"]\n',
            'stub/task-show-0101.out': done({ content: solution('x') }),
            'stub/task-show-0102.out': done({ content: '# no testing\n' }),
            '.spur/run/0102-verdict.json': '{"verdict":"PARTIAL"}',
            'stub/task-show-0103.out': JSON.stringify({ frontmatter: { status: 'done' }, content: '' }),
            '.spur/memory/evidence/0103-verdict.json': '{"verdict":null}',
            'stub/task-show-0104.rc': '1',
            'stub/task-show-0105.out': JSON.stringify({ status: 'done', feature_id: 'F2', content: '' }),
        },
        steps: [wrapup('metrics')],
    },
    {
        id: 'metrics-invalid-capture',
        env: { ...RUN },
        files: { [TASKS_FILE]: '{"not":"array"}' },
        steps: [wrapup('metrics')],
    },
    {
        id: 'feature-transition-empty-feature',
        env: { ...RUN, feature: '' },
        steps: [wrapup('feature-transition')],
    },
    {
        id: 'feature-transition-applied-gate-pass',
        env: { ...RUN, feature: 'F1', featureGateCmd: 'echo gate-ran' },
        files: {
            'stub/feature-sync.out': JSON.stringify({
                proposal: { featureId: 'F1', from: 'wip', to: 'verifying' },
                applied: true,
            }),
            'stub/feature-show.out': JSON.stringify({ status: 'verifying' }),
        },
        steps: [wrapup('feature-transition')],
    },
    {
        id: 'feature-transition-noop',
        env: { ...RUN, feature: 'F1', featureGateCmd: 'echo never' },
        files: {
            'stub/feature-sync.out': JSON.stringify({
                proposal: { featureId: 'F1', from: 'wip', to: 'wip' },
                applied: false,
            }),
            'stub/feature-show.out': JSON.stringify({ frontmatter: { status: 'wip' } }),
        },
        steps: [wrapup('feature-transition')],
    },
    {
        id: 'feature-transition-sync-failed-gate-fail',
        env: { ...RUN, feature: 'F1', featureGateCmd: 'exit 3' },
        files: { 'stub/feature-sync.out': 'boom', 'stub/feature-sync.rc': '2', 'stub/feature-show.rc': '1' },
        steps: [wrapup('feature-transition')],
    },
    {
        id: 'feature-transition-blocked-and-mismatch',
        env: { ...RUN, feature: 'F1', featureGateCmd: 'true' },
        files: {
            'stub/feature-sync.out': JSON.stringify({
                proposal: { featureId: 'F1', from: 'wip', to: 'done', gateBlocked: true },
                applied: false,
            }),
            'stub/feature-show.out': JSON.stringify({ status: 'wip' }),
        },
        steps: [
            wrapup('feature-transition'),
            {
                ...wrapup('feature-transition'),
                before: {
                    'stub/feature-sync.out': JSON.stringify({
                        proposal: { featureId: 'F9', from: 'wip', to: 'wip' },
                        applied: false,
                    }),
                },
            },
            {
                ...wrapup('feature-transition'),
                before: {
                    'stub/feature-sync.out': JSON.stringify({
                        proposal: { featureId: 'F1', from: 'wip', to: 'wip', requiresConfirm: true },
                        applied: false,
                    }),
                },
            },
        ],
    },
    {
        id: 'doc-sync-scope-violation',
        git: true,
        env: { ...RUN },
        files: { 'docs/a.md': 'a\n', 'src/x.ts': 'x\n', 'pre-dirty.txt': 'p\n' },
        steps: [
            { ...wrapup('doc-sync-snapshot'), before: { 'pre-dirty.txt': 'changed before\n' } },
            {
                ...wrapup('doc-sync-scope'),
                before: {
                    'docs/a.md': 'edited\n',
                    'docs/tasks/0101_t.md': 'corpus\n',
                    'src/x.ts': 'edited\n',
                    'src/"q.ts': 'odd\n',
                    '.spur/run/r1-wrapup-learnings.md': 'l\n',
                },
            },
        ],
    },
    {
        id: 'doc-sync-scope-pass',
        git: true,
        env: { ...RUN },
        files: { 'docs/a.md': 'a\n' },
        steps: [wrapup('doc-sync-snapshot'), { ...wrapup('doc-sync-scope'), before: { 'docs/b.md': 'new\n' } }],
    },
    {
        id: 'doc-sync-scope-snapshot-missing-and-no-git',
        env: { ...RUN },
        steps: [wrapup('doc-sync-scope'), wrapup('doc-sync-snapshot'), wrapup('doc-sync-scope')],
    },
    {
        id: 'doc-supersession',
        env: { ...RUN },
        steps: [
            wrapup('doc-supersession'),
            {
                ...wrapup('doc-supersession'),
                before: {
                    'repo-wide-tests/adr-supersession.test.ts':
                        "import { expect, test } from 'bun:test';\ntest('pin', () => { expect(1).toBe(1); });\n",
                },
            },
        ],
    },
    {
        id: 'unknown-op',
        env: { ...RUN },
        steps: [wrapup('bogus')],
    },
    {
        id: 'drift-probe-clean',
        env: { ...RUN },
        files: {
            [TASKS_FILE]: '["0101"]',
            'stub/task-show-0101.out': JSON.stringify({
                content: solution(
                    '- `apps/server/src/x.ts:10` change\n- `docs/tasks/0101_t.md:1` corpus\n- `README:3` prose',
                ),
            }),
        },
        steps: [probe],
    },
    {
        id: 'drift-probe-dirty',
        env: { ...RUN },
        files: {
            [TASKS_FILE]: '["0101","0102","0103","0104"]',
            'stub/task-show-0101.out': JSON.stringify({
                content: solution(
                    `- \`packages/contracts/src/a.ts:3-9\`\n- \`newtop/x.ts:1\`\n- \`${BUNDLED_WORKFLOWS}/w.yaml:2\`\n- \`apps/web/src/a.ts:1\``,
                ),
            }),
            'stub/task-show-0102.out': JSON.stringify({ content: solution('nothing parseable') }),
            'stub/task-show-0103.out': 'not json',
            'stub/task-show-0104.rc': '4',
        },
        steps: [probe],
    },
    {
        id: 'drift-probe-missing-capture',
        env: { ...RUN },
        steps: [probe],
    },
    {
        id: 'drift-probe-empty-run-id',
        env: { ...RUN, __runId: '' },
        steps: [probe],
    },
];

export const PREFLIGHT_CASES: GoldenCase[] = [
    {
        id: 'preflight-table-a',
        steps: [
            preflight('0101', ['--status', 'todo']),
            preflight('0101', ['--status', 'todo', '--deps', '0100,0099', '--dep-status', '0100:wip,0099:done']),
            preflight('0101', ['--status', 'todo', '--deps', '0100', '--dep-status', '0100:done', '--json']),
            preflight('0101', ['--status', 'blocked', '--json']),
            preflight('0101', ['--status', 'done']),
            preflight('0101', ['--status', 'backlog']),
        ],
    },
    {
        id: 'preflight-recovery',
        steps: [
            preflight('0101', ['--status', 'wip', '--recovery']),
            preflight('0101', ['--status', 'testing', '--recovery', '--json']),
            preflight('0101', ['--status', 'blocked', '--recovery']),
            preflight('0101', ['--status', 'done', '--recovery']),
            preflight('0101', ['--status', 'done', '--recovery', '--json']),
        ],
    },
    {
        id: 'preflight-quick-readiness',
        steps: [
            preflight('0101', ['--operation', 'run', '--status', 'todo']),
            preflight('0101', ['--operation', 'run', '--status', 'todo', '--filtered-count', '0', '--json']),
            preflight('0101', [
                '--operation',
                'refine',
                '--status',
                'backlog',
                '--required-sections',
                'Requirements,Solution',
                '--present-sections',
                'Requirements',
            ]),
            preflight('0101', ['--operation', 'verify', '--status', 'done']),
            preflight('0101', ['--operation', 'verify', '--status', 'done', '--force', '--json']),
            preflight('0101', [
                '--operation',
                'run',
                '--status',
                'todo',
                '--deps',
                '0100',
                '--dep-status',
                '0100:todo',
            ]),
        ],
    },
    {
        id: 'preflight-classify-feature',
        steps: [
            preflight(null, ['--classify-feature', '[{"code":"L4.scenario-unverified","severity":"error"}]']),
            preflight(null, [
                '--classify-feature',
                '[{"code":"L2.missing","severity":"error"},{"code":"L4.verifying-incomplete-tasks","severity":"error"}]',
            ]),
            preflight(null, ['--classify-feature', '{not json']),
        ],
    },
    {
        id: 'preflight-missing-status',
        steps: [preflight('0101', [])],
    },
];

const BATCH_TASKS = JSON.stringify([
    { wbs: '0101', name: 'First task' },
    { wbs: '0102', name: 'A very long task name that will need to be truncated in the visible plan rows' },
    { wbs: '0103', name: 'Third' },
]);
const SCHEDULE_TASKS = JSON.stringify([
    { wbs: '0103', dependencies: ['0101'], files: ['a.ts'] },
    { wbs: '0101', files: ['a.ts', 'b.ts'] },
    { wbs: '0102', files: ['c.ts'] },
    { wbs: '0104' },
]);
const CYCLE_TASKS = JSON.stringify([
    { wbs: '0101', dependencies: ['0102'] },
    { wbs: '0102', dependencies: ['0101'] },
]);
const TODO_PLAN = JSON.stringify({
    plan: [
        { label: 'A', id: 'prepare', outcome: 'pending', text: 'A Prepare' },
        { label: 'B', id: 'phase.plan', outcome: 'completed', text: 'B Plan', title: 'Plan' },
        { label: 'B1', id: 'state.x', outcome: 'pending', text: 'B1 x', parent: 'B' },
        { label: 'C', id: 'phase.build', outcome: 'active', text: 'C Build', title: 'Build' },
    ],
});

export const BATCH_PLAN_CASES: GoldenCase[] = [
    {
        id: 'batch-plan-waves',
        files: { 'tasks.json': BATCH_TASKS, 'bad.json': '[{"wbs":"0101"}]', 'broken.json': '{' },
        steps: [
            plan(['waves', '--tasks', 'tasks.json']),
            plan(['waves', '--tasks', 'bad.json']),
            plan(['waves', '--tasks', 'broken.json']),
            plan(['waves', '--tasks', 'missing.json']),
            plan(['waves']),
        ],
    },
    {
        id: 'batch-plan-order',
        files: { 'sched.json': SCHEDULE_TASKS, 'cycle.json': CYCLE_TASKS, 'bad.json': '[{"wbs":1}]' },
        steps: [
            plan(['order', '--tasks', 'sched.json']),
            plan(['order', '--tasks', 'sched.json', '--concurrency', '3']),
            plan(['order', '--tasks', 'cycle.json']),
            plan(['order', '--tasks', 'bad.json']),
            plan(['order', '--tasks', 'sched.json', '--concurrency', '0']),
            plan(['order']),
        ],
    },
    {
        id: 'batch-plan-task-children',
        files: { 'plan.json': TODO_PLAN, 'bare.json': JSON.stringify(JSON.parse(TODO_PLAN).plan), 'obj.json': '{}' },
        steps: [
            plan(['task-children', '--letter', 'D', '--plan', 'plan.json']),
            plan(['task-children', '--letter', 'E', '--plan', 'bare.json']),
            plan(['task-children', '--letter', 'E', '--plan', 'obj.json']),
            plan(['task-children', '--letter', 'e', '--plan', 'plan.json']),
        ],
    },
    {
        id: 'batch-plan-unknown-mode',
        steps: [plan(['bogus'])],
    },
];

const FEATURE = `---\nid: D9\nname: Demo\nstatus: verifying\n---\n\n# D9 Demo\n\n## Goal\n\nDemo.\n`;
const verify = (args: string[], idArg: string | null): { old: string[]; new: string[] } => ({
    old: ['feature-verification-steps.ts', 'verify', ...(idArg === null ? [] : ['--feature-id', idArg]), ...args],
    new: ['feature', 'verify', ...(idArg === null ? [] : [idArg]), ...args],
});

export const FEATURE_VERIFY_CASES: GoldenCase[] = [
    {
        id: 'verify-pass-and-fail',
        git: true,
        gitignore: '.spur/\n',
        seedRuns: ['v1', 'v2'],
        files: { 'docs/features/D9_demo.md': FEATURE },
        steps: [verify(['--run-id', 'v1', '--cmd', 'true'], 'D9'), verify(['--run-id', 'v2', '--cmd', 'false'], 'D9')],
    },
    {
        id: 'verify-env-fallback-and-confidence',
        git: true,
        gitignore: '.spur/\n',
        seedRuns: ['v3', 'v4'],
        files: { 'docs/features/D9_demo.md': FEATURE },
        env: { featureId: 'D9', __runId: 'v3', verificationCmd: 'true' },
        steps: [
            verify(['--confidence', 'LOW', '--ack-low-confidence'], null),
            { ...verify([], null), env: { __runId: 'v4', confidence: 'MEDIUM' } },
        ],
    },
    {
        id: 'verify-refusals',
        steps: [
            verify(['--run-id', 'v1', '--cmd', 'true'], '../x'),
            verify(['--run-id', 'v1', '--cmd', 'true'], 'D9'),
            verify(['--cmd', 'true'], 'D9'),
        ],
    },
];

const handoff = { old: ['idea-handoff.ts'], new: ['feature', 'handoff'] };

export const FEATURE_HANDOFF_CASES: GoldenCase[] = [
    {
        id: 'handoff-missing-env',
        steps: [handoff],
    },
    {
        id: 'handoff-missing-files',
        env: { ...RUN, featureId: 'F1' },
        steps: [handoff],
    },
    {
        id: 'handoff-success',
        env: { ...RUN, featureId: 'F1' },
        files: {
            '.spur/run/r1-idea-task-batch.json': JSON.stringify([{ name: 'alpha' }, { name: 'beta' }]),
            '.spur/run/r1-idea-batch-create-result.json': JSON.stringify({ wbs: ['0201', '0202'] }),
            '.spur/run/r1-idea-task-order.json': JSON.stringify([
                { name: 'alpha' },
                { name: 'beta', depends_on_names: ['alpha'] },
            ]),
            'stub/task-show-0201.out': JSON.stringify({ status: 'todo' }),
            'stub/task-show-0202.out': JSON.stringify({ status: 'todo' }),
            'stub/task-path-0201.out': JSON.stringify({ filePath: 'docs/tasks/0201_alpha.md' }),
            'stub/task-path-0202.out': JSON.stringify({ filePath: 'docs/tasks/0202_beta.md' }),
            'docs/tasks/0201_alpha.md': '# alpha\n',
            'docs/tasks/0202_beta.md': '# beta\n',
            'stub/default.out': '{}',
            'stub/default.rc': '0',
        },
        steps: [handoff],
    },
    {
        id: 'handoff-deps-failure',
        env: { ...RUN, featureId: 'F1' },
        files: {
            '.spur/run/r1-idea-task-batch.json': JSON.stringify([{ name: 'alpha' }, { name: 'beta' }]),
            '.spur/run/r1-idea-batch-create-result.json': JSON.stringify({ wbs: ['0201', '0202'] }),
            '.spur/run/r1-idea-task-order.json': JSON.stringify([
                { name: 'alpha' },
                { name: 'beta', depends_on_names: ['alpha'] },
            ]),
            'stub/task-show-0201.out': JSON.stringify({ status: 'todo' }),
            'stub/task-show-0202.out': JSON.stringify({ status: 'todo' }),
            'stub/task-deps.out': 'deps refused',
            'stub/task-deps.rc': '1',
        },
        steps: [handoff],
    },
];

export const ALL_CASES: Record<string, GoldenCase[]> = {
    wrapup: WRAPUP_CASES,
    preflight: PREFLIGHT_CASES,
    batchPlan: BATCH_PLAN_CASES,
    featureVerify: FEATURE_VERIFY_CASES,
    featureHandoff: FEATURE_HANDOFF_CASES,
};
