import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { registerMessageInboxCommand } from './inbox';
import { registerMessageReadCommand } from './read';
import { registerMessageReplyCommand } from './reply';
import { registerMessageSendCommand } from './send';
import { registerMessageShowCommand } from './show';
import { registerMessageWatchCommand } from './watch';

// The noun is a folder now (`docs/03_ARCHITECTURE.md` § noun layout); these stay exported from its
// entry so callers and tests keep importing `commands/message`.
export { parseInterval } from './shared';
export { defaultSleep, runMessageWatch, type WatchOptions, type WatchOutput, type WatchRuntime } from './watch';

/** Register `spur message` commands. */
export function registerMessageCommand(program: Command, context: CliContext): void {
    const noun = program.command('message').summary('send and inspect durable inter-agent messages');
    registerMessageSendCommand(noun, context);
    registerMessageInboxCommand(noun, context);
    registerMessageShowCommand(noun, context);
    registerMessageReadCommand(noun, context);
    registerMessageReplyCommand(noun, context);
    registerMessageWatchCommand(noun, context);
}
