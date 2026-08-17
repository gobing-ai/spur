#!/usr/bin/env bun
/**
 * dev-history-load — on-demand cumulative history import + narrowed analyze (task 0567).
 *
 * Deterministic CLI sequence backing `/sp:dev-history-load`. Runs `spur history import`
 * first, then `spur history analyze` only after import exits 0 or 2 (exit 2 is a
 * mixed/degraded fan-out: proceed with a loud per-source warning — 0569). Narrowing flags
 * (`--session`, `--task`, `--since`, `--until`) are forwarded to `analyze` only — `import`
 * rejects them. `--source` reaches both. Owns no import logic, no state, and no cadence:
 * cumulative behavior comes from the shipped checkpoint resume, and the periodic pipeline
 * stays on `spur history daily`.
 *
 * Frozen flag set (dev-history-load.md argument-hint): `--source <name>`, `--session <id>`,
 * `--task <wbs>`, `--since <iso>`, `--until <iso>`, `--report`, `--dry-run`, `--json`.
 * Unknown flags are a hard error (exit 2) — never silently forwarded.
 *
 * Every `spur history` step uses `--json`; human output is derived from parsed JSON, never
 * from child-process prose.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Frozen flag surface ────────────────────────────────────────────────────

/** Flags that consume the next argv token as their value. */
const VALUE_FLAGS: Record<string, true> = {
    '--source': true,
    '--session': true,
    '--task': true,
    '--since': true,
    '--until': true,
};
/** Flags that are boolean switches. */
const BOOL_FLAGS: Record<string, true> = {
    '--report': true,
    '--dry-run': true,
    '--json': true,
};
const ALL_FLAGS: Record<string, true> = { ...VALUE_FLAGS, ...BOOL_FLAGS };

interface ParsedArgs {
    source?: string;
    session?: string;
    task?: string;
    since?: string;
    until?: string;
    report: boolean;
    dryRun: boolean;
    json: boolean;
}

interface ProcResult {
    status: number;
    stdout: string;
    stderr: string;
}

// ─── Arg parsing ─────────────────────────────────────────────────────────────

function usage(): never {
    console.error(
        'Usage: history-load.ts [--source <name>] [--session <id>] [--task <wbs>] ' +
            '[--since <iso>] [--until <iso>] [--report] [--dry-run] [--json]',
    );
    process.exit(2);
}

/** Flag literal → ParsedArgs field. `--dry-run` is the one flag whose field name differs. */
const FLAG_KEY: Record<string, keyof ParsedArgs> = {
    '--source': 'source',
    '--session': 'session',
    '--task': 'task',
    '--since': 'since',
    '--until': 'until',
    '--report': 'report',
    '--dry-run': 'dryRun',
    '--json': 'json',
};

/** Parse argv against the frozen flag set; unknown flags exit 2. */
function parseArgs(argv: string[]): ParsedArgs {
    const out: ParsedArgs = { report: false, dryRun: false, json: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (!arg.startsWith('--') || ALL_FLAGS[arg] !== true) usage();
        if (BOOL_FLAGS[arg] === true) {
            out[FLAG_KEY[arg]] = true;
            continue;
        }
        const value = argv[++i];
        if (value === undefined || value.startsWith('--')) usage();
        out[FLAG_KEY[arg]] = value;
    }
    return out;
}

// ─── spur resolution + invocation ────────────────────────────────────────────

/**
 * Resolve the spur CLI monorepo-safely: SPUR_BIN env > monorepo-local CLI entry > PATH.
 * Mirrors task-size-precheck.ts defaultSpurBin so ad-hoc and test invocations resolve the
 * same way (never a silently stale PATH install).
 */
function defaultSpurBin(): string {
    if (process.env.SPUR_BIN) return process.env.SPUR_BIN;
    const local = fileURLToPath(new URL('../../../apps/cli/src/index.ts', import.meta.url));
    if (existsSync(local)) return `bun ${local}`;
    return 'spur';
}

