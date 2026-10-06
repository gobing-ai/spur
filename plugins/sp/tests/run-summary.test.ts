import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRunSummary, main, renderSummaryMarkdown } from '../scripts/run-summary';

/**
 * run-summary prints the dev-run / dev-runall execution summary. Failure modes, written before the
 * code (F10, the total vs non-cached token split, lives in session-timeline.test.ts):
 *  F11 a stage window must span its first attempt start → last attempt completion, and transcript
 *      records outside every window must not leak into a stage row;
 *  F12 a subprocess stage leaves no host transcript records → tool calls/tokens must read n/a,
 *      never a fabricated 0;
 *  F13 rows must sum to the run total: host work outside any stage window is an explicit
 *      driver-overhead row, not silently dropped;
 *  F14 dev-runall passes several progress files → one row per run, labelled by the caller;
 *  F15 a progress file with no timed attempts must fail loudly, not print an empty table;
 *  F16 parallel runs overlap → no negative driver-overhead row.
 */
const T0 = Date.parse('2026-10-04T03:00:00.000Z');
const at = (s: number): string => new Date(T0 + s * 1000).toISOString();
const usage = (out: number) => ({
    input_tokens: 2,
    cache_creation_input_tokens: 100,
    cache_read_input_tokens: 1000,
    output_tokens: out,
});

const progress = (runId: string, states: [string, number, string, number, number][]) => ({
    runId,
    workflow: 'task-pipeline',
    status: 'done',
    states: states.map(([state, visit, status, a, b]) => ({
        state,
        visit,
        status,
        actions: [{ attempts: [{ startedAt: at(a), completedAt: at(b) }] }],
    })),
});

function runFixture(): string[] {
    const asst = (s: number, id: string, out: number, tools: string[] = []) => ({
        type: 'assistant',
        timestamp: at(s),
        message: { id, content: tools.map((t) => ({ type: 'tool_use', id: t })), usage: usage(out) },
    });
    return [
        { type: 'user', timestamp: at(0), message: { role: 'user', content: '/sp:dev-run 1' } },
        asst(5, 'd1', 1, ['x1']), // driver setup before the first stage → overhead (F13)
        asst(12, 'i1', 10, ['y1', 'y2']), // implement window 10..30
        asst(25, 'i2', 10, ['y3']),
        asst(70, 'v1', 5, ['z1']), // verify window 60..80
        asst(95, 'd2', 1), // driver close after the last stage → overhead (F13)
    ].map((r) => JSON.stringify(r));
}

describe('buildRunSummary', () => {
    const summary = buildRunSummary(
        runFixture(),
        [
            {
                progress: progress('r1', [
                    ['implement', 1, 'passed', 10, 30],
                    ['verify', 1, 'passed', 60, 80],
                    ['record', 1, 'passed', 85, 86],
                ]),
            },
        ],
        at(0),
    );
    const row = (stage: string) => summary.rows.find((r) => r.stage === stage);

    test('one row per state visit, windowed by attempt timestamps (F11)', () => {
        expect(row('implement')).toMatchObject({ status: 'passed', workMs: 20_000, toolCalls: 3, time: '0:20' });
        expect(row('implement')?.tokens?.output).toBe(20);
        expect(row('verify')).toMatchObject({ workMs: 20_000, toolCalls: 1 });
    });

    test('a window without transcript records is n/a, not 0 (F12)', () => {
        expect(row('record')).toMatchObject({ toolCalls: null, tokens: null, token: 'n/a' });
    });

    test('driver overhead makes rows sum to the total (F13)', () => {
        expect(summary.total).toMatchObject({ workMs: 95_000, toolCalls: 5 });
        expect(row('driver overhead')).toMatchObject({ workMs: 54_000, toolCalls: 1 });
        const sum = summary.rows.reduce((n, r) => n + r.workMs, 0);
        expect(sum).toBe(summary.total.workMs);
    });

    test('several progress files give one labelled row per run (F14)', () => {
        const multi = buildRunSummary(runFixture(), [
            { label: '1074', progress: progress('r1', [['implement', 1, 'passed', 10, 30]]) },
            { label: '1075', progress: progress('r2', [['verify', 1, 'failed', 60, 80]]) },
        ]);
        expect(multi.rows.map((r) => [r.stage, r.status])).toEqual([
            ['1074', 'done'],
            ['1075', 'done'],
            ['driver overhead', ''],
        ]);
    });

    test('a progress file without timed attempts fails loudly (F15)', () => {
        expect(() => buildRunSummary(runFixture(), [{ progress: { runId: 'r', states: [] } }])).toThrow(/no timed/);
    });

    test('overlapping parallel runs never produce a negative overhead (F16)', () => {
        const par = buildRunSummary(runFixture(), [
            { label: 'a', progress: progress('r1', [['implement', 1, 'passed', 10, 80]]) },
            { label: 'b', progress: progress('r2', [['implement', 1, 'passed', 10, 80]]) },
        ]);
        expect(par.rows.find((r) => r.stage === 'driver overhead')).toBeUndefined();
    });

    test('markdown renders the table with a Total row', () => {
        const md = renderSummaryMarkdown(summary);
        expect(md).toContain('| Stage | Status | Time | Wait | Tool calls | Token (total / non-cached) |');
        expect(md).toContain('| record | passed | 0:01 | 0:00 | n/a | n/a |');
        expect(md).toMatch(/\| \*\*Total\*\* \| done \| 1:35 \|/);
    });

    test('main --progress --markdown prints the table; unavailable transcript says n/a', () => {
        const dir = mkdtempSync(join(tmpdir(), 'session-summary-'));
        const transcript = join(dir, 't.jsonl');
        const file = join(dir, 'p.json');
        writeFileSync(transcript, runFixture().join('\n'));
        writeFileSync(file, JSON.stringify(progress('r1', [['implement', 1, 'passed', 10, 30]])));
        const out: string[] = [];
        expect(main(['--transcript', transcript, '--progress', file, '--markdown'], {}, (s) => out.push(s))).toBe(0);
        expect(out.join('')).toContain('| implement | passed | 0:20 |');
        const none: string[] = [];
        expect(main(['--progress', file, '--markdown'], {}, (s) => none.push(s), '/nope')).toBe(0);
        expect(none.join('')).toMatch(/^Execution summary: n\/a/);
    });
});
