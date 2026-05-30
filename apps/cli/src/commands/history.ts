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
    if (subcommand !== 'import') {
        context.output.error(
            'Usage: spur history import --source <source> [--file <path>|--root <path>] [--mode full|incremental|force-file] [--json]',
        );
        return 1;
    }

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
