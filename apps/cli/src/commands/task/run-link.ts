import type { Command } from '@commander-js/extra-typings';
import { ensurePipelineRunLink } from '@gobing-ai/spur-app';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';

/** Register `spur task run-link`. */
export function registerTaskRunLinkCommand(task: Command, context: CliContext): void {
    // ── run-link ──
    task.command('run-link')
        .summary(
            'Record a pipeline provenance link for a task (used by --next auto chains to satisfy testing→done guard).',
        )
        .argument('<wbs>', 'Task WBS number')
        .option(...SHARED_OPTIONS.sourceLink, 'chain')
        .option(...SHARED_OPTIONS.runIdTask)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (wbs, options) => {
            try {
                const db = await context.getDb();
                // Shared helper with TaskService.record (task 0436 residual — single owner).
                const ensured = await ensurePipelineRunLink(db, wbs, {
                    runId: options.runId ?? `chain:${options.source}:${wbs}:${Date.now()}`,
                });
                const result = {
                    id: ensured.id,
                    wbs: ensured.wbs,
                    runId: ensured.runId,
                    kind: ensured.kind,
                    existed: !ensured.created,
                };
                if (options.json) {
                    context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
                } else if (ensured.created) {
                    context.output.write(
                        `Recorded pipeline run-link ${ensured.id} for task ${wbs} (source: ${options.source})`,
                    );
                } else {
                    context.output.write(`Pipeline run-link already exists for ${wbs} (${ensured.id}). Skipped.`);
                }
            } catch (err) {
                writeJsonError(context.output, options, String(err));
                context.setExitCode(1);
            }
        });
}
