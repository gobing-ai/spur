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
        opts?: {
            status?: string;
            digestOverride?: (body: string) => string;
            omitSidecar?: boolean;
            /** Premises row evidence override (0947 lint scenarios). */
            premisesEvidence?: string;
            /** Frontmatter `feature_id` stamped into each task doc (0947 drift scenarios). */
            taskFeatureId?: string;
        },
    ): Promise<Record<string, string>> {
        const runDir = '.spur/run';
        const paths: Record<string, string> = {};
        const tasks = [];
        for (const wbs of wbss) {
            const featureLine = opts?.taskFeatureId !== undefined ? `feature_id: ${opts.taskFeatureId}\n` : '';
            const body = `---\nstatus: todo\nwbs: ${wbs}\n${featureLine}---\n\n## Background\n\nPrepared background.\n\n## Acceptance Criteria\n\n- [ ] Scenario one.\n`;
            const p = `${runDir}/${runId}-${wbs}.md`;
            await fs.writeFile(p, body);
            paths[wbs] = p;
            tasks.push({
                wbs,
                status: opts?.status ?? 'ready',
                planningDigest: opts?.digestOverride ? opts.digestOverride(body) : computePlanningDigest(body),
                checks: READY_IDS.map((id) => ({
                    id,
                    pass: true,
                    evidence:
                        id === 'premises'
                            ? (opts?.premisesEvidence ?? `premises verified at ${runDir}/${runId}-${wbs}.md:1`)
                            : `${id} verified`,
                })),
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
                if (args.includes('feature') && args.includes('show')) {
                    const id = args[args.indexOf('show') + 1] ?? '';
                    return {
                        command: opts.command,
                        args,
                        durationMs: 1,
                        exitCode: 0,
                        stdout: JSON.stringify({ id }),
                        stderr: '',
                    };
                }
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
            spurArgv: ['/runtime with spaces/bun', '/project with spaces/spur.ts'],
            processExecutor: mockExecutor,
        });
        expect(executedCommands.every((c) => c.command === '/runtime with spaces/bun')).toBe(true);
        expect(executedCommands.every((c) => c.args?.[0] === '/project with spaces/spur.ts')).toBe(true);

        expect(res.ok).toBe(true);
        expect(res.wbsList).toEqual(['0601', '0602']);
        expect(res.nextCommand).toContain('/sp:dev-run --all --feature D5');

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

    // ── ADR-137 (S8): a new dependency edge onto a deprecated task is refused ──
    // Reachable, though narrow: `ready-prepare` (an agent step) runs between `batch-create-run` and
    // `handoff-finalize`, so an interrupted run resumed later can find a just-created task the
    // operator has since deprecated. The mocked `task show` stands in for that resumed state.
    test('refuses a resolved dependency that is a deprecated task before any deps write', async () => {
        const runId = 'test-idea-run-deprecated-dep';
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

        const executed: string[][] = [];
        const base = evidenceAwareExecutor(paths);
        const mockExecutor: ProcessExecutor = {
            run: async (opts) => {
                const args = opts.args ?? [];
                executed.push(args);
                if (args.includes('show')) {
                    return {
                        command: opts.command,
                        args,
                        durationMs: 1,
                        exitCode: 0,
                        stdout: JSON.stringify({ wbs: '0601', status: 'deprecated' }),
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
        expect(res.error).toContain('deprecated');
        expect(res.error).toContain('spur task update 0601 todo');
        // The refusal precedes every dependency write and the rest of the handoff.
        expect(executed.some((args) => args.includes('deps'))).toBe(false);
        expect(executed.some((args) => args.includes('refresh'))).toBe(false);

        await cleanupRun(runId, result.wbs, [
            `${runDir}/${runId}-idea-task-batch.json`,
            `${runDir}/${runId}-idea-batch-create-result.json`,
            `${runDir}/${runId}-idea-task-order.json`,
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
        expect(res.nextCommand).toContain('/sp:dev-refine --all --feature D5 --auto --depth ready');
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
        expect(res.nextCommand).toContain('/sp:dev-refine --all --feature D5 --auto --depth ready');
        const report = await fs.readFile(res.reportPath);
        expect(report).toContain('planning digest stale');

        await cleanupRun(runId, result.wbs, [
            `${runDir}/${runId}-idea-task-batch.json`,
            `${runDir}/${runId}-idea-batch-create-result.json`,
            `${runDir}/${runId}-idea-task-order.json`,
            res.reportPath,
        ]);
    });

    // ── task 0875: deps applied between binding and verification must not stale ──
    test('deps applied between binding and verification do not stale; a Requirements edit still does', async () => {
        const runId = 'test-idea-run-deps-boundary';
        const featureId = 'D5';
        const runDir = '.spur/run';
        await fs.ensureDir(runDir);

        const batch = [{ name: 'Task A' }];
        const result = { wbs: ['0601'] };
        const order = [{ name: 'Task A' }];

        await fs.writeFile(`${runDir}/${runId}-idea-task-batch.json`, JSON.stringify(batch));
        await fs.writeFile(`${runDir}/${runId}-idea-batch-create-result.json`, JSON.stringify(result));
        await fs.writeFile(`${runDir}/${runId}-idea-task-order.json`, JSON.stringify(order));

        // The file as verification reads it AFTER handoff-finalize applied `spur task deps`.
        const postDepsBody =
            '---\nstatus: todo\nwbs: 0601\ndependencies: ["0600"]\n---\n\n### Background\n\nPrepared background.\n\n### Requirements\n\nRequirements body.\n\n### Acceptance Criteria\n\n- [ ] Scenario one.\n';
        // The digest as ready-prepare bound it BEFORE deps were applied (same doc, no dependencies).
        const preDepsBody =
            '---\nstatus: todo\nwbs: 0601\n---\n\n### Background\n\nPrepared background.\n\n### Requirements\n\nRequirements body.\n\n### Acceptance Criteria\n\n- [ ] Scenario one.\n';
        const taskPath = `${runDir}/${runId}-0601.md`;
        await fs.writeFile(taskPath, postDepsBody);
        await fs.writeFile(
            `${runDir}/${runId}-idea-ready.json`,
            JSON.stringify({
                runId,
                depth: 'ready',
                tasks: [
                    {
                        wbs: '0601',
                        status: 'ready',
                        planningDigest: computePlanningDigest(preDepsBody),
                        checks: READY_IDS.map((id) => ({
                            id,
                            pass: true,
                            evidence: id === 'premises' ? `premises verified at ${taskPath}:1` : `${id} verified`,
                        })),
                    },
                ],
            }),
        );

        const res = await finalizeIdeaHandoff({
            runId,
            featureId,
            processExecutor: evidenceAwareExecutor({ '0601': taskPath }),
        });
        expect(res.ok).toBe(true);
        expect(res.nextCommand).toContain('/sp:dev-run --all --feature D5');

        // A genuine post-preparation Requirements edit still degrades to refine.
        const editedBody = postDepsBody.replace('Requirements body.', 'Changed requirements after preparation.');
        await fs.writeFile(taskPath, editedBody);
        const res2 = await finalizeIdeaHandoff({
            runId,
            featureId,
            processExecutor: evidenceAwareExecutor({ '0601': taskPath }),
        });
        expect(res2.ok).toBe(true);
        expect(res2.nextCommand).toContain('/sp:dev-refine --all --feature D5 --auto --depth ready');
        const report2 = await fs.readFile(res2.reportPath);
        expect(report2).toContain('planning digest stale');

        await cleanupRun(
            runId,
            ['0601'],
            [
                `${runDir}/${runId}-idea-task-batch.json`,
                `${runDir}/${runId}-idea-batch-create-result.json`,
                `${runDir}/${runId}-idea-task-order.json`,
                res.reportPath,
                res2.reportPath,
            ],
        );
    });

    // ── task 0947: premise-correctness lint + feature drift at the handoff gate ──
    test('premises evidence without a path:line citation degrades to refineall (0947 R1c)', async () => {
        const runId = 'test-idea-run-premise-lint';
        const featureId = 'D5';
        const runDir = '.spur/run';
        await fs.ensureDir(runDir);

        await fs.writeFile(`${runDir}/${runId}-idea-task-batch.json`, JSON.stringify([{ name: 'Task A' }]));
        await fs.writeFile(`${runDir}/${runId}-idea-batch-create-result.json`, JSON.stringify({ wbs: ['0601'] }));
        await fs.writeFile(`${runDir}/${runId}-idea-task-order.json`, JSON.stringify([{ name: 'Task A' }]));
        const paths = await writeReadyFixture(runId, ['0601'], {
            premisesEvidence: 'premises verified by reading the Background prose',
        });

        const res = await finalizeIdeaHandoff({
            runId,
            featureId,
            processExecutor: evidenceAwareExecutor(paths),
        });

        expect(res.ok).toBe(true);
        expect(res.nextCommand).toContain('/sp:dev-refine --all --feature D5 --auto --depth ready');
        const report = await fs.readFile(res.reportPath);
        expect(report).toContain('UNREADY');
        expect(report).toContain('no path:line citation');
        expect(report).toContain('/sp:dev-refine 0601 --auto --depth ready');

        await cleanupRun(
            runId,
            ['0601'],
            [
                `${runDir}/${runId}-idea-task-batch.json`,
                `${runDir}/${runId}-idea-batch-create-result.json`,
                `${runDir}/${runId}-idea-task-order.json`,
                res.reportPath,
            ],
        );
    });

    test('feature drift between task frontmatter and the run degrades with a precise reason (0947 R2)', async () => {
        const runId = 'test-idea-run-drift';
        const featureId = 'D64';
        const runDir = '.spur/run';
        await fs.ensureDir(runDir);

        await fs.writeFile(`${runDir}/${runId}-idea-task-batch.json`, JSON.stringify([{ name: 'Task A' }]));
        await fs.writeFile(`${runDir}/${runId}-idea-batch-create-result.json`, JSON.stringify({ wbs: ['0601'] }));
        await fs.writeFile(`${runDir}/${runId}-idea-task-order.json`, JSON.stringify([{ name: 'Task A' }]));
        const paths = await writeReadyFixture(runId, ['0601'], { taskFeatureId: 'O' });

        const res = await finalizeIdeaHandoff({
            runId,
            featureId,
            processExecutor: evidenceAwareExecutor(paths),
        });

        expect(res.ok).toBe(true);
        expect(res.nextCommand).toContain('/sp:dev-refine --all --feature D64 --auto --depth ready');
        const report = await fs.readFile(res.reportPath);
        expect(report).toContain('UNREADY');
        expect(report).toContain('feature drift — task feature_id O != run feature D64');
        expect(report).toContain('/sp:dev-refine 0601 --auto --depth ready');

        await cleanupRun(
            runId,
            ['0601'],
            [
                `${runDir}/${runId}-idea-task-batch.json`,
                `${runDir}/${runId}-idea-batch-create-result.json`,
                `${runDir}/${runId}-idea-task-order.json`,
                res.reportPath,
            ],
        );
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

    // ── I15 1434: fail-closed follow-up ledger completeness at handoff ──
    const EVAL_REPORT = [
        '# Idea Evaluation Report',
        '',
        '## Requirement inventory',
        '',
        '- I1 — In-scope requirement',
        '- I2 — Operator ruled this out [deferred: excluded — out of scope]',
        '- I3 — Work for another feature [deferred: follow-up — Follow-up feature]',
        '',
    ].join('\n');

    /** Write batch/result/order + ready evidence + the given eval report and ledger rows. */
    async function writeLedgerFixture(
        runId: string,
        wbs: string,
        opts?: { evalReport?: string | null; ledger?: unknown | null },
    ): Promise<Record<string, string>> {
        const runDir = '.spur/run';
        await fs.ensureDir(runDir);
        await fs.writeFile(`${runDir}/${runId}-idea-task-batch.json`, JSON.stringify([{ name: 'Task A' }]));
        await fs.writeFile(`${runDir}/${runId}-idea-batch-create-result.json`, JSON.stringify({ wbs: [wbs] }));
        await fs.writeFile(`${runDir}/${runId}-idea-task-order.json`, JSON.stringify([{ name: 'Task A' }]));
        const paths = await writeReadyFixture(runId, [wbs]);
        if (opts?.evalReport !== null) {
            await fs.writeFile(`${runDir}/${runId}-idea-eval-report.md`, opts?.evalReport ?? EVAL_REPORT);
        }
        if (opts?.ledger !== null) {
            await fs.writeFile(`${runDir}/${runId}-idea-followups.json`, JSON.stringify(opts?.ledger ?? []));
        }
        return paths;
    }

    async function cleanupLedgerRun(runId: string, extra: string[]): Promise<void> {
        const runDir = '.spur/run';
        await cleanupRun(
            runId,
            [],
            [...extra, `${runDir}/${runId}-idea-eval-report.md`, `${runDir}/${runId}-idea-followups.json`],
        );
    }

    test('1434: an incomplete ledger fails closed before any deps write and writes no report', async () => {
        const runId = 'test-idea-run-ledger-incomplete';
        const featureId = 'D5';
        if (await fs.exists(`.spur/run/${runId}-idea-handoff.md`)) {
            await fs.deleteFile(`.spur/run/${runId}-idea-handoff.md`);
        }
        const paths = await writeLedgerFixture(runId, '0601', { ledger: [] });

        const executed: string[][] = [];
        const base = evidenceAwareExecutor(paths);
        const mockExecutor: ProcessExecutor = {
            run: async (opts) => {
                executed.push(opts.args ?? []);
                return base.run(opts);
            },
            runStreaming: () => ({}) as unknown as PipeProcess,
        };

        const res = await finalizeIdeaHandoff({ runId, featureId, processExecutor: mockExecutor });
        expect(res.ok).toBe(false);
        expect(res.error).toContain('I3');
        expect(res.error).toContain('no ledger row');
        expect(await fs.exists(res.reportPath)).toBe(false);
        expect(executed.some((args) => args.includes('deps'))).toBe(false);

        await cleanupLedgerRun(runId, [
            `.spur/run/${runId}-idea-task-batch.json`,
            `.spur/run/${runId}-idea-batch-create-result.json`,
            `.spur/run/${runId}-idea-task-order.json`,
        ]);
    });

    test('1434: a complete ledger passes and the report lists both sections before ## Next command', async () => {
        const runId = 'test-idea-run-ledger-complete';
        const featureId = 'D5';
        const paths = await writeLedgerFixture(runId, '0601', {
            ledger: [{ item: 'I3', disposition: 'filed', featureId: 'F9', title: 'Follow-up feature' }],
        });

        const res = await finalizeIdeaHandoff({ runId, featureId, processExecutor: evidenceAwareExecutor(paths) });
        expect(res.ok).toBe(true);
        const report = await fs.readFile(res.reportPath);
        expect(report).toContain('## Follow-ups filed');
        expect(report).toContain('I3 → F9 (Follow-up feature) — next: /sp:dev-plan --feature F9');
        expect(report).toContain('## Excluded');
        expect(report).toContain('I2 — out of scope');
        expect(report.indexOf('## Follow-ups filed')).toBeLessThan(report.indexOf('## Next command'));
        expect(report.indexOf('## Excluded')).toBeLessThan(report.indexOf('## Next command'));
        expect(report.match(/\/sp:dev-run --all --feature D5/g)).toHaveLength(1);

        await cleanupLedgerRun(runId, [
            `.spur/run/${runId}-idea-task-batch.json`,
            `.spur/run/${runId}-idea-batch-create-result.json`,
            `.spur/run/${runId}-idea-task-order.json`,
            res.reportPath,
        ]);
    });

    test('1434: legacy run with no ledger and no follow-up items passes as an empty ledger', async () => {
        const runId = 'test-idea-run-ledger-legacy-clean';
        const featureId = 'D5';
        const evalReport = ['## Requirement inventory', '', '- I1 — In scope', ''].join('\n');
        const paths = await writeLedgerFixture(runId, '0601', { evalReport, ledger: null });

        const res = await finalizeIdeaHandoff({ runId, featureId, processExecutor: evidenceAwareExecutor(paths) });
        expect(res.ok).toBe(true);
        const report = await fs.readFile(res.reportPath);
        expect(report).toContain('## Follow-ups filed');
        expect(report).toContain('## Excluded');

        await cleanupLedgerRun(runId, [
            `.spur/run/${runId}-idea-task-batch.json`,
            `.spur/run/${runId}-idea-batch-create-result.json`,
            `.spur/run/${runId}-idea-task-order.json`,
            res.reportPath,
        ]);
    });

    test('1434: no ledger with follow-up items present fails with unfiled findings', async () => {
        const runId = 'test-idea-run-ledger-missing';
        const featureId = 'D5';
        if (await fs.exists(`.spur/run/${runId}-idea-handoff.md`)) {
            await fs.deleteFile(`.spur/run/${runId}-idea-handoff.md`);
        }
        const paths = await writeLedgerFixture(runId, '0601', { ledger: null });

        const res = await finalizeIdeaHandoff({ runId, featureId, processExecutor: evidenceAwareExecutor(paths) });
        expect(res.ok).toBe(false);
        expect(res.error).toContain('I3');
        expect(res.error).toContain('no ledger row');
        expect(await fs.exists(res.reportPath)).toBe(false);

        await cleanupLedgerRun(runId, [
            `.spur/run/${runId}-idea-task-batch.json`,
            `.spur/run/${runId}-idea-batch-create-result.json`,
            `.spur/run/${runId}-idea-task-order.json`,
        ]);
    });

    test('1434: no eval report skips the check and records the skip line; ledger rows list as filed', async () => {
        const runId = 'test-idea-run-ledger-no-report';
        const featureId = 'D5';
        const paths = await writeLedgerFixture(runId, '0601', {
            evalReport: null,
            ledger: [{ item: 'I3', disposition: 'existing', featureId: 'F9', title: 'Follow-up feature' }],
        });

        const res = await finalizeIdeaHandoff({ runId, featureId, processExecutor: evidenceAwareExecutor(paths) });
        expect(res.ok).toBe(true);
        const report = await fs.readFile(res.reportPath);
        expect(report).toContain('skipped');
        expect(report).toContain('I3 → F9 (Follow-up feature) — next: /sp:dev-plan --feature F9');

        await cleanupLedgerRun(runId, [
            `.spur/run/${runId}-idea-task-batch.json`,
            `.spur/run/${runId}-idea-batch-create-result.json`,
            `.spur/run/${runId}-idea-task-order.json`,
            res.reportPath,
        ]);
    });

    test('1434: a malformed ledger fails closed even with no eval report', async () => {
        const runId = 'test-idea-run-ledger-malformed';
        const featureId = 'D5';
        const runDir = '.spur/run';
        await fs.ensureDir(runDir);
        await fs.writeFile(`${runDir}/${runId}-idea-task-batch.json`, JSON.stringify([{ name: 'Task A' }]));
        await fs.writeFile(`${runDir}/${runId}-idea-batch-create-result.json`, JSON.stringify({ wbs: ['0601'] }));
        await fs.writeFile(`${runDir}/${runId}-idea-task-order.json`, JSON.stringify([{ name: 'Task A' }]));
        await fs.writeFile(`${runDir}/${runId}-idea-followups.json`, JSON.stringify([{ item: 'not-an-id' }]));

        const res = await finalizeIdeaHandoff({ runId, featureId, processExecutor: evidenceAwareExecutor({}) });
        expect(res.ok).toBe(false);
        expect(res.error).toContain('Malformed follow-up ledger');
        expect(await fs.exists(res.reportPath)).toBe(false);

        await cleanupLedgerRun(runId, [
            `${runDir}/${runId}-idea-task-batch.json`,
            `${runDir}/${runId}-idea-batch-create-result.json`,
            `${runDir}/${runId}-idea-task-order.json`,
        ]);
    });

    for (const [label, stdout] of [
        ['help output', 'Usage: spur feature show [options] <id>'],
        ['wrong feature', JSON.stringify({ id: 'F10' })],
        ['missing identity', JSON.stringify({ name: 'Follow-up feature' })],
    ] as const) {
        test(`1434: exit-zero ${label} cannot resolve a ledger feature id`, async () => {
            const runId = `test-idea-ledger-show-${label.replaceAll(' ', '-')}`;
            const reportPath = `.spur/run/${runId}-idea-handoff.md`;
            if (await fs.exists(reportPath)) await fs.deleteFile(reportPath);
            const paths = await writeLedgerFixture(runId, '0601', {
                ledger: [{ item: 'I3', disposition: 'filed', featureId: 'F9', title: 'Follow-up feature' }],
            });
            const executed: string[][] = [];
            const base = evidenceAwareExecutor(paths);
            const executor: ProcessExecutor = {
                run: async (opts) => {
                    executed.push(opts.args ?? []);
                    if (opts.args?.includes('feature') && opts.args.includes('show')) {
                        return {
                            command: opts.command,
                            args: opts.args,
                            durationMs: 1,
                            exitCode: 0,
                            stdout,
                            stderr: '',
                        };
                    }
                    return base.run(opts);
                },
                runStreaming: () => ({}) as unknown as PipeProcess,
            };
            const result = await finalizeIdeaHandoff({ runId, featureId: 'D5', processExecutor: executor });
            expect(result.ok).toBe(false);
            expect(result.error).toContain('F9');
            expect(await fs.exists(result.reportPath)).toBe(false);
            expect(executed.some((args) => args.includes('deps'))).toBe(false);
            await cleanupLedgerRun(runId, [
                `.spur/run/${runId}-idea-task-batch.json`,
                `.spur/run/${runId}-idea-batch-create-result.json`,
                `.spur/run/${runId}-idea-task-order.json`,
                result.reportPath,
            ]);
        });
    }

    test('1434: a ledger featureId that no longer resolves fails closed as dangling', async () => {
        const runId = 'test-idea-run-ledger-dangling';
        const featureId = 'D5';
        if (await fs.exists(`.spur/run/${runId}-idea-handoff.md`)) {
            await fs.deleteFile(`.spur/run/${runId}-idea-handoff.md`);
        }
        const paths = await writeLedgerFixture(runId, '0601', {
            ledger: [{ item: 'I3', disposition: 'filed', featureId: 'GHOST', title: 'Follow-up feature' }],
        });

        const base = evidenceAwareExecutor(paths);
        const mockExecutor: ProcessExecutor = {
            run: async (opts) => {
                if (opts.args?.includes('GHOST')) {
                    return {
                        command: opts.command,
                        args: opts.args ?? [],
                        durationMs: 1,
                        exitCode: 1,
                        stdout: '',
                        stderr: 'not found',
                    };
                }
                return base.run(opts);
            },
            runStreaming: () => ({}) as unknown as PipeProcess,
        };

        const res = await finalizeIdeaHandoff({ runId, featureId, processExecutor: mockExecutor });
        expect(res.ok).toBe(false);
        expect(res.error).toContain('I3');
        expect(res.error).toContain('GHOST');
        expect(await fs.exists(res.reportPath)).toBe(false);

        await cleanupLedgerRun(runId, [
            `.spur/run/${runId}-idea-task-batch.json`,
            `.spur/run/${runId}-idea-batch-create-result.json`,
            `.spur/run/${runId}-idea-task-order.json`,
        ]);
    });
});
