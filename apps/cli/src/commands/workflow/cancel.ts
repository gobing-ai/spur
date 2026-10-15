import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeWorkflowService } from './shared';

/** Register `spur workflow cancel`. */
export function registerWorkflowCancelCommand(workflow: Command, context: CliContext): void {
    workflow
        .command('cancel')
        .description(
            'Cancel a single non-terminal run by id (mark as failed). The bulk/stale variant is `spur workflow clean`.',
        )
        .argument('<run-id>', 'Run id to cancel')
        .option(...SHARED_OPTIONS.jsonSupported)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (runId, options) => {
            const result = await makeWorkflowService(context, options.json).cancel(runId);
            if (options.json) {
                context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
                return;
            }
            if (result.status === 'not_found') {
                writeJsonError(context.output, options, `Run ${runId} not found.`, 'NOT_FOUND');
                context.setExitCode(1);
                return;
            }
            if (result.finalized) {
                const killNote = result.killed ? ' + signalled worker process group' : '';
                context.output.write(`Cancelled run ${runId} (marked failed${killNote}).`);
            } else {
                context.output.write(`Run ${runId} already terminal (${result.status}) — no change.`);
            }
        });
}
