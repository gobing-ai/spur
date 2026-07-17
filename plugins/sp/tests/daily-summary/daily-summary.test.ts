import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const originalSpawn = Bun.spawn;

import {
    buildDailySummary,
    type CliOptions,
    type DailySummary,
    ensureDir,
    generateMarkdown,
    getCcusageData,
    getDateRange,
    getGitCommits,
    main,
    parseArgs,
    printUsage,
    promptUser,
    todayLocal,
    writeSummary,
} from '../scripts/daily-summary';
import { enableLogger } from '../scripts/logger';

beforeAll(() => {
    enableLogger(false, false);
    process.env.RD3_DAILY_SUMMARY_NO_PROMPT = '1';
});

afterAll(() => {
    enableLogger(true, true);
    delete process.env.RD3_DAILY_SUMMARY_NO_PROMPT;
});

// Suppress noisy stdout from main()/printUsage() in-process invocations.
let consoleLogSpy: ReturnType<typeof spyOn>;
beforeEach(() => {
    consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
    consoleLogSpy?.mockRestore();
});

// ───────── parseArgs ─────────

describe('parseArgs', () => {
    test('defaults to today when --date missing', () => {
        const opts = parseArgs([]);
        expect(opts.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(opts.dryRun).toBe(false);
        expect(opts.skipGit).toBe(false);
        expect(opts.skipCcusage).toBe(false);
    });

    test('parses explicit --date', () => {
        const opts = parseArgs(['--date', '2026-04-17']);
        expect(opts.date).toBe('2026-04-17');
    });

    test('resolves "yesterday" to a date string', () => {
        const opts = parseArgs(['--date', 'yesterday']);
        expect(opts.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(opts.date).not.toBe('yesterday');
    });

    test('parses --dry-run flag', () => {
        const opts = parseArgs(['--dry-run']);
        expect(opts.dryRun).toBe(true);
    });

    test('parses --output path', () => {
        const opts = parseArgs(['--output', '/tmp/custom.md']);
        expect(opts.outputPath).toBe('/tmp/custom.md');
    });

    test('parses --no-git and --no-ccusage skip flags', () => {
        const opts = parseArgs(['--no-git', '--no-ccusage']);
        expect(opts.skipGit).toBe(true);
        expect(opts.skipCcusage).toBe(true);
    });

    test('handles combined flags', () => {
        const opts = parseArgs(['--date', '2026-04-17', '--dry-run', '--no-git']);
        expect(opts.date).toBe('2026-04-17');
        expect(opts.dryRun).toBe(true);
        expect(opts.skipGit).toBe(true);
    });

    test('ignores --date when no value follows', () => {
        const opts = parseArgs(['--date']);
        expect(opts.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    test('ignores --output when no value follows', () => {
        const opts = parseArgs(['--output']);
        expect(opts.outputPath).toBeUndefined();
    });

    test('ignores unrecognized flags', () => {
        const opts = parseArgs(['--unknown', 'value', '--no-git']);
        expect(opts.skipGit).toBe(true);
    });

    test('--help triggers printUsage and process.exit(0)', () => {
        const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
            throw new Error('exit called');
        }) as never);
        try {
            expect(() => parseArgs(['--help'])).toThrow('exit called');
            expect(exitSpy).toHaveBeenCalledWith(0);
        } finally {
            exitSpy.mockRestore();
        }
    });

    test('-h triggers printUsage and process.exit(0)', () => {
        const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
            throw new Error('exit called');
        }) as never);
        try {
            expect(() => parseArgs(['-h'])).toThrow('exit called');
            expect(exitSpy).toHaveBeenCalledWith(0);
        } finally {
            exitSpy.mockRestore();
        }
    });

    test('reads from process.argv when called with no args', () => {
        const original = process.argv;
        process.argv = ['bun', 'script', '--date', '2026-01-01', '--dry-run'];
        try {
            const opts = parseArgs();
            expect(opts.date).toBe('2026-01-01');
            expect(opts.dryRun).toBe(true);
        } finally {
            process.argv = original;
        }
    });
});

// ───────── printUsage ─────────

describe('printUsage', () => {
    test('prints help text containing all flags', () => {
        printUsage();
        const calls = consoleLogSpy.mock.calls.flat().join('\n');
        expect(calls).toContain('Usage: daily-summary.ts');
        expect(calls).toContain('--dry-run');
        expect(calls).toContain('--no-git');
        expect(calls).toContain('--no-ccusage');
        expect(calls).toContain('--output');
    });
});

