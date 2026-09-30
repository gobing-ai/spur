/**
 * help-docs-parity — gates docs/help/** and docs/help2/** against the live CLI surface
 * (task 1020, feature I3).
 *
 * The help trees were re-aligned with the live `spur` CLI by hand on 2026-09-30 after both
 * drifted silently (removed `team` noun, legacy spellings, missing verbs/flags). This suite
 * makes that drift fail CI. It reuses the frozen 0512 `captureCliSurface` live capture —
 * one capture per command path, cached — and adds no production code, no public CLI verb,
 * and no dependency.
 *
 *   R1 (docs → CLI): every `spur <noun> [<verb>] [--flag…]` invocation inside fenced code
 *     blocks or inline code spans must name a noun, verb, and flag that exist on the live
 *     surface. The five hidden top-level aliases (`init|maintain|migrate|serve|status`) map
 *     onto their `self` verbs; the hidden `agent loop` is allow-listed.
 *   R2 (CLI → docs): every live verb and every live flag must appear in the noun's owning
 *     page(s) in EACH tree (`docs/help/cmd_<noun>.md`, `docs/help2/<noun>.md`; `self` maps
 *     to its five verb pages). `--help`/`-h` and `--json-envelope` are exempt.
 *   R3 (matrix): the noun×verb table, the `Verb count` row, and the Summary counts in
 *     `docs/help/spur-cli-matrix.md` are checked against the live surface, never trusted as
 *     hand-maintained.
 *
 * Failures are reported as sorted `documentedNotOnCli` / `onCliNotDocumented` lists with
 * `file:line` references, matching the cli-surface-parity gate's failure shape.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type CliSurfaceCapture, captureCliSurface } from './helpers/cli-surface';

const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..'); // plugins/sp/tests → repo root
const HELP_DIR = join(REPO_ROOT, 'docs', 'help');
const HELP2_DIR = join(REPO_ROOT, 'docs', 'help2');

/** Generated Commander `help` command — never a gated surface member. */
const HELP_NOUN = 'help';
/** Former standalone nouns, now hidden top-level aliases over `spur self <verb>`. */
const HIDDEN_ALIASES = ['init', 'maintain', 'migrate', 'serve', 'status'] as const;
/** Verbs registered but hidden from `<noun> --help`. */
const HIDDEN_VERBS: Record<string, readonly string[]> = { agent: ['loop'] };
/** Help plumbing flags exempt from R2 documentation coverage. */
const FLAG_EXEMPT = new Set(['--help', '-h', '--json-envelope']);

// ---------------------------------------------------------------------------
// Live surface capture (0512 helper), one capture per command path, cached.
// ---------------------------------------------------------------------------

const captureCache = new Map<string, CliSurfaceCapture>();
function live(commandPath: string[]): CliSurfaceCapture {
    const key = commandPath.join(' ');
    let capture = captureCache.get(key);
    if (!capture) {
        capture = captureCliSurface(commandPath);
        captureCache.set(key, capture);
    }
    return capture;
}

/** noun → verb → live flags. */
const surface = new Map<string, Map<string, string[]>>();
for (const noun of live([]).commands.filter((c) => c !== HELP_NOUN)) {
    const verbs = new Map<string, string[]>();
    for (const verb of live([noun]).commands.filter((v) => v !== HELP_NOUN)) {
        verbs.set(verb, live([noun, verb]).flags);
    }
    surface.set(noun, verbs);
}
const uniqueVerbs = new Set([...surface.values()].flatMap((v) => [...v.keys()]));
const totalCells = [...surface.values()].reduce((sum, verbs) => sum + verbs.size, 0);

// ---------------------------------------------------------------------------
// Doc scanning.
// ---------------------------------------------------------------------------

const NOUN_TOKEN = /^[a-z][a-z0-9-]*$/;
const VERB_TOKEN = /^[a-z][a-z0-9-]*$/;
const FLAG_TOKEN = /^--?[a-z][a-z0-9-]*(?:=.*)?$/;

interface Invocation {
    file: string;
    line: number;
    noun: string;
    verb?: string;
    flags: string[];
}

/**
 * A `spur` token starts an invocation only when it is standalone — `@gobing-ai/spur`,
 * `spur-dev`, and inline-code spans (parsed separately) are not outer invocations.
 */
