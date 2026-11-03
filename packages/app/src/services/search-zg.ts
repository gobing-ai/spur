import type { SearchHit, SearchRequest } from '@gobing-ai/spur-contracts';

/**
 * zg query output adapter for task 1285 (`docs/design/hybrid-search.md` §2–§3).
 *
 * zg 0.2.2 emits agent-facing markdown with a stable grammar:
 * `query groups (N):`, `Q1 [primary]: <q>`, `hits: N`, then per hit a
 * `#<rank> matchedBy=(fts|vector|fts+vector) <path>:<start>(-<end>)?` header,
 * optional `heading|heading_level|scope|symbol: <value>` metadata lines, and
 * `<lineNo>\t<text>` source lines that may end with a literal `...` elision.
 *
 * The adapter fails loudly (ZgOutputError) on any output it cannot fully
 * reconcile — a silent misparse would corrupt ranking for every consumer.
 */

/** Thrown when successful zg output does not match the documented grammar. */
export class ZgOutputError extends Error {
    /** zg version probe value at parse time (empty string when unknown). */
    readonly zgVersion: string;
    /** First lines of the unrecognized output, capped at 400 chars. */
    readonly sample: string;

    constructor(message: string, zgVersion: string, sample: string) {
        super(message);
        this.name = 'ZgOutputError';
        this.zgVersion = zgVersion;
        this.sample = sample.slice(0, 400);
    }
}

const SNIPPET_MAX_CHARS = 300;

/** Build the zg query argv: flags take values, `--hybrid` is always explicit (1285 R2). */
export function buildZgArgs(req: SearchRequest, globs: string[]): string[] {
    return ['query', '--hybrid', req.query, '--limit', String(req.limit), ...globs.flatMap((glob) => ['-g', glob])];
}

const HIT_HEADER_PATTERN = /^#(\d+) matchedBy=(fts|vector|fts\+vector) (.+?):(\d+)(?:-(\d+))?$/;
const METADATA_PATTERN = /^(heading|heading_level|scope|symbol): (.*)$/;
const SOURCE_LINE_PATTERN = /^(\d+)\t(.*)$/;

/**
 * Parse zg query stdout into ranked fuzzy hits.
 *
 * Throws ZgOutputError (with the zg version and an output sample) when the
 * output is non-empty but lacks the header, a hit header does not match the
 * grammar, or the parsed hit count disagrees with the declared `hits:` count.
 * Empty/whitespace output and `hits: 0` parse to `[]`.
 */
export function parseZgQuery(stdout: string, zgVersion: string): SearchHit[] {
    if (!stdout.trim()) return [];
    if (!stdout.includes('query groups (')) {
        throw new ZgOutputError('zg query output is missing the "query groups (" header', zgVersion, stdout);
    }

    const countMatch = stdout.match(/^hits: (\d+)$/m);
    if (!countMatch) {
        throw new ZgOutputError('zg query output is missing the "hits:" count line', zgVersion, stdout);
    }
    const declaredCount = Number(countMatch[1] ?? '0');

    const hits: SearchHit[] = [];
    let current: SearchHit | null = null;
    const snippetLines: string[] = [];

    for (const line of stdout.split('\n')) {
        if (line === '...' || !line.trim()) continue;
        const header = line.match(HIT_HEADER_PATTERN);
        if (header) {
            if (current) flushSnippet(current, snippetLines);
            const hitPath = header[3];
            const start = header[4];
            const end = header[5];
            if (!hitPath || !start)
                throw new ZgOutputError('zg query hit header is missing path or line fields', zgVersion, stdout);
            current = {
                rank: hits.length + 1,
                path: hitPath,
                startLine: Number(start),
                endLine: end ? Number(end) : Number(start),
                snippet: '',
                route: 'fuzzy',
                matchedBy: ['fuzzy'],
            };
            hits.push(current);
            snippetLines.length = 0;
            continue;
        }
        if (!current) continue;
        const metadata = line.match(METADATA_PATTERN);
        if (metadata) {
            if (metadata[1] === 'heading') current.heading = metadata[2] ?? '';
            if (metadata[1] === 'symbol') current.symbol = metadata[2] ?? '';
            continue;
        }
        const source = line.match(SOURCE_LINE_PATTERN);
        if (source) snippetLines.push(source[2] ?? '');
        // Anything else between hits is tolerated only if no hit has been seen;
        // stray lines inside a hit would silently corrupt it.
    }
    if (current) flushSnippet(current, snippetLines);

    if (hits.length !== declaredCount) {
        throw new ZgOutputError(
            `zg query output declares hits: ${declaredCount} but ${hits.length} hit blocks were parsed`,
            zgVersion,
            stdout,
        );
    }
    return hits;
}

function flushSnippet(hit: SearchHit, snippetLines: string[]): void {
    hit.snippet = snippetLines.join('\n').slice(0, SNIPPET_MAX_CHARS);
}

/**
 * Map `zg status` output to the index readiness enum by its first glyph:
 * `!` → stale, `?` → missing, any other non-empty first line → ready,
 * blank output → unknown.
 */
export function parseZgStatus(stdout: string): 'ready' | 'stale' | 'missing' | 'unknown' {
    const firstLine = stdout.split('\n').find((line) => line.trim()) ?? '';
    const glyph = firstLine.trim().charAt(0);
    if (glyph === '!') return 'stale';
    if (glyph === '?') return 'missing';
    if (!glyph) return 'unknown';
    return 'ready';
}
