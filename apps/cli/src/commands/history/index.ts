import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { registerHistoryAnalyzeCommand } from './analyze';
import { registerHistoryAnatomyCommand } from './anatomy';
import { registerHistoryDailyCommand } from './daily';
import { registerHistoryImportCommand } from './import';
import { registerHistoryReportCommand } from './report';
import { registerHistoryResetCommand } from './reset';
import { registerHistorySummaryCommand } from './summary';
import { registerHistoryTimelineCommand } from './timeline';

export { parseCapabilityOriginSpec, parseTopOrThrow, resolveImportProvenance } from './shared';

/** Register `spur history` commands. */
export function registerHistoryCommand(program: Command, context: CliContext): void {
    const noun = program.command('history').summary('import and analyze coding-agent history');
    registerHistoryImportCommand(noun, context);
    registerHistoryAnalyzeCommand(noun, context);
    registerHistoryResetCommand(noun, context);
    registerHistoryReportCommand(noun, context);
    registerHistoryDailyCommand(noun, context);

    // Read-outs absorbed from the plugin scripts (script-absorption PR-6).
    registerHistoryAnatomyCommand(noun, context);
    registerHistoryTimelineCommand(noun, context);
    registerHistorySummaryCommand(noun, context);
}
