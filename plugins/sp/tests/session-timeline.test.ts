import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseRows, promptText, skillInvocationPrompt } from '../lib/transcript';
import {
    buildTimeline,
    formatDuration,
    formatTokenSplit,
    formatTokens,
    main,
    parseGroups,
    resolveTranscript,
    SESSION_TIMELINE_USAGE,
    zeroSegmentReason,
} from '../scripts/session-timeline';

/** Concatenated source of every `.ts`/`.mjs` file under `plugins/sp/<dir>`, for the AC3 source pin. */
function sourceText(dir: 'lib' | 'scripts'): string {
    const root = join(import.meta.dir, '..', dir);
    const read = (d: string): string =>
        readdirSync(d, { withFileTypes: true })
            .filter((e) => e.isDirectory() || /\.(ts|mjs)$/.test(e.name))
            .map((e) => (e.isDirectory() ? read(join(d, e.name)) : readFileSync(join(d, e.name), 'utf8')))
            .join('\n');
    return read(root);
}

/**
 * session-timeline feeds the /sp:dev-review-session Time breakdown. Failure modes, written before
 * the code:
 *  F1 one assistant response is split over several records that repeat the same usage → tokens
 *     counted N times unless deduplicated by message.id;
 *  F2 tool_result records are `type: user` → each one would open a fake prompt segment;
 *  F3 isMeta (skill bodies) and isCompactSummary records would open fake segments;
 *  F4 the idle gap between the last activity and the next prompt counted as work instead of wait;
 *  F5 the final segment has no next prompt → it must not invent a wait;
 *  F6 malformed lines or records without a timestamp crash the parse or skew timing;
 *  F7 no session id / missing file → must report unavailable (exit 0) rather than guess another
 *     session's transcript; an id with path characters must be refused;
 *  F8 stage grouping out of range or overlapping silently mis-sums the table.
 *  F9 an AskUserQuestion gate blocks inside a segment → the operator's answer time counted as work.
 *  F10 cache reads dominate the total → a single "in" figure hides the non-cached spend; total must
 *      include cache read and non-cached must exclude it, both in compact units.
 */

const T0 = Date.parse('2026-10-04T03:00:00.000Z');
const at = (s: number): string => new Date(T0 + s * 1000).toISOString();
const usage = (out: number) => ({
    input_tokens: 2,
    cache_creation_input_tokens: 100,
    cache_read_input_tokens: 1000,
    output_tokens: out,
});

function fixture(): string[] {
    const rows: unknown[] = [
        { type: 'user', timestamp: at(0), message: { role: 'user', content: 'first request' } },
        // F1: one response (m1) split into two records with identical usage
        {
            type: 'assistant',
            timestamp: at(5),
            message: { id: 'm1', content: [{ type: 'thinking' }], usage: usage(50) },
        },
        {
            type: 'assistant',
            timestamp: at(6),
            message: { id: 'm1', content: [{ type: 'tool_use', id: 't1' }], usage: usage(50) },
        },
        // F2: tool result is not a prompt
        { type: 'user', timestamp: at(10), message: { role: 'user', content: [{ type: 'tool_result' }] } },
        // F3: meta + compaction summary are not prompts
        { type: 'user', isMeta: true, timestamp: at(11), message: { role: 'user', content: 'skill body' } },
        { type: 'user', isCompactSummary: true, timestamp: at(12), message: { role: 'user', content: 'summary' } },
        { type: 'assistant', timestamp: at(20), message: { id: 'm2', content: [{ type: 'text' }], usage: usage(10) } },
        'not json', // F6
        { type: 'attachment' }, // F6: no timestamp
        // F4: operator idles 0:40 before the second prompt
        { type: 'user', timestamp: at(60), message: { role: 'user', content: [{ type: 'text', text: 'second' }] } },
        {
            type: 'assistant',
            timestamp: at(90),
            message: {
                id: 'm3',
                content: [
                    { type: 'tool_use', id: 't2' },
                    { type: 'tool_use', id: 't3' },
                ],
                usage: usage(5),
            },
        },
    ];
    return rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r)));
}

