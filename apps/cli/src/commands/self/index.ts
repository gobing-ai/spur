import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { registerExecCommand } from './exec';
import { registerInitCommand } from './init';
import { registerInstallCommand } from './install';
import { registerMaintainCommand } from './maintain';
import { registerMigrateCommand } from './migrate';
import { registerSearchCommand } from './search';
import { type RegisterServeOptions, registerServeCommand } from './serve';
import { registerStatusCommand } from './status';
import { registerUninstallCommand } from './uninstall';

/**
 * Register every `spur self <verb>` on the `self` noun.
 *
 * The daemon lifecycle is flat: `install --daemon`, `uninstall` and `status`. The old
 * `spur self daemon <action>` alias is gone (task 1387): one spelling per action.
 */
export function registerSelfCommand(self: Command, context: CliContext, serve?: RegisterServeOptions): void {
    registerExecCommand(self, context);
    registerInitCommand(self, context);
    registerInstallCommand(self, context);
    registerMaintainCommand(self, context);
    registerMigrateCommand(self, context);
    registerSearchCommand(self, context);
    registerServeCommand(self, context, serve);
    registerStatusCommand(self, context);
    registerUninstallCommand(self, context);
}
