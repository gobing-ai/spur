import { describe, expect, test } from 'bun:test';
import { createNodeFileSystem, type PipeProcess, type ProcessExecutor } from '@gobing-ai/ts-runtime';
import { appendWrapupMetrics, parseWrapupTaskWbs } from '../../src/workflow/wrapup-metrics';

describe('parseWrapupTaskWbs', () => {
    test('parses a JSON array', () => {
        expect(parseWrapupTaskWbs('["0603","0604"]')).toEqual(['0603', '0604']);
    });

    test('parses a JSON-encoded array string', () => {
        expect(parseWrapupTaskWbs(JSON.stringify('["0603","0604"]'))).toEqual(['0603', '0604']);
    });

    test('does not treat JSON array punctuation as WBS tokens', () => {
        expect(parseWrapupTaskWbs('["0603"]').some((wbs) => wbs.includes('[') || wbs.includes(']'))).toBe(false);
    });

    test('returns empty for empty array or blank input', () => {
        expect(parseWrapupTaskWbs('[]')).toEqual([]);
        expect(parseWrapupTaskWbs('')).toEqual([]);
        expect(parseWrapupTaskWbs('   ')).toEqual([]);
    });

    test('splits a comma list when JSON parse fails', () => {
        expect(parseWrapupTaskWbs('0603, 0604')).toEqual(['0603', '0604']);
    });

    test('splits an inner encoded string that is not JSON', () => {
        expect(parseWrapupTaskWbs(JSON.stringify('0603 0604'))).toEqual(['0603', '0604']);
    });

    test('returns empty for a JSON object', () => {
        expect(parseWrapupTaskWbs('{"wbs":"0603"}')).toEqual([]);
    });

    test('drops blanks and duplicate WBS tokens', () => {
        expect(parseWrapupTaskWbs('0603,,0603, 0604')).toEqual(['0603', '0604']);
    });
});

describe('appendWrapupMetrics', () => {
    test('writes one JSONL row per WBS from task show and verdict files', async () => {
        const fs = createNodeFileSystem();
        const root = `${process.cwd()}/.spur/tmp/wrapup-metrics-test`;
        await fs.ensureDir(`${root}/.spur/run`);
        await fs.ensureDir(`${root}/.spur/memory`);
        const metricsPath = `${root}/.spur/memory/wrapup-metrics.jsonl`;
        if (await fs.exists(metricsPath)) await fs.deleteFile(metricsPath);
        await fs.writeFile(`${root}/.spur/run/0603-verdict.json`, JSON.stringify({ wbs: '0603', verdict: 'PASS' }));

        const mockExecutor: ProcessExecutor = {
            run: async (opts) => {
                return {
                    command: opts.command,
                    args: opts.args ?? [],
                    durationMs: 1,
                    exitCode: 0,
                    stdout: JSON.stringify({
                        frontmatter: { feature_id: 'D5', status: 'done' },
                        feature_id: 'D5',
                        status: 'done',
                    }),
                    stderr: '',
                };
            },
            runStreaming: () => ({}) as unknown as PipeProcess,
        };

        const result = await appendWrapupMetrics({
            projectRoot: root,
            tasksRaw: '["0603"]',
            spurBin: 'spur',
            fileSystem: fs,
            processExecutor: mockExecutor,
            now: () => '2026-08-19T21:30:00.000Z',
        });

        expect(result.ok).toBe(true);
        expect(result.written).toEqual(['0603']);
        const body = await fs.readFile(result.path);
        expect(JSON.parse(body.trim())).toEqual({
            wbs: '0603',
            feature_id: 'D5',
            status: 'done',
            verdict: 'PASS',
            timestamp: '2026-08-19T21:30:00.000Z',
        });
    });

    test('skips a WBS when task show returns non-JSON and treats a broken verdict file as UNKNOWN', async () => {
        const fs = createNodeFileSystem();
        const root = `${process.cwd()}/.spur/tmp/wrapup-metrics-skip`;
        await fs.ensureDir(`${root}/.spur/run`);
        await fs.ensureDir(`${root}/.spur/memory`);
        const metricsPath = `${root}/.spur/memory/wrapup-metrics.jsonl`;
        if (await fs.exists(metricsPath)) await fs.deleteFile(metricsPath);
        await fs.writeFile(`${root}/.spur/run/0604-verdict.json`, 'not-json');

        let calls = 0;
        const mockExecutor: ProcessExecutor = {
            run: async (opts) => {
                calls += 1;
                return {
                    command: opts.command,
                    args: opts.args ?? [],
                    durationMs: 1,
                    exitCode: 0,
                    stdout:
                        calls === 1
                            ? 'not-json'
                            : JSON.stringify({ frontmatter: { feature_id: 'D5', status: 'done' } }),
                    stderr: '',
                };
            },
            runStreaming: () => ({}) as unknown as PipeProcess,
        };

        const result = await appendWrapupMetrics({
            projectRoot: root,
            tasksRaw: '["0603","0604"]',
            fileSystem: fs,
            processExecutor: mockExecutor,
            now: () => '2026-08-19T21:31:00.000Z',
        });

        expect(result.written).toEqual(['0604']);
        expect(JSON.parse((await fs.readFile(result.path)).trim()).verdict).toBe('UNKNOWN');
    });

    test('uses the default clock when now is omitted', async () => {
        const fs = createNodeFileSystem();
        const root = `${process.cwd()}/.spur/tmp/wrapup-metrics-clock`;
        await fs.ensureDir(`${root}/.spur/memory`);
        const metricsPath = `${root}/.spur/memory/wrapup-metrics.jsonl`;
        if (await fs.exists(metricsPath)) await fs.deleteFile(metricsPath);

        const mockExecutor: ProcessExecutor = {
            run: async (opts) => ({
                command: opts.command,
                args: opts.args ?? [],
                durationMs: 1,
                exitCode: 0,
                stdout: JSON.stringify({ frontmatter: { feature_id: 'D5', status: 'done' } }),
                stderr: '',
            }),
            runStreaming: () => ({}) as unknown as PipeProcess,
        };

        const result = await appendWrapupMetrics({
            projectRoot: root,
            tasksRaw: '["0603"]',
            fileSystem: fs,
            processExecutor: mockExecutor,
        });
        expect(result.written).toEqual(['0603']);
        expect(JSON.parse((await fs.readFile(result.path)).trim()).timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
});
