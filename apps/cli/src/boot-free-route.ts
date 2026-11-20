import type { Command } from '@commander-js/extra-typings';

type BootFreeMode = 'bare' | 'config' | 'status' | 'migration-check';
const bootFreeModes = new WeakMap<object, BootFreeMode>();

/** Mark the registered command that can run before the CLI opens its database. */
export function bootFree<T extends object>(command: T, mode: BootFreeMode = 'bare'): T {
    bootFreeModes.set(command, mode);
    return command;
}

/** Read the policy from the same command tree that will parse the invocation. */
export function bootFreeMode(program: Command, argv: readonly string[]): BootFreeMode | undefined {
    const [noun, verb] = argv.filter((token) => !['--no-logo', '--cli-verbose', '-v'].includes(token));
    const target = program.commands.find(
        (command) => command.name() === noun || command.aliases().includes(noun ?? ''),
    );
    if (!target) return undefined;
    const leaf =
        target.commands.find((command) => command.name() === verb || command.aliases().includes(verb ?? '')) ?? target;
    const mode = bootFreeModes.get(leaf);
    return mode === 'migration-check' && !argv.includes('--check') ? undefined : mode;
}
