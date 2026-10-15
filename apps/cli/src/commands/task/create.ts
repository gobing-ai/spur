import type { Command } from '@commander-js/extra-typings';
import {
    DuplicateFollowUpError,
    ParentFeatureStatusError,
    prepareCreatedTaskReady,
    READY_SKIPPED,
    type ReadinessOutcome,
    TaskCandidateInvalidError,
    TaskPreparationError,
    WbsCollisionError,
} from '@gobing-ai/spur-app';
import { TASK_VARIANTS } from '@gobing-ai/spur-domain';
import type { CliContext } from '../../context';
import { toEnvelopeJson } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeCheckService, makeService, writeCreateJsonError } from './shared';

/** Register `spur task create`. */
export function registerTaskCreateCommand(task: Command, context: CliContext): void {
    // ── create ──
    task.command('create')
        .summary('Create a new task with race-safe WBS allocation.')
        .argument('<title>', 'Task title')
        .option(...SHARED_OPTIONS.featureTrace)
        .option('--parent <wbs>', 'Parent WBS for sub-task grouping')
        .option('--template <variant>', `Template variant (${TASK_VARIANTS.join('|')})`)
        .option('--no-reopen', "Do not reopen a 'verifying' parent feature to 'active'")
        .option(...SHARED_OPTIONS.folderTasks)
        .option(
            '--dedupe-within <seconds>',
            'Override the default dedup window (seconds). Guard is on (300s) by default when --feature is set.',
            Number,
        )
        .option('--allow-duplicate-name', 'Disable the dedup guard entirely (creates anyway)')
        .option('--skip-ready', 'Skip ready preparation (backlog capture only, no model dispatch)')
        .option('--agent <selector>', 'Agent used for ready preparation (defaults to the configured agent)')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (title, options) => {
            if (options.template !== undefined && !(TASK_VARIANTS as readonly string[]).includes(options.template)) {
                writeCreateJsonError(
                    context,
                    options,
                    'invalid-usage',
                    `Unknown template variant "${options.template}". Valid: ${TASK_VARIANTS.join(', ')}`,
                );
                context.setExitCode(2);
                return;
            }
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
            if (
                options.dedupeWithin !== undefined &&
                (!Number.isInteger(options.dedupeWithin) || options.dedupeWithin <= 0)
            ) {
                writeCreateJsonError(context, options, 'invalid-usage', '--dedupe-within must be a positive integer');
                context.setExitCode(2);
                return;
            }
            const svc = await makeService(context, options.folder);
            try {
                const result = await svc.create({
                    title,
                    featureId: options.feature,
                    parentWbs: options.parent,
                    template: options.template,
                    noReopen: options.reopen === false,
                    // Dedup guard: default 300s window for every create (feature-scoped
                    // or unscoped). Explicit --dedupe-within overrides the window.
                    // --allow-duplicate-name disables the guard entirely. Unscoped
                    // tasks have their own collision scope (no feature_id).
                    dedupeWithinSec: options.allowDuplicateName ? null : options.dedupeWithin,
                });
                // Ready-by-default (F21 task 0788, ADR-109): the capture is already
                // saved; prepare the SAME wbs in place — refine → deterministic
                // post-check → promotion. --skip-ready keeps the capture as-is.
                let readiness: ReadinessOutcome = READY_SKIPPED;
                if (options.skipReady !== true) {
                    const checkSvc = await makeCheckService(context);
                    readiness = await prepareCreatedTaskReady({
                        wbs: result.ref.id,
                        tasks: svc,
                        agents: context.agentService(),
                        checkTask: (filePath, wbs) => checkSvc.check(filePath, wbs, { asStatus: 'todo' }),
                        agentSelector: options.agent,
                        cwd: context.cwd,
                    });
                }
                if (options.json) {
                    // Additive top-level `wbs`/`filePath` mirror `ref.id`/`ref.filePath`
                    // (task 0510 post-mortem): the envelope's WBS lives under `ref.id`,
                    // which differs from `task list/show --json` (`wbs`), and a script
                    // projecting `wbs` saw nulls and misread success as failure.
                    context.output.write(
                        toEnvelopeJson(
                            { ...result, wbs: result.ref.id, filePath: result.ref.filePath, ...readiness },
                            { enveloped: options.jsonEnvelope },
                        ),
                    );
                } else {
                    context.output.write(`Created task ${result.ref.id}: ${result.ref.filePath}`);
                    if (readiness.readiness.status === 'ready') {
                        context.output.write(
                            `Ready: checklist + post-check passed (${result.ref.id} promoted to todo)`,
                        );
                    }
                }
            } catch (err) {
                if (err instanceof WbsCollisionError) {
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
                } else if (err instanceof DuplicateFollowUpError) {
                    if (options.json) {
                        context.output.write(
                            toEnvelopeJson(
                                {
                                    ok: false,
                                    error: {
                                        code: 'duplicate-follow-up',
                                        message: err.message,
                                        existingWbs: err.existingWbs,
                                        existingName: err.existingName,
                                        attemptedName: err.attemptedName,
                                    },
                                },
                                {
                                    enveloped: options.jsonEnvelope,
                                    error: {
                                        code: 'INTERNAL_ERROR',
                                        message: err.message,
                                        details: {
                                            cliCode: 'duplicate-follow-up',
                                            existingWbs: err.existingWbs,
                                            existingName: err.existingName,
                                            attemptedName: err.attemptedName,
                                        },
                                    },
                                },
                            ),
                        );
                    } else {
                        context.output.error(err.message);
                    }
                    context.setExitCode(3);
                } else if (err instanceof ParentFeatureStatusError) {
                    writeCreateJsonError(context, options, 'parent-feature-status', err.message, {
                        featureId: err.featureId,
                        status: err.status,
                        activeSiblings: err.activeSiblings,
                    });
                    context.setExitCode(1);
                } else if (err instanceof TaskCandidateInvalidError) {
                    // F21 task 0787 (R4): invalid candidate input → ONE parseable
                    // `--json` error (raw or enveloped) carrying the checker
                    // findings; exit 1 (usage errors are 2, collision/dedupe 3).
                    writeCreateJsonError(context, options, 'candidate-invalid', err.message, {
                        findings: err.findings,
                    });
                    context.setExitCode(1);
                } else if (err instanceof TaskPreparationError) {
                    // F21 task 0788 (R5): preparation failure preserves the task
                    // (never deleted, partial sections intact). ONE parseable --json
                    // error carries the failed stage, task identity and the exact
                    // recovery command; exit 1 (collision/dedupe stay 3). Raw mode
                    // appends the recovery hint to the bare stderr line.
                    const message =
                        !options.json && err.recoveryCommand !== undefined
                            ? `${err.message}\nRecover with: ${err.recoveryCommand}`
                            : err.message;
                    writeCreateJsonError(context, options, 'preparation-failed', message, {
                        wbs: err.wbs,
                        filePath: err.filePath,
                        failedStage: err.stage,
                        ...(err.recoveryCommand !== undefined ? { recoveryCommand: err.recoveryCommand } : {}),
                        ...(err.findings !== undefined ? { findings: err.findings } : {}),
                        readiness: { status: 'failed', depth: 'ready' },
                    });
                    context.setExitCode(1);
                } else {
                    writeCreateJsonError(context, options, 'create-failed', String(err));
                    context.setExitCode(1);
                }
            }
        });
}