describe('buildTimeline', () => {
    const tl = buildTimeline(fixture());

    test('segments open only on real operator prompts (F2, F3)', () => {
        expect(tl.segments.map((s) => s.prompt)).toEqual(['first request', 'second']);
    });

    test('work ends at the last activity; the idle gap is wait (F4, F5)', () => {
        expect(tl.segments[0]).toMatchObject({ workMs: 20_000, waitMs: 40_000, toolCalls: 1 });
        expect(tl.segments[1]).toMatchObject({ workMs: 30_000, waitMs: 0, toolCalls: 2 });
        expect(tl.totals).toMatchObject({ elapsedMs: 90_000, workMs: 50_000, waitMs: 40_000, toolCalls: 3 });
    });

    test('tokens are counted once per message id (F1)', () => {
        expect(tl.segments[0]?.tokens).toEqual({ input: 4, cacheCreate: 200, cacheRead: 2000, output: 60 });
        expect(tl.totals.tokens.output).toBe(65);
    });

    test('malformed lines are counted, not fatal (F6)', () => {
        expect(tl.skippedLines).toBe(1);
    });
});

describe('stage grouping (F8)', () => {
    test('parses ranges and singles', () => {
        expect(parseGroups('1-2,3', 3)).toEqual([
            [1, 2],
            [3, 3],
        ]);
    });

    test('rejects out-of-range, reversed and overlapping groups', () => {
        expect(() => parseGroups('1-4', 3)).toThrow();
        expect(() => parseGroups('2-1', 3)).toThrow();
        expect(() => parseGroups('1-2,2-3', 3)).toThrow();
    });

    test('stage sums equal segment sums', () => {
        const tl = buildTimeline(fixture(), '1-2');
        expect(tl.stages?.[0]).toMatchObject({ segments: '1-2', workMs: 50_000, waitMs: 40_000, toolCalls: 3 });
    });
});

describe('resolveTranscript (F7)', () => {
    test('no session id and no override is unavailable', () => {
        expect(resolveTranscript({}, '/nope')).toEqual({ ok: false, reason: expect.stringContaining('session id') });
    });

    test('an id with path characters is refused', () => {
        expect(resolveTranscript({ CLAUDE_CODE_SESSION_ID: '../x' }, '/nope').ok).toBe(false);
    });

    test('finds <projects>/<any>/<id>.jsonl', () => {
        const root = mkdtempSync(join(tmpdir(), 'session-timeline-'));
        const dir = join(root, '-some-project');
        mkdirSync(dir);
        writeFileSync(join(dir, 'abc-123.jsonl'), '');
        expect(resolveTranscript({ CLAUDE_CODE_SESSION_ID: 'abc-123' }, root)).toEqual({
            ok: true,
            path: join(dir, 'abc-123.jsonl'),
        });
    });

    test('main reports unavailable with exit 0', () => {
        const out: string[] = [];
        expect(main([], {}, (s) => out.push(s), '/nope')).toBe(0);
        expect(JSON.parse(out.join(''))).toMatchObject({ available: false });
    });
});

