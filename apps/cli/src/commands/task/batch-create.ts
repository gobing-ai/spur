import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Command } from '@commander-js/extra-typings';
import {
    prepareBatchTaskReady,
    READY_DONE,
    READY_SKIPPED,
    type ReadinessOutcome,
    TaskCandidateInvalidError,
    TaskPreparationError,
    WbsCollisionError,
} from '@gobing-ai/spur-app';
import type { CliContext } from '../../context';
import { toEnvelopeJson } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeService, writeCreateJsonError } from './shared';

/** Register `spur task batch-create`. */
export function registerTaskBatchCreateCommand(task: Command, context: CliContext): void {
    // ── batch-create ──
    task.command('batch-create')
        .summary('Create many tasks from a validated JSON file — all-or-nothing (LLM→CLI gate).')
        .requiredOption(...SHARED_OPTIONS.fileTaskBatch)
        .option('--skip-ready', 'Skip ready preparation (write supplied content as-is, no model dispatch)')
        .option('--agent <selector>', 'Agent used for ready preparation (defaults to the configured agent)')
        .option(...SHARED_OPTIONS.folderTasks)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            if (options.skipReady === true && options.agent !== undefined) {
                writeCreateJsonError(
                    context,
                    options,
                    'invalid-usage',
                    '--agent has no effect with --skip-ready (no preparation runs)',
                );
                context.setExitCode(2);
                return;
            }
            const svc = await makeService(context, options.folder);
            // Ready-by-default batch flow (F21 task 0788): the planner synthesizes
            // ONCE for the whole supplied batch BEFORE any allocation boundary; the
            // strict-schema-validated result is staged to a temp file for
            // batchCreate (the only commit boundary, which re-validates). A
            // rejected capture allocates no WBS and wires no parents.
            let tmpPath: string | undefined;
            try {
                let batchFile = options.file;
                let readiness: ReadinessOutcome = READY_SKIPPED;
                if (options.skipReady !== true) {
                    const batchSource = await context.fs.readFile(options.file);
                    const prepared = await prepareBatchTaskReady({
                        batchPath: options.file,
                        batchSource,
                        agents: context.agentService(),
                        agentSelector: options.agent,
                        cwd: context.cwd,
                    });
                    tmpPath = join(
                        tmpdir(),
                        `spur-ready-batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
                    );
                    await writeFile(tmpPath, `${JSON.stringify(prepared.items, null, 2)}\n`);
                    batchFile = tmpPath;
                    readiness = READY_DONE;
                }
                const { children, parentsWired, featureReopened } = await svc.batchCreate(batchFile);
                if (options.json) {
                    const ids = children.map((r) => r.ref.id);
                    // 1132 R1: per-item write-time normalizations ride the batch result.
                    const normalized = children
                        .map((r, i) => ({ wbs: ids[i] ?? r.ref.id, normalized: r.normalized ?? [] }))
                        .filter((row) => row.normalized.length > 0);
                    context.output.write(
                        toEnvelopeJson(
                            {
                                created: children.length,
                                wbs: ids,
                                parentsWired,
                                ...(normalized.length > 0 ? { normalized } : {}),
                                ...(featureReopened.some((r) => r !== undefined) ? { featureReopened } : {}),
                                ...readiness,
                            },
                            { enveloped: options.jsonEnvelope },
                        ),
                    );
                } else {
                    context.output.write(`Created ${children.length} task(s)`);
                    for (const r of children) {
                        context.output.write(`  ${r.ref.id}  ${r.ref.filePath}`);
                    }
                    if (parentsWired.length > 0) {
                        context.output.write(`Wired ${parentsWired.length} parent(s):`);
                        for (const p of parentsWired) {
                            const txLine = p.transitionedTo ? ` → ${p.transitionedTo}` : '';
                            const errLine = p.errors.length > 0 ? ` (errors: ${p.errors.join('; ')})` : '';
                            context.output.write(`  ${p.wbs}  rostered=${p.rostered}${txLine}${errLine}`);
                        }
                    }
                }
            } catch (err) {
                if (err instanceof TaskPreparationError) {
                    // F21 task 0788 (R3): rejected model output never allocates a
                    // WBS or wires parents; report stage + recovery, exit 1. Raw
                    // mode appends the recovery hint to the bare stderr line
                    // (mirrors the single-create branch).
                    const message =
                        !options.json && err.recoveryCommand !== undefined
                            ? `${err.message}\nRecover with: ${err.recoveryCommand}`
                            : err.message;
                    writeCreateJsonError(context, options, 'preparation-failed', message, {
                        failedStage: err.stage,
                        ...(err.recoveryCommand !== undefined ? { recoveryCommand: err.recoveryCommand } : {}),
                        readiness: { status: 'failed', depth: 'ready' },
                    });
                    context.setExitCode(1);
                } else if (err instanceof WbsCollisionError) {
                    if (options.json) {
                        context.output.write(
                            toEnvelopeJson(
                                {
                                    ok: false,
                                    error: {
                                        code: 'wbs-collision',
                                        message: err.message,
                                        wbs: err.wbs,
                                        existingPath: err.existingPath,
                                        attemptedPath: err.attemptedPath,
                                    },
                                },
                                {
                                    enveloped: options.jsonEnvelope,
                                    error: {
                                        code: 'INTERNAL_ERROR',
                                        message: err.message,
                                        details: {
                                            cliCode: 'wbs-collision',
                                            wbs: err.wbs,
                                            existingPath: err.existingPath,
                                            attemptedPath: err.attemptedPath,
                                        },
                                    },
                                },
                            ),
                        );
                    } else {
                        context.output.error(err.message);
                    }
                    context.setExitCode(3);
                } else if (err instanceof TaskCandidateInvalidError) {
                    // F21 task 0787 (R4): an invalid batch item is invalid input →
                    // ONE parseable `--json` error carrying the checker findings.
                    writeCreateJsonError(context, options, 'candidate-invalid', err.message, {
                        findings: err.findings,
                    });
                    context.setExitCode(1);
                } else {
                    writeCreateJsonError(context, options, 'batch-create-failed', String(err));
                    context.setExitCode(1);
                }
            } finally {
                if (tmpPath !== undefined) {
                    try {
                        await rm(tmpPath, { force: true });
                    } catch {
                        // Best-effort cleanup of the staged batch file; never masks the result.
                    }
                }
            }
        });
}
