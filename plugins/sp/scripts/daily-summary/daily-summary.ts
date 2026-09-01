#!/usr/bin/env bun
/**
 * sp:daily-summary — Daily Summary Report Generator
 *
 * Generates structured markdown summaries from:
 * - Token usage data (via ccusage CLI)
 * - Git history (commits, changes)
 * - User annotations (learnings, issues, pending)
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { logger } from './logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CliOptions {
    date: string;
    dryRun: boolean;
    outputPath?: string;
    skipGit: boolean;
    skipCcusage: boolean;
}

interface CcusageData {
    daily?: Array<{
        date: string;
        inputTokens: number;
        outputTokens: number;
        cacheCreationTokens: number;
        cacheReadTokens: number;
        totalTokens: number;
        totalCost: number;
        modelsUsed: string[];
    }>;
    totals: {
        inputTokens: number;
        outputTokens: number;
        cacheCreationTokens: number;
        cacheReadTokens: number;
        totalTokens: number;
        totalCost: number;
    };
}

export interface GitCommit {
    hash: string;
    date: string;
    message: string;
    filesChanged: number;
    insertions: number;
    deletions: number;
}

export interface UserAnnotations {
    learnings: string;
    issuesFixed: string;
    pending: string;
}

export interface HistoryLoopFinding {
    toolName: string;
    argsDigest: string;
    repeats: number;
    sessionId: string;
    fromSeq?: number;
    toSeq?: number;
    wastedTokens: number;
}

export interface HistoryHealthSummary {
    toolCalls: number;
    toolErrors: number;
    errorRatePct: number;
    loops: HistoryLoopFinding[];
    redundantCalls: number;
    wastedTokens: number;
    remediationProposals: Array<{
        key: string;
        title: string;
        command: string;
    }>;
}

export interface DailySummary {
    date: string;
    platforms: string[];
    tokenUsage?: {
        inputTokens: number;
        outputTokens: number;
        cacheTokens: number;
        totalTokens: number;
        costUsd: number;
    };
    gitActivity?: {
        commitCount: number;
        filesChanged: number;
        insertions: number;
        deletions: number;
    };
    commits: GitCommit[];
    annotations: UserAnnotations;
    /** Health metrics and loop findings from Spur history analytics. */
    historyHealth?: HistoryHealthSummary;
    /** Path to the newest history report artifact (R7), resolved from the
     * `.spur/reports/history/latest.json` pointer. Omitted when no report exists. */
    historyReportPath?: string;
    generatedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DAILY_DIR = 'docs/daily';
const DEFAULT_DATE = 'today';

// ─── CLI Argument Parsing ────────────────────────────────────────────────────

export function parseArgs(argv: string[] = process.argv.slice(2)): CliOptions {
    const args = argv;
    const options: CliOptions = {
        date: DEFAULT_DATE,
        dryRun: false,
        skipGit: false,
        skipCcusage: false,
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--date' && i + 1 < args.length) {
            options.date = args[++i];
        } else if (arg === '--dry-run') {
            options.dryRun = true;
        } else if (arg === '--output' && i + 1 < args.length) {
            options.outputPath = args[++i];
        } else if (arg === '--no-git') {
            options.skipGit = true;
        } else if (arg === '--no-ccusage') {
            options.skipCcusage = true;
        } else if (arg === '--help' || arg === '-h') {
            printUsage();
            process.exit(0);
        }
    }

    // Resolve date
    if (options.date === 'today') {
        options.date = todayLocal();
    } else if (options.date === 'yesterday') {
        options.date = yesterdayLocal();
    }

    return options;
}

export function printUsage(): void {
    console.log(`
sp:daily-summary — Generate daily summary reports

Usage: daily-summary.ts [options]

Options:
  --date YYYY-MM-DD     Date for summary (default: today, also: yesterday)
  --dry-run             Show summary without writing file
  --output <path>       Write to custom path
  --no-git              Skip git history collection
  --no-ccusage          Skip token usage collection
  --help, -h            Show this help

Examples:
  daily-summary.ts                        # Today's summary
  daily-summary.ts --date yesterday     # Yesterday's summary
  daily-summary.ts --dry-run            # Preview without writing
`);
}

// ─── Date Helpers ─────────────────────────────────────────────────────────────

// ─── Date Helpers ─────────────────────────────────────────────────────────────

