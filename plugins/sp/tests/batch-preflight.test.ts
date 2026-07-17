import { describe, expect, test } from 'bun:test';
import { preflightTask, recoveryHint, runPreflightCli } from '../scripts/batch-preflight';

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