describe('main CLI surface', () => {
    const writeFixture = (): string => {
        const path = join(mkdtempSync(join(tmpdir(), 'session-timeline-cli-')), 's.jsonl');
        writeFileSync(path, `${fixture().join('\n')}\n`);
        return path;
    };

    test('builds the timeline from --transcript, with stages via --group', () => {
        const out: string[] = [];
        const path = writeFixture();
        expect(main(['--transcript', path, '--group', '1-2'], {}, (s) => out.push(s), '/nope')).toBe(0);
        const parsed = JSON.parse(out.join(''));
        expect(parsed).toMatchObject({ available: true, transcript: path, skippedLines: 1 });
        expect(parsed.segments).toHaveLength(2);
        expect(parsed.stages).toHaveLength(1);
    });

    test('accepts and ignores --spur-bin (0482 R2)', () => {
        const out: string[] = [];
        expect(main(['--spur-bin', 'spur', '--transcript', writeFixture()], {}, (s) => out.push(s), '/nope')).toBe(0);
        expect(JSON.parse(out.join('')).available).toBe(true);
    });

    test('unknown and value-less flags exit 2 (usage goes to stderr)', () => {
        const errs: string[] = [];
        const writeErr = (s: string) => errs.push(s);
        expect(main(['--bogus'], {}, () => {}, '/nope', writeErr)).toBe(2);
        expect(errs).toEqual([`${SESSION_TIMELINE_USAGE}\n`]);
        // V8 needs the default writeErr invoked: stub the real stream, invoke the default.
        const chunks: string[] = [];
        const real = process.stderr.write.bind(process.stderr);
        process.stderr.write = ((s: string) => {
            chunks.push(s);
            return true;
        }) as typeof process.stderr.write;
        try {
            expect(main(['--transcript'], {}, () => {}, '/nope')).toBe(2);
        } finally {
            process.stderr.write = real;
        }
        expect(chunks).toEqual([`${SESSION_TIMELINE_USAGE}\n`]);
    });

    test('a group past the segment count is a caught error, exit 2', () => {
        const errs: string[] = [];
        expect(
            main(
                ['--transcript', writeFixture(), '--group', '9-9'],
                {},
                () => {},
                '/nope',
                (s) => errs.push(s),
            ),
        ).toBe(2);
        expect(errs[0]).toContain('invalid --group "9-9"');
    });

    test('a missing --transcript override is unavailable, exit 0', () => {
        const out: string[] = [];
        expect(main(['--transcript', '/nope/missing.jsonl'], {}, (s) => out.push(s), '/nope')).toBe(0);
        expect(JSON.parse(out.join(''))).toMatchObject({ available: false });
    });

    test('default writer prints the timeline JSON to stdout (V8 needs the default invoked)', () => {
        const chunks: string[] = [];
        const real = process.stdout.write.bind(process.stdout);
        process.stdout.write = ((s: string) => {
            chunks.push(s);
            return true;
        }) as typeof process.stdout.write;
        try {
            expect(main(['--transcript', writeFixture()], {}, undefined, '/nope')).toBe(0);
        } finally {
            process.stdout.write = real;
        }
        expect(JSON.parse(chunks.join(''))).toMatchObject({ available: true });
    });

    test('a direct override short-circuits the session-id lookup', () => {
        const path = writeFixture();
        expect(resolveTranscript({}, '/nope', path)).toEqual({ ok: true, path });
        expect(resolveTranscript({}, '/nope', '/nope/missing.jsonl')).toEqual({ ok: false, reason: 'no transcript' });
    });

    test('prompts longer than 80 chars are truncated with an ellipsis', () => {
        const rows = [{ type: 'user', timestamp: at(0), message: { role: 'user', content: 'x'.repeat(100) } }].map(
            (r) => JSON.stringify(r),
        );
        expect(buildTimeline(rows).segments[0]?.prompt).toBe(`${'x'.repeat(80)}…`);
    });
});

