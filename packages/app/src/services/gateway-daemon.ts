import type { FileSystem, ProcessExecutor } from '@gobing-ai/ts-runtime';

/**
 * macOS user LaunchAgent for the one-port project gateway (feature K4 R9/R10, ADR-151 §7).
 *
 * The daemon's only job is keeping the gateway on: launchd restarts it (`KeepAlive`), and
 * `AbandonProcessGroup` keeps spawned project serves and running agents alive across a gateway
 * restart — the new gateway re-adopts them through the registry. Everything is injected (platform,
 * home, uid, PATH, spur argv, executor, fs, port probe) so the plist bytes and the exact
 * `launchctl` argv can be asserted without touching the operator's machine.
 */

/** launchd label — also the plist file name stem. */
export const GATEWAY_LABEL = 'ai.gobing.spur.gateway';

/** Everything the daemon lifecycle reads or performs. */
export interface GatewayDaemonDeps {
    platform: NodeJS.Platform;
    uid: number;
    home: string;
    /** PATH captured at install time — launchd starts with a minimal environment. */
    path: string;
    /** The absolute spur invocation (`resolveSpurArgv()`), argv[0] being the executable. */
    spurArgv: string[];
    /** `server.gateway.port`. */
    port: number;
    /**
     * `server.gateway.allowedHosts` — the tunnel hostnames the gateway's host guard admits.
     * Baked into the plist as `SPUR_GATEWAY_ALLOWED_HOSTS`, the only input path the env-derived
     * serve config has for it.
     */
    allowedHosts?: string[];
    exec: ProcessExecutor;
    fs: FileSystem;
    /** `gateway` = our own listener, `foreign` = something else owns the port, `free`. */
    probeGateway(port: number): Promise<'gateway' | 'foreign' | 'free'>;
    /** Test seam for the health probe; defaults to the global `fetch`. */
    fetchHealth?: typeof fetch;
}

/** Result of `install`. */
export interface GatewayInstallResult {
    status: 'installed' | 'updated' | 'unchanged';
    plistPath: string;
}

/** Result of `uninstall`. */
export interface GatewayUninstallResult {
    status: 'removed' | 'absent';
    plistPath: string;
}

/** Result of `status`. */
export interface GatewayStatusResult {
    installed: boolean;
    loaded: boolean;
    pid: number | null;
    lastExit: number | null;
    health: unknown | null;
    binaryExists: boolean;
    plistPath: string;
}

/** Absolute plist path for this home. */
export function gatewayPlistPath(home: string): string {
    return `${home}/Library/LaunchAgents/${GATEWAY_LABEL}.plist`;
}

/** Log file paths the agent writes. */
export function gatewayLogPaths(home: string): { out: string; err: string } {
    return { out: `${home}/Library/Logs/spur/gateway.out.log`, err: `${home}/Library/Logs/spur/gateway.err.log` };
}

/** Escape one XML text/attribute value. */
function xmlEscape(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Render the LaunchAgent plist.
 *
 * Keys are emitted in a fixed order so an unchanged install is byte-identical (the install path
 * compares bytes to decide `unchanged`), and every value is XML-escaped — a PATH with `&` or `<`
 * must not produce an unparseable plist.
 */
export function renderGatewayPlist(
    deps: Pick<GatewayDaemonDeps, 'home' | 'path' | 'spurArgv' | 'port' | 'allowedHosts'>,
): string {
    const logs = gatewayLogPaths(deps.home);
    const programArguments = [...deps.spurArgv, 'self', 'serve', '--gateway', '--port', String(deps.port), '--no-open'];
    const args = programArguments.map((arg) => `        <string>${xmlEscape(arg)}</string>`).join('\n');
    const allowedHosts = deps.allowedHosts ?? [];
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        '<dict>',
        '    <key>Label</key>',
        `    <string>${GATEWAY_LABEL}</string>`,
        '    <key>ProgramArguments</key>',
        '    <array>',
        args,
        '    </array>',
        '    <key>EnvironmentVariables</key>',
        '    <dict>',
        '        <key>PATH</key>',
        `        <string>${xmlEscape(deps.path)}</string>`,
        '        <key>SPUR_GATEWAY_PORT</key>',
        `        <string>${String(deps.port)}</string>`,
        ...(allowedHosts.length === 0
            ? []
            : [
                  '        <key>SPUR_GATEWAY_ALLOWED_HOSTS</key>',
                  `        <string>${xmlEscape(allowedHosts.join(','))}</string>`,
              ]),
        '    </dict>',
        '    <key>RunAtLoad</key>',
        '    <true/>',
        '    <key>KeepAlive</key>',
        '    <true/>',
        '    <key>AbandonProcessGroup</key>',
        '    <true/>',
        '    <key>ThrottleInterval</key>',
        '    <integer>10</integer>',
        '    <key>StandardOutPath</key>',
        `    <string>${xmlEscape(logs.out)}</string>`,
        '    <key>StandardErrorPath</key>',
        `    <string>${xmlEscape(logs.err)}</string>`,
        '</dict>',
        '</plist>',
        '',
    ].join('\n');
}

