/**
 * `spur history summary` — the sp:daily-summary report: token usage (ccusage), git activity, the
 * day's history health and operator annotations, written to `docs/daily/summary_<date>.md`.
 * Absorbed from the retired `plugins/sp/scripts/daily-summary/daily-summary.ts`
 * (script-absorption PR-6). Thin adapter over `@gobing-ai/spur-app/daily-summary`.
 */
import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';

/** Register `spur history summary`. */
export function registerHistorySummaryCommand(history: Command, context: CliContext): void {
    history
        .command('summary')
        .summary('Daily summary report: tokens, git activity, history health, annotations')
        .description(
            [
                'Generate the day’s Markdown summary and write it to docs/daily/summary_<YYYYMMDD>.md',
                '(or --output). Prompts for learnings / issues / pending unless SP_DAILY_SUMMARY_NO_PROMPT=1',
                '(non-TTY stdin supplies the three answers as lines). Exit: 0 written, 1 generation failed.',
            ].join('\n'),
        )
        .option('--date <date>', 'YYYY-MM-DD, today or yesterday (default: today)')
        .option('--dry-run', 'print the summary without writing the file')
        .option('--output <path>', 'write to a custom path')
        .option('--no-git', 'skip git history collection')
        .option('--no-ccusage', 'skip token usage collection')
        .action(async (options) => {
            const { main } = await import('@gobing-ai/spur-app/daily-summary');
            const argv: string[] = [];
            if (options.date !== undefined) argv.push('--date', options.date);
            if (options.dryRun === true) argv.push('--dry-run');
            if (options.output !== undefined) argv.push('--output', options.output);
            if (options.git === false) argv.push('--no-git');
            if (options.ccusage === false) argv.push('--no-ccusage');
            const code = await main(argv, {
                out: (line) => context.output.write(line),
                err: (line) => context.output.error(line),
            });
            context.setExitCode(code);
        });
}
