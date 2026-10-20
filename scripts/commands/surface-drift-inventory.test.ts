/**
 * surface-drift-inventory — unit coverage for the span/flag parsers (task 0539),
 * the pure row/walk/flatten helpers, and the two deterministic sweeps
 * (sweepHooks reads repo-owned files).
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
    checkSectionOperand,
    flagNames,
    flattenKeys,
    isFlagSpan,
    legacySelfAliases,
    lineInvocationSpans,
    nounOfReference,
    parseInvocation,
    probeJsonShapes,
    record,
    render,
    resetLegacySelfAliases,
    rows,
    runCli,
    setHiddenProbeRunner,
    surfaceCache,
    sweepHooks,
    sweepPluginTrees,
    sweepScriptArgv,
    sweepWorkflows,
    walk,
} from './surface-drift-inventory';

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

    test('lineInvocationSpans extracts a backticked invocation once, not also as bare text', () => {
        // Double extraction made the words inside an inline-code citation their own claims:
        // `spur self exec` also yielded a bare `spur self`, and a negated `spur exec <action>`
        // left a stray `spur exec` (task 1265 row 9).
        const spans = lineInvocationSpans('it exists only as `spur self exec` — there is no `spur exec` top-level');
        expect(spans).toEqual(['spur self exec', 'spur exec']);
    });

    test('lineInvocationSpans ignores backticked spans that are not invocations', () => {
        expect(lineInvocationSpans('the `feature_id` frontmatter field')).toEqual([]);
    });

    test('lineInvocationSpans finds bare (unbackticked) shell-style invocations', () => {
        // The bare regex captures `spur <noun>` (one token), keeping any leading shell
        // separator in the match; full invocations travel backticked. Both forms must
        // be found — but a bare span needs shell context (task 1265 R7).
        expect(lineInvocationSpans('$ spur workflow validate x.yaml')).toContain('spur workflow');
        expect(lineInvocationSpans('then; spur task check 0042').some((s) => s.includes('spur task'))).toBe(true);
    });

    test('lineInvocationSpans treats an un-backticked prose sentence as no claim at all', () => {
        // `spur exits with the child exit code.` is English, not an invocation. Matching it at
        // line start reported the word `exits` as a missing noun (task 1265 R7, row 10).
        expect(lineInvocationSpans("spur exits with the child's exit code.")).toEqual([]);
        expect(lineInvocationSpans('spur exits 0 on success')).toEqual([]);
    });

    test('lineInvocationSpans keeps fenced code and bun prefixes as shell context', () => {
        // A fenced line may start with the invocation — that is why the sweep opts in explicitly.
        expect(lineInvocationSpans('spur task check 0042', { fenced: true }).length).toBeGreaterThan(0);
        expect(lineInvocationSpans('bun run apps/cli/src/index.ts task check 0042').length).toBeGreaterThan(0);
    });

    test('lineInvocationSpans finds the monorepo dev entry form bare', () => {
        const spans = lineInvocationSpans('(apps/cli/src/index.ts task show 0042)');
        expect(spans.some((s) => s.includes('apps/cli/src/index.ts') && s.includes('task'))).toBe(true);
    });

    test('lineInvocationSpans does not grab a bare span across a shell separator', () => {
        const spans = lineInvocationSpans('then; spur task check | jq .');
        expect(spans.length).toBeGreaterThan(0);
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

    test('flagNames needs a left token boundary, so a value tail is not a flag', () => {
        // `-local` was read out of the value `task-local`, and `-id` out of the placeholder
        // `<spec-id>` — both reported as missing flags (task 1265 R4, rows 11-12).
        expect(flagNames('--ac-numbering task-local')).toEqual(['--ac-numbering']);
        expect(flagNames('--assignee <spec-id>')).toEqual(['--assignee']);
        expect(flagNames('--letter <A-Z>')).toEqual(['--letter']);
    });

    test('stripping placeholders keeps a real flag sitting next to one', () => {
        expect(flagNames('--tasks <file> --letter <A-Z>')).toEqual(['--tasks', '--letter']);
        expect(isFlagSpan('--tasks <file> --letter <A-Z>')).toBe(true);
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

        // Pi no longer ships a plugin-owned extension (superskill's native adapter renders
        // hooks.json). When plugin.json declares none, the sweep must not invent rows.
        const ext = added.filter((r) => r.asserted.startsWith('pi extension'));
        expect(ext).toEqual([]);

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

// ─── runCli (the one live-spawn test) ────────────────────────────────────

describe('runCli — exit classification against the source-local CLI', () => {
    // Every live sweep reads its verdict off these three outcomes, so the mapping is checked
    // against the real binary once rather than only against the fakes used above.
    test('a successful command returns exit 0 and its stdout', () => {
        const r = runCli(['--help']);
        expect(r.exit).toBe(0);
        expect(r.out).toContain('Commands:');
    }, 60_000);

    test('a failing command returns its status and captured stderr', () => {
        const r = runCli(['definitely-not-a-noun']);
        expect(r.exit).toBeGreaterThan(0);
        expect(r.exit).not.toBe(124);
        expect(r.err.length).toBeGreaterThan(0);
    }, 60_000);

    test('a command killed by the timeout is reported as 124, not as a failure', () => {
        // sweepWorkflows treats 124 as unverified rather than drift — a hung dry-run must
        // never be reported as a broken workflow.
        expect(runCli(['--help'], 50).exit).toBe(124);
    }, 60_000);
});

// ─── Seeded live surface ─────────────────────────────────────────────────
//
// Everything below judges claims against a FAKE CLI surface seeded into the
// capture cache. That keeps the verdict logic hermetic and, more importantly,
// stable: these tests assert how a claim is judged, not which verbs the CLI
// happens to ship today, so a real verb rename can never turn them red.

surfaceCache.set('', { commands: ['alpha', 'zeta', 'task', 'self', 'agent', 'grp'], flags: ['--help', '--no-logo'] });
surfaceCache.set('alpha', { commands: ['run', 'peek'], flags: ['--noun-flag'] });
surfaceCache.set('alpha run', { commands: [], flags: ['--json', '--force'] });
surfaceCache.set('alpha peek', { commands: [], flags: ['--json'] });
surfaceCache.set('zeta', { commands: ['live'], flags: [] });
surfaceCache.set('task', { commands: ['check', 'update'], flags: [] });
surfaceCache.set('task check', { commands: [], flags: ['--json'] });
surfaceCache.set('task update', { commands: [], flags: ['--section', '--from-file'] });
surfaceCache.set('self', { commands: ['init', 'maintain', 'migrate', 'serve', 'status', 'exec'], flags: [] });
surfaceCache.set('self status', { commands: [], flags: ['--json'] });
// A verb that is itself a command group: its documented flags live one level deeper (task 1265 R3).
surfaceCache.set('grp', { commands: ['nested'], flags: [] });
surfaceCache.set('grp nested', { commands: ['gate', 'validate-report'], flags: ['--json'] });
surfaceCache.set('grp nested gate', { commands: [], flags: ['--testee'] });
surfaceCache.set('grp nested validate-report', { commands: [], flags: ['--file'] });

/**
 * Default probe answer for the whole seeded suite: "no such command". Hermetic (the probe
 * never shells a real CLI) and it keeps the derived self-alias set on its documented
 * baseline, so the rows below stay stable against today's CLI shape.
 */