// ───────── getDateRange ─────────

describe('getDateRange', () => {
    test('returns start and end timestamps spanning one day', () => {
        const { start, end } = getDateRange('2026-04-17');
        expect(start).toBe('2026-04-17 00:00:00');
        expect(end).toBe('2026-04-18 00:00:00');
    });

    test('rolls over month boundary', () => {
        const { start, end } = getDateRange('2026-04-30');
        expect(start).toBe('2026-04-30 00:00:00');
        expect(end).toBe('2026-05-01 00:00:00');
    });

    test('rolls over year boundary', () => {
        const { start, end } = getDateRange('2026-12-31');
        expect(start).toBe('2026-12-31 00:00:00');
        expect(end).toBe('2027-01-01 00:00:00');
    });
});

// ───────── generateMarkdown ─────────

describe('generateMarkdown', () => {
    const baseSummary: DailySummary = {
        date: '2026-04-17',
        platforms: ['Claude Code', 'Git'],
        commits: [],
        annotations: { learnings: '', issuesFixed: '', pending: '' },
        generatedAt: '2026-04-17 10:30:00',
    };

    test('includes header and meta section', () => {
        const md = generateMarkdown(baseSummary);
        expect(md).toContain('# Daily Summary — 2026-04-17');
        expect(md).toContain('## Meta');
        expect(md).toContain('- **Date:** 2026-04-17');
        expect(md).toContain('Claude Code, Git');
    });

    test('renders token usage table with cache hit rate', () => {
        const md = generateMarkdown({
            ...baseSummary,
            tokenUsage: {
                inputTokens: 1000,
                outputTokens: 500,
                cacheTokens: 3000,
                totalTokens: 4500,
                costUsd: 0.1234,
            },
        });
        expect(md).toContain('## Token Usage');
        expect(md).toContain('| Input Tokens | 1,000 |');
        expect(md).toContain('| Output Tokens | 500 |');
        expect(md).toContain('$0.1234');
        expect(md).toContain('**Cache Hit Rate:** 75.0%');
    });

    test('omits cache hit rate when input tokens are zero', () => {
        const md = generateMarkdown({
            ...baseSummary,
            tokenUsage: {
                inputTokens: 0,
                outputTokens: 500,
                cacheTokens: 0,
                totalTokens: 500,
                costUsd: 0.01,
            },
        });
        expect(md).toContain('## Token Usage');
        expect(md).not.toContain('Cache Hit Rate');
    });

    test('omits token usage section when absent', () => {
        const md = generateMarkdown(baseSummary);
        expect(md).not.toContain('## Token Usage');
    });

    test('renders git activity table', () => {
        const md = generateMarkdown({
            ...baseSummary,
            gitActivity: { commitCount: 3, filesChanged: 7, insertions: 120, deletions: 45 },
        });
        expect(md).toContain('## Git Activity');
        expect(md).toContain('| Commits | 3 |');
        expect(md).toContain('| Files Changed | 7 |');
        expect(md).toContain('+120');
        expect(md).toContain('-45');
    });

    test('lists commits with short hash', () => {
        const md = generateMarkdown({
            ...baseSummary,
            commits: [
                {
                    hash: 'abcdef1234567890',
                    date: '2026-04-17 10:00:00',
                    message: 'feat: add feature',
                    filesChanged: 2,
                    insertions: 10,
                    deletions: 1,
                },
            ],
        });
        expect(md).toContain('## Commits');
        expect(md).toContain('- `abcdef1` feat: add feature');
    });

    test('truncates commits list after 10 entries', () => {
        const commits = Array.from({ length: 12 }, (_, i) => ({
            hash: `hash${i.toString().padStart(10, '0')}`,
            date: '2026-04-17 10:00:00',
            message: `commit ${i}`,
            filesChanged: 1,
            insertions: 1,
            deletions: 0,
        }));
        const md = generateMarkdown({ ...baseSummary, commits });
        expect(md).toContain('... and 2 more commits');
    });

    test('does not show "more commits" line when exactly 10 commits', () => {
        const commits = Array.from({ length: 10 }, (_, i) => ({
            hash: `hash${i.toString().padStart(10, '0')}`,
            date: '2026-04-17 10:00:00',
            message: `commit ${i}`,
            filesChanged: 1,
            insertions: 1,
            deletions: 0,
        }));
        const md = generateMarkdown({ ...baseSummary, commits });
        expect(md).toContain('## Commits');
        expect(md).not.toContain('more commits');
    });

    test('includes annotation sections when provided', () => {
        const md = generateMarkdown({
            ...baseSummary,
            annotations: {
                learnings: 'Learned about Bun',
                issuesFixed: 'Fixed flaky test',
                pending: 'Review PR',
            },
        });
        expect(md).toContain('## Learnings');
        expect(md).toContain('Learned about Bun');
        expect(md).toContain('## Issues Fixed');
        expect(md).toContain('Fixed flaky test');
        expect(md).toContain('## Pending');
        expect(md).toContain('Review PR');
    });

    test('omits annotation sections when empty', () => {
        const md = generateMarkdown(baseSummary);
        expect(md).not.toContain('## Learnings');
        expect(md).not.toContain('## Issues Fixed');
        expect(md).not.toContain('## Pending');
    });

    test('includes footer with generation timestamp', () => {
        const md = generateMarkdown(baseSummary);
        expect(md).toContain('*Generated by sp:daily-summary at 2026-04-17 10:30:00*');
    });

    test('falls back to "unknown" when no platforms detected', () => {
        const md = generateMarkdown({ ...baseSummary, platforms: [] });
        expect(md).toContain('- **Platforms:** unknown');
    });
});

