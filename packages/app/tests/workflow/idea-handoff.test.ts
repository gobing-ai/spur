import { describe, expect, test } from 'bun:test';
import { createNodeFileSystem, type PipeProcess, type ProcessExecutor } from '@gobing-ai/ts-runtime';
import { finalizeIdeaHandoff } from '../../src/workflow/idea-handoff';

describe('finalizeIdeaHandoff', () => {
    const fs = createNodeFileSystem();

    test('returns error when required files are missing', async () => {
        const res = await finalizeIdeaHandoff({
            runId: 'missing-run',
            featureId: 'F1',
        });
        expect(res.ok).toBe(false);
        expect(res.error).toContain('missing');
    });

    test('validates batch vs result length and applies dependencies and writes report', async () => {
        const runId = 'test-idea-run-1';
        const featureId = 'D5';
        const runDir = '.spur/run';
        await fs.ensureDir(runDir);

        const batch = [{ name: 'Task A' }, { name: 'Task B' }];
        const result = { wbs: ['0601', '0602'] };
        const order = [{ name: 'Task A' }, { name: 'Task B', depends_on_names: ['Task A'] }];

        await fs.writeFile(`${runDir}/${runId}-idea-task-batch.json`, JSON.stringify(batch));
        await fs.writeFile(`${runDir}/${runId}-idea-batch-create-result.json`, JSON.stringify(result));
        await fs.writeFile(`${runDir}/${runId}-idea-task-order.json`, JSON.stringify(order));

        const executedCommands: Array<{ command: string; args?: string[] }> = [];
        const mockExecutor: ProcessExecutor = {
            run: async (opts) => {
                executedCommands.push({ command: opts.command, args: opts.args });
                return {
                    command: opts.command,
                    args: opts.args ?? [],
                    durationMs: 1,
                    exitCode: 0,
                    stdout: 'ok',
                    stderr: '',
                };
            },
            runStreaming: () => ({}) as unknown as PipeProcess,
        };

        const res = await finalizeIdeaHandoff({
            runId,
            featureId,
            processExecutor: mockExecutor,
        });

        expect(res.ok).toBe(true);
        expect(res.wbsList).toEqual(['0601', '0602']);
        expect(res.nextCommand).toContain('/sp:dev-runall --feature D5');

        expect(executedCommands.some((c) => c.args?.includes('deps') && c.args?.includes('0602'))).toBe(true);
        expect(executedCommands.some((c) => c.args?.includes('refresh'))).toBe(true);

        const report = await fs.readFile(res.reportPath);
        expect(report).toContain('Feature: D5');
        expect(report).toContain('0601');
        expect(report).toContain('0602');

        // Cleanup
        await fs.deleteFile(`${runDir}/${runId}-idea-task-batch.json`);
        await fs.deleteFile(`${runDir}/${runId}-idea-batch-create-result.json`);
        await fs.deleteFile(`${runDir}/${runId}-idea-task-order.json`);
        await fs.deleteFile(res.reportPath);
    });

    test('recommends refineall when any task check fails', async () => {
        const runId = 'test-idea-run-fail';
        const featureId = 'D5';
        const runDir = '.spur/run';
        await fs.ensureDir(runDir);

        const batch = [{ name: 'Task A' }];
        const result = { wbs: ['0601'] };
        const order = [{ name: 'Task A' }];

        await fs.writeFile(`${runDir}/${runId}-idea-task-batch.json`, JSON.stringify(batch));
        await fs.writeFile(`${runDir}/${runId}-idea-batch-create-result.json`, JSON.stringify(result));
        await fs.writeFile(`${runDir}/${runId}-idea-task-order.json`, JSON.stringify(order));

        const mockExecutor: ProcessExecutor = {
            run: async (opts) => {
                if (opts.args?.includes('check')) {
                    return {
                        command: opts.command,
                        args: opts.args ?? [],
                        durationMs: 1,
                        exitCode: 1,
                        stdout: '',
                        stderr: 'failed',
                    };
                }
                return {
                    command: opts.command,
                    args: opts.args ?? [],
                    durationMs: 1,
                    exitCode: 0,
                    stdout: 'ok',
                    stderr: '',
                };
            },
            runStreaming: () => ({}) as unknown as PipeProcess,
        };

        const res = await finalizeIdeaHandoff({
            runId,
            featureId,
            processExecutor: mockExecutor,
        });

        expect(res.ok).toBe(true);
        expect(res.nextCommand).toContain('/sp:dev-refineall --feature D5 --auto --depth ready');

        // Cleanup
        await fs.deleteFile(`${runDir}/${runId}-idea-task-batch.json`);
        await fs.deleteFile(`${runDir}/${runId}-idea-batch-create-result.json`);
        await fs.deleteFile(`${runDir}/${runId}-idea-task-order.json`);
        await fs.deleteFile(res.reportPath);
    });

    test('handles batch mismatch and duplicate names gracefully', async () => {
        const runId = 'test-idea-run-err';
        const featureId = 'D5';
        const runDir = '.spur/run';
        await fs.ensureDir(runDir);

        const batch = [{ name: 'Task A' }, { name: 'Task A' }];
        const result = { wbs: ['0601', '0602'] };
        const order = [{ name: 'Task A' }];

        await fs.writeFile(`${runDir}/${runId}-idea-task-batch.json`, JSON.stringify(batch));
        await fs.writeFile(`${runDir}/${runId}-idea-batch-create-result.json`, JSON.stringify(result));
        await fs.writeFile(`${runDir}/${runId}-idea-task-order.json`, JSON.stringify(order));

        const res = await finalizeIdeaHandoff({ runId, featureId });
        expect(res.ok).toBe(false);
        expect(res.error).toContain('Duplicate task names');

        // Cleanup
        await fs.deleteFile(`${runDir}/${runId}-idea-task-batch.json`);
        await fs.deleteFile(`${runDir}/${runId}-idea-batch-create-result.json`);
        await fs.deleteFile(`${runDir}/${runId}-idea-task-order.json`);
    });

    test('handles malformed JSON structure', async () => {
        const runId = 'test-idea-run-malformed';
        const featureId = 'D5';
        const runDir = '.spur/run';
        await fs.ensureDir(runDir);

        await fs.writeFile(`${runDir}/${runId}-idea-task-batch.json`, '{"not":"array"}');
        await fs.writeFile(`${runDir}/${runId}-idea-batch-create-result.json`, '{"wbs":123}');
        await fs.writeFile(`${runDir}/${runId}-idea-task-order.json`, '[]');

        const res = await finalizeIdeaHandoff({ runId, featureId });
        expect(res.ok).toBe(false);
        expect(res.error).toContain('Malformed');

        await fs.deleteFile(`${runDir}/${runId}-idea-task-batch.json`);
        await fs.deleteFile(`${runDir}/${runId}-idea-batch-create-result.json`);
        await fs.deleteFile(`${runDir}/${runId}-idea-task-order.json`);
    });

    test('handles size mismatch between batch and created wbs', async () => {
        const runId = 'test-idea-run-size-mismatch';
        const featureId = 'D5';
        const runDir = '.spur/run';
        await fs.ensureDir(runDir);

        await fs.writeFile(`${runDir}/${runId}-idea-task-batch.json`, JSON.stringify([{ name: 'Task A' }]));
        await fs.writeFile(
            `${runDir}/${runId}-idea-batch-create-result.json`,
            JSON.stringify({ wbs: ['0601', '0602'] }),
        );
        await fs.writeFile(`${runDir}/${runId}-idea-task-order.json`, JSON.stringify([{ name: 'Task A' }]));

        const res = await finalizeIdeaHandoff({ runId, featureId });
        expect(res.ok).toBe(false);
        expect(res.error).toContain('Batch size mismatch');

        await fs.deleteFile(`${runDir}/${runId}-idea-task-batch.json`);
        await fs.deleteFile(`${runDir}/${runId}-idea-batch-create-result.json`);
        await fs.deleteFile(`${runDir}/${runId}-idea-task-order.json`);
    });

    test('handles unmapped order task name and dependency name', async () => {
        const runId = 'test-idea-run-unmapped';
        const featureId = 'D5';
        const runDir = '.spur/run';
        await fs.ensureDir(runDir);

        await fs.writeFile(`${runDir}/${runId}-idea-task-batch.json`, JSON.stringify([{ name: 'Task A' }]));
        await fs.writeFile(`${runDir}/${runId}-idea-batch-create-result.json`, JSON.stringify({ wbs: ['0601'] }));
        await fs.writeFile(`${runDir}/${runId}-idea-task-order.json`, JSON.stringify([{ name: 'Unmapped' }]));

        const res1 = await finalizeIdeaHandoff({ runId, featureId });
        expect(res1.ok).toBe(false);
        expect(res1.error).toContain('could not be mapped');

        await fs.writeFile(
            `${runDir}/${runId}-idea-task-order.json`,
            JSON.stringify([{ name: 'Task A', depends_on_names: ['UnmappedDep'] }]),
        );
        const res2 = await finalizeIdeaHandoff({ runId, featureId });
        expect(res2.ok).toBe(false);
        expect(res2.error).toContain('Dependency task name');

        await fs.deleteFile(`${runDir}/${runId}-idea-task-batch.json`);
        await fs.deleteFile(`${runDir}/${runId}-idea-batch-create-result.json`);
        await fs.deleteFile(`${runDir}/${runId}-idea-task-order.json`);
    });

    test('handles task deps command failure', async () => {
        const runId = 'test-idea-run-deps-fail';
        const featureId = 'D5';
        const runDir = '.spur/run';
        await fs.ensureDir(runDir);

        const batch = [{ name: 'Task A' }, { name: 'Task B' }];
        const result = { wbs: ['0601', '0602'] };
        const order = [{ name: 'Task A' }, { name: 'Task B', depends_on_names: ['Task A'] }];

        await fs.writeFile(`${runDir}/${runId}-idea-task-batch.json`, JSON.stringify(batch));
        await fs.writeFile(`${runDir}/${runId}-idea-batch-create-result.json`, JSON.stringify(result));
        await fs.writeFile(`${runDir}/${runId}-idea-task-order.json`, JSON.stringify(order));

        const mockExecutor: ProcessExecutor = {
            run: async (opts) => {
                if (opts.args?.includes('deps')) {
                    return {
                        command: opts.command,
                        args: opts.args ?? [],
                        durationMs: 1,
                        exitCode: 1,
                        stdout: '',
                        stderr: 'locked',
                    };
                }
                return {
                    command: opts.command,
                    args: opts.args ?? [],
                    durationMs: 1,
                    exitCode: 0,
                    stdout: 'ok',
                    stderr: '',
                };
            },
            runStreaming: () => ({}) as unknown as PipeProcess,
        };

        const res = await finalizeIdeaHandoff({
            runId,
            featureId,
            processExecutor: mockExecutor,
        });
        expect(res.ok).toBe(false);
        expect(res.error).toContain('Failed to set dependencies');

        await fs.deleteFile(`${runDir}/${runId}-idea-task-batch.json`);
        await fs.deleteFile(`${runDir}/${runId}-idea-batch-create-result.json`);
        await fs.deleteFile(`${runDir}/${runId}-idea-task-order.json`);
    });
});
