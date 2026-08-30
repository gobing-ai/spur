/**
 * surface-drift-inventory — unit coverage for the span/flag parsers (task 0539),
 * the pure row/walk/flatten helpers, and the two deterministic sweeps
 * (sweepHooks reads repo-owned files; executeScripts runs the spur-shelling
 * scripts against fake bins).
 *
 * These parsers decide what the drift inventory even *looks at*: a span the
 * extractor drops is a surface claim that can never be reported as drift, so a
 * silent parser regression weakens the inventory without failing it.
 *
 * The verdict logic (`checkNounVerbFlags`), the tree/hook/workflow sweeps, the
 * `--json` envelope probes, and `render` all run against a SEEDED
 * `surfaceCache`, an injected `CliRunner`, and fixture trees, so they assert
 * the drift decision itself rather than today's CLI shape — a verb rename or a
 * new workflow file must not turn these red, and the suite stays sub-second.
 *
 * `runCli` is the one exception: its exit classification (0 / status / 124 on
 * timeout) is what every sweep reads its verdict from, so it is checked against
 * the real source-local CLI. Only `main` is left to running the tool.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    backticks,
    type CliRunner,
    checkNounVerbFlags,
    executeScripts,
    flagNames,
    flattenKeys,
    isFlagSpan,
    lineInvocationSpans,
    nounOfReference,
    parseInvocation,
    probeJsonShapes,
    record,
    render,
    rows,
    runCli,
    surfaceCache,
    sweepHooks,
    sweepPluginTrees,
    sweepScriptArgv,
    sweepWorkflows,
    walk,
} from '../scripts/surface-drift-inventory';

describe('parseInvocation — noun/verb/flag extraction', () => {
    test('splits a plain invocation into noun, verb, and flags', () => {
        expect(parseInvocation('spur task update 0042 --section Plan --json')).toEqual({
            nouns: ['task'],
            verbs: ['update'],
            flags: ['--section', '--json'],
        });
    });

    test('strips the monorepo dev prefixes so both invocation forms normalize alike', () => {
        const direct = parseInvocation('spur feature check F1 --strict');
        expect(parseInvocation('bun run apps/cli/src/index.ts feature check F1 --strict')).toEqual(direct);
        expect(parseInvocation('bunx spur feature check F1 --strict')).toEqual(direct);
    });

    test('expands slash alternation into every claimed name', () => {
        expect(parseInvocation('spur task show/get 0042')).toEqual({
            nouns: ['task'],
            verbs: ['show', 'get'],
            flags: [],
        });
    });

    test('a pipe is a shell separator, not alternation — only the first verb is claimed', () => {
        // `show|get` in prose reads as alternation, but `|` is a pipe in a real
        // command; the slash form above is how alternation is claimed.
        expect(parseInvocation('spur task show|get 0042')?.verbs).toEqual(['show']);
    });

    test('flags survive a placeholder argument (the documented invocation style)', () => {
        // `<wbs>` contains `>`; splitting on it truncated the span and silently
        // dropped every flag documented after the first placeholder.
        expect(parseInvocation('spur task update <wbs> --section <name> --from-file <path>')).toEqual({
            nouns: ['task'],
            verbs: ['update'],
            flags: ['--section', '--from-file'],
        });
    });

    test('stops at a shell separator so only the first command is claimed', () => {
        expect(parseInvocation('spur task check && spur feature check')).toEqual({
            nouns: ['task'],
            verbs: ['check'],
            flags: [],
        });
    });

    test('an ellipsis ends noun/verb claims — elided prose asserts nothing further', () => {
        expect(parseInvocation('spur task … --json')).toEqual({ nouns: ['task'], verbs: [], flags: ['--json'] });
    });

    test('placeholders and quoted args are not mistaken for verbs', () => {
        expect(parseInvocation('spur task update <wbs> --section "Plan"')).toEqual({
            nouns: ['task'],
            verbs: ['update'],
            flags: ['--section'],
        });
    });

    test('returns null when the span asserts no surface', () => {
        expect(parseInvocation('spur')).toBeNull();
        expect(parseInvocation('git status')).toBeNull();
        expect(parseInvocation('')).toBeNull();
    });

    test('trailing punctuation from prose is trimmed', () => {
        expect(parseInvocation('spur status.')).toEqual({ nouns: ['status'], verbs: [], flags: [] });
    });

    test('DEBUG_SPANS emits a stderr trace line without changing the result', () => {
        const prev = process.env.DEBUG_SPANS;
        process.env.DEBUG_SPANS = '1';
        const err: string[] = [];
        const spy = process.stderr.write.bind(process.stderr);
        process.stderr.write = (chunk: string | Uint8Array) => {
            err.push(String(chunk));
            return true;
        };
        try {
            expect(parseInvocation('spur task show 0042')).toEqual({
                nouns: ['task'],
                verbs: ['show'],
                flags: [],
            });
        } finally {
            process.env.DEBUG_SPANS = prev;
            process.stderr.write = spy;
        }
        expect(err.join('')).toContain('SPAN ');
    });

    test('a flag after an ellipsis is still claimed (elision ends noun/verb, not flags)', () => {
        expect(parseInvocation('spur feature … --json')).toEqual({
            nouns: ['feature'],
            verbs: [],
            flags: ['--json'],
        });
    });
});

describe('span extraction', () => {
    test('backticks returns every inline span on the line', () => {
        expect(backticks('use `spur task check` then `spur feature sync`')).toEqual([
            'spur task check',
            'spur feature sync',
        ]);
    });

    test('lineInvocationSpans finds backticked invocations', () => {
        expect(lineInvocationSpans('run `spur workflow run x.yaml` now').some((s) => s.includes('workflow'))).toBe(
            true,
        );
    });

    test('lineInvocationSpans ignores backticked spans that are not invocations', () => {
        expect(lineInvocationSpans('the `feature_id` frontmatter field')).toEqual([]);
    });

    test('lineInvocationSpans finds bare (unbackticked) shell-style invocations', () => {
        // The bare regex captures `spur <noun>` (one token), keeping any leading shell
        // separator in the match; full invocations travel backticked. Both forms must
        // be found.
        expect(lineInvocationSpans('spur workflow validate x.yaml')).toContain('spur workflow');
        expect(lineInvocationSpans('then; spur task check 0042').some((s) => s.includes('spur task'))).toBe(true);
    });

    test('lineInvocationSpans finds the monorepo dev entry form bare', () => {
        const spans = lineInvocationSpans('(apps/cli/src/index.ts task show 0042)');
        expect(spans.some((s) => s.includes('apps/cli/src/index.ts') && s.includes('task'))).toBe(true);
    });

    test('lineInvocationSpans does not grab a bare span across a shell separator', () => {
        const spans = lineInvocationSpans('spur task check | jq .');
        expect(spans.every((s) => !s.includes('jq'))).toBe(true);
    });
});

describe('flag spans', () => {
    test('isFlagSpan accepts a pure flag list with placeholders', () => {
        expect(isFlagSpan('--from-answer <path> --folder')).toBe(true);
        expect(isFlagSpan('--json')).toBe(true);
    });

    test('isFlagSpan rejects a span carrying a verb', () => {
        expect(isFlagSpan('task check --json')).toBe(false);
    });

    test('flagNames extracts both short and long forms', () => {
        expect(flagNames('--section <name> -f --dry-run')).toEqual(['--section', '-f', '--dry-run']);
    });

    test('isFlagSpan rejects an empty span and a span with a bare word', () => {
        expect(isFlagSpan('')).toBe(false);
        expect(isFlagSpan('--json status')).toBe(false);
    });

    test('isFlagSpan accepts a single placeholder-less flag', () => {
        expect(isFlagSpan('--strict')).toBe(true);
    });

    test('flagNames returns empty for a span with no flags', () => {
        expect(flagNames('task check')).toEqual([]);
    });
});

describe('nounOfReference — reference path to CLI noun', () => {
    test('maps a plural reference file to its singular noun', () => {
        expect(nounOfReference('plugins/sp/skills/spur-cli/references/tasks.md')).toBe('task');
        expect(nounOfReference('plugins/sp/skills/spur-cli/references/features.md')).toBe('feature');
        expect(nounOfReference('plugins/sp/skills/spur-cli/references/workflows.md')).toBe('workflow');
    });

    test('maps a nested reference file through its parent directory', () => {
        expect(nounOfReference('plugins/sp/skills/spur-cli/references/tasks/operations.md')).toBe('task');
    });

    test('already-singular nouns map to themselves', () => {
        expect(nounOfReference('plugins/sp/skills/spur-cli/references/agent.md')).toBe('agent');
        expect(nounOfReference('plugins/sp/skills/spur-cli/references/team.md')).toBe('team');
    });

    test('returns null for a file outside the noun-mapped references', () => {
        expect(nounOfReference('plugins/sp/skills/spur-dev/references/cross-cutting.md')).toBeNull();
    });

    test('maps the remaining reference nouns', () => {
        expect(nounOfReference('plugins/sp/skills/spur-cli/references/rules.md')).toBe('rule');
        expect(nounOfReference('plugins/sp/skills/spur-cli/references/message.md')).toBe('message');
        expect(nounOfReference('plugins/sp/skills/spur-cli/references/init.md')).toBe('init');
        expect(nounOfReference('plugins/sp/skills/spur-cli/references/serve.md')).toBe('serve');
    });

    test('maps a reference file with no parent directory (bare filename)', () => {
        expect(nounOfReference('tasks.md')).toBe('task');
        expect(nounOfReference('rules.md')).toBe('rule');
    });

    test('maps through the references child directory when the base is unmapped', () => {
        expect(nounOfReference('plugins/sp/skills/spur-cli/references/tasks/x.md')).toBe('task');
    });
});

// ─── record ──────────────────────────────────────────────────────────────

describe('record — row accumulation semantics', () => {
    const occ = (line: number) => ({ file: 'test.md', line });

    test('creates a new row with its first occurrence', () => {
        const row = record('ut-record-new', 'ut-method', 'ok', 'fine', occ(1));
        expect(row.status).toBe('ok');
        expect(row.occurrences).toEqual([{ file: 'test.md', line: 1 }]);
    });

    test('merges repeat assertions into one row, deduping identical occurrences', () => {
        record('ut-record-merge', 'ut-method', 'ok', 'fine', occ(1));
        const row = record('ut-record-merge', 'ut-method', 'ok', 'fine', occ(2));
        record('ut-record-merge', 'ut-method', 'ok', 'fine', occ(2)); // exact dup — ignored
        expect(row.occurrences).toEqual([
            { file: 'test.md', line: 1 },
            { file: 'test.md', line: 2 },
        ]);
    });

    test('the same claim under a different method is a different row', () => {
        record('ut-record-method', 'ut-method-a', 'ok', 'fine', occ(1));
        const b = record('ut-record-method', 'ut-method-b', 'ok', 'fine', occ(9));
        expect(b.occurrences).toEqual([{ file: 'test.md', line: 9 }]);
    });

    test('a later mismatch overrides an ok, but a later ok never clears a mismatch', () => {
        const asserted = 'ut-record-override';
        record(asserted, 'ut-method', 'ok', 'fine', occ(1));
        const bad = record(asserted, 'ut-method', 'mismatch', 'drifted', occ(2));
        expect(bad.status).toBe('mismatch');
        expect(bad.actual).toBe('drifted');
        const still = record(asserted, 'ut-method', 'ok', 'fine again', occ(3));
        expect(still.status).toBe('mismatch');
        expect(still.actual).toBe('drifted');
    });
});

// ─── walk ────────────────────────────────────────────────────────────────

describe('walk — surface file collection', () => {
    test('collects matching extensions recursively and skips tests/ and evals/', () => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-walk-'));
        try {
            mkdirSync(join(dir, 'a', 'tests'), { recursive: true });
            mkdirSync(join(dir, 'b', 'evals'), { recursive: true });
            writeFileSync(join(dir, 'top.md'), '');
            writeFileSync(join(dir, 'top.ts'), '');
            writeFileSync(join(dir, 'a', 'nested.md'), '');
            writeFileSync(join(dir, 'a', 'tests', 'skip.md'), '');
            writeFileSync(join(dir, 'b', 'evals', 'skip.md'), '');

            const found = walk(dir, ['.md']).map((p) => p.slice(dir.length + 1));
            expect(found.sort()).toEqual([join('a', 'nested.md'), 'top.md']);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('returns empty for a missing directory', () => {
        expect(walk(join(tmpdir(), 'spur-walk-definitely-absent'), ['.md'])).toEqual([]);
    });
});

// ─── flattenKeys ─────────────────────────────────────────────────────────

describe('flattenKeys — json envelope shape flattening', () => {
    test('flattens nested objects into dotted paths', () => {
        expect(flattenKeys({ a: 1, b: { c: 2, d: { e: 3 } } }).sort()).toEqual(['a', 'b.c', 'b.d.e']);
    });

    test('flattens array element keys under [] and dedupes across elements', () => {
        expect(flattenKeys({ list: [{ wbs: '1' }, { wbs: '2', extra: true }] })).toEqual([
            'list.[].wbs',
            'list.[].extra',
        ]);
    });

    test('treats null as a leaf and scalars as no keys', () => {
        expect(flattenKeys({ a: null })).toEqual(['a']);
        expect(flattenKeys('scalar')).toEqual([]);
        expect(flattenKeys([1, 2])).toEqual([]);
    });
});

// ─── sweepHooks (repo-owned files — deterministic) ───────────────────────

describe('sweepHooks — hook contract against the real plugin tree', () => {
    test('hooks.json parses and every referenced hook script resolves', () => {
        const before = rows.length;
        sweepHooks();
        const added = rows.slice(before);

        expect(added.find((r) => r.asserted === 'hooks.json parses')?.status).toBe('ok');

        const scriptRows = added.filter((r) => r.asserted.endsWith('script exists'));
        expect(scriptRows.length).toBeGreaterThan(0);
        for (const r of scriptRows) expect(r.status).toBe('ok');

        // Tool-scoped events must carry a matcher — no structure mismatch rows.
        expect(added.some((r) => r.asserted.endsWith('matcher') && r.status === 'mismatch')).toBe(false);

        // The pi extension named by plugin.json exists.
        const ext = added.filter((r) => r.asserted.startsWith('pi extension'));
        expect(ext.length).toBeGreaterThan(0);
        for (const r of ext) expect(r.status).toBe('ok');

        // Host-side event names stay honestly unverified.
        expect(added.some((r) => r.method === 'host-contract' && r.status === 'unverified')).toBe(true);
    });

    test('a broken hook tree is reported branch by branch', () => {
        // The real tree only ever exercises the passing legs, so an inverted or dead
        // structural check would go unnoticed there. This fixture breaks each one.
        const dir = mkdtempSync(join(tmpdir(), 'spur-hooks-'));
        try {
            mkdirSync(join(dir, 'hooks'), { recursive: true });
            writeFileSync(
                join(dir, 'hooks', 'hooks.json'),
                JSON.stringify({
                    hooks: {
                        PreToolUse: [
                            { hooks: [{ type: 'command', command: 'superskill hook run sp absent-hook' }] },
                            { matcher: 'Bash', hooks: [{ type: 'command', command: './ad-hoc.sh' }] },
                        ],
                    },
                }),
            );
            writeFileSync(join(dir, 'plugin.json'), JSON.stringify({ extensions: { pi: ['./hooks/pi/absent.ts'] } }));

            sweepHooks(dir);

            expect(rowFor('event PreToolUse matcher')?.status).toBe('mismatch');
            expect(rowFor('hook absent-hook script exists')?.status).toBe('mismatch');
            expect(rowFor('hook command ./ad-hoc.sh')?.status).toBe('unverified');
            expect(rowFor('pi extension ./hooks/pi/absent.ts')?.status).toBe('mismatch');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

// ─── executeScripts (fake bins — deterministic) ──────────────────────────

describe('executeScripts — spur-shelling scripts against fake bins', () => {
    test('both scripts exit as expected against their fake bins', () => {
        const before = rows.length;
        executeScripts();
        const added = rows.slice(before);

        const precheck = added.find((r) => r.asserted.startsWith('task-size-precheck'));
        expect(precheck?.method).toBe('script-exec(fake-bin)');
        expect(precheck?.status).toBe('ok');
        expect(precheck?.actual).toContain('PASS');

        const sync = added.find((r) => r.asserted.startsWith('feature-sync-bounded'));
        expect(sync?.method).toBe('script-exec(fake-bin)');
        expect(sync?.status).toBe('ok');
    }, 60_000); // two real bun spawns of the plugin scripts

    test('a script that cannot run is drift for the precheck and unverified for the sync', () => {
        // Asymmetric by design: task-size-precheck's argv contract is fully exercised by the
        // fake bin, so a failure there is real drift; feature-sync-bounded's fake-bin run is a
        // best-effort extra on top of argv extraction, so it degrades to unverified instead of
        // manufacturing a mismatch. Row isolation keeps the passing rows above intact.
        const dir = mkdtempSync(join(tmpdir(), 'spur-noscripts-'));
        const saved = rows.splice(0, rows.length);
        try {
            executeScripts(dir); // no scripts/ here — both spawns fail
            expect(rowFor('task-size-precheck --spur-bin <bin> (executed)')?.status).toBe('mismatch');
            expect(rowFor('feature-sync-bounded --feature <id> --spur-bin <bin> (executed)')?.status).toBe(
                'unverified',
            );
        } finally {
            rows.splice(0, rows.length);
            rows.push(...saved);
            rmSync(dir, { recursive: true, force: true });
        }
    }, 60_000);
});

// ─── runCli (the one live-spawn test) ────────────────────────────────────

describe('runCli — exit classification against the source-local CLI', () => {
    // Every live sweep reads its verdict off these three outcomes, so the mapping is checked
    // against the real binary once rather than only against the fakes used above.
    test('a successful command returns exit 0 and its stdout', () => {
        const r = runCli(['--help']);
        expect(r.exit).toBe(0);
        expect(r.out).toContain('Commands:');
    });

    test('a failing command returns its status and captured stderr', () => {
        const r = runCli(['definitely-not-a-noun']);
        expect(r.exit).toBeGreaterThan(0);
        expect(r.exit).not.toBe(124);
        expect(r.err.length).toBeGreaterThan(0);
    });

    test('a command killed by the timeout is reported as 124, not as a failure', () => {
        // sweepWorkflows treats 124 as unverified rather than drift — a hung dry-run must
        // never be reported as a broken workflow.
        expect(runCli(['--help'], 50).exit).toBe(124);
    });
}, 60_000);

// ─── Seeded live surface ─────────────────────────────────────────────────
//
// Everything below judges claims against a FAKE CLI surface seeded into the
// capture cache. That keeps the verdict logic hermetic and, more importantly,
// stable: these tests assert how a claim is judged, not which verbs the CLI
// happens to ship today, so a real verb rename can never turn them red.

surfaceCache.set('', { commands: ['alpha', 'zeta', 'task', 'self'], flags: ['--help'] });
surfaceCache.set('alpha', { commands: ['run', 'peek'], flags: ['--noun-flag'] });
surfaceCache.set('alpha run', { commands: [], flags: ['--json', '--force'] });
surfaceCache.set('alpha peek', { commands: [], flags: ['--json'] });
surfaceCache.set('zeta', { commands: ['live'], flags: [] });
surfaceCache.set('task', { commands: ['check', 'update'], flags: [] });
surfaceCache.set('task check', { commands: [], flags: ['--json'] });
surfaceCache.set('task update', { commands: [], flags: ['--section', '--from-file'] });
surfaceCache.set('self', { commands: ['init', 'migrate', 'serve', 'status'], flags: [] });
surfaceCache.set('self status', { commands: [], flags: ['--json'] });

afterAll(() => surfaceCache.clear());

/** Rows are keyed by (asserted, method) and merge across calls — look them up globally. */
const rowFor = (asserted: string) => rows.find((r) => r.asserted === asserted);

