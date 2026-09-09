import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import {
    parsePreflightCliArgs,
    preflightTask,
    quickReadiness,
    recoveryHint,
    runPreflightCli,
} from '../scripts/batch-preflight';

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
        expect(runPreflightCli(['--help']).exitCode).toBe(0);
        expect(runPreflightCli([]).exitCode).toBe(1);
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
        expect(quickReadiness({ wbs: '1', status: 'todo', operation: 'bogus' }).action).toBe('invalid');
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

describe('batch-preflight CLI arg parsing (task 0814 R2)', () => {
    test('parsePreflightCliArgs — --required-sections / --present-sections / --filtered-count / --force', () => {
        const args = parsePreflightCliArgs([
            '--wbs',
            '0814',
            '--status',
            'todo',
            '--operation',
            'run',
            '--required-sections',
            'Solution,Review',
            '--present-sections',
            'Solution',
            '--filtered-count',
            '3',
            '--force',
        ]);
        expect(args.requiredSections).toEqual(['Solution', 'Review']);
        expect(args.presentSections).toEqual(['Solution']);
        expect(args.filteredCount).toBe(3);
        expect(args.force).toBe(true);
        // empty value → empty array; non-finite count → null
        expect(parsePreflightCliArgs(['--required-sections', '']).requiredSections).toEqual([]);
        expect(parsePreflightCliArgs(['--present-sections', '']).presentSections).toEqual([]);
        expect(parsePreflightCliArgs(['--filtered-count', 'x']).filteredCount).toBeNull();
    });

    test('CLI script entrypoint (import.meta.main) exits with the declared code', () => {
        const script = join(import.meta.dir, '..', 'scripts', 'batch-preflight.ts');
        const ok = Bun.spawnSync(['bun', script, '--wbs', '1', '--status', 'todo']);
        expect(ok.exitCode).toBe(0);
        expect(ok.stdout.toString()).toContain('run:');
        const skip = Bun.spawnSync(['bun', script, '--wbs', '1', '--status', 'done']);
        expect(skip.exitCode).toBe(2);
        expect(skip.stdout.toString()).toContain('skip A8');
    });
});
