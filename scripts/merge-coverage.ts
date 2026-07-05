#!/usr/bin/env bun
/**
 * Run workspace tests, merge Bun LCOV into a root-relative artifact, and enforce
 * per-file line/function coverage. Bun 1.3.14's root coverage output is not
 * reliable across workspaces, so each workspace writes its own LCOV first.
 */
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const LINE_COVERAGE_THRESHOLD = 90;
const FUNCTION_COVERAGE_THRESHOLD = 80;
const COVERAGE_REPORT_PATH = join('.coverage', 'file-coverage.tsv');
const WORKSPACES = [
    'apps/cli',
    'apps/server',
    'apps/web',
    'packages/app',
    'packages/domain',
    'packages/config',
    'packages/contracts',
];
const PLUGIN_TEST_TARGETS = ['plugins/sp'];

const EXCLUDE_PATTERNS = [
    /^node_modules\//,
    /^\.\./,
    /\/node_modules\//,
    /\/vendors\//,
    /\/dist\//,
    /\/tests\//,
    /\/stubs\//,
    /tests\/helpers\.ts$/,
    /tests\/setup\.ts$/,
    /^apps\/server\/src\/index\.ts$/,
    /^packages\/domain\/src\/schema\//,
    /^packages\/domain\/src\/migrations\.ts$/,
    /^packages\/domain\/src\/db\.ts$/,
];

interface CoverageRecord {
    lines: Map<number, number>;
    functionsFound: number;
    functionsHit: number;
}

interface CoverageSummary {
    path: string;
    linePct: number;
    functionPct: number;
    linesHit: number;
    linesFound: number;
    functionsHit: number;
    functionsFound: number;
    status: 'pass' | 'fail';
}

function shouldExclude(relPath: string): boolean {
    return EXCLUDE_PATTERNS.some((p) => p.test(relPath));
}

/** Determine which workspace owns a repo-root-relative source path. */
function owningWorkspace(relPath: string): string | null {
    for (const ws of WORKSPACES) {
        if (relPath.startsWith(`${ws}/`)) return ws;
    }
    return null;
}

async function findWorkspaceLcov(ws: string): Promise<string | null> {
    const primary = join(ws, 'coverage', 'lcov.info');
    try {
        await stat(primary);
        return primary;
    } catch {
        return null;
    }
}

async function parseWorkspaceLcov(
    ws: string,
    coverageByFile: Map<string, CoverageRecord>,
): Promise<{ records: number; skipped: number }> {
    const lcovPath = await findWorkspaceLcov(ws);
    if (!lcovPath) return { records: 0, skipped: 0 };

    let content: string;
    try {
        content = await readFile(lcovPath, 'utf-8');
    } catch {
        return { records: 0, skipped: 0 };
    }

    let records = 0;
    let skipped = 0;

    for (const rec of content.split('end_of_record')) {
        const sfMatch = rec.match(/^SF:(.+)$/m);
        if (!sfMatch) continue;

        const rawPath = sfMatch[1].trim();
        const absPath = resolve(join(ROOT, ws), rawPath);
        const relPath = relative(ROOT, absPath);

        if (shouldExclude(relPath)) {
            skipped++;
            continue;
        }

        const daMatches = [...rec.matchAll(/^DA:(\d+),(\d+)/gm)];
        const functionsFound = parseLcovCount(rec, 'FNF');
        const functionsHit = parseLcovCount(rec, 'FNH');
        if (daMatches.length === 0) continue;

        const owner = owningWorkspace(relPath);

        if (owner !== null && owner !== ws) {
            skipped++;
            continue;
        }

        records++;
        if (!coverageByFile.has(relPath)) {
            coverageByFile.set(relPath, { lines: new Map(), functionsFound: 0, functionsHit: 0 });
        }
        const fileCoverage = coverageByFile.get(relPath);
        if (!fileCoverage) continue;
        for (const [, line, count] of daMatches) {
            const ln = Number(line);
            const ct = Number(count);
            fileCoverage.lines.set(ln, Math.max(fileCoverage.lines.get(ln) ?? 0, ct));
        }
        fileCoverage.functionsFound = Math.max(fileCoverage.functionsFound, functionsFound);
        fileCoverage.functionsHit = Math.max(fileCoverage.functionsHit, functionsHit);
    }

    return { records, skipped };
}

