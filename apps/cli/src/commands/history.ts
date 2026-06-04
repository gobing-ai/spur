import { type HistoryImportResult, HistoryService } from '@gobing-ai/spur-app';
import { formatSummary } from '@gobing-ai/spur-domain';
import { booleanFlag, stringFlag } from '../args';
import type { CliContext } from '../context';
import { toJson } from '../output';

/** Render detailed usage for `spur history`. */
export function helpText(): string {
    return [
        'spur history - import and analyze coding-agent history',
        '',
        'Usage: spur history <command> [options]',
        '',
        'Commands:',
        '  import --source <source> [--file <path>|--root <path>] [--mode <mode>] [--dry-run] [--json]',
        '      Import agent conversation JSONL.',
        '  analyze [--since <iso-date>] [--json]',
        '      Summarize imported token, cost, and usage data.',
        '  report [--json]',
        '      Reserved richer report surface; currently prints a TODO marker.',
        '  help',
        '      Show this help.',
        '',
        'Options:',
        '  --source <source>      pi|claude|codex|gemini|opencode|antigravity|openclaw',
        '  --file <path>          Import one JSONL file',
        '  --root <path>          Scan a history root',
        '  --mode <mode>          full|incremental|force-file',
        '  --dry-run              Scan without persisting imported records',
        '  --since <iso-date>     Lower bound for analysis',
        '  --json                 Output machine-readable JSON where supported',
        '  -h, --help             Show this help',
        '',
        'Examples:',
        '  spur history import --source codex --root ~/.codex/sessions',
        '  spur history import --source claude --file session.jsonl --mode force-file',
        '  spur history analyze --since 2026-06-01',
    ].join('\n');
}

/** Execute history-domain commands. */
export async function runHistoryCommand(
    subcommand: string | undefined,
    context: CliContext,
    flags: Record<string, string | boolean>,
    positionals: readonly string[],
): Promise<number> {
    const svc = new HistoryService({ getDb: () => context.getDb() });
    switch (subcommand) {
        case 'import': {
            const source = stringFlag(flags, 'source', 'pi');
            const file = stringFlag(flags, 'file', positionals[0] ?? '');
            const root = stringFlag(flags, 'root', '');
            const mode = stringFlag(flags, 'mode', flags.file === undefined ? 'incremental' : 'force-file');
            const r = await svc.import(source, {
                file: file.length > 0 ? file : undefined,
                root: root.length > 0 ? root : undefined,
                mode,
                dryRun: booleanFlag(flags, 'dry-run'),
            });
            context.output.write(booleanFlag(flags, 'json') ? toJson(r) : formatImportResult(r));
            return r.parseErrors.length === 0 && r.validationErrors.length === 0 ? 0 : 1;
        }
        case 'analyze': {
            const since = stringFlag(flags, 'since', '');
            const summary = await svc.analyze(since.length > 0 ? since : undefined);
            context.output.write(booleanFlag(flags, 'json') ? toJson(summary) : formatSummary(summary));
            return 0;
        }
        case 'report': {
            const message = 'TODO: spur history report is reserved for the richer report surface.';
            context.output.write(booleanFlag(flags, 'json') ? toJson({ status: 'todo', message }) : message);
            return 0;
        }
        default:
            context.output.error(
                'Usage: spur history import --source <source> [--file <path>|--root <path>] [--mode full|incremental|force-file] [--json]\n       spur history analyze [--since <iso-date>] [--json]\n       spur history report [--json]',
            );
            return 1;
    }
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
