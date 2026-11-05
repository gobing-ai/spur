import {
    type SearchHit,
    type SearchRequest,
    type SearchResponse,
    type SearchScope,
    type SearchSkip,
    type SearchStatus,
    searchRequestSchema,
} from '@gobing-ai/spur-contracts';
import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import { buildZgArgs, parseZgQuery, parseZgStatus, ZgOutputError } from './search-zg';

/**
 * Hybrid search service for task 1285 (`docs/design/hybrid-search.md` §2–§3).
 *
 * Exact search shells out to `rg --json`; indexed fuzzy search shells out to
 * `zg query`. Both binaries are optional environment tools: a missing backend
 * degrades to a `skipped` entry with an exact hint string (never executed),
 * never a crash — except ripgrep in exact/auto mode, where exact search is
 * the only route and absence is a hard SearchError. The zg adapter never
 * touches `.zvec-grep/` and never runs `zg index`.
 */

/** Exact hint strings surfaced to operators — printed, never executed (design §4). */
/** Install hint printed when rg is absent — exact mode cannot degrade. */
export const RG_INSTALL_HINT = 'brew install ripgrep';

/** Install hint printed when the zg binary is absent. */
export const ZG_INSTALL_HINT = 'bun add -g @zvec/zvec-grep';

/** Hint printed when no zg index exists — names the command, printed only. */
export const ZG_INDEX_HINT = 'zg --index --embedding local/potion-code-16m-v2';

/** Hint printed when the zg index is stale — printed, never executed. */
export const ZG_REFRESH_HINT = 'zg --index';

/** Hard failures: exact search requested but impossible, or a malformed request. */
export class SearchError extends Error {
    readonly code: 'rg-not-installed' | 'rg-failed' | 'invalid-request';

    constructor(code: 'rg-not-installed' | 'rg-failed' | 'invalid-request', message: string) {
        super(message);
        this.name = 'SearchError';
        this.code = code;
    }
}

/** Process boundary injected for tests; production wiring is `defaultSearchDeps`. */
export interface SearchDeps {
    which(bin: string): string | null;
    run(
        command: string,
        args: string[],
        opts: { cwd: string; timeout: number },
    ): Promise<{
        exitCode: number;
        stdout: string;
        stderr: string;
        timedOut?: boolean;
        outcome?: string;
        outputTruncated?: boolean;
    }>;
}

/** Production SearchDeps: Bun.which + NodeProcessExecutor with the design §3 budgets. */
export const defaultSearchDeps: SearchDeps = {
    which: (bin) => (typeof Bun !== 'undefined' && typeof Bun.which === 'function' ? Bun.which(bin) : null),
    run: async (command, args, opts) => {
        const result = await new NodeProcessExecutor().run({
            command,
            args,
            cwd: opts.cwd,
            timeout: opts.timeout,
            maxOutput: 2 * 1024 * 1024,
            rejectOnError: false,
            forceBuffered: true,
        });
        const outputTruncated = (result as { outputTruncated?: boolean }).outputTruncated;
        return {
            exitCode: result.exitCode ?? -1,
            stdout: result.stdout,
            stderr: result.stderr,
            timedOut: result.outcome === 'timeout',
            outcome: result.outcome,
            outputTruncated:
                outputTruncated ??
                (Buffer.byteLength(result.stdout) >= RG_MAX_OUTPUT_BYTES ||
                    Buffer.byteLength(result.stderr) >= RG_MAX_OUTPUT_BYTES),
        };
    },
};

// Timeouts per design §2: rg query 10 s, zg query 15 s, probes 5 s.
const RG_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const RG_TIMEOUT_MS = 10_000;
const ZG_QUERY_TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 5_000;

const SNIPPET_MAX_CHARS = 300;

/** Default `-g` glob sets per scope: docs extensions, code (negated docs), or everything. */
export function scopeGlobs(scope: SearchScope): string[] {
    if (scope === 'docs') return ['*.md', '*.mdx', '*.txt', '*.rst'];
    if (scope === 'code') return ['!*.md', '!*.mdx', '!*.txt', '!*.rst'];
    return [];
}

