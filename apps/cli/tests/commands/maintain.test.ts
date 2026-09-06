import { describe, expect, test } from 'bun:test';
import type { DbAdapter } from '@gobing-ai/spur-domain';
import { main } from '../../src';
import { formatMaintenanceResult } from '../../src/commands/maintain';
import { createMigratedDbAdapter } from '../../src/context';
import type { CommandOutput } from '../../src/output';

function capturingOutput(): { output: CommandOutput; lines: string[] } {
    const lines: string[] = [];
    return {
        output: {
            write: (chunk: string) => lines.push(chunk),
            error: (chunk: string) => lines.push(chunk),
        },
        lines,
    };
}

describe('self maintain command', () => {
    test('runs default maintenance (optimize + wal_checkpoint) via spur self maintain', async () => {
        const cwd = process.cwd();
        const db = await createMigratedDbAdapter(cwd, {}, ':memory:');
        const { output, lines } = capturingOutput();

        const exitCode = await main(['self', 'maintain'], { output, cwd, db });

        expect(exitCode).toBe(0);
        const joined = lines.join('\n');
        expect(joined).toContain('database maintenance completed');
        expect(joined).toContain('optimize: ok');
        expect(joined).toContain('wal_checkpoint: ok (truncated)');
        expect(joined).toContain('vacuum: skipped');
        expect(joined).toContain('size:');
    });

    test('runs vacuum maintenance with --json via spur self maintain', async () => {
        const cwd = process.cwd();
        const db = await createMigratedDbAdapter(cwd, {}, ':memory:');
        const { output, lines } = capturingOutput();

        const exitCode = await main(['self', 'maintain', '--vacuum', '--json'], { output, cwd, db });

        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lines.join(''));
        expect(parsed.optimized).toBe(true);
        expect(parsed.checkpointed).toBe(true);
        expect(parsed.vacuumed).toBe(true);
        expect(parsed.bytesBefore).toBeGreaterThan(0);
        expect(parsed.bytesAfter).toBeGreaterThan(0);
        expect(parsed.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('runs via legacy hidden top-level alias `spur maintain`', async () => {
        const cwd = process.cwd();
        const db = await createMigratedDbAdapter(cwd, {}, ':memory:');
        const { output, lines } = capturingOutput();

        const exitCode = await main(['maintain', '--json'], { output, cwd, db });

        expect(exitCode).toBe(0);
        const parsed = JSON.parse(lines.join(''));
        expect(parsed.optimized).toBe(true);
        expect(parsed.checkpointed).toBe(true);
    });

    test('formatMaintenanceResult handles reclaimed bytes and skip reasons', () => {
        const textReclaimed = formatMaintenanceResult({
            optimized: true,
            checkpointed: true,
            vacuumed: true,
            bytesBefore: 10 * 1024 * 1024,
            bytesAfter: 8 * 1024 * 1024,
            bytesReclaimed: 2 * 1024 * 1024,
            durationMs: 120,
        });
        expect(textReclaimed).toContain('reclaimed: 2.00 MB');
        expect(textReclaimed).toContain('size: 8.00 MB (was 10.00 MB)');

        const textSkippedReason = formatMaintenanceResult({
            optimized: false,
            checkpointed: false,
            vacuumed: false,
            vacuumSkippedReason: 'insufficient-disk',
            bytesBefore: 1024,
            bytesAfter: 1024,
            bytesReclaimed: 0,
            durationMs: 5,
        });
        expect(textSkippedReason).toContain('vacuum: skipped (insufficient-disk)');
        expect(textSkippedReason).toContain('optimize: failed');
        expect(textSkippedReason).toContain('wal_checkpoint: failed');
    });

    test('exits non-zero when both optimize and checkpoint fail', async () => {
        const cwd = process.cwd();
        const mockDb = {
            exec: async () => {
                throw new Error('disk failure');
            },
            run: async () => {},
            all: async () => [],
            get: async () => undefined,
            close: async () => {},
        };
        const { output } = capturingOutput();
        const exitCode = await main(['self', 'maintain', '--json'], {
            output,
            cwd,
            db: mockDb as unknown as DbAdapter,
        });
        expect(exitCode).toBe(1);
    });
});
