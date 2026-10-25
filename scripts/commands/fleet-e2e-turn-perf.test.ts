import { expect, test } from 'bun:test';
import { runPairedTurnPerf } from './fleet-e2e-turn-perf';

// Failure-first: a qualification row is not a measured warm turn; changing workloads between
// modes, accepting a missing artifact, or opening a child per warm turn would invalidate the comparison.
test('G74 R1: paired cold, resume and warm work validates one workload and retains a rejected artifact', async () => {
    const result = await runPairedTurnPerf(['claude', 'codex', 'pi'], 2, true);
    expect(result.lane).toBe('deterministic-fixture');
    expect(result.trials).toHaveLength(19);
    expect(result.workloadDigest).toMatch(/^sha256:/);
    expect(result.settings).toEqual({ model: 'fixture-v1', provider: 'local-fixture', reasoning: 'none' });
    for (const agent of ['claude', 'codex', 'pi']) {
        const rows = result.trials.filter((row) => row.agent === agent);
        expect(new Set(rows.map((row) => row.mode))).toEqual(new Set(['cold', 'resume', 'warm']));
        expect(result.processes[agent]).toEqual({ cold: 2, resume: 2, warm: 1 });
        expect(result.measured[agent]?.warm.p95Ms).toBeGreaterThan(0);
        expect(result.measured[agent]?.warm.validatedPerHour).toBeGreaterThan(0);
        for (const row of rows) {
            expect(row.model).toBe('fixture-v1');
            expect(row.provider).toBe('local-fixture');
            expect(row.reasoning).toBe('none');
            expect(row.runId).toBeTruthy();
            expect(row.executionId).toBeTruthy();
            expect(row.requestId).toBeTruthy();
            expect(row.durationMs).toBeGreaterThan(0);
            expect(row.phases.some((phase) => phase.phase === 'contract-validated')).toBe(true);
            expect(row.contractValidated).toBe(row.status === 'validated');
        }
        // Pair order alternates; p95 is a measured fixture result, never a claimed model speedup.
        expect(rows.slice(0, 3).map((row) => row.mode)).toEqual(['cold', 'resume', 'warm']);
        expect(rows.slice(3, 6).map((row) => row.mode)).toEqual(['warm', 'cold', 'resume']);
    }
    const rejected = result.trials.filter((row) => row.status === 'failed');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ agent: 'claude', mode: 'warm', injected: true, contractValidated: false });
    expect(result.measured.claude?.warm.completionRate).toBeCloseTo(2 / 3);
    const warmRows = result.trials.filter((row) => row.agent === 'claude' && row.mode === 'warm');
    const occupiedMs = warmRows.reduce((sum, row) => sum + (row.durationMs ?? 0), 0);
    expect(result.measured.claude?.warm.validatedPerHour).toBeCloseTo((2 * 3_600_000) / occupiedMs, 2);
}, 30_000);
