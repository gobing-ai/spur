import { resolve } from 'node:path';
import {
    createNodeFileSystem,
    type FileSystem,
    NodeProcessExecutor,
    type ProcessExecutor,
    type ProcessResult,
} from '@gobing-ai/ts-runtime';
import { splitLaunchCommand } from './split-launch-command';

/**
 * Options configuring idea handoff finalization.
 */
export interface FinalizeIdeaHandoffOptions {
    /** Project root directory. */
    projectRoot?: string;
    /** Pipeline run identifier. */
    runId: string;
    /** Feature identifier. */
    featureId: string;
    /** Spur binary name or path. */
    spurBin?: string;
    /** FileSystem abstraction. */
    fileSystem?: FileSystem;
    /** ProcessExecutor abstraction. */
    processExecutor?: ProcessExecutor;
}

/**
 * Result returned by idea handoff finalization.
 */
export interface FinalizeIdeaHandoffResult {
    /** Whether the finalization succeeded. */
    ok: boolean;
    /** List of created WBS identifiers. */
    wbsList: string[];
    /** Recommended next command. */
    nextCommand: string;
    /** Path to generated handoff markdown report. */
    reportPath: string;
    /** Error message if finalization failed. */
    error?: string;
}

/**
 * Format the failure evidence a ProcessResult actually carries — a spawn failure
 * surfaces as `exitCode: null` with empty stderr, so the empty-stderr symptom is
 * made explicit rather than rendered as a bare trailing colon (task 0667 R5).
 */
function processEvidence(r: ProcessResult): string {
    return `exit=${r.exitCode ?? 'null'}${r.signal ? ` signal=${r.signal}` : ''}: ${r.stderr.trim() || 'no stderr'}`;
}

/**
 * Deterministically finalizes an idea pipeline run by validating batch creation,
 * applying task dependencies via `spur task deps`, refreshing feature roster,
 * running per-task readiness checks, and authoring the handoff markdown report.
 *
 * @param options - Handoff finalization options.
 * @returns Finalization result.
 */
