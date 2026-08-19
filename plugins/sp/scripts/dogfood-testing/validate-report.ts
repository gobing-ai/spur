/**
 * validate-report — @1.2 dogfood report contract checker (task 0276, W6).
 *
 * Pure function over a report markdown string → { ok, errors[] } with stable error
 * codes, callable from tests and by agents finalizing a run. It validates the
 * *complete-report* shape: the six unique section headings, Issues subheads, the
 * mandatory summary footer with both delivery paths, frontmatter protocol string,
 * and ledger↔declared-steps cardinality. Aborted/partial reports are out of scope —
 * they legitimately lack the footer and Steps line.
 *
 * CLI (task 0278 R6): `bun …/validate-report.ts --file <report.md> [--json]`
 */

import { readFileSync } from 'node:fs';

export interface ReportValidation {
    ok: boolean;
    errors: string[];
}

const REQUIRED_SECTIONS = [1, 2, 3, 4, 5, 6] as const;
const CANONICAL_PROTOCOL = 'sp:dogfood-testing@1.2';

function countSectionHeadings(markdown: string, section: number): number {
    const re = new RegExp(`^### ${section}\\.`, 'gm');
    return (markdown.match(re) ?? []).length;
}

function countLedgerDataRows(markdown: string): number | null {
    const heading = markdown.match(/^### 3\. Monitor Ledger\s*$/m);
    if (!heading || heading.index === undefined) return null;
    const after = markdown.slice(heading.index + heading[0].length);
    const nextHeading = after.search(/^### /m);
    const body = nextHeading === -1 ? after : after.slice(0, nextHeading);
    const rows = body
        .split('\n')
        .filter((line) => line.trim().startsWith('|'))
        .filter((line) => !/^\|[\s:|-]+\|?\s*$/.test(line.trim()))
        // drift:external rows are documentary (task 0296) — included in the table but
        // subtracted from the executed-step count, per the @1.2 cardinality contract.
        .filter((line) => !/^\|\s*drift:/.test(line.trim()));
    // Minus the header row; what remains are data rows.
    return Math.max(rows.length - 1, 0);
}

function declaredExecutedSteps(markdown: string): number | null {
    const match = markdown.match(/\*\*Steps:\*\*\s*\d+\s+derived,\s*(\d+)\s+executed/);
    return match ? Number.parseInt(match[1], 10) : null;
}

export function validateReport(markdown: string): ReportValidation {
    const errors: string[] = [];

    // Footer (W2/D1) — the mirrored footer block at the report end.
    if (!markdown.includes('── Dogfood Summary ──')) errors.push('missing_footer');
    if (!markdown.includes('[Live:')) errors.push('missing_live_path');
    if (!markdown.includes('[Report:')) errors.push('missing_report_path');

    // Six unique section headings (W2/D3).
    for (const section of REQUIRED_SECTIONS) {
        const count = countSectionHeadings(markdown, section);
        if (count === 0) errors.push(`missing_section:${section}`);
        if (count > 1) errors.push(`duplicate_section:${section}`);
    }

    // Issues subheads (W2/D3).
    if (!markdown.includes('#### Fixed') || !markdown.includes('#### Unresolved')) {
        errors.push('missing_issues_subheads');
    }

    // Protocol string (W1/D5) — colon form, exact version.
    const protocolMatch = markdown.match(/^protocol:\s*(\S+)\s*$/m);
    if (!protocolMatch || protocolMatch[1] !== CANONICAL_PROTOCOL) {
        errors.push('protocol_string');
    }

    // Ledger cardinality (W3/D4) — data rows == declared executed steps.
    const executed = declaredExecutedSteps(markdown);
    if (executed === null) {
        errors.push('missing_steps_declared');
    } else {
        const rows = countLedgerDataRows(markdown);
        if (rows === null || rows !== executed) {
            errors.push('ledger_cardinality');
        }
    }

    return { ok: errors.length === 0, errors };
}

// ── CLI entry (Phase 4 self-validate — task 0278 R6) ─────────────────────────

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
