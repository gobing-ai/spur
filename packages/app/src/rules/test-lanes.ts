/**
 * Root test-lane classification (feature H161, task 1459).
 *
 * The root suite (`bun run test`) is one Bun child at `--parallel=2` because full fan-out timed out
 * the subprocess-spawning test files (commit c8d5ca0f2). The classifier decides, from committed
 * evidence rather than a runtime guess, which root test files belong to the subprocess lane; the
 * launcher (`scripts/commands/run-tests.ts`) then runs that lane at the proven bound and everything
 * else at full fan-out.
 *
 * Membership is a committed manifest (`config/test-lanes.json`) so a run is reproducible and reviewable:
 * a generator recomputes it, and a repo-wide drift test fails naming any file whose classification
 * moved. A file qualifies when it contains a spawn token, or when it imports by name an export whose
 * body contains one — one level of helper indirection, not a transitive call graph (a helper that
 * spawns through another helper is a documented miss, surfaced by a timeout or the duration ranking).
 *
 * Paths in this module are repo-relative POSIX strings; resolution of relative import specifiers is
 * pure string work, so classification stays usable in tests without touching the filesystem.
 */
import { posix } from 'node:path';

/** One scanned source file: repo-relative path plus its text. */
export interface TestSource {
    /** Repo-relative POSIX path, e.g. `apps/cli/tests/helpers.test.ts`. */
    path: string;
    /** File text. */
    content: string;
}

/** Why a file belongs to the subprocess lane: a direct token, or the helper export it calls. */
export type LaneReason = 'direct' | `helper:${string}#${string}`;

/** One subprocess-lane manifest row. */
export interface LaneEntry {
    /** Repo-relative POSIX path. */
    path: string;
    /** Detection reason recorded for review; never interpreted by the launcher. */
    reason: LaneReason;
    /** Recorded wall time from a JUnit profiling run, when one was supplied. */
    durationMs?: number;
}

/** The `root` section of the manifest: the subprocess-lane membership. */
export interface LaneManifestRoot {
    /** Files that spawn subprocesses, sorted by path. */
    subprocess: LaneEntry[];
}

/** The committed manifest. Unknown top-level keys are preserved so later sections can extend it. */
export interface LaneManifest {
    /** Manifest schema version; only `1` is read. */
    version: number;
    /** Root-suite section. */
    root: LaneManifestRoot;
    /** Preserved extension keys (the `heavy` section is added by task 1461). */
    [key: string]: unknown;
}

/** Drift kinds: an unlisted file, a listed file the tree no longer has, or an illegal row value. */
export type LaneDriftKind = 'missing' | 'stale' | 'invalid';

/** Shared-resource a heavy test contends for; `shares` records why a lane was chosen. */
export const HEAVY_SHARES = [
    'browser',
    'board-build',
    'cli-spawn',
    'sqlite',
    'gate-lock',
    'timing-sensitive',
    'operator-env',
] as const;

/** One declared shared resource. */
export type HeavyShare = (typeof HEAVY_SHARES)[number];

/** Heavy lane a file runs in: concurrent-safe, or isolated in the serial phase. */
export type HeavyLane = 'concurrent' | 'serial';

/** One `heavy` manifest row: hand-classified, never derived from a token scan. */
export interface HeavyLaneEntry {
    /** Repo-relative POSIX path of the `.heavy.test.` file. */
    path: string;
    /** Phase the file runs in. */
    lane: HeavyLane;
    /** Declared shared resources; the classification's whole audit trail. */
    shares: HeavyShare[];
    /** Why this lane: an anchor (`path:line`) plus the judgement. */
    reason: string;
}

/** Heavy files whose isolation is not optional, whatever their `shares` say. */
const FORCED_SERIAL = [
    /^scripts\/commands\/fleet-e2e-batch-perf\.heavy\.test\.ts$/,
    /^plugins\/sp\/tests\/quality-gate-lock\.heavy\.test\.ts$/,
];

/** One manifest disagreement between the generator's classification and the committed file. */
export interface LaneDrift {
    /** Repo-relative POSIX path of the offending file — the name a failure message must carry. */
    path: string;
    /** Which direction the disagreement runs. */
    kind: LaneDriftKind;
    /** Human-readable sentence for the drift report. */
    detail: string;
}

/**
 * Spawn tokens. `Bun.spawn` covers `Bun.spawnSync`; the shell-template arm matches Bun's `` $`…` ``.
 */