describe('checkNounVerbFlags — drift verdicts', () => {
    const occ = { file: 'fixture.md', line: 1 };

    test('a noun absent from the root surface is drift, and names the live nouns', () => {
        checkNounVerbFlags(['ghost'], ['run'], [], occ);
        const row = rowFor('spur ghost');
        expect(row?.status).toBe('mismatch');
        expect(row?.actual).toContain('alpha, zeta, task');
        // The verb is not separately reported — an absent noun makes its verbs unreachable.
        expect(rowFor('spur ghost run')).toBeUndefined();
    });

    test('a live noun/verb/flag triple passes on every row', () => {
        checkNounVerbFlags(['alpha'], ['run'], ['--json'], occ);
        expect(rowFor('spur alpha run')?.status).toBe('ok');
        expect(rowFor('spur alpha run --json')?.status).toBe('ok');
    });

    test('a verb absent from its noun is drift, and names the live verbs', () => {
        checkNounVerbFlags(['alpha'], ['vanish'], [], occ);
        const row = rowFor('spur alpha vanish');
        expect(row?.status).toBe('mismatch');
        expect(row?.actual).toContain('run, peek');
    });

    test('a flag absent from a live verb is drift even though the verb itself is fine', () => {
        checkNounVerbFlags(['alpha'], ['peek'], ['--force'], occ);
        expect(rowFor('spur alpha peek')?.status).toBe('ok');
        expect(rowFor('spur alpha peek --force')?.status).toBe('mismatch');
    });

    test('a bare noun claim is checked as a noun, with its live verb count', () => {
        checkNounVerbFlags(['alpha'], [], [], occ);
        expect(rowFor('spur alpha (noun)')?.status).toBe('ok');
        expect(rowFor('spur alpha (noun)')?.actual).toBe('2 live verbs');
    });

    test('a genuine noun-level flag passes at the noun', () => {
        checkNounVerbFlags(['alpha'], [], ['--noun-flag'], occ);
        expect(rowFor('spur alpha --noun-flag')?.status).toBe('ok');
    });

    test('a flag written at the noun but living on its verbs is unverified, not drift', () => {
        // `spur alpha --json` is documentation shorthand for a per-verb flag. Calling that
        // drift would flood the inventory with false positives, so it is recorded honestly
        // as unverified with the verb coverage that justifies it.
        checkNounVerbFlags(['alpha'], [], ['--json'], occ);
        const all = rowFor('spur alpha --json');
        expect(all?.status).toBe('unverified');
        expect(all?.actual).toContain('2/2 verbs');

        checkNounVerbFlags(['alpha'], [], ['--force'], occ);
        expect(rowFor('spur alpha --force')?.actual).toContain('1/2 verbs');
    });

    test('a flag on neither the noun nor any of its verbs is drift', () => {
        checkNounVerbFlags(['alpha'], [], ['--nowhere'], occ);
        expect(rowFor('spur alpha --nowhere')?.status).toBe('mismatch');
    });

    test('a verb claimed with no noun is checked against the root surface', () => {
        checkNounVerbFlags([], ['zeta'], [], occ);
        expect(rowFor('spur zeta')?.status).toBe('ok');
    });

    test('hidden top-level self aliases are checked against their canonical commands', () => {
        checkNounVerbFlags(['status'], [], ['--json'], occ);
        expect(rowFor('spur status')?.status).toBe('ok');
        expect(rowFor('spur status --json')?.status).toBe('ok');
    });

    test('the generated `help` command and doc placeholders assert nothing', () => {
        const before = rows.length;
        checkNounVerbFlags(['help', 'foo', 'bar', 'baz'], [], [], occ);
        checkNounVerbFlags(['alpha'], ['help'], [], occ);
        checkNounVerbFlags([], ['not-a-root-verb'], [], occ);
        expect(rows.length).toBe(before);
    });
});