/** Run spur with a possibly multi-token bin (`<runtime> <mainModule>`), splitting like runSpur. */
function runSpur(spurBin: string, args: string[]): ProcResult {
    const [file = 'spur', ...lead] = spurBin.split(/\s+/).filter(Boolean);
    const result = spawnSync(file, [...lead, ...args], { encoding: 'utf-8' });
    return {
        status: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
}

// ─── Artifact path resolution ────────────────────────────────────────────────

/**
 * Resolve the analyze artifact path from the `latest.json` pointer the analyze step
 * maintains (task 0464 R2 symlink under `.spur/reports/history/`). Returns null when the
 * pointer is absent or dangling.
 */
function latestArtifactPath(cwd: string): string | null {
    const pointer = join(cwd, '.spur', 'reports', 'history', 'latest.json');
    if (!existsSync(pointer)) return null;
    try {
        return realpathSync(pointer);
    } catch {
        return null;
    }
}

// ─── Result shaping ──────────────────────────────────────────────────────────

interface ImportJson {
    entries?: Array<{
        source: string;
        status: string;
        messages?: number;
        parseErrors?: number;
        validationErrors?: number;
    }>;
    exitCode?: number;
    warnings?: Array<{ code: string; source: string; detail?: string }>;
    provenance?: unknown;
}

/** Parse `spur history import --json` output; returns null when unparseable. */
function parseImportJson(stdout: string): ImportJson | null {
    try {
        const parsed = JSON.parse(stdout) as ImportJson;
        return parsed && Array.isArray(parsed.entries) ? parsed : null;
    } catch {
        return null;
    }
}

/** Build the analyze argv with narrowing routed to analyze only. */
function buildAnalyzeArgs(args: ParsedArgs): string[] {
    const out = ['history', 'analyze', '--json'];
    if (args.source) out.push('--source', args.source);
    if (args.session) out.push('--session', args.session);
    if (args.task) out.push('--task', args.task);
    if (args.since) out.push('--since', args.since);
    if (args.until) out.push('--until', args.until);
    return out;
}

/** Emit a single JSON object on stdout; used for every `--json` exit path. */
function emitJson(obj: unknown): void {
    process.stdout.write(`${JSON.stringify(obj)}\n`);
}

/** Per-source degradation summary carried into output payloads (task 0569). */
interface DegradedWarning {
    source: string;
    status: string;
    parseErrors: number;
    validationErrors: number;
    detail: string;
}

/**
 * Build per-source degradation warnings from a fan-out import JSON: one entry per
 * degraded/failed source with its parse/validation error counts and the import step's
 * warning detail (0569 R1). Empty on a clean fan-out.
 */
function buildDegradedWarnings(imp: ImportJson | null): DegradedWarning[] {
    const detailFor = (source: string): string =>
        imp?.warnings?.find((w) => w.source === source)?.detail ?? 'no warning detail reported by import';
    return (imp?.entries ?? [])
        .filter((e) => e.status === 'degraded' || e.status === 'failed')
        .map((e) => ({
            source: e.source,
            status: e.status,
            parseErrors: typeof e.parseErrors === 'number' ? e.parseErrors : 0,
            validationErrors: typeof e.validationErrors === 'number' ? e.validationErrors : 0,
            detail: detailFor(e.source),
        }));
}

/** Attach the degradation warnings to a payload only when the fan-out was degraded (0569 R1). */
function withWarnings(payload: Record<string, unknown>, degraded: DegradedWarning[]): Record<string, unknown> {
    return degraded.length > 0 ? { ...payload, warnings: degraded } : payload;
}

// ─── Main sequence ───────────────────────────────────────────────────────────

function main(): void {
    const args = parseArgs(process.argv.slice(2));
    const spurBin = defaultSpurBin();
    const cwd = process.cwd();

    // 1. Import argv — narrowing flags NEVER reach import (it rejects them).
    const importArgs = ['history', 'import', '--json'];
    if (args.source) importArgs.push('--source', args.source);
    if (args.dryRun) importArgs.push('--dry-run');

    const importResult = runSpur(spurBin, importArgs);
    const imp = parseImportJson(importResult.stdout);

    // 2. Fatal import failures (R9, 0569): any non-zero exit EXCEPT the mixed/degraded
    //    code 2 aborts — surface the failing source + error, skip analyze, propagate the
    //    import step's exit code.
    if (importResult.status !== 0 && importResult.status !== 2) {
        const failed = (imp?.entries ?? [])
            .filter((e) => e.status !== 'ok' && e.status !== 'empty')
            .map((e) => e.source);
        const warning = imp?.warnings?.find((w) => w.code === 'source-failed' || w.code === 'source-degraded');
        const detail = warning?.detail || importResult.stderr.trim() || 'import exited non-zero';
        const message = failed.length > 0 ? `import failed for source(s): ${failed.join(', ')} — ${detail}` : detail;
        if (args.json) {
            emitJson({
                import: imp ?? { entries: [], exitCode: importResult.status },
                artifact: null,
                reported: false,
                status: 'error',
                message,
            });
        } else {
            console.error(message);
        }
        process.exit(importResult.status);
    }

    // 2b. Degraded fan-out tolerance (0569 R1): exit 2 (mixed — at least one source
    //     imported, some skipped rows) proceeds to analyze with a loud per-source warning.
    const degraded = importResult.status === 2 ? buildDegradedWarnings(imp) : [];
    if (degraded.length > 0 && !args.json) {
        console.error('WARNING: import fan-out degraded — proceeding with the healthy sources:');
        for (const w of degraded) {
            console.error(
                `  ${w.source}: status=${w.status} parseErrors=${w.parseErrors} ` +
                    `validationErrors=${w.validationErrors} — ${w.detail}`,
            );
        }
    }

    // 3. Dry-run short-circuit (R4): report what would have run, write nothing.
    if (args.dryRun) {
        const analyzeArgs = buildAnalyzeArgs(args);
        const sequence = [`spur history import --json${args.source ? ` --source ${args.source}` : ''} --dry-run`];
        sequence.push(`spur ${analyzeArgs.join(' ')}`);
        if (args.report) sequence.push('spur history report --mode forensics <artifact-path>');
        if (args.json) {
            emitJson(
                withWarnings(
                    {
                        import: imp ?? { entries: [], exitCode: importResult.status },
                        artifact: null,
                        reported: false,
                        status: 'dry-run',
                        wouldRun: sequence,
                    },
                    degraded,
                ),
            );
        } else {
            console.log('[dry-run] would run:');
            for (const line of sequence) console.log(`  ${line}`);
        }
        process.exit(0);
    }

    // 4. Analyze — only after import exited 0. Narrowing flags forwarded here only.
    const analyzeResult = runSpur(spurBin, buildAnalyzeArgs(args));
    if (analyzeResult.status !== 0) {
        const message = analyzeResult.stderr.trim() || `history analyze exited non-zero (${analyzeResult.status})`;
        if (args.json) {
            emitJson({
                import: imp ?? { entries: [], exitCode: 0 },
                artifact: null,
                reported: false,
                status: 'error',
                message,
            });
        } else {
            console.error(message);
        }
        process.exit(analyzeResult.status);
    }

    let artifact: { totals?: { messages?: number } } | null = null;
    try {
        artifact = JSON.parse(analyzeResult.stdout) as { totals?: { messages?: number } };
    } catch {
        // fall through — artifact resolution below will surface the missing pointer
    }
    const artifactPath = latestArtifactPath(cwd);

    // 5. Empty-window guard (R10): zero matched messages is NOT a successful analysis.
    const messages = artifact?.totals?.messages;
    if (typeof messages === 'number' && messages === 0) {
        const message = 'history analyze: window matched zero messages — nothing to report';
        if (args.json) {
            emitJson({
                import: imp ?? { entries: [], exitCode: 0 },
                artifact: artifactPath,
                reported: false,
                status: 'empty-window',
                message,
            });
        } else {
            console.error(message);
        }
        process.exit(1);
    }

    if (artifactPath === null) {
        const message =
            'history analyze completed but no artifact pointer (.spur/reports/history/latest.json) was found';
        if (args.json) {
            emitJson({
                import: imp ?? { entries: [], exitCode: 0 },
                artifact: null,
                reported: false,
                status: 'error',
                message,
            });
        } else {
            console.error(message);
        }
        process.exit(1);
    }

    // 6. Optional forensics render (R5) against the artifact just written.
    let reported = false;
    let reportText = '';
    if (args.report) {
        const reportResult = runSpur(spurBin, ['history', 'report', '--mode', 'forensics', artifactPath]);
        reported = reportResult.status === 0;
        reportText = reportResult.stdout;
        if (reportResult.status !== 0) {
            const message = reportResult.stderr.trim() || `history report exited non-zero (${reportResult.status})`;
            if (args.json) {
                emitJson({
                    import: imp ?? { entries: [], exitCode: 0 },
                    artifact: artifactPath,
                    reported: false,
                    status: 'error',
                    message,
                });
            } else {
                console.error(message);
            }
            process.exit(reportResult.status);
        }
    }

    // 7. Output: one JSON object (no interleaved banner) or a short human summary.
    const count = (imp?.entries ?? []).reduce((sum, e) => sum + (typeof e.messages === 'number' ? e.messages : 0), 0);
    if (args.json) {
        const payload = withWarnings(
            {
                import: imp ?? { entries: [], exitCode: 0 },
                artifact: artifactPath,
                reported,
                status: 'ok',
            },
            degraded,
        );
        if (args.report) payload.report = reportText;
        emitJson(payload);
    } else {
        console.log(`history import: ${count} records`);
        console.log(`artifact: ${artifactPath}`);
        if (args.report) process.stdout.write(reportText);
    }
}

main();
