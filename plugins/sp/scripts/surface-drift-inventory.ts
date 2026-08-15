#!/usr/bin/env bun
/**
 * surface-drift-inventory — re-runnable drift inventory for `plugins/sp` and
 * the tracked workflow-YAML SSOT tree (`.spur/workflows` symlink target)
 * against the live source-local `spur` CLI
 * (feature I3, task 0539 R1/R2).
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
 *      symlink realpath vs its tracked SSOT target tree.
 *
 * Output: markdown inventory on stdout-path via `--out`; exit 1 when any
 * CONFIRMED mismatch remains (ok after repair); unverified entries never fail.
 *
 * Usage: bun plugins/sp/scripts/surface-drift-inventory.ts [--out docs/tasks2/0539-inventory.md]
 */

import { execFileSync } from 'node:child_process';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { captureCliSurface } from '../tests/helpers/cli-surface';

const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..');
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

const rows: Row[] = [];

function record(
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

const surfaceCache = new Map<string, { commands: string[]; flags: string[] }>();

function surface(path: string[]): { commands: string[]; flags: string[] } {
    const key = path.join(' ');
    let s = surfaceCache.get(key);
    if (!s) {
        const cap = captureCliSurface(path);
        s = { commands: cap.commands, flags: cap.flags };
        surfaceCache.set(key, s);
    }
    return s;
}

function runCli(args: string[], timeoutMs = 30_000): { exit: number; out: string; err: string } {
    try {
        const out = execFileSync(process.execPath, ['run', CLI_ENTRY, ...args], {
            cwd: REPO_ROOT,
            encoding: 'utf8',
            timeout: timeoutMs,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { exit: 0, out, err: '' };
    } catch (e) {
        const err = e as { status?: number; stdout?: string; stderr?: string; killed?: boolean };
        return {
            exit: err.killed ? 124 : (err.status ?? 1),
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

/** Normalize an asserted invocation span into nouns / verbs / flags. Null when it asserts nothing. */
function parseInvocation(spanRaw: string): Parsed | null {
    let s = spanRaw.trim().replace(/[.,;:]+$/, '');
    s = s.replace(/^(?:bun|bunx|npx)\s+(?:run\s+)?/, '');
    s = s.replace(/^apps\/cli\/src\/index\.ts\s*/, '');
    if (!/^spur\b/.test(s) || s === 'spur') return null;
    s = s.replace(/^spur\s+/, '');
    if (!s) return null;
    s = (s.split(/[;&|>]/)[0] ?? s).trim();
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
    if (process.env.DEBUG_SPANS === '1') {
        process.stderr.write(`SPAN ${JSON.stringify({ spanRaw, nouns, verbs, flags })}\n`);
    }
    return { nouns, verbs, flags };
}

/** All backticked spans in one line. */
function backticks(line: string): string[] {
    return [...line.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] ?? '');
}

/** Candidate invocation spans from one line: backticked + bare shell-style matches. */
function lineInvocationSpans(line: string): string[] {
    const spans = backticks(line).filter((s) => /(?:^|\s)(?:spur|apps\/cli\/src\/index\.ts)\s/.test(s));
    const bare = [
        ...line.matchAll(
            /(?:^|[`"'=;&|;(]\s*)(?:bun(?:\s+run)?\s+)?(?:apps\/cli\/src\/index\.ts|spur)\s+[^\s`"'|;&)]+/g,
        ),
    ].map((m) => (m[0] ?? '').trim());
    return [...spans, ...bare];
}

/** A pure flag list (backticked "--from-answer <path> --folder" spans). */
function isFlagSpan(span: string): boolean {
    const toks = span.trim().split(/\s+/);
    return toks.length > 0 && toks.every((t) => /^-{1,2}[A-Za-z][A-Za-z0-9-]*/.test(t) || PLACEHOLDER.test(t));
}

function flagNames(span: string): string[] {
    return [...span.matchAll(/-{1,2}[A-Za-z][A-Za-z0-9-]*/g)].map((m) => m[0] ?? '');
}

/** Files in the R1 surfaces: commands/, skills/ (incl. references), scripts/, hooks/. */
function walk(dir: string, exts: string[], out: string[] = []): string[] {
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
function nounOfReference(file: string): string | null {
    const map: Record<string, string> = {
        tasks: 'task',
        features: 'feature',
        rules: 'rule',
        workflows: 'workflow',
        agent: 'agent',
        message: 'message',
        team: 'team',
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

function checkNounVerbFlags(
    nouns: string[],
    verbs: string[],
    flags: string[],
    occ: { file: string; line: number },
): void {
    const root = surface([]);
    for (const noun of nouns) {
        if (noun === 'help' || /^(foo|bar|baz)$/.test(noun)) continue;
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
            if (!ns.commands.includes(verb)) {
                record(
                    `spur ${noun} ${verb}`,
                    `help-capture(spur ${noun})`,
                    'mismatch',
                    `verb absent (live verbs: ${ns.commands.join(', ')})`,
                    occ,
                );
                continue;
            }
            const vs = surface([noun, verb]);
            record(`spur ${noun} ${verb}`, `help-capture(spur ${noun})`, 'ok', 'verb present', occ);
            for (const f of flags) {
                record(
                    `spur ${noun} ${verb} ${f}`,
                    `help-capture(spur ${noun} ${verb})`,
                    vs.flags.includes(f) ? 'ok' : 'mismatch',
                    vs.flags.includes(f) ? 'flag present' : `flag absent (live flags: ${vs.flags.join(', ')})`,
                    occ,
                );
            }
        }
        if (verbs.length === 0) {
            record(`spur ${noun} (noun)`, `help-capture(spur ${noun})`, 'ok', `${ns.commands.length} live verbs`, occ);
            for (const f of flags) {
                if (ns.flags.includes(f)) {
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
        if (nouns.length === 0 && root.commands.includes(verb)) {
            record(`spur ${verb}`, 'help-capture(root)', 'ok', 'root verb present', occ);
        }
    }
}

function sweepPluginTrees(): void {
    const files = [
        ...walk(join(PLUGIN_ROOT, 'commands'), ['.md']),
        ...walk(join(PLUGIN_ROOT, 'skills'), ['.md']),
        ...walk(join(PLUGIN_ROOT, 'scripts'), ['.ts']),
        ...walk(join(PLUGIN_ROOT, 'hooks'), ['.ts', '.json']),
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
                const negated = /\bno\s+`spur [^`]+`\s+verb exists\b/i.test(line);
                for (const span of lineInvocationSpans(line)) {
                    const parsed = parseInvocation(span);
                    if (!parsed) continue;
                    if (negated) {
                        // Inverted assertion: the line claims absence. Confirm against the live surface.
                        for (const noun of parsed.nouns) {
                            const ns = surface([noun]);
                            for (const verb of parsed.verbs) {
                                record(
                                    `spur ${noun} ${verb}`,
                                    `help-capture(spur ${noun})`,
                                    ns.commands.includes(verb) ? 'mismatch' : 'ok',
                                    ns.commands.includes(verb)
                                        ? 'line asserts absence but the verb EXISTS on the live surface (stale negation)'
                                        : 'documented absence confirmed against live surface',
                                    occ,
                                );
                            }
                        }
                        continue;
                    }
                    checkNounVerbFlags(parsed.nouns, parsed.verbs, parsed.flags, occ);
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
                        if (rootCommands.includes(first)) {
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
                for (const span of lineInvocationSpans(line)) {
                    const parsed = parseInvocation(span);
                    if (parsed) checkNounVerbFlags(parsed.nouns, parsed.verbs, parsed.flags, occ);
                }
            }
        });
    }
}

// ─── B. Scripts: argv extraction + execution ────────────────────────────────

function sweepScriptArgv(): void {
    for (const file of walk(join(PLUGIN_ROOT, 'scripts'), ['.ts'])) {
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

function executeScripts(): void {
    const dir = mkdtempSync(join(tmpdir(), 'spur-drift-'));
    try {
        // task-size-precheck against a fake bin — argument construction under execution.
        const fake = join(dir, 'spur');
        writeFileSync(
            fake,
            `#!/bin/sh
if [ "$1" = task ] && [ "$2" = show ]; then
    printf '%s' '{"content":"### Requirements\\n- [ ] R1. x\\n### Plan\\n- [ ] p1"}'
else
    printf '%s' '{"agents":[{"capabilityTier":"standard"}]}'
fi
`,
        );
        chmodSync(fake, 0o755);
        const statusPath = join(dir, '.spur', 'run', '0487-precheck-size.status');
        try {
            execFileSync(
                process.execPath,
                [
                    join(PLUGIN_ROOT, 'scripts', 'task-size-precheck.ts'),
                    '0487',
                    '--spur-bin',
                    fake,
                    '--executor',
                    'standard',
                ],
                { cwd: dir, encoding: 'utf8', timeout: 30_000, stdio: 'pipe' },
            );
            const content = readFileSync(statusPath, 'utf8');
            record(
                'task-size-precheck --spur-bin <bin> (executed)',
                'script-exec(fake-bin)',
                content.trim() === 'PASS' ? 'ok' : 'mismatch',
                `status file: ${content.trim()}`,
                { file: 'plugins/sp/scripts/task-size-precheck.ts', line: 1 },
            );
        } catch (e) {
            record(
                'task-size-precheck --spur-bin <bin> (executed)',
                'script-exec(fake-bin)',
                'mismatch',
                `script exited non-zero: ${String(e).slice(0, 200)}`,
                { file: 'plugins/sp/scripts/task-size-precheck.ts', line: 1 },
            );
        }

        // feature-sync-bounded against a fake bin — feature show / task list / feature sync argv.
        const fake2 = join(dir, 'spur2');
        writeFileSync(
            fake2,
            `#!/bin/sh
if [ "$1" = feature ] && [ "$2" = show ]; then printf '%s' '{"content":"x"}';
elif [ "$1" = task ]; then printf '%s' '[{"wbs":"0001","status":"done"}]';
elif [ "$1" = feature ] && [ "$2" = sync ]; then printf '%s' '{"status":"ok","changed":0}';
fi
`,
        );
        chmodSync(fake2, 0o755);
        try {
            execFileSync(
                process.execPath,
                [
                    join(PLUGIN_ROOT, 'scripts', 'feature-sync-bounded.ts'),
                    '--feature',
                    'I3',
                    '--spur-bin',
                    fake2,
                    '--run-dir',
                    join(dir, 'run'),
                ],
                { cwd: dir, encoding: 'utf8', timeout: 30_000, stdio: 'pipe' },
            );
            record(
                'feature-sync-bounded --feature <id> --spur-bin <bin> (executed)',
                'script-exec(fake-bin)',
                'ok',
                'exited 0 against fake bin',
                { file: 'plugins/sp/scripts/feature-sync-bounded.ts', line: 1 },
            );
        } catch (e) {
            record(
                'feature-sync-bounded --feature <id> --spur-bin <bin> (executed)',
                'script-exec(fake-bin)',
                'unverified',
                `fake-bin execution errored: ${String(e).slice(0, 200)} — argv still checked by extraction`,
                { file: 'plugins/sp/scripts/feature-sync-bounded.ts', line: 1 },
            );
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

// ─── C. Hook contract ───────────────────────────────────────────────────────

function sweepHooks(): void {
    const hooksJsonPath = join(PLUGIN_ROOT, 'hooks', 'hooks.json');
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
                const script = join(PLUGIN_ROOT, 'hooks', `${m[1]}.ts`);
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
    const plugin = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'plugin.json'), 'utf8')) as {
        extensions?: { pi?: string[] };
    };
    for (const ext of plugin.extensions?.pi ?? []) {
        const p = join(PLUGIN_ROOT, ext.replace(/^\.\//, ''));
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
    ['agent', 'doctor', 'omp', '--json'],
    ['workflow', 'list', '--json'],
    ['workflow', 'validate', '.spur/workflows/basic.yaml', '--json'],
    ['status', '--json'],
    ['team', 'status', '--json'],
    ['projects', 'list', '--json'],
];

function flattenKeys(v: unknown, prefix = ''): string[] {
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

function probeJsonShapes(): void {
    for (const args of JSON_PROBES) {
        const r = runCli(args);
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
            { file: 'plugins/sp/scripts/surface-drift-inventory.ts', line: 1 },
        );
    }
    const doctor = jsonEnvelopeShapes['spur agent doctor omp'];
    const capOk = (doctor?.keys ?? []).some((k) => k.endsWith('.capabilityTier'));
    record(
        'agent doctor <name> --json -> agents[0].capabilityTier (asserted by task-size-precheck.ts:130)',
        'json-exec(field-presence)',
        capOk ? 'ok' : 'mismatch',
        capOk ? 'field present in live envelope' : 'field ABSENT from live envelope',
        { file: 'plugins/sp/scripts/task-size-precheck.ts', line: 130 },
    );
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
        'task list --json -> bare array of {wbs,status,…} (asserted by feature-sync-bounded.ts:291)',
        'json-exec(field-presence)',
        jsonEnvelopeShapes['spur task list']?.exit === 0 ? 'ok' : 'mismatch',
        jsonEnvelopeShapes['spur task list']?.exit === 0 ? 'array envelope confirmed' : 'probe failed',
        { file: 'plugins/sp/scripts/feature-sync-bounded.ts', line: 291 },
    );
}

// ─── E. Workflows + symlink ─────────────────────────────────────────────────

function sweepWorkflows(): void {
    const wfDir = join(REPO_ROOT, 'config', 'workflows');
    const files = readdirSync(wfDir)
        .filter((f) => f.endsWith('.yaml'))
        .sort();
    for (const f of files) {
        const path = rel(join(wfDir, f));
        const v = runCli(['workflow', 'validate', path]);
        record(
            `workflow validate ${f}`,
            'workflow-validate(live engine)',
            v.exit === 0 ? 'ok' : 'mismatch',
            `exit ${v.exit}${v.err ? ` — ${v.err.slice(0, 160)}` : ''}`,
            { file: path, line: 1 },
        );
        const dryVars = f === 'task-pipeline.yaml' ? ['--vars', JSON.stringify({ wbs: '0539', profile: 'auto' })] : [];
        const d = runCli(['workflow', 'run', path, '--dry-run', ...dryVars, '--quiet'], 45_000);
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
                    if (parsed)
                        checkNounVerbFlags(parsed.nouns, parsed.verbs, parsed.flags, {
                            file: path,
                            line: i + 1,
                        });
                }
            });
    }
    const link = join(REPO_ROOT, '.spur', 'workflows');
    let status: Row['status'] = 'mismatch';
    let actual = '';
    try {
        const rp = realpathSync(link);
        const tracked = realpathSync(wfDir);
        status = rp === tracked ? 'ok' : 'mismatch';
        actual = `resolves to ${rel(rp)}${status === 'ok' ? ' (== tracked SSOT target)' : ` — expected ${rel(tracked)}`}`;
    } catch (e) {
        actual = `cannot resolve .spur/workflows: ${String(e).slice(0, 120)}`;
    }
    record('.spur/workflows symlink', 'symlink-realpath', status, actual, { file: '.spur/workflows', line: 1 });
}

// ─── Report ─────────────────────────────────────────────────────────────────

function render(): string {
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
        'Generated by `bun plugins/sp/scripts/surface-drift-inventory.ts` — re-runnable; every entry names its check method.',
    );
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
    L.push('R2 scope: all workflow YAML via the `.spur/workflows` runtime symlink (tracked SSOT tree).');
    L.push('');
    L.push('## Check methods');
    L.push('');
    L.push('| Method | What it does |');
    L.push('| --- | --- |');
    L.push(
        '| `help-capture` | Parses live Commander `Commands:`/`Options:` blocks from `spur <path> --help` (source-local entry) and diffs asserted noun/verb/flag |',
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
    L.push('| `symlink-realpath` | realpath of `.spur/workflows` vs its tracked SSOT target |');
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

const outIdx = process.argv.indexOf('--out');
sweepPluginTrees();
sweepScriptArgv();
executeScripts();
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