const probeAbsent: CliRunner = () => ({ exit: 1, out: '', err: 'error: unknown command' });
setHiddenProbeRunner(probeAbsent);

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

// ─── Task 1265 — the four verified false-positive classes ────────────────
//
// Each of these was a CONFIRMED mismatch the inventory reported against correct prose
// (see the task's root-cause table). They are grouped because they are one defect class:
// the checker judged the citation against a surface Commander cannot express — a global
// option, a hidden command, a nested command group, or a prose token that is not a flag.

describe('global options (task 1265 R1, row 1)', () => {
    const occ = { file: 'fixture.md', line: 1 };

    test('a root program option is ok on any command path, and says why', () => {
        checkNounVerbFlags(['alpha'], ['peek'], ['--no-logo'], occ);
        const row = rowFor('spur alpha peek --no-logo');
        expect(row?.status).toBe('ok');
        expect(row?.actual).toBe('global option (root program)');
    });

    test('the exemption is exactly root membership — it does not widen a verb-level miss', () => {
        // `--force` is a real flag but on a DIFFERENT verb; nothing about the global rule
        // may turn a genuinely absent flag green.
        checkNounVerbFlags(['alpha'], ['peek'], ['--force'], occ);
        expect(rowFor('spur alpha peek --force')?.status).toBe('mismatch');
    });

    test('a global option is accepted at the noun level and on a legacy self alias too', () => {
        checkNounVerbFlags(['alpha'], [], ['--no-logo'], occ);
        expect(rowFor('spur alpha --no-logo')?.status).toBe('ok');
        checkNounVerbFlags(['status'], [], ['--no-logo'], occ);
        expect(rowFor('spur status --no-logo')?.status).toBe('ok');
    });
});

