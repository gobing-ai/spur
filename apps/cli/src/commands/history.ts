import { aggregateCosts, computeRecordCost, formatSummary, queryAllEtlRecords } from '@gobing-ai/spur-domain';
import { type ImportMode, type LlmJsonlSource, runJsonlImport } from '@gobing-ai/ts-llm-jsonl-importer';
import { booleanFlag, stringFlag } from '../args';
import type { CliContext } from '../context';
import { toJson } from '../output';

const SOURCES: readonly LlmJsonlSource[] = ['pi', 'claude', 'codex', 'gemini', 'opencode', 'antigravity', 'openclaw'];
const MODES: readonly ImportMode[] = ['full', 'incremental', 'force-file'];

/** Execute history-domain commands. */
export async function runHistoryCommand(
    subcommand: string | undefined,
    context: CliContext,
    flags: Record<string, string | boolean>,
    positionals: readonly string[],
): Promise<number> {
    switch (subcommand) {
        case 'import':
            return await runHistoryImport(context, flags, positionals);
        case 'analyze':
            return await runHistoryAnalyze(context, flags);
        case 'report':
            return runHistoryReport(context, flags);
        default:
            context.output.error(
                'Usage: spur history import --source <source> [--file <path>|--root <path>] [--mode full|incremental|force-file] [--json]\n' +
                    '       spur history analyze [--since <iso-date>] [--json]\n' +
                    '       spur history report [--json]',
            );
            return 1;
    }
}

async function runHistoryImport(
    context: CliContext,
    flags: Record<string, string | boolean>,
    positionals: readonly string[],
): Promise<number> {
    const source = parseSource(stringFlag(flags, 'source', 'pi'));
    const mode = parseMode(stringFlag(flags, 'mode', flags.file === undefined ? 'incremental' : 'force-file'));
    const file = stringFlag(flags, 'file', positionals[0] ?? '');
    const root = stringFlag(flags, 'root', '');

    const result = await runJsonlImport(source, {
        db: await context.getDb(),
        mode,
        ...(file.length > 0 ? { files: [file] } : {}),
        ...(root.length > 0 ? { roots: [root] } : {}),
        dryRun: booleanFlag(flags, 'dry-run'),
    });

    if (booleanFlag(flags, 'json')) {
        context.output.write(toJson(result));
    } else {
        context.output.write(
            [
                `history import ${result.source}`,
                `mode: ${result.mode}`,
                `files: ${result.scannedFiles}`,
                `lines: ${result.processedLines}`,
                `imported: ${result.importedRecords}`,
                `duplicates: ${result.skippedDuplicates}`,
                `parse_errors: ${result.parseErrors.length}`,
                `validation_errors: ${result.validationErrors.length}`,
            ].join('\n'),
        );
    }

    return result.parseErrors.length === 0 && result.validationErrors.length === 0 ? 0 : 1;
}

async function runHistoryAnalyze(context: CliContext, flags: Record<string, string | boolean>): Promise<number> {
    const since = stringFlag(flags, 'since', '');
    const db = await context.getDb();
    const records = await queryAllEtlRecords(db, since.length > 0 ? since : undefined);
    const priced = records.map((record) => computeRecordCost(record));
    const summary = aggregateCosts(priced);

    if (booleanFlag(flags, 'json')) {
        context.output.write(toJson(summary));
    } else {
        context.output.write(formatSummary(summary));
    }

    return 0;
}

function runHistoryReport(context: CliContext, flags: Record<string, string | boolean>): number {
    const message = 'TODO: spur history report is reserved for the richer report surface.';
    context.output.write(booleanFlag(flags, 'json') ? toJson({ status: 'todo', message }) : message);
    return 0;
}

function parseSource(value: string): LlmJsonlSource {
    if (SOURCES.includes(value as LlmJsonlSource)) {
        return value as LlmJsonlSource;
    }
    throw new Error(`Invalid history source "${value}". Expected one of: ${SOURCES.join(', ')}`);
}

function parseMode(value: string): ImportMode {
    if (MODES.includes(value as ImportMode)) {
        return value as ImportMode;
    }
    throw new Error(`Invalid history import mode "${value}". Expected one of: ${MODES.join(', ')}`);
}