const SPAWN_TOKEN = /Bun\.spawn|\bspawnSync\s*\(|\bexecSync\s*\(|\bexecFileSync\s*\(|child_process|\$`/;

/** `import { a, b as c } from './x'` — the braces may span lines. */
const IMPORT_NAMED = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;

/**
 * Classifies root test files into the subprocess lane.
 *
 * A file qualifies when its own text contains a spawn token, or when it imports by name an export
 * of a helper (a non-test `.ts` under a `tests/` directory) whose body contains one. Importing a
 * helper file is not enough — only the imported names are checked, because most test files import
 * a large helper module for non-spawning utilities.
 *
 * @param files - Test sources to classify.
 * @param helpers - Candidate helper sources to index.
 * @returns Subprocess-lane entries sorted by path.
 */
export function classifyTestFiles(files: TestSource[], helpers: TestSource[]): LaneEntry[] {
    const spawningHelpers = new Map<string, Set<string>>();
    for (const helper of helpers) {
        const spawning = new Set<string>();
        for (const [name, body] of extractExportedBodies(helper.content)) {
            if (SPAWN_TOKEN.test(body)) spawning.add(name);
        }
        if (spawning.size > 0) spawningHelpers.set(posix.normalize(helper.path), spawning);
    }
    const helperPaths = new Set(spawningHelpers.keys());

    const entries: LaneEntry[] = [];
    for (const file of files) {
        if (SPAWN_TOKEN.test(file.content)) {
            entries.push({ path: file.path, reason: 'direct' });
            continue;
        }
        const hit = findHelperSpawn(file, spawningHelpers, helperPaths);
        if (hit !== undefined) entries.push({ path: file.path, reason: `helper:${hit.path}#${hit.name}` });
    }
    return entries.sort((a, b) => comparePaths(a.path, b.path));
}

/**
 * Reads and validates a manifest document.
 *
 * @param json - Raw `config/test-lanes.json` text.
 * @returns The parsed manifest, unknown top-level keys preserved.
 * @throws Error when the document is not JSON, carries another version, or has a malformed `root`.
 */
export function readLaneManifest(json: string): LaneManifest {
    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch (error) {
        throw new Error(`test-lanes manifest is not valid JSON: ${(error as Error).message}`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('test-lanes manifest must be a JSON object');
    }
    const record = parsed as Record<string, unknown>;
    if (record.version !== 1) {
        throw new Error(`unsupported test-lanes manifest version: ${JSON.stringify(record.version)} (expected 1)`);
    }
    const root = record.root;
    if (typeof root !== 'object' || root === null || Array.isArray(root)) {
        throw new Error('test-lanes manifest is missing its `root` object');
    }
    const subprocess = (root as Record<string, unknown>).subprocess;
    if (!Array.isArray(subprocess)) {
        throw new Error('test-lanes manifest is missing its `root.subprocess` array');
    }
    const entries = subprocess.map((row, index) => {
        if (typeof row !== 'object' || row === null) throw new Error(`root.subprocess[${index}] is not an object`);
        const { path, reason, durationMs } = row as Record<string, unknown>;
        if (typeof path !== 'string' || path === '') throw new Error(`root.subprocess[${index}].path must be a string`);
        if (typeof reason !== 'string') throw new Error(`root.subprocess[${index}].reason must be a string`);
        if (durationMs !== undefined && typeof durationMs !== 'number') {
            throw new Error(`root.subprocess[${index}].durationMs must be a number when present`);
        }
        return durationMs === undefined ? { path, reason } : { path, reason, durationMs };
    });
    const heavy = record.heavy;
    if (heavy !== undefined) {
        if (!Array.isArray(heavy)) throw new Error('test-lanes manifest `heavy` section must be an array');
        for (const [index, row] of heavy.entries()) {
            if (typeof row !== 'object' || row === null) throw new Error(`heavy[${index}] is not an object`);
            const { path, lane, shares, reason } = row as Record<string, unknown>;
            if (typeof path !== 'string' || path === '') throw new Error(`heavy[${index}].path must be a string`);
            if (typeof lane !== 'string') throw new Error(`heavy[${index}].lane must be a string`);
            if (!Array.isArray(shares) || shares.some((share) => typeof share !== 'string')) {
                throw new Error(`heavy[${index}].shares must be an array of strings`);
            }
            if (typeof reason !== 'string') throw new Error(`heavy[${index}].reason must be a string`);
        }
    }
    return { ...record, version: 1, root: { subprocess: entries } } as LaneManifest;
}

/**
 * Compares the generator's classification against the committed manifest.
 *
 * @param expected - Entries the generator derived from the current tree.
 * @param committed - Manifest read from disk.
 * @returns Every disagreement, sorted by path; empty when membership matches.
 */
export function diffLaneManifest(expected: LaneEntry[], committed: LaneManifest): LaneDrift[] {
    const expectedPaths = new Set(expected.map((entry) => entry.path));
    const committedPaths = new Set(committed.root.subprocess.map((entry) => entry.path));
    const drift: LaneDrift[] = [];
    for (const entry of expected) {
        if (committedPaths.has(entry.path)) continue;
        drift.push({
            path: entry.path,
            kind: 'missing',
            detail: 'spawning file missing from config/test-lanes.json',
        });
    }
    for (const entry of committed.root.subprocess) {
        if (expectedPaths.has(entry.path)) continue;
        drift.push({
            path: entry.path,
            kind: 'stale',
            detail: 'listed in config/test-lanes.json but no longer classifies as subprocess-spawning',
        });
    }
    return drift.sort((a, b) => comparePaths(a.path, b.path));
}

/**
 * Compares the tree's heavy test files against the manifest's hand-classified `heavy` section.
 *
 * Value legality is checked here rather than in the reader so a bad row is reported by path — the
 * drift guard's failure message has to name the file, not an array index.
 *
 * @param files - Repo-relative paths of every `.heavy.test.` file in the tree.
 * @param manifest - Manifest read from disk.
 * @returns Every disagreement, sorted by path; empty when the section is legal and complete.
 */
export function diffHeavyLanes(files: string[], manifest: LaneManifest): LaneDrift[] {
    const declared = Array.isArray(manifest.heavy) ? (manifest.heavy as HeavyLaneEntry[]) : [];
    const present = new Set(files);
    const declaredPaths = new Set(declared.map((row) => row.path));
    const drift: LaneDrift[] = [];
    for (const path of [...present].sort(comparePaths)) {
        if (declaredPaths.has(path)) continue;
        drift.push({ path, kind: 'missing', detail: 'heavy test file missing from the manifest `heavy` section' });
    }
    for (const row of declared) {
        if (!present.has(row.path)) {
            drift.push({
                path: row.path,
                kind: 'stale',
                detail: 'listed in the manifest `heavy` section but not found in the tree',
            });
            continue;
        }
        if (row.lane !== 'concurrent' && row.lane !== 'serial') {
            drift.push({ path: row.path, kind: 'invalid', detail: `unknown heavy lane '${String(row.lane)}'` });
            continue;
        }
        const unknown = row.shares.filter((share) => !HEAVY_SHARES.includes(share));
        if (unknown.length > 0) {
            drift.push({ path: row.path, kind: 'invalid', detail: `unknown share(s): ${unknown.join(', ')}` });
            continue;
        }
        if (row.lane === 'concurrent' && row.shares.includes('timing-sensitive')) {
            drift.push({
                path: row.path,
                kind: 'invalid',
                detail: 'a timing-sensitive file must run in the serial phase',
            });
            continue;
        }
        if (row.lane !== 'serial' && FORCED_SERIAL.some((pattern) => pattern.test(row.path))) {
            drift.push({ path: row.path, kind: 'invalid', detail: 'this file must run in the serial phase' });
        }
    }
    return drift.sort((a, b) => comparePaths(a.path, b.path));
}

/**
 * Sums JUnit `testcase` durations per test file.
 *
 * Bun 1.4.3 exposes no per-file timing reporter other than JUnit, so profiling runs aggregate here.
 *
 * @param xml - A JUnit report written by `bun test --reporter=junit --reporter-outfile <file>`.
 * @returns Repo-relative file path → total milliseconds for that file.
 */
export function parseJunitTimings(xml: string): Map<string, number> {
    const timings = new Map<string, number>();
    for (const match of xml.matchAll(/<testcase\s[^>]*>/g)) {
        const tag = match[0];
        const file = /\sfile="([^"]+)"/.exec(tag)?.[1];
        const time = /\stime="([0-9.]+)"/.exec(tag)?.[1];
        if (file === undefined || time === undefined) continue;
        timings.set(file, (timings.get(file) ?? 0) + Math.round(Number(time) * 1000));
    }
    return timings;
}

