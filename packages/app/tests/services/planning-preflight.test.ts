import { describe, expect, test } from 'bun:test';
import {
    classifyFeaturePreflightFindings,
    NON_ABORTING_PREFLIGHT_CODES,
    preflightTask,
    quickReadiness,
    type ReadinessOperation,
} from '../../src/services/planning-admission';
import {
    type PreflightOutcome,
    type PreflightRequest,
    parseCommaList,
    parseDepStatuses,
    recoveryHint,
    runPreflight,
} from '../../src/services/planning-preflight';

/**
 * Moved from `plugins/sp/tests/batch-preflight.test.ts` with the logic (script-absorption PR-5:
 * `spur task preflight` replaces the plugin script). `runPreflightCli` maps the retired script's
 * flag spelling onto a {@link PreflightRequest} — the same mapping the CLI adapter
 * (`apps/cli/src/commands/task/preflight.ts`) applies to its options — so these pins keep reading
 * as the batch driver's calls.
 */
function runPreflightCli(argv: string[]): PreflightOutcome {
    const flag = (name: string): string | undefined => {
        const i = argv.indexOf(name);
        return i >= 0 ? argv[i + 1] : undefined;
    };
    const op = flag('--operation');
    const filtered = flag('--filtered-count');
    const count = filtered === undefined ? Number.NaN : Number(filtered);
    const req: PreflightRequest = {
        wbs: flag('--wbs') ?? '0000',
        status: flag('--status') ?? null,
        deps: parseCommaList(flag('--deps')),
        depStatuses: parseDepStatuses(flag('--dep-status')),
        recovery: argv.includes('--recovery'),
        json: argv.includes('--json'),
        operation: op === 'run' || op === 'refine' || op === 'verify' ? op : null,
        force: argv.includes('--force'),
        filteredCount: Number.isFinite(count) ? count : null,
        requiredSections: parseCommaList(flag('--required-sections')),
        presentSections: parseCommaList(flag('--present-sections')),
        classifyFeature: flag('--classify-feature') ?? null,
    };
    return runPreflight(req);
}

