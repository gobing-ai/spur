import type { SearchHit, SearchRequest } from '@gobing-ai/spur-contracts';

/**
 * zg query output adapter for task 1285 (`docs/design/hybrid-search.md` §2–§3).
 *
 * zg 0.3.0 `--preview short` emits, per hit, a `#<rank> <path>:<start>(-<end>)?` header,
 * optional `key: value` metadata lines (`symbol: [kind] name`, `heading: …`), and indented
 * `  <lineNo>: <text>` source lines, with an indented `…` marking truncated source. A miss prints `No matches.`. Multi-query output adds
 * `-- query i/n: text --` separators (Spur sends one query, so they are only tolerated).
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
    // zg 0.3.0 has no subcommands: `zg --hybrid <q>` (a bare `query` word would be search text).
    // `--preview short` pins the grammar parseZgQuery reads, independent of zg's default.
    return [
        '--hybrid',
        req.query,
        '--limit',
        String(req.limit),
        '--preview',
        'short',
        ...globs.flatMap((glob) => ['-g', glob]),
    ];
}

const HIT_HEADER_PATTERN = /^#(\d+) (.+?):(\d+)(?:-(\d+))?$/;
const METADATA_PATTERN = /^([a-z_]+): (.*)$/;
const SOURCE_LINE_PATTERN = /^\s+(\d+): ?(.*)$/;
const GROUP_SEPARATOR_PATTERN = /^-- query \d+\/\d+: .* --$/;

/**
 * Parse zg 0.3.0 short-preview stdout into ranked fuzzy hits.
 *
 * Throws ZgOutputError (with the zg version and an output sample) when a line fits no
 * grammar rule or hit ranks are not consecutive from 1. Empty output and `No matches.`
 * parse to `[]`.
 */
export function parseZgQuery(stdout: string, zgVersion: string): SearchHit[] {
    const hits: SearchHit[] = [];
    let current: SearchHit | null = null;
    const snippetLines: string[] = [];

    for (const line of stdout.split('\n')) {
        const trimmed = line.trim();
        // zg 0.3.0 marks truncated source with an indented U+2026 `…`; `...` is the 0.2-era form.
        if (!trimmed || trimmed === '\u2026' || trimmed === '...' || GROUP_SEPARATOR_PATTERN.test(trimmed)) continue;
        if (trimmed === 'No matches.' && hits.length === 0) continue;
        const header = line.match(HIT_HEADER_PATTERN);
        if (header) {
            if (current) flushSnippet(current, snippetLines);
            if (Number(header[1]) !== hits.length + 1) {
                throw new ZgOutputError(`zg query hit rank #${header[1]} is out of sequence`, zgVersion, stdout);
            }
            const start = Number(header[3]);
            current = {
                rank: hits.length + 1,
                path: header[2] ?? '',
                startLine: start,
                endLine: header[4] ? Number(header[4]) : start,
                snippet: '',
                route: 'fuzzy',
                matchedBy: ['fuzzy'],
            };
            hits.push(current);
            snippetLines.length = 0;
            continue;
        }
        const source = current ? line.match(SOURCE_LINE_PATTERN) : null;
        if (source) {
            snippetLines.push(source[2] ?? '');
            continue;
        }
        const metadata = current ? line.match(METADATA_PATTERN) : null;
        if (current && metadata) {
            if (metadata[1] === 'heading') current.heading = metadata[2] ?? '';
            if (metadata[1] === 'symbol') current.symbol = metadata[2] ?? '';
            continue;
        }
        throw new ZgOutputError(`zg query output has an unrecognized line: ${line.slice(0, 80)}`, zgVersion, stdout);
    }
    if (current) flushSnippet(current, snippetLines);
    return hits;
}

function flushSnippet(hit: SearchHit, snippetLines: string[]): void {
    hit.snippet = snippetLines.join('\n').slice(0, SNIPPET_MAX_CHARS);
}

/**
 * Map `zg --status` output to the index readiness enum. zg 0.3.0 reports a missing index as
 * `Coverage    Unavailable (index not configured)`; otherwise the first glyph decides:
 * `!` → stale, `?` → missing, any other non-empty first line → ready, blank output → unknown.
 */
export function parseZgStatus(stdout: string): 'ready' | 'stale' | 'missing' | 'unknown' {
    if (/^\s*Coverage\s+Unavailable\b/m.test(stdout)) return 'missing';
    const firstLine = stdout.split('\n').find((line) => line.trim()) ?? '';
    const glyph = firstLine.trim().charAt(0);
    if (glyph === '!') return 'stale';
    if (glyph === '?') return 'missing';
    if (!glyph) return 'unknown';
    return 'ready';
}