/** Return today's date as YYYY-MM-DD in the system (git) timezone. */
export function todayLocal(): string {
    // Spawn 'date' to get system timezone date, since JS runtime
    // may have a different TZ (e.g. bun test forces UTC).
    const proc = spawnSync('date', ['+%Y-%m-%d'], { encoding: 'utf8' });
    return (proc.stdout ?? '').trim();
}

/** Return yesterday's date as YYYY-MM-DD in the system (git) timezone. */
export function yesterdayLocal(): string {
    // Use portable epoch math via date command
    const epochProc = spawnSync('date', ['+%s'], { encoding: 'utf8' });
    const epoch = parseInt((epochProc.stdout ?? '').trim(), 10);
    const yesterdayEpoch = epoch - 86400;
    // Try BSD -r first, then GNU -d @
    let proc = spawnSync('date', ['-r', String(yesterdayEpoch), '+%Y-%m-%d'], { encoding: 'utf8' });
    if ((proc.status ?? 1) !== 0) {
        proc = spawnSync('date', ['-d', `@${yesterdayEpoch}`, '+%Y-%m-%d'], { encoding: 'utf8' });
    }
    return (proc.stdout ?? '').trim();
}

export function getDateRange(dateStr: string): { start: string; end: string } {
    // Date is YYYY-MM-DD format
    const date = new Date(`${dateStr}T00:00:00`);
    const start = `${dateStr} 00:00:00`;
    const endDate = new Date(date);
    endDate.setDate(endDate.getDate() + 1);
    const end = `${endDate.toISOString().slice(0, 10)} 00:00:00`;
    return { start, end };
}

// ─── Subprocess Spawner ──────────────────────────────────────────────────────

export interface ProcessSpawnResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

export type ProcessSpawner = (cmd: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<ProcessSpawnResult>;

export const defaultProcessSpawner: ProcessSpawner = (cmd, args, env) => {
    return new Promise((resolve, reject) => {
        try {
            const proc = spawn(cmd, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                env: env ?? process.env,
            });
            const stdoutChunks: Buffer[] = [];
            const stderrChunks: Buffer[] = [];
            proc.stdout.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
            proc.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));
            proc.on('close', (exitCode) => {
                resolve({
                    stdout: Buffer.concat(stdoutChunks).toString('utf8'),
                    stderr: Buffer.concat(stderrChunks).toString('utf8'),
                    exitCode: exitCode ?? 0,
                });
            });
            proc.on('error', (err) => {
                reject(err);
            });
        } catch (err) {
            reject(err);
        }
    });
};

let processSpawner: ProcessSpawner = defaultProcessSpawner;

export function setProcessSpawner(next?: ProcessSpawner): void {
    processSpawner = next ?? defaultProcessSpawner;
}

// ─── Ccusage Integration ─────────────────────────────────────────────────────

export async function getCcusageData(date: string): Promise<CcusageData | null> {
    try {
        // Check if ccusage is available
        const env = { ...process.env };
        const ccusageCheck = await processSpawner('ccusage', ['--version'], env);
        if (ccusageCheck.exitCode !== 0) {
            return null;
        }

        // Get daily data for the date
        const since = `${date}T00:00:00`;
        const until = `${date}T23:59:59`;

        const proc = await processSpawner('ccusage', ['daily', '--since', since, '--until', until, '--json'], env);

        if (proc.exitCode !== 0) {
            logger.warn(`ccusage error: ${proc.stderr}`);
            return null;
        }

        const data = JSON.parse(proc.stdout) as CcusageData;
        return data;
    } catch (error) {
        logger.warn(`Failed to get ccusage data: ${error}`);
        return null;
    }
}

// ─── Spur History Health Integration ──────────────────────────────────────────