describe('batch-preflight — TABLE A STOP evaluation (task 0279)', () => {
    test('A2 — todo with unmet dep is skipped (no pipeline launch)', () => {
        const r = preflightTask({
            wbs: '0279',
            status: 'todo',
            dependencies: ['0275'],
            depStatuses: { '0275': 'wip' },
        });
        expect(r.action).toBe('skip');
        if (r.action !== 'skip') throw new Error('expected skip');
        expect(r.code).toBe('A2');
        expect(r.unmetDeps).toEqual(['0275']);
        expect(r.reason).toContain('unmet');
    });

    test('A2 — missing dep status counts as unmet', () => {
        const r = preflightTask({
            wbs: '0100',
            status: 'todo',
            dependencies: ['0099'],
            depStatuses: {},
        });
        expect(r.action).toBe('skip');
        if (r.action === 'skip') expect(r.unmetDeps).toEqual(['0099']);
    });

    test('ready todo with all deps done → run (happy path still pipeline)', () => {
        const r = preflightTask({
            wbs: '0279',
            status: 'todo',
            dependencies: ['0275'],
            depStatuses: { '0275': 'done' },
        });
        expect(r.action).toBe('run');
    });

    test('todo with empty deps → run', () => {
        const r = preflightTask({
            wbs: '0001',
            status: 'todo',
            dependencies: [],
            depStatuses: {},
        });
        expect(r.action).toBe('run');
    });

    test('A9 cancelled → skip', () => {
        const r = preflightTask({
            wbs: '0002',
            status: 'cancelled',
            dependencies: [],
            depStatuses: {},
        });
        expect(r.action).toBe('skip');
        if (r.action === 'skip') expect(r.code).toBe('A9');
    });

    test('A8 done → skip (batch does not auto-wrap)', () => {
        const r = preflightTask({
            wbs: '0003',
            status: 'done',
            dependencies: [],
            depStatuses: {},
        });
        expect(r.action).toBe('skip');
        if (r.action === 'skip') expect(r.code).toBe('A8');
    });

    test('A7 blocked → skip', () => {
        const r = preflightTask({
            wbs: '0004',
            status: 'blocked',
            dependencies: [],
            depStatuses: {},
        });
        expect(r.action).toBe('skip');
        if (r.action === 'skip') expect(r.code).toBe('A7');
    });

    test('wip and testing → run (pipeline / verify still via pipeline path)', () => {
        expect(preflightTask({ wbs: '1', status: 'wip', dependencies: [], depStatuses: {} }).action).toBe('run');
        expect(preflightTask({ wbs: '1', status: 'testing', dependencies: [], depStatuses: {} }).action).toBe('run');
    });

    test('ADR-137 (1190) — a deprecated task is never routed into the pipeline', () => {
        const r = preflightTask({ wbs: '1190', status: 'deprecated', dependencies: [], depStatuses: {} });
        expect(r.action).toBe('skip');
        if (r.action !== 'skip') throw new Error('expected skip');
        expect(r.code).toBe('DEPRECATED');
        expect(r.reason).toContain('spur task update 1190 todo');
        const cli = runPreflightCli(['--wbs', '1190', '--status', 'deprecated']);
        expect(cli.exitCode).toBe(2);
        expect(cli.stdout).toContain('skip DEPRECATED');
    });

    test('recoveryHint — one hop per status (never a loop)', () => {
        expect(recoveryHint('testing', '0042')?.command).toContain('dev-verify 0042');
        expect(recoveryHint('wip', '0042')?.command).toContain('implement');
        expect(recoveryHint('todo', '0042')?.command).toContain('dev-run 0042');
        expect(recoveryHint('done', '0042')).toBeNull();
    });

    test('CLI — A2 skip exits 2; ready exits 0', () => {
        const skip = runPreflightCli([
            '--wbs',
            '0279',
            '--status',
            'todo',
            '--deps',
            '0275',
            '--dep-status',
            '0275:todo',
            '--json',
        ]);
        expect(skip.exitCode).toBe(2);
        expect(JSON.parse(skip.stdout).action).toBe('skip');

        const ok = runPreflightCli([
            '--wbs',
            '0279',
            '--status',
            'todo',
            '--deps',
            '0275',
            '--dep-status',
            '0275:done',
        ]);
        expect(ok.exitCode).toBe(0);
        expect(ok.stdout).toContain('run:');
    });

    test('CLI — recovery prints single hop', () => {
        const r = runPreflightCli(['--wbs', '0042', '--status', 'testing', '--recovery']);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toContain('/sp:dev-verify 0042');
    });

    test('CLI — help / usage / recovery json / no recovery for done', () => {
        const usage = runPreflightCli([]);
        expect(usage.exitCode).toBe(1);
        expect(usage.stderr).toContain('spur task preflight <wbs>');
        const j = runPreflightCli(['--wbs', '1', '--status', 'wip', '--recovery', '--json']);
        expect(j.exitCode).toBe(0);
        expect(JSON.parse(j.stdout).recovery.command).toContain('implement');
        const none = runPreflightCli(['--wbs', '1', '--status', 'done', '--recovery']);
        expect(none.stdout).toContain('no recovery hop');
        expect(recoveryHint('backlog', '9')?.command).toContain('dev-refine');
        expect(recoveryHint('blocked', '9')?.command).toContain('dev-handover');
    });
});

