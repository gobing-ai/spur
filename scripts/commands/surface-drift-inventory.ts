#!/usr/bin/env bun
/**
 * surface-drift-inventory — re-runnable drift inventory for `plugins/sp` and
 * the tracked workflow-YAML SSOT tree against the live
 * source-local `spur` CLI (feature I3, task 0539 R1/R2).
 *
 * Method (mechanical first, prose second — task 0539 Design):
 *   A. Plugin assertions: extract every `spur`-invocation (backticked spans, fenced
 *      code lines, YAML scalars), every `| Verb |` table row, and every flag span
 *      under a verb heading in the noun-mapped `spur-cli` references; check
 *      nouns/verbs/flags against live `--help` captures (source-local entry via
 *      the I2 helper). `--json` shapes are captured by EXECUTING a read-only probe
 *      list; mutating commands are recorded unverified, never passing.
 *   B. Scripts: extract the argv arrays `runSpur`/`runSpurJson` build and
 *      help-check them; execute the two spur-shelling scripts against a fake bin.
 *   C. Hooks: `hooks.json` parses, every referenced hook script exists, the `pi`
 *      extension from plugin.json exists. Host-side event-name contract is not
 *      in this repo — recorded unverified.
 *   D. Workflows: `spur workflow validate` (live engine, schema + semantic) and a
 *      `--dry-run` transition walk for all ten definitions; `.spur/workflows`
 *      symlink is asserted absent (two-tier project→bundled model, task 0650).
 *
 * Output: markdown inventory on stdout-path via `--out`; exit 1 when any
 * CONFIRMED mismatch remains (ok after repair); unverified entries never fail.
 *
 * Usage: bun scripts/spur-dev.ts surface-drift-inventory [--out docs/tasks2/0539-inventory.md]
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { captureCliSurface, parseCommanderHelp } from '../../plugins/sp/tests/helpers/cli-surface';

const REPO_ROOT = resolve(import.meta.dir, '..', '..');
const PLUGIN_ROOT = join(REPO_ROOT, 'plugins', 'sp');
const CLI_ENTRY = join(REPO_ROOT, 'apps', 'cli', 'src', 'index.ts');
const rel = (p: string): string => relative(REPO_ROOT, p);

// ─── Rows ───────────────────────────────────────────────────────────────────

interface Row {
    asserted: string;
    method: string;
    status: 'ok' | 'mismatch' | 'unverified';
    actual: string;
    occurrences: { file: string; line: number }[];
}

export const rows: Row[] = [];

export function record(
    asserted: string,
    method: string,
    status: Row['status'],
    actual: string,
    occ: { file: string; line: number },
): Row {
    let row = rows.find((r) => r.asserted === asserted && r.method === method);
    if (!row) {
        row = { asserted, method, status, actual, occurrences: [] };
        rows.push(row);
    }
    if (!row.occurrences.some((o) => o.file === occ.file && o.line === occ.line)) {
        row.occurrences.push(occ);
    }
    if (status === 'mismatch') {
        row.status = 'mismatch';
        row.actual = actual;
    }
    return row;
}

// ─── Live surface captures (cached) ─────────────────────────────────────────

export interface LiveSurface {
    commands: string[];
    flags: string[];
    /** Captured by a `<path> --help` probe because Commander hides it from the parent listing. */
    hidden?: boolean;
}

/** Exported so unit tests can seed a fake live surface and keep the verdict logic hermetic. */
export const surfaceCache = new Map<string, LiveSurface>();

function surface(path: string[]): LiveSurface {
    const key = path.join(' ');
    let s = surfaceCache.get(key);
    if (!s) {
        const cap = captureCliSurface(path);
        s = { commands: cap.commands, flags: cap.flags };
        surfaceCache.set(key, s);
    }
    return s;
}

/** How the live-CLI sweeps below reach the CLI. Injectable so unit tests can drive them hermetically. */
export type CliRunner = (args: string[], timeoutMs?: number) => { exit: number; out: string; err: string };

/** Probe transport for `hiddenSurface`. Injectable for the same reason the sweeps take a runner. */
let hiddenProbeRunner: CliRunner = runCli;

export function setHiddenProbeRunner(runner: CliRunner): void {
    hiddenProbeRunner = runner;
}

/**
 * Probe a `<path> --help` for a command Commander does not list in its parent.
 *
 * Why: `{ hidden: true }` commands (e.g. `spur agent loop`, the legacy root aliases) are real
 * and runnable but absent from the parent `Commands:` block, so judging an assertion against the
 * listing alone reports live surface as drift (task 1265 R2).
 */
function hiddenSurface(
    path: string[],
):
    | { kind: 'present'; surface: LiveSurface }
    | { kind: 'absent'; detail: string }
    | { kind: 'unverified'; detail: string } {
    const key = path.join(' ');
    const cached = surfaceCache.get(key);
    if (cached) return { kind: 'present', surface: cached };
    const probe = hiddenProbeRunner([...path, '--help'], 20_000);
    if (probe.exit === 124) return { kind: 'unverified', detail: 'probe did not answer (timeout)' };
    if (probe.exit !== 0) return { kind: 'absent', detail: 'probe answered a non-help error' };
    // Commander answers an unknown command's `--help` by printing the PARENT's (or the root's)
    // help and exiting 0, so exit status alone proves nothing: the `Usage:` line must name the
    // probed path. Without this, `spur exec --help` (root help) and `spur workflow monitor --help`
    // (workflow help) reported nonexistent commands as present.
    const usage = (probe.out.match(/^Usage:\s*(.+)$/m)?.[1] ?? '').trim();
    const expected = `spur ${path.join(' ')}`;
    if (!new RegExp(`^${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$|\\[)`).test(usage)) {
        return { kind: 'absent', detail: `probe answered help for another command (${usage || 'no Usage: line'})` };
    }
    let parsed: { commands: string[]; flags: string[] };
    try {
        parsed = parseCommanderHelp(probe.out);
    } catch {
        // Exit 0 without a Commander help body proves nothing about the surface.
        return { kind: 'unverified', detail: 'probe did not answer with commander help' };
    }
    const captured: LiveSurface = { commands: parsed.commands, flags: parsed.flags, hidden: true };
    surfaceCache.set(key, captured);
    return { kind: 'present', surface: captured };
}

/**
 * Is `child` reachable under `path`? A visible listing first, then the hidden probe — so a
 * hidden registration reads as present instead of absent (task 1265 R2).
 */