describe('hidden verbs (task 1265 R2, rows 2-7)', () => {
    const occ = { file: 'fixture.md', line: 1 };
    const hiddenHelp = [
        'Usage: spur agent loop [options]',
        '',
        'Options:',
        '  --json  machine-readable output',
        '  -h, --help  display help for command',
    ].join('\n');

    afterAll(() => setHiddenProbeRunner(probeAbsent));

    test('a hidden registered verb is present, with its flags captured from the probe', () => {
        setHiddenProbeRunner((args) =>
            args.join(' ') === 'agent loop --help'
                ? { exit: 0, out: hiddenHelp, err: '' }
                : { exit: 1, out: '', err: 'error: unknown command' },
        );
        checkNounVerbFlags(['agent'], ['loop'], ['--json'], occ);
        const row = rowFor('spur agent loop');
        expect(row?.status).toBe('ok');
        expect(row?.actual).toBe('hidden verb present (not listed in --help)');
        expect(rowFor('spur agent loop --json')?.status).toBe('ok');
    });

    test('a probe answering "unknown command" records mismatch, never ok', () => {
        setHiddenProbeRunner(probeAbsent);
        checkNounVerbFlags(['zeta'], ['ghost'], [], occ);
        const row = rowFor('spur zeta ghost');
        expect(row?.status).toBe('mismatch');
        expect(row?.actual).toContain('verb absent');
    });

    test('a probe that answers the PARENT help is absence, not presence', () => {
        // Commander prints the parent's help and exits 0 for an unknown command's `--help`
        // (`spur exec --help` → root help, `spur workflow monitor --help` → workflow help).
        setHiddenProbeRunner((args) =>
            args.join(' ') === 'zeta ghosthood --help'
                ? { exit: 0, out: 'Usage: spur zeta [options] [command]\n\nOptions:\n  --json  out', err: '' }
                : probeAbsent(args),
        );
        checkNounVerbFlags(['zeta'], ['ghosthood'], [], occ);
        expect(rowFor('spur zeta ghosthood')?.status).toBe('mismatch');
    });

    test('a probe that times out is unverified — never ok, never drift', () => {
        // A distinct verb: rows merge by (asserted, method) and a recorded mismatch is sticky.
        setHiddenProbeRunner((args) =>
            args.join(' ') === 'zeta ghostly --help'
                ? { exit: 124, out: '', err: 'timed out' }
                : { exit: 0, out: 'not commander help at all', err: '' },
        );
        checkNounVerbFlags(['zeta'], ['ghostly'], [], occ);
        const row = rowFor('spur zeta ghostly');
        expect(row?.status).toBe('unverified');
        expect(row?.actual).toContain('did not answer');
    });
});

describe('nested command groups (task 1265 R3, rows 3-7)', () => {
    const occ = { file: 'fixture.md', line: 1 };

    test('a flag living on a subcommand is unverified shorthand, naming the subcommands', () => {
        checkNounVerbFlags(['grp'], ['nested'], ['--testee'], occ);
        const row = rowFor('spur grp nested --testee');
        expect(row?.status).toBe('unverified');
        expect(row?.actual).toContain('nested shorthand');
        expect(row?.actual).toContain('1/2 subcommands');
        expect(row?.actual).toContain('gate');
    });

    test('a verb-level flag stays ok and is not downgraded to shorthand', () => {
        checkNounVerbFlags(['grp'], ['nested'], ['--json'], occ);
        expect(rowFor('spur grp nested --json')?.status).toBe('ok');
    });

    test('a flag on none of the subcommands is still drift', () => {
        checkNounVerbFlags(['grp'], ['nested'], ['--nowhere'], occ);
        expect(rowFor('spur grp nested --nowhere')?.status).toBe('mismatch');
    });
});