function isSpurToken(token: string): boolean {
    return token === 'spur';
}

/** Tokenize `spur …` token slices into candidate invocations (placeholder forms ignored). */
function parseInvocation(tokens: string[], file: string, line: number): Invocation | null {
    if (tokens.length < 2) return null; // `spur` alone (e.g. `cd spur`, `spur --help` has no noun token)
    const [nounToken, ...rest] = tokens.slice(1);
    if (!nounToken || !NOUN_TOKEN.test(nounToken)) return null; // `spur <noun>` placeholders
    let noun = nounToken;
    let verb: string | undefined;
    const flags: string[] = [];
    let i = 0;
    if (HIDDEN_ALIASES.includes(noun as (typeof HIDDEN_ALIASES)[number])) {
        noun = 'self';
        if (rest[i] && VERB_TOKEN.test(rest[i] ?? '') && surface.get('self')?.has(rest[i] ?? '')) {
            verb = rest[i];
            i += 1;
        } else {
            verb = nounToken; // bare alias `spur init` ≡ `spur self init`
        }
    } else if (rest[i] && VERB_TOKEN.test(rest[i] ?? '') && surface.get(noun)?.has(rest[i] ?? '')) {
        verb = rest[i];
        i += 1;
    }
    for (; i < rest.length; i++) {
        const token = rest[i] ?? '';
        if (FLAG_TOKEN.test(token)) flags.push(token.split('=')[0] ?? token);
        // Non-flag trailing tokens are positional arguments or flag values — ignored.
    }
    return { file, line, noun, verb, flags };
}

/** Every concrete `spur` invocation across both help trees, with file:line provenance. */
function scanLineTokens(text: string): string[][] {
    const tokens = text.trim().split(/\s+/);
    const slices: string[][] = [];
    let current: string[] | null = null;
    tokens.forEach((token) => {
        if (isSpurToken(token)) {
            if (current) slices.push(current);
            current = [token];
        } else if (current) {
            current.push(token);
        }
    });
    if (current) slices.push(current);
    return slices;
}

function scanInvocations(): Invocation[] {
    const invocations: Invocation[] = [];
    const push = (chunk: string, rel: string, line: number) => {
        if (!chunk.includes('spur')) return;
        for (const tokens of scanLineTokens(chunk)) {
            const parsed = parseInvocation(tokens, rel, line);
            if (parsed) invocations.push(parsed);
        }
    };
    const pushSpans = (text: string, rel: string, line: number) => {
        for (const span of text.matchAll(/`([^`\n]+)`/g)) {
            const tokens = (span[1] ?? '').trim().split(/\s+/);
            if (tokens[0] === 'spur') {
                const parsed = parseInvocation(tokens, rel, line);
                if (parsed) invocations.push(parsed);
            }
        }
    };
    for (const dir of [HELP_DIR, HELP2_DIR]) {
        for (const name of readdirSync(dir)
            .filter((f) => f.endsWith('.md'))
            .sort()) {
            const file = join(dir, name);
            const rel = file.slice(REPO_ROOT.length + 1);
            const source = readFileSync(file, 'utf8');
            const fenced = /```[^\n]*\n([\s\S]*?)```/g;
            for (const match of source.matchAll(fenced)) {
                const startLine = source.slice(0, match.index ?? 0).split('\n').length + 1; // body line 0 = fence-open line + 1
                (match[1] ?? '').split('\n').forEach((body, idx) => {
                    // Inline spans inside fences document their own invocations — parse them,
                    // then strip so their tokens don't bleed into the outer command line.
                    pushSpans(body, `${rel}:${startLine + idx}`, startLine + idx);
                    push(body.replace(/`[^`\n]+`/g, ' '), `${rel}:${startLine + idx}`, startLine + idx);
                });
            }
            const prose = source.replace(fenced, '');
            prose.split('\n').forEach((lineText, idx) => {
                pushSpans(lineText, `${rel}:${idx + 1}`, idx + 1);
            });
        }
    }
    return invocations;
}

/** Word-boundary substring presence (so `--json` does not match inside `--json-envelope`). */
function mentions(haystack: string, needle: string): boolean {
    return new RegExp(`(?<![\\w-])${needle.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}(?![\\w-])`).test(haystack);
}

