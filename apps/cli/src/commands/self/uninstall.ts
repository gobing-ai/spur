import type { Command } from '@commander-js/extra-typings';
import { type GatewayDaemonDeps, uninstallGatewayDaemon } from '@gobing-ai/spur-app';
import type { CliContext } from '../../context';
import { toEnvelopeJson } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { resolveDaemonDeps } from './daemon';

/**
 * `spur self uninstall [--daemon] [--json] [--json-envelope]` — reverse a machine-level install.
 *
 * The gateway LaunchAgent is the only machine artifact this CLI owns, so it is the default target;
 * `--daemon` names it explicitly for scripts. Uninstalling the CLI binary itself stays a package
 * manager action (`bun remove -g @gobing-ai/spur`), and project scaffolding is never touched here.
 */
export function registerUninstallCommand(
    self: Command,
    context: CliContext,
    /** Test seam: override the resolved host facts (platform, home, fs, exec, probe…). */
    overrides: Partial<GatewayDaemonDeps> = {},
): void {
    self.command('uninstall')
        .summary('remove the machine-level artifacts Spur installed (the gateway LaunchAgent)')
        .description(
            'Remove the macOS user LaunchAgent that keeps the project gateway on. The CLI binary itself is removed by your package manager, and project files are never touched. `--daemon` names the target explicitly.',
        )
        .option('--daemon', 'remove the gateway LaunchAgent (the default target)')
        .option(...SHARED_OPTIONS.portServe, Number.parseInt)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            try {
                const result = await uninstallGatewayDaemon(resolveDaemonDeps(options.port, overrides));
                if (options.json === true) {
                    context.output.write(
                        toEnvelopeJson(
                            { ok: true, action: 'uninstall', ...result },
                            { enveloped: options.jsonEnvelope },
                        ),
                    );
                    return;
                }
                context.output.write(
                    result.status === 'removed'
                        ? `Gateway LaunchAgent removed: ${result.plistPath}`
                        : 'Gateway LaunchAgent was not installed.',
                );
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                if (options.json === true) {
                    context.output.write(
                        toEnvelopeJson(
                            { ok: false, action: 'uninstall', error: message },
                            {
                                enveloped: options.jsonEnvelope,
                                error: { code: 'INTERNAL_ERROR', message },
                            },
                        ),
                    );
                } else {
                    context.output.error(`Error: ${message}`);
                }
                context.setExitCode(1);
            }
        });
}