describe('legacy self-alias set (task 1265 R5, row 8)', () => {
    const occ = { file: 'fixture.md', line: 1 };

    afterAll(() => {
        setHiddenProbeRunner(probeAbsent);
        resetLegacySelfAliases();
    });

    test('the set is derived from `spur self`, so maintain cannot be missing', () => {
        resetLegacySelfAliases();
        setHiddenProbeRunner((args) => {
            const alias = args[0] ?? '';
            if (args[1] !== '--help' || alias === 'exec') return { exit: 1, out: '', err: 'error: unknown command' };
            // A real hidden alias answers with its OWN usage line — that is what proves the probe.
            return { exit: 0, out: `Usage: spur ${alias} [options]\n\nOptions:\n  --json  out`, err: '' };
        });
        const aliases = legacySelfAliases();
        expect(aliases.has('maintain')).toBe(true);
        // `exec` exists only under `spur self`; a root-alias probe is what keeps it out.
        expect(aliases.has('exec')).toBe(false);
        checkNounVerbFlags(['maintain'], [], [], occ);
        expect(rowFor('spur maintain')?.status).toBe('ok');
    });

    test('a probe that cannot answer keeps the documented baseline instead of shrinking', () => {
        resetLegacySelfAliases();
        setHiddenProbeRunner(probeAbsent);
        const aliases = legacySelfAliases();
        for (const name of ['init', 'maintain', 'migrate', 'serve', 'status']) expect(aliases.has(name)).toBe(true);
    });
});

// ─── Semantic --section operand layer (I7 / task 0906 R2) ────────────────