export async function getSpurHistoryHealth(
    date: string,
    dbPath = '.spur/spur.db',
): Promise<HistoryHealthSummary | null> {
    try {
        const resolvedPath = resolve(process.cwd(), dbPath);
        if (!existsSync(resolvedPath)) {
            return null;
        }

        const { Database } = await import('bun:sqlite');
        const db = new Database(resolvedPath, { readonly: true });

        try {
            // 1. Query execution loop findings
            const loopTable = db
                .query<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
                .get('history_board_loop_findings');

            let loops: HistoryLoopFinding[] = [];
            if (loopTable) {
                const rows = db
                    .query<
                        {
                            tool_name: string;
                            args_digest: string;
                            repeats: number;
                            session_id: string;
                            first_seq: number;
                            last_seq: number;
                            started_at: string | null;
                        },
                        [string]
                    >(
                        `SELECT tool_name, args_digest, repeats, session_id, first_seq, last_seq, started_at
                         FROM history_board_loop_findings
                         WHERE started_at IS NULL OR started_at LIKE ?
                         ORDER BY repeats DESC
                         LIMIT 20`,
                    )
                    .all(`${date}%`);

                loops = rows.map((r) => ({
                    toolName: r.tool_name,
                    argsDigest: r.args_digest || 'repeated execution',
                    repeats: r.repeats,
                    sessionId: r.session_id,
                    fromSeq: r.first_seq,
                    toSeq: r.last_seq,
                    wastedTokens: r.repeats * 250,
                }));
            }

            // 2. Query tool calls and errors
            let toolCalls = 0;
            let toolErrors = 0;
            const toolTable = db
                .query<{ name: string }, [string]>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
                .get('history_board_tool_5m');

            if (toolTable) {
                const stats = db
                    .query<{ calls: number | null; errors: number | null }, [string]>(
                        `SELECT SUM(calls) AS calls, SUM(errors) AS errors
                         FROM history_board_tool_5m
                         WHERE bucket_start LIKE ?`,
                    )
                    .get(`${date}%`);

                toolCalls = stats?.calls ?? 0;
                toolErrors = stats?.errors ?? 0;
            }

            const redundantCalls = loops.reduce((acc, l) => acc + Math.max(0, l.repeats - 1), 0);
            const wastedTokens = loops.reduce((acc, l) => acc + l.wastedTokens, 0);
            const errorRatePct = toolCalls > 0 ? (toolErrors / toolCalls) * 100 : 0;

            // 3. Generate auto-healing remediation proposals
            const remediationProposals: Array<{ key: string; title: string; command: string }> = [];

            for (const lp of loops.slice(0, 5)) {
                const cleanTool = lp.toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
                const key = `repetition:${cleanTool}:${lp.argsDigest.slice(0, 16)}`;
                const title = `Break execution loop in ${lp.toolName} (${lp.repeats} repeats)`;
                const body = `Finding: ${key}\\nObserved ${lp.repeats} redundant invocations in session ${lp.sessionId} (steps #${lp.fromSeq ?? 1}→#${lp.toSeq ?? lp.repeats}). Wasted tokens: ~${lp.wastedTokens}.`;
                const command = `spur task create --section "Fix ${cleanTool} repetition loop" --body "${body}"`;
                remediationProposals.push({ key, title, command });
            }

            if (toolCalls > 0 && errorRatePct > 10) {
                const key = 'reliability:tooling:high-error-rate';
                const title = `Investigate high tool error rate (${errorRatePct.toFixed(1)}%)`;
                const body = `Finding: ${key}\\nObserved ${toolErrors} errors across ${toolCalls} tool calls (${errorRatePct.toFixed(1)}% error rate) on ${date}.`;
                const command = `spur task create --section "Investigate tool error rate spikes" --body "${body}"`;
                remediationProposals.push({ key, title, command });
            }

            return {
                toolCalls,
                toolErrors,
                errorRatePct,
                loops,
                redundantCalls,
                wastedTokens,
                remediationProposals,
            };
        } finally {
            db.close();
        }
    } catch {
        return null;
    }
}

// ─── Git Integration ─────────────────────────────────────────────────────────

export async function getGitCommits(date: string): Promise<GitCommit[]> {
    try {
        const { start, end } = getDateRange(date);

        const proc = await processSpawner('git', [
            'log',
            '--since',
            start,
            '--until',
            end,
            '--pretty=format:%H|%ad|%s',
            '--date=iso',
            '--numstat',
        ]);

        if (proc.exitCode !== 0) {
            logger.warn('Failed to get git commits');
            return [];
        }

        const commits: GitCommit[] = [];
        const lines = proc.stdout.trim().split('\n');

        let currentCommit: Partial<GitCommit> | null = null;

        for (const line of lines) {
            if (!line.trim()) continue;

            // Check if this is a commit line (contains | separator)
            if (line.includes('|')) {
                const parts = line.split('|');
                if (parts.length >= 3) {
                    // Save previous commit if exists
                    if (currentCommit?.hash) {
                        commits.push(currentCommit as GitCommit);
                    }

                    currentCommit = {
                        hash: parts[0],
                        date: parts[1],
                        message: parts[2],
                        filesChanged: 0,
                        insertions: 0,
                        deletions: 0,
                    };
                }
            } else if (currentCommit && line.includes('\t')) {
                // This is a numstat line (files changed)
                const parts = line.split('\t');
                if (parts.length >= 3) {
                    const insertions = parseInt(parts[0], 10) || 0;
                    const deletions = parseInt(parts[1], 10) || 0;
                    currentCommit.filesChanged = (currentCommit.filesChanged ?? 0) + 1;
                    currentCommit.insertions = (currentCommit.insertions ?? 0) + insertions;
                    currentCommit.deletions = (currentCommit.deletions ?? 0) + deletions;
                }
            }
        }

        // Don't forget the last commit
        if (currentCommit?.hash) {
            commits.push(currentCommit as GitCommit);
        }

        return commits;
    } catch (error) {
        logger.warn(`Failed to get git commits: ${error}`);
        return [];
    }
}

