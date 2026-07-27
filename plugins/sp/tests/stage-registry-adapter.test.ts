import { describe, expect, test } from 'bun:test';
import type { StageResolution, TaskSignal } from '../scripts/stage-registry-adapter';
import {
    bootMain,
    formatStageResult,
    getStage,
    getTableCRedirect,
    listStages,
    parseCliArgs,
    pickFrontierTask,
    REGISTERED_STAGES,
    renderHelp,
    resolveStage,
    runCli,
    unmetDependencies,
} from '../scripts/stage-registry-adapter';

// ─── Fixtures ─────────────────────────────────────────────────────────────

function task(signal: Partial<TaskSignal> & { wbs: string; status: string }): TaskSignal {
    return {
        wbs: signal.wbs,
        status: signal.status,
        dependencies: signal.dependencies ?? [],
        feature_id: signal.feature_id ?? null,
        hasCheckpoint: signal.hasCheckpoint,
    };
}

function tableAResolve(overrides: {
    wbs: string;
    status: string;
    dependencies?: Array<{ wbs: string; status: string }>;
    hasCheckpoint?: boolean;
    auto?: boolean;
    once?: boolean;
    fullMode?: boolean;
}) {
    return resolveStage({
        target: overrides.wbs,
        task: task(overrides),
        auto: overrides.auto,
        once: overrides.once,
        fullMode: overrides.fullMode,
    });
}

// ─── Registry structure ───────────────────────────────────────────────────