export async function finalizeIdeaHandoff(options: FinalizeIdeaHandoffOptions): Promise<FinalizeIdeaHandoffResult> {
    const root = options.projectRoot ?? process.cwd();
    const fs = options.fileSystem ?? createNodeFileSystem();
    const executor = options.processExecutor ?? new NodeProcessExecutor();
    const spurBin = options.spurBin ?? 'spur';
    const { runId, featureId } = options;

    const runDir = resolve(root, '.spur', 'run');
    const batchPath = resolve(runDir, `${runId}-idea-task-batch.json`);
    const resultPath = resolve(runDir, `${runId}-idea-batch-create-result.json`);
    const orderPath = resolve(runDir, `${runId}-idea-task-order.json`);
    const reportPath = resolve(runDir, `${runId}-idea-handoff.md`);

    // Split the launch string once: `spurBin` legitimately resolves to `"<bun> <mainModule>"`
    // under the JS-runtime launch modes (resolveSpurBin), and the executor hands `command`
    // verbatim to execa without shell-splitting — a multi-word string would ENOENT. Reject
    // before any subprocess and any report (R1/R4).
    const spurSplit = splitLaunchCommand(spurBin, 'idea-handoff "spurBin"');
    if ('error' in spurSplit) {
        return {
            ok: false,
            wbsList: [],
            nextCommand: '',
            reportPath,
            error: spurSplit.error,
        };
    }
    const spurCommand = spurSplit.command;
    const spurArgsPrefix = spurSplit.leadingArgs;

    if (!(await fs.exists(batchPath)) || !(await fs.exists(resultPath)) || !(await fs.exists(orderPath))) {
        return {
            ok: false,
            wbsList: [],
            nextCommand: '',
            reportPath,
            error: 'Required batch, result, or order files missing in .spur/run/',
        };
    }

    try {
        const batch = JSON.parse(await fs.readFile(batchPath)) as Array<{ name: string }>;
        const result = JSON.parse(await fs.readFile(resultPath)) as { wbs: string[] };
        const order = JSON.parse(await fs.readFile(orderPath)) as Array<{
            name: string;
            depends_on_names?: string[];
        }>;

        if (!Array.isArray(batch) || !Array.isArray(result?.wbs) || !Array.isArray(order)) {
            return {
                ok: false,
                wbsList: [],
                nextCommand: '',
                reportPath,
                error: 'Malformed batch, result, or order JSON structure',
            };
        }

        if (batch.length !== result.wbs.length) {
            return {
                ok: false,
                wbsList: result.wbs,
                nextCommand: '',
                reportPath,
                error: `Batch size mismatch: ${batch.length} items declared but ${result.wbs.length} WBS created`,
            };
        }

        const names = batch.map((b) => b.name);
        if (new Set(names).size !== names.length) {
            return {
                ok: false,
                wbsList: result.wbs,
                nextCommand: '',
                reportPath,
                error: 'Duplicate task names found in batch declaration',
            };
        }

        // Apply dependencies
        for (const item of order) {
            const ownIdx = names.indexOf(item.name);
            if (ownIdx === -1 || !result.wbs[ownIdx]) {
                return {
                    ok: false,
                    wbsList: result.wbs,
                    nextCommand: '',
                    reportPath,
                    error: `Task name "${item.name}" from order could not be mapped to created WBS`,
                };
            }
            const ownWbs = result.wbs[ownIdx] as string;
            const deps: string[] = [];
            for (const depName of item.depends_on_names ?? []) {
                const depIdx = names.indexOf(depName);
                if (depIdx === -1 || !result.wbs[depIdx]) {
                    return {
                        ok: false,
                        wbsList: result.wbs,
                        nextCommand: '',
                        reportPath,
                        error: `Dependency task name "${depName}" could not be mapped to created WBS`,
                    };
                }
                deps.push(result.wbs[depIdx] as string);
            }

            if (deps.length > 0) {
                const depRes = await executor.run({
                    command: spurCommand,
                    args: [...spurArgsPrefix, 'task', 'deps', ownWbs, 'set', ...deps, '--json'],
                    cwd: root,
                    forceBuffered: true,
                    rejectOnError: false,
                });
                if (depRes.exitCode !== 0) {
                    return {
                        ok: false,
                        wbsList: result.wbs,
                        nextCommand: '',
                        reportPath,
                        error: `Failed to set dependencies for task ${ownWbs}: ${processEvidence(depRes)}`,
                    };
                }
            }
        }

        // Refresh feature roster — fail closed on any non-zero (including a null spawn
        // exit), matching the &&-chained shell fallback in idea-pipeline.yaml (R6).
        const refreshRes = await executor.run({
            command: spurCommand,
            args: [...spurArgsPrefix, 'feature', 'refresh', '--feature', featureId, '--json'],
            cwd: root,
            forceBuffered: true,
            rejectOnError: false,
        });
        if (refreshRes.exitCode !== 0) {
            return {
                ok: false,
                wbsList: result.wbs,
                nextCommand: '',
                reportPath,
                error: `Feature refresh for ${featureId} failed: ${processEvidence(refreshRes)}`,
            };
        }

        // Check per-task readiness
        const checkResults: Array<{ wbs: string; pass: boolean }> = [];
        for (const wbs of result.wbs) {
            const checkRes = await executor.run({
                command: spurCommand,
                args: [...spurArgsPrefix, 'task', 'check', wbs, '--json'],
                cwd: root,
                forceBuffered: true,
                rejectOnError: false,
            });
            // A null exitCode means the executor could not spawn the resolved command —
            // the executor is broken, not the task. Fail loudly with no fabricated
            // readiness table (R7). Real failures keep pass:false → refineall (R7b).
            if (checkRes.exitCode === null) {
                return {
                    ok: false,
                    wbsList: result.wbs,
                    nextCommand: '',
                    reportPath,
                    error: `Task check for ${wbs} could not be spawned (${spurCommand}): ${processEvidence(checkRes)}`,
                };
            }
            checkResults.push({ wbs, pass: checkRes.exitCode === 0 });
        }

        const anyFailed = checkResults.some((c) => !c.pass);
        const nextCommand = anyFailed
            ? `/sp:dev-refineall --feature ${featureId} --auto --depth ready`
            : `/sp:dev-runall --feature ${featureId} --auto`;

        const reportLines = [
            '# Idea pipeline handoff report',
            '',
            `Feature: ${featureId}`,
            `Run ID: ${runId}`,
            '',
            '## Created tasks',
            ...result.wbs.map((w) => `  - ${w}`),
            '',
            '## Per-task readiness (spur task check)',
            '',
            '| WBS | Outcome |',
            '|-----|---------|',
            ...checkResults.map((c) => `| ${c.wbs} | ${c.pass ? 'PASS' : 'FAIL'} |`),
            '',
            '## Next command',
            '',
            nextCommand,
            '',
        ];

        await fs.ensureDir(runDir);
        await fs.writeFile(reportPath, reportLines.join('\n'));

        return {
            ok: true,
            wbsList: result.wbs,
            nextCommand,
            reportPath,
        };
    } catch (err) {
        return {
            ok: false,
            wbsList: [],
            nextCommand: '',
            reportPath,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}