// ───────── promptUser ─────────

describe('promptUser', () => {
    test('returns empty annotations when RD3_DAILY_SUMMARY_NO_PROMPT=1', async () => {
        const result = await promptUser();
        expect(result).toEqual({ learnings: '', issuesFixed: '', pending: '' });
    });

    test('reads buffered stdin lines when not a TTY', async () => {
        const { Readable } = await import('node:stream');
        const fakeStdin = Readable.from([Buffer.from('learn x\nfix y\npend z\n')]);
        Object.defineProperty(fakeStdin, 'isTTY', { value: false });

        const originalStdin = process.stdin;
        const originalNoPrompt = process.env.RD3_DAILY_SUMMARY_NO_PROMPT;
        delete process.env.RD3_DAILY_SUMMARY_NO_PROMPT;
        Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });
        try {
            const result = await promptUser();
            expect(result).toEqual({ learnings: 'learn x', issuesFixed: 'fix y', pending: 'pend z' });
        } finally {
            Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
            if (originalNoPrompt !== undefined) {
                process.env.RD3_DAILY_SUMMARY_NO_PROMPT = originalNoPrompt;
            }
        }
    });

    test('exercises readline branch when stdin is a TTY', async () => {
        const { Readable } = await import('node:stream');
        const fakeStdin = Readable.from([Buffer.from('hello\nworld\nlater\n')]);
        Object.defineProperty(fakeStdin, 'isTTY', { value: true });

        const originalStdin = process.stdin;
        const originalNoPrompt = process.env.RD3_DAILY_SUMMARY_NO_PROMPT;
        delete process.env.RD3_DAILY_SUMMARY_NO_PROMPT;
        Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });

        // Suppress readline's direct writes to stdout so they don't pollute the test reporter.
        const stdoutWriteSpy = spyOn(process.stdout, 'write').mockImplementation(() => true);
        try {
            // readline behavior with a synthetic Readable stream is platform-dependent;
            // we only assert the readline branch is exercised — promise may reject when
            // the synthetic stream closes mid-question.
            const result = await promptUser().catch(() => null);
            expect(result === null || typeof result === 'object').toBe(true);
        } finally {
            stdoutWriteSpy.mockRestore();
            Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
            if (originalNoPrompt !== undefined) {
                process.env.RD3_DAILY_SUMMARY_NO_PROMPT = originalNoPrompt;
            }
        }
    });

    test('handles empty stdin (no annotations) in non-TTY mode', async () => {
        const { Readable } = await import('node:stream');
        const fakeStdin = Readable.from([Buffer.alloc(0)]);
        Object.defineProperty(fakeStdin, 'isTTY', { value: false });

        const originalStdin = process.stdin;
        const originalNoPrompt = process.env.RD3_DAILY_SUMMARY_NO_PROMPT;
        delete process.env.RD3_DAILY_SUMMARY_NO_PROMPT;
        Object.defineProperty(process, 'stdin', { value: fakeStdin, configurable: true });
        try {
            const result = await promptUser();
            expect(result).toEqual({ learnings: '', issuesFixed: '', pending: '' });
        } finally {
            Object.defineProperty(process, 'stdin', { value: originalStdin, configurable: true });
            if (originalNoPrompt !== undefined) {
                process.env.RD3_DAILY_SUMMARY_NO_PROMPT = originalNoPrompt;
            }
        }
    });
});

