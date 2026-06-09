import type { Command } from '@commander-js/extra-typings';
import { type PluginListEntry, PluginService } from '@gobing-ai/spur-app';
import type { CliContext } from '../context';

/** Minimal plugin-service shape the command depends on — injectable for tests. */
export interface PluginServiceLike {
    list(): Promise<PluginListEntry[]>;
    info(name: string): Promise<PluginListEntry | null>;
}

/** Factory producing the plugin service. Defaults to the real (deferred) service. */
export type PluginServiceFactory = () => PluginServiceLike;

const defaultPluginServiceFactory: PluginServiceFactory = () => new PluginService();

/** Register `spur plugin` commands. */
export function registerPluginCommand(
    program: Command,
    context: CliContext,
    makeService: PluginServiceFactory = defaultPluginServiceFactory,
): void {
    const plugin = program.command('plugin').summary('inspect discovered plugins');

    // default verb: list
    plugin.action(async () => {
        const service = makeService();
        const plugins = await service.list();
        if (plugins.length === 0) {
            context.output.write('No plugins loaded.');
        } else {
            for (const p of plugins) {
                context.output.write(`${p.name}  ${p.version}  ${p.source}  ${p.status}`);
            }
        }
    });

    plugin
        .command('list')
        .description('List discovered and loaded plugins.')
        .option('--json', 'Output machine-readable JSON')
        .action(async (options) => {
            const service = makeService();
            const plugins = await service.list();
            if (options.json) {
                context.output.write(JSON.stringify(plugins, null, 2));
            } else if (plugins.length === 0) {
                context.output.write('No plugins loaded.');
            } else {
                for (const p of plugins) {
                    context.output.write(`${p.name}  ${p.version}  ${p.source}  ${p.status}`);
                }
            }
        });

    plugin
        .command('info')
        .description('Show manifest and status for a plugin.')
        .argument('<name>', 'Plugin name')
        .option('--json', 'Output machine-readable JSON')
        .action(async (name, options) => {
            const service = makeService();
            const info = await service.info(name);
            if (!info) {
                context.output.error(`Plugin '${name}' not found`);
                context.setExitCode(1);
                return;
            }
            if (options.json) {
                context.output.write(JSON.stringify(info, null, 2));
            } else {
                context.output.write(`Name:    ${info.name}`);
                context.output.write(`Version: ${info.version}`);
                context.output.write(`Source:  ${info.source}`);
                context.output.write(`Status:  ${info.status}`);
                context.output.write(`Path:    ${info.dir}`);
            }
        });
}
