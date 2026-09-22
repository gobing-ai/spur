/**
 * validate-report — @1.2 dogfood report contract checker (task 0276, W6).
 *
 * Pure function over a report markdown string → { ok, errors[] } with stable error
 * codes, callable from tests and by agents finalizing a run. It validates the
 * *complete-report* shape: the six unique section headings, Issues subheads, the
 * mandatory summary footer with both delivery paths, frontmatter protocol string,
 * ledger↔declared-steps cardinality, and the Cost evidence contract (task 0913):
 * a complete report must carry a Cost block (Ledger estimate / Method / Meter),
 * percentages within 0..100, observable token totals consistent with the ledger
 * row sums (fresh + cached), and no fabricated share when no observable rows
 * exist. Unknown cells are never folded into zero; all-unknown evidence must
 * render `n/a`. Aborted/partial reports remain out of scope — they legitimately
 * lack the footer and Steps line.
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
        // subtracted from the executed-step count, per the @1.2 cardinality contract;
        // the prescribed code-span form (`drift:external`) matches too (task 0701 R5b).
        .filter((line) => !/^\|\s*`?drift:/.test(line.trim()));
    // Minus the header row; what remains are data rows.
    return Math.max(rows.length - 1, 0);
}

function declaredExecutedSteps(markdown: string): number | null {
    const match = markdown.match(/\*\*Steps:\*\*\s*\d+\s+derived,\s*(\d+)\s+executed/);
    return match ? Number.parseInt(match[1], 10) : null;
}

// ── Cost evidence contract (task 0913, R2) ──────────────────────────────────

const UNKNOWN_CELLS = new Set(['~unknown', 'unknown', '—', '-', '?', 'n/a', '~n/a']);

/** Display-rounding tolerance: a whole-percent share may differ from the exact
 * value by at most 1 point (e.g. 700/2100 = 33.3% may display as 33%). */
const CACHE_SHARE_TOLERANCE = 1;