describe('pi transcripts (1130)', () => {
    const fixturePath = join(import.meta.dir, 'fixtures', 'pi-session.jsonl');
    const piLines = (): string[] => readFileSync(fixturePath, 'utf8').split('\n');
    const fixtureToolCalls = (): number => piLines().reduce((n, l) => n + l.split('"toolCall"').length - 1, 0);

    test('AC1: a real pi transcript slice yields measured segments', () => {
        const tl = buildTimeline(piLines());
        // Five operator prompts in the fixture: three plain rows plus the two skill-invocation
        // wrappers (1151 R1/R3 — a pi wrapper row is an operator prompt, never an injected body).
        expect(tl.segments).toHaveLength(5);
        for (const seg of tl.segments) expect(seg.workMs).toBeGreaterThan(0);
        // Each toolCall block counted once, split across the prompt segments.
        expect(tl.segments.reduce((n, s) => n + s.toolCalls, 0)).toBe(fixtureToolCalls());
        expect(tl.totals.toolCalls).toBe(fixtureToolCalls());
        expect(tl.totals.tokens.output).toBeGreaterThan(0);
        expect(tl.totals.compactions).toBe(1);
        expect(tl.segments[0]?.compactions).toBe(1);
        // The ask_user_question gate inside segment 2 is operator wait, not work (R1): the 50s span
        // minus the 30s ask is work; wait is that ask plus the idle until the appended segment 3.
        expect(tl.segments[1]).toMatchObject({ workMs: 20_000, waitMs: 70_000 });
    });

    test('AC2: an unknown JSONL shape is reported, not hidden', () => {
        const out: string[] = [];
        const path = join(mkdtempSync(join(tmpdir(), 'session-timeline-unknown-')), 'u.jsonl');
        writeFileSync(path, `${JSON.stringify({ type: 'mystery', timestamp: at(0) })}\n`);
        expect(main(['--transcript', path], {}, (s) => out.push(s), '/nope')).toBe(0);
        expect(JSON.parse(out.join(''))).toEqual({
            available: false,
            reason: 'unrecognized transcript format (row types: mystery 1)',
        });
    });

    test('AC3: no host id names the --transcript remedy including the pi path', () => {
        const out: string[] = [];
        expect(main([], {}, (s) => out.push(s), '/nope')).toBe(0);
        const parsed = JSON.parse(out.join(''));
        expect(parsed.available).toBe(false);
        expect(parsed.reason).toContain('--transcript');
        expect(parsed.reason).toContain('(pi:');
    });

    test('Claude output carries no compactions field (R4 absent for Claude)', () => {
        const tl = buildTimeline(fixture());
        expect('compactions' in tl.totals).toBe(false);
        for (const seg of tl.segments) expect('compactions' in seg).toBe(false);
        // 1138 R2: the injected-prompt counter is gone (1151 R2), so Claude output is unchanged.
        expect('injectedPrompts' in tl).toBe(false);
    });
});