function parseLcovCount(record: string, key: 'FNF' | 'FNH'): number {
    const match = record.match(new RegExp(`^${key}:(\\d+)$`, 'm'));
    return match ? Number(match[1]) : 0;
}

function percent(hit: number, found: number): number {
    if (found === 0) return 100;
    return Math.round((hit / found) * 100);
}

function writeMergedLcov(coverageByFile: Map<string, CoverageRecord>): string {
    const sortedPaths = [...coverageByFile.keys()].sort();
    const chunks: string[] = [];

    for (const sf of sortedPaths) {
        const fileCoverage = coverageByFile.get(sf);
        if (!fileCoverage) continue;
        const entries = [...fileCoverage.lines.entries()].sort((a, b) => a[0] - b[0]);
        const total = entries.length;
        const hit = entries.filter(([, c]) => c > 0).length;

        chunks.push(`SF:${sf}`, `FNF:${fileCoverage.functionsFound}`, `FNH:${fileCoverage.functionsHit}`);
        for (const [line, count] of entries) {
            chunks.push(`DA:${line},${count}`);
        }
        chunks.push(`LF:${total}`, `LH:${hit}`);
        chunks.push('end_of_record');
    }

    return `${chunks.join('\n')}\n`;
}

async function runCommand(label: string, command: string[], cwd: string): Promise<number> {
    process.stderr.write(`\n▶ ${label}\n`);
    const proc = Bun.spawn(command, {
        cwd,
        stdout: 'inherit',
        stderr: 'inherit',
        env: { ...process.env, NODE_ENV: 'test', SPUR_REPO_ROOT: ROOT },
    });
    return await proc.exited;
}

async function ensureWorkspaceLcov(ws: string, updateSnapshots = false, full = false): Promise<boolean> {
    const status = await runCommand(
        `Generating coverage for ${ws}`,
        [
            'bun',
            'test',
            '--coverage',
            '--coverage-reporter=lcov',
            '--coverage-dir=coverage',
            '--coverage-threshold=0',
            ...(full ? [] : ['--reporter=dots']),
            '--max-concurrency=1',
            ...(updateSnapshots ? ['--update-snapshots'] : []),
        ],
        ws,
    );
    const lcovPath = join(ws, 'coverage', 'lcov.info');
    const hasLcov = await fileExists(lcovPath);
    return status === 0 && hasLcov;
}

async function fileExists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