/** Refuse anywhere but macOS, naming the platform and writing nothing. */
function assertMacos(deps: GatewayDaemonDeps): void {
    if (deps.platform !== 'darwin') {
        throw new Error(
            `The gateway LaunchAgent is macOS-only; this host reports platform "${deps.platform}". ` +
                'Run `spur self serve --gateway` under your own supervisor instead.',
        );
    }
}

/** Run launchctl with the given argv; resolves with the buffered result (never throws). */
async function launchctl(
    deps: GatewayDaemonDeps,
    args: string[],
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    const result = await deps.exec.run({ command: 'launchctl', args });
    return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}

/** `launchctl print` a domain target exists/loaded check plus its parsed state. */
async function printService(
    deps: GatewayDaemonDeps,
): Promise<{ loaded: boolean; pid: number | null; lastExit: number | null }> {
    const result = await launchctl(deps, ['print', `gui/${deps.uid}/${GATEWAY_LABEL}`]);
    if (result.exitCode !== 0) {
        return { loaded: false, pid: null, lastExit: null };
    }
    return { loaded: true, ...parsePrintOutput(result.stdout) };
}

/** Parse the lenient subset of `launchctl print` the status report needs. */
export function parsePrintOutput(output: string): { pid: number | null; lastExit: number | null } {
    const pid = /^\s*pid = (\d+)\s*$/m.exec(output);
    const lastExit = /^\s*last exit code = (-?\d+)\s*$/m.exec(output);
    return {
        pid: pid === null ? null : Number.parseInt(pid[1] as string, 10),
        lastExit: lastExit === null ? null : Number.parseInt(lastExit[1] as string, 10),
    };
}

/** Poll cadence while launchd finishes an unload. */
const UNLOAD_POLL_MS = 50;
/** ~2s ceiling: launchd unloads in milliseconds, but this must not hang an install. */
const UNLOAD_POLL_ATTEMPTS = 40;
/** Delay before re-trying a bootstrap that launchd answered with EINPROGRESS. */
const BOOTSTRAP_RETRY_MS = 250;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until launchd reports the label unloaded.
 *
 * `bootout` returns before the service is gone. Bootstrapping the same label in that window fails
 * `EINPROGRESS` (37), which launchctl renders as the uninformative `5: Input/output error` —
 * observed on every port-changing re-install before this wait existed.
 */
async function waitForUnload(deps: GatewayDaemonDeps): Promise<boolean> {
    for (let attempt = 0; attempt < UNLOAD_POLL_ATTEMPTS; attempt++) {
        if (!(await printService(deps)).loaded) return true;
        await sleep(UNLOAD_POLL_MS);
    }
    return false;
}

/**
 * Install (or update) the agent.
 *
 * Order is load-bearing: platform → port availability → logs dir → render → byte compare → atomic
 * write → bootout-if-loaded-and-changed → wait for the unload → bootstrap (one retry). A failed
 * bootstrap of a first install removes the plist, so nothing is half-registered; a failed *update*
 * restores the previous plist instead, because deleting it would take a working agent down.
 */
