import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { registerBuilderBumpVerCommand } from './bump-ver';
import { registerBuilderDropTagsCommand } from './drop-tags';
import { registerBuilderPrCommand } from './pr';
import { registerBuilderPublishCommand } from './publish';
import { registerBuilderShowBranchesCommand } from './show-branches';

/**
 * Register `spur builder` — release plumbing promoted from spur-dev (task 0617, ADR-051
 * amendment R5; charter extended by script-absorption Q1/Q5 for `pr` (PR-7) and `publish` /
 * `bump-ver --check` (PR-9), by feature-L1 operator consent for `show-branches` (task 1218), and
 * by task 1219 for the four flat `pr-<verb>` verbs that replace the `pr <op>` layer).
 * Verbs: `bump-ver`, `drop-tags`, `publish`, `show-branches`, `pr-status`, `pr-check`, `pr-open`,
 * `pr-review` (+ the hidden, deprecated `pr` alias).
 */
export function registerBuilderCommand(program: Command, context: CliContext): void {
    const noun = program
        .command('builder')
        .summary('release plumbing: version bumps, tags, branch topology, and PR-review ops');
    registerBuilderBumpVerCommand(noun, context);
    registerBuilderDropTagsCommand(noun, context);
    registerBuilderPublishCommand(noun, context);

    registerBuilderShowBranchesCommand(noun, context);
    registerBuilderPrCommand(noun, context);
}
