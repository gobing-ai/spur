#!/usr/bin/env bun
/**
 * sp:daily-summary — Daily Summary Report Generator
 *
 * Generates structured markdown summaries from:
 * - Token usage data (via ccusage CLI)
 * - Git history (commits, changes)
 * - User annotations (learnings, issues, pending)
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

/** Return today's date as YYYY-MM-DD in the system (git) timezone. */
export function todayLocal(): string {
    // Spawn 'date' to get system timezone date, since JS runtime
    // may have a different TZ (e.g. bun test forces UTC).
    const proc = Bun.spawnSync(['date', '+%Y-%m-%d']);
    return proc.stdout.toString().trim();
}

/** Return yesterday's date as YYYY-MM-DD in the system (git) timezone. */
export function yesterdayLocal(): string {
    // Use portable epoch math via date command
    const epochProc = Bun.spawnSync(['date', '+%s']);
    const epoch = parseInt(epochProc.stdout.toString().trim(), 10);
    const yesterdayEpoch = epoch - 86400;
    // Try BSD -r first, then GNU -d @
    let proc = Bun.spawnSync(['date', '-r', String(yesterdayEpoch), '+%Y-%m-%d']);
    if (proc.exitCode !== 0) {
        proc = Bun.spawnSync(['date', '-d', `@${yesterdayEpoch}`, '+%Y-%m-%d']);
    }
    return proc.stdout.toString().trim();
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

// ─── Ccusage Integration ─────────────────────────────────────────────────────

export async function getCcusageData(date: string): Promise<CcusageData | null> {
    try {
        // Check if ccusage is available
        const env = { ...process.env };
        const ccusageCheck = Bun.spawn(['ccusage', '--version'], {
            stdout: 'pipe',
            stderr: 'pipe',
            env,
        });
        await new Response(ccusageCheck.stdout).text();
        await ccusageCheck.exited;

        // Get daily data for the date
        const since = `${date}T00:00:00`;
        const until = `${date}T23:59:59`;

        const proc = Bun.spawn(['ccusage', 'daily', '--since', since, '--until', until, '--json'], {
            stdout: 'pipe',
            stderr: 'pipe',
            env,
        });

        const output = await new Response(proc.stdout).text();
        const exitCode = await proc.exited;

        if (exitCode !== 0) {
            const errorOutput = await new Response(proc.stderr).text();
            logger.warn(`ccusage error: ${errorOutput}`);
            return null;
        }

        const data = JSON.parse(output) as CcusageData;
        return data;
    } catch (error) {
        logger.warn(`Failed to get ccusage data: ${error}`);
        return null;
    }
}

// ─── Git Integration ─────────────────────────────────────────────────────────

export async function getGitCommits(date: string): Promise<GitCommit[]> {
    try {
        const { start, end } = getDateRange(date);

        const proc = Bun.spawn(
            ['git', 'log', '--since', start, '--until', end, '--pretty=format:%H|%ad|%s', '--date=iso', '--numstat'],
            { stdout: 'pipe', stderr: 'pipe' },
        );

        const output = await new Response(proc.stdout).text();
        const exitCode = await proc.exited;

        if (exitCode !== 0) {
            logger.warn('Failed to get git commits');
            return [];
        }

        const commits: GitCommit[] = [];
        const lines = output.trim().split('\n');

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
    if (process.env.RD3_DAILY_SUMMARY_NO_PROMPT === '1') {
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

    // Get user annotations
    const annotations = await promptUser();

    const result: DailySummary = {
        date: options.date,
        platforms,
        commits,
        annotations,
        generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19),
    };

    if (tokenUsage !== undefined) {
        result.tokenUsage = tokenUsage;
    }
    if (gitActivity !== undefined) {
        result.gitActivity = gitActivity;
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
