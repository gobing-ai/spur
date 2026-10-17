import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { registerInitCommand } from '../init';
import { registerMaintainCommand } from '../maintain';
import { registerMigrateCommand } from '../migrate';
import { registerServeCommand } from '../serve';
import { registerStatusCommand } from '../status';
import { registerExecCommand } from './exec';

/**
 * Register every `spur self <verb>` on the `self` noun (folder-per-noun layout, like
 * `agent/` and `feature/`). The five legacy nouns stay registered as hidden top-level
 * aliases over the same builders in `src/index.ts`.
 */
export function registerSelfCommand(self: Command, context: CliContext): void {
    registerExecCommand(self, context);
    registerInitCommand(self, context);
    registerMaintainCommand(self, context);
    registerMigrateCommand(self, context);
    registerServeCommand(self, context);
    registerStatusCommand(self, context);
}
