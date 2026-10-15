import type { Command } from '@commander-js/extra-typings';
import {
    loadSectionMatrix,
    resolvePlanningFolders,
    TaskCheckService,
    type TransitionCheckGate,
} from '@gobing-ai/spur-app';
import { EMBEDDED_SPUR_SCHEMAS } from '../../config/embedded-schemas';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeService, makeTaskLocator } from './shared';

/** Register `spur task record`. */
export function registerTaskRecordCommand(task: Command, context: CliContext): void {
    // ── record ──
    task.command('record')
        .summary('Record pipeline results into the task file — Testing, Review, and optional Solution backfill.')
        .argument('<wbs>', 'Task WBS number')
        .option('--verdict-file <path>', 'Path to verdict JSON (default: .spur/run/<wbs>-verdict.json)')
        .option('--solution-from-diff', 'Backfill Solution from git diff when bare')
        .option('--transition <status>', 'Optional lifecycle transition (e.g. testing)')
        .option(
            '--no-lifecycle',
            'Suppress lifecycle workflow run creation (use during pipeline runs to avoid orphaned lifecycle runs; the target-aware check gate still runs for --transition)',
        )
        .option(...SHARED_OPTIONS.folderTasks)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (wbs, options) => {
            const svc = await makeService(context, options.folder, options.lifecycle === false);
            try {
                // 0980: with `--no-lifecycle` no lifecycle FSM is built, so its target-aware
                // `spur task check --as <target>` YAML guard would be silently lost. Supply
                // the same inline structural gate the `update` command uses as its P3
                // backstop (task 0130) — TaskService.record runs it at the adapter guard's
                // timing (after the section writes, before the status write). Without the
                // flag, standalone record keeps its default: the adapter (when available)
                // owns the guard, unchanged.
                let checkGate: TransitionCheckGate | undefined;
                if (options.lifecycle === false && options.transition !== undefined) {
                    const planningFolders = await resolvePlanningFolders(context.fs);
                    checkGate = {
                        service: new TaskCheckService(
                            context.fs,
                            await loadSectionMatrix(context.cwd, { embeddedSchemas: EMBEDDED_SPUR_SCHEMAS }),
                            await makeTaskLocator(context),
                        ),
                        ...(planningFolders.severityOverrides !== undefined
                            ? { severityOverrides: planningFolders.severityOverrides }
                            : {}),
                    };
                }
                const result = await svc.record(wbs, {
                    verdictFile: options.verdictFile,
                    solutionFromDiff: options.solutionFromDiff === true,
                    transition: options.transition,
                    ...(checkGate !== undefined ? { checkGate } : {}),
                });
                // 0936 R1: scenario-key carry-forward warnings — loud on stderr in
                // both modes (stderr never pollutes the --json stdout payload, which
                // carries the same array on `scenarioWarnings`). Exit stays 0.
                for (const warning of result.scenarioWarnings ?? []) {
                    context.output.error(warning);
                }
                if (options.json) {
                    context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
                } else {
                    const parts: string[] = [];
                    if (result.testingWritten) parts.push('Testing written');
                    if (result.reviewWritten) parts.push('Review written');
                    if (result.solutionBackfilled) parts.push('Solution backfilled');
                    if (result.transitionedTo) parts.push(`${wbs} → ${result.transitionedTo}`);
                    // 1040 P3 review finding: parity with `task update` —
                    // surface a failed close-audit write instead of dropping it.
                    if (result.closeAuditError !== undefined) {
                        context.output.error(
                            `warning: failed to record done close audit fields: ${result.closeAuditError}`,
                        );
                    }
                    // 1047 R3: bookkeeping reconciliation failure — parity with the
                    // update warning; the JSON envelope carries `bookkeepingError`.
                    if (result.bookkeepingError !== undefined) {
                        context.output.error(
                            `warning: failed to reconcile task-lifecycle bookkeeping row: ${result.bookkeepingError} ` +
                                '(task file is committed; replay the same terminal transition to repair)',
                        );
                    }
                    // 1040 R1: verdict artifact state + remedy, verdict-first.
                    if (result.verdictMessage !== undefined) {
                        context.output.error(`ⓘ verdict artifact ${result.verdictState}: ${result.verdictMessage}`);
                    }
                    context.output.write(parts.join(', ') || 'no changes');
                }
            } catch (err) {
                writeJsonError(context.output, options, String(err));
                context.setExitCode(1);
            }
        });
}
