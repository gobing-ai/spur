/**
 * skill-eval — the eval runner's failure contract (task 1175 R3).
 *
 * The three outcomes must not read the same: an unavailable executor is SKIPPED, while a present
 * executor that timed out, exited non-zero or produced no stdout is FAIL — and a missing recorded
 * fixture is corrupt data, not an absent agent. Every case is driven through an injected spawn
 * result, so no test spawns a model or needs an authenticated agent.
 */

import { describe, expect, test } from 'bun:test';
import { EVAL_FIXTURES, EVAL_SCENARIOS } from '../../plugins/sp/tests/evals/scenarios';
import {
    evaluateRows,
    LIVE_TIMEOUT_MS,
    runCli,
    runLiveAttempt,
    type SpawnLike,
    type SpawnResultLike,
    sanitizeDetail,
} from './skill-eval';

const SCENARIO = EVAL_SCENARIOS[0];
if (SCENARIO === undefined) throw new Error('the eval corpus must carry at least one scenario');
const FIXTURE = EVAL_FIXTURES[0];
if (FIXTURE === undefined) throw new Error('the eval corpus must carry at least one recorded fixture');

/** A spawn double that records its argv and returns a canned result. */
function fakeSpawn(result: SpawnResultLike): SpawnLike & { calls: Array<{ cmd: string; args: string[] }> } {
    const calls: Array<{ cmd: string; args: string[] }> = [];
    return Object.assign(
        (cmd: string, args: string[]) => {
            calls.push({ cmd, args });
            return result;
        },
        { calls },
    );
}

describe('skill-eval — unavailable executor versus broken run (task 1175 R3)', () => {
    test('ENOENT is SKIPPED (a missing agent never turns the gate red)', () => {
        const spawn = fakeSpawn({ error: { code: 'ENOENT', message: 'spawn spur ENOENT' } });
        const attempt = runLiveAttempt(SCENARIO, spawn);
        expect(attempt.kind).toBe('unavailable');
        const rows = evaluateRows(false, { scenarios: [SCENARIO], spawn });
        expect(rows[0]?.outcome).toBe('SKIPPED');
        expect(runCli(['--'], { scenarios: [SCENARIO], spawn }).exitCode).toBe(0);
    });

    test('a timeout is FAIL with the budget named, and exit 1', () => {
        const attempt = runLiveAttempt(SCENARIO, fakeSpawn({ error: { code: 'ETIMEDOUT' } }));
        expect(attempt).toEqual({ kind: 'failed', detail: `agent timed out after ${LIVE_TIMEOUT_MS} ms` });
        const rows = evaluateRows(false, { scenarios: [SCENARIO], spawn: fakeSpawn({ signal: 'SIGTERM' }) });
        expect(rows[0]?.outcome).toBe('FAIL');
        expect(rows[0]?.detail).toContain('SIGTERM');
        expect(runCli([], { scenarios: [SCENARIO], spawn: fakeSpawn({ signal: 'SIGTERM' }) }).exitCode).toBe(1);
    });

    test('a non-zero exit is FAIL and keeps sanitized stderr', () => {
        const attempt = runLiveAttempt(SCENARIO, fakeSpawn({ status: 2, stderr: 'not authenticated\nsecond line' }));
        expect(attempt.kind).toBe('failed');
        expect(attempt.kind === 'failed' && attempt.detail).toBe('agent exited 2: not authenticated second line');
    });

    test('empty stdout from a present executor is FAIL, never SKIPPED', () => {
        const attempt = runLiveAttempt(SCENARIO, fakeSpawn({ status: 0, stdout: '   \n' }));
        expect(attempt).toEqual({ kind: 'failed', detail: 'agent produced empty stdout' });
        expect(
            evaluateRows(false, { scenarios: [SCENARIO], spawn: fakeSpawn({ status: 0, stdout: '' }) })[0]?.outcome,
        ).toBe('FAIL');
    });

    test('a live transcript is judged, and SPUR_BIN arguments still split without a shell', () => {
        const spawn = fakeSpawn({ status: 0, stdout: FIXTURE.disciplined });
        const rows = evaluateRows(false, { scenarios: [SCENARIO], spawn });
        expect(rows[0]?.outcome).toBe('PASS');
        expect(spawn.calls[0]?.args).toEqual(['agent', 'run', SCENARIO.prompt]);
    });

    test('sanitizeDetail collapses whitespace and caps the cell', () => {
        expect(sanitizeDetail('a\n\n b\tc')).toBe('a b c');
        expect(sanitizeDetail('x'.repeat(500)).length).toBe(300);
    });
});

describe('skill-eval — fixture tier (task 1175 R3)', () => {
    test('a missing recorded fixture is FAIL, not SKIPPED', () => {
        const rows = evaluateRows(true, { scenarios: [SCENARIO], fixtures: [] });
        expect(rows[0]?.outcome).toBe('FAIL');
        expect(rows[0]?.detail).toContain('no recorded fixture');
        expect(runCli(['--fixtures'], { scenarios: [SCENARIO], fixtures: [] }).exitCode).toBe(1);
    });

    test('an empty recorded fixture is FAIL', () => {
        const rows = evaluateRows(true, {
            scenarios: [SCENARIO],
            fixtures: [{ scenarioId: SCENARIO.id, disciplined: '  ', undisciplined: '' }],
        });
        expect(rows[0]?.outcome).toBe('FAIL');
        expect(rows[0]?.detail).toContain('is empty');
    });

    test('the real corpus passes the deterministic tier with no spawn at all', () => {
        const spawn = fakeSpawn({ status: 0, stdout: 'must not be called' });
        const { exitCode, stdout } = runCli(['--fixtures'], { spawn });
        expect(exitCode).toBe(0);
        expect(spawn.calls).toHaveLength(0);
        expect(stdout).toContain('deterministic (fixtures) tier');
        expect(stdout).toContain('| Scenario | Skill | Outcome | Detail |');
        expect(stdout).toContain('0 fail, 0 skipped');
    });

    test('an undisciplined recorded transcript FAILs the row', () => {
        const rows = evaluateRows(true, {
            scenarios: [SCENARIO],
            fixtures: [{ scenarioId: SCENARIO.id, disciplined: FIXTURE.undisciplined, undisciplined: '' }],
        });
        expect(rows[0]?.outcome).toBe('FAIL');
        expect(rows[0]?.detail).toContain('did NOT fire');
    });
});