/** One helper import that resolved to a spawning export. */
interface HelperHit {
    path: string;
    name: string;
}

/**
 * Finds the first named import of a spawning helper export in a test file.
 */
function findHelperSpawn(
    file: TestSource,
    spawningHelpers: Map<string, Set<string>>,
    helperPaths: Set<string>,
): HelperHit | undefined {
    for (const match of file.content.matchAll(IMPORT_NAMED)) {
        const resolved = resolveSpecifier(file.path, match[2] ?? '', helperPaths);
        if (resolved === undefined) continue;
        const spawning = spawningHelpers.get(resolved);
        if (spawning === undefined) continue;
        for (const imported of importedNames(match[1] ?? '')) {
            if (spawning.has(imported)) return { path: resolved, name: imported };
        }
    }
    return undefined;
}

/** Resolves a relative import specifier against the indexed helper paths. */
function resolveSpecifier(fromPath: string, specifier: string, helperPaths: Set<string>): string | undefined {
    if (!specifier.startsWith('.')) return undefined;
    const base = posix.normalize(posix.join(posix.dirname(fromPath), specifier));
    for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
        if (helperPaths.has(candidate)) return candidate;
    }
    return undefined;
}

/** The original names of a named-import clause (`a as b` contributes `a`). */
function importedNames(clause: string): string[] {
    const names: string[] = [];
    for (const raw of clause.split(',')) {
        const part = raw.trim().replace(/^type\s+/, '');
        if (part === '') continue;
        const original = part.split(/\s+as\s+/)[0]?.trim();
        if (original !== undefined && original !== '') names.push(original);
    }
    return names;
}