// ─── Tree sweeps (fixture plugin tree) ───────────────────────────────────

describe('sweepPluginTrees / sweepScriptArgv — claims found in a plugin tree', () => {
    let dir = '';

    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'spur-sweep-'));
        const refs = join(dir, 'skills', 'spur-cli', 'references');
        mkdirSync(join(dir, 'commands'), { recursive: true });
        mkdirSync(join(refs, 'tasks'), { recursive: true });
        mkdirSync(join(dir, 'scripts'), { recursive: true });

        writeFileSync(
            join(dir, 'commands', 'demo.md'),
            [
                '# Demo',
                '',
                'Run `spur task check 0042 --json` before anything else.',
                '',
                '```bash',
                'spur fenced check',
                '```',
                '',
                'Prose: no `spur task vanish` verb exists.',
                'Prose: no `spur zeta live` verb exists.',
            ].join('\n'),
        );
        writeFileSync(
            join(refs, 'tasks.md'),
            [
                '## Verb catalog',
                '',
                '| Verb | Purpose | Key flags |',
                '| --- | --- | --- |',
                '| `check` | Validate the task | `--json` |',
                '| `update` | Edit one section | `--section <name>` |',
                '| `destroy` | Remove the task | — |',
                '| `status` | A root-level command, not a task verb | — |',
            ].join('\n'),
        );
        writeFileSync(
            join(refs, 'tasks', 'verbs.md'),
            [
                '### update',
                '',
                'Rewrite one section: `--from-file <path>`',
                '',
                '### bogus',
                '',
                'Not a live verb: `--nope`',
            ].join('\n'),
        );
        writeFileSync(
            join(dir, 'scripts', 'demo.ts'),
            [
                "const a = runSpurJson(bin, ['task', 'check', wbs, '--json']);",
                "const b = runSpur(bin, ['task', 'ghostverb', '--json']);",
            ].join('\n'),
        );

        sweepPluginTrees(dir);
        sweepScriptArgv(dir);
    });

    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    test('a backticked invocation in prose is checked, flags included', () => {
        expect(rowFor('spur task check')?.status).toBe('ok');
        expect(rowFor('spur task check --json')?.status).toBe('ok');
    });

    test('an invocation inside a fenced code block is checked too', () => {
        // Fenced examples are the form most docs use; skipping them would make every
        // runnable example in the corpus invisible to the inventory.
        expect(rowFor('spur fenced')?.status).toBe('mismatch');
        expect(rowFor('spur fenced')?.occurrences[0]?.file).toContain('demo.md');
    });

    test('a verb table row is checked against its reference noun, flags from the last cell', () => {
        expect(rowFor('spur task update')?.status).toBe('ok');
        expect(rowFor('spur task update --section')?.status).toBe('ok');
        expect(rowFor('spur task destroy')?.status).toBe('mismatch');
    });

    test('a table row naming a root-level command is checked at the root, not under the noun', () => {
        // Otherwise a reference listing `status` alongside its noun's verbs would be
        // reported as a missing `spur task status`.
        expect(rowFor('spur status')?.status).toBe('ok');
        expect(rowFor('spur task status')).toBeUndefined();
    });

    test('a documented absence is confirmed against the live surface, both ways', () => {
        const honest = rowFor('spur task vanish');
        expect(honest?.status).toBe('ok');
        expect(honest?.actual).toContain('documented absence confirmed');

        // A negation that is no longer true is drift: the doc tells readers a verb is
        // missing while the CLI ships it.
        const stale = rowFor('spur zeta live');
        expect(stale?.status).toBe('mismatch');
        expect(stale?.actual).toContain('stale negation');
    });

    test('per-verb pages check flag spans only under a live verb heading', () => {
        expect(rowFor('spur task update --from-file')?.status).toBe('ok');
        expect(rowFor('spur task bogus --nope')).toBeUndefined();
    });

    test('argv arrays a script builds are checked like a documented invocation', () => {
        const row = rowFor('spur task ghostverb');
        expect(row?.status).toBe('mismatch');
        expect(row?.occurrences[0]?.line).toBe(2);
    });
});

