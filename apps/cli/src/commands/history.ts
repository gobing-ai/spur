import type { Command } from '@commander-js/extra-typings';
import { type HistoryImportResult, HistoryService } from '@gobing-ai/spur-app';
import { formatSummary } from '@gobing-ai/spur-domain';
import type { CliContext } from '../context';
import { toJson } from '../output';

/** Register `spur history` commands. */
export function registerHistoryCommand(program: Command, context: CliContext): void {
    const noun = program.command('history').summary('import and analyze coding-agent history');
    noun.command('import')
        .description('Import agent conversation JSONL.')
        .option('--source <source>', 'pi|claude|codex|gemini|opencode|antigravity|openclaw', 'pi')
        .option('--file <path>', 'Import one JSONL file')
        .option('--root <path>', 'Scan a history root')
        .option('--mode <mode>', 'full|incremental|force-file')
        .option('--dry-run', 'Scan without persisting imported records')
        .option('--json', 'Output machine-readable JSON where supported')
        .action(async (options) => {
            const svc = new HistoryService({ getDb: () => context.getDb() });
            const r = await svc.import(options.source ?? 'pi', {
                file: options.file || undefined,
                root: options.root || undefined,
                mode: options.mode ?? (options.file ? 'force-file' : 'incremental'),
                dryRun: options.dryRun === true,
            });
            context.output.write(options.json ? toJson(r) : formatImportResult(r));
            const code = r.parseErrors.length === 0 && r.validationErrors.length === 0 ? 0 : 1;
            context.setExitCode(code);
        });
    noun.command('analyze')
        .description('Summarize imported token, cost, and usage data.')
        .option('--since <iso-date>', 'Lower bound for analysis')
        .option('--json', 'Output machine-readable JSON where supported')
        .action(async (options) => {
            const svc = new HistoryService({ getDb: () => context.getDb() });
            const summary = await svc.analyze(options.since || undefined);
            context.output.write(options.json ? toJson(summary) : formatSummary(summary));
        });
    noun.command('report')
        .description(
            'Reserved richer report surface; not yet implemented (see docs/04_DESIGN.md §spur history report).',
        )
        .option('--json', 'Output machine-readable JSON where supported')
        .action(async (options) => {
            const message =
                'spur history report is reserved but not yet implemented (P8).\n' +
                'See docs/04_DESIGN.md for the planned surface.\n' +
                'Workaround: use "spur history analyze" for aggregate summaries, or\n' +
                '"spur history import" to load session data, then query the database directly.';
            context.output.write(options.json ? toJson({ status: 'not-implemented', message }) : message);
            context.setExitCode(0);
        });
}

function formatImportResult(r: HistoryImportResult): string {
    return [
        `history import ${r.source}`,
        `mode: ${r.mode}`,
        `files: ${r.scannedFiles}`,
        `lines: ${r.processedLines}`,
        `imported: ${r.importedRecords}`,
        `duplicates: ${r.skippedDuplicates}`,
        `parse_errors: ${r.parseErrors.length}`,
        `validation_errors: ${r.validationErrors.length}`,
    ].join('\n');
}
