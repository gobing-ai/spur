/**
 * `spur history timeline` — per-prompt work time, wait time and tokens from the host transcript,
 * for the sp:session-review Time breakdown. Absorbed from the retired
 * `plugins/sp/scripts/session-timeline.ts` (script-absorption PR-6). Thin adapter over
 * `@gobing-ai/spur-app/session-timeline`.
 */
import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { writeStepText } from '../task/step-output';

/** Register `spur history timeline`. */
export function registerHistoryTimelineCommand(history: Command, context: CliContext): void {
    history
        .command('timeline')
        .summary('Per-prompt work/wait time and tokens from the host transcript (JSON)')
        .description(
            [
                'Read the active host transcript read-only (CLAUDE_CODE_SESSION_ID under ~/.claude/projects,',
                'PI_SESSION_FILE, or --transcript) and print one JSON timeline: a segment per operator prompt,',
                'optional --group stages, and totals. No transcript → {"available":false,...}, exit 0.',
                'Exit: 0 timeline (or unavailable), 2 invalid --group or unreadable transcript.',
            ].join('\n'),
        )
        .option('--transcript <path>', 'transcript JSONL path (default: the active host session)')
        .option('--group <spec>', 'sum segments into stages, e.g. "1-3,4"')
        .action(async (options) => {
            const { runSessionTimelineCli } = await import('@gobing-ai/spur-app/session-timeline');
            const argv: string[] = [];
            if (options.transcript !== undefined) argv.push('--transcript', options.transcript);
            if (options.group !== undefined) argv.push('--group', options.group);
            const code = runSessionTimelineCli(argv, {
                env: context.env,
                write: (s) => writeStepText(context.output, 'stdout', s),
                writeErr: (s) => writeStepText(context.output, 'stderr', s),
            });
            context.setExitCode(code);
        });
}