// ---------------------------------------------------------------------------
// Owning-page maps (R2).
// ---------------------------------------------------------------------------

/** Tree → noun → owning pages whose union must document every live verb and flag. */
function owningPages(dir: string, prefix: (noun: string) => string): Map<string, string[]> {
    const pages = new Map<string, string[]>();
    for (const noun of surface.keys()) {
        if (noun === 'self') {
            pages.set(
                noun,
                HIDDEN_ALIASES.map((verb) => join(dir, prefix(verb))),
            );
        } else {
            pages.set(noun, [join(dir, prefix(noun))]);
        }
    }
    return pages;
}

const pageMaps = [owningPages(HELP_DIR, (noun) => `cmd_${noun}.md`), owningPages(HELP2_DIR, (noun) => `${noun}.md`)];

function pageTexts(pages: string[]): string {
    return pages.map((p) => readFileSync(p, 'utf8')).join('\n');
}

// ---------------------------------------------------------------------------
// Matrix parsing (R3).
// ---------------------------------------------------------------------------

interface Matrix {
    headerNouns: string[];
    /** verb → (noun → ✅?) */
    cells: Map<string, Map<string, boolean>>;
    verbCountRow: Map<string, number>;
    summary: Map<string, number>;
}

function parseMatrix(): Matrix {
    const rows = readFileSync(join(HELP_DIR, 'spur-cli-matrix.md'), 'utf8')
        .split(/\r?\n/)
        .filter((l) => l.startsWith('|') && !/^\|\s*-{2,}/.test(l))
        .map((l) =>
            l
                .split('|')
                .slice(1, -1)
                .map((c) => c.trim()),
        );
    const headerNouns: string[] = [];
    const cells = new Map<string, Map<string, boolean>>();
    const verbCountRow = new Map<string, number>();
    const summary = new Map<string, number>();
    // The file holds three tables (matrix, hidden-legacy map, summary); route rows by the
    // current section header instead of trusting the file's first row for everything.
    let mode: 'matrix' | 'legacy' | 'summary' | null = null;
    for (const row of rows) {
        const label = (row[0] ?? '').replace(/\*\*/g, '');
        if (label === 'Verb \\ Noun') {
            mode = 'matrix';
            headerNouns.push(...row.slice(1));
            continue;
        }
        if (label === 'Legacy noun') {
            mode = 'legacy';
            continue;
        }
        if (label === 'Metric') {
            mode = 'summary';
            continue;
        }
        if (mode === 'matrix' && label === 'Verb count') {
            headerNouns.forEach((n, i) => {
                verbCountRow.set(n, Number((row[i + 1] ?? '').replace(/\*\*/g, '')));
            });
        } else if (mode === 'matrix' && label !== '') {
            const marks = new Map<string, boolean>();
            headerNouns.forEach((n, i) => {
                marks.set(n, (row[i + 1] ?? '').includes('✅'));
            });
            cells.set(label, marks);
        } else if (mode === 'summary' && label !== '') {
            summary.set(label, Number((row[1] ?? '').replace(/\*\*/g, '')));
        }
    }
    return { headerNouns, cells, verbCountRow, summary };
}

// ---------------------------------------------------------------------------
// Tests.
// ---------------------------------------------------------------------------