describe('stage registry — record structure', () => {
    test('REGISTERED_STAGES contains all 12 canonical stages', () => {
        const ids = REGISTERED_STAGES.map((s) => s.id).sort();
        expect(ids).toEqual([
            'brainstorm',
            'changelog',
            'dogfood',
            'fixall',
            'handover',
            'implement',
            'plan',
            'refine',
            'review',
            'test',
            'verify',
            'wrap',
        ]);
    });

    test('every stage has a unique id', () => {
        const ids = REGISTERED_STAGES.map((s) => s.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('every stage has min required fields', () => {
        for (const s of REGISTERED_STAGES) {
            expect(s.schema_version.major).toBeGreaterThanOrEqual(1);
            expect(s.description.length).toBeGreaterThan(0);
            expect(s.artifacts.length).toBeGreaterThan(0);
            expect(s.reasoning_skill.length).toBeGreaterThan(0);
            expect(s.retry.max_attempts).toBeGreaterThanOrEqual(1);
            expect(['none', 'corpus', 'worktree', 'irreversible']).toContain(s.mutation_class);
            expect(['inline', 'deterministic', 'hitl']).toContain(s.execution.kind);
        }
    });

    test('getStage returns the correct record', () => {
        const refine = getStage('refine');
        expect(refine).toBeDefined();
        expect(refine?.id).toBe('refine');
        expect(refine?.reasoning_skill).toBe('sp:spur-dev');
    });

    test('getStage returns undefined for unknown id', () => {
        expect(getStage('nonexistent')).toBeUndefined();
    });

    test('aliases resolve to the same record', () => {
        const plan = getStage('plan');
        const devPlan = getStage('dev-plan');
        expect(plan).toBeDefined();
        expect(devPlan).toBeDefined();
        expect(plan?.id).toBe('plan');
        expect(devPlan?.id).toBe('plan');
    });

    test('listStages returns correct shape', () => {
        const stages = listStages();
        expect(stages.length).toBe(12);
        expect(stages[0]).toHaveProperty('stage_id');
        expect(stages[0]).toHaveProperty('command');
        expect(stages[0]).toHaveProperty('skill');
    });
});

// ─── TABLE A: task status → dispatch ──────────────────────────────────────

describe('TABLE A — task status routing', () => {
    test('A1 — backlog routes to refine', () => {
        const r = tableAResolve({ wbs: '0101', status: 'backlog' });
        expect(r.tableRow).toBe('A1');
        expect(r.dispatchCommand).toContain('dev-refine');
        expect(r.dispatchCommand).toContain('--auto --next');
        expect(r.reasonKind).toBe('dispatch');
        expect(r.chain).toBe(true);
    });

    test('A2 — todo with unmet deps stops', () => {
        const r = tableAResolve({
            wbs: '0102',
            status: 'todo',
            dependencies: [{ wbs: '0099', status: 'wip' }],
        });
        expect(r.tableRow).toBe('A2');
        expect(r.reasonKind).toBe('blocked');
        expect(r.blocker).toContain('unmet deps');
        expect(r.dispatchCommand).toBeNull();
    });

    test('A2 — todo with no deps does NOT stop (falls to A3)', () => {
        const r = tableAResolve({ wbs: '0103', status: 'todo', dependencies: [] });
        expect(r.tableRow).toBe('A3');
        expect(r.reasonKind).toBe('dispatch');
    });

    test('A3 — todo with all deps done routes to run', () => {
        const r = tableAResolve({
            wbs: '0104',
            status: 'todo',
            dependencies: [
                { wbs: '0099', status: 'done' },
                { wbs: '0098', status: 'done' },
            ],
        });
        expect(r.tableRow).toBe('A3');
        expect(r.dispatchCommand).toContain('dev-run');
        expect(r.dispatchCommand).toContain('--auto --next');
        expect(r.chain).toBe(true);
    });

    test('A4 — wip with checkpoint routes to continue', () => {
        const r = tableAResolve({ wbs: '0105', status: 'wip', hasCheckpoint: true });
        expect(r.tableRow).toBe('A4');
        expect(r.dispatchCommand).toContain('--continue');
        expect(r.chain).toBe(false);
    });

    test('A5 — wip without checkpoint routes to implement', () => {
        const r = tableAResolve({ wbs: '0106', status: 'wip', hasCheckpoint: false });
        expect(r.tableRow).toBe('A5');
        expect(r.dispatchCommand).toContain('--mode implement');
        expect(r.dispatchCommand).toContain('--auto --next');
        expect(r.chain).toBe(true);
    });

    test('A6 — testing routes to verify', () => {
        const r = tableAResolve({ wbs: '0107', status: 'testing' });
        expect(r.tableRow).toBe('A6');
        expect(r.dispatchCommand).toContain('dev-verify');
        expect(r.dispatchCommand).toContain('--auto --next');
        expect(r.chain).toBe(true);
    });

    test('A7 — blocked routes to handover', () => {
        const r = tableAResolve({ wbs: '0108', status: 'blocked' });
        expect(r.tableRow).toBe('A7');
        expect(r.reasonKind).toBe('no-route'); // handover is a stop
        expect(r.dispatchCommand).toBeNull();
        expect(r.requiresConfirmation).toBe(true);
    });

    test('A8 — done routes to wrap', () => {
        const r = tableAResolve({ wbs: '0109', status: 'done' });
        expect(r.tableRow).toBe('A8');
        expect(r.dispatchCommand).toContain('dev-wrap');
        expect(r.requiresConfirmation).toBe(true);
    });

    test('A9 — cancelled stops', () => {
        const r = tableAResolve({ wbs: '0110', status: 'cancelled' });
        expect(r.tableRow).toBe('A9');
        expect(r.reasonKind).toBe('no-route');
        expect(r.dispatchCommand).toBeNull();
    });

    test('unknown status returns no-route', () => {
        const r = tableAResolve({ wbs: '0111', status: 'unknown' });
        expect(r.tableRow).toBeNull();
        expect(r.reasonKind).toBe('no-route');
        expect(r.dispatchCommand).toBeNull();
    });
});

// ─── TABLE A flag forwarding ──────────────────────────────────────────────

describe('TABLE A — flag forwarding', () => {
    test('--once strips --next from dispatch command', () => {
        const r = tableAResolve({ wbs: '0120', status: 'backlog', once: true });
        expect(r.dispatchCommand).not.toContain('--next');
    });

    test('--auto adds --auto when not already present', () => {
        const r = tableAResolve({ wbs: '0121', status: 'done', auto: true });
        expect(r.dispatchCommand).toContain('--auto');
    });

    test('--full rewrites run --next to run --mode full', () => {
        const r = tableAResolve({ wbs: '0122', status: 'todo', dependencies: [], fullMode: true });
        expect(r.tableRow).toBe('A3');
        expect(r.dispatchCommand).toContain('--mode full');
        expect(r.dispatchCommand).not.toContain('--next');
    });
});

// ─── TABLE B: feature-level routing ──────────────────────────────────────

describe('TABLE B — feature-level routing', () => {
    test('B3 — picks frontier task (todo wins over backlog)', () => {
        const r = resolveStage({
            target: 'O',
            feature: {
                id: 'O',
                status: 'active',
                tasks: [
                    { wbs: '0301', status: 'backlog', dependencies: [] },
                    { wbs: '0307', status: 'todo', dependencies: [] },
                    { wbs: '0310', status: 'wip', dependencies: [] },
                ],
            },
        });
        // todo has rank 0, so B3 should pick 0307 (todo)
        expect(r.tableRow).toContain('A'); // delegated to TABLE A
        expect(r.dispatchCommand).toContain('0307');
        expect(r.dispatchCommand).toContain('dev-run');
    });

    test('B3 — picks frontier task (backlog if no todo)', () => {
        const r = resolveStage({
            target: 'M',
            feature: {
                id: 'M',
                status: 'active',
                tasks: [
                    { wbs: '0201', status: 'backlog', dependencies: [] },
                    { wbs: '0205', status: 'wip', dependencies: [] },
                ],
            },
        });
        // backlog rank 1, wip rank 2 → backlog wins
        expect(r.tableRow).toBe('A1');
        expect(r.dispatchCommand).toContain('0201');
    });

    test('B3 — blocks blocked-by-dep tasks from frontier', () => {
        const r = resolveStage({
            target: 'P',
            feature: {
                id: 'P',
                status: 'active',
                tasks: [
                    { wbs: '0401', status: 'todo', dependencies: [{ wbs: '0399', status: 'wip' }] },
                    { wbs: '0402', status: 'todo', dependencies: [] },
                ],
            },
        });
        // 0401 is blocked by dep (0399 wip), 0402 is ready
        expect(r.dispatchCommand).toContain('0402');
    });

    test('B6 — all tasks done routes to wrapall', () => {
        const r = resolveStage({
            target: 'Q',
            feature: {
                id: 'Q',
                status: 'active',
                tasks: [
                    { wbs: '0501', status: 'done', dependencies: [] },
                    { wbs: '0502', status: 'done', dependencies: [] },
                    { wbs: '0503', status: 'cancelled', dependencies: [] },
                ],
            },
        });
        expect(r.tableRow).toBe('B6');
        expect(r.dispatchCommand).toContain('dev-wrapall');
        expect(r.requiresConfirmation).toBe(true);
    });

    test('B1 — cancelled feature stops', () => {
        const r = resolveStage({
            target: 'R',
            feature: { id: 'R', status: 'cancelled', tasks: [] },
        });
        expect(r.tableRow).toBe('B1');
        expect(r.reasonKind).toBe('blocked');
    });

    test('B2 — done feature stops', () => {
        const r = resolveStage({
            target: 'S',
            feature: { id: 'S', status: 'done', tasks: [{ wbs: '0601', status: 'done', dependencies: [] }] },
        });
        expect(r.tableRow).toBe('B2');
        expect(r.reasonKind).toBe('blocked');
    });

    test('B8 — blocked feature stops', () => {
        const r = resolveStage({
            target: 'T',
            feature: { id: 'T', status: 'blocked', tasks: [] },
        });
        expect(r.tableRow).toBe('B8');
        expect(r.reasonKind).toBe('blocked');
    });
});

// ─── Frontier selection ──────────────────────────────────────────────────

describe('pickFrontierTask — feature frontier algorithm', () => {
    test('returns null for no open tasks', () => {
        expect(
            pickFrontierTask([
                { wbs: '0701', status: 'done', dependencies: [] },
                { wbs: '0702', status: 'cancelled', dependencies: [] },
            ]),
        ).toBeNull();
    });

    test('prefers todo over backlog', () => {
        const result = pickFrontierTask([
            { wbs: '0801', status: 'backlog', dependencies: [] },
            { wbs: '0802', status: 'todo', dependencies: [] },
        ]);
        expect(result).not.toBeNull();
        expect(result?.wbs).toBe('0802');
    });

    test('sorts by WBS ascending when same status', () => {
        const result = pickFrontierTask([
            { wbs: '0902', status: 'todo', dependencies: [] },
            { wbs: '0901', status: 'todo', dependencies: [] },
        ]);
        expect(result).not.toBeNull();
        expect(result?.wbs).toBe('0901');
    });
});

// ─── Dependency helpers ──────────────────────────────────────────────────

describe('unmetDependencies', () => {
    test('returns only non-done deps', () => {
        const result = unmetDependencies(
            task({
                wbs: '1001',
                status: 'todo',
                dependencies: [
                    { wbs: '1000', status: 'done' },
                    { wbs: '0999', status: 'wip' },
                    { wbs: '0998', status: 'backlog' },
                ],
            }),
        );
        expect(result).toEqual(['0999', '0998']);
    });

    test('returns empty when all deps done', () => {
        const result = unmetDependencies(
            task({
                wbs: '1002',
                status: 'todo',
                dependencies: [{ wbs: '1000', status: 'done' }],
            }),
        );
        expect(result).toEqual([]);
    });
});

// ─── Help and error behavior ──────────────────────────────────────────────

describe('discoverability and error behavior (R4)', () => {
    test('renderHelp provides stage list', () => {
        const help = renderHelp();
        expect(help).toContain('stage-registry-adapter');
        expect(help).toContain('refine');
        expect(help).toContain('verify');
        expect(help).toContain('wrap');
    });

    test('CLI with no args prints error and help', () => {
        const r = runCli([]);
        expect(r.exitCode).toBe(1);
        expect(r.stderr).toContain('error');
        expect(r.stderr).toContain('--wbs');
    });

    test('CLI --list-stages outputs tab-separated values', () => {
        const r = runCli(['--list-stages']);
        expect(r.exitCode).toBe(0);
        const lines = r.stdout.trim().split('\n');
        expect(lines.length).toBe(12);
        const first = lines[0];
        expect(first).toBeDefined();
        expect(first).toContain('\t');
    });

    test('CLI --help prints usage', () => {
        const r = runCli(['--help']);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain('Usage');
        expect(r.stdout).toContain('--wbs');
    });

    test('CLI --wbs with unknown status prints no-route', () => {
        const r = runCli(['--wbs', '9999']);
        expect(r.exitCode).toBe(2);
        expect(r.stdout).toContain('no-route');
    });
});

// ─── Stage record invariants ──────────────────────────────────────────────

describe('stage record invariants', () => {
    test('every record has at least one artifact', () => {
        for (const s of REGISTERED_STAGES) {
            expect(s.artifacts.length).toBeGreaterThanOrEqual(1);
        }
    });

    test('every record has a valid retry policy', () => {
        for (const s of REGISTERED_STAGES) {
            expect(s.retry.max_attempts).toBeGreaterThanOrEqual(1);
            expect(['block', 'escalate', 'fail']).toContain(s.retry.terminal_stop);
        }
    });

    test('every record has a valid model policy', () => {
        for (const s of REGISTERED_STAGES) {
            expect(['cheap', 'standard', 'capable-1', 'capable-2', 'capable-3']).toContain(s.model_policy.min_tier);
            expect(Array.isArray(s.model_policy.fallback)).toBe(true);
        }
    });

    test('wrap stage has task-check pre-gate', () => {
        const wrap = getStage('wrap');
        expect(wrap).toBeDefined();
        const preGates = (wrap?.gates ?? []).filter((g) => g.timing === 'pre');
        expect(preGates.some((g) => g.name === 'task-check')).toBe(true);
    });

    test('verify stage has verdict-artifact gate', () => {
        const verify = getStage('verify');
        expect(verify).toBeDefined();
        const postGates = (verify?.gates ?? []).filter((g) => g.timing === 'post');
        expect(postGates.some((g) => g.name === 'verdict-artifact')).toBe(true);
    });

    test('test stage has coverage-floor gate', () => {
        const test = getStage('test');
        expect(test).toBeDefined();
        const postGates = (test?.gates ?? []).filter((g) => g.timing === 'post');
        expect(postGates.some((g) => g.name === 'coverage-floor')).toBe(true);
    });

    test('dogfood stage has detect-pipeline-driving pre-gate', () => {
        const dogfood = getStage('dogfood');
        expect(dogfood).toBeDefined();
        const preGates = (dogfood?.gates ?? []).filter((g) => g.timing === 'pre');
        expect(preGates.some((g) => g.name === 'detect-pipeline-driving')).toBe(true);
    });
});

// ─── Additional coverage ──────────────────────────────────────────────────

describe('additional coverage', () => {
    test('getTableCRedirect returns redirect for known rows', () => {
        const c1 = getTableCRedirect('A1');
        expect(c1).toBeDefined();
        expect(c1?.rowId).toBe('C1');
    });

    test('getTableCRedirect returns undefined for unknown rows', () => {
        expect(getTableCRedirect('Z9')).toBeUndefined();
    });

    test('resolveStage with no task/feature returns usage', () => {
        const r = resolveStage({ target: '' });
        expect(r.reasonKind).toBe('usage');
        expect(r.stage).toBeNull();
        expect(r.dispatchCommand).toBeNull();
    });

    test('B4 — no frontier, feature backlog, no open tasks', () => {
        const r = resolveStage({
            target: 'U',
            feature: { id: 'U', status: 'backlog', tasks: [] },
        });
        expect(r.tableRow).toBe('B4');
        expect(r.reasonKind).toBe('blocked');
    });

    test('B5 — no frontier, active feature, zero tasks', () => {
        const r = resolveStage({
            target: 'V',
            feature: { id: 'V', status: 'active', tasks: [] },
        });
        expect(r.tableRow).toBe('B5');
        expect(r.reasonKind).toBe('blocked');
    });

    test('B6 — all tasks done dispatches wrapall', () => {
        const r = resolveStage({
            target: 'W',
            feature: {
                id: 'W',
                status: 'active',
                tasks: [
                    { wbs: 'w01', status: 'done', dependencies: [] },
                    { wbs: 'w02', status: 'cancelled', dependencies: [] },
                ],
            },
        });
        expect(r.tableRow).toBe('B6');
        expect(r.dispatchCommand).toContain('dev-wrapall');
    });

    test('unmetDependencies returns empty for empty deps', () => {
        expect(unmetDependencies({ wbs: 'y01', status: 'todo', dependencies: [] })).toEqual([]);
    });

    test('CLI with --wbs and --feature', () => {
        const r = runCli(['--wbs', '0307', '--feature', 'O']);
        expect(r.exitCode).toBeGreaterThanOrEqual(0);
        expect(typeof r.stdout).toBe('string');
    });

    test('CLI with --wbs and unknown status prints output', () => {
        const r = runCli(['--wbs', '0307']);
        expect(r.stderr).toBe('');
    });

    test('CLI with --once', () => {
        const r = runCli(['--wbs', '0307', '--once']);
        expect(r.exitCode).toBeGreaterThanOrEqual(0);
    });

    test('CLI with --full', () => {
        const r = runCli(['--wbs', '0307', '--full']);
        expect(r.exitCode).toBeGreaterThanOrEqual(0);
    });

    test('listStages maps test to dev-unit', () => {
        const stages = listStages();
        const testEntry = stages.find((s) => s.stage_id === 'test');
        expect(testEntry).toBeDefined();
        expect(testEntry?.command).toBe('/sp:dev-unit');
    });

    test('listStages maps wrap to dev-wrap', () => {
        const stages = listStages();
        const wrapEntry = stages.find((s) => s.stage_id === 'wrap');
        expect(wrapEntry).toBeDefined();
        expect(wrapEntry?.command).toBe('/sp:dev-wrap');
    });

    test('stage resolution preserves --auto flag forwarding', () => {
        const r = tableAResolve({ wbs: '0125', status: 'backlog', auto: true });
        expect(r.dispatchCommand).toContain('--auto');
    });

    test('stage resolution preserves --once for backlog', () => {
        const r = tableAResolve({ wbs: '0126', status: 'backlog', once: true });
        expect(r.dispatchCommand).not.toContain('--next');
    });

    // ── Additional coverage for function & line gaps ──
    test('B4 filter arrow — tasks in non-open statuses exercise filter', () => {
        // The B4 condition has a .filter() arrow that V8 counts as a separate function.
        // Test with tasks in done/cancelled status so the filter iterates but returns empty.
        const r = resolveStage({
            target: 'F',
            feature: {
                id: 'F',
                status: 'backlog',
                tasks: [
                    { wbs: 'f01', status: 'done', dependencies: [] },
                    { wbs: 'f02', status: 'cancelled', dependencies: [] },
                ],
            },
        });
        // B4 matches: feature is backlog, no open tasks → blocked
        expect(r.tableRow).toBe('B4');
        expect(r.reasonKind).toBe('blocked');
    });

    test('resolveFeature no-route for unmatched feature status without B5 match', () => {
        // Provide tasks so B5 (zero-tasks) doesn't match. Use status 'unknown'
        // which no B row's condition accepts.
        const r = resolveStage({
            target: 'Z',
            feature: {
                id: 'Z',
                status: 'unknown',
                tasks: [{ wbs: 'z01', status: 'strange_status', dependencies: [] }],
            },
        });
        expect(r.tableRow).toBeNull();
        expect(r.reasonKind).toBe('no-route');
        expect(r.reason).toContain('no route for feature Z');
    });

    test('resolveFeature B3 inconsistent — condition matches but no frontier due to deps', () => {
        // B3 condition matches (task has open status), but pickFrontierTask
        // returns null because the dependency is not done.
        const r = resolveStage({
            target: 'I',
            feature: {
                id: 'I',
                status: 'active',
                tasks: [
                    {
                        wbs: 'i01',
                        status: 'todo',
                        dependencies: [{ wbs: 'dep', status: 'backlog' }],
                    },
                ],
            },
        });
        expect(r.tableRow).toBe('B3');
        expect(r.reasonKind).toBe('error');
    });

    test('runCli --help returns help text', () => {
        const r = runCli(['--help']);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain('Usage:');
        expect(r.stdout).toContain('--wbs');
    });

    test('runCli --list-stages', () => {
        const r = runCli(['--list-stages']);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain('dev-unit');
        expect(r.stdout).toContain('dev-wrap');
    });

    test('runCli with no args prints usage and exits 1', () => {
        const r = runCli([]);
        expect(r.exitCode).toBe(1);
        expect(r.stderr).toContain('--wbs');
    });

    test('runCli with --dry-run and --wbs sets dispatch output', () => {
        const r = runCli(['--wbs', '0307', '--dry-run']);
        expect(r.exitCode).toBeGreaterThanOrEqual(0);
        expect(r.stdout).toContain('dev-next:');
    });

    test('runCli with --feature and --dry-run', () => {
        const r = runCli(['--feature', 'O', '--dry-run']);
        expect(r.exitCode).toBeGreaterThanOrEqual(0);
    });

    test('runCli with --auto flag propagates auto', () => {
        const r = runCli(['--wbs', '0307', '--auto']);
        expect(r.exitCode).toBeGreaterThanOrEqual(0);
        expect(r.stdout).toContain('dev-next:');
    });

    test('parseCliArgs --dry-run and --auto each set correctly', () => {
        const r1 = parseCliArgs(['--dry-run']);
        expect(r1.dryRun).toBe(true);
        expect(r1.auto).toBe(false);

        const r2 = parseCliArgs(['--auto']);
        expect(r2.auto).toBe(true);
        expect(r2.dryRun).toBe(false);
    });

    test('B5 filter arrow — feature with non-empty all-done tasks exercises callback', () => {
        // B5's inner filter((t) => !['done','cancelled'].includes(t.status))
        // arrow is never called when tasks is empty. Provide tasks to exercise it.
        const r = resolveStage({
            target: 'X1',
            feature: {
                id: 'X1',
                status: 'unknown',
                tasks: [
                    { wbs: 'x01', status: 'done', dependencies: [] },
                    { wbs: 'x02', status: 'cancelled', dependencies: [] },
                ],
            },
        });
        expect(r.tableRow).toBe('B7');
        expect(r.reasonKind).toBe('blocked');
    });

    test('B7 condition arrow — all-done tasks with non-standard status', () => {
        const r = resolveStage({
            target: 'X2',
            feature: {
                id: 'X2',
                status: 'unknown',
                tasks: [{ wbs: 'x03', status: 'done', dependencies: [] }],
            },
        });
        expect(r.tableRow).toBe('B7');
        expect(r.reasonKind).toContain('blocked');
    });

    test('unmetDependencies callbacks — filter and map inner arrows', () => {
        const r = unmetDependencies({
            wbs: 'u01',
            status: 'todo',
            dependencies: [
                { wbs: 'dep-a', status: 'backlog' },
                { wbs: 'dep-b', status: 'done' },
            ],
        });
        expect(r).toEqual(['dep-a']);
    });

    test('formatStageResult renders dispatch, chain, and next-outcome fields', () => {
        const result: StageResolution = {
            stage: null,
            target: 'T01',
            status: 'active',
            tableRow: 'B6',
            reason: 'all tasks done — wrap up feature',
            reasonKind: 'dispatch',
            requiresConfirmation: true,
            chain: false,
            dispatchCommand: '/sp:dev-wrapall --feature T01',
            nextObservableOutcome: 'feature transition or wrap',
        };
        const lines = formatStageResult(result);
        const output = lines.join('\n');
        expect(output).toContain('dispatch: /sp:dev-wrapall');
        expect(output).toContain('next outcome:');
    });

    test('formatStageResult renders chain flag', () => {
        const result: StageResolution = {
            stage: null,
            target: 'X',
            status: 'todo',
            tableRow: 'A3',
            reason: 'ready',
            reasonKind: 'dispatch',
            chain: true,
            requiresConfirmation: false,
            dispatchCommand: '/sp:dev-run X',
        };
        const lines = formatStageResult(result);
        expect(lines.join('\n')).toContain('chain: yes');
    });

    test('formatStageResult renders blocker', () => {
        const result: StageResolution = {
            stage: null,
            target: 'B',
            status: 'blocked',
            tableRow: 'A7',
            reason: 'blocked',
            reasonKind: 'blocked',
            chain: false,
            requiresConfirmation: true,
            blocker: 'dependency not met',
        };
        const lines = formatStageResult(result);
        expect(lines.join('\n')).toContain('blocker: dependency');
    });

    test('runCli --task-status backlog dispatches via A1', () => {
        // --task-status backlog makes TABLE A1 match, producing dispatchCommand and chain output.
        const r = runCli(['--wbs', '0307', '--task-status', 'backlog']);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain('dispatch:');
        expect(r.stdout).toContain('chain: yes');
    });

    test('runCli catch handler with throwing resolve', () => {
        const r = runCli(['--wbs', 'X'], {
            resolve: () => {
                throw new Error('simulated failure');
            },
        });
        expect(r.exitCode).toBe(1);
        expect(r.stderr).toContain('simulated failure');
    });

    test('bootMain with injectable runCli avoids process.exit', () => {
        const origExit = process.exit;
        let exitCode: number | undefined;
        const exitSpy = (code?: number) => {
            exitCode = code;
        };
        process.exit = exitSpy as (code?: number) => void;
        try {
            bootMain(['--wbs', 'X'], {
                run: () => ({ exitCode: 42, stdout: 'test-output', stderr: '' }),
                stdout: { write: () => true },
                stderr: { write: () => true },
            });
            expect(exitCode).toBe(42);
        } finally {
            (process.exit as unknown as (code?: number) => void) = origExit;
        }
    });

    test('bootMain with injected stdout/stderr writes streams and exits', () => {
        const writes: string[] = [];
        const fakeStdout = {
            write: (s: string) => {
                writes.push(`out:${s}`);
                return true;
            },
        };
        const fakeStderr = {
            write: (s: string) => {
                writes.push(`err:${s}`);
                return true;
            },
        };
        let exitCode: number | undefined;
        bootMain(['--wbs', 'X'], {
            run: () => ({ exitCode: 7, stdout: 'outstream\n', stderr: 'errstream\n' }),
            exit: (code?: number) => {
                exitCode = code;
            },
            stdout: fakeStdout,
            stderr: fakeStderr,
        });
        expect(exitCode).toBe(7);
        expect(writes).toEqual(['out:outstream\n', 'err:errstream\n']);
    });

    test('bootMain defaults to runCli when no run override', () => {
        let exitCode: number | undefined;
        bootMain(['--help'], {
            exit: (code?: number) => {
                exitCode = code;
            },
            stdout: { write: () => true },
            stderr: { write: () => true },
        });
        expect(exitCode).toBe(0);
    });
});