describe('checkSectionOperand — semantic --section operand drift (task 0906 R2)', () => {
    const occ = { file: 'fixture.md', line: 1 };

    test('the wayfinder defect (I6/0594 D1) is flagged with the corrected recipe named', () => {
        // The exact shipped prose span that tagged maps through --section tags.
        checkSectionOperand('spur feature update <id> --section tags --from-file <(printf \'["wayfinder-map"]\')', occ);
        const row = rowFor('spur feature update --section tags');
        expect(row?.status).toBe('mismatch');
        expect(row?.actual).toContain('--field tags --value');
    });

    test('metadata-only siblings from the I6 sweep are flagged on task update, quoted and = forms', () => {
        checkSectionOperand("spur task update 0042 --section 'priority'", occ);
        expect(rowFor('spur task update --section priority')?.status).toBe('mismatch');
        checkSectionOperand('spur task update 0042 --section=status', occ);
        expect(rowFor('spur task update --section status')?.status).toBe('mismatch');
    });

    test('a genuine body heading is accepted — feature Scope even though scope is in the swept set', () => {
        // planning-workflow Step 5.6's real AC write and the historical sweep's `scope` overlap:
        // the per-noun body-section set wins over the metadata classification.
        checkSectionOperand('spur feature update <id> --section "Acceptance Criteria" --from-file <file>', occ);
        checkSectionOperand('spur feature update <id> --section Scope', occ);
        expect(rowFor('spur feature update --section Acceptance Criteria')).toBeUndefined();
        expect(rowFor('spur feature update --section Scope')).toBeUndefined();
        checkSectionOperand('spur task update <wbs> --section Plan --json', occ);
        expect(rowFor('spur task update --section Plan')).toBeUndefined();
    });

    test('comparison is case-normalized but the row keeps the original operand text', () => {
        checkSectionOperand('spur task update 0042 --section Tags.', occ);
        expect(rowFor('spur task update --section Tags')?.status).toBe('mismatch');
    });

    test('dynamic operands stay unverified (no row) under the existing scanner convention', () => {
        const before = rows.length;
        checkSectionOperand('spur task update <wbs> --section <name>', occ);
        checkSectionOperand('spur task update <wbs> --section $SECTION', occ);
        expect(rows.length).toBe(before);
    });

    test('non-update verbs, other nouns, and prose-only mentions assert nothing', () => {
        const before = rows.length;
        checkSectionOperand('spur task show 0042 --section tags', occ); // only the update class is in scope
        checkSectionOperand('spur rule update r1 --section tags', occ); // audit boundary is task/feature
        checkSectionOperand('never pass `--section tags` here', occ); // prose, not a literal invocation
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
                'Run `spur task check 0042 --bogus-flag` to prove true drift still fails.',
                '',
                '```bash',
                'spur fenced check',
                '```',
                '',
                'Prose: no `spur task vanish` verb exists.',
                'Prose: no `spur zeta live` verb exists.',
                'Prose: there is no `spur exec` top-level alias (`spur exec <action>` is an unknown command).',
                'Prose: a public `spur check` verb is out of scope without separate consent.',
                'Prose: **Forbidden surface: `spur agent loop`** (supervisor-internal).',
                'Prose: spur exits with the child exit code.',
                // Failure mode 6: a negation must not swallow a positive claim on the same line.
                'Prose: `spur task check 0042 --json` is the gate; there is no `spur task` noun-level alias.',
                // A flag-scoped absence claim is about the FLAG, not the verb (review P2).
                'Prose: there is no `spur task update --tags` flag; use `--add-tag`.',
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

        // `spur agent loop` is the hidden-verb case the sweep must now probe for; every other
        // probe answer stays "unknown command" so the fixture is hermetic.
        resetLegacySelfAliases();
        setHiddenProbeRunner((args) =>
            args.join(' ') === 'agent loop --help'
                ? { exit: 0, out: 'Usage: spur agent loop [options]\n\nOptions:\n  --json  out', err: '' }
                : probeAbsent(args),
        );
        sweepPluginTrees(dir);
        sweepScriptArgv(dir);
    });

    afterAll(() => {
        resetLegacySelfAliases();
        setHiddenProbeRunner(probeAbsent);
        rmSync(dir, { recursive: true, force: true });
    });

    test('a backticked invocation in prose is checked, flags included', () => {
        expect(rowFor('spur task check')?.status).toBe('ok');
        expect(rowFor('spur task check --json')?.status).toBe('ok');
    });

    test('true drift still yields a mismatch — a fake flag is excused by no new rule (R8)', () => {
        expect(rowFor('spur task check --bogus-flag')?.status).toBe('mismatch');
    });

    test('every documented-absence shape confirms, instead of reporting drift (R6)', () => {
        for (const asserted of ['spur exec', 'spur check']) {
            const row = rowFor(asserted);
            expect(row?.status).toBe('ok');
            expect(row?.actual).toContain('documented absence confirmed');
        }
    });

    test('a forbidden-surface mention is internal, not absence — the hidden verb is ok (R6)', () => {
        const row = rowFor('spur agent loop');
        expect(row?.status).toBe('ok');
        expect(row?.actual).toContain('hidden verb present');
    });

    test('a prose line that merely begins "spur <word>" yields no row (R7)', () => {
        expect(rowFor('spur exits')).toBeUndefined();
    });

    test('a negation does not swallow a positive claim on the same line (failure mode 6)', () => {
        // `spur task` is negated here; `spur task check 0042 --json` beside it is not, and a
        // prefix-based clause match produced an EXTRA stale-negation row for `spur task check`.
        // Asserting the row set is the guard: individual rows look identical either way.
        expect(rowFor('spur task check')?.status).toBe('ok');
        // The one line in the fixture with no clause owner is the pre-existing `spur zeta live`.
        expect(rows.filter((r) => (r.actual ?? '').includes('stale negation')).map((r) => r.asserted)).toEqual([
            'spur zeta live',
            'spur task',
        ]);
    });

    test('a flag-scoped absence claim is judged on the flag, not on the verb (review P2)', () => {
        // `spur task update` exists; `--tags` does not. Judging the command alone reported drift.
        const row = rowFor('spur task update --tags');
        expect(row?.status).toBe('ok');
        expect(row?.actual).toContain('documented absence confirmed');
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
            if (key === 'projects list --json') return { exit: 3, out: '', err: 'no registry configured' };
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
        const failed = rowFor('projects list --json (envelope)');
        expect(failed?.status).toBe('unverified');
        expect(failed?.actual).toContain('exit 3');
        expect(failed?.actual).toContain('no registry configured');
        // Wide envelopes are truncated in the report rather than flooding the row.
        expect(rowFor('status --json (envelope)')?.actual).toContain('…');
    });

    test('the fields the plugin scripts depend on are confirmed against the captured envelope', () => {
        // The task service reads a bare task-list array (JSON envelope probe).
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
            expect(out).toContain('Root nouns: alpha, zeta, task, self, agent, grp.');
            expect(out).toContain('**Totals: 1 ok · 1 mismatch · 0 unverified**');
            expect(out).toContain('## ut-render — 1 mismatch / 2 entries');
            expect(out).toContain('`a \\| b`'); // an unescaped pipe would break the table row
            expect(out).toContain('…+2'); // occurrences beyond the first four are counted
            expect(out).toContain('## Confirmed mismatches (R3 disposition)');
            // The reader must be able to see the two rules that decide most rows (task 1265).
            expect(out).toContain('global option');
            expect(out).toContain('hidden-verb probe');
        } finally {
            rows.splice(0, rows.length);
            rows.push(...saved);
        }
    });
});