// ─── User Input ─────────────────────────────────────────────────────────────

export async function promptUser(): Promise<UserAnnotations> {
    if (process.env.SP_DAILY_SUMMARY_NO_PROMPT === '1') {
        return { learnings: '', issuesFixed: '', pending: '' };
    }
    if (process.env.RD3_DAILY_SUMMARY_NO_PROMPT === '1') {
        logger.warn('[deprecate] RD3_DAILY_SUMMARY_NO_PROMPT is deprecated; use SP_DAILY_SUMMARY_NO_PROMPT');
        return { learnings: '', issuesFixed: '', pending: '' };
    }

    console.log(`\n📊 Daily Summary — ${todayLocal()}`);
    console.log('═'.repeat(50));
    console.log('\nPlease provide the following (press Enter to skip):\n');

    if (!process.stdin.isTTY) {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
            chunks.push(chunk as Buffer);
        }
        const buffered = Buffer.concat(chunks).toString('utf-8');
        const [learnings = '', issuesFixed = '', pending = ''] = buffered.split('\n');
        return {
            learnings: learnings.trim(),
            issuesFixed: issuesFixed.trim(),
            pending: pending.trim(),
        };
    }

    const readline = await import('node:readline');
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const question = (prompt: string): Promise<string> =>
        new Promise((resolve) => {
            rl.question(prompt, (answer) => {
                resolve(answer.trim());
            });
        });

    const learnings = await question('1. What did you learn today? (optional)\n   > ');
    const issuesFixed = await question('\n2. What issues did you fix? (optional)\n   > ');
    const pending = await question("\n3. What's pending for tomorrow? (optional)\n   > ");

    rl.close();

    return {
        learnings,
        issuesFixed,
        pending,
    };
}

// ─── Markdown Generation ─────────────────────────────────────────────────────