describe('help-docs parity', () => {
    test('R1: every spur invocation in docs/help{,2} names a live noun/verb/flag', () => {
        const documentedNotOnCli: string[] = [];
        for (const inv of scanInvocations()) {
            if (inv.noun === HELP_NOUN) continue; // generated `spur help` is documented but not gated (matches cli-surface-parity)
            if (!surface.has(inv.noun)) {
                documentedNotOnCli.push(`${inv.file}: unknown noun \`spur ${inv.noun}\``);
                continue;
            }
            if (inv.verb && !surface.get(inv.noun)?.has(inv.verb) && !HIDDEN_VERBS[inv.noun]?.includes(inv.verb)) {
                documentedNotOnCli.push(`${inv.file}: unknown verb \`spur ${inv.noun} ${inv.verb}\``);
                continue;
            }
            const liveFlags = inv.verb ? live([inv.noun, inv.verb]).flags : undefined;
            for (const flag of inv.flags) {
                if (liveFlags && !liveFlags.includes(flag) && !FLAG_EXEMPT.has(flag)) {
                    documentedNotOnCli.push(
                        `${inv.file}: unknown flag \`${flag}\` on \`spur ${inv.noun} ${inv.verb}\``,
                    );
                }
            }
        }
        documentedNotOnCli.sort();
        expect(documentedNotOnCli).toEqual([]);
    });

    test('R2: every live verb and flag is documented in the owning pages of each tree', () => {
        const onCliNotDocumented: string[] = [];
        for (const pages of pageMaps) {
            const tree = pages === pageMaps[0] ? 'docs/help' : 'docs/help2';
            for (const [noun, files] of pages) {
                let text: string;
                try {
                    text = pageTexts(files);
                } catch {
                    onCliNotDocumented.push(
                        `${tree}: missing owning page(s) for noun \`${noun}\`: ${files.join(', ')}`,
                    );
                    continue;
                }
                for (const verb of surface.get(noun)?.keys() ?? []) {
                    if (!mentions(text, verb))
                        onCliNotDocumented.push(
                            `${tree}: live verb \`${noun} ${verb}\` undocumented in ${files.join(', ')}`,
                        );
                }
                // flag → verbs carrying it, so a failure names the full `<noun> <verb> <flag>` path.
                const flagVerbs = new Map<string, string[]>();
                for (const [verb, flags] of surface.get(noun) ?? []) {
                    for (const flag of flags.filter((f) => !FLAG_EXEMPT.has(f))) {
                        flagVerbs.set(flag, [...(flagVerbs.get(flag) ?? []), verb]);
                    }
                }
                for (const [flag, verbs] of flagVerbs) {
                    if (!mentions(text, flag))
                        onCliNotDocumented.push(
                            `${tree}: live flag \`${noun} ${verbs.join('|')} ${flag}\` undocumented in ${files.join(', ')}`,
                        );
                }
            }
        }
        onCliNotDocumented.sort();
        expect(onCliNotDocumented).toEqual([]);
    });

    test('R3: spur-cli-matrix.md cells, verb counts, and summary equal the live surface', () => {
        const matrix = parseMatrix();
        const problems: string[] = [];
        const expectedNouns = [...surface.keys()].sort();
        if (matrix.headerNouns.slice().sort().join(',') !== expectedNouns.join(',')) {
            problems.push(
                `matrix header nouns ${JSON.stringify(matrix.headerNouns)} ≠ live ${JSON.stringify(expectedNouns)}`,
            );
        }
        const documentedNotOnCli: string[] = [];
        const onCliNotDocumented: string[] = [];
        for (const [verb, marks] of matrix.cells) {
            for (const [noun, checked] of marks) {
                const liveHas = surface.get(noun)?.has(verb) ?? false;
                if (checked && !liveHas) documentedNotOnCli.push(`matrix ✅ cell \`${noun} ${verb}\` is not live`);
                if (!checked && liveHas) onCliNotDocumented.push(`matrix missing ✅ cell \`${noun} ${verb}\``);
            }
        }
        for (const verb of uniqueVerbs) {
            if (!matrix.cells.has(verb)) onCliNotDocumented.push(`matrix has no row for live verb \`${verb}\``);
        }
        for (const [noun, count] of matrix.verbCountRow) {
            const liveCount = surface.get(noun)?.size ?? 0;
            if (count !== liveCount)
                problems.push(`matrix Verb count for \`${noun}\` is ${count}, live is ${liveCount}`);
        }
        const expectedSummary: Record<string, number> = {
            'Total nouns': surface.size + HIDDEN_ALIASES.length,
            'Compound nouns (with verbs)': surface.size,
            'Hidden legacy aliases': HIDDEN_ALIASES.length,
            'Unique verbs': uniqueVerbs.size,
            'Total noun×verb cells': totalCells,
        };
        for (const [metric, expected] of Object.entries(expectedSummary)) {
            const actual = matrix.summary.get(metric);
            if (actual !== expected) problems.push(`matrix Summary "${metric}" is ${actual}, live is ${expected}`);
        }
        documentedNotOnCli.sort();
        onCliNotDocumented.sort();
        expect([...documentedNotOnCli, ...onCliNotDocumented, ...problems]).toEqual([]);
    });
});