export async function installGatewayDaemon(deps: GatewayDaemonDeps): Promise<GatewayInstallResult> {
    assertMacos(deps);
    const portState = await deps.probeGateway(deps.port);
    if (portState === 'foreign') {
        throw new Error(`Gateway port ${deps.port} is in use by another process. Stop it or set server.gateway.port.`);
    }

    const plistPath = gatewayPlistPath(deps.home);
    const rendered = renderGatewayPlist(deps);
    const existing = (await deps.fs.exists(plistPath)) ? await deps.fs.readFile(plistPath) : null;
    const unchanged = existing === rendered;

    if (!unchanged) {
        await deps.fs.ensureDir(`${deps.home}/Library/LaunchAgents`);
        await deps.fs.ensureDir(`${deps.home}/Library/Logs/spur`);
        const tmp = `${plistPath}.tmp`;
        await deps.fs.writeFile(tmp, rendered);
        await deps.fs.rename(tmp, plistPath);
    } else {
        await deps.fs.ensureDir(`${deps.home}/Library/Logs/spur`);
    }

    const before = await printService(deps);
    if (unchanged && before.loaded) {
        return { status: 'unchanged', plistPath };
    }
    if (before.loaded) {
        await launchctl(deps, ['bootout', `gui/${deps.uid}/${GATEWAY_LABEL}`]);
        await waitForUnload(deps);
    }

    let bootstrap = await launchctl(deps, ['bootstrap', `gui/${deps.uid}`, plistPath]);
    if (bootstrap.exitCode !== 0 && before.loaded) {
        // The label had been loaded, so a lingering unload is the likeliest cause: one retry.
        await sleep(BOOTSTRAP_RETRY_MS);
        bootstrap = await launchctl(deps, ['bootstrap', `gui/${deps.uid}`, plistPath]);
    }
    if (bootstrap.exitCode !== 0) {
        const detail = bootstrap.stderr.trim() || bootstrap.stdout.trim() || `launchctl exited ${bootstrap.exitCode}`;
        if (existing === null) {
            // First install: leave nothing half-registered.
            await deps.fs.deleteFile(plistPath);
            throw new Error(`launchctl bootstrap failed: ${detail}`);
        }
        // Update: the previously working agent was booted out above, so restore its plist and try
        // to bring it back rather than leaving the machine with no gateway at all.
        await deps.fs.writeFile(plistPath, existing);
        const restored = await launchctl(deps, ['bootstrap', `gui/${deps.uid}`, plistPath]);
        const suffix =
            restored.exitCode === 0
                ? 'the previous LaunchAgent was restored and is running'
                : 'the previous LaunchAgent was restored but is not running; re-run `spur self install --daemon`';
        throw new Error(`launchctl bootstrap failed: ${detail} — ${suffix}`);
    }
    return { status: existing === null ? 'installed' : 'updated', plistPath };
}

/** Boot the agent out (absent = success) and remove the plist. */
export async function uninstallGatewayDaemon(deps: GatewayDaemonDeps): Promise<GatewayUninstallResult> {
    assertMacos(deps);
    const plistPath = gatewayPlistPath(deps.home);
    const installed = await deps.fs.exists(plistPath);
    const before = await printService(deps);
    if (before.loaded) {
        await launchctl(deps, ['bootout', `gui/${deps.uid}/${GATEWAY_LABEL}`]);
    }
    if (installed) {
        await deps.fs.deleteFile(plistPath);
        return { status: 'removed', plistPath };
    }
    return { status: 'absent', plistPath };
}

/** Report installation, launchd state, the gateway's own health, and whether the binary moved. */
export async function gatewayDaemonStatus(deps: GatewayDaemonDeps): Promise<GatewayStatusResult> {
    assertMacos(deps);
    const plistPath = gatewayPlistPath(deps.home);
    const installed = await deps.fs.exists(plistPath);
    const state = await printService(deps);
    const executable = deps.spurArgv[0];
    const binaryExists = executable !== undefined && (await deps.fs.exists(executable));
    let health: unknown | null = null;
    try {
        const fetchHealth = deps.fetchHealth ?? fetch;
        // `localhost` (not 127.0.0.1): the gateway binds `server.host`, which Bun resolves to ::1 on macOS.
        const res = await fetchHealth(`http://localhost:${deps.port}/api/health`, {
            signal: AbortSignal.timeout(1000),
        });
        if (res.ok) health = await res.json();
    } catch {
        health = null;
    }
    return {
        installed,
        loaded: state.loaded,
        pid: state.pid,
        lastExit: state.lastExit,
        health,
        binaryExists,
        plistPath,
    };
}