function sectionBody(markdown: string, headingRe: RegExp): string | null {
    const heading = markdown.match(headingRe);
    if (!heading || heading.index === undefined) return null;
    const after = markdown.slice(heading.index + heading[0].length);
    const nextHeading = after.search(/^###? /m);
    return nextHeading === -1 ? after : after.slice(0, nextHeading);
}

interface CostTotals {
    total: number | 'n/a' | null;
    cached: number | 'n/a' | null;
    pct: number | 'n/a' | null;
}

function parseTokensLine(line: string): CostTotals | null {
    const match = line.match(
        /~(?<total>n\/a|\d+)\s+total\s*\|\s*~(?<cached>n\/a|\d+)\s+cached(?:\s*\(\s*~?(?<pct>n\/a|\d+(?:\.\d+)?)%\s*hit rate\))?/i,
    );
    if (!match) return null;
    const num = (v: string | undefined): number | 'n/a' | null =>
        v === undefined ? null : v === 'n/a' ? 'n/a' : Number.parseInt(v, 10);
    return { total: num(match.groups?.total), cached: num(match.groups?.cached), pct: num(match.groups?.pct) };
}

interface LedgerCostRow {
    step: string;
    fresh: number | null;
    cached: number | null;
    cachePct: number | null;
    unknownCell: boolean;
}

function parseTokenCell(cell: string): number | null {
    const t = cell.trim();
    if (UNKNOWN_CELLS.has(t)) return null;
    const m = t.match(/~?(\d+)/);
    return m ? Number.parseInt(m[1], 10) : null;
}

function parsePctCell(cell: string): number | null {
    const t = cell.trim();
    if (UNKNOWN_CELLS.has(t)) return null;
    const m = t.match(/(\d+(?:\.\d+)?)\s*%/);
    return m ? Number.parseFloat(m[1]) : null;
}

function ledgerCostRows(markdown: string): LedgerCostRow[] {
    const body = sectionBody(markdown, /^### 3\. Monitor Ledger\s*$/m);
    if (body === null) return [];
    return body
        .split('\n')
        .filter((line) => line.trim().startsWith('|'))
        .filter((line) => !/^\|[\s:|-]+\|?\s*$/.test(line.trim()))
        .filter((line) => !/^\|\s*`?drift:/.test(line.trim()))
        .slice(1) // drop header row
        .map((line) => {
            const cells = line
                .split('|')
                .map((c) => c.trim())
                .filter((c, i, a) => !(i === 0 && c === '') && !(i === a.length - 1 && c === ''));
            // Columns: 0 Step … 5 Fresh, 6 Cached, 7 Cache %
            const freshCell = cells[5] ?? '';
            const cachedCell = cells[6] ?? '';
            return {
                step: cells[0] ?? '',
                fresh: parseTokenCell(freshCell),
                cached: parseTokenCell(cachedCell),
                cachePct: parsePctCell(cells[7] ?? ''),
                unknownCell: UNKNOWN_CELLS.has(freshCell) || UNKNOWN_CELLS.has(cachedCell),
            };
        });
}

function validateCostEvidence(markdown: string, errors: string[]): void {
    const costBlock = sectionBody(markdown, /^#### Cost\s*$/m);
    if (costBlock === null) {
        errors.push('missing_cost_block');
        return;
    }
    for (const field of ['Ledger estimate', 'Method', 'Meter']) {
        if (!costBlock.includes(`**${field}:**`)) errors.push(`missing_cost_field:${field}`);
    }

    const ledgerLine = costBlock.split('\n').find((l) => l.includes('**Ledger estimate:**')) ?? '';
    const costTotals = parseTokensLine(ledgerLine);
    // A label present but unparseable is its own defect (task 0913 review P3-1): report it and
    // keep validating — an early return here disabled every downstream cost check, including
    // the per-row impossible-percentage scan. An absent label is already reported above as
    // missing_cost_field; with no line to parse there is nothing further to check for it.
    if (ledgerLine !== '' && costTotals === null) errors.push('malformed_cost_line');
    const footerLine = markdown.split('\n').find((l) => l.trim().startsWith('Tokens:'));
    const footerTotals = footerLine ? parseTokensLine(footerLine) : null;
    // Same contract for the footer: a present-but-unparseable Tokens: line must not
    // silently skip the footer totals comparison. An absent Tokens: line with the
    // summary block present is its own defect (task 0913 verify advisory).
    if (footerLine !== undefined && footerTotals === null) errors.push('malformed_footer');
    if (footerLine === undefined && markdown.includes('── Dogfood Summary ──')) {
        errors.push('missing_footer_tokens');
    }

    // Percentages must be within 0..100 wherever cost evidence renders one.
    const pctScopes = [costBlock, footerLine ?? ''];
    for (const row of ledgerCostRows(markdown)) {
        if (row.cachePct !== null) pctScopes.push(`${row.cachePct}%`);
    }
    for (const scope of pctScopes) {
        for (const m of scope.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) {
            const pct = Number.parseFloat(m[1]);
            if (pct < 0 || pct > 100) errors.push(`impossible_percentage:${m[0].trim()}`);
        }
    }

    const rows = ledgerCostRows(markdown);

    // Unknown cells are never folded into a numeric share: a row whose basis is
    // unknown must carry `—`, never a computed percent.
    for (const row of rows) {
        if (row.unknownCell && row.cachePct !== null) errors.push('unknown_row_with_numeric_cache');
    }

    // Per-row arithmetic: a numeric Cache % must match the row's own fresh/cached cells
    // (±1pt display rounding), not merely the aggregate share (task 0913 verify advisory).
    for (const row of rows) {
        if (row.fresh === null || row.cached === null || row.cachePct === null) continue;
        const basis = row.fresh + row.cached;
        if (basis === 0) continue;
        const expected = Math.round((row.cached / basis) * 100);
        if (Math.abs(row.cachePct - expected) > CACHE_SHARE_TOLERANCE) {
            errors.push(`cache_pct_mismatch:${row.step}_expected_${expected}`);
        }
    }

    const observable = rows.filter((r) => r.fresh !== null && r.cached !== null);
    const sumFresh = observable.reduce((acc, r) => acc + (r.fresh ?? 0), 0);
    const sumCached = observable.reduce((acc, r) => acc + (r.cached ?? 0), 0);

    const checkTotals = (label: string, totals: CostTotals | null): void => {
        if (totals === null) return;
        if (observable.length > 0) {
            const expectedTotal = sumFresh + sumCached;
            if (typeof totals.total === 'number' && totals.total !== expectedTotal) {
                errors.push(`cost_total_mismatch:${label}_expected_${expectedTotal}`);
            }
            if (typeof totals.cached === 'number' && totals.cached !== sumCached) {
                errors.push(`cost_total_mismatch:${label}_cached_expected_${sumCached}`);
            }
            const expectedPct = expectedTotal > 0 ? Math.round((sumCached / expectedTotal) * 100) : null;
            if (expectedPct !== null) {
                if (totals.pct === 'n/a' || totals.pct === null) {
                    errors.push(`missing_cache_share:${label}`);
                } else if (
                    typeof totals.pct === 'number' &&
                    Math.abs(totals.pct - expectedPct) > CACHE_SHARE_TOLERANCE
                ) {
                    errors.push(`cache_share_mismatch:${label}_expected_${expectedPct}`);
                }
            }
        } else if (
            typeof totals.total === 'number' ||
            typeof totals.cached === 'number' ||
            typeof totals.pct === 'number'
        ) {
            // No observable denominator: numeric totals/shares fabricate evidence
            // from unknown rows (unknown folded into zero). `n/a` is the honest form.
            errors.push(`fabricated_cache_share:${label}`);
        }
    };
    checkTotals('cost', costTotals);
    checkTotals('footer', footerTotals);
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

    // Cost evidence (task 0913, R2) — required block, arithmetic consistency,
    // honest unknowns.
    validateCostEvidence(markdown, errors);

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