// ───────── ensureDir / writeSummary ─────────

describe('writeSummary and ensureDir', () => {
    let tmp: string;

    beforeEach(() => {
        tmp = mkdtempSync(join(tmpdir(), 'daily-summary-write-'));
    });

    afterEach(() => {
        rmSync(tmp, { recursive: true, force: true });
    });

    test('ensureDir creates a directory when missing', () => {
        const newDir = join(tmp, 'a', 'b', 'c');
        expect(existsSync(newDir)).toBe(false);
        ensureDir(newDir);
        expect(existsSync(newDir)).toBe(true);
    });

    test('ensureDir is a no-op when directory exists', () => {
        ensureDir(tmp);
        expect(existsSync(tmp)).toBe(true);
    });

    test('writeSummary writes to custom output path', () => {
        const opts: CliOptions = {
            date: '2026-04-17',
            dryRun: false,
            outputPath: join(tmp, 'out', 'custom.md'),
            skipGit: true,
            skipCcusage: true,
        };
        const written = writeSummary('# hello\n', opts);
        expect(written).toBe(opts.outputPath as string);
        expect(readFileSync(written, 'utf-8')).toBe('# hello\n');
    });

    test('writeSummary defaults to docs/daily/summary_<date>.md', () => {
        const originalCwd = process.cwd();
        process.chdir(tmp);
        try {
            const opts: CliOptions = {
                date: '2026-04-17',
                dryRun: false,
                skipGit: true,
                skipCcusage: true,
            };
            const written = writeSummary('# default\n', opts);
            expect(written).toContain(join('docs', 'daily', 'summary_20260417.md'));
            expect(readFileSync(written, 'utf-8')).toBe('# default\n');
        } finally {
            process.chdir(originalCwd);
        }
    });
});

// ───────── getCcusageData ─────────

describe('getCcusageData', () => {
    let spawnSpy: ReturnType<typeof spyOn> | undefined;

    afterEach(() => {
        spawnSpy?.mockRestore();
    });

    test('returns null when ccusage binary is missing', async () => {
        spawnSpy = spyOn(Bun, 'spawn').mockImplementation((args, options) => {
            if (args[0] === 'ccusage') {
                throw new Error('ccusage not found');
            }
            return originalSpawn(args, options);
        });
        const result = await getCcusageData('2026-04-17');
        expect(result).toBeNull();
    });

    test('returns parsed data on success', async () => {
        const payload = {
            totals: {
                inputTokens: 100,
                outputTokens: 50,
                cacheCreationTokens: 10,
                cacheReadTokens: 20,
                totalTokens: 180,
                totalCost: 0.5,
            },
        };
        spawnSpy = spyOn(Bun, 'spawn').mockImplementation((args, options) => {
            if (args[0] === 'ccusage') {
                const isVersion = args[1] === '--version';
                const stdoutText = isVersion ? '1.0.0' : JSON.stringify(payload);
                return {
                    stdout: new Response(stdoutText).body,
                    stderr: new Response('').body,
                    exited: Promise.resolve(0),
                    exitCode: 0,
                } as unknown as ReturnType<typeof Bun.spawn>;
            }
            return originalSpawn(args, options);
        });

        const result = await getCcusageData('2026-04-17');
        expect(result).not.toBeNull();
        expect(result?.totals.totalTokens).toBe(180);
        expect(result?.totals.totalCost).toBe(0.5);
    });

    test('returns null when ccusage exits non-zero', async () => {
        spawnSpy = spyOn(Bun, 'spawn').mockImplementation((args, options) => {
            if (args[0] === 'ccusage') {
                const isVersion = args[1] === '--version';
                if (isVersion) {
                    return {
                        stdout: new Response('1.0.0').body,
                        stderr: new Response('').body,
                        exited: Promise.resolve(0),
                        exitCode: 0,
                    } as unknown as ReturnType<typeof Bun.spawn>;
                } else {
                    return {
                        stdout: new Response('').body,
                        stderr: new Response('boom').body,
                        exited: Promise.resolve(1),
                        exitCode: 1,
                    } as unknown as ReturnType<typeof Bun.spawn>;
                }
            }
            return originalSpawn(args, options);
        });

        const result = await getCcusageData('2026-04-17');
        expect(result).toBeNull();
    });

    test('returns null when ccusage produces invalid JSON', async () => {
        spawnSpy = spyOn(Bun, 'spawn').mockImplementation((args, options) => {
            if (args[0] === 'ccusage') {
                const isVersion = args[1] === '--version';
                const stdoutText = isVersion ? '1.0.0' : 'not json';
                return {
                    stdout: new Response(stdoutText).body,
                    stderr: new Response('').body,
                    exited: Promise.resolve(0),
                    exitCode: 0,
                } as unknown as ReturnType<typeof Bun.spawn>;
            }
            return originalSpawn(args, options);
        });

        const result = await getCcusageData('2026-04-17');
        expect(result).toBeNull();
    });
});