/** Probe search backend availability, versions, and zg index readiness. Never throws. */
export async function searchStatus(root: string, deps: SearchDeps = defaultSearchDeps): Promise<SearchStatus> {
    const rgPath = deps.which('rg');
    const rg = rgPath
        ? { available: true, ...(await probeVersion(deps, rgPath, ['--version'])) }
        : { available: false };

    const zgPath = deps.which('zg');
    if (!zgPath) {
        return { rg, zg: { available: false, index: 'unknown', hint: ZG_INSTALL_HINT } };
    }
    const version = await probeVersion(deps, zgPath, ['--version']);
    let index: SearchStatus['zg']['index'] = 'unknown';
    try {
        const result = await deps.run('zg', ['--status'], { cwd: root, timeout: PROBE_TIMEOUT_MS });
        if (result.exitCode === 0) index = parseZgStatus(result.stdout);
    } catch {
        // probe failure stays unknown — status never throws
    }
    const hint = index === 'missing' ? ZG_INDEX_HINT : index === 'stale' ? ZG_REFRESH_HINT : undefined;
    return { rg, zg: { available: true, ...version, index, ...(hint ? { hint } : {}) } };
}

async function probeVersion(deps: SearchDeps, path: string, args: string[]): Promise<{ version: string } | object> {
    try {
        const result = await deps.run(path, args, { cwd: process.cwd(), timeout: PROBE_TIMEOUT_MS });
        if (result.exitCode !== 0) return {};
        const version = result.stdout.split('\n')[0]?.trim();
        return version ? { version } : {};
    } catch {
        return {};
    }
}

/**
 * Run a hybrid search. Groups carry ranked hits per backend (null = route not
 * run); `skipped` records degraded routes with their reason and operator hint.
 */
