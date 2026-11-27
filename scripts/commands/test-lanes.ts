#!/usr/bin/env bun
/**
 * test-lanes — generate and check `config/test-lanes.json` (feature H161, task 1459).
 *
 * The manifest is committed evidence, not a runtime guess: the launcher (`run-tests.ts`) reads the
 * subprocess-lane membership from it, and `repo-wide-tests/test-lanes-manifest.test.ts` runs this
 * command with `--check` so any classification drift fails by name in `spur-check-feature`.
 *
 * Classification lives in `packages/app/src/rules/test-lanes.ts` (pure, coverage-gated); this module
 * only enumerates the tree, parses the bunfig ignore list, merges recorded durations and writes the
 * file. Top-level keys other than `version`/`root` are preserved verbatim so the `heavy` section
 * (task 1461) survives a regeneration.
 *
 * Usage: bun scripts/spur-dev.ts test-lanes [--timings <junit.xml>] [--check]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, posix, resolve } from 'node:path';
import {
    classifyTestFiles,
    diffLaneManifest,
    type LaneEntry,
    type LaneManifest,
    parseJunitTimings,
    readLaneManifest,
    type TestSource,
} from '@gobing-ai/spur-app';

/** Repository root, resolved from this module's location. */
const REPO_ROOT = resolve(import.meta.dir, '..', '..');

/**
 * The root suite's path set — the same list `package.json`'s `test` script forwards. Laning keys on
 * it (task 1460), so the generator and the launcher must not drift.
 */
export const ROOT_PATH_SET = ['./apps/cli', './apps/server', './apps/web', './packages', './plugins', './scripts'];

/** Committed manifest path, repository-relative. */
export const LANE_MANIFEST_PATH = 'config/test-lanes.json';

/** Test-file pattern the suite collects; `.tsx` tests are out of the classifier's scope. */
const TEST_FILE_PATTERN = '**/*.test.ts';

/** Helper candidates: non-test `.ts` anywhere under a `tests/` directory. */
const HELPER_FILE_PATTERN = '**/tests/**/*.ts';

const USAGE = 'usage: bun scripts/spur-dev.ts test-lanes [--timings <junit.xml>] [--check]';

/** Parsed argv. */
interface LaneOptions {
    timings: string | undefined;
    check: boolean;
}

/**
 * Runs the `test-lanes` command.
 *
 * @param argv - Arguments after the command name.
 * @returns Process exit code (0 clean, 1 drift or failure).
 */
export async function runTestLanes(argv: string[]): Promise<number> {
    const options = parseArgs(argv);
    if (options === undefined) {
        console.error(USAGE);
        return 2;
    }
    try {
        const entries = withTimings(buildLaneEntries(REPO_ROOT), readTimings(options.timings));
        const manifestPath = join(REPO_ROOT, LANE_MANIFEST_PATH);
        if (options.check) return checkManifest(entries, manifestPath);

        const rendered = renderManifest(entries, readCommitted(manifestPath));
        writeFileSync(manifestPath, `${JSON.stringify(rendered, null, 4)}\n`);
        console.log(`test-lanes: ${entries.length} subprocess-lane file(s) → ${LANE_MANIFEST_PATH}`);
        return 0;
    } catch (error) {
        console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
        return 1;
    }
}

/**
 * Classifies the tree's root test files.
 *
 * @param repoRoot - Absolute repository root.
 * @returns Subprocess-lane entries, sorted by path, without durations.
 */
export function buildLaneEntries(repoRoot: string): LaneEntry[] {
    const ignorePatterns = readPathIgnorePatterns(repoRoot);
    return classifyTestFiles(
        collectSources(repoRoot, TEST_FILE_PATTERN, ignorePatterns, false),
        collectSources(repoRoot, HELPER_FILE_PATTERN, ignorePatterns, true),
    );
}

/**
 * Reads `pathIgnorePatterns` from the root `bunfig.toml`.
 *
 * A hand-rolled read beats a TOML dependency here: the value is a flat string array and Bun is the
 * only consumer, so an unparseable line must fail loudly rather than silently widen the scan.
 *
 * @param repoRoot - Absolute repository root.
 * @returns Glob patterns Bun excludes from collection.
 */
export function readPathIgnorePatterns(repoRoot: string): string[] {
    const bunfigPath = join(repoRoot, 'bunfig.toml');
    if (!existsSync(bunfigPath)) return [];
    const match = /^[ \t]*pathIgnorePatterns[ \t]*=[ \t]*\[([^\]]*)\]/m.exec(readFileSync(bunfigPath, 'utf8'));
    if (match === null) return [];
    return [...(match[1] ?? '').matchAll(/"([^"]*)"/g)].map((entry) => entry[1] ?? '').filter((entry) => entry !== '');
}

