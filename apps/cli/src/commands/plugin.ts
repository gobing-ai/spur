import type { Command } from '@commander-js/extra-typings';
import type { ModuleLoader } from '@gobing-ai/spur-app';
import { PluginService } from '@gobing-ai/spur-app';
import { PluginHost, type SpurEventMap } from '@gobing-ai/spur-plugin-sdk';
import { EventBus, getLogger } from '@gobing-ai/ts-infra';
import type { CliContext } from '../context';

function createPluginService(context: CliContext, loadModule?: ModuleLoader): PluginService {
    const logger = getLogger('spur:plugin');
    const bus = new EventBus<SpurEventMap>({});
    const host = new PluginHost(bus, { logger });

    return new PluginService({
        host,
        fs: context.fs,
        logger,
        projectRoot: context.cwd,
        loadModule,
    });
}

/** Register `spur plugin` commands. */
export function registerPluginCommand(program: Command, context: CliContext, loadModule?: ModuleLoader): void {
    const plugin = program.command('plugin').summary('inspect discovered plugins');

    // default verb: list
    plugin.action(async () => {
        const service = createPluginService(context, loadModule);
        try {
            const plugins = await service.list();
            if (plugins.length === 0) {
                context.output.write('No plugins loaded.');
            } else {
                for (const p of plugins) {
                    context.output.write(`${p.name}  ${p.version}  ${p.source}  ${p.status}`);
                }
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            context.output.error(msg);
            context.setExitCode(1);
        }
    });

    plugin
        .command('list')
        .description('List discovered and loaded plugins.')
        .option('--json', 'Output machine-readable JSON')
        .action(async (options) => {
            const service = createPluginService(context, loadModule);
            try {
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
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                context.output.error(msg);
                context.setExitCode(1);
            }
        });

    plugin
        .command('info')
        .description('Show manifest and status for a plugin.')
        .argument('<name>', 'Plugin name')
        .option('--json', 'Output machine-readable JSON')
        .action(async (name, options) => {
            const service = createPluginService(context, loadModule);
            try {
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
            } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                context.output.error(msg);
                context.setExitCode(1);
            }
        });
}
