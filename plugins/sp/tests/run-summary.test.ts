import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Row } from '../lib/transcript';
import {
    actorSplit,
    buildRunSummary,
    gateFromReceipt,
    main,
    renderRollupMarkdown,
    renderSummaryMarkdown,
    writeCloseSummary,
} from '../scripts/run-summary';

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

/**
 * 1146 R4/R5 — the actor split and the --rollup batch table. Failure modes, written before the code:
 *  F17 the actor rows must sum EXACTLY to the window (no leaked or double-counted ms);
 *  F18 a Bash call overlapping an Agent call is one span, attributed to subagent;
 *  F19 the operator total must carry the longest single wait, or a total reads as one stall;
 *  F20 a >=5-minute row gap is idle, not model time;
 *  F21 compactions and subagent errors are counted in BOTH host shapes;
 *  F22 gate time comes only from this run's receipt, else n/a with a reason — never 0;
 *  F23 --rollup sums per-run Totals and states the wall span when windows overlap.
 */
describe('1146 — actor split', () => {
    const A0 = Date.parse('2026-10-09T00:00:00.000Z');
    const ts = (s: number): string => new Date(A0 + s * 1000).toISOString();
    const pi = (s: number, id: string, role: string, content: unknown[], extra: Record<string, unknown> = {}) =>
        [
            JSON.parse(JSON.stringify({ type: 'message', id, timestamp: ts(s), message: { role, content, ...extra } })),
            A0 + s * 1000,
        ] as [Row, number];
    const claude = (s: number, type: string, content: unknown[], extra: Record<string, unknown> = {}) =>
        [JSON.parse(JSON.stringify({ type, timestamp: ts(s), message: { content, ...extra } })), A0 + s * 1000] as [
            Row,
            number,
        ];

    test('F17: the actor rows sum exactly to the window', () => {
        const rows: [Row, number][] = [
            claude(0, 'user', [{ type: 'text', text: 'go' }]),
            claude(10, 'assistant', [{ type: 'tool_use', id: 'c1', name: 'Bash' }]),
            claude(40, 'user', [{ type: 'tool_result', tool_use_id: 'c1' }]),
            claude(60, 'assistant', [{ type: 'text', text: 'done' }]),
        ];
        const a = actorSplit(rows, A0, A0 + 60_000);
        expect(a.shellMs).toBe(30_000);
        expect(a.modelMs).toBe(30_000);
        expect(a.operatorMs + a.subagentMs + a.shellMs + a.otherToolMs + a.idleMs + a.modelMs).toBe(60_000);
    });

    test('F18: an overlapping Bash and Agent call is counted once, under subagent', () => {
        const rows: [Row, number][] = [
            claude(0, 'user', [{ type: 'text', text: 'go' }]),
            claude(0, 'assistant', [{ type: 'tool_use', id: 's1', name: 'Bash' }]),
            claude(10, 'assistant', [{ type: 'tool_use', id: 'g1', name: 'Agent' }]),
            claude(30, 'user', [{ type: 'tool_result', tool_use_id: 's1' }]),
            claude(40, 'user', [{ type: 'tool_result', tool_use_id: 'g1' }]),
        ];
        const a = actorSplit(rows, A0, A0 + 40_000);
        expect(a.subagentMs).toBe(30_000); // 10..40 — the agent span, counted whole
        expect(a.shellMs).toBe(10_000); // 0..10 — only the part subagent did not claim
        expect(a.subagentMs + a.shellMs).toBe(40_000);
    });

    test('F19: the operator total carries the longest single wait', () => {
        const rows: [Row, number][] = [
            claude(0, 'assistant', [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion' }]),
            claude(10, 'user', [{ type: 'tool_result', tool_use_id: 'q1' }]),
            claude(20, 'assistant', [{ type: 'tool_use', id: 'q2', name: 'AskUserQuestion' }]),
            claude(50, 'user', [{ type: 'tool_result', tool_use_id: 'q2' }]),
        ];
        const a = actorSplit(rows, A0, A0 + 60_000);
        expect(a.operatorMs).toBe(40_000);
        expect(a.longestOperatorWaitMs).toBe(30_000);
    });

    test('F20: a six-minute row gap is idle, not model time', () => {
        const rows: [Row, number][] = [
            claude(0, 'assistant', [{ type: 'text', text: 'a' }]),
            claude(360, 'assistant', [{ type: 'text', text: 'b' }]),
        ];
        const a = actorSplit(rows, A0, A0 + 400_000);
        expect(a.idleMs).toBe(360_000);
    });

    test('F21: compactions and subagent errors are counted in both host shapes', () => {
        const claudeRows: [Row, number][] = [
            [JSON.parse(JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: ts(0) })), A0],
            claude(10, 'assistant', [{ type: 'tool_use', id: 'g1', name: 'Agent' }]),
            claude(20, 'user', [{ type: 'tool_result', tool_use_id: 'g1', is_error: true }]),
        ];
        const ca = actorSplit(claudeRows, A0, A0 + 30_000);
        expect(ca.compactions).toBe(1);
        expect(ca.subagentErrors).toBe(1);

        const piRows: [Row, number][] = [
            pi(0, 'k1', 'assistant', [], {}),
            [JSON.parse(JSON.stringify({ type: 'compaction', id: 'cp', timestamp: ts(1) })), A0 + 1000],
            pi(10, 'p1', 'assistant', [{ type: 'toolCall', id: 'g2', name: 'Agent' }]),
            pi(20, 'p2', 'toolResult', [], { toolCallId: 'g2', toolName: 'Agent', isError: true }),
        ];
        const pa = actorSplit(piRows, A0, A0 + 30_000);
        expect(pa.compactions).toBe(1);
        expect(pa.subagentErrors).toBe(1);
    });
});

