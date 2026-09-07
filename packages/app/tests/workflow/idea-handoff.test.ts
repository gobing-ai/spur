import { describe, expect, test } from 'bun:test';
import { createNodeFileSystem, type PipeProcess, type ProcessExecutor } from '@gobing-ai/ts-runtime';
import { computePlanningDigest } from '../../src/services/task-readiness';
import { finalizeIdeaHandoff } from '../../src/workflow/idea-handoff';

describe('finalizeIdeaHandoff', () => {
    const fs = createNodeFileSystem();

    const READY_IDS = ['requirements', 'design', 'plan', 'ac', 'decisions', 'dependencies', 'premises'] as const;

    /** Write task docs + a ready-evidence sidecar for `runId`; returns wbs→filePath. */
    async function writeReadyFixture(
        runId: string,
        wbss: string[],
        opts?: { status?: string; digestOverride?: (body: string) => string; omitSidecar?: boolean },
    ): Promise<Record<string, string>> {
        const runDir = '.spur/run';
        const paths: Record<string, string> = {};
        const tasks = [];
        for (const wbs of wbss) {
            const body = `---\nstatus: todo\nwbs: ${wbs}\n---\n\n## Background\n\nPrepared background.\n\n## Acceptance Criteria\n\n- [ ] Scenario one.\n`;
            const p = `${runDir}/${runId}-${wbs}.md`;
            await fs.writeFile(p, body);
            paths[wbs] = p;
            tasks.push({
                wbs,
                status: opts?.status ?? 'ready',
                planningDigest: opts?.digestOverride ? opts.digestOverride(body) : computePlanningDigest(body),
                checks: READY_IDS.map((id) => ({ id, pass: true, evidence: `${id} verified` })),
            });
        }
        if (opts?.omitSidecar !== true) {
            await fs.writeFile(`${runDir}/${runId}-idea-ready.json`, JSON.stringify({ runId, depth: 'ready', tasks }));
        }
        return paths;
    }

    function evidenceAwareExecutor(paths: Record<string, string>, checkExitCode = 0): ProcessExecutor {
        return {
            run: async (opts) => {
                const args = opts.args ?? [];
                if (args.includes('path')) {
                    const wbs = args[args.indexOf('path') + 1] ?? '';
                    return {
                        command: opts.command,
                        args,
                        durationMs: 1,
                        exitCode: 0,
                        stdout: JSON.stringify({ wbs, filePath: paths[wbs] }),
                        stderr: '',
                    };
                }
                if (args.includes('check')) {
                    return {
                        command: opts.command,
                        args,
                        durationMs: 1,
                        exitCode: checkExitCode,
                        stdout: '',
                        stderr: checkExitCode === 0 ? '' : 'failed',
                    };
                }
                return { command: opts.command, args, durationMs: 1, exitCode: 0, stdout: 'ok', stderr: '' };
            },
            runStreaming: () => ({}) as unknown as PipeProcess,
        };
    }

    async function cleanupRun(runId: string, _wbss: string[], extra: string[]): Promise<void> {
        const runDir = '.spur/run';
        for (const f of [...extra, `${runDir}/${runId}-idea-ready.json`]) {
            await Promise.resolve(fs.deleteFile(f)).catch(() => {});
        }
    }

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
        const paths = await writeReadyFixture(runId, result.wbs);

        const executedCommands: Array<{ command: string; args?: string[] }> = [];
        const base = evidenceAwareExecutor(paths);
        const mockExecutor: ProcessExecutor = {
            run: async (opts) => {
                executedCommands.push({ command: opts.command, args: opts.args });
                return base.run(opts);
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
        // Exit 0 alone is not readiness: each task was resolved to its file for
        // digest + evidence verification before the deterministic check.
        expect(executedCommands.filter((c) => c.args?.includes('path')).length).toBe(2);

        const report = await fs.readFile(res.reportPath);
        expect(report).toContain('Feature: D5');
        expect(report).toContain('0601');
        expect(report).toContain('0602');

        await cleanupRun(runId, result.wbs, [
            `${runDir}/${runId}-idea-task-batch.json`,
            `${runDir}/${runId}-idea-batch-create-result.json`,
            `${runDir}/${runId}-idea-task-order.json`,
            res.reportPath,
        ]);
    });

    test('recommends refineall when a deterministic task check fails despite good evidence', async () => {
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
        const paths = await writeReadyFixture(runId, result.wbs);

        const res = await finalizeIdeaHandoff({
            runId,
            featureId,
            processExecutor: evidenceAwareExecutor(paths, 1),
        });

        expect(res.ok).toBe(true);
        expect(res.nextCommand).toContain('/sp:dev-refineall --feature D5 --auto --depth ready');
        const report = await fs.readFile(res.reportPath);
        expect(report).toContain('UNREADY');
        expect(report).toContain('/sp:dev-refine 0601 --auto --depth ready');

        await cleanupRun(runId, result.wbs, [
            `${runDir}/${runId}-idea-task-batch.json`,
            `${runDir}/${runId}-idea-batch-create-result.json`,
            `${runDir}/${runId}-idea-task-order.json`,
            res.reportPath,
        ]);
    });

    test('stale planning digest degrades to a precise refine action even when check passes', async () => {
        const runId = 'test-idea-run-stale';
        const featureId = 'D5';
        const runDir = '.spur/run';
        await fs.ensureDir(runDir);

        const batch = [{ name: 'Task A' }];
        const result = { wbs: ['0601'] };
        const order = [{ name: 'Task A' }];

        await fs.writeFile(`${runDir}/${runId}-idea-task-batch.json`, JSON.stringify(batch));
        await fs.writeFile(`${runDir}/${runId}-idea-batch-create-result.json`, JSON.stringify(result));
        await fs.writeFile(`${runDir}/${runId}-idea-task-order.json`, JSON.stringify(order));
        const paths = await writeReadyFixture(runId, result.wbs, {
            digestOverride: () => 'deadbeef'.repeat(8),
        });

        const res = await finalizeIdeaHandoff({
            runId,
            featureId,
            processExecutor: evidenceAwareExecutor(paths),
        });

        expect(res.ok).toBe(true);
        expect(res.nextCommand).toContain('/sp:dev-refineall --feature D5 --auto --depth ready');
        const report = await fs.readFile(res.reportPath);
        expect(report).toContain('planning digest stale');

        await cleanupRun(runId, result.wbs, [
            `${runDir}/${runId}-idea-task-batch.json`,
            `${runDir}/${runId}-idea-batch-create-result.json`,
            `${runDir}/${runId}-idea-task-order.json`,
            res.reportPath,
        ]);
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

    // ── R1 / R4–R7b regression suite (task 0667) ──
    test('R1: multi-word spurBin splits into a single command token with prefixed args on every spawn', async () => {
        const runId = 'test-idea-run-multiword';
        const featureId = 'D5';
        const runDir = '.spur/run';
        await fs.ensureDir(runDir);

        const batch = [{ name: 'Task A' }, { name: 'Task B' }];
        const result = { wbs: ['0601', '0602'] };
        const order = [{ name: 'Task A' }, { name: 'Task B', depends_on_names: ['Task A'] }];

        await fs.writeFile(`${runDir}/${runId}-idea-task-batch.json`, JSON.stringify(batch));
        await fs.writeFile(`${runDir}/${runId}-idea-batch-create-result.json`, JSON.stringify(result));
        await fs.writeFile(`${runDir}/${runId}-idea-task-order.json`, JSON.stringify(order));
        const paths = await writeReadyFixture(runId, result.wbs);

        const executedCommands: Array<{ command: string; args?: string[] }> = [];
        const base = evidenceAwareExecutor(paths);
        const mockExecutor: ProcessExecutor = {
            run: async (opts) => {
                executedCommands.push({ command: opts.command, args: opts.args });
                return base.run(opts);
            },
            runStreaming: () => ({}) as unknown as PipeProcess,
        };

        const res = await finalizeIdeaHandoff({
            runId,
            featureId,
            spurBin: '/abs/bun /abs/apps/cli/src/index.ts',
            processExecutor: mockExecutor,
        });

        expect(res.ok).toBe(true);
        expect(executedCommands.length).toBeGreaterThan(0);
        for (const c of executedCommands) {
            expect(c.command).toBe('/abs/bun');
            expect(c.args?.[0]).toBe('/abs/apps/cli/src/index.ts');
        }
        expect(executedCommands.some((c) => c.args?.includes('deps') && c.args?.includes('0602'))).toBe(true);
        expect(executedCommands.some((c) => c.args?.includes('refresh'))).toBe(true);
        expect(executedCommands.some((c) => c.args?.includes('check'))).toBe(true);

        await fs.deleteFile(`${runDir}/${runId}-idea-task-batch.json`);
        await fs.deleteFile(`${runDir}/${runId}-idea-batch-create-result.json`);
        await fs.deleteFile(`${runDir}/${runId}-idea-task-order.json`);
        await cleanupRun(runId, result.wbs, [res.reportPath]);
    });

    test('R1b: single-word spurBin keeps byte-identical argv', async () => {
        const runId = 'test-idea-run-singleword';
        const featureId = 'D5';
        const runDir = '.spur/run';
        await fs.ensureDir(runDir);

        await fs.writeFile(`${runDir}/${runId}-idea-task-batch.json`, JSON.stringify([{ name: 'Task A' }]));
        await fs.writeFile(`${runDir}/${runId}-idea-batch-create-result.json`, JSON.stringify({ wbs: ['0601'] }));
        await fs.writeFile(`${runDir}/${runId}-idea-task-order.json`, JSON.stringify([{ name: 'Task A' }]));
        const paths = await writeReadyFixture(runId, ['0601']);

        const executedCommands: Array<{ command: string; args?: string[] }> = [];
        const base = evidenceAwareExecutor(paths);
        const mockExecutor: ProcessExecutor = {
            run: async (opts) => {
                executedCommands.push({ command: opts.command, args: opts.args });
                return base.run(opts);
            },
            runStreaming: () => ({}) as unknown as PipeProcess,
        };

        const res = await finalizeIdeaHandoff({
            runId,
            featureId,
            spurBin: 'spur',
            processExecutor: mockExecutor,
        });

        expect(res.ok).toBe(true);
        for (const c of executedCommands) {
            expect(c.command).toBe('spur');
        }
        // single-task scenario has no deps call — assert the unprefixed argv head on the
        // refresh call instead (leadingArgs is empty for a single-word spurBin).
        const refreshCall = executedCommands.find((c) => c.args?.includes('refresh'));
        expect(refreshCall?.args?.[0]).toBe('feature');

        await fs.deleteFile(`${runDir}/${runId}-idea-task-batch.json`);
        await fs.deleteFile(`${runDir}/${runId}-idea-batch-create-result.json`);
        await fs.deleteFile(`${runDir}/${runId}-idea-task-order.json`);
        await cleanupRun(runId, ['0601'], [res.reportPath]);
    });

    test('R4: a rejected spurBin fails closed before any subprocess is spawned', async () => {
        const runId = 'test-idea-run-rejected';
        const featureId = 'D5';
        const runDir = '.spur/run';
        await fs.ensureDir(runDir);

        await fs.writeFile(`${runDir}/${runId}-idea-task-batch.json`, JSON.stringify([{ name: 'Task A' }]));
        await fs.writeFile(`${runDir}/${runId}-idea-batch-create-result.json`, JSON.stringify({ wbs: ['0601'] }));
        await fs.writeFile(`${runDir}/${runId}-idea-task-order.json`, JSON.stringify([{ name: 'Task A' }]));

        let spawned = 0;
        const mockExecutor: ProcessExecutor = {
            run: async (opts) => {
                spawned++;
                return {
                    command: opts.command,
                    args: opts.args ?? [],
                    durationMs: 1,
                    exitCode: 0,
                    stdout: '',
                    stderr: '',
                };
            },
            runStreaming: () => ({}) as unknown as PipeProcess,
        };

        const res = await finalizeIdeaHandoff({
            runId,
            featureId,
            spurBin: 'spur; rm -rf /',
            processExecutor: mockExecutor,
        });

        expect(res.ok).toBe(false);
        expect(res.error).toContain('shell metacharacters');
        expect(spawned).toBe(0);

        await fs.deleteFile(`${runDir}/${runId}-idea-task-batch.json`);
        await fs.deleteFile(`${runDir}/${runId}-idea-batch-create-result.json`);
        await fs.deleteFile(`${runDir}/${runId}-idea-task-order.json`);
    });

    test('R5: a failing task deps reports exit code and stderr evidence', async () => {
        const runId = 'test-idea-run-deps-evidence';
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
                        stderr: 'boom',
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

        const res = await finalizeIdeaHandoff({ runId, featureId, processExecutor: mockExecutor });
        expect(res.ok).toBe(false);
        expect(res.error).toContain('Failed to set dependencies for task 0602');
        expect(res.error).toContain('exit=1');
        expect(res.error).toContain('boom');

        await fs.deleteFile(`${runDir}/${runId}-idea-task-batch.json`);
        await fs.deleteFile(`${runDir}/${runId}-idea-batch-create-result.json`);
        await fs.deleteFile(`${runDir}/${runId}-idea-task-order.json`);
    });

    test('R6: a failing feature refresh fails the run with evidence and no report', async () => {
        const runId = 'test-idea-run-refresh-fail';
        const featureId = 'D5';
        const runDir = '.spur/run';
        await fs.ensureDir(runDir);

        // stale report from an earlier red run would trip the no-report assertion below
        if (await fs.exists(`${runDir}/${runId}-idea-handoff.md`)) {
            await fs.deleteFile(`${runDir}/${runId}-idea-handoff.md`);
        }

        await fs.writeFile(`${runDir}/${runId}-idea-task-batch.json`, JSON.stringify([{ name: 'Task A' }]));
        await fs.writeFile(`${runDir}/${runId}-idea-batch-create-result.json`, JSON.stringify({ wbs: ['0601'] }));
        await fs.writeFile(`${runDir}/${runId}-idea-task-order.json`, JSON.stringify([{ name: 'Task A' }]));

        const mockExecutor: ProcessExecutor = {
            run: async (opts) => {
                if (opts.args?.includes('refresh')) {
                    return {
                        command: opts.command,
                        args: opts.args ?? [],
                        durationMs: 1,
                        exitCode: 1,
                        stdout: '',
                        stderr: 'refresh boom',
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

        const res = await finalizeIdeaHandoff({ runId, featureId, processExecutor: mockExecutor });
        expect(res.ok).toBe(false);
        expect(res.error).toContain('Feature refresh');
        expect(res.error).toContain('refresh boom');
        expect(await fs.exists(res.reportPath)).toBe(false);

        await fs.deleteFile(`${runDir}/${runId}-idea-task-batch.json`);
        await fs.deleteFile(`${runDir}/${runId}-idea-batch-create-result.json`);
        await fs.deleteFile(`${runDir}/${runId}-idea-task-order.json`);
    });

    test('R7: a task check spawn failure (exitCode null) fails loudly naming the WBS with no report', async () => {
        const runId = 'test-idea-run-check-spawn-fail';
        const featureId = 'D5';
        const runDir = '.spur/run';
        await fs.ensureDir(runDir);

        // stale report from an earlier red run would trip the no-report assertion below
        if (await fs.exists(`${runDir}/${runId}-idea-handoff.md`)) {
            await fs.deleteFile(`${runDir}/${runId}-idea-handoff.md`);
        }

        await fs.writeFile(`${runDir}/${runId}-idea-task-batch.json`, JSON.stringify([{ name: 'Task A' }]));
        await fs.writeFile(`${runDir}/${runId}-idea-batch-create-result.json`, JSON.stringify({ wbs: ['0601'] }));
        await fs.writeFile(`${runDir}/${runId}-idea-task-order.json`, JSON.stringify([{ name: 'Task A' }]));
        const paths = await writeReadyFixture(runId, ['0601']);

        const base = evidenceAwareExecutor(paths);
        const mockExecutor: ProcessExecutor = {
            run: async (opts) => {
                if (opts.args?.includes('check')) {
                    return {
                        command: opts.command,
                        args: opts.args ?? [],
                        durationMs: 1,
                        exitCode: null,
                        stdout: '',
                        stderr: '',
                    };
                }
                return base.run(opts);
            },
            runStreaming: () => ({}) as unknown as PipeProcess,
        };

        const res = await finalizeIdeaHandoff({ runId, featureId, processExecutor: mockExecutor });
        expect(res.ok).toBe(false);
        expect(res.error).toContain('0601');
        expect(res.error).toContain('could not be spawned');
        expect(await fs.exists(res.reportPath)).toBe(false);

        await fs.deleteFile(`${runDir}/${runId}-idea-task-batch.json`);
        await fs.deleteFile(`${runDir}/${runId}-idea-batch-create-result.json`);
        await fs.deleteFile(`${runDir}/${runId}-idea-task-order.json`);
    });
});