// ─── probeJsonShapes (injected runner) ───────────────────────────────────

describe('probeJsonShapes — --json envelopes captured by execution', () => {
    /** Canned CLI responses keyed by argv, so the probe list runs without shelling anything. */
    const responder =
        (agentDoctor: string): CliRunner =>
        (args) => {
            const key = args.join(' ');
            if (key === 'agent doctor omp --json') return { exit: 0, out: agentDoctor, err: '' };
            if (key === 'task list --json') {
                return agentDoctor.includes('capabilityTier')
                    ? { exit: 0, out: '[{"wbs":"0539","status":"done"}]', err: '' }
                    : { exit: 1, out: '', err: 'task list blew up' };
            }
            if (key === 'rule list --json') return { exit: 0, out: 'not json at all', err: '' };
            if (key === 'team status --json') return { exit: 3, out: '', err: 'no team configured' };
            if (key === 'status --json') {
                const wide = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`k${i}`, i]));
                return { exit: 0, out: JSON.stringify(wide), err: '' };
            }
            return { exit: 0, out: '{"ok":true}', err: '' };
        };

    test('a parseable envelope passes and an unparseable or failing one stays unverified', () => {
        surfaceCache.set('agent run', { commands: [], flags: ['--json'] });
        probeJsonShapes(responder('{"agents":[{"capabilityTier":"standard"}]}'));

        expect(rowFor('task list --json (envelope)')?.status).toBe('ok');
        // Exit 0 is not enough — an envelope nothing can parse proves nothing.
        const unparseable = rowFor('rule list --json (envelope)');
        expect(unparseable?.status).toBe('unverified');
        expect(unparseable?.actual).toContain('no parseable JSON');
        // A failing probe carries its exit code and stderr, never a silent pass.
        const failed = rowFor('team status --json (envelope)');
        expect(failed?.status).toBe('unverified');
        expect(failed?.actual).toContain('exit 3');
        expect(failed?.actual).toContain('no team configured');
        // Wide envelopes are truncated in the report rather than flooding the row.
        expect(rowFor('status --json (envelope)')?.actual).toContain('…');
    });

    test('the fields the plugin scripts depend on are confirmed against the captured envelope', () => {
        // feature-sync-bounded reads a bare task-list array, asserted in script code.
        // (task-size-precheck stopped reading doctor's capabilityTier in 0723 — count-only.)
        expect(rows.find((r) => r.asserted.includes('bare array'))?.status).toBe('ok');
        // Launching a real coding agent is not mechanically reachable — recorded, never passed.
        expect(rows.find((r) => r.asserted.includes('roleOrigin'))?.status).toBe('unverified');
    });

    test('a prose flag claim is verified against the live surface in both directions', () => {
        const claim = () => rows.find((r) => r.asserted.includes('--stage (prose claim'));
        expect(claim()?.status).toBe('ok'); // live has no --stage, as the corrected prose says

        // Re-probe with a surface that DOES expose --stage: the prose is now wrong.
        surfaceCache.set('agent run', { commands: [], flags: ['--json', '--stage'] });
        probeJsonShapes(responder('{"agents":[{"tier":"standard"}]}'));
        expect(claim()?.status).toBe('mismatch');
        expect(claim()?.actual).toContain('live exposes --stage but prose claims otherwise');
    });

    test('a field that vanishes from the envelope is drift, and a failed probe is not a pass', () => {
        // 0723: task-size-precheck stopped reading doctor's capabilityTier — the row is gone.
        expect(rows.find((r) => r.asserted.includes('capabilityTier'))).toBeUndefined();
        // Same second probe run: task list exited non-zero — a failed probe is not a pass.
        expect(rows.find((r) => r.asserted.includes('bare array'))?.status).toBe('mismatch');
    });
});

