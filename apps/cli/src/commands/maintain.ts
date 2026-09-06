import { join } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import { DEFAULT_DATABASE_URL } from '@gobing-ai/spur-config';
import { type DatabaseMaintenanceResult, maintainDatabase } from '@gobing-ai/spur-domain';
import type { CliContext } from '../context';
import { toEnvelopeJson } from '../output';
import { SHARED_OPTIONS } from './shared-options';

/** Register `spur self maintain` command (optionally hidden from the top-level help listing). */
export function registerMaintainCommand(
    program: Command,
    context: CliContext,
    options: { hidden?: boolean } = {},
): void {
    program
        .command('maintain', { hidden: options.hidden === true })
        .summary('run database maintenance (optimize, WAL checkpoint truncation, optional VACUUM)')
        .description(
            'Run database maintenance: PRAGMA optimize, WAL checkpoint truncation; optionally VACUUM compaction.',
        )
        .option('--vacuum', 'Run VACUUM defragmentation and page compaction', false)
        .option(...SHARED_OPTIONS.jsonSupported)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            const db = await context.getDb();
            const dbPath = context.env.DATABASE_URL ?? join(context.cwd, DEFAULT_DATABASE_URL);
            const result = await maintainDatabase(db, {
                vacuum: options.vacuum === true,
                dbPath: dbPath.startsWith(':memory:') ? undefined : dbPath,
            });
            context.output.write(
                options.json
                    ? toEnvelopeJson(result, { enveloped: options.jsonEnvelope })
                    : formatMaintenanceResult(result),
            );
            if (!result.optimized && !result.checkpointed) {
                context.setExitCode(1);
            }
        });
}

/** Format a {@link DatabaseMaintenanceResult} as human-readable summary text. */
export function formatMaintenanceResult(r: DatabaseMaintenanceResult): string {
    const lines: string[] = [
        `database maintenance completed in ${r.durationMs}ms:`,
        `  optimize: ${r.optimized ? 'ok' : 'failed'}`,
        `  wal_checkpoint: ${r.checkpointed ? 'ok (truncated)' : 'failed'}`,
        `  vacuum: ${r.vacuumed ? 'ok' : r.vacuumSkippedReason ? `skipped (${r.vacuumSkippedReason})` : 'skipped'}`,
    ];
    if (r.vacuumed && r.bytesReclaimed > 0) {
        const mbReclaimed = (r.bytesReclaimed / (1024 * 1024)).toFixed(2);
        lines.push(`  reclaimed: ${mbReclaimed} MB`);
    }
    const mbBefore = (r.bytesBefore / (1024 * 1024)).toFixed(2);
    const mbAfter = (r.bytesAfter / (1024 * 1024)).toFixed(2);
    lines.push(`  size: ${mbAfter} MB (was ${mbBefore} MB)`);
    return lines.join('\n');
}
