/**
 * Lazy command registry and Commander program builder (PR-L, lazy CLI command loading).
 *
 * Every noun module is reached through a **string-literal** dynamic `import()` so that:
 * - an invocation loads only the module(s) its noun needs (`spur task show` never evaluates the
 *   workflow or history command graphs);
 * - `bun build --compile` still bundles every command into the single binary (Bun resolves
 *   string-literal dynamic imports from the bundled graph; variable specifiers would not be).
 *
 * Help output must stay byte-identical, so the registration order and options below are the
 * former eager `buildProgram()` body verbatim. Anything that could list or suggest sibling nouns
 * — root `--help`, bare `spur`, `spur help …`, an unknown noun, or any unexpected root option
 * before the noun — loads the full tree; only a recognised noun narrows the load.
 */

import { Command } from '@commander-js/extra-typings';
import { CLI_CONFIG } from './config';
import type { CliContext } from './context';
import type { CommandOutput } from './output';

/** Applies one registration step to the root program. */
type Apply = (program: Command, context: CliContext) => void;

/** One root-level registration step: the noun it serves and how to load its registrar. */
interface RegistrationStep {
    /** Top-level token that selects this step (`self` for the container, alias names for hidden aliases). */
    noun: string;
    load: () => Promise<Apply>;
}

/**
 * Root registration steps in help-listing order (the former eager registration sequence).
 * `self` is the visible home for the self-management verbs; the five legacy top-level nouns stay
 * registered over the same builders as hidden aliases so existing scripts and habits keep working.
 */
export const REGISTRATION_STEPS: readonly RegistrationStep[] = [
    {
        noun: 'agent',
        load: async () => {
            const { registerAgentCommand } = await import('./commands/agent');
            return (program, context) => registerAgentCommand(program, context);
        },
    },
    {
        noun: 'builder',
        load: async () => {
            const { registerBuilderCommand } = await import('./commands/builder');
            return (program, context) => registerBuilderCommand(program, context);
        },
    },
    {
        noun: 'decision',
        load: async () => {
            const { registerDecisionCommand } = await import('./commands/decision');
            return (program, context) => registerDecisionCommand(program, context);
        },
    },
    {
        noun: 'feature',
        load: async () => {
            const { registerFeatureCommand } = await import('./commands/feature');
            return (program, context) => registerFeatureCommand(program, context);
        },
    },
    {
        noun: 'history',
        load: async () => {
            const { registerHistoryCommand } = await import('./commands/history');
            return (program, context) => registerHistoryCommand(program, context);
        },
    },
    {
        noun: 'message',
        load: async () => {
            const { registerMessageCommand } = await import('./commands/message');
            return (program, context) => registerMessageCommand(program, context);
        },
    },
    {
        noun: 'projects',
        load: async () => {
            const { registerProjectsCommand } = await import('./commands/projects');
            return (program, context) => registerProjectsCommand(program, context);
        },
    },
    {
        noun: 'rule',
        load: async () => {
            const { registerRuleCommand } = await import('./commands/rule');
            return (program, context) => registerRuleCommand(program, context);
        },
    },
    {
        noun: 'self',
        load: async () => {
            const [init, maintain, migrate, serve, status, selfHook] = await Promise.all([
                import('./commands/init'),
                import('./commands/maintain'),
                import('./commands/migrate'),
                import('./commands/serve'),
                import('./commands/status'),
                import('./self-hook'),
            ]);
            return (program, context) => {
                const selfCommand = program.command('self').summary('inspect and manage the Spur installation itself');
                init.registerInitCommand(selfCommand, context);
                maintain.registerMaintainCommand(selfCommand, context);
                migrate.registerMigrateCommand(selfCommand, context);
                serve.registerServeCommand(selfCommand, context);
                status.registerStatusCommand(selfCommand, context);
                selfHook.registerSelfHookCommand(selfCommand, context);
            };
        },
    },
    {
        noun: 'init',
        load: async () => {
            const { registerInitCommand } = await import('./commands/init');
            return (program, context) => registerInitCommand(program, context, { hidden: true });
        },
    },
    {
        noun: 'maintain',
        load: async () => {
            const { registerMaintainCommand } = await import('./commands/maintain');
            return (program, context) => registerMaintainCommand(program, context, { hidden: true });
        },
    },
    {
        noun: 'migrate',
        load: async () => {
            const { registerMigrateCommand } = await import('./commands/migrate');
            return (program, context) => registerMigrateCommand(program, context, { hidden: true });
        },
    },
    {
        noun: 'serve',
        load: async () => {
            const { registerServeCommand } = await import('./commands/serve');
            return (program, context) => registerServeCommand(program, context, { hidden: true });
        },
    },
    {
        noun: 'status',
        load: async () => {
            const { registerStatusCommand } = await import('./commands/status');
            return (program, context) => registerStatusCommand(program, context, { hidden: true });
        },
    },
    {
        noun: 'task',
        load: async () => {
            const { registerTaskCommand } = await import('./commands/task');
            return (program, context) => registerTaskCommand(program, context);
        },
    },
    {
        noun: 'workflow',
        load: async () => {
            const { registerWorkflowCommand } = await import('./commands/workflow');
            return (program, context) => registerWorkflowCommand(program, context);
        },
    },
];

