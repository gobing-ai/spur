/**
 * `spur workflow summary` — the measured execution summary `/sp:dev-run` and `/sp:dev-runall`
 * print (per-stage time, wait, tool calls, tokens and the actor split), or the batch roll-up of
 * close-written summaries. Absorbed from the retired `plugins/sp/scripts/run-summary.ts`
 * (script-absorption PR-6). Thin adapter over `@gobing-ai/spur-app/run-summary-cli`.
 */
import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { writeStepText } from '../task/step-output';

const collect = (value: string, previous: string[] = []): string[] => [...previous, value];

/** Register `spur workflow summary`. */
export function registerWorkflowSummaryCommand(workflow: Command, context: CliContext): void {
    workflow
        .command('summary')
        .summary('Measured execution summary of workflow runs (or a batch roll-up)')
        .description(
            [
                'Measure one or more runs from `spur workflow progress <run-id> --json` files plus the host',
                'transcript (JSON, or a table with --markdown), OR roll up close-written',
                '.spur/run/<run>-summary.json files with --rollup. No transcript or no timed attempts → n/a, exit 0.',
                'Exit: 0 summary (or n/a), 2 usage error or unreadable input.',
            ].join('\n'),
        )
        .option('--progress <[label=]file>', 'progress JSON of a run (repeatable)', collect)
        .option(
            '--rollup <[label=]file>',
            'close-written <run>-summary.json (repeatable; excludes --progress)',
            collect,
        )
        .option('--transcript <path>', 'transcript JSONL path (default: the active host session)')
        .option('--since <iso>', 'measure from this instant')
        .option('--markdown', 'render the Markdown table instead of JSON')
        .action(async (options) => {
            const { runRunSummaryCli } = await import('@gobing-ai/spur-app/run-summary-cli');
            const argv: string[] = [];
            for (const p of options.progress ?? []) argv.push('--progress', p);
            for (const r of options.rollup ?? []) argv.push('--rollup', r);
            if (options.transcript !== undefined) argv.push('--transcript', options.transcript);
            if (options.since !== undefined) argv.push('--since', options.since);
            if (options.markdown === true) argv.push('--markdown');
            const code = runRunSummaryCli(argv, {
                env: context.env,
                cwd: context.cwd,
                write: (s) => writeStepText(context.output, 'stdout', s),
                writeErr: (s) => writeStepText(context.output, 'stderr', s),
            });
            context.setExitCode(code);
        });
}
