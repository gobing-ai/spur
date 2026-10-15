import type { Command } from '@commander-js/extra-typings';
import { CorpusMigrator, type MigrationReport, resolvePlanningFolders } from '@gobing-ai/spur-app';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';

const MIGRATION_RULE_IDS = ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8'] as const;

function renderMigrationReport(report: MigrationReport, dryRun: boolean, corpusDir: string): string {
    const lines = [
        `Task corpus migration ${dryRun ? 'dry-run' : 'apply'} complete`,
        `Corpus: ${corpusDir}`,
        `Files scanned: ${report.filesScanned}`,
        `Files modified: ${report.filesModified}`,
        `Files skipped: ${report.filesSkipped}`,
        '',
        'Rule flag counts:',
    ];
    for (const rule of MIGRATION_RULE_IDS) {
        const count = report.flags.filter((flag) => flag.rule === rule).length;
        lines.push(`  ${rule}: ${count}`);
    }
    lines.push('', 'Per-file changes:');
    const changed = report.fileReports.filter((file) => file.modified || file.validationError !== undefined);
    if (changed.length === 0) {
        lines.push('  none');
    } else {
        for (const file of changed) {
            const state = file.validationError !== undefined ? `skipped (${file.validationError})` : 'modified';
            const flags = file.flags.length > 0 ? `; flags=${file.flags.map((flag) => flag.rule).join(',')}` : '';
            lines.push(`  ${file.wbs}: ${state} — ${file.path}${flags}`);
        }
    }
    return lines.join('\n');
}

/** Register `spur task migrate`. */
export function registerTaskMigrateCommand(task: Command, context: CliContext): void {
    // ── migrate ──
    task.command('migrate')
        .summary('Run the one-time A17 task corpus normalization pass.')
        .option(...SHARED_OPTIONS.dryRunTaskReport)
        .option(...SHARED_OPTIONS.folderTasks)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            try {
                const foldersConfig = (await resolvePlanningFolders(context.fs)).foldersConfig;
                const activeFolder = context.fs.resolve(foldersConfig.active_folder);
                const corpusDir = options.folder ?? activeFolder;
                const dryRun = options.dryRun === true;
                const migrator = new CorpusMigrator({ fs: context.fs, corpusDir });
                const report = await migrator.migrate({ dryRun });
                if (options.json) {
                    context.output.write(
                        toEnvelopeJson({ ok: true, dryRun, corpusDir, ...report }, { enveloped: options.jsonEnvelope }),
                    );
                } else {
                    context.output.write(renderMigrationReport(report, dryRun, corpusDir));
                }
            } catch (err) {
                writeJsonError(context.output, options, String(err));
                context.setExitCode(1);
            }
        });
}