/** Root options that may precede the noun without widening the load (none takes a value). */
const NARROWING_ROOT_FLAGS = new Set(['--no-logo', '-v', '--cli-verbose']);

/**
 * The single registration step an argv needs, or `null` when the full tree must load.
 *
 * Narrowing is safe only when the first non-flag token is a known noun and every token before it
 * is a value-less root flag that cannot print root help (`--help`, `--version`, `--` and unknown
 * flags all widen). Root help, `help`, typos and unknown nouns therefore see every sibling exactly
 * as before.
 */
export function resolveRegistrationScope(argv: readonly string[]): string | null {
    for (const token of argv) {
        if (NARROWING_ROOT_FLAGS.has(token)) continue;
        if (token.startsWith('-')) return null;
        return REGISTRATION_STEPS.some((step) => step.noun === token) ? token : null;
    }
    return null;
}

/**
 * Build the Commander program. With `argv`, only the noun it invokes is loaded and registered
 * (see {@link resolveRegistrationScope}); without it, the full tree loads — the docs/help flag-set
 * parity test (task 0800 R3) walks that full tree, which is the same one root help renders.
 */
export async function buildProgram(
    context: CliContext,
    output: CommandOutput,
    argv?: readonly string[],
): Promise<Command> {
    const scope = argv === undefined ? null : resolveRegistrationScope(argv);
    const steps = scope === null ? REGISTRATION_STEPS : REGISTRATION_STEPS.filter((step) => step.noun === scope);
    const appliers = await Promise.all(steps.map((step) => step.load()));

    const program = createRootProgram(output);
    for (const apply of appliers) apply(program, context);
    return program;
}

/**
 * The root program with its global options and no nouns. Shared by {@link buildProgram} and the
 * boot-free `spur --version` fast path so both print the version through the same Commander path.
 */
export function createRootProgram(output: CommandOutput): Command {
    const program = new Command();
    program.name('spur').version(CLI_CONFIG.binaryVersion).exitOverride();
    program.configureOutput({
        writeOut: (str: string) => output.write(str),
        writeErr: (str: string) => output.error(str),
    });
    program.option('-v, --cli-verbose', 'Show internal diagnostics');
    // Global startup-decoration opt-out (A31/0719). Registered at the composition root so the
    // token is accepted before or after nested noun/verb tokens; runCli() consumes it via raw
    // argv, so this registration only owns help visibility and parse acceptance.
    program.option('--no-logo', 'Suppress the startup ASCII banner');
    return program;
}