async function runPluginTests(updateSnapshots = false, full = false): Promise<boolean> {
    // Plugin coverage isn't merged into the gate, so we run plugin tests from `plugins/`
    // rather than ROOT. Bun only reads `bunfig.toml` from the cwd, so running from
    // `plugins/` skips the root config's `coverage = true` / `coverageReporter = ["text", "lcov"]`
    // and the noisy text coverage table never prints — matching the workspace run output.
    for (const target of PLUGIN_TEST_TARGETS) {
        const relativeTarget = target.replace(/^plugins\//, '');
        const status = await runCommand(
            `Running plugin tests for ${target}`,
            [
                'bun',
                'test',
                relativeTarget,
                ...(full ? ['--reporter=verbose'] : ['--reporter=dots']),
                ...(updateSnapshots ? ['--update-snapshots'] : []),
            ],
            join(ROOT, 'plugins'),
        );
        if (status !== 0) return false;
    }
    return true;
}

function coverageSummaries(coverageByFile: Map<string, CoverageRecord>): CoverageSummary[] {
    const summaries: CoverageSummary[] = [];

    for (const [path, fileCoverage] of coverageByFile) {
        const lineValues = [...fileCoverage.lines.values()];
        if (lineValues.length === 0) continue;

        const linesFound = lineValues.length;
        const linesHit = lineValues.filter((count) => count > 0).length;
        const linePct = percent(linesHit, linesFound);
        const functionPct = percent(fileCoverage.functionsHit, fileCoverage.functionsFound);
        const status = linePct < LINE_COVERAGE_THRESHOLD || functionPct < FUNCTION_COVERAGE_THRESHOLD ? 'fail' : 'pass';

        summaries.push({
            path,
            linePct,
            functionPct,
            linesHit,
            linesFound,
            functionsHit: fileCoverage.functionsHit,
            functionsFound: fileCoverage.functionsFound,
            status,
        });
    }

    summaries.sort((a, b) => a.path.localeCompare(b.path));
    return summaries;
}

async function writeCoverageReport(summaries: CoverageSummary[]): Promise<void> {
    const lines = ['status\tline_pct\tlines_hit\tlines_found\tfunction_pct\tfunctions_hit\tfunctions_found\tpath'];
    for (const summary of summaries) {
        lines.push(
            [
                summary.status,
                summary.linePct,
                summary.linesHit,
                summary.linesFound,
                summary.functionPct,
                summary.functionsHit,
                summary.functionsFound,
                summary.path,
            ].join('\t'),
        );
    }
    await writeFile(COVERAGE_REPORT_PATH, `${lines.join('\n')}\n`);
}

async function main(): Promise<void> {
    const updateSnapshots = process.argv.includes('--update-snapshots');
    const mergeOnly = process.argv.includes('--merge');
    const full = process.argv.includes('--full');
    const outputDir = '.coverage';
    await mkdir(outputDir, { recursive: true });
    let testsPassed = true;

    if (!mergeOnly) {
        for (const ws of WORKSPACES) {
            testsPassed = (await ensureWorkspaceLcov(ws, updateSnapshots, full)) && testsPassed;
        }
        testsPassed = (await runPluginTests(updateSnapshots, full)) && testsPassed;
        if (!testsPassed) {
            process.stderr.write(
                '\nTest gate failed. Coverage artifact will still be merged from available workspace LCOV.\n',
            );
        }
    }

    const coverageByFile = new Map<string, CoverageRecord>();
    let totalRecords = 0;
    let totalSkipped = 0;

    for (const ws of WORKSPACES) {
        const { records, skipped } = await parseWorkspaceLcov(ws, coverageByFile);
        totalRecords += records;
        totalSkipped += skipped;
    }

    if (totalRecords === 0 || coverageByFile.size === 0) {
        process.stderr.write('\nNo workspace LCOV records found; coverage was not generated.\n');
        process.exitCode = 1;
        return;
    }

    const merged = writeMergedLcov(coverageByFile);
    await writeFile(join(outputDir, 'lcov.info'), merged);

    const summaries = coverageSummaries(coverageByFile);
    await writeCoverageReport(summaries);
    const failures = summaries.filter((summary) => summary.status === 'fail');
    const passing = summaries.length - failures.length;
    if (failures.length > 0) {
        process.stderr.write('\nCoverage below threshold:\n');
        for (const failure of failures) {
            process.stderr.write(
                `  L ${failure.linePct.toString().padStart(3)}% (${failure.linesHit}/${failure.linesFound})` +
                    `  F ${failure.functionPct.toString().padStart(3)}% (${failure.functionsHit}/${failure.functionsFound})` +
                    `  ${failure.path}\n`,
            );
        }
    }

    process.stderr.write(
        `\nMerged ${totalRecords} records (${totalSkipped} skipped) into ${coverageByFile.size} files.\n` +
            `Coverage: ${passing} passing, ${failures.length} below ${LINE_COVERAGE_THRESHOLD}% line / ${FUNCTION_COVERAGE_THRESHOLD}% function threshold.\n` +
            `LCOV: ${join(outputDir, 'lcov.info')}\n` +
            `Report: ${COVERAGE_REPORT_PATH}\n`,
    );

    for (const ws of WORKSPACES) {
        await rm(join(ws, 'coverage'), { recursive: true, force: true });
    }
    await rm(join(outputDir, 'plugin-tmp'), { recursive: true, force: true });

    if (!testsPassed || failures.length > 0) {
        process.exitCode = 1;
    }
}

await main();