describe('1146 — gate receipt and batch roll-up', () => {
    test('F22/AC4: gate time comes only from this run receipt, else n/a with a reason', () => {
        const dir = mkdtempSync(join(tmpdir(), 'run-summary-gate-'));
        try {
            mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
            expect(gateFromReceipt(dir, 'run_x')).toEqual({ ms: null, reason: 'no matching check receipt' });
            writeFileSync(
                join(dir, '.spur', 'run', 'run_x-check-receipt.json'),
                JSON.stringify({ runId: 'run_other', gateRuntimeMs: 1000 }),
            );
            expect(gateFromReceipt(dir, 'run_x')).toEqual({ ms: null, reason: 'check receipt belongs to another run' });
            writeFileSync(
                join(dir, '.spur', 'run', 'run_x-check-receipt.json'),
                JSON.stringify({ runId: 'run_x', gateRuntimeMs: 4200 }),
            );
            expect(gateFromReceipt(dir, 'run_x')).toEqual({ ms: 4200 });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('F23/AC5: --rollup sums per-run Totals and states the wall span when windows overlap', () => {
        const mk = (runId: string, startedAt: string, completedAt: string, workSec: number) => ({
            runId,
            startedAt,
            completedAt,
            total: {
                stage: 'Total',
                status: 'done',
                workMs: workSec * 1000,
                waitMs: 0,
                toolCalls: 1,
                tokens: { input: 1, cacheCreate: 0, cacheRead: 0, output: 1 },
                time: '0:00',
                wait: '0:00',
                token: '2 / 2',
            },
            actors: {
                operatorMs: 0,
                longestOperatorWaitMs: 0,
                modelMs: 0,
                shellMs: 0,
                subagentMs: 0,
                otherToolMs: 0,
                idleMs: 0,
                compactions: 0,
                subagentErrors: 0,
            },
        });
        const out = renderRollupMarkdown([
            { label: 'a', summary: mk('a', '2026-10-09T00:00:00Z', '2026-10-09T01:00:00Z', 60) },
            { label: 'b', summary: mk('b', '2026-10-09T00:30:00Z', '2026-10-09T02:00:00Z', 120) },
        ]);
        expect(out).toContain('| a |');
        expect(out).toContain('| b |');
        expect(out).toContain('**Batch total**');
        expect(out).toContain('Wall span: 2026-10-09T00:00:00.000Z');
    });
});

describe('1146 — writeCloseSummary (R1/AC1/AC2)', () => {
    const run = (startedAt: string | undefined) => ({
        runId: 'run_close',
        startedAt,
        completedAt: '2026-10-09T00:10:00.000Z',
        progress: {
            runId: 'run_close',
            workflow: 'wf',
            status: 'done',
            states: [
                {
                    state: 'implement',
                    visit: 1,
                    status: 'passed',
                    actions: [
                        {
                            attempts: [
                                { startedAt: '2026-10-09T00:00:10.000Z', completedAt: '2026-10-09T00:05:00.000Z' },
                            ],
                        },
                    ],
                },
            ],
        } as never,
    });

    test('AC1: a resolvable transcript writes the .md and the .json and returns the .md path', () => {
        const dir = mkdtempSync(join(tmpdir(), 'run-summary-close-'));
        try {
            const transcript = join(dir, 'session.jsonl');
            writeFileSync(
                transcript,
                `${JSON.stringify({ type: 'user', timestamp: '2026-10-09T00:00:00.000Z', message: { role: 'user', content: 'go' } })}\n`,
            );
            const rel = writeCloseSummary(run('2026-10-09T00:00:00.000Z'), {
                env: {},
                projectsRoot: dir,
                cwd: dir,
            });
            // No host session id and no --transcript here: the n/a path is the honest outcome.
            expect(readFileSync(join(dir, rel), 'utf8')).toContain('Execution summary: n/a');
            const okRel = writeCloseSummary(run('2026-10-09T00:00:00.000Z'), {
                env: { CLAUDE_CODE_SESSION_ID: 'x' },
                projectsRoot: dir,
                cwd: dir,
            } as never);
            expect(okRel).toBe(join('.spur', 'run', 'run_close-summary.md'));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('AC2: an unresolvable transcript leaves exactly the n/a line, never throws', () => {
        const dir = mkdtempSync(join(tmpdir(), 'run-summary-na-'));
        try {
            const rel = writeCloseSummary(run('2026-10-09T00:00:00.000Z'), { env: {}, projectsRoot: dir, cwd: dir });
            const body = readFileSync(join(dir, rel), 'utf8');
            expect(body).toMatch(/^Execution summary: n\/a \(.+\)\n$/);
            expect(existsSync(join(dir, '.spur', 'run', 'run_close-summary.json'))).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

/** 1146 R3/AC5 — the CLI surface of `--rollup`, plus the usage guards main() owns. */
describe('1146 — run-summary CLI', () => {
    const capture = (argv: string[]): { code: number; out: string; err: string } => {
        const out: string[] = [];
        const err: string[] = [];
        const o = process.stdout.write;
        const e = process.stderr.write;
        process.stdout.write = ((c: unknown) => {
            out.push(String(c));
            return true;
        }) as typeof process.stdout.write;
        process.stderr.write = ((c: unknown) => {
            err.push(String(c));
            return true;
        }) as typeof process.stderr.write;
        try {
            return { code: main(argv, {}, (s) => out.push(s), '/nope'), out: out.join(''), err: err.join('') };
        } finally {
            process.stdout.write = o;
            process.stderr.write = e;
        }
    };

    const summaryFile = (dir: string, runId: string, started: string, ended: string, workMs: number): string => {
        const path = join(dir, `${runId}-summary.json`);
        writeFileSync(
            path,
            JSON.stringify({
                runId,
                startedAt: started,
                completedAt: ended,
                total: {
                    stage: 'Total',
                    status: 'done',
                    workMs,
                    waitMs: 0,
                    toolCalls: 1,
                    tokens: { input: 1, cacheCreate: 0, cacheRead: 0, output: 1 },
                    time: '0:01',
                    wait: '0:00',
                    token: '2 / 2',
                },
                actors: {
                    operatorMs: 0,
                    longestOperatorWaitMs: 0,
                    modelMs: 0,
                    shellMs: 0,
                    subagentMs: 0,
                    otherToolMs: 0,
                    idleMs: 0,
                    compactions: 0,
                    subagentErrors: 0,
                },
            }),
        );
        return path;
    };

    test('--rollup renders one row per file plus the batch total', () => {
        const dir = mkdtempSync(join(tmpdir(), 'run-summary-cli-'));
        try {
            const a = summaryFile(dir, 'ra', '2026-10-09T00:00:00Z', '2026-10-09T00:10:00Z', 60_000);
            const b = summaryFile(dir, 'rb', '2026-10-09T00:20:00Z', '2026-10-09T00:30:00Z', 120_000);
            const r = capture(['--rollup', `a=${a}`, '--rollup', `b=${b}`, '--markdown']);
            expect(r.code).toBe(0);
            expect(r.out).toContain('| a |');
            expect(r.out).toContain('| b |');
            expect(r.out).toContain('**Batch total**');
            expect(r.out).not.toContain('Wall span'); // windows do not overlap

            // `write` omitted: the CLI's own default writer is the path a real invocation takes.
            const real = process.stdout.write;
            const direct: string[] = [];
            process.stdout.write = ((c: unknown) => {
                direct.push(String(c));
                return true;
            }) as typeof process.stdout.write;
            try {
                expect(main(['--rollup', `a=${a}`], {}, undefined, dir)).toBe(0);
            } finally {
                process.stdout.write = real;
            }
            expect(direct.join('')).toContain('**Batch total**');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('--rollup is refused with a measurement source, and an unreadable file fails loudly', () => {
        const dir = mkdtempSync(join(tmpdir(), 'run-summary-cli2-'));
        try {
            const a = summaryFile(dir, 'ra', '2026-10-09T00:00:00Z', '2026-10-09T00:10:00Z', 60_000);
            expect(capture(['--rollup', a, '--progress', a]).code).toBe(2);
            expect(capture(['--rollup', a, '--since', '2026-10-09T00:00:00Z']).code).toBe(2);
            expect(capture(['--rollup', a, '--transcript', a]).code).toBe(2);
            expect(capture(['--rollup']).code).toBe(2);
            expect(capture(['--rollup', join(dir, 'missing.json')]).code).toBe(2);
            expect(capture([]).code).toBe(2);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('--progress measures a transcript and attaches this run gate receipt', () => {
        const dir = mkdtempSync(join(tmpdir(), 'run-summary-cli3-'));
        try {
            mkdirSync(join(dir, '.spur', 'run'), { recursive: true });
            const transcript = join(dir, 'session.jsonl');
            writeFileSync(
                transcript,
                `${JSON.stringify({ type: 'user', timestamp: '2026-10-09T00:00:00.000Z', message: { role: 'user', content: 'go' } })}\n`,
            );
            const progress = join(dir, 'progress.json');
            writeFileSync(
                progress,
                JSON.stringify({
                    runId: 'run_cli',
                    workflow: 'wf',
                    status: 'done',
                    states: [
                        {
                            state: 'implement',
                            visit: 1,
                            status: 'passed',
                            actions: [
                                {
                                    attempts: [
                                        {
                                            startedAt: '2026-10-09T00:00:10.000Z',
                                            completedAt: '2026-10-09T00:05:00.000Z',
                                        },
                                    ],
                                },
                            ],
                        },
                    ],
                }),
            );
            writeFileSync(
                join(dir, '.spur', 'run', 'run_cli-check-receipt.json'),
                JSON.stringify({ runId: 'run_cli', gateRuntimeMs: 1500 }),
            );
            const r = capture(['--progress', progress, '--transcript', transcript, '--markdown']);
            expect(r.code).toBe(0);
            expect(r.out).toContain('| implement | passed | 4:50 |');
            expect(r.out).toContain('Actor');
            expect(r.out).toContain('idle / unattributed');
            // The receipt lives in the temp dir; the CLI reads this run's receipt from its cwd and
            // must say so rather than fabricate a 0 (F22 pins the match case directly).
            expect(r.out).toContain('of which gate (informational) | n/a (no matching check receipt)');
            expect(r.out).toContain('Compactions: 0 · Subagent errors: 0');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('1146 — run-summary failure surfaces', () => {
    test('a malformed --progress file exits 2 without throwing', () => {
        const dir = mkdtempSync(join(tmpdir(), 'run-summary-bad-'));
        try {
            const bad = join(dir, 'progress.json');
            writeFileSync(bad, '{not json');
            const transcript = join(dir, 'session.jsonl');
            writeFileSync(
                transcript,
                `${JSON.stringify({ type: 'user', timestamp: '2026-10-09T00:00:00.000Z', message: { role: 'user', content: 'go' } })}\n`,
            );
            const err: string[] = [];
            const e = process.stderr.write;
            process.stderr.write = ((c: unknown) => {
                err.push(String(c));
                return true;
            }) as typeof process.stderr.write;
            try {
                // `write` omitted on purpose: the default (process.stdout) is the real CLI's path.
                expect(main(['--progress', bad, '--transcript', transcript], {}, undefined, dir)).toBe(2);
            } finally {
                process.stderr.write = e;
            }
            expect(err.join('')).toContain('run-summary:');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
