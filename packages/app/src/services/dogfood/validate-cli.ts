/**
 * CLI argv / exit-code contract for `spur agent dogfood validate-report`.
 * Absorbed from plugins/sp/scripts/dogfood-testing/validate-report.ts (script-absorption PR-7).
 */
import { validateReport } from './report';

/** Parsed `spur agent dogfood validate-report` arguments. */
export interface DogfoodValidateCliArgs {
    file: string | null;
    json: boolean;
    help: boolean;
}

/** Parse `spur agent dogfood validate-report` argv (`--file`, `--json`, `--help`). */
export function parseDogfoodValidateArgs(argv: readonly string[]): DogfoodValidateCliArgs {
    let file: string | null = null;
    let json = false;
    let help = false;
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === undefined) continue;
        if (a === '--help' || a === '-h') help = true;
        else if (a === '--json') json = true;
        else if (a === '--file') file = argv[++i] ?? null;
        else if (!a.startsWith('-') && file === null) file = a;
    }
    return { file, json, help };
}

/** Usage text for `spur agent dogfood validate-report`. */
export const DOGFOOD_VALIDATE_USAGE = `Usage:
  spur agent dogfood validate-report --file <report.md> [--json]

Exit codes:
  0  report validates clean (complete-report shape)
  2  validation failed (errors on stdout / --json)
  1  usage error

Cost evidence (task 0913): a complete report must carry the Cost block
(Ledger estimate / Method / Meter), percentages within 0..100, totals equal to
the ledger sums of observable rows (fresh + cached), and 'n/a' (never a
fabricated number) when no observable rows exist. Display-rounding tolerance
for the cache share is ±1 percentage point.

Phase 4 finalize MUST run this before status: complete (task 0278 R6).
On exit 2: set status: aborted and list error codes under #### Unresolved.`;

/** Reads the report text; the CLI passes its FileSystem seam (sync or async). */
export type DogfoodReportReader = (path: string) => string | Promise<string>;

/** Run `spur agent dogfood validate-report`: read the report through `readFile` and validate it. */
export async function runDogfoodValidateCli(
    argv: readonly string[],
    readFile: DogfoodReportReader,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const { file, json, help } = parseDogfoodValidateArgs(argv);
    if (help) return { exitCode: 0, stdout: '', stderr: DOGFOOD_VALIDATE_USAGE };
    if (file === null || file.length === 0) {
        return { exitCode: 1, stdout: '', stderr: DOGFOOD_VALIDATE_USAGE };
    }
    let markdown: string;
    try {
        markdown = await readFile(file);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { exitCode: 1, stdout: '', stderr: `Failed to read ${file}: ${msg}` };
    }
    const result = validateReport(markdown);
    if (json) {
        return {
            exitCode: result.ok ? 0 : 2,
            stdout: `${JSON.stringify(result, null, 2)}\n`,
            stderr: '',
        };
    }
    if (result.ok) {
        return { exitCode: 0, stdout: 'ok\n', stderr: '' };
    }
    return {
        exitCode: 2,
        stdout: `${result.errors.join('\n')}\n`,
        stderr: '',
    };
}