// ─── sweepWorkflows (injected runner + fixture tree) ─────────────────────

describe('sweepWorkflows — engine verdicts and the runtime symlink', () => {
    let dir = '';
    let wfDir = '';
    const calls: string[][] = [];

    const runWf: CliRunner = (args) => {
        calls.push(args);
        const path = args[2] ?? '';
        if (args[1] === 'validate') {
            return path.includes('task-pipeline')
                ? { exit: 2, out: '', err: 'schema: unknown step kind' }
                : { exit: 0, out: 'valid\n', err: '' };
        }
        return path.includes('task-pipeline')
            ? { exit: 124, out: '', err: '' }
            : { exit: 0, out: 'walked 3 steps\nterminated\n', err: '' };
    };

    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'spur-wf-'));
        wfDir = join(dir, 'workflows');
        mkdirSync(wfDir, { recursive: true });
        writeFileSync(
            join(wfDir, 'basic.yaml'),
            ['name: basic', 'description: "gate on `spur task ghostwf` first"'].join('\n'),
        );
        writeFileSync(join(wfDir, 'task-pipeline.yaml'), 'name: task-pipeline\n');
        writeFileSync(join(wfDir, 'notes.md'), 'not a workflow\n'); // non-YAML is skipped
        symlinkSync(wfDir, join(dir, 'link'));

        sweepWorkflows({ run: runWf, wfDir, link: join(dir, 'link') });
    });

    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    test('validate failure is drift and carries the engine error', () => {
        expect(rowFor('workflow validate basic.yaml')?.status).toBe('ok');
        const bad = rowFor('workflow validate task-pipeline.yaml');
        expect(bad?.status).toBe('mismatch');
        expect(bad?.actual).toContain('schema: unknown step kind');
    });

    test('a dry-run that terminates proves the walk; only a timeout is unverified', () => {
        // Any exit proves the engine walked the definition — schema divergence is validate's
        // job, so a non-zero dry-run must not be double-reported as drift here.
        const walked = rowFor('workflow run basic.yaml --dry-run');
        expect(walked?.status).toBe('ok');
        expect(walked?.actual).toContain('terminated');
        const hung = rowFor('workflow run task-pipeline.yaml --dry-run');
        expect(hung?.status).toBe('unverified');
        expect(hung?.actual).toContain('did not terminate in 45s');
    });

    test('the task pipeline is dry-run with the vars it requires, others without', () => {
        const dryRuns = calls.filter((c) => c.includes('--dry-run'));
        const pipeline = dryRuns.find((c) => (c[2] ?? '').includes('task-pipeline'));
        const basic = dryRuns.find((c) => (c[2] ?? '').includes('basic'));
        expect(pipeline?.join(' ')).toContain('--vars');
        expect(pipeline?.join(' ')).toContain('"wbs":"0539"');
        expect(basic?.includes('--vars')).toBe(false);
    });

    test('invocations asserted inside the YAML are checked like any other claim', () => {
        const row = rowFor('spur task ghostwf');
        expect(row?.status).toBe('mismatch');
        expect(row?.occurrences[0]?.file).toContain('basic.yaml');
    });

    test('the runtime symlink is reported as absent under the two-tier model (0648/0650)', () => {
        // record() updates the symlink row in-place and is sticky-mismatch, so reset the
        // row before each fresh sweep, then read the just-recorded result via rowFor.
        const resetAndSweep = (link: string) => {
            const i = rows.findIndex((r) => r.asserted === '.spur/workflows symlink');
            if (i >= 0) rows.splice(i, 1);
            sweepWorkflows({ run: runWf, wfDir, link });
            return rowFor('.spur/workflows symlink');
        };

        // When the path does not exist -> ok (absent is the target state).
        const absent = join(dir, 'absent-link');
        rmSync(absent, { force: true });
        expect(resetAndSweep(absent)?.status).toBe('ok');
        expect(resetAndSweep(absent)?.method).toBe('symlink-absent');

        // When a stale symlink still exists -> mismatch.
        const staleLink = join(dir, 'stale-link');
        symlinkSync(wfDir, staleLink);
        expect(resetAndSweep(staleLink)?.status).toBe('mismatch');
        expect(resetAndSweep(staleLink)?.actual).toContain('should be removed');
        rmSync(staleLink);
    });
});

// ─── render ──────────────────────────────────────────────────────────────

describe('render — the inventory report', () => {
    test('reports totals, escapes table pipes, and lists every mismatch for disposition', () => {
        const saved = rows.splice(0, rows.length);
        try {
            expect(render()).toContain('None — every mechanically-checked assertion matches');

            for (let line = 1; line <= 6; line++) {
                record('a | b', 'ut-render(x)', 'mismatch', 'bad | worse', { file: 'f.md', line });
            }
            record('c', 'ut-render(x)', 'ok', 'fine', { file: 'f.md', line: 1 });

            const out = render();
            expect(out).toContain('Root nouns: alpha, zeta, task, self.');
            expect(out).toContain('**Totals: 1 ok · 1 mismatch · 0 unverified**');
            expect(out).toContain('## ut-render — 1 mismatch / 2 entries');
            expect(out).toContain('`a \\| b`'); // an unescaped pipe would break the table row
            expect(out).toContain('…+2'); // occurrences beyond the first four are counted
            expect(out).toContain('## Confirmed mismatches (R3 disposition)');
        } finally {
            rows.splice(0, rows.length);
            rows.push(...saved);
        }
    });
});