export function generateMarkdown(summary: DailySummary): string {
    const lines: string[] = [];

    // Header
    lines.push(`# Daily Summary — ${summary.date}`);
    lines.push('');
    lines.push(`**Generated:** ${summary.generatedAt}`);
    lines.push('');

    // Meta section
    lines.push('## Meta');
    lines.push('');
    lines.push(`- **Date:** ${summary.date}`);
    lines.push(`- **Platforms:** ${summary.platforms.join(', ') || 'unknown'}`);
    lines.push('');

    // Token Usage
    if (summary.tokenUsage) {
        const tu = summary.tokenUsage;
        lines.push('## Token Usage');
        lines.push('');
        lines.push(`| Metric | Value |`);
        lines.push(`|--------|-------|`);
        lines.push(`| Input Tokens | ${tu.inputTokens.toLocaleString()} |`);
        lines.push(`| Output Tokens | ${tu.outputTokens.toLocaleString()} |`);
        lines.push(`| Cache Tokens | ${tu.cacheTokens.toLocaleString()} |`);
        lines.push(`| Total Tokens | ${tu.totalTokens.toLocaleString()} |`);
        lines.push(`| Estimated Cost | $${tu.costUsd.toFixed(4)} |`);
        lines.push('');

        // Calculate cache hit rate
        if (tu.inputTokens > 0) {
            const cacheHitRate = (tu.cacheTokens / (tu.inputTokens + tu.cacheTokens)) * 100;
            lines.push(`**Cache Hit Rate:** ${cacheHitRate.toFixed(1)}%`);
            lines.push('');
        }
    }

    // Git Activity
    if (summary.gitActivity) {
        const ga = summary.gitActivity;
        lines.push('## Git Activity');
        lines.push('');
        lines.push(`| Metric | Value |`);
        lines.push(`|--------|-------|`);
        lines.push(`| Commits | ${ga.commitCount} |`);
        lines.push(`| Files Changed | ${ga.filesChanged} |`);
        lines.push(`| Insertions | +${ga.insertions} |`);
        lines.push(`| Deletions | -${ga.deletions} |`);
        lines.push('');
    }

    // Commits
    if (summary.commits.length > 0) {
        lines.push('## Commits');
        lines.push('');
        for (const commit of summary.commits.slice(0, 10)) {
            const shortHash = commit.hash.slice(0, 7);
            lines.push(`- \`${shortHash}\` ${commit.message}`);
        }
        if (summary.commits.length > 10) {
            lines.push(`- ... and ${summary.commits.length - 10} more commits`);
        }
        lines.push('');
    }

    // Annotations
    const { learnings, issuesFixed, pending } = summary.annotations;

    if (learnings) {
        lines.push('## Learnings');
        lines.push('');
        lines.push(learnings);
        lines.push('');
    }

    if (issuesFixed) {
        lines.push('## Issues Fixed');
        lines.push('');
        lines.push(issuesFixed);
        lines.push('');
    }

    if (pending) {
        lines.push('## Pending');
        lines.push('');
        lines.push(pending);
        lines.push('');
    }

    // Execution Loops & Health Findings
    if (summary.historyHealth) {
        const hh = summary.historyHealth;
        lines.push('## Execution Loops & Health Findings');
        lines.push('');

        if (hh.loops.length === 0 && hh.toolCalls === 0) {
            lines.push('- **Status:** ✅ Clean — No execution loops or tool calls recorded for this date.');
            lines.push('');
        } else {
            lines.push('| Metric | Value |');
            lines.push('|--------|-------|');
            lines.push(`| Tool Invocations | ${hh.toolCalls.toLocaleString()} |`);
            lines.push(`| Tool Errors | ${hh.toolErrors.toLocaleString()} (${hh.errorRatePct.toFixed(1)}%) |`);
            lines.push(`| Detected Loops (Repeats ≥ 3) | ${hh.loops.length} |`);
            lines.push(`| Redundant Invocations | ${hh.redundantCalls.toLocaleString()} |`);
            lines.push(`| Estimated Wasted Tokens | ${hh.wastedTokens.toLocaleString()} |`);
            lines.push('');

            if (hh.loops.length > 0) {
                lines.push('### Detected Execution Loops');
                lines.push('');
                for (const lp of hh.loops.slice(0, 10)) {
                    const seqInfo = lp.fromSeq && lp.toSeq ? ` (steps #${lp.fromSeq} → #${lp.toSeq})` : '';
                    const argsHint =
                        lp.argsDigest === '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b'
                            ? 'empty/unrecorded arguments'
                            : lp.argsDigest.length > 28
                              ? `${lp.argsDigest.slice(0, 24)}...`
                              : lp.argsDigest;
                    lines.push(
                        `- \`${lp.toolName || 'unknown'}\` × **${lp.repeats} repeats** in session \`${lp.sessionId}\`${seqInfo}`,
                    );
                    lines.push(`  - *Args hint:* \`${argsHint}\` (~${lp.wastedTokens.toLocaleString()} wasted tokens)`);
                }
                lines.push('');
            }

            if (hh.remediationProposals.length > 0) {
                lines.push('### Auto-Healing Remediation Proposals');
                lines.push('');
                lines.push('To remediate root causes and prevent recurring token waste, execute:');
                lines.push('');
                lines.push('```bash');
                for (const prop of hh.remediationProposals) {
                    lines.push(`# ${prop.title} [${prop.key}]`);
                    lines.push(prop.command);
                    lines.push('');
                }
                lines.push('```');
                lines.push('');
            }
        }
    }

    // History report path (R7 — surfaces the newest nightly-run artifact).
    if (summary.historyReportPath) {
        lines.push('## History Report');
        lines.push('');
        lines.push(`- **Newest artifact:** ${summary.historyReportPath}`);
        lines.push('');
    }

    // Footer
    lines.push('---');
    lines.push('');
    lines.push(`*Generated by sp:daily-summary at ${summary.generatedAt}*`);

    return lines.join('\n');
}

// ─── File Output ─────────────────────────────────────────────────────────────

export function ensureDir(path: string): void {
    if (!existsSync(path)) {
        mkdirSync(path, { recursive: true });
    }
}

