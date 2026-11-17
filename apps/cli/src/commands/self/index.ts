import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { registerInitCommand } from '../init';
import { registerMaintainCommand } from '../maintain';
import { registerMigrateCommand } from '../migrate';
import { registerServeCommand } from '../serve';
import { registerStatusCommand } from '../status';
import { registerDaemonCommand } from './daemon';
import { registerExecCommand } from './exec';
import { registerInstallCommand } from './install';
import { registerSearchCommand } from './search';
import { registerUninstallCommand } from './uninstall';

/**
 * Register every `spur self <verb>` on the `self` noun (folder-per-noun layout, like
 * `agent/` and `feature/`). The five legacy nouns stay registered as hidden top-level
 * aliases over the same builders in `src/index.ts`.
 *
 * The daemon lifecycle is flat: `install --daemon`, `uninstall` and `status`. The old
 * `spur self daemon <action>` spelling stays registered but hidden (deprecated alias).
 */
export function registerSelfCommand(self: Command, context: CliContext): void {
    registerDaemonCommand(self, context);
    registerExecCommand(self, context);
    registerInitCommand(self, context);
    registerInstallCommand(self, context);
    registerMaintainCommand(self, context);
    registerMigrateCommand(self, context);
    registerSearchCommand(self, context);
    registerServeCommand(self, context);
    registerStatusCommand(self, context);
    registerUninstallCommand(self, context);
}
