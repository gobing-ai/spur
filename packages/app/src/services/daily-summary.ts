/**
 * `spur history summary` — the sp:daily-summary report generator. Builds a structured Markdown
 * summary of one day from token usage (ccusage), git history, the day's history health (loops,
 * tool errors) and optional operator annotations. Absorbed from the retired
 * `plugins/sp/scripts/daily-summary/daily-summary.ts` (script-absorption PR-6): the report bytes,
 * flags and exit codes are unchanged; it reads history health in-process instead of through the
 * generated inline bundle, so the Bun re-entry the `.mjs` twin needed is gone.
 */

import { existsSync, mkdirSync, readlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { getEnvVar, getEnvVars } from '@gobing-ai/spur-config';
import { NodeProcessExecutor, NodeSyncProcessExecutor } from '@gobing-ai/ts-runtime';
import { readHistoryHealth } from './history-service';

// ─── Output sink ─────────────────────────────────────────────────────────────

/** Line sink for every report line; each call is one line (the sink adds the terminator). */
export interface DailySummaryIo {
    out(line: string): void;
    err(line: string): void;
}

/** The caller's sink, installed by {@link main} (or {@link setDailySummaryIo}); null = silent. */
let io: DailySummaryIo | null = null;

/** Install (or clear, with no argument) the line sink outside {@link main} (test hook). */
export function setDailySummaryIo(next?: DailySummaryIo): void {
    io = next ?? null;
}

const logger = {
    info: (message: string): void => io?.out(message),
    warn: (message: string): void => io?.err(message),
    error: (message: string): void => io?.err(message),
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CliOptions {
    date: string;
    /** `--help` / `-h`: print usage and exit 0 (handled by {@link main}). */
    help?: boolean;
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

/** One commit of the day with its file stats (from `git log --numstat`). */
export interface GitCommit {
    hash: string;
    date: string;
    message: string;
    filesChanged: number;
    insertions: number;
    deletions: number;
}

/** Operator annotations collected by the prompt (or non-TTY stdin lines). */
export interface UserAnnotations {
    learnings: string;
    issuesFixed: string;
    pending: string;
}

/** One execution-loop finding from the day's history health reading. */
export interface HistoryLoopFinding {
    toolName: string;
    argsDigest: string;
    repeats: number;
    sessionId: string;
    fromSeq?: number;
    toSeq?: number;
    wastedTokens: number;
}

/** The day's history health, composed from the app's `readHistoryHealth` reading. */
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

/** Everything the daily report renders: tokens, git activity, history health, annotations. */
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

export function parseArgs(argv: string[]): CliOptions {
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
            options.date = args[++i] ?? options.date;
        } else if (arg === '--dry-run') {
            options.dryRun = true;
        } else if (arg === '--output' && i + 1 < args.length) {
            options.outputPath = args[++i];
        } else if (arg === '--no-git') {
            options.skipGit = true;
        } else if (arg === '--no-ccusage') {
            options.skipCcusage = true;
        } else if (arg === '--help' || arg === '-h') {
            options.help = true;
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

/** Print the `spur history summary` usage through the sink. */
export function printUsage(): void {
    logger.info(`
sp:daily-summary — Generate daily summary reports

Usage: spur history summary [options]

Options:
  --date YYYY-MM-DD     Date for summary (default: today, also: yesterday)
  --dry-run             Show summary without writing file
  --output <path>       Write to custom path
  --no-git              Skip git history collection
  --no-ccusage          Skip token usage collection
  --help, -h            Show this help

Examples:
  spur history summary                      # Today's summary
  spur history summary --date yesterday     # Yesterday's summary
  spur history summary --dry-run            # Preview without writing
`);
}

// ─── Date Helpers ─────────────────────────────────────────────────────────────

/** Run `date` synchronously through the process seam; stdout, or '' when it fails. */
function runDate(args: string[]): { stdout: string; exitCode: number } {
    const r = new NodeSyncProcessExecutor().runSync({ command: 'date', args });
    return { stdout: r.stdout, exitCode: r.exitCode ?? 1 };
}

/** Return today's date as YYYY-MM-DD in the system (git) timezone. */
export function todayLocal(): string {
    // Spawn 'date' to get system timezone date, since JS runtime
    // may have a different TZ (e.g. bun test forces UTC).
    return runDate(['+%Y-%m-%d']).stdout.trim();
}

/** Return yesterday's date as YYYY-MM-DD in the system (git) timezone. */
export function yesterdayLocal(): string {
    // Use portable epoch math via date command
    const epoch = parseInt(runDate(['+%s']).stdout.trim(), 10);
    const yesterdayEpoch = epoch - 86400;
    // Try BSD -r first, then GNU -d @
    let proc = runDate(['-r', String(yesterdayEpoch), '+%Y-%m-%d']);
    if (proc.exitCode !== 0) {
        proc = runDate(['-d', `@${yesterdayEpoch}`, '+%Y-%m-%d']);
    }
    return proc.stdout.trim();
}

/** The local-day `[start, end]` ISO bounds of a `YYYY-MM-DD` date (for git `--since/--until`). */
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

/** Spawns a child process and resolves its captured output (injectable for tests). */
export type ProcessSpawner = (
    cmd: string,
    args: string[],
    env?: Record<string, string | undefined>,
) => Promise<ProcessSpawnResult>;

/** Real execution through the async process seam (no timeout: ccusage/git run to completion). */
export const defaultProcessSpawner: ProcessSpawner = async (cmd, args, env) => {
    const result = await new NodeProcessExecutor().run({
        command: cmd,
        args,
        env: (env ?? getEnvVars()) as Record<string, string>,
        envMode: 'replace',
        timeout: null,
        maxOutput: 256 * 1024 * 1024,
        rejectOnError: false,
    });
    // A binary that cannot start rejects, as the legacy spawn did, so callers report it as missing.
    // (The seam reports that as a null exit code with no signal.)
    if (result.exitCode === null && result.signal === undefined) throw new Error(`failed to spawn ${cmd}`);
    return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode ?? 0 };
};

let processSpawner: ProcessSpawner = defaultProcessSpawner;

/** Install (or reset, with no argument) the process spawner used for ccusage and git. */
export function setProcessSpawner(next?: ProcessSpawner): void {
    processSpawner = next ?? defaultProcessSpawner;
}

// ─── Ccusage Integration ─────────────────────────────────────────────────────

export async function getCcusageData(date: string): Promise<CcusageData | null> {
    try {
        // Check if ccusage is available
        const env = { ...getEnvVars() };
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

/** The day's raw history health as the history service reads it (task 1178 R3). */
type HistoryHealthReading = NonNullable<Awaited<ReturnType<typeof readHistoryHealth>>>;

/**
 * Compose the daily report's health summary from the app reading. `wastedTokens` stays an
 * explicit `repeats * 250` estimate; remediation proposals stay plain text (task 1178 R3).
 */
function composeHistoryHealth(reading: HistoryHealthReading): HistoryHealthSummary {
    const loops: HistoryLoopFinding[] = reading.loops.map((row) => ({
        toolName: row.toolName,
        argsDigest: row.argsDigest || 'repeated execution',
        repeats: row.repeats,
        sessionId: row.sessionId,
        fromSeq: row.firstSeq,
        toSeq: row.lastSeq,
        wastedTokens: row.repeats * 250,
    }));

    const remediationProposals: Array<{ key: string; title: string; command: string }> = [];
    for (const lp of loops.slice(0, 5)) {
        const cleanTool = lp.toolName.replace(/[^a-zA-Z0-9_-]/g, '_');
        const key = `repetition:${cleanTool}:${lp.argsDigest.slice(0, 16)}`;
        const title = `Break execution loop in ${lp.toolName} (${lp.repeats} repeats)`;
        const command = `spur task create "<title>" --feature <id> && spur task update <wbs> --section Plan --from-file <path>`;
        remediationProposals.push({ key, title, command });
    }
    if (reading.toolCalls > 0 && reading.errorRatePct > 10) {
        remediationProposals.push({
            key: 'reliability:tooling:high-error-rate',
            title: `Investigate high tool error rate (${reading.errorRatePct.toFixed(1)}%)`,
            command: `spur task create "<title>" --feature <id> && spur task update <wbs> --section Plan --from-file <path>`,
        });
    }

    return {
        toolCalls: reading.toolCalls,
        toolErrors: reading.toolErrors,
        errorRatePct: reading.errorRatePct,
        loops,
        redundantCalls: loops.reduce((acc, l) => acc + Math.max(0, l.repeats - 1), 0),
        wastedTokens: loops.reduce((acc, l) => acc + l.wastedTokens, 0),
        remediationProposals,
    };
}

/**
 * Read the day's history health through the app owner (task 1178 R3): this adapter opens no
 * SQLite and carries no SQL. A missing database file or required table returns `null`
 * (unavailable); an existing empty table returns a measured-zero summary, never `n/a`.
 */
export async function getSpurHistoryHealth(
    date: string,
    dbPath = '.spur/spur.db',
): Promise<HistoryHealthSummary | null> {
    try {
        const resolvedPath = resolve(process.cwd(), dbPath);
        const reading = await readHistoryHealth({ date, dbPath: resolvedPath });
        return reading === null ? null : composeHistoryHealth(reading);
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
                    const insertions = parseInt(parts[0] ?? '', 10) || 0;
                    const deletions = parseInt(parts[1] ?? '', 10) || 0;
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
    if (getEnvVar('SP_DAILY_SUMMARY_NO_PROMPT') === '1') {
        return { learnings: '', issuesFixed: '', pending: '' };
    }
    if (getEnvVar('RD3_DAILY_SUMMARY_NO_PROMPT') === '1') {
        logger.warn('[deprecate] RD3_DAILY_SUMMARY_NO_PROMPT is deprecated; use SP_DAILY_SUMMARY_NO_PROMPT');
        return { learnings: '', issuesFixed: '', pending: '' };
    }

    logger.info(`\n📊 Daily Summary — ${todayLocal()}`);
    logger.info('═'.repeat(50));
    logger.info('\nPlease provide the following (press Enter to skip):\n');

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

/** Write the report (default `docs/daily/summary_<YYYYMMDD>.md`) and return its path. */
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

/** Collect the day's tokens, git activity, history health and annotations into a summary. */
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

    // Query Spur history health (loops, tool errors, and auto-healing proposals). A measured
    // empty day is a real zero and keeps its "Clean" section; an unavailable database (missing
    // file/table) stays absent — absence and zero never collapse (task 1178 R3).
    const historyHealth = await getSpurHistoryHealth(options.date);
    if (historyHealth) {
        result.historyHealth = historyHealth;
        platforms.push('Spur History');
    }

    return result;
}

/**
 * Generate, print and (unless `--dry-run`) write the day's summary. Every line goes to `sink`;
 * returns the exit code (0 ok, 1 generation failed).
 */
export async function main(argv: string[], sink: DailySummaryIo): Promise<number> {
    const previous = io;
    io = sink;
    try {
        return await runDailySummary(argv);
    } finally {
        io = previous;
    }
}

async function runDailySummary(argv: string[]): Promise<number> {
    const options = parseArgs(argv);
    if (options.help) {
        printUsage();
        return 0;
    }

    logger.info(`Generating daily summary for ${options.date}...`);

    try {
        const summary = await buildDailySummary(options);
        const markdown = generateMarkdown(summary);

        if (options.dryRun) {
            logger.info(`\n${markdown}\n`);
            logger.info('(dry-run) Summary not written to file');
        } else {
            const outputPath = writeSummary(markdown, options);
            logger.info(`\n${markdown}\n`);
            logger.info(`\n✅ Summary written to: ${outputPath}`);
        }

        // Print summary stats
        logger.info('\n📊 Summary Statistics:');
        logger.info(`   Date: ${summary.date}`);
        logger.info(`   Platforms: ${summary.platforms.join(', ') || 'none'}`);
        if (summary.tokenUsage) {
            logger.info(`   Tokens: ${summary.tokenUsage.totalTokens.toLocaleString()}`);
            logger.info(`   Cost: $${summary.tokenUsage.costUsd.toFixed(4)}`);
        }
        if (summary.gitActivity) {
            logger.info(`   Commits: ${summary.gitActivity.commitCount}`);
        }
        return 0;
    } catch (error) {
        logger.error(`Failed to generate summary: ${error}`);
        return 1;
    }
}
