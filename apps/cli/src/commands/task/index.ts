import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { registerTaskBatchCreateCommand } from './batch-create';
import { registerTaskCheckCommand } from './check';
import { registerTaskCreateCommand } from './create';
import { registerTaskDepsCommand } from './deps';
import { registerTaskListCommand } from './list';
import { registerTaskMigrateCommand } from './migrate';
import { registerTaskMigrateAnchorsCommand } from './migrate-anchors';
import { registerTaskPathCommand } from './path';
import { registerTaskRecordCommand } from './record';
import { registerTaskRefreshCommand } from './refresh';
import { registerTaskRefreshRosterCommand } from './refresh-roster';
import { registerTaskResolveCommand } from './resolve';
import { registerTaskRunLinkCommand } from './run-link';
import { registerTaskScaffoldTestsCommand } from './scaffold-tests';
import { registerTaskSectionsCommand } from './sections';
import { registerTaskShowCommand } from './show';
import { registerTaskUpdateCommand } from './update';
import { registerTaskVerdictCommand } from './verdict';
import { registerTaskVerifyallAggregateCommand } from './verifyall-aggregate';

/** Register the `spur task` command and its subcommands on the CLI program. */
export function registerTaskCommand(program: Command, context: CliContext): void {
    const task = program.command('task').summary('manage tasks');
    registerTaskCreateCommand(task, context);
    registerTaskShowCommand(task, context);
    registerTaskUpdateCommand(task, context);
    registerTaskDepsCommand(task, context);
    registerTaskSectionsCommand(task, context);
    registerTaskListCommand(task, context);
    registerTaskRefreshCommand(task, context);
    registerTaskMigrateCommand(task, context);
    registerTaskMigrateAnchorsCommand(task, context);
    registerTaskRefreshRosterCommand(task, context);
    registerTaskBatchCreateCommand(task, context);
    registerTaskRecordCommand(task, context);
    registerTaskVerdictCommand(task, context);
    registerTaskVerifyallAggregateCommand(task, context);
    registerTaskCheckCommand(task, context);
    registerTaskResolveCommand(task, context);
    registerTaskPathCommand(task, context);
    registerTaskRunLinkCommand(task, context);
    registerTaskScaffoldTestsCommand(task, context);
}

export { makeCheckService, makeService, makeTaskLocator } from './shared';