export async function searchProject(
    input: unknown,
    root: string,
    deps: SearchDeps = defaultSearchDeps,
): Promise<SearchResponse> {
    const parsed = searchRequestSchema.safeParse(input);
    if (!parsed.success) {
        throw new SearchError(
            'invalid-request',
            `Invalid search request: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
        );
    }
    const req: SearchRequest = parsed.data;
    const mode = req.mode ?? 'auto';
    const scope = req.scope ?? 'all';
    const limit = req.limit ?? 10;
    const globs = [...scopeGlobs(scope), ...(req.globs ?? [])];

    const status = await searchStatus(root, deps);

    if (mode === 'fuzzy') {
        const fuzzy = await runFuzzy(req, limit, globs, root, status, deps);
        return {
            query: req.query,
            mode,
            scope,
            groups: { exact: null, fuzzy: fuzzy.hits },
            skipped: fuzzy.skipped,
            status,
        };
    }

    if (!status.rg.available) {
        throw new SearchError(
            'rg-not-installed',
            `ripgrep is not installed; exact and auto search require it. Install: ${RG_INSTALL_HINT}`,
        );
    }

    if (mode === 'exact') {
        const exactHits = await runExact(req, limit, globs, root, deps);
        return { query: req.query, mode, scope, groups: { exact: exactHits, fuzzy: null }, skipped: [], status };
    }

    // auto: fuzzy joins only when zg exists and an index is present at all.
    if (!status.zg.available || status.zg.index === 'missing') {
        const skip: SearchSkip = status.zg.available
            ? { route: 'fuzzy', reason: 'zg-index-missing', hint: ZG_INDEX_HINT }
            : { route: 'fuzzy', reason: 'zg-not-installed', hint: ZG_INSTALL_HINT };
        const exactHits = await runExact(req, limit, globs, root, deps);
        return { query: req.query, mode, scope, groups: { exact: exactHits, fuzzy: null }, skipped: [skip], status };
    }

    const [exactHits, fuzzy] = await Promise.all([
        runExact(req, limit, globs, root, deps),
        runFuzzy(req, limit, globs, root, status, deps),
    ]);
    const fuzzyHits = fuzzy.hits ?? [];
    markOverlaps(exactHits, fuzzyHits);
    return {
        query: req.query,
        mode,
        scope,
        groups: { exact: exactHits, fuzzy: fuzzy.hits },
        skipped: fuzzy.skipped,
        status,
    };
}

/** Same path and the exact line falls inside the fuzzy range → both report both routes. */
function markOverlaps(exactHits: SearchHit[], fuzzyHits: SearchHit[]): void {
    for (const exact of exactHits) {
        if (exact.matchedBy.includes('fuzzy')) continue;
        const overlap = fuzzyHits.find(
            (fuzzy) =>
                fuzzy.path === exact.path && exact.startLine >= fuzzy.startLine && exact.startLine <= fuzzy.endLine,
        );
        if (overlap) {
            exact.matchedBy = ['exact', 'fuzzy'];
            overlap.matchedBy = ['exact', 'fuzzy'];
        }
    }
}

async function runExact(
    req: SearchRequest,
    limit: number,
    globs: string[],
    root: string,
    deps: SearchDeps,
): Promise<SearchHit[]> {
    const args = ['--json', '--max-count', String(limit)];
    if (!req.regex) args.push('-F');
    for (const glob of globs) args.push('-g', glob);
    args.push('--', req.query, '.');

    let result: Awaited<ReturnType<SearchDeps['run']>>;
    try {
        result = await deps.run('rg', args, { cwd: root, timeout: RG_TIMEOUT_MS });
    } catch (error) {
        throw new SearchError(
            'rg-failed',
            `ripgrep spawn failed: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    if (result.timedOut || result.outcome === 'timeout') {
        throw new SearchError('rg-failed', `ripgrep timed out after ${RG_TIMEOUT_MS}ms`);
    }
    if (result.outputTruncated) {
        throw new SearchError(
            'rg-failed',
            'ripgrep output exceeded the 2 MiB cap; narrow the query, scope or globs before retrying',
        );
    }
    if (result.outcome !== undefined && result.outcome !== 'exit') {
        const diagnostic = result.stderr.slice(0, 200).trim() || 'no diagnostic output';
        throw new SearchError('rg-failed', `ripgrep process ended with outcome '${result.outcome}': ${diagnostic}`);
    }
    if (result.exitCode !== 0 && result.exitCode !== 1) {
        throw new SearchError('rg-failed', `ripgrep exited ${result.exitCode}: ${result.stderr.slice(0, 200).trim()}`);
    }

    const hits: SearchHit[] = [];
    for (const line of result.stdout.split('\n')) {
        if (!line.startsWith('{')) continue;
        let event: {
            type?: string;
            data?: { path?: { text?: string }; lines?: { text?: string }; line_number?: number };
        };
        try {
            event = JSON.parse(line);
        } catch {
            throw new SearchError('rg-failed', `ripgrep produced malformed JSON event: ${line.slice(0, 200)}`);
        }
        if (event.type !== 'match') continue;
        if (!event.data?.path?.text || !event.data.line_number) {
            throw new SearchError('rg-failed', `ripgrep produced malformed JSON match event: ${line.slice(0, 200)}`);
        }
        const startLine = event.data.line_number;
        hits.push({
            rank: hits.length + 1,
            path: event.data.path.text.replace(/^\.\//, ''),
            startLine,
            endLine: startLine,
            snippet: (event.data.lines?.text ?? '').trim().slice(0, SNIPPET_MAX_CHARS),
            route: 'exact',
            matchedBy: ['exact'],
        });
        if (hits.length >= limit) break;
    }
    return result.exitCode === 1 ? [] : hits;
}

interface FuzzyRun {
    hits: SearchHit[] | null;
    skipped: SearchSkip[];
}

async function runFuzzy(
    req: SearchRequest,
    limit: number,
    globs: string[],
    root: string,
    status: SearchStatus,
    deps: SearchDeps,
): Promise<FuzzyRun> {
    if (!status.zg.available) {
        return { hits: null, skipped: [{ route: 'fuzzy', reason: 'zg-not-installed', hint: ZG_INSTALL_HINT }] };
    }
    if (status.zg.index === 'missing') {
        return { hits: null, skipped: [{ route: 'fuzzy', reason: 'zg-index-missing', hint: ZG_INDEX_HINT }] };
    }

    const args = buildZgArgs({ ...req, limit }, globs);
    let result: Awaited<ReturnType<SearchDeps['run']>>;
    try {
        result = await deps.run('zg', args, { cwd: root, timeout: ZG_QUERY_TIMEOUT_MS });
    } catch {
        return { hits: null, skipped: [{ route: 'fuzzy', reason: 'zg-failed' }] };
    }
    if (result.timedOut) return { hits: null, skipped: [{ route: 'fuzzy', reason: 'zg-timeout' }] };
    if (result.exitCode !== 0) {
        // 0.3.0: `Error[ZG.ENGINE.NOT_FOUND]: No index found in <dir>`; 0.2.x printed `[INDEX_MISSING]`.
        if (/ZG\.ENGINE\.NOT_FOUND|\[INDEX_MISSING\]/.test(result.stderr)) {
            return { hits: null, skipped: [{ route: 'fuzzy', reason: 'zg-index-missing', hint: ZG_INDEX_HINT }] };
        }
        return { hits: null, skipped: [{ route: 'fuzzy', reason: 'zg-failed' }] };
    }

    try {
        return { hits: parseZgQuery(result.stdout, status.zg.version ?? 'unknown').slice(0, limit), skipped: [] };
    } catch (error) {
        if (error instanceof ZgOutputError) {
            // Lead with the message: it names the offending line, which the head-of-output sample may not reach.
            const sample = `${error.zgVersion}: ${error.message} | ${error.sample}`.slice(0, 300);
            return { hits: null, skipped: [{ route: 'fuzzy', reason: 'zg-output-error', hint: sample }] };
        }
        throw error;
    }
}
