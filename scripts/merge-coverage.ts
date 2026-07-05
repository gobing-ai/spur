#!/usr/bin/env bun
/**
 * Merge per-workspace lcov files into a single root-relative lcov.info.
 *
 * Bun 1.3.14's root `bun test` does not reliably emit a complete lcov across
 * workspaces. Each workspace generates its own `coverage/lcov.info` with paths
 * relative to that workspace. This script:
 *   1. Runs tests with coverage in each workspace (if lcov is stale or missing).
 *   2. Resolves every SF path to repo-root-relative.
 *   3. Deduplicates by taking the max hit count per line across workspaces.
 *   4. Writes `.coverage/lcov.info` for the coverage-gate rule to consume.
 *
 * Usage:
 *   bun run scripts/merge-coverage.ts          # generate + merge
 *   bun run scripts/merge-coverage.ts --merge   # merge only (skip test runs)
 */
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const WORKSPACES = [
    'apps/cli',
    'apps/server',
    'apps/web',
    'packages/app',
    'packages/domain',
    'packages/config',
    'packages/contracts',
];

const EXCLUDE_PATTERNS = [/^node_modules\//, /^\.\./, /\/tests\//, /tests\/helpers\.ts$/, /tests\/setup\.ts$/];

interface LineMap extends Map<number, number> {}

function shouldExclude(relPath: string): boolean {
    return EXCLUDE_PATTERNS.some((p) => p.test(relPath));
}

/** Determine which workspace owns a repo-root-relative source path. */
function owningWorkspace(relPath: string): string | null {
    for (const ws of WORKSPACES) {
        if (relPath.startsWith(ws + '/')) return ws;
    }
    return null;
}


/** Locate a workspace's lcov: <ws>/coverage/lcov.info (always fresh-generated). */
async function findWorkspaceLcov(ws: string): Promise<string | null> {
    const primary = join(ws, 'coverage', 'lcov.info');
    try {
        await stat(primary);
        return primary;
    } catch {
        return null;
    }
}

/** Parse a single workspace lcov into root-relative SF -> line-count map entries. */
async function parseWorkspaceLcov(
    ws: string,
    rootFileMap: Map<string, LineMap>,
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
        if (daMatches.length === 0) continue;

        // Only accept records from the owning workspace to avoid
        // cross-workspace lcov pollution.
        const owner = owningWorkspace(relPath);
        if (owner !== null && owner !== ws) {
            skipped++;
            continue;
        }

        records++;
        if (!rootFileMap.has(relPath)) {
            rootFileMap.set(relPath, new Map() as LineMap);
        }
        const lineMap = rootFileMap.get(relPath)!;
        for (const [, line, count] of daMatches) {
            const ln = Number(line);
            const ct = Number(count);
            lineMap.set(ln, Math.max(lineMap.get(ln) ?? 0, ct));
        }
    }

    return { records, skipped };
}

/** Write the merged file map as a valid lcov.info tracefile. */
function writeMergedLcov(fileMap: Map<string, LineMap>): string {
    const sortedPaths = [...fileMap.keys()].sort();
    const chunks: string[] = [];

    for (const sf of sortedPaths) {
        const lineMap = fileMap.get(sf)!;
        const entries = [...lineMap.entries()].sort((a, b) => a[0] - b[0]);
        const total = entries.length;
        const hit = entries.filter(([, c]) => c > 0).length;

        chunks.push(`SF:${sf}`, `LF:${total}`, `LH:${hit}`);
        for (const [line, count] of entries) {
            chunks.push(`DA:${line},${count}`);
        }
        chunks.push('end_of_record');
    }

    return chunks.join('\n') + '\n';
}

/** Run workspace tests with coverage if lcov is missing or stale. */
async function ensureWorkspaceLcov(ws: string, force: boolean): Promise<boolean> {
    const lcovPath = join(ws, 'coverage', 'lcov.info');

    if (!force) {
        try {
            const st = await stat(lcovPath);
            // Stale if older than 1 hour.
            if (Date.now() - st.mtimeMs < 3_600_000) return true;
        } catch {
            // Missing — need to generate.
        }
    }

    const proc = Bun.spawn(
        ['bun', 'test', '--coverage', '--coverage-reporter=lcov', '--coverage-dir=coverage', '--coverage-threshold=0'],
        { cwd: ws, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, NODE_ENV: 'test' } },
    );
    await proc.exited;
    try {
        await stat(lcovPath);
        return true;
    } catch {
        return false;
    }
}

async function main(): Promise<void> {
    const mergeOnly = process.argv.includes('--merge');
    const outputDir = '.coverage';
    await mkdir(outputDir, { recursive: true });

    if (!mergeOnly) {
        for (const ws of WORKSPACES) {
            process.stderr.write(`Generating coverage for ${ws}…\n`);
            await ensureWorkspaceLcov(ws, true);
        }
    }

    const rootFileMap = new Map<string, LineMap>();
    let totalRecords = 0;
    let totalSkipped = 0;

    for (const ws of WORKSPACES) {
        const { records, skipped } = await parseWorkspaceLcov(ws, rootFileMap);
        totalRecords += records;
        totalSkipped += skipped;
    }

    const merged = writeMergedLcov(rootFileMap);
    await writeFile(join(outputDir, 'lcov.info'), merged);

    // Report summary
    let failing = 0;
    let passing = 0;
    for (const [sf, lineMap] of rootFileMap) {
        const entries = [...lineMap.values()];
        if (entries.length === 0) continue;
        const hit = entries.filter((c) => c > 0).length;
        const pct = Math.round((hit / entries.length) * 100);
        if (pct < 90) {
            failing++;
            process.stderr.write(`  ${pct.toString().padStart(3)}%  ${sf}\n`);
        } else {
            passing++;
        }
    }

    process.stderr.write(
        `\nMerged ${totalRecords} records (${totalSkipped} skipped) into ${rootFileMap.size} files.\n` +
            `Coverage: ${passing} passing, ${failing} below 90% threshold.\n` +
            `Output: ${join(outputDir, 'lcov.info')}\n`,
    );

    // Clean up workspace-local coverage dirs.
    for (const ws of WORKSPACES) {
        await rm(join(ws, 'coverage'), { recursive: true, force: true });
    }
}

await main();