/**
 * Renders the manifest, preserving every top-level key except `version` and `root`.
 *
 * @param entries - Classified subprocess-lane entries.
 * @param committed - Manifest currently on disk, when readable.
 * @returns The manifest to write.
 */
export function renderManifest(entries: LaneEntry[], committed: LaneManifest | undefined): LaneManifest {
    const preserved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(committed ?? {})) {
        if (key !== 'version' && key !== 'root') preserved[key] = value;
    }
    return { version: 1, root: { subprocess: entries }, ...preserved } as LaneManifest;
}

/** Parses argv, or returns `undefined` for an unknown/malformed argument. */
function parseArgs(argv: string[]): LaneOptions | undefined {
    const options: LaneOptions = { timings: undefined, check: false };
    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index] ?? '';
        if (arg === '--check') {
            options.check = true;
            continue;
        }
        if (arg === '--timings') {
            const value = argv[index + 1];
            if (value === undefined || value.startsWith('--')) return undefined;
            options.timings = value;
            index++;
            continue;
        }
        return undefined;
    }
    return options;
}

/** Compares the classification against the committed manifest; nonzero when they disagree. */
function checkManifest(entries: LaneEntry[], manifestPath: string): number {
    const committed = readCommitted(manifestPath);
    if (committed === undefined) {
        console.error(`test-lanes: ${LANE_MANIFEST_PATH} is missing — run: bun scripts/spur-dev.ts test-lanes`);
        return 1;
    }
    const drift = diffLaneManifest(entries, committed);
    if (drift.length === 0) {
        console.log(`test-lanes: ${LANE_MANIFEST_PATH} matches the tree (${entries.length} file(s))`);
        return 0;
    }
    for (const row of drift) console.error(`test-lanes: drift ${row.kind} ${row.path} — ${row.detail}`);
    console.error(`test-lanes: ${drift.length} drift(s) — regenerate: bun scripts/spur-dev.ts test-lanes`);
    return 1;
}

/** Reads the committed manifest, or `undefined` when absent or unreadable. */
function readCommitted(manifestPath: string): LaneManifest | undefined {
    if (!existsSync(manifestPath)) return undefined;
    try {
        return readLaneManifest(readFileSync(manifestPath, 'utf8'));
    } catch {
        return undefined;
    }
}

/** Reads a JUnit report, or an empty timing map when none was supplied. */
function readTimings(timingsPath: string | undefined): Map<string, number> {
    if (timingsPath === undefined) return new Map();
    if (!existsSync(timingsPath)) throw new Error(`timings file not found: ${timingsPath}`);
    return parseJunitTimings(readFileSync(timingsPath, 'utf8'));
}

/** Attaches recorded durations where the profiling run measured the file. */
function withTimings(entries: LaneEntry[], timings: Map<string, number>): LaneEntry[] {
    if (timings.size === 0) return entries;
    return entries.map((entry) => {
        const durationMs = timings.get(entry.path);
        return durationMs === undefined ? entry : { ...entry, durationMs };
    });
}

/** Reads candidate sources under the root path set, skipping ignored and (for helpers) test files. */
function collectSources(
    repoRoot: string,
    pattern: string,
    ignorePatterns: string[],
    excludeTests: boolean,
): TestSource[] {
    const glob = new Bun.Glob(pattern);
    const ignored = ignorePatterns.map((ignore) => new Bun.Glob(ignore));
    const sources: TestSource[] = [];
    const seen = new Set<string>();
    for (const rootPath of ROOT_PATH_SET) {
        const absoluteRoot = join(repoRoot, rootPath);
        if (!existsSync(absoluteRoot)) continue;
        for (const found of glob.scanSync({ cwd: absoluteRoot, onlyFiles: true })) {
            const relPath = posix.join(posix.normalize(rootPath), found.split(/[\\/]/).join('/'));
            if (seen.has(relPath)) continue;
            if (excludeTests ? isTestFile(relPath) : !isTestFile(relPath)) continue;
            if (ignored.some((ignore) => ignore.match(relPath))) continue;
            seen.add(relPath);
            sources.push({ path: relPath, content: readFileSync(join(repoRoot, relPath), 'utf8') });
        }
    }
    return sources;
}

/** True for the test-file shapes the suite collects (helpers exclude them). */
function isTestFile(relPath: string): boolean {
    return /\.test\.tsx?$/.test(relPath) || /\.heavy\.test\.ts$/.test(relPath);
}

if (import.meta.main) process.exit(await runTestLanes(process.argv.slice(2)));