export function writeSummary(markdown: string, options: CliOptions): string {
    const filename = `summary_${options.date.replace(/-/g, '')}.md`;
    const outputPath = options.outputPath || join(DAILY_DIR, filename);

    ensureDir(join(outputPath, '..'));

    writeFileSync(outputPath, markdown, 'utf-8');

    return outputPath;
}

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * Resolve the newest history report artifact path by following the
 * `.spur/reports/history/latest.json` symlink (task 0471 R7). Returns
 * `undefined` when no report exists — the daily summary simply omits the
 * section rather than failing.
 */
function resolveHistoryReportPath(): string | undefined {
    const pointer = resolve(process.cwd(), '.spur', 'reports', 'history', 'latest.json');
    if (!existsSync(pointer)) {
        return undefined;
    }
    try {
        const target = readlinkSync(pointer);
        const resolved = isAbsolute(target) ? target : resolve(dirname(pointer), target);
        return existsSync(resolved) ? resolved : undefined;
    } catch {
        // Not a symlink or unreadable — treat as absent.
        return undefined;
    }
}

export async function buildDailySummary(options: CliOptions): Promise<DailySummary> {
    const platforms: string[] = [];

    // Get token usage from ccusage
    let tokenUsage: DailySummary['tokenUsage'];

    if (!options.skipCcusage) {
        const ccusageData = await getCcusageData(options.date);
        if (ccusageData?.totals) {
            const totals = ccusageData.totals;
            tokenUsage = {
                inputTokens: totals.inputTokens,
                outputTokens: totals.outputTokens,
                cacheTokens: totals.cacheCreationTokens + totals.cacheReadTokens,
                totalTokens: totals.totalTokens,
                costUsd: totals.totalCost,
            };
            platforms.push('Claude Code');
        }
    }

    // Get git history
    let gitActivity: DailySummary['gitActivity'];
    let commits: GitCommit[] = [];

    if (!options.skipGit) {
        commits = await getGitCommits(options.date);
        if (commits.length > 0) {
            gitActivity = commits.reduce(
                (acc, commit) => ({
                    commitCount: acc.commitCount + 1,
                    filesChanged: acc.filesChanged + (commit.filesChanged || 0),
                    insertions: acc.insertions + (commit.insertions || 0),
                    deletions: acc.deletions + (commit.deletions || 0),
                }),
                { commitCount: 0, filesChanged: 0, insertions: 0, deletions: 0 },
            );
            platforms.push('Git');
        }
    }

    // R7 — surface the newest history report artifact path (if present).
    const historyReportPath = resolveHistoryReportPath();

    // Get user annotations
    const annotations = await promptUser();

    const result: DailySummary = {
        date: options.date,
        platforms,
        commits,
        annotations,
        historyReportPath,
        generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
    };

    if (tokenUsage !== undefined) {
        result.tokenUsage = tokenUsage;
    }
    if (gitActivity !== undefined) {
        result.gitActivity = gitActivity;
    }

    // Query Spur history health (loops, tool errors, and auto-healing proposals)
    const historyHealth = await getSpurHistoryHealth(options.date);
    if (historyHealth && (historyHealth.loops.length > 0 || historyHealth.toolCalls > 0)) {
        result.historyHealth = historyHealth;
        platforms.push('Spur History');
    }

    return result;
}

export async function main(): Promise<void> {
    const options = parseArgs();

    logger.info(`Generating daily summary for ${options.date}...`);

    try {
        const summary = await buildDailySummary(options);
        const markdown = generateMarkdown(summary);

        if (options.dryRun) {
            console.log(`\n${markdown}\n`);
            logger.info('(dry-run) Summary not written to file');
        } else {
            const outputPath = writeSummary(markdown, options);
            console.log(`\n${markdown}\n`);
            console.log(`\n✅ Summary written to: ${outputPath}`);
        }

        // Print summary stats
        console.log('\n📊 Summary Statistics:');
        console.log(`   Date: ${summary.date}`);
        console.log(`   Platforms: ${summary.platforms.join(', ') || 'none'}`);
        if (summary.tokenUsage) {
            console.log(`   Tokens: ${summary.tokenUsage.totalTokens.toLocaleString()}`);
            console.log(`   Cost: $${summary.tokenUsage.costUsd.toFixed(4)}`);
        }
        if (summary.gitActivity) {
            console.log(`   Commits: ${summary.gitActivity.commitCount}`);
        }
    } catch (error) {
        logger.error(`Failed to generate summary: ${error}`);
        process.exit(1);
    }
}

if (import.meta.main) {
    main().catch((error) => {
        logger.error(`Daily summary failed: ${error}`);
        process.exit(1);
    });
}
