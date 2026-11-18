import type { Command } from '@commander-js/extra-typings';
import { type GatewayDaemonDeps, INSTALL_TOOLS, type InstallTool, installSelf } from '@gobing-ai/spur-app';
import type { CliContext } from '../../context';
import { toEnvelopeJson, toJson } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { runDaemonAction } from './shared';

/** Usage exit code for an unknown `--with` value, distinct from a failed step (A93 1353 R1). */
const EXIT_USAGE = 2;

/**
 * `spur self install [--with <tool>]... [--daemon] [--json] [--json-envelope]` — machine setup.
 *
 * Flat verb, no mode operand: bare invocation converges Spur's machine-owned seeds and reports the
 * optional tools it did not touch; each `--with` additionally performs that tool's network or
 * package-manager work. Project scaffolding stays `spur self init`, SQL stays `spur self migrate`,
 * and the first-binary download stays `scripts/install.sh`.
 */
export function registerInstallCommand(
    self: Command,
    context: CliContext,
    /** Test seam for the `--daemon` hop: override the resolved host facts. */
    daemonOverrides: Partial<GatewayDaemonDeps> = {},
): void {
    self.command('install')
        .summary('converge machine-wide Spur setup (global rules/config, optional tools)')
        .description(
            'Copy the shipped global rules and config into the machine config root (never overwriting existing files) and report optional tool readiness. Repeat --with to also install an optional tool: zg, a2a, or the sp plugin adapters (delegated to superskill).',
        )
        .option(
            '--with <tool>',
            `also set up an optional tool (${INSTALL_TOOLS.join('|')}); repeatable`,
            (value: string, previous: string[]) => [...previous, value],
            [] as string[],
        )
        .option('--daemon', 'also install the macOS LaunchAgent that keeps the project gateway on')
        .option(...SHARED_OPTIONS.portServe, Number.parseInt)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            const requested = options.with ?? [];
            const unknown = requested.filter((value) => !(INSTALL_TOOLS as readonly string[]).includes(value));
            if (unknown.length > 0) {
                // Usage errors exit before any mutation: nothing is seeded or installed.
                const message = `unknown --with value(s): ${unknown.join(', ')}; valid: ${INSTALL_TOOLS.join(', ')}`;
                if (options.json === true) context.output.write(toJson({ error: { code: 'usage', message } }));
                else context.output.error(message);
                context.setExitCode(EXIT_USAGE);
                return;
            }

            const report = await installSelf(
                { cwd: context.cwd, env: context.env, fs: context.fs },
                { tools: dedupe(requested as InstallTool[]) },
            );

            if (options.json === true) {
                context.output.write(toEnvelopeJson(report, { enveloped: options.jsonEnvelope }));
            } else {
                const lines = report.steps.map(
                    (step) =>
                        `${step.name}\t${step.state}${step.required ? '\trequired' : ''}${
                            step.message === '' ? '' : `\t${step.message}`
                        }`,
                );
                lines.push(report.changed ? 'changed' : 'no changes', report.ok ? 'ok' : 'failed');
                context.output.write(lines.join('\n'));
            }
            if (options.daemon !== true) {
                context.setExitCode(report.ok ? 0 : 1);
                return;
            }
            // The daemon hop is additive and independent: a failed setup does not skip it, an
            // installed LaunchAgent does not rescue a failed setup — both exit codes are reported.
            const { exitCode } = await runDaemonAction(
                'install',
                context,
                { port: options.port, json: options.json === true },
                daemonOverrides,
            );
            if (!report.ok || exitCode !== 0) context.setExitCode(1);
        });
}

/** Collapse repeated `--with` values while keeping the caller's order. */
function dedupe(tools: InstallTool[]): InstallTool[] {
    return [...new Set(tools)];
}