describe('1151 — pi skill invocations are operator prompts', () => {
    const fixturePath = join(import.meta.dir, 'fixtures', 'pi-session.jsonl');
    const piLines = (): string[] => readFileSync(fixturePath, 'utf8').split('\n');
    const segmentAt = (start: string) => buildTimeline(piLines()).segments.find((s) => s.start === start);

    test('AC1/R1: an invocation with arguments opens a segment rendered "/<name> <args>"', () => {
        const seg = segmentAt('2026-10-08T18:50:10.000Z');
        expect(seg?.prompt).toBe('/sp-dev-run --triage');
        expect(seg?.prompt).not.toContain('body');
        expect(seg?.prompt).not.toContain('<skill');
    });

    test('AC2/R3: an argument-less wrapper is still an operator segment rendered "/<name>"', () => {
        expect(segmentAt('2026-10-08T18:50:30.000Z')?.prompt).toBe('/rd3-anti-hallucination');
    });

    test('AC3/R2: the injected-body class is gone from the output, the reason and the sources', () => {
        const tl = buildTimeline(piLines());
        expect('injectedPrompts' in tl).toBe(false);
        expect(zeroSegmentReason(parseRows(piLines()).rows)).not.toContain('injected');
        expect(sourceText('lib')).not.toContain('isInjectedPrompt');
        expect(sourceText('scripts')).not.toContain('isInjectedPrompt');
    });

    test('AC4/R4: plain operator text mentioning "<skill" is unaffected', () => {
        const prompts = buildTimeline(piLines()).segments.map((s) => s.prompt);
        expect(prompts.some((p) => p.includes('operator note: the <skill name="x"> wrapper'))).toBe(true);
    });

    test('R1 parser edges: whitespace, string content, missing/repeated/malformed wrapper forms', () => {
        const pi = (text: unknown, role = 'user') => ({
            type: 'message',
            timestamp: at(0),
            message: { role, content: text },
        });
        // Leading whitespace before the wrapper is tolerated; the body never reaches the prompt.
        expect(promptText(pi([{ type: 'text', text: '  \n <skill name="a">\nbody\n</skill>\n\n--x' }]))).toBe('/a --x');
        // String content (not a block array) takes the same path.
        expect(promptText(pi('<skill name="b">\nbody\n</skill>'))).toBe('/b');
        // No closing tag: render the name alone rather than dumping the body.
        expect(promptText(pi([{ type: 'text', text: '<skill name="c">\nbody' }]))).toBe('/c');
        // A repeated closing tag uses the LAST one (a body may quote the tag).
        expect(promptText(pi([{ type: 'text', text: '<skill name="d">x</skill>\nmid</skill>\n\n--z' }]))).toBe(
            '/d --z',
        );
        // Malformed name (no closing quote) is not a wrapper: plain text, body and all.
        const malformed = '<skill name="e\nbody';
        expect(promptText(pi([{ type: 'text', text: malformed }]))).toBe(malformed);
        // A mid-body mention is plain text; a non-user role is never a prompt.
        expect(promptText(pi([{ type: 'text', text: 'hello <skill name="f">' }]))).toBe('hello <skill name="f">');
        expect(promptText(pi([{ type: 'text', text: '<skill name="g">' }], 'assistant'))).toBeUndefined();
        // The Claude path never enters the pi branch, so its wrapper text stays verbatim.
        expect(
            promptText({ type: 'user', timestamp: at(0), message: { role: 'user', content: '<skill name="h"> body' } }),
        ).toBe('<skill name="h"> body');
        // Direct helper contract.
        expect(skillInvocationPrompt('plain')).toBeUndefined();
        expect(skillInvocationPrompt('<skill name="i">\nb\n</skill>')).toBe('/i');
    });

    test('1151 follow-up: a hook-relayed custom_message segments; display:false stays activity', () => {
        const custom = (content: unknown, display: unknown, offset: number) => ({
            type: 'custom_message',
            customType: 'cc-anti-hallucination',
            content,
            display,
            id: `c${offset}`,
            timestamp: at(offset),
        });
        const assistant = (id: string, offset: number) => ({
            type: 'message',
            id,
            timestamp: at(offset),
            message: { role: 'assistant', content: [], usage: { input: 10, cacheRead: 100, output: 1 } },
        });
        const tl = buildTimeline(
            [
                custom('typed-style prompt', true, 0),
                assistant('a1', 5),
                custom('Add verification for: confidence level (HIGH/MEDIUM/LOW)', true, 10),
                assistant('a2', 15),
            ].map((r) => JSON.stringify(r)),
        );
        // The relayed prompt opens its own segment with its own window and tokens — it used to be
        // folded into the previous segment (no boundary) and misattributed.
        expect(tl.segments.map((s) => s.prompt)).toEqual([
            'typed-style prompt',
            'Add verification for: confidence level (HIGH/MEDIUM/LOW)',
        ]);
        expect(tl.segments[1]?.work).toBe('0:05');
        expect(tl.segments[0]?.tokens.input).toBe(10);
        expect(tl.segments[1]?.tokens.input).toBe(10);

        // display:false is a host-only notice; a blank body is not a prompt either.
        const one = buildTimeline(
            [
                custom('real prompt', true, 0),
                custom('hidden note', false, 5),
                custom('   ', true, 6),
                assistant('a1', 7),
            ].map((r) => JSON.stringify(r)),
        );
        expect(one.segments).toHaveLength(1);
        expect(one.segments[0]?.work).toBe('0:07');
    });

    test('AC1/R1: PI_SESSION_FILE resolves when no Claude session id is set', () => {
        const path = join(mkdtempSync(join(tmpdir(), 'session-timeline-pienv-')), 'pi.jsonl');
        writeFileSync(path, '{}\n');
        expect(resolveTranscript({ PI_SESSION_FILE: path }, '/nope')).toEqual({ ok: true, path });
    });

    test('AC1/R1: a missing PI_SESSION_FILE is named in the reason', () => {
        const resolved = resolveTranscript({ PI_SESSION_FILE: '/nope/missing.jsonl' }, '/nope');
        expect(resolved.ok).toBe(false);
        if (!resolved.ok) expect(resolved.reason).toBe('PI_SESSION_FILE /nope/missing.jsonl does not exist');
    });

    test('AC1/R1: an explicit --transcript beats PI_SESSION_FILE', () => {
        const dir = mkdtempSync(join(tmpdir(), 'session-timeline-prec-'));
        const explicit = join(dir, 'explicit.jsonl');
        const envFile = join(dir, 'env.jsonl');
        writeFileSync(explicit, '{}\n');
        writeFileSync(envFile, '{}\n');
        expect(resolveTranscript({ PI_SESSION_FILE: envFile }, '/nope', explicit)).toEqual({
            ok: true,
            path: explicit,
        });
    });

    test('AC1/R1: the Claude session id still wins when both are set', () => {
        const root = mkdtempSync(join(tmpdir(), 'session-timeline-cwin-'));
        const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
        mkdirSync(join(root, 'proj'), { recursive: true });
        const claudePath = join(root, 'proj', `${id}.jsonl`);
        writeFileSync(claudePath, '{}\n');
        const envFile = join(root, 'env.jsonl');
        writeFileSync(envFile, '{}\n');
        expect(resolveTranscript({ CLAUDE_CODE_SESSION_ID: id, PI_SESSION_FILE: envFile }, root)).toEqual({
            ok: true,
            path: claudePath,
        });
    });

    test('AC3/R3: zero-segment pi output names the format and the row count, with no injected count', () => {
        const dir = mkdtempSync(join(tmpdir(), 'session-timeline-zero-'));
        const path = join(dir, 'pi-zero.jsonl');
        const rows = [
            {
                type: 'message',
                id: 'a1',
                timestamp: '2026-10-08T18:45:52.074Z',
                message: { role: 'assistant', content: [] },
            },
            {
                type: 'message',
                id: 't1',
                timestamp: '2026-10-08T18:45:52.090Z',
                message: { role: 'toolResult', content: [] },
            },
        ];
        writeFileSync(path, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
        const out: string[] = [];
        expect(main(['--transcript', path], {}, (s) => out.push(s), '/nope')).toBe(0);
        const parsed = JSON.parse(out.join(''));
        expect(parsed.available).toBe(false);
        expect(parsed.reason).toBe('pi transcript with no operator prompts (2 rows)');
    });

    test('AC3/R3: an unknown format lists its row-type census', () => {
        const dir = mkdtempSync(join(tmpdir(), 'session-timeline-census-'));
        const path = join(dir, 'unknown.jsonl');
        const rows = [
            { type: 'mystery', timestamp: '2026-10-08T18:45:00.000Z' },
            { type: 'mystery', timestamp: '2026-10-08T18:45:01.000Z' },
            { type: 'other', timestamp: '2026-10-08T18:45:02.000Z' },
        ];
        writeFileSync(path, `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
        const out: string[] = [];
        expect(main(['--transcript', path], {}, (s) => out.push(s), '/nope')).toBe(0);
        const parsed = JSON.parse(out.join(''));
        expect(parsed.available).toBe(false);
        expect(parsed.reason).toBe('unrecognized transcript format (row types: mystery 2, other 1)');
    });
});

test('formatDuration uses M:SS below an hour and H:MM:SS above', () => {
    expect(formatDuration(33_000)).toBe('0:33');
    expect(formatDuration(104_000)).toBe('1:44');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
});

test('time answering an AskUserQuestion inside a segment is wait, not work (F9)', () => {
    const rows = [
        { type: 'user', timestamp: at(0), message: { role: 'user', content: 'plan it' } },
        {
            type: 'assistant',
            timestamp: at(10),
            message: { id: 'a1', content: [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion' }] },
        },
        {
            type: 'user',
            timestamp: at(130),
            message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'q1' }] },
        },
        { type: 'assistant', timestamp: at(150), message: { id: 'a2', content: [{ type: 'text' }] } },
    ].map((r) => JSON.stringify(r));
    expect(buildTimeline(rows).segments[0]).toMatchObject({ workMs: 30_000, waitMs: 120_000, toolCalls: 1 });
});

describe('token split (F10)', () => {
    test('formatTokens renders compact units', () => {
        expect(formatTokens(950)).toBe('950');
        expect(formatTokens(41_200)).toBe('41k');
        expect(formatTokens(28_430_000)).toBe('28.4M');
    });

    test('total includes cache read; non-cached excludes it', () => {
        const tokens = { input: 2_000, cacheCreate: 600_000, cacheRead: 28_000_000, output: 115_000 };
        expect(formatTokenSplit(tokens)).toBe('28.7M / 717k');
        expect(formatTokenSplit(null)).toBe('n/a');
    });

    test('session timeline spans carry the rendered split', () => {
        expect(buildTimeline(fixture()).segments[0]?.token).toBe('2k / 264');
    });
});
