/**
 * Run-summary measurement owner (task 1178 R2) — the pure actor/window/token aggregation moved out
 * of `plugins/sp/lib/run-summary-core.ts`.
 *
 * These cases observe the REAL aggregation over the normalized transcript rows the plugin adapter
 * hands over (`[Row, timestamp]`), with no host transcript, no filesystem and no plugin import. The
 * `plugins/sp/tests/run-summary.test.ts` suite keeps pinning the plugin adapter's rendering, n/a
 * reasons and close-callback behaviour over these same semantics.
 */
import { describe, expect, test } from 'bun:test';
import {
    actorSplit,
    buildRunSummary,
    promptText,
    type Row,
    skillInvocationPrompt,
} from '../../src/workflow/run-summary';

const T0 = Date.parse('2026-10-12T00:00:00.000Z');
const ts = (s: number): number => T0 + s * 1000;

const usage = (out: number) => ({
    input_tokens: 2,
    cache_creation_input_tokens: 100,
    cache_read_input_tokens: 1000,
    output_tokens: out,
});

/** Claude assistant row with `tool_use` blocks (normalized row + its epoch-ms timestamp). */
const asst = (s: number, id: string, out: number, tools: string[] = []): [Row, number] => [
    {
        type: 'assistant',
        timestamp: new Date(ts(s)).toISOString(),
        message: {
            id,
            content: tools.map((t) => ({ type: 'tool_use', id: t, name: t })),
            usage: usage(out),
        },
    },
    ts(s),
];

const user = (s: number, content: unknown): [Row, number] => [
    { type: 'user', timestamp: new Date(ts(s)).toISOString(), message: { role: 'user', content } },
    ts(s),
];

/** A tool_result row (Claude shape) closing the `tool_use_id` at `s`. */
const toolResult = (s: number, toolUseId: string): [Row, number] => [
    {
        type: 'user',
        timestamp: new Date(ts(s)).toISOString(),
        message: { content: [{ type: 'tool_result', tool_use_id: toolUseId }] },
    },
    ts(s),
];

const progress = (runId: string, states: [string, number, string, number, number][]) => ({
    runId,
    workflow: 'task-pipeline',
    status: 'done',
    states: states.map(([state, visit, status, a, b]) => ({
        state,
        visit,
        status,
        actions: [
            { attempts: [{ startedAt: new Date(ts(a)).toISOString(), completedAt: new Date(ts(b)).toISOString() }] },
        ],
    })),
});

const ROWS: [Row, number][] = [
    user(0, '/sp:dev-run 1178'),
    asst(5, 'd1', 1, ['x1']), // driver setup before the first stage → overhead
    asst(12, 'i1', 10, ['y1', 'y2']), // implement window 10..30
    asst(25, 'i2', 10, ['y3']),
    asst(70, 'v1', 5, ['z1']), // verify window 60..80
    asst(95, 'd2', 1), // driver close after the last stage → overhead
];

const INPUTS = [
    {
        progress: progress('r1', [
            ['implement', 1, 'passed', 10, 30],
            ['verify', 1, 'passed', 60, 80],
            ['record', 1, 'passed', 85, 86],
        ]),
    },
];

describe('buildRunSummary — normalized row aggregation', () => {
    const summary = buildRunSummary(ROWS, INPUTS, { since: new Date(T0).toISOString() });
    const row = (stage: string) => summary.rows.find((r) => r.stage === stage);

    test('one row per state visit, windowed by attempt timestamps', () => {
        expect(row('implement')).toMatchObject({ status: 'passed', workMs: 20_000, toolCalls: 3, time: '0:20' });
        expect(row('implement')?.tokens?.output).toBe(20);
        expect(row('verify')).toMatchObject({ workMs: 20_000, toolCalls: 1 });
    });

    test('a window without transcript records is n/a, not zero', () => {
        expect(row('record')).toMatchObject({ toolCalls: null, tokens: null, token: 'n/a' });
    });

    test('driver overhead makes stage rows sum exactly to the total', () => {
        expect(summary.total).toMatchObject({ workMs: 95_000, toolCalls: 5 });
        expect(row('driver overhead')).toMatchObject({ workMs: 54_000, toolCalls: 1 });
        expect(summary.rows.reduce((n, r) => n + r.workMs, 0)).toBe(summary.total.workMs);
    });

    test('total vs non-cached token semantics are preserved (cache read excluded from non-cached)', () => {
        // implement: 5 assistant messages × (2 in + 100 cacheCreate + 1000 cacheRead + out)
        expect(summary.total.token).toBe('6k / 537');
        expect(summary.total.tokens?.cacheRead).toBe(5000);
    });

    test('a progress file with no timed attempts fails loudly', () => {
        expect(() => buildRunSummary(ROWS, [{ progress: { runId: 'r', states: [] } }])).toThrow(/no timed/);
    });

    test('overlapping parallel runs never produce a negative overhead row', () => {
        const par = buildRunSummary(ROWS, [
            { label: 'a', progress: progress('r1', [['implement', 1, 'passed', 10, 80]]) },
            { label: 'b', progress: progress('r2', [['implement', 1, 'passed', 10, 80]]) },
        ]);
        expect(par.rows.find((r) => r.stage === 'driver overhead')).toBeUndefined();
    });

    test('an operator prompt row is excluded from every window it sits in', () => {
        const withPrompt = buildRunSummary([...ROWS, user(30, 'go')], INPUTS, { since: new Date(T0).toISOString() });
        expect(withPrompt.rows).toEqual(summary.rows);
        expect(withPrompt.total).toEqual(summary.total);
    });
});