/**
 * Indexes every exported declaration name in a helper to its source text.
 *
 * Over-approximating here would push well-behaved test files into the slow lane, so bodies are
 * brace-matched rather than sliced to the next `export`.
 */
function extractExportedBodies(content: string): Map<string, string> {
    const bodies = new Map<string, string>();

    for (const match of content.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g)) {
        const name = match[1] ?? '';
        const end = declarationEnd(content, match.index ?? 0, match[0].length);
        if (name !== '' && end !== undefined) bodies.set(name, content.slice(match.index, end));
    }

    for (const match of content.matchAll(/export\s+const\s+([A-Za-z0-9_$]+)\s*(?::[^=]+)?=\s*/g)) {
        const name = match[1] ?? '';
        const bodyStart = (match.index ?? 0) + match[0].length;
        const end = assignmentEnd(content, bodyStart);
        if (name !== '' && !bodies.has(name)) bodies.set(name, content.slice(bodyStart, end));
    }

    return bodies;
}

/**
 * Ends a function declaration at its closing brace.
 *
 * @returns The exclusive end index, or `undefined` when the declaration is unterminated.
 */
function declarationEnd(content: string, start: number, prefixLength: number): number | undefined {
    const openParen = content.indexOf('(', start + prefixLength - 1);
    if (openParen < 0) return undefined;
    const closeParen = matchBracket(content, openParen, '(', ')');
    if (closeParen < 0) return undefined;
    const openBrace = content.indexOf('{', closeParen);
    if (openBrace < 0) return undefined;
    const closeBrace = matchBracket(content, openBrace, '{', '}');
    return closeBrace < 0 ? undefined : closeBrace + 1;
}

/**
 * Ends an assignment expression: a brace-matched arrow body, a function expression, or a plain
 * expression terminated by `;` / the next top-level `export`.
 */
function assignmentEnd(content: string, start: number): number {
    const arrow = content.indexOf('=>', start);
    const statementEnd = expressionEnd(content, start);
    if (arrow < 0 || arrow > statementEnd) {
        const functionBody = /^\s*(?:async\s+)?function\b/.test(content.slice(start, statementEnd))
            ? declarationEnd(content, start, 0)
            : undefined;
        return functionBody ?? statementEnd;
    }
    const bodyStart = skipSpace(content, arrow + 2);
    if (content[bodyStart] === '{') {
        const closeBrace = matchBracket(content, bodyStart, '{', '}');
        if (closeBrace >= 0) return closeBrace + 1;
    }
    return expressionEnd(content, bodyStart);
}

/** Index of the first non-whitespace character at or after `from`. */
function skipSpace(content: string, from: number): number {
    let index = from;
    while (index < content.length && /\s/.test(content[index] ?? '')) index++;
    return index;
}

/** Ends a bracketed expression at the `;` or next top-level `export` that terminates it. */
function expressionEnd(content: string, start: number): number {
    let depth = 0;
    for (let index = start; index < content.length; index++) {
        const char = content[index];
        if (char === '"' || char === "'" || char === '`') {
            index = skipString(content, index);
            continue;
        }
        if (char === '(' || char === '[' || char === '{') depth++;
        else if (char === ')' || char === ']' || char === '}') {
            if (depth === 0) return index;
            depth--;
        } else if (char === ';' && depth === 0) return index + 1;
        else if (char === '\n' && depth === 0 && /^export\s/.test(content.slice(index + 1))) return index;
    }
    return content.length;
}

/** Index of the bracket closing the one at `openIndex`, honoring string literals. */
function matchBracket(content: string, openIndex: number, open: string, close: string): number {
    let depth = 0;
    for (let index = openIndex; index < content.length; index++) {
        const char = content[index];
        if (char === '"' || char === "'" || char === '`') {
            index = skipString(content, index);
            continue;
        }
        if (char === open) depth++;
        else if (char === close) {
            depth--;
            if (depth === 0) return index;
        }
    }
    return -1;
}

/** Index of the quote closing the string literal opened at `start`. */
function skipString(content: string, start: number): number {
    const quote = content[start];
    for (let index = start + 1; index < content.length; index++) {
        if (content[index] === '\\') {
            index++;
            continue;
        }
        if (content[index] === quote) return index;
    }
    return content.length;
}

/** Locale-independent path ordering, so the manifest is byte-stable across machines. */
function comparePaths(left: string, right: string): number {
    if (left === right) return 0;
    return left < right ? -1 : 1;
}