describe('quickReadiness — command-aware readiness (task 0814 R2)', () => {
    test('runnable — todo run with no required-section gaps', () => {
        const r = quickReadiness({ wbs: '0814', status: 'todo', operation: 'run' });
        expect(r.action).toBe('runnable');
    });

    test('needs-refinement — run with an incomplete required section', () => {
        const r = quickReadiness({
            wbs: '0814',
            status: 'todo',
            operation: 'run',
            requiredSections: ['Solution'],
            sectionFindings: { Solution: 'empty placeholder' },
        });
        expect(r.action).toBe('needs-refinement');
        if (r.action === 'needs-refinement') expect(r.gaps).toEqual(['Solution']);
    });

    test('refine treats planning gaps as work, not a failure', () => {
        const r = quickReadiness({
            wbs: '0814',
            status: 'todo',
            operation: 'refine',
            requiredSections: ['Design', 'Plan'],
            sectionFindings: { Design: 'missing design', Plan: 'placeholder' },
        });
        expect(r.action).toBe('runnable');
    });

    test('blocked — run with an unmet out-of-set dependency', () => {
        const r = quickReadiness({
            wbs: '0814',
            status: 'todo',
            operation: 'run',
            dependencies: ['0275'],
            depStatuses: { '0275': 'wip' },
        });
        expect(r.action).toBe('blocked');
        if (r.action === 'blocked') expect(r.unmetDeps).toEqual(['0275']);
    });

    test('ADR-137 (1190) — a deprecated task is non-runnable with its own code', () => {
        for (const operation of ['run', 'refine', 'verify'] as ReadinessOperation[]) {
            const r = quickReadiness({ wbs: '1190', status: 'deprecated', operation });
            expect(r.action).toBe('skipped');
            if (r.action !== 'skipped') throw new Error('expected skipped');
            expect(r.code).toBe('DEPRECATED');
            expect(r.reason).toContain('spur task update 1190 todo');
        }
        // Even verify --force never re-admits a frozen task (unlike done/cancelled).
        const forced = quickReadiness({ wbs: '1190', status: 'deprecated', operation: 'verify', force: true });
        expect(forced.action).toBe('skipped');
        if (forced.action === 'skipped') expect(forced.code).toBe('DEPRECATED');

        const cli = runPreflightCli(['--operation', 'run', '--wbs', '1190', '--status', 'deprecated', '--json']);
        expect(cli.exitCode).toBe(2);
        expect(JSON.parse(cli.stdout).code).toBe('DEPRECATED');
    });

    test('ADR-137 (1190) — a deprecated dependency never reads as satisfied', () => {
        const r = quickReadiness({
            wbs: '0814',
            status: 'todo',
            operation: 'run',
            dependencies: ['1190'],
            depStatuses: { '1190': 'deprecated' },
        });
        expect(r.action).toBe('blocked');
        if (r.action !== 'blocked') throw new Error('expected blocked');
        expect(r.code).toBe('DEP');
        expect(r.unmetDeps).toEqual(['1190']);
        expect(r.reason).toContain('deprecated');
        expect(r.reason).toContain('spur task update 1190 todo');
    });

    test('skipped — empty status-filtered set (zero-task rule)', () => {
        const r = quickReadiness({ wbs: '0814', status: 'todo', operation: 'run', filteredCount: 0 });
        expect(r.action).toBe('skipped');
        if (r.action === 'skipped') expect(r.code).toBe('EMPTY');
    });

    test('skipped — done/cancelled', () => {
        expect(quickReadiness({ wbs: '1', status: 'done', operation: 'verify' }).action).toBe('skipped');
        expect(quickReadiness({ wbs: '1', status: 'cancelled', operation: 'run' }).action).toBe('skipped');
    });

    test('invalid — unknown operation, or verify/run on an ineligible status', () => {
        expect(quickReadiness({ wbs: '1', status: 'todo', operation: 'bogus' as ReadinessOperation }).action).toBe(
            'invalid',
        );
        expect(quickReadiness({ wbs: '1', status: 'todo', operation: 'verify' }).action).toBe('invalid');
        expect(quickReadiness({ wbs: '1', status: 'backlog', operation: 'run' }).action).toBe('invalid');
    });

    test('verify — testing/wip are runnable; blocked status blocks', () => {
        expect(quickReadiness({ wbs: '1', status: 'testing', operation: 'verify' }).action).toBe('runnable');
        expect(quickReadiness({ wbs: '1', status: 'wip', operation: 'verify' }).action).toBe('runnable');
        expect(quickReadiness({ wbs: '1', status: 'blocked', operation: 'verify' }).action).toBe('blocked');
    });

    test('verify --force re-verifies an already-done/cancelled task instead of skipping', () => {
        expect(quickReadiness({ wbs: '1', status: 'done', operation: 'verify', force: true }).action).toBe('runnable');
        expect(quickReadiness({ wbs: '1', status: 'done', operation: 'verify', force: true }).code).toBe('FORCE');
        expect(quickReadiness({ wbs: '1', status: 'cancelled', operation: 'verify', force: true }).action).toBe(
            'runnable',
        );
        // force never re-admits a non-verify operation, and a dirty tree stays the owner's gate.
        expect(quickReadiness({ wbs: '1', status: 'done', operation: 'run', force: true }).action).toBe('skipped');
    });

    test('negative filteredCount is invalid; zero is skipped (empty-set rule)', () => {
        expect(quickReadiness({ wbs: '1', status: 'todo', operation: 'run', filteredCount: -1 }).action).toBe(
            'invalid',
        );
        expect(quickReadiness({ wbs: '1', status: 'todo', operation: 'run', filteredCount: 0 }).action).toBe('skipped');
    });

    test('presentSections lets the function detect a missing required section itself', () => {
        const r = quickReadiness({
            wbs: '0814',
            status: 'todo',
            operation: 'run',
            requiredSections: ['Solution', 'Review'],
            presentSections: ['Solution'],
        });
        expect(r.action).toBe('needs-refinement');
        if (r.action === 'needs-refinement') expect(r.gaps).toEqual(['Review']);
    });

    test('CLI quick-readiness mode (--operation) returns structured outcomes', () => {
        const runnable = runPreflightCli(['--operation', 'run', '--wbs', '0814', '--status', 'todo', '--json']);
        expect(runnable.exitCode).toBe(0);
        expect(JSON.parse(runnable.stdout).action).toBe('runnable');
        const force = runPreflightCli(['--operation', 'verify', '--wbs', '1', '--status', 'done', '--force', '--json']);
        expect(force.exitCode).toBe(0);
        expect(JSON.parse(force.stdout).code).toBe('FORCE');
        const skip = runPreflightCli([
            '--operation',
            'run',
            '--wbs',
            '1',
            '--status',
            'todo',
            '--filtered-count',
            '0',
            '--json',
        ]);
        expect(skip.exitCode).toBe(2);
        expect(JSON.parse(skip.stdout).action).toBe('skipped');
    });

    test('refine on a non-plan status is skipped (NONPLAN), not run', () => {
        expect(quickReadiness({ wbs: '0814', status: 'wip', operation: 'refine' }).action).toBe('skipped');
        const r = quickReadiness({ wbs: '1', status: 'testing', operation: 'refine' });
        expect(r.action).toBe('skipped');
        if (r.action === 'skipped') expect(r.code).toBe('NONPLAN');
    });

    test('runPreflightCli — quick-readiness non-json text output', () => {
        const ok = runPreflightCli(['--operation', 'run', '--wbs', '0814', '--status', 'todo']);
        expect(ok.exitCode).toBe(0);
        expect(ok.stdout).toContain('runnable');
        const skip = runPreflightCli(['--operation', 'run', '--wbs', '1', '--status', 'todo', '--filtered-count', '0']);
        expect(skip.exitCode).toBe(2);
        expect(skip.stdout).toContain('skipped');
        expect(skip.stdout).toContain('EMPTY');
    });

    test('runPreflightCli — preflight non-json skip text output', () => {
        const done = runPreflightCli(['--wbs', '1', '--status', 'done']);
        expect(done.exitCode).toBe(2);
        expect(done.stdout).toContain('skip A8');
        const blocked = runPreflightCli(['--wbs', '1', '--status', 'blocked']);
        expect(blocked.exitCode).toBe(2);
        expect(blocked.stdout).toContain('skip A7');
    });
});

