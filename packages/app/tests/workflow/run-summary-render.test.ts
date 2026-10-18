import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRunSummary } from '../../src/workflow/run-summary';
import { type CloseSummaryRun, renderSummaryMarkdown, writeCloseSummary } from '../../src/workflow/run-summary-render';
import { parseTranscriptRows } from '../../src/workflow/transcript';

/**
 * 1146 R1/AC1/AC2: the close-step execution summary the engine's terminal `spur workflow continue` writes, plus the
 * transcript adapter it reads (1138 R1). Ported from `plugins/sp/tests/run-summary.test.ts` when the
 * close callback moved into the app (script-absorption PR-4). The transcript adapter has its own
 * suite (`transcript.test.ts`).
 */

const user = (ts: string) => ({ type: 'user', timestamp: ts, message: { role: 'user', content: 'go' } });
const assistant = (ts: string) => ({
    type: 'assistant',
    timestamp: ts,
    message: {
        id: 'm1',
        content: [{ type: 'tool_use', id: 't1', name: 'Bash' }],
        usage: { input_tokens: 10, cache_creation_input_tokens: 1, cache_read_input_tokens: 2, output_tokens: 5 },
    },
});
const jsonl = (...rows: unknown[]): string => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;

const run = (startedAt: string | undefined, states = true): CloseSummaryRun => ({
    runId: 'run_close',
    startedAt,
    completedAt: '2026-10-09T00:10:00.000Z',
    progress: {
        runId: 'run_close',
        workflow: 'wf',
        status: 'done',
        states: states
            ? [
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
              ]
            : [],
    } as never,
});

function withDir(prefix: string, body: (dir: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    try {
        body(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

describe('1146 — writeCloseSummary (R1/AC1/AC2)', () => {
    test('AC1: a resolved host transcript writes the measured table and its .json sibling', () => {
        withDir('close-summary-ok-', (dir) => {
            const transcript = join(dir, 'session.jsonl');
            writeFileSync(transcript, jsonl(user('2026-10-09T00:00:00.000Z'), assistant('2026-10-09T00:02:00.000Z')));
            const rel = writeCloseSummary(run('2026-10-09T00:00:00.000Z'), {
                env: { PI_SESSION_FILE: transcript },
                projectsRoot: dir,
                cwd: dir,
            });
            expect(rel).toBe(join('.spur', 'run', 'run_close-summary.md'));
            const body = readFileSync(join(dir, rel), 'utf8');
            expect(body).not.toContain('Execution summary: n/a');
            expect(body).toContain('| implement |');
            expect(body).toContain('| Actor | Time | Share |');
            const json = JSON.parse(readFileSync(join(dir, '.spur', 'run', 'run_close-summary.json'), 'utf8'));
            expect([json.runId, json.available, json.completedAt]).toEqual([
                'run_close',
                true,
                '2026-10-09T00:10:00.000Z',
            ]);
        });
    });

    test('AC1: a Claude session id resolves under the projects root', () => {
        withDir('close-summary-claude-', (dir) => {
            mkdirSync(join(dir, 'projects', 'p'), { recursive: true });
            writeFileSync(
                join(dir, 'projects', 'p', 'sess1.jsonl'),
                jsonl(user('2026-10-09T00:00:00.000Z'), assistant('2026-10-09T00:02:00.000Z')),
            );
            const rel = writeCloseSummary(run('2026-10-09T00:00:00.000Z'), {
                env: { CLAUDE_CODE_SESSION_ID: 'sess1' },
                projectsRoot: join(dir, 'projects'),
                cwd: dir,
            });
            expect(readFileSync(join(dir, rel), 'utf8')).toContain('| implement |');
        });
    });

    test('AC2: each unresolvable input leaves exactly one n/a line, never throws', () => {
        withDir('close-summary-na-', (dir) => {
            const read = (rel: string): string => readFileSync(join(dir, rel), 'utf8');
            const opts = { env: {}, projectsRoot: dir, cwd: dir };
            expect(read(writeCloseSummary(run(undefined), opts))).toBe(
                'Execution summary: n/a (run row has no started_at)\n',
            );
            expect(read(writeCloseSummary(run('2026-10-09T00:00:00.000Z'), opts))).toMatch(
                /^Execution summary: n\/a \(no host session id; .+\)\n$/,
            );
            expect(existsSync(join(dir, '.spur', 'run', 'run_close-summary.json'))).toBe(false);

            const transcript = join(dir, 'session.jsonl');
            writeFileSync(transcript, jsonl(user('2026-10-09T00:00:00.000Z')));
            const env = { PI_SESSION_FILE: transcript };
            // A run with no timed attempts is refused by the measurement, never rendered as an empty table.
            expect(read(writeCloseSummary(run('2026-10-09T00:00:00.000Z', false), { ...opts, env }))).toMatch(
                /^Execution summary: n\/a \(.+\)\n$/,
            );
            // A transcript that vanishes between resolution and read is reported, not thrown.
            const broken = { ...run('2026-10-09T00:00:00.000Z'), progress: null as never };
            expect(read(writeCloseSummary(broken, { ...opts, env }))).toMatch(/^Execution summary: n\/a \(.+\)\n$/);
        });
    });

    test('the default env and cwd are the live process', () => {
        withDir('close-summary-cwd-', (dir) => {
            const previous = process.cwd();
            process.chdir(dir);
            try {
                const rel = writeCloseSummary(run(undefined));
                expect(existsSync(join(dir, rel))).toBe(true);
            } finally {
                process.chdir(previous);
            }
        });
    });
});

describe('renderSummaryMarkdown', () => {
    test('renders the stage table with a bold Total row and the actor split', () => {
        const { rows, skippedLines } = parseTranscriptRows(
            jsonl(user('2026-10-09T00:00:00.000Z'), assistant('2026-10-09T00:02:00.000Z')).split('\n'),
        );
        const summary = buildRunSummary(rows, [{ progress: run('x').progress as never }], {
            since: '2026-10-09T00:00:00.000Z',
            until: '2026-10-09T00:10:00.000Z',
            skippedLines,
        });
        const md = renderSummaryMarkdown(summary);
        expect(md).toContain('| Stage | Status | Time | Wait | Tool calls | Token (total / non-cached) |');
        expect(md).toMatch(/\| \*\*Total\*\* \|/);
        expect(md).toContain('|   of which gate (informational) | n/a (');
        expect(md).toContain('Compactions: 0 · Subagent errors: 0');
        const empty = renderSummaryMarkdown({
            ...summary,
            total: { ...summary.total, workMs: 0, waitMs: 0 },
            gate: { ms: 1000, reason: undefined } as never,
        });
        expect(empty).toContain('| model | 2:00 | n/a |');
        expect(empty).toContain('|   of which gate (informational) | 0:01 | — |');
    });
});
