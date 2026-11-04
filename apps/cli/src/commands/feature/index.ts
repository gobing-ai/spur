import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { registerFeatureAdvanceCommand } from './advance';
import { registerFeatureCheckCommand } from './check';
import { registerFeatureCreateCommand } from './create';
import { registerFeatureHandoffCommand } from './handoff';
import { registerFeatureListCommand } from './list';
import { registerFeatureMoveCommand } from './move';
import { registerFeatureRefreshCommand } from './refresh';
import { registerFeatureShowCommand } from './show';
import { registerFeatureSyncCommand } from './sync';
import { registerFeatureUpdateCommand } from './update';
import { registerFeatureVerifyCommand } from './verify';

/** Register the `spur feature` command and its subcommands on the CLI program. */
export function registerFeatureCommand(program: Command, context: CliContext): void {
    const feature = program.command('feature').summary('manage features (hierarchical IDs)');
    registerFeatureCreateCommand(feature, context);
    registerFeatureShowCommand(feature, context);
    registerFeatureUpdateCommand(feature, context);
    registerFeatureAdvanceCommand(feature, context);
    registerFeatureListCommand(feature, context);
    registerFeatureMoveCommand(feature, context);
    registerFeatureRefreshCommand(feature, context);
    registerFeatureCheckCommand(feature, context);
    registerFeatureSyncCommand(feature, context);

    // ── verify / handoff (script-absorption PR-5: feature-verification-steps, idea-handoff) ──
    registerFeatureVerifyCommand(feature, context);
    registerFeatureHandoffCommand(feature, context);
}
