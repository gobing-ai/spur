import { homedir } from 'node:os';
import type { Command } from '@commander-js/extra-typings';
import {
    type GatewayDaemonDeps,
    gatewayDaemonStatus,
    installGatewayDaemon,
    probeGatewayPort,
    uninstallGatewayDaemon,
} from '@gobing-ai/spur-app';
import { buildConfigFromEnv, getEnvVar, getEnvVars } from '@gobing-ai/spur-config';
import { createNodeFileSystem, NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import type { CliContext } from '../../context';
import { toJson } from '../../output';
import { resolveSpurArgv } from '../../workflow/resolve-spur-bin';
import { SHARED_OPTIONS } from '../shared-options';

/**
 * Register `spur self daemon <install|uninstall|status>` (feature K4 R9/R10, ADR-151 §7).
 *
 * Thin transport over `packages/app`'s daemon service: the plist bytes, the launchctl argv, the
 * platform/port refusals and the "nothing written on failure" rule all live there and are tested
 * with injected seams. This module resolves the host facts (uid, home, PATH, spur argv, port) and
 * maps outcomes to exit codes.
 */
export function registerDaemonCommand(
    self: Command,
    context: CliContext,
    /** Test seam: override the resolved host facts (platform, home, fs, exec, probe…). */
    overrides: Partial<GatewayDaemonDeps> = {},
): void {
    self.command('daemon')
        .summary('install, remove or inspect the macOS LaunchAgent that keeps the project gateway on')
        .argument('<action>', 'install | uninstall | status')
        .option(...SHARED_OPTIONS.portServe, Number.parseInt)
        .option(...SHARED_OPTIONS.json)
        .action(async (action: string, opts) => {
            const deps: GatewayDaemonDeps = {
                platform: process.platform,
                uid: typeof process.getuid === 'function' ? process.getuid() : 0,
                home: homedir(),
                path: getEnvVar('PATH') ?? '/usr/local/bin:/usr/bin:/bin',
                spurArgv: resolveSpurArgv(),
                port: opts.port ?? buildConfigFromEnv(getEnvVars()).server.gateway.port,
                exec: new NodeProcessExecutor(),
                fs: createNodeFileSystem(process.cwd()),
                probeGateway: probeGatewayPort,
                ...overrides,
            };

            try {
                if (action === 'install') {
                    const result = await installGatewayDaemon(deps);
                    context.output.write(
                        opts.json === true
                            ? toJson({ ok: true, action, ...result })
                            : `Gateway LaunchAgent ${result.status}: ${result.plistPath}`,
                    );
                    return;
                }
                if (action === 'uninstall') {
                    const result = await uninstallGatewayDaemon(deps);
                    context.output.write(
                        opts.json === true
                            ? toJson({ ok: true, action, ...result })
                            : result.status === 'removed'
                              ? `Gateway LaunchAgent removed: ${result.plistPath}`
                              : 'Gateway LaunchAgent was not installed.',
                    );
                    return;
                }
                if (action === 'status') {
                    const result = await gatewayDaemonStatus(deps);
                    if (opts.json === true) {
                        context.output.write(toJson({ ok: true, action, ...result }));
                        return;
                    }
                    if (!result.installed) {
                        context.output.write(`Gateway LaunchAgent is not installed (${result.plistPath}).`);
                        return;
                    }
                    context.output.write(`LaunchAgent: ${result.plistPath}`);
                    context.output.write(
                        `loaded: ${result.loaded}${result.pid === null ? '' : ` (pid ${result.pid})`}`,
                    );
                    if (result.lastExit !== null) context.output.write(`last exit: ${result.lastExit}`);
                    context.output.write(`gateway health: ${result.health === null ? 'unreachable' : 'ok'}`);
                    if (!result.binaryExists) {
                        context.output.write(
                            'warning: the plist points at a binary that no longer exists — re-run `spur self daemon install`',
                        );
                    }
                    return;
                }
                context.output.error(`Unknown daemon action "${action}": expected install, uninstall or status.`);
                context.setExitCode(2);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (opts.json === true) {
                    context.output.write(toJson({ ok: false, action, error: message }));
                } else {
                    context.output.error(`Error: ${message}`);
                }
                context.setExitCode(1);
            }
        });
}
