import { homedir } from 'node:os';
import {
    type GatewayDaemonDeps,
    type GatewayStatusResult,
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

/** The three daemon operations, hosted by `install --daemon`, `uninstall` and `status`. */
export type DaemonAction = 'install' | 'uninstall' | 'status';

/**
 * Resolve the host facts the daemon service needs (feature K4 R9/R10, ADR-151 §7).
 *
 * The plist bytes, the launchctl argv, the platform/port refusals and the "nothing written on
 * failure" rule all live in `packages/app`; this module only supplies the machine facts.
 */
export function resolveDaemonDeps(
    port: number | undefined,
    overrides: Partial<GatewayDaemonDeps> = {},
): GatewayDaemonDeps {
    // `SPUR_GATEWAY_ALLOWED_HOSTS` reaches the gateway only through this env-derived config, so the
    // installer has to bake it into the plist or the public hostnames stay refused with 421.
    const config = buildConfigFromEnv(getEnvVars());
    return {
        platform: process.platform,
        uid: typeof process.getuid === 'function' ? process.getuid() : 0,
        home: homedir(),
        path: getEnvVar('PATH') ?? '/usr/local/bin:/usr/bin:/bin',
        spurArgv: resolveSpurArgv(),
        port: port ?? config.server.gateway.port,
        allowedHosts: config.server.gateway.allowedHosts,
        exec: new NodeProcessExecutor(),
        fs: createNodeFileSystem(process.cwd()),
        probeGateway: probeGatewayPort,
        ...overrides,
    };
}

/**
 * Read the daemon's machine state without rendering anything.
 *
 * `spur self status` embeds this value in its own aggregate, so the reader must not write — a
 * second JSON document on stdout would corrupt that command's output.
 */
export async function readDaemonStatus(overrides: Partial<GatewayDaemonDeps> = {}): Promise<GatewayStatusResult> {
    return gatewayDaemonStatus(resolveDaemonDeps(undefined, overrides));
}

/**
 * Best-effort daemon probe for the `status` aggregate: null off macOS or when the reader fails, so
 * advisory machine state can never fail a readiness report. `platform` is injectable so the guard
 * and the degradation path are covered by host-independent tests (Linux CI cannot reach darwin).
 */
export async function readDaemonStatusOrNull(
    platform: NodeJS.Platform = process.platform,
    overrides: Partial<GatewayDaemonDeps> = {},
): Promise<GatewayStatusResult | null> {
    if (platform !== 'darwin') return null;
    try {
        return await readDaemonStatus(overrides);
    } catch {
        return null;
    }
}

/** Run one daemon operation and render it. Returns the exit code for the caller to set. */
export async function runDaemonAction(
    action: DaemonAction,
    context: Pick<CliContext, 'output'>,
    options: { port?: number; json?: boolean },
    overrides: Partial<GatewayDaemonDeps> = {},
): Promise<{ exitCode: number; result?: GatewayStatusResult }> {
    const deps = resolveDaemonDeps(options.port, overrides);
    try {
        if (action === 'install') {
            const result = await installGatewayDaemon(deps);
            context.output.write(
                options.json === true
                    ? toJson({ ok: true, action, ...result })
                    : `Gateway LaunchAgent ${result.status}: ${result.plistPath}`,
            );
            return { exitCode: 0 };
        }
        if (action === 'uninstall') {
            const result = await uninstallGatewayDaemon(deps);
            context.output.write(
                options.json === true
                    ? toJson({ ok: true, action, ...result })
                    : result.status === 'removed'
                      ? `Gateway LaunchAgent removed: ${result.plistPath}`
                      : 'Gateway LaunchAgent was not installed.',
            );
            return { exitCode: 0 };
        }
        const result = await gatewayDaemonStatus(deps);
        if (options.json === true) {
            context.output.write(toJson({ ok: true, action, ...result }));
            return { exitCode: 0, result };
        }
        if (!result.installed) {
            context.output.write(`Gateway LaunchAgent is not installed (${result.plistPath}).`);
            return { exitCode: 0, result };
        }
        context.output.write(`LaunchAgent: ${result.plistPath}`);
        context.output.write(`loaded: ${result.loaded}${result.pid === null ? '' : ` (pid ${result.pid})`}`);
        if (result.lastExit !== null) context.output.write(`last exit: ${result.lastExit}`);
        context.output.write(`gateway health: ${result.health === null ? 'unreachable' : 'ok'}`);
        if (!result.binaryExists) {
            context.output.write(
                'warning: the plist points at a binary that no longer exists — re-run `spur self install --daemon`',
            );
        }
        return { exitCode: 0, result };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (options.json === true) {
            context.output.write(toJson({ ok: false, action, error: message }));
        } else {
            context.output.error(`Error: ${message}`);
        }
        return { exitCode: 1 };
    }
}