describe('actorSplit — the window is partitioned exactly', () => {
    test('actor rows sum exactly to the window', () => {
        const rows: [Row, number][] = [
            user(0, 'go'),
            asst(10, 'c1', 0, ['Bash']),
            toolResult(40, 'Bash'),
            asst(60, 'c2', 0),
        ];
        const a = actorSplit(rows, ts(0), ts(60));
        expect(a.shellMs).toBe(30_000);
        expect(a.modelMs).toBe(30_000);
        expect(a.operatorMs + a.subagentMs + a.shellMs + a.otherToolMs + a.idleMs + a.modelMs).toBe(60_000);
    });

    test('an overlapping Bash and Agent call is counted once, under subagent', () => {
        const rows: [Row, number][] = [
            asst(0, 's1', 0, ['Bash']),
            asst(10, 'g1', 0, ['Agent']),
            toolResult(30, 'Bash'),
            toolResult(40, 'Agent'),
        ];
        const a = actorSplit(rows, ts(0), ts(40));
        expect(a.subagentMs).toBe(30_000); // 10..40 — the agent span, counted whole
        expect(a.shellMs).toBe(10_000); // 0..10 — only the part subagent did not claim
    });

    test('a six-minute row gap is idle, not model time', () => {
        const a = actorSplit([asst(0, 'a', 0), asst(360, 'b', 0)], ts(0), ts(400));
        expect(a.idleMs).toBe(360_000);
    });
});

describe('prompt classification', () => {
    test('a pi /skill wrapper renders /X <args>; plain text stays plain', () => {
        expect(skillInvocationPrompt('<skill name="sp-dev-runall">\nbody\n</skill>\n\n--tasks 1,2')).toBe(
            '/sp-dev-runall --tasks 1,2',
        );
        expect(promptText({ type: 'user', message: { role: 'user', content: 'hello' } })).toBe('hello');
        expect(
            promptText({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'x' }] } }),
        ).toBeUndefined();
    });
});

/**
 * Host-shape parity (1178 R2): the moved aggregation must classify both normalized host shapes the
 * plugin adapter hands over. These cases pin the branches the original plugin suite exercised
 * indirectly, so the app owner carries the same coverage it had before the move.
 */
describe('host-shape normalization', () => {
    test('pi `message` rows classify only a user-role text prompt', () => {
        expect(promptText({ type: 'message', message: { role: 'assistant', content: 'done' } })).toBeUndefined();
        expect(
            promptText({ type: 'message', message: { role: 'user', content: [{ type: 'thinking' }] } }),
        ).toBeUndefined();
        expect(promptText({ type: 'message', message: { role: 'user', content: 'typed' } })).toBe('typed');
        expect(
            promptText({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'block' }] } }),
        ).toBe('block');
        expect(promptText({ type: 'message', message: { role: 'user', content: 7 } })).toBeUndefined();
    });

    test('pi `custom_message` is a prompt only when the host displays it', () => {
        expect(promptText({ type: 'custom_message', display: false, content: 'hidden' })).toBeUndefined();
        expect(promptText({ type: 'custom_message', display: true, content: ' relayed ' })).toBe('relayed');
        expect(promptText({ type: 'custom_message', display: true, content: '   ' })).toBeUndefined();
    });

    test('a pi assistant→toolResult pair charges the operator wait, never model time', () => {
        const rows: [Row, number][] = [
            [
                {
                    type: 'message',
                    id: 'p1',
                    message: {
                        role: 'assistant',
                        content: [{ type: 'toolCall', id: 'q1', name: 'ask_user_question' }],
                        usage: { input: 3, cacheWrite: 4, cacheRead: 5, output: 6 },
                    },
                },
                ts(0),
            ],
            [{ type: 'message', message: { role: 'toolResult', toolCallId: 'q1' } }, ts(30)],
            asst(40, 'c1', 0),
        ];
        const a = actorSplit(rows, ts(0), ts(50));
        expect(a.operatorMs).toBe(30_000);
        expect(a.longestOperatorWaitMs).toBe(30_000);
        expect(a.operatorMs + a.subagentMs + a.shellMs + a.otherToolMs + a.idleMs + a.modelMs).toBe(50_000);
    });

    test('a Claude tool_result closes the operator wait its tool_use opened', () => {
        const rows: [Row, number][] = [
            asst(0, 'c1', 0, ['AskUserQuestion']),
            toolResult(20, 'AskUserQuestion'),
            asst(30, 'c2', 0),
        ];
        const a = actorSplit(rows, ts(0), ts(40));
        expect(a.operatorMs).toBe(20_000);
        expect(a.operatorMs + a.subagentMs + a.shellMs + a.otherToolMs + a.idleMs + a.modelMs).toBe(40_000);
    });

    test('a claim that sits outside a tool span subtracts nothing from it', () => {
        const rows: [Row, number][] = [
            asst(0, 's1', 0, ['Bash']),
            toolResult(10, 'Bash'),
            asst(20, 'g1', 0, ['Agent']),
            toolResult(30, 'Agent'),
            asst(40, 's2', 0, ['Bash']),
            toolResult(50, 'Bash'),
        ];
        const a = actorSplit(rows, ts(0), ts(50));
        expect(a.subagentMs).toBe(10_000);
        expect(a.shellMs).toBe(10_000);
        // The invariant the split exists for: whatever each category claims, they partition the window.
        expect(a.operatorMs + a.subagentMs + a.shellMs + a.otherToolMs + a.idleMs + a.modelMs).toBe(50_000);
    });
});
