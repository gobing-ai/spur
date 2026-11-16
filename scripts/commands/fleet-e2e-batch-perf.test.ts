import { describe, expect, test } from 'bun:test';
import { batchFixtureDigest, batchPerfReceipt, runBatchPerf } from './fleet-e2e-batch-perf';

describe('G76 1346 — batch perf lane', () => {
    test('the receipt applies the rules: pass at ratio <= 0.6, gate share flags sharding', () => {
        const pass = batchPerfReceipt({
            serialWallMs: 2_000,
            parallelWallMs: 1_000,
            gateMs: 200,
            tasks: [],
            memberWorkMs: 400,
            gateMsPerTask: 50,
            maxWriters: 2,
            retiredSkillBaseline: null,
        });
        expect(pass.ratio).toBe(0.5);
        expect(pass.pass).toBe(true);
        expect(pass.gateShare).toBe(0.2);
        expect(pass.gateShardingFlag).toBe(false);
        expect(pass.target).toBe(0.6);
        expect(pass.retiredSkillBaseline).toBeNull();
        expect(pass.retiredSkillBaselineNote).toContain('retired by G76 1343');

        const slow = batchPerfReceipt({
            serialWallMs: 1_000,
            parallelWallMs: 900,
            gateMs: 800,
            tasks: [],
            memberWorkMs: 400,
            gateMsPerTask: 50,
            maxWriters: 2,
        });
        // A failing ratio is REPORTED and a gate-dominated wall time raises the sharding flag.
        expect(slow.pass).toBe(false);
        expect(slow.gateShare).toBeGreaterThan(0.5);
        expect(slow.gateShardingFlag).toBe(true);
    });

    test('a zero-length serial run yields no ratio instead of a division by zero', () => {
        const receipt = batchPerfReceipt({
            serialWallMs: 0,
            parallelWallMs: 10,
            gateMs: 0,
            tasks: [],
            memberWorkMs: 1,
            gateMsPerTask: 1,
            maxWriters: 2,
        });
        expect(receipt.ratio).toBeNull();
        expect(receipt.pass).toBe(false);
    });

    test('the lane measures a real serial and parallel run and writes the receipt', async () => {
        const { receipt, exitCode } = await runBatchPerf();
        expect(exitCode).toBe(0);
        // Four tasks in waves of two land in half the serial wall time, plus orchestration overhead.
        expect(receipt.serialWallMs).toBeGreaterThan(receipt.parallelWallMs);
        expect(receipt.ratio).not.toBeNull();
        expect(receipt.tasks).toHaveLength(4);
        // The lane's whole point: two writers land four tasks inside the 0.6 target.
        expect(receipt.pass).toBe(true);
        expect(receipt.gateShardingFlag).toBe(false);
        for (const window of receipt.tasks) expect(window.integratedAt >= window.receiptAt).toBe(true);
        expect(receipt.gateShare).toBeGreaterThan(0);
        expect(receipt.maxWriters).toBe(2);
        expect(batchFixtureDigest(['0601'], 1, 1)).toStartWith('sha256:');
    }, 120_000);
});
