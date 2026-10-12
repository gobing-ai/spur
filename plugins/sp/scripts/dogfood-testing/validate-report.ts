/**
 * validate-report — CLI entry for the @1.2 dogfood report contract checker (task 0276 W6, 0278 R6).
 *
 * The validation logic is application-owned in `plugins/sp/lib/dogfood-report.ts` (task 1173); this
 * script opens the file, runs the check and prints — argv, usage, exit codes and every exported
 * symbol stay as they were, so callers and tests keep importing this path.
 *
 * CLI (task 0278 R6): `bun …/validate-report.ts --file <report.md> [--json]`
 */

import { readFileSync } from 'node:fs';
import { validateReport } from '../../lib/dogfood-report';

export * from '../../lib/dogfood-report';

export interface ValidateCliArgs {
    file: string | null;
    json: boolean;
    help: boolean;
}

export function parseValidateCliArgs(argv: string[]): ValidateCliArgs {
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

export const VALIDATE_CLI_USAGE = `Usage:
  bun plugins/sp/scripts/dogfood-testing/validate-report.ts --file <report.md> [--json]

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

export function runValidateCli(
    argv: string[],
    readFile: (path: string) => string,
): { exitCode: number; stdout: string; stderr: string } {
    const { file, json, help } = parseValidateCliArgs(argv);
    if (help) return { exitCode: 0, stdout: '', stderr: VALIDATE_CLI_USAGE };
    if (file === null || file.length === 0) {
        return { exitCode: 1, stdout: '', stderr: VALIDATE_CLI_USAGE };
    }
    let markdown: string;
    try {
        markdown = readFile(file);
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

/** CLI entry for Phase 4 self-validate (import.meta.main). */
export function mainCli(argv: string[] = process.argv.slice(2)): number {
    const { exitCode, stdout, stderr } = runValidateCli(argv, (p) => readFileSync(p, 'utf8'));
    if (stdout) process.stdout.write(stdout);
    if (stderr) process.stderr.write(`${stderr}\n`);
    return exitCode;
}

if (import.meta.main) {
    process.exit(mainCli());
}
