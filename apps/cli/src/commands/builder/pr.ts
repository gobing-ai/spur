/**
 * `spur builder pr <op>` — GitHub Codex PR-review loop transport (script-absorption PR-7).
 * Replaces plugins/sp/scripts/pr-reviewing.ts. Thin adapter over `@gobing-ai/spur-app/pr-review`:
 * Commander mounts the verb; the absorbed spine keeps its own argv parser and exit codes
 * (0 ok · 1 usage · 2 hard failure · 3 wait timeout).
 */
import type { Command } from '@commander-js/extra-typings';
import { PR_REVIEW_HELP, main as runPrReview } from '@gobing-ai/spur-app/pr-review';
import type { CliContext } from '../../context';

/** Register `spur builder pr` — pass-through to the absorbed pr-review spine. */
export function registerBuilderPrCommand(builder: Command, context: CliContext): void {
    builder
        .command('pr')
        .summary(
            'GitHub Codex PR-review loop (preflight | push | ensure | hygiene | request | wait | collect | status)',
        )
        .description(PR_REVIEW_HELP)
        .allowUnknownOption(true)
        .allowExcessArguments(true)
        .argument('[argv...]', 'subcommand and flags (see description)')
        .action((argv: string[]) => {
            context.setExitCode(
                runPrReview(
                    argv,
                    {
                        out: (line) => context.output.write(line),
                        err: (line) => context.output.error(line),
                    },
                    // 1215: run the spine's git/gh and relative status writes in the invocation cwd
                    // with the caller env — never the process-global cwd/env.
                    { cwd: context.cwd, env: context.env },
                ),
            );
        });
}
