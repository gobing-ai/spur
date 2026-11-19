import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { batchFixtureDigest, runBatchPerf } from './fleet-e2e-batch-perf';

// A wall-clock ratio is only meaningful on an uncontended machine, so the real measurement lives in
// the serial heavy lane, not the --parallel=2 suite where sibling tests skew it past the 0.6 target.
describe('G76 1346 — batch perf lane (real run)', () => {
    test('the lane measures a real serial and parallel run and writes the receipt', async () => {
        // A temp out dir: the measurement writes a receipt, and a test must not rewrite the
        // committed report in docs/reports.
        const { receipt, exitCode } = await runBatchPerf({ outDir: mkdtempSync(join(tmpdir(), 'batch-perf-')) });
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
