import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import {
    registerBuilderArtifactCommands,
    registerBuilderBuildBinariesCommand,
    registerBuilderBuildCliCommand,
    registerBuilderBuildServerCommand,
    registerBuilderCheckDepsCommand,
} from './build';
import { registerBuilderBumpVerCommand } from './bump-ver';
import { registerBuilderDropTagsCommand } from './drop-tags';
import { registerBuilderPrCommand } from './pr';
import { registerBuilderPublishCommand } from './publish';
import { registerBuilderShowBranchesCommand } from './show-branches';

/**
 * Register `spur builder` — release plumbing promoted from spur-dev (task 0617, ADR-051
 * amendment R5; charter extended by script-absorption Q1/Q5 for `pr` (PR-7) and `publish` /
 * `bump-ver --check` (PR-9), by feature-A951 operator consent for `show-branches` (task 1218), and
 * by task 1219 for the four flat `pr-<verb>` verbs that replace the `pr <op>` layer).
 * Verbs: `build-cli`, `build-server`, `build-binaries`, `bump-ver`, `drop-tags`, `publish`,
 * `show-branches`, `pr-status`, `pr-check`, `pr-open`, `pr-review` (+ the hidden, deprecated `pr`
 * alias), the artifact verbs absorbed from the repository scripts in A93 1354 and A94 1410
 * (`bundle-*`, `emit-*`, `verify-pack`), and `check-deps` (A94 1411: stale linked dist + drift).
 */
export function registerBuilderCommand(program: Command, context: CliContext): void {
    const noun = program
        .command('builder')
        .summary('release plumbing: version bumps, tags, branch topology, and PR-review ops');
    registerBuilderBuildCliCommand(noun, context);
    registerBuilderArtifactCommands(noun, context);
    registerBuilderBuildServerCommand(noun, context);
    registerBuilderBuildBinariesCommand(noun, context);
    registerBuilderCheckDepsCommand(noun, context);
    registerBuilderBumpVerCommand(noun, context);
    registerBuilderDropTagsCommand(noun, context);
    registerBuilderPublishCommand(noun, context);

    registerBuilderShowBranchesCommand(noun, context);
    registerBuilderPrCommand(noun, context);
}
