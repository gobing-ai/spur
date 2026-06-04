import type { ModuleLoader } from '@gobing-ai/spur-app';
import { PluginService } from '@gobing-ai/spur-app';
import { PluginHost } from '@gobing-ai/spur-plugin-sdk';
import { EventBus, getLogger } from '@gobing-ai/ts-infra';
import type { ParsedArgs } from '../args';
import type { CliContext } from '../context';

/** Render detailed usage for `spur plugin`. */
export function helpText(): string {
    return [
        'spur plugin - inspect discovered plugins',
        '',
        'Usage: spur plugin <command> [options]',
        '',
        'Commands:',
        '  list [--json]',
        '      List discovered and loaded plugins.',
        '  info <name> [--json]',
        '      Show manifest and status for a plugin.',
        '  help',
        '      Show this help.',
        '',
        'Options:',
        '  --name <name>       Plugin name for info',
        '  --json              Output machine-readable JSON',
        '  -h, --help          Show this help',
        '',
        'Examples:',
        '  spur plugin list',
        '  spur plugin info core',
    ].join('\n');
}

/**
 * CLI handler for `spur plugin <list|info>`.
 *
 * @param loadModule Optional mock module loader for tests (avoids worker threads from dynamic import).
 */
export async function runPluginCommand(
    subcommand: string | undefined,
    context: CliContext,
    flags: ParsedArgs['flags'],
    positionals: string[],
    loadModule?: ModuleLoader,
): Promise<number> {
    const logger = getLogger('spur:plugin');
    const bus = new EventBus({});
    const host = new PluginHost(bus, { logger });

    const service = new PluginService({
        host,
        fs: context.fs,
        logger,
        projectRoot: context.cwd,
        loadModule,
    });

    const json = flags.json === true;

    switch (subcommand ?? 'list') {
        case 'list': {
            try {
                const plugins = await service.list();
                if (json) {
                    context.output.write(JSON.stringify(plugins, null, 2));
                } else if (plugins.length === 0) {
                    context.output.write('No plugins loaded.');
                } else {
                    for (const p of plugins) {
                        context.output.write(`${p.name}  ${p.version}  ${p.source}  ${p.status}`);
                    }
                }
                return 0;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                context.output.error(msg);
                return 1;
            }
        }
        case 'info': {
            const name = (flags.name as string | undefined) ?? positionals[0];
            if (!name) {
                context.output.error('Usage: spur plugin info <name>');
                return 1;
            }
            try {
                const info = await service.info(name);
                if (!info) {
                    context.output.error(`Plugin '${name}' not found`);
                    return 1;
                }
                if (json) {
                    context.output.write(JSON.stringify(info, null, 2));
                } else {
                    context.output.write(`Name:    ${info.name}`);
                    context.output.write(`Version: ${info.version}`);
                    context.output.write(`Source:  ${info.source}`);
                    context.output.write(`Status:  ${info.status}`);
                    context.output.write(`Path:    ${info.dir}`);
                }
                return 0;
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                context.output.error(msg);
                return 1;
            }
        }
        default: {
            context.output.error(`Unknown plugin subcommand: ${subcommand}`);
            return 1;
        }
    }
}