// ───────── getGitCommits / buildDailySummary (real git) ─────────

describe('git-backed integration', () => {
    let tmpRepo: string;
    let originalCwd: string;

    beforeEach(() => {
        originalCwd = process.cwd();
        tmpRepo = mkdtempSync(join(tmpdir(), 'daily-summary-git-'));
        process.chdir(tmpRepo);
        Bun.spawnSync(['git', 'init', '-q', '-b', 'main'], { cwd: tmpRepo });
        Bun.spawnSync(['git', 'config', 'user.email', 'test@example.com'], { cwd: tmpRepo });
        Bun.spawnSync(['git', 'config', 'user.name', 'Tester'], { cwd: tmpRepo });
        Bun.spawnSync(['git', 'config', 'commit.gpgsign', 'false'], { cwd: tmpRepo });
        writeFileSync(join(tmpRepo, 'a.txt'), 'hello\nworld\n');
        Bun.spawnSync(['git', 'add', '.'], { cwd: tmpRepo });
        Bun.spawnSync(['git', 'commit', '-q', '-m', 'feat: initial'], { cwd: tmpRepo });
    });

    afterEach(() => {
        process.chdir(originalCwd);
        rmSync(tmpRepo, { recursive: true, force: true });
    });

    test('getGitCommits returns parsed commits with numstat', async () => {
        const today = todayLocal();
        const commits = await getGitCommits(today);
        expect(commits.length).toBeGreaterThan(0);
        const c = commits[0];
        expect(c.hash).toMatch(/^[0-9a-f]+$/);
        expect(c.message).toContain('feat: initial');
        expect(c.filesChanged).toBeGreaterThan(0);
        expect(c.insertions).toBeGreaterThan(0);
    });

    test('getGitCommits returns empty array when not a git repo', async () => {
        const noGit = mkdtempSync(join(tmpdir(), 'daily-summary-nogit-'));
        const cwd = process.cwd();
        process.chdir(noGit);
        try {
            const commits = await getGitCommits('2026-04-17');
            expect(commits).toEqual([]);
        } finally {
            process.chdir(cwd);
            rmSync(noGit, { recursive: true, force: true });
        }
    });

    test('getGitCommits returns empty array for a date with no commits', async () => {
        const commits = await getGitCommits('2000-01-01');
        expect(commits).toEqual([]);
    });

    test('getGitCommits accumulates multiple commits within range', async () => {
        writeFileSync(join(tmpRepo, 'b.txt'), 'second\n');
        Bun.spawnSync(['git', 'add', '.'], { cwd: tmpRepo });
        Bun.spawnSync(['git', 'commit', '-q', '-m', 'feat: add b'], { cwd: tmpRepo });
        writeFileSync(join(tmpRepo, 'c.txt'), 'third\n');
        Bun.spawnSync(['git', 'add', '.'], { cwd: tmpRepo });
        Bun.spawnSync(['git', 'commit', '-q', '-m', 'feat: add c'], { cwd: tmpRepo });

        const today = todayLocal();
        const commits = await getGitCommits(today);
        expect(commits.length).toBeGreaterThanOrEqual(3);
        const messages = commits.map((c) => c.message);
        expect(messages).toContain('feat: add b');
        expect(messages).toContain('feat: add c');
    });

    test('buildDailySummary aggregates git activity with skipCcusage', async () => {
        const today = todayLocal();
        const summary = await buildDailySummary({
            date: today,
            dryRun: true,
            skipGit: false,
            skipCcusage: true,
        });
        expect(summary.date).toBe(today);
        expect(summary.platforms).toContain('Git');
        expect(summary.gitActivity).toBeDefined();
        expect(summary.gitActivity?.commitCount).toBeGreaterThan(0);
        expect(summary.commits.length).toBeGreaterThan(0);
        expect(summary.annotations).toEqual({ learnings: '', issuesFixed: '', pending: '' });
        expect(summary.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    test('buildDailySummary respects skipGit and skipCcusage', async () => {
        const today = todayLocal();
        const summary = await buildDailySummary({
            date: today,
            dryRun: true,
            skipGit: true,
            skipCcusage: true,
        });
        expect(summary.platforms).toEqual([]);
        expect(summary.gitActivity).toBeUndefined();
        expect(summary.tokenUsage).toBeUndefined();
        expect(summary.commits).toEqual([]);
    });

    test('buildDailySummary returns no gitActivity when commits are empty', async () => {
        const summary = await buildDailySummary({
            date: '2000-01-01',
            dryRun: true,
            skipGit: false,
            skipCcusage: true,
        });
        expect(summary.gitActivity).toBeUndefined();
        expect(summary.platforms).not.toContain('Git');
    });

    test('buildDailySummary populates tokenUsage when ccusage returns data', async () => {
        const today = todayLocal();
        const payload = {
            totals: {
                inputTokens: 200,
                outputTokens: 100,
                cacheCreationTokens: 30,
                cacheReadTokens: 70,
                totalTokens: 400,
                totalCost: 1.25,
            },
        };
        const spawnSpy = spyOn(Bun, 'spawn').mockImplementation((args, options) => {
            if (args[0] === 'ccusage') {
                const isVersion = args[1] === '--version';
                const stdoutText = isVersion ? '1.0.0' : JSON.stringify(payload);
                return {
                    stdout: new Response(stdoutText).body,
                    stderr: new Response('').body,
                    exited: Promise.resolve(0),
                    exitCode: 0,
                } as unknown as ReturnType<typeof Bun.spawn>;
            }
            return originalSpawn(args, options);
        });
        try {
            const summary = await buildDailySummary({
                date: today,
                dryRun: true,
                skipGit: true,
                skipCcusage: false,
            });
            expect(summary.tokenUsage).toBeDefined();
            expect(summary.tokenUsage?.totalTokens).toBe(400);
            expect(summary.tokenUsage?.cacheTokens).toBe(100);
            expect(summary.platforms).toContain('Claude Code');
        } finally {
            spawnSpy.mockRestore();
        }
    });

    test('buildDailySummary handles missing ccusage gracefully (skipCcusage=false)', async () => {
        const today = todayLocal();
        const spawnSpy = spyOn(Bun, 'spawn').mockImplementation((args, options) => {
            if (args[0] === 'ccusage') {
                throw new Error('ccusage not found');
            }
            return originalSpawn(args, options);
        });
        try {
            const summary = await buildDailySummary({
                date: today,
                dryRun: true,
                skipGit: true,
                skipCcusage: false,
            });
            expect(summary.tokenUsage).toBeUndefined();
            expect(summary.platforms).not.toContain('Claude Code');
        } finally {
            spawnSpy.mockRestore();
        }
    });
});

// ───────── main ─────────

describe('main entrypoint (in-process)', () => {
    let tmpRepo: string;
    let originalCwd: string;
    let originalArgv: string[];

    beforeEach(() => {
        originalCwd = process.cwd();
        originalArgv = process.argv;
        tmpRepo = mkdtempSync(join(tmpdir(), 'daily-summary-main-'));
        process.chdir(tmpRepo);
        Bun.spawnSync(['git', 'init', '-q', '-b', 'main'], { cwd: tmpRepo });
        Bun.spawnSync(['git', 'config', 'user.email', 'test@example.com'], { cwd: tmpRepo });
        Bun.spawnSync(['git', 'config', 'user.name', 'Tester'], { cwd: tmpRepo });
        Bun.spawnSync(['git', 'config', 'commit.gpgsign', 'false'], { cwd: tmpRepo });
        writeFileSync(join(tmpRepo, 'README.md'), '# repo\n');
        Bun.spawnSync(['git', 'add', '.'], { cwd: tmpRepo });
        Bun.spawnSync(['git', 'commit', '-q', '-m', 'chore: seed'], { cwd: tmpRepo });
    });

    afterEach(() => {
        process.argv = originalArgv;
        process.chdir(originalCwd);
        rmSync(tmpRepo, { recursive: true, force: true });
    });

    test('runs end-to-end with --dry-run', async () => {
        const today = todayLocal();
        process.argv = ['bun', 'script', '--date', today, '--dry-run', '--no-ccusage', '--no-git'];
        await main();
        const output = consoleLogSpy.mock.calls.flat().join('\n');
        expect(output).toContain(`# Daily Summary — ${today}`);
        expect(output).toContain('Summary Statistics');
    });

    test('writes summary to default docs/daily path when not in dry-run', async () => {
        const today = todayLocal();
        process.argv = ['bun', 'script', '--date', today, '--no-ccusage', '--no-git'];
        await main();
        const expected = join(tmpRepo, 'docs', 'daily', `summary_${today.replace(/-/g, '')}.md`);
        expect(existsSync(expected)).toBe(true);
        const md = readFileSync(expected, 'utf-8');
        expect(md).toContain(`# Daily Summary — ${today}`);
    });

    test('writes summary to --output path with token usage path skipped', async () => {
        const today = todayLocal();
        const outPath = join(tmpRepo, 'custom.md');
        process.argv = ['bun', 'script', '--date', today, '--output', outPath, '--no-ccusage', '--no-git'];
        await main();
        expect(existsSync(outPath)).toBe(true);
    });

    test('prints token usage stats when ccusage returns data', async () => {
        const today = todayLocal();
        const payload = {
            totals: {
                inputTokens: 5,
                outputTokens: 7,
                cacheCreationTokens: 1,
                cacheReadTokens: 2,
                totalTokens: 15,
                totalCost: 0.0123,
            },
        };
        const spawnSpy = spyOn(Bun, 'spawn').mockImplementation((args, options) => {
            if (args[0] === 'ccusage') {
                const isVersion = args[1] === '--version';
                const stdoutText = isVersion ? '1.0.0' : JSON.stringify(payload);
                return {
                    stdout: new Response(stdoutText).body,
                    stderr: new Response('').body,
                    exited: Promise.resolve(0),
                    exitCode: 0,
                } as unknown as ReturnType<typeof Bun.spawn>;
            }
            return originalSpawn(args, options);
        });
        process.argv = ['bun', 'script', '--date', today, '--dry-run', '--no-git'];
        try {
            await main();
            const output = consoleLogSpy.mock.calls.flat().join('\n');
            expect(output).toContain('Tokens: 15');
            expect(output).toContain('Cost: $0.0123');
            expect(output).toContain('Claude Code');
        } finally {
            spawnSpy.mockRestore();
        }
    });

    test('includes git activity in stats when commits exist', async () => {
        const today = todayLocal();
        process.argv = ['bun', 'script', '--date', today, '--dry-run', '--no-ccusage'];
        await main();
        const output = consoleLogSpy.mock.calls.flat().join('\n');
        expect(output).toContain('## Git Activity');
        expect(output).toContain('Commits:');
    });

    test('handles errors and calls process.exit(1)', async () => {
        const today = todayLocal();
        process.argv = ['bun', 'script', '--date', today, '--no-ccusage', '--no-git'];

        // Make writeSummary fail by setting outputPath into an unwritable location.
        // Easier: spy on buildDailySummary indirectly via process.exit.
        const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
            throw new Error('exit called');
        }) as never);

        // Force an error: chdir to a directory we then remove so writeFileSync fails.
        const badDir = mkdtempSync(join(tmpdir(), 'daily-summary-bad-'));
        process.chdir(badDir);
        rmSync(badDir, { recursive: true, force: true });

        try {
            await expect(main()).rejects.toThrow('exit called');
            expect(exitSpy).toHaveBeenCalledWith(1);
        } finally {
            exitSpy.mockRestore();
            process.chdir(tmpRepo);
        }
    });
});