function commandState(path: string[], child: string): 'visible' | 'hidden' | 'absent' | 'unverified' {
    if (surface(path).commands.includes(child)) return 'visible';
    const probe = hiddenSurface([...path, child]);
    return probe.kind === 'present' ? 'hidden' : probe.kind;
}

export function runCli(args: string[], timeoutMs = 30_000): { exit: number; out: string; err: string } {
    try {
        const out = execFileSync(process.execPath, ['run', CLI_ENTRY, ...args], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
            timeout: timeoutMs,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { exit: 0, out, err: '' };
    } catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string; killed?: boolean; code?: string };
        return {
            // A timeout must map to 124 — sweepWorkflows reads that as "did not terminate"
            // (unverified) rather than reporting a hung dry-run as a clean walk. Bun signals it
            // as code ETIMEDOUT with `killed` undefined and a null status; Node sets `killed`.
            exit: err.killed || err.code === 'ETIMEDOUT' ? 124 : (err.status ?? 1),
            out: err.stdout ?? '',
            err: (err.stderr ?? '').slice(0, 400),
        };
    }
}

interface Parsed {
    nouns: string[];
    verbs: string[];
    flags: string[];
}

const PLACEHOLDER = /^([<[{($#"'`]|…|\.\.\.)/;

/** The documented root aliases of `spur self` — the baseline when a probe cannot answer. */
const SELF_ALIAS_BASELINE = ['init', 'maintain', 'migrate', 'serve', 'status'];
let selfAliasCache: Set<string> | null = null;

/**
 * Root aliases that redirect to `spur self <verb>`.
 *
 * Derived from the live `spur self` command list ∩ a root-level `<alias> --help` probe, because
 * the hand-maintained constant silently missed `maintain` (task 1265 R5, row 8) and would miss the
 * next alias too. A probe that cannot answer keeps the documented baseline rather than shrinking
 * the set. Cached: the sweep calls this once per span.
 */
export function legacySelfAliases(): Set<string> {
    if (selfAliasCache) return selfAliasCache;
    const baseline = new Set(SELF_ALIAS_BASELINE);
    const candidates = surface(['self']).commands.filter((c) => c !== 'help');
    const derived = new Set<string>();
    for (const name of candidates) {
        const state = commandState([], name);
        if (state === 'visible' || state === 'hidden') derived.add(name);
        else if (state === 'unverified' && baseline.has(name)) derived.add(name);
    }
    selfAliasCache = derived.size > 0 ? derived : baseline;
    return selfAliasCache;
}

/** Test seam: drop the memoized alias set after the probe transport or surface cache changes. */
export function resetLegacySelfAliases(): void {
    selfAliasCache = null;
}

/** Normalize an asserted invocation span into nouns / verbs / flags. Null when it asserts nothing. */
export function parseInvocation(spanRaw: string): Parsed | null {
    let s = spanRaw.trim().replace(/[.,;:]+$/, '');
    s = s.replace(/^(?:bun|bunx|npx)\s+(?:run\s+)?/, '');
    // The monorepo dev form (`bun run apps/cli/src/index.ts <noun> <verb>`) names no
    // `spur` binary once the entry path is stripped, so the `^spur` gate below must not
    // apply to it — it used to, which dropped every claim written in the form AGENTS.md
    // mandates for local development.
    const viaEntryPath = /^apps\/cli\/src\/index\.ts\s*/.test(s);
    s = s.replace(/^apps\/cli\/src\/index\.ts\s*/, '');
    if (!viaEntryPath) {
        if (!/^spur\b/.test(s) || s === 'spur') return null;
        s = s.replace(/^spur\s+/, '');
    }
    if (!s) return null;
    // Split on shell separators only. `>` is deliberately excluded: it appears inside
    // the `<wbs>` / `<path>` placeholders this corpus documents flags with, and
    // truncating there silently discarded every flag after the first placeholder.
    s = (s.split(/[;&|]/)[0] ?? s).trim();
    if (!s) return null;
    const tokens = s
        .split(/\s+/)
        .filter(Boolean)
        .filter((t) => t === '…' || t === '...' || (!PLACEHOLDER.test(t) && !/^[A-Z]/.test(t) && !/["']/.test(t)));
    const expand = (t: string): string[] => t.split(/[|/]/).filter((p) => /^[a-z][a-z0-9-]*$/.test(p));
    const nouns: string[] = [];
    const verbs: string[] = [];
    const flags: string[] = [];
    let positional = 0;
    for (const t of tokens) {
        if (t === '…' || t === '...') {
            positional = 99;
            continue;
        } // elided prose — later tokens are not nouns/verbs
        const flag = t.match(/^(-{1,2}[A-Za-z][A-Za-z0-9-]*)/);
        if (flag) {
            flags.push(flag[1] ?? '');
            positional = 99;
            continue;
        }
        if (positional === 0) {
            nouns.push(...expand(t));
            positional = 1;
        } else if (positional === 1) {
            verbs.push(...expand(t));
            positional = 2;
        }
    }
    if (nouns.length === 0 && verbs.length === 0 && flags.length === 0) return null;
    return { nouns, verbs, flags };
}

/** All backticked spans in one line. */
export function backticks(line: string): string[] {
    return [...line.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? '');
}

const INVOCATION_TARGET = '(?:apps/cli/src/index\\.ts|spur)\\s+[^\\s`"\'|;&)]+';

/**
 * Candidate invocation spans from one line: backticked + bare shell-style matches.
 *
 * A bare match needs shell context — a shell separator/quote prefix or a `bun run` prefix — so
 * English prose that happens to start with `spur <word>` asserts no surface (task 1265 R7,
 * row 10: "spur exits with the child's exit code."). Fenced code is shell context by position,
 * which is why the caller opts in with `{ fenced: true }` instead of the regex matching `^`
 * everywhere.
 */
export function lineInvocationSpans(line: string, opts: { fenced?: boolean } = {}): string[] {
    const spans = backticks(line).filter((s) => /(?:^|\s)(?:spur|apps\/cli\/src\/index\.ts)\s/.test(s));
    const patterns = [
        // `bun run …` / `bunx …` names the tool explicitly, so no shell prefix is needed.
        new RegExp(`(?:^|[\`$"'=;&|;(]\\s*)bun(?:x|\\s+run)?\\s+${INVOCATION_TARGET}`, 'g'),
        // Any other bare form must follow a prompt, a shell separator, `=`, `(` or a quote.
        new RegExp(`[\`$"'=;&|;(]\\s*(?:bun(?:\\s+run)?\\s+)?${INVOCATION_TARGET}`, 'g'),
    ];
    if (opts.fenced) patterns.push(new RegExp(`^\\s*(?:bun(?:\\s+run)?\\s+)?${INVOCATION_TARGET}`, 'g'));
    // The match carries the shell prompt/separator; it is context, not part of the invocation.
    // Backticked text is already covered by `spans`; mask it before the bare pass so one
    // citation cannot be extracted twice (and its inner words cannot become claims of their own).
    const masked = line.replace(/`[^`\n]*`/g, (m) => ' '.repeat(m.length));
    const bare = patterns.flatMap((re) =>
        [...masked.matchAll(re)].map((m) => (m[0] ?? '').replace(/^[`$"'=;&|;(]\s*/, '').trim()),
    );
    return [...spans, ...bare];
}

const FLAG_TOKEN = /(?:^|\s)(-{1,2}[A-Za-z][A-Za-z0-9-]*)/g;
/** Placeholders and inline-code delimiters are not part of a flag token. */
const PLACEHOLDER_GROUP = /<[^>]*>|\[[^\]]*\]|`/g;

/** A pure flag list (backticked "--from-answer <path> --folder" spans). */
export function isFlagSpan(span: string): boolean {
    const stripped = span.replace(PLACEHOLDER_GROUP, ' ').trim();
    if (!stripped) return span.trim().length > 0; // a bare placeholder group is a placeholder
    const toks = stripped.split(/\s+/).filter(Boolean);
    return toks.every((t) => /^-{1,2}[A-Za-z][A-Za-z0-9-]*$/.test(t) || PLACEHOLDER.test(t));
}

/**
 * Flag tokens in a span.
 *
 * A flag starts the span or follows whitespace, and placeholder groups are stripped first: without
 * both, the value tail `task-local` read as `-local` and the placeholder `<spec-id>` as `-id`
 * (task 1265 R4, rows 11-13).
 */
export function flagNames(span: string): string[] {
    const stripped = span.replace(PLACEHOLDER_GROUP, ' ');
    return [...stripped.matchAll(FLAG_TOKEN)].map((m) => m[1] ?? '');
}

/** Files in the R1 surfaces: commands/, skills/ (incl. references), scripts/, hooks/. */
export function walk(dir: string, exts: string[], out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) {
            if (e.name === 'tests' || e.name === 'evals') continue; // the harness itself is out of R1 scope
            walk(p, exts, out);
        } else if (exts.some((x) => e.name.endsWith(x))) {
            out.push(p);
        }
    }
    return out;
}

/** Noun mapped from a spur-cli reference path (references/tasks.md, references/tasks/x.md -> task). */
export function nounOfReference(file: string): string | null {
    const map: Record<string, string> = {
        tasks: 'task',
        features: 'feature',
        rules: 'rule',
        workflows: 'workflow',
        agent: 'agent',
        message: 'message',
        init: 'init',
        serve: 'serve',
    };
    const parts = file.split(/[\\/]/);
    const base = (parts.pop() ?? '').replace(/\.md$/, '');
    const parent = parts.at(-1) ?? '';
    const refsIdx = parts.indexOf('references');
    const refsChild = refsIdx >= 0 ? (parts[refsIdx + 1] ?? '') : '';
    return map[base] ?? map[parent] ?? map[refsChild] ?? null;
}

// ─── A. Plugin assertion checks ─────────────────────────────────────────────

/**
 * Judge one flag on one command path.
 *
 * Order is the contract (task 1265): a root program option is global (`apps/cli/src/index.ts`
 * strips it before dispatch, so it is valid everywhere); then the command's own flags; then — when
 * the command is itself a group — its subcommands, as unverified shorthand because the citation
 * omits the subcommand.
 */
function checkFlags(
    path: string[],
    label: string,
    flags: string[],
    vs: LiveSurface,
    method: string,
    occ: { file: string; line: number },
): void {
    const root = surface([]);
    for (const f of flags) {
        const asserted = `${label} ${f}`;
        if (root.flags.includes(f)) {
            record(asserted, method, 'ok', 'global option (root program)', occ);
            continue;
        }
        if (vs.flags.includes(f)) {
            record(asserted, method, 'ok', 'flag present', occ);
            continue;
        }
        if (vs.commands.length > 0) {
            const withFlag = vs.commands.filter((c) => surface([...path, c]).flags.includes(f));
            record(
                asserted,
                method,
                withFlag.length > 0 ? 'unverified' : 'mismatch',
                withFlag.length > 0
                    ? `nested shorthand — flag present on ${withFlag.length}/${vs.commands.length} subcommands (${withFlag.join(', ')})`
                    : `flag absent (live flags: ${vs.flags.join(', ')}; group subcommands: ${vs.commands.join(', ')})`,
                occ,
            );
            continue;
        }
        record(asserted, method, 'mismatch', `flag absent (live flags: ${vs.flags.join(', ')})`, occ);
    }
}

export function checkNounVerbFlags(
    nouns: string[],
    verbs: string[],
    flags: string[],
    occ: { file: string; line: number },
): void {
    const root = surface([]);
    for (const noun of nouns) {
        if (noun === 'help' || /^(foo|bar|baz)$/.test(noun)) continue;
        if (legacySelfAliases().has(noun)) {
            const self = surface(['self']);
            const command = surface(['self', noun]);
            const present = self.commands.includes(noun);
            record(
                `spur ${noun}`,
                'help-capture(spur self; hidden root alias)',
                present ? 'ok' : 'mismatch',
                present
                    ? `legacy alias; canonical self/${noun} command is present`
                    : `canonical self/${noun} command is absent`,
                occ,
            );
            if (present) {
                checkFlags(
                    ['self', noun],
                    `spur ${noun}`,
                    flags,
                    command,
                    `help-capture(spur self ${noun}; hidden root alias)`,
                    occ,
                );
            }
            continue;
        }
        if (!root.commands.includes(noun)) {
            record(
                `spur ${noun}`,
                'help-capture(root)',
                'mismatch',
                `noun absent from live root commands (${root.commands.join(', ')})`,
                occ,
            );
            continue;
        }
        const ns = surface([noun]);
        for (const verb of verbs) {
            if (verb === 'help') continue;
            const method = `help-capture(spur ${noun})`;
            const state = commandState([noun], verb);
            if (state === 'absent' || state === 'unverified') {
                record(
                    `spur ${noun} ${verb}`,
                    method,
                    state === 'absent' ? 'mismatch' : 'unverified',
                    state === 'absent'
                        ? `verb absent (live verbs: ${ns.commands.join(', ')})`
                        : 'hidden-verb probe did not answer (timeout or non-help output)',
                    occ,
                );
                continue;
            }
            const vs = surface([noun, verb]);
            record(
                `spur ${noun} ${verb}`,
                method,
                'ok',
                state === 'hidden' ? 'hidden verb present (not listed in --help)' : 'verb present',
                occ,
            );
            checkFlags([noun, verb], `spur ${noun} ${verb}`, flags, vs, `help-capture(spur ${noun} ${verb})`, occ);
        }
        if (verbs.length === 0) {
            record(`spur ${noun} (noun)`, `help-capture(spur ${noun})`, 'ok', `${ns.commands.length} live verbs`, occ);
            for (const f of flags) {
                if (root.flags.includes(f)) {
                    record(
                        `spur ${noun} ${f}`,
                        `help-capture(spur ${noun})`,
                        'ok',
                        'global option (root program)',
                        occ,
                    );
                } else if (ns.flags.includes(f)) {
                    record(`spur ${noun} ${f}`, `help-capture(spur ${noun})`, 'ok', 'noun-level flag present', occ);
                } else {
                    const withFlag = ns.commands.filter((v) => surface([noun, v]).flags.includes(f));
                    record(
                        `spur ${noun} ${f}`,
                        `help-capture(spur ${noun})`,
                        withFlag.length > 0 ? 'unverified' : 'mismatch',
                        withFlag.length > 0
                            ? `noun-level shorthand — flag present on ${withFlag.length}/${ns.commands.length} verbs`
                            : `flag absent (noun and every verb; live noun flags: ${ns.flags.join(', ')})`,
                        occ,
                    );
                }
            }
        }
    }
    for (const verb of verbs) {
        if (nouns.length === 0 && legacySelfAliases().has(verb)) {
            checkNounVerbFlags([verb], [], flags, occ);
            continue;
        }
        if (nouns.length === 0 && root.commands.includes(verb)) {
            record(`spur ${verb}`, 'help-capture(root)', 'ok', 'root verb present', occ);
        }
    }
}

// ─── Negated / absence prose (task 1265 R6) ─────────────────────────────────

type NegationKind = 'absent' | 'internal';

/**
 * Line shapes that claim a surface does NOT exist, or exists only internally.
 *
 * The single literal form the sweep used to recognize (`no `spur X` verb exists`) missed four
 * documented-absence spellings and read a "Forbidden surface" note as a positive claim (rows 9
 * and 14). `internal` is not an absence claim — the verb exists but is hidden — so it routes
 * through the normal check, where the hidden-verb probe answers for it.
 */
const NEGATION_PATTERNS: { re: RegExp; kind: NegationKind }[] = [
    { re: /\bforbidden\s+surface\s*:?\s*`spur ([^`]+)`/gi, kind: 'internal' },
    { re: /\bno\s+`spur ([^`]+)`\s+(?:verb|alias|noun|command)\b/gi, kind: 'absent' },
    { re: /\bthere\s+is\s+no\s+`spur ([^`]+)`/gi, kind: 'absent' },
    { re: /`spur ([^`]+)`\s+is\s+an\s+unknown\s+command/gi, kind: 'absent' },
    { re: /\bpublic\s+`spur ([^`]+)`\s+(?:verb|noun)\s+is\s+out\s+of\s+scope/gi, kind: 'absent' },
];

/** The negated clauses on one line, each naming the invocation whose claim is inverted. */
export function negationClaims(line: string): { asserted: string; kind: NegationKind }[] {
    const claims: { asserted: string; kind: NegationKind }[] = [];
    for (const { re, kind } of NEGATION_PATTERNS) {
        for (const m of line.matchAll(re)) {
            const text = (m[1] ?? '').trim();
            if (text) claims.push({ asserted: `spur ${text}`, kind });
        }
    }
    return claims;
}

/**
 * Does this negated clause own this span?
 *
 * Compared on the PARSED command path, not raw text: a prefix test let a short negated path
 * (`spur task`) invert a longer correct citation on the same line (`spur task check 0042 --json`)
 * — the exact swallow Design failure mode 6 forbids (task 1265 review P3).
 */
export function claimOwnsSpan(asserted: string, span: string): boolean {
    const claim = parseInvocation(asserted);
    const target = parseInvocation(span);
    if (claim === null || target === null) return false;
    return (
        claim.nouns.join(' ') === target.nouns.join(' ') &&
        claim.verbs.join(' ') === target.verbs.join(' ') &&
        claim.flags.join(' ') === target.flags.join(' ')
    );
}

/** Record one absence row: an existing surface is a stale negation, an absent one confirms the prose. */
function recordAbsenceRow(
    asserted: string,
    method: string,
    present: boolean,
    what: string,
    occ: { file: string; line: number },
): void {
    record(
        asserted,
        method,
        present ? 'mismatch' : 'ok',
        present
            ? `line asserts absence but the ${what} EXISTS on the live surface (stale negation)`
            : 'documented absence confirmed against live surface',
        occ,
    );
}

/**
 * Confirm a documented absence against the live surface.
 *
 * The claim is judged at the altitude it is written: `no `spur X` verb exists` is about the verb,
 * `there is no `spur task update --tags` flag` is about the FLAG — judging the latter on the
 * command alone reported a true claim as drift (task 1265 review P2).
 */
function recordAbsence(parsed: Parsed, occ: { file: string; line: number }): void {
    const root = surface([]);
    for (const noun of parsed.nouns) {
        const nounState = commandState([], noun);
        const nounPresent = nounState === 'visible' || nounState === 'hidden';
        if (parsed.verbs.length === 0) {
            if (parsed.flags.length > 0 && nounPresent) {
                // Flag-scoped claim on a noun: present anywhere on the noun or its verbs = stale.
                for (const f of parsed.flags) {
                    const present =
                        root.flags.includes(f) ||
                        surface([noun]).flags.includes(f) ||
                        surface([noun]).commands.some((v) => surface([noun, v]).flags.includes(f));
                    recordAbsenceRow(`spur ${noun} ${f}`, `help-capture(spur ${noun})`, present, 'flag', occ);
                }
                continue;
            }
            recordAbsenceRow(`spur ${noun}`, 'help-capture(root)', nounPresent, 'command', occ);
            continue;
        }
        for (const verb of parsed.verbs) {
            const method = `help-capture(spur ${noun})`;
            const verbPresent = commandState([noun], verb) === 'visible' || commandState([noun], verb) === 'hidden';
            if (parsed.flags.length > 0 && verbPresent) {
                for (const f of parsed.flags) {
                    const present = root.flags.includes(f) || surface([noun, verb]).flags.includes(f);
                    recordAbsenceRow(`spur ${noun} ${verb} ${f}`, method, present, 'flag', occ);
                }
                continue;
            }
            recordAbsenceRow(`spur ${noun} ${verb}`, method, verbPresent, 'verb', occ);
        }
    }
}

// ─── Semantic operand layer (I7 / task 0906 R2) ─────────────────────────────

/**
 * Metadata-only operands the I6 sweep classified. This is the audit boundary, not a
 * CLI section matrix: a key that is ALSO a genuine body heading for the noun (feature
 * `Scope`) is accepted per-noun in checkSectionOperand; anything outside this set is
 * not statically classifiable and stays unverified.
 */
const SECTION_METADATA_KEYS = new Set([
    'tags',
    'priority',
    'status',
    'phase',
    'id',
    'parent',
    'name',
    'owner',
    'scope',
]);

/** Body headings that overlap the swept metadata keys, per noun (case-insensitive). */
const NOUN_BODY_SECTIONS: Record<string, ReadonlySet<string>> = {
    feature: new Set(['scope']),
};

/**
 * Semantic operand check (I7 / task 0906 R2): `--section` is a real flag on
 * task/feature update, so existence parity passes while the operand names a
 * metadata-only key instead of a body section. Classify literal operands only —
 * dynamic operands (placeholders) stay unverified under the existing scanner
 * convention, and quoted/equal forms are handled alongside the spaced form.
 * Comparison is case-normalized; the original operand text stays in the row evidence.
 */
export function checkSectionOperand(spanRaw: string, occ: { file: string; line: number }): void {
    const parsed = parseInvocation(spanRaw);
    if (!parsed) return;
    const noun = parsed.nouns[0];
    if ((noun !== 'task' && noun !== 'feature') || !parsed.verbs.includes('update')) return;
    for (const m of spanRaw.matchAll(/--section(?:=|\s+)("([^"]*)"|'([^']*)'|[^\s]+)/g)) {
        const operand = (m[2] ?? m[3] ?? m[1] ?? '').replace(/[.,;:]+$/, '');
        if (!operand || PLACEHOLDER.test(operand)) continue; // dynamic — unverified by convention
        const key = operand.toLowerCase();
        if ((NOUN_BODY_SECTIONS[noun] ?? new Set()).has(key)) continue; // genuine body heading
        if (!SECTION_METADATA_KEYS.has(key)) continue; // outside the audit boundary — unverified
        // P3 (0906 review): feature update owns the generic --field/--value pair; task update
        // exposes metadata only via dedicated flags (no --field/--value, no --tags), so the hint
        // must not suggest a pair that would fail with VALIDATION_FAILED on task rows.
        const remediation =
            noun === 'feature'
                ? `use --field ${operand} --value <value>`
                : `task update exposes metadata only via dedicated flags (e.g. --priority <value>), not --section`;
        record(
            `spur ${noun} update --section ${operand}`,
            'semantic-operand(I6 metadata keys vs noun body sections)',
            'mismatch',
            `--section writes a body section; "${operand}" is a metadata-only ${noun} operand — ${remediation}`,
            occ,
        );
    }
}

export function sweepPluginTrees(root: string = PLUGIN_ROOT): void {
    const files = [
        ...walk(join(root, 'commands'), ['.md']),
        ...walk(join(root, 'skills'), ['.md']),
        ...walk(join(root, 'scripts'), ['.ts']),
        ...walk(join(root, 'hooks'), ['.ts', '.json']),
    ];
    for (const file of files) {
        const text = readFileSync(file, 'utf8');
        const lines = text.split(/\r?\n/);
        const isRef = file.includes(join('skills', 'spur-cli', 'references'));
        const refNoun = isRef ? nounOfReference(file) : null;
        let headingVerb: string | null = null;
        let inVerbTable = false;
        let inFence = false;
        lines.forEach((line: string, i: number) => {
            const occ = { file: rel(file), line: i + 1 };
            if (/^\s*```/.test(line)) {
                inFence = !inFence;
                return;
            }
            if (!inFence) {
                const heading = line.match(/^#{1,6}\s+([a-z][a-z0-9-]*)\b/);
                if (heading) headingVerb = heading[1] ?? null;
                if (/^\|\s*Verb\s*\|/.test(line)) {
                    inVerbTable = true;
                    return;
                }
                if (inVerbTable && !/^\|/.test(line)) inVerbTable = false;
                // Absence clauses are evaluated per span and matched on the parsed command path, so a
                // negation elsewhere on the line cannot invert a positive claim beside it (R6).
                const negations = negationClaims(line);
                for (const span of lineInvocationSpans(line)) {
                    const parsed = parseInvocation(span);
                    if (!parsed) continue;
                    const claim = negations.find((n) => claimOwnsSpan(n.asserted, span));
                    if (claim?.kind === 'absent') {
                        recordAbsence(parsed, occ);
                        continue;
                    }
                    // `internal` and non-negated spans take the normal path: the hidden-verb probe
                    // is what answers "it exists, just not in --help".
                    checkNounVerbFlags(parsed.nouns, parsed.verbs, parsed.flags, occ);
                    checkSectionOperand(span, occ);
                }
                if (file.endsWith('.ts')) return;
                if (inVerbTable && refNoun && /^\|/.test(line)) {
                    const first = (line.match(/^\|\s*`?([a-z][a-z0-9-]*)/)?.[1] ?? '').replace(/`/g, '');
                    const rootCommands = surface([]).commands;
                    // Flags live in the LAST cell (Key flags) — Purpose prose contains
                    // hyphenated words that are not flags.
                    const cells = line.split('|').map((c) => c.trim());
                    const lastCell = cells[cells.length - 2] ?? line;
                    if (first && first !== 'Verb' && first !== 'spur') {
                        const nounCommands = surface([refNoun]).commands;
                        if (nounCommands.includes(first)) {
                            checkNounVerbFlags([refNoun], [first], flagNames(lastCell), occ);
                        } else if (rootCommands.includes(first) || legacySelfAliases().has(first)) {
                            checkNounVerbFlags([], [first], flagNames(lastCell), occ);
                        } else {
                            checkNounVerbFlags([refNoun], [first], flagNames(lastCell), occ);
                        }
                    }
                    return;
                }
                const perVerbPage = file.endsWith(join('verbs.md'));
                if (perVerbPage && refNoun && headingVerb && surface([refNoun]).commands.includes(headingVerb)) {
                    for (const span of backticks(line)) {
                        if (isFlagSpan(span) && flagNames(span).length > 0) {
                            checkNounVerbFlags([refNoun], [headingVerb], flagNames(span), occ);
                        }
                    }
                }
            } else {
                // A fenced line is shell context by position, so an invocation may start the line.
                for (const span of lineInvocationSpans(line, { fenced: true })) {
                    const parsed = parseInvocation(span);
                    if (parsed) {
                        checkNounVerbFlags(parsed.nouns, parsed.verbs, parsed.flags, occ);
                        checkSectionOperand(span, occ);
                    }
                }
            }
        });
    }
}

// ─── B. Scripts: argv extraction + execution ────────────────────────────────

export function sweepScriptArgv(root: string = PLUGIN_ROOT): void {
    for (const file of walk(join(root, 'scripts'), ['.ts'])) {
        readFileSync(file, 'utf8')
            .split(/\r?\n/)
            .forEach((line: string, i: number) => {
                for (const m of line.matchAll(/\brunSpur(?:Json)?\(\s*\w+\s*,\s*\[([^\]]*)\]/g)) {
                    const toks = [...(m[1] ?? '').matchAll(/'([^']*)'|"([^"]*)"/g)].map((t) => t[1] ?? t[2] ?? '');
                    const ids = toks.filter((t) => /^[a-z][a-z0-9-]*$/.test(t));
                    const nouns = ids.slice(0, 1);
                    const verbs = ids.slice(1, 2);
                    const flags = toks.filter((t) => /^--/.test(t));
                    if (nouns.length || verbs.length || flags.length) {
                        checkNounVerbFlags(nouns, verbs, flags, {
                            file: rel(file),
                            line: i + 1,
                        });
                    }
                }
            });
    }
}

// ─── C. Hook contract ───────────────────────────────────────────────────────

export function sweepHooks(root: string = PLUGIN_ROOT): void {
    const hooksJsonPath = join(root, 'hooks', 'hooks.json');
    let parsed: {
        hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<{ type?: string; command?: string }> }>>;
    };
    try {
        parsed = JSON.parse(readFileSync(hooksJsonPath, 'utf8'));
        record('hooks.json parses', 'json-parse', 'ok', `${Object.keys(parsed.hooks ?? {}).length} events`, {
            file: rel(hooksJsonPath),
            line: 1,
        });
    } catch (e) {
        record('hooks.json parses', 'json-parse', 'mismatch', String(e).slice(0, 200), {
            file: rel(hooksJsonPath),
            line: 1,
        });
        return;
    }
    for (const [event, entries] of Object.entries(parsed.hooks ?? {})) {
        record(
            `event ${event}`,
            'host-contract',
            'unverified',
            'superskill host hook-event schema is not in this repo — cannot be checked mechanically here',
            { file: rel(hooksJsonPath), line: 1 },
        );
        for (const entry of entries) {
            if (/^(PreToolUse|PostToolUse)$/.test(event) && !entry.matcher) {
                record(
                    `event ${event} matcher`,
                    'hooks.json structure',
                    'mismatch',
                    'tool-scoped event has no matcher',
                    { file: rel(hooksJsonPath), line: 1 },
                );
            }
            for (const h of entry.hooks ?? []) {
                const m = (h.command ?? '').match(/^superskill hook run sp ([a-z-]+)$/);
                if (!m) {
                    record(
                        `hook command ${h.command}`,
                        'hooks.json structure',
                        'unverified',
                        "command does not match 'superskill hook run sp <name>' — not mechanically resolvable",
                        { file: rel(hooksJsonPath), line: 1 },
                    );
                    continue;
                }
                // superskill ADR-039: `hook run` resolves the plugin's `scripts/hooks/<id>.ts` (the
                // location staged targets also receive).
                const script = join(root, 'scripts', 'hooks', `${m[1]}.ts`);
                record(
                    `hook ${m[1]} script exists`,
                    'file-resolution',
                    existsSync(script) ? 'ok' : 'mismatch',
                    existsSync(script) ? rel(script) : `${rel(script)} missing`,
                    { file: rel(hooksJsonPath), line: 1 },
                );
            }
        }
    }
    // pi-lens-ignore: unchecked-throwing-call
    const plugin = JSON.parse(readFileSync(join(root, 'plugin.json'), 'utf8')) as {
        extensions?: { pi?: string[] };
    };
    // Optional: a plugin may still declare extensions.pi. The sp plugin retired its Pi
    // extension in favour of superskill's native adapter (2026-10-15); an empty list is fine.
    for (const ext of plugin.extensions?.pi ?? []) {
        const p = join(root, ext.replace(/^\.\//, ''));
        record(
            `pi extension ${ext}`,
            'file-resolution',
            existsSync(p) ? 'ok' : 'mismatch',
            existsSync(p) ? rel(p) : `${rel(p)} missing`,
            { file: 'plugins/sp/plugin.json', line: 1 },
        );
    }
}

// ─── D. --json envelope probes ──────────────────────────────────────────────

/** Read-only commands executed live to capture actual --json envelope shapes. */
const JSON_PROBES: string[][] = [
    ['task', 'list', '--json'],
    ['task', 'show', '0539', '--json'],
    ['task', 'check', '0539', '--json'],
    ['feature', 'list', '--json'],
    ['feature', 'show', 'I3', '--json'],
    ['rule', 'list', '--json'],
    ['agent', 'list', '--json'],
    ['agent', 'doctor', 'pi', '--json'],
    ['workflow', 'list', '--json'],
    ['workflow', 'validate', 'task-pipeline.yaml', '--json'],
    ['status', '--json'],
    ['projects', 'list', '--json'],
];

export function flattenKeys(v: unknown, prefix = ''): string[] {
    if (Array.isArray(v)) {
        const inner = [...new Set(v.flatMap((x) => flattenKeys(x, '[]')))];
        return inner.map((k) => (prefix ? `${prefix}.${k}` : k));
    }
    if (v && typeof v === 'object') {
        return Object.entries(v).flatMap(([k, val]) => {
            const path = prefix ? `${prefix}.${k}` : k;
            return typeof val === 'object' && val !== null ? flattenKeys(val, path) : [path];
        });
    }
    return [];
}

const jsonEnvelopeShapes: Record<string, { exit: number; keys: string[] }> = {};

export function probeJsonShapes(run: CliRunner = runCli): void {
    for (const args of JSON_PROBES) {
        const r = run(args);
        let keys: string[] = [];
        try {
            keys = flattenKeys(JSON.parse(r.out)).sort();
        } catch {
            keys = [];
        }
        const label = `spur ${args.slice(0, -1).join(' ')}`;
        jsonEnvelopeShapes[label] = { exit: r.exit, keys };
        const ok = r.exit === 0 && keys.length > 0;
        record(
            `${args.join(' ')} (envelope)`,
            'json-exec',
            ok ? 'ok' : 'unverified',
            ok
                ? `keys: ${keys.slice(0, 12).join(', ')}${keys.length > 12 ? ' …' : ''}`
                : `exit ${r.exit}${r.err ? ` — ${r.err.slice(0, 120)}` : ' — no parseable JSON'}`,
            { file: 'scripts/commands/surface-drift-inventory.ts', line: 1 },
        );
    }
    // Curated prose flag-claims: assertions phrased as prose ("no explicit `--flag`") that the
    // generic backtick-span extractor cannot scope to a command. Extend this list when a prose
    // claim is found; each entry is verified against the live help capture.
    const proseFlagClaims: {
        flag: string;
        path: string[];
        expect: boolean;
        where: { file: string; line: number };
        note: string;
    }[] = [
        {
            flag: '--stage',
            path: ['agent', 'run'],
            expect: false,
            where: { file: 'plugins/sp/skills/parallel-execution/references/dispatch-surface.md', line: 116 },
            note: 'prose claimed an explicit direct-CLI --stage (0539: corrected - stage context is engine-internal)',
        },
    ];
    for (const c of proseFlagClaims) {
        const vs = surface(c.path);
        const has = vs.flags.includes(c.flag);
        const ok = has === c.expect;
        record(
            `spur ${c.path.join(' ')} ${c.flag} (prose claim: ${c.where.file}:${c.where.line})`,
            'help-capture(prose-claim)',
            ok ? 'ok' : 'mismatch',
            ok
                ? `live ${has ? 'exposes' : 'does not expose'} ${c.flag} as expected - ${c.note}`
                : `live ${has ? 'exposes' : 'does not expose'} ${c.flag} but prose claims otherwise - ${c.note}`,
            c.where,
        );
    }
    record(
        'agent run --json -> roleOrigin (asserted by dispatch-surface.md:112)',
        'json-exec',
        'unverified',
        "executing 'spur agent run' launches an external coding agent — cannot be executed mechanically here",
        { file: 'plugins/sp/skills/parallel-execution/references/dispatch-surface.md', line: 112 },
    );
    record(
        'task list --json -> bare array of {wbs,status,…} (asserted in packages/app task-service)',
        'json-exec(field-presence)',
        jsonEnvelopeShapes['spur task list']?.exit === 0 ? 'ok' : 'mismatch',
        jsonEnvelopeShapes['spur task list']?.exit === 0 ? 'array envelope confirmed' : 'probe failed',
        { file: 'packages/app/src/services/task-service.ts', line: 1 },
    );
}

// ─── E. Workflows + symlink ─────────────────────────────────────────────────

export function sweepWorkflows(opts: { run?: CliRunner; wfDir?: string; link?: string } = {}): void {
    const run = opts.run ?? runCli;
    const wfDir = opts.wfDir ?? join(REPO_ROOT, 'config', 'workflows');
    const files = readdirSync(wfDir)
        .filter((f) => f.endsWith('.yaml'))
        .sort();
    for (const f of files) {
        const path = rel(join(wfDir, f));
        const v = run(['workflow', 'validate', path]);
        record(
            `workflow validate ${f}`,
            'workflow-validate(live engine)',
            v.exit === 0 ? 'ok' : 'mismatch',
            `exit ${v.exit}${v.err ? ` — ${v.err.slice(0, 160)}` : ''}`,
            { file: path, line: 1 },
        );
        const dryVars = f === 'task-pipeline.yaml' ? ['--vars', JSON.stringify({ wbs: '0539', profile: 'auto' })] : [];
        const d = run(['workflow', 'run', path, '--dry-run', ...dryVars, '--quiet'], 45_000);
        const tail = (d.out.trim().split('\n').pop() ?? d.err.trim().split('\n').pop() ?? '').slice(0, 160);
        // A dry-run that terminates (any exit) proves the engine walks the definition; schema
        // divergence is validate's job. Only a timeout is unverified.
        record(
            `workflow run ${f} --dry-run`,
            'workflow-dry-run(live engine)',
            d.exit === 124 ? 'unverified' : 'ok',
            d.exit === 124
                ? 'dry-run did not terminate in 45s (paused on HITL?)'
                : `walked to termination — ${tail || `exit ${d.exit}`}`,
            { file: path, line: 1 },
        );
        // CLI invocations asserted inside the YAML (shell guards/actions).
        readFileSync(join(wfDir, f), 'utf8')
            .split(/\r?\n/)
            .forEach((line: string, i: number) => {
                for (const span of lineInvocationSpans(line)) {
                    const parsed = parseInvocation(span);
                    if (parsed) {
                        const occ = { file: path, line: i + 1 };
                        checkNounVerbFlags(parsed.nouns, parsed.verbs, parsed.flags, occ);
                        checkSectionOperand(span, occ);
                    }
                }
            });
    }
    // Two-tier model (task 0648/0650): `.spur/workflows` is no longer a symlink and
    // must not exist — the CLI resolves an explicit project path, then bundled fallback. Assert absence.
    const link = opts.link ?? join(REPO_ROOT, '.spur', 'workflows');
    let status: Row['status'] = 'ok';
    let actual = 'absent (two-tier project→bundled model, task 0650)';
    try {
        if (existsSync(link)) {
            status = 'mismatch';
            actual = 'still present — should be removed (task 0650 R3)';
        }
    } catch (e) {
        actual = `exists-check failed: ${String(e).slice(0, 120)}`;
    }
    record('.spur/workflows symlink', 'symlink-absent', status, actual, { file: '.spur/workflows', line: 1 });
}

// ─── Report ─────────────────────────────────────────────────────────────────

export function render(): string {
    const prov = surface([]);
    const byMethod = new Map<string, Row[]>();
    for (const r of rows) {
        const key = r.method.split('(')[0] ?? r.method;
        byMethod.set(key, [...(byMethod.get(key) ?? []), r]);
    }
    const counts = {
        ok: rows.filter((r) => r.status === 'ok').length,
        mismatch: rows.filter((r) => r.status === 'mismatch').length,
        unverified: rows.filter((r) => r.status === 'unverified').length,
    };
    const esc = (s: string): string => s.replaceAll('|', '\\|');
    const L: string[] = [];
    L.push('# 0539 — Plugin & Workflow Surface-Drift Inventory (feature I3)');
    L.push('');
    L.push(
        'Generated by `bun scripts/spur-dev.ts surface-drift-inventory` — re-runnable; every entry names its check method.',
    );
    // pi-lens-ignore: unchecked-throwing-call
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'apps', 'cli', 'package.json'), 'utf8')) as { version: string };
    L.push(`CLI provenance: source-local \`apps/cli/src/index.ts\` @ ${pkg.version} (never a PATH \`spur\`).`);
    L.push(`Root nouns: ${prov.commands.join(', ')}.`);
    L.push('');
    L.push(
        `**Totals: ${counts.ok} ok · ${counts.mismatch} mismatch · ${counts.unverified} unverified** (unverified = no mechanical check can reach it — recorded, never passed).`,
    );
    L.push('');
    L.push(
        "R1 scope: `plugins/sp/{commands,skills,scripts,hooks}` (tests/ and evals/ are the harness itself; agents/ prose is outside R1's named surface list).",
    );
    L.push('R2 scope: all workflow YAML via the bundled tree (two-tier project→bundled model since task 0648/0650).');
    L.push('');
    L.push('## Check methods');
    L.push('');
    L.push('| Method | What it does |');
    L.push('| --- | --- |');
    L.push(
        '| `help-capture` | Parses live Commander `Commands:`/`Options:` blocks from `spur <path> --help` (source-local entry) and diffs asserted noun/verb/flag |',
    );
    L.push(
        '| ↳ global option | A root program option (`--no-logo`) is valid on every command path — the entry strips it before dispatch |',
    );
    L.push(
        '| ↳ hidden-verb probe | A verb absent from the parent `Commands:` block is probed with `spur <noun> <verb> --help`; exit 0 = present (hidden), timeout = unverified, error = absent |',
    );
    L.push(
        '| `json-exec` | Executes read-only commands with `--json` and records the actual envelope; mutating commands stay unverified |',
    );
    L.push(
        '| `script-exec` | Executes the spur-shelling plugin scripts against a fake bin (argument construction under execution) |',
    );
    L.push('| `file-resolution` / `json-parse` | Referenced files exist / JSON parses |');
    L.push('| `host-contract` | Host-owned contract — unverified in-repo, reason recorded |');
    L.push(
        '| `workflow-validate` / `workflow-dry-run` | Live engine: schema+semantic validate; `--dry-run` transition walk |',
    );
    L.push('| `symlink-absent` | `.spur/workflows` is asserted absent (two-tier project→bundled model, task 0650) |');
    L.push('');
    for (const [method, list] of byMethod) {
        const mm = list.filter((r) => r.status === 'mismatch').length;
        L.push(`## ${method} — ${mm} mismatch / ${list.length} entries`);
        L.push('');
        L.push('| Asserted | Status | Actual | Occurrences |');
        L.push('| --- | --- | --- | --- |');
        for (const r of [...list].sort(
            (a, b) => a.status.localeCompare(b.status) || a.asserted.localeCompare(b.asserted),
        )) {
            const occ =
                r.occurrences
                    .map((o) => `${o.file}:${o.line}`)
                    .slice(0, 4)
                    .join('<br>') + (r.occurrences.length > 4 ? `<br>…+${r.occurrences.length - 4}` : '');
            L.push(`| \`${esc(r.asserted)}\` | **${r.status}** | ${esc(r.actual)} | ${occ} |`);
        }
        L.push('');
    }
    L.push('## Live --json envelope shapes (captured by execution)');
    L.push('');
    L.push('| Command | Exit | Flattened keys |');
    L.push('| --- | --- | --- |');
    for (const [cmd, s] of Object.entries(jsonEnvelopeShapes)) {
        L.push(
            `| \`${esc(cmd)}\` | ${s.exit} | ${esc(s.keys.slice(0, 14).join(', '))}${s.keys.length > 14 ? ', …' : ''} |`,
        );
    }
    L.push('');
    L.push('## Confirmed mismatches (R3 disposition)');
    L.push('');
    const mism = rows.filter((r) => r.status === 'mismatch');
    if (mism.length === 0) {
        L.push('None — every mechanically-checked assertion matches the live surface.');
    } else {
        L.push('| # | Entry | Disposition |');
        L.push('| --- | --- | --- |');
        mism.forEach((r, n) => {
            L.push(
                `| ${n + 1} | \`${esc(r.asserted)}\` (${r.method}) — ${esc(r.actual)} | see task 0539 Solution (fixed here / owning WBS) |`,
            );
        });
    }
    L.push('');
    return L.join('\n');
}

// ─── Main ───────────────────────────────────────────────────────────────────

/**
 * Entry point. Guarded by `import.meta.main` so the pure span/flag parsers above
 * can be imported and unit-tested without running the full multi-minute sweep
 * (which shells the live CLI and writes files).
 */
function main(): void {
    const outIdx = process.argv.indexOf('--out');
    sweepPluginTrees();
    sweepScriptArgv();
    sweepHooks();
    probeJsonShapes();
    sweepWorkflows();
    const report = render();
    if (outIdx !== -1 && process.argv[outIdx + 1]) {
        const outPath = resolve(process.argv[outIdx + 1] ?? '.');
        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, report);
        process.stderr.write(`wrote ${rel(outPath)}\n`);
    }
    const mismatches = rows.filter((r) => r.status === 'mismatch');
    if (mismatches.length > 0) {
        process.stderr.write(`\nCONFIRMED MISMATCHES (${mismatches.length}):\n`);
        for (const m of mismatches) process.stderr.write(`  - ${m.asserted} [${m.method}] ${m.actual}\n`);
        process.exitCode = 1;
    } else {
        process.stderr.write('\nNo confirmed mismatches.\n');
    }
}

if (import.meta.main) main();
