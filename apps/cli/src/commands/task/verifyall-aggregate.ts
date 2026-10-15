import type { Command } from '@commander-js/extra-typings';
import { aggregateBatchVerdicts } from '@gobing-ai/spur-app';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';

/** Register `spur task verifyall-aggregate`. */
export function registerTaskVerifyallAggregateCommand(task: Command, context: CliContext): void {
    // ── verifyall-aggregate ──
    task.command('verifyall-aggregate')
        .summary('Aggregate per-task verify outcomes into a deterministic batch verdict (verifyall).')
        .description(
            'Reads a JSON array of per-task outcomes ({wbs,outcome}) and emits the batch ' +
                'verdict with NOT-STARTED tasks excluded from the rollup. Replaces agent-discretion ' +
                'rollup prose (dev-operations.md §3a) with deterministic code (task 0341).',
        )
        .option(...SHARED_OPTIONS.fromFileOutcomeRows)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            const inputPath = options.fromFile ?? '.spur/run/verifyall-batch-input.json';
            let raw: string;
            try {
                raw = await context.fs.readFile(context.fs.resolve(inputPath));
            } catch {
                writeJsonError(context.output, options, `Batch input file not found: ${inputPath}`);
                context.setExitCode(1);
                return;
            }

            let rows: Array<{ wbs: string; outcome: string; reason?: string }>;
            try {
                const parsed: unknown = JSON.parse(raw);
                if (!Array.isArray(parsed)) {
                    throw new Error('expected a JSON array');
                }
                rows = parsed;
            } catch (err) {
                writeJsonError(context.output, options, `Invalid batch input JSON: ${String(err)}`);
                context.setExitCode(1);
                return;
            }

            const results = rows.map((r) => {
                const outcome = r.outcome.toUpperCase();
                if (!['PASS', 'PARTIAL', 'FAIL', 'NOT-STARTED', 'UNKNOWN'].includes(outcome)) {
                    throw new Error(`Invalid outcome for ${r.wbs}: ${r.outcome}`);
                }
                return {
                    wbs: r.wbs,
                    outcome: outcome as 'PASS' | 'PARTIAL' | 'FAIL' | 'NOT-STARTED' | 'UNKNOWN',
                    reason: r.reason,
                };
            });

            const aggregation = aggregateBatchVerdicts(results);

            if (options.json) {
                context.output.write(toEnvelopeJson(aggregation, { enveloped: options.jsonEnvelope }));
            } else {
                context.output.write(`Batch verdict: ${aggregation.verdict}`);
                context.output.write(aggregation.summary);
                if (aggregation.notStarted.length > 0) {
                    context.output.write(
                        `NOT-STARTED (excluded from rollup): ${aggregation.notStarted.map((r) => r.wbs).join(', ')}`,
                    );
                }
            }

            if (aggregation.verdict === 'FAIL') {
                context.setExitCode(1);
            }
        });
}