describe('preflight list parsing (task 0814 R2)', () => {
    test('parseCommaList trims, drops empties, and maps an empty or absent value to []', () => {
        expect(parseCommaList('Plan, Solution ,,')).toEqual(['Plan', 'Solution']);
        expect(parseCommaList('')).toEqual([]);
        expect(parseCommaList(undefined)).toEqual([]);
    });

    test('parseDepStatuses builds the dep → status map and skips malformed parts', () => {
        expect(parseDepStatuses('0275:done, 0276 : todo,bogus,:x')).toEqual({ '0275': 'done', '0276': 'todo' });
        expect(parseDepStatuses(undefined)).toEqual({});
    });

    test('the flag mapping carries sections, filtered count and force into quick readiness', () => {
        const r = runPreflightCli([
            '--operation',
            'run',
            '--wbs',
            '0814',
            '--status',
            'todo',
            '--required-sections',
            'Plan,Solution',
            '--present-sections',
            'Solution',
            '--filtered-count',
            '3',
            '--json',
        ]);
        expect(r.exitCode).toBe(0);
        expect(JSON.parse(r.stdout)).toMatchObject({ action: 'needs-refinement' });
        expect(
            runPreflightCli(['--operation', 'run', '--wbs', '1', '--status', 'todo', '--filtered-count', 'x']).exitCode,
        ).toBe(0);
    });

    test('1132 R4: feature preflight classifies L4.scenario-unverified and L4.verifying-incomplete-tasks as nonAborting', () => {
        expect(NON_ABORTING_PREFLIGHT_CODES.has('L4.scenario-unverified')).toBe(true);
        expect(NON_ABORTING_PREFLIGHT_CODES.has('L4.verifying-incomplete-tasks')).toBe(true);

        const findings = [
            { layer: 'L4', code: 'L4.verifying-incomplete-tasks', severity: 'error', message: 'incomplete tasks' },
            { layer: 'L4', code: 'L4.scenario-unverified', severity: 'error', message: 'unverified' },
            { layer: 'L2', code: 'L2.heading-level', severity: 'warning', message: 'heading warn' },
        ];
        const res = classifyFeaturePreflightFindings(findings);
        expect(res.shouldAbort).toBe(false);
        expect(res.aborting).toEqual([]);
        expect(res.nonAborting.map((f) => f.code)).toEqual([
            'L4.verifying-incomplete-tasks',
            'L4.scenario-unverified',
            'L2.heading-level',
        ]);

        // An unexpected error code aborts
        const fatal = [
            ...findings,
            { layer: 'L1', code: 'L1.schema-validation', severity: 'error', message: 'bad schema' },
        ];
        const resFatal = classifyFeaturePreflightFindings(fatal);
        expect(resFatal.shouldAbort).toBe(true);
        expect(resFatal.aborting.map((f) => f.code)).toEqual(['L1.schema-validation']);

        // Request-level invocation (the CLI's `--classify-feature`)
        expect(runPreflightCli(['--classify-feature', JSON.stringify(findings)]).exitCode).toBe(0);
        expect(runPreflightCli(['--classify-feature', JSON.stringify(fatal)]).exitCode).toBe(1);
        expect(runPreflightCli(['--classify-feature', '{"not":"an array"}']).exitCode).toBe(0);
    });

    test('classify-feature mode reports the classification in-process (task 1176 move)', () => {
        const findings = [
            { layer: 'L4', code: 'L4.scenario-unverified', severity: 'error', message: 'expected' },
            { layer: 'L3', code: 'L3.scope-delineation', severity: 'error', message: 'real defect' },
        ];
        const ok = runPreflightCli(['--classify-feature', JSON.stringify(findings)]);
        expect(ok.exitCode).toBe(1);
        expect(JSON.parse(ok.stdout)).toMatchObject({ shouldAbort: true });
        const abortingOnly = runPreflightCli([
            '--classify-feature',
            JSON.stringify([{ layer: 'L4', code: 'L4.scenario-unverified', severity: 'error', message: 'expected' }]),
        ]);
        expect(abortingOnly.exitCode).toBe(0);
        expect(JSON.parse(abortingOnly.stdout)).toMatchObject({ shouldAbort: false });
    });

    test('classify-feature mode reports malformed JSON as a usage-level failure', () => {
        const bad = runPreflightCli(['--classify-feature', '{not json']);
        expect(bad.exitCode).toBe(1);
        expect(bad.stderr).toContain('Invalid JSON for --classify-feature');
    });
});
