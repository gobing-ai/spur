/**
 * mcp-agent-interop — exercise each installed agent's MCP handshake against a live server (feature
 * B93, task 1432; design in the task's Design section).
 *
 * Usage: bun scripts/spur-dev.ts mcp-agent-interop [--agents a,b] [--keep]
 *
 * One temp project, one `spur self serve` with MCP enabled and a generated bearer token, and an
 * in-process recording proxy in front of `/mcp`. For every supported agent it runs two cases —
 * HTTP (entry pointed at the proxy URL) and stdio (`entry` → `spur mcp --url <proxy>`) — with a
 * fixed prompt, and records what the PROXY saw, never what the agent said.
 *
 * Isolation first: an agent config is only attempted through a per-invocation flag or a file inside
 * the temp project. An agent with no such mechanism is classified `config-isolation-unavailable`
 * rather than editing the operator's global config; the run hashes every known config path before
 * and after and fails if one moved.
 *
 * A `pass` is explicitly NOT required: verdicts are 1433's job. Exit 0 means every installed agent
 * got a classification.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { getEnvVar, getEnvVars } from '@gobing-ai/spur-config';
import { type Subprocess, spawn } from 'bun';

const REPO_ROOT = resolve(import.meta.dir, '../..');
const CLI = join(REPO_ROOT, 'apps/cli/src/index.ts');
const RECEIPT = join(REPO_ROOT, 'docs/reports/mcp-agent-interop-receipt.json');
const PROMPT =
    'Use your MCP tools: list the tools whose names start with "sp_", then call sp_task_list with no arguments. ' +
    'Reply with one short line naming the tools you saw.';
const TOKEN_ENV = 'SPUR_MCP_TOKEN';
const TOKEN = `interop-${createHash('sha256').update(`${Date.now()}`).digest('hex').slice(0, 24)}`;
/** Per case: one agent turn. Long enough for a cold CLI, short enough that a hung agent is a row. */
const CASE_TIMEOUT_MS = 120_000;
/** A retrying client can produce thousands of requests; the row keeps the head plus the total. */
const REQUEST_LOG_CAP = 20;

type Classification =
    | 'pass'
    | 'rejected-legacy-revision'
    | 'no-request'
    | 'auth-failed'
    | 'call-failed'
    | 'not-installed'
    | 'config-isolation-unavailable'
    | 'agent-error';

/** One proxied request, as the server answered it. */
interface ProxiedRequest {
    method: string;
    revision: string | null;
    status: number;
    errorCode: string | null;
}

/** One receipt row: one agent on one transport. */
interface InteropRow {
    agent: string;
    version: string;
    transport: 'http' | 'stdio';
    installed: boolean;
    configMethod: string | null;
    /** How this entry is pointed at the server, and where that mechanism is documented. */
    configSource: string | null;
    clientRevision: string | null;
    /** First {@link REQUEST_LOG_CAP} proxied requests; `requestCount` carries the true total. */
    requests: ProxiedRequest[];
    requestCount: number;
    toolsSeen: number | null;
    callOutcome: 'pass' | 'fail' | 'not-attempted';
    classification: Classification;
    errorExcerpt: string | null;
}

/**
 * How to point one agent at the endpoint without touching its global config.
 *
 * `config()` returns either an argv suffix + env, or a reason the isolation is unavailable. Every
 * entry names where the mechanism was verified (`--help` of the installed binary, or the doc path).
 */
interface IsolatedConfig {
    /** Files to write inside the temp project (path → content); an empty content makes a directory. */
    files?: Record<string, string>;
    /** Env overrides for the child only. */
    env?: Record<string, string>;
    /** Values `runArgs` needs back (e.g. the config path it must pass on the command line). */
    runVars?: Record<string, string>;
    method: string;
    source: string;
}

interface AgentSpec {
    id: string;
    binary: string;
    /** argv to run one non-interactive turn with the prompt appended. */
    runArgs: (prompt: string, runVars: Record<string, string>) => string[];
    /** Isolated config for one transport; `{unavailable}` when no isolated mechanism exists. */
    config: (
        transport: 'http' | 'stdio',
        target: { url: string; stdio: string[] },
        dir: string,
    ) => IsolatedConfig | { unavailable: string };
}

const AGENTS: AgentSpec[] = [
    {
        id: 'claude',
        binary: 'claude',
        runArgs: (prompt, cfg) => [
            '-p',
            prompt,
            '--mcp-config',
            cfg.mcpConfig ?? '',
            '--strict-mcp-config',
            '--allowedTools',
            'mcp__spur',
        ],
        config: (transport, target, dir) => {
            const file = join(dir, `claude-mcp-${transport}.json`);
            const server =
                transport === 'http'
                    ? { type: 'http', url: target.url, headers: { Authorization: `Bearer \${${TOKEN_ENV}}` } }
                    : { type: 'stdio', command: target.stdio[0], args: target.stdio.slice(1) };
            const configDir = join(dir, 'claude-config');
            const homeState = join(getEnvVar('HOME') ?? '', '.claude.json');
            const seed = existsSync(homeState)
                ? { [join(configDir, '.claude.json')]: readFileSync(homeState, 'utf8') }
                : {};
            return {
                files: {
                    ...seed,
                    [file]: JSON.stringify({ mcpServers: { spur: server } }),
                },
                // `CLAUDE_CONFIG_DIR` keeps its own state file out of `~/.claude.json` (R5); the
                // operator's session state is COPIED in so the turn is authenticated as they are.
                env: { CLAUDE_CONFIG_DIR: configDir },
                runVars: { mcpConfig: file },
                method: 'per-invocation --mcp-config + --strict-mcp-config, CLAUDE_CONFIG_DIR into the temp project',
                source: 'claude --help (--mcp-config, --strict-mcp-config, --allowedTools; verified 2026-11-22, 2.1.330)',
            };
        },
    },
    {
        id: 'pi',
        binary: 'pi',
        runArgs: (prompt) => ['--no-session', '-p', prompt],
        config: (transport, target, dir) => {
            const file = join(dir, '.pi', 'mcp.json');
            const server =
                transport === 'http'
                    ? { url: target.url, headers: { Authorization: `Bearer \${${TOKEN_ENV}}` } }
                    : { command: target.stdio[0], args: target.stdio.slice(1) };
            return {
                files: { [file]: JSON.stringify({ mcpServers: { spur: server } }) },
                method: 'project-local .pi/mcp.json',
                source: 'pi mcp --help ("Reads ~/.pi/agent/mcp.json and, in trusted projects, .pi/mcp.json")',
            };
        },
    },
    {
        id: 'codex',
        binary: 'codex',
        runArgs: (prompt, vars) => [
            '-c',
            `mcp_servers.spur.command=${vars.command ?? '""'}`,
            '-c',
            `mcp_servers.spur.args=${vars.args ?? '[]'}`,
            '-c',
            `mcp_servers.spur.env=${vars.env ?? '{}'}`,
            'exec',
            '--skip-git-repo-check',
            prompt,
        ],
        // Verified 2026-11-22 against codex-cli 0.171.0:
        //  - stdio: `codex -c mcp_servers.spur.command=… -c mcp_servers.spur.args=[…] mcp list` accepts it;
        //  - HTTP: needs `codex mcp add --url`, which writes ~/.codex/config.toml (global), and the
        //    `-c mcp_servers.spur.url=…` override is rejected with "url is not supported for stdio".
        //    So HTTP is isolation-unavailable, not impossible.
        config: (transport, target) =>
            transport === 'http'
                ? {
                      unavailable:
                          'codex-cli 0.171.0 reaches HTTP only through `codex mcp add --url` (writes ~/.codex/config.toml); the -c override is rejected with "url is not supported for stdio"',
                  }
                : {
                      runVars: {
                          command: JSON.stringify(target.stdio[0] ?? ''),
                          args: JSON.stringify(target.stdio.slice(1)),
                          // Codex builds a scrubbed env for MCP servers, so the bridge's bearer
                          // variable has to be declared here (the value is a per-run temp token).
                          env: JSON.stringify({ SPUR_MCP_AUTH_ENV: TOKEN_ENV, [TOKEN_ENV]: TOKEN }),
                      },
                      method: 'per-invocation -c mcp_servers.spur.command/args overrides (stdio)',
                      source: 'verified 2026-11-22 against codex-cli 0.171.0 (`codex -c … mcp list`)',
                  },
    },
    {
        id: 'gemini',
        binary: 'gemini',
        runArgs: (prompt) => ['--skip-trust', '-p', prompt],
        config: (transport, target, dir) => {
            const file = join(dir, '.gemini', 'settings.json');
            const server =
                transport === 'http'
                    ? { httpUrl: target.url, headers: { Authorization: `Bearer \${${TOKEN_ENV}}` } }
                    : { command: target.stdio[0], args: target.stdio.slice(1) };
            return {
                files: { [file]: JSON.stringify({ mcpServers: { spur: server } }) },
                method: 'project-local .gemini/settings.json',
                source: 'gemini mcp --help ("Manage MCP servers"); settings.json mcpServers shape',
            };
        },
    },
    {
        id: 'opencode',
        binary: 'opencode',
        runArgs: (prompt) => ['run', prompt],
        config: (transport, target, dir) => {
            const file = join(dir, 'opencode.json');
            const server =
                transport === 'http'
                    ? { type: 'remote', url: target.url, headers: { Authorization: `Bearer \${${TOKEN_ENV}}` } }
                    : { type: 'local', command: target.stdio };
            return {
                files: {
                    [file]: JSON.stringify({ $schema: 'https://opencode.ai/config.json', mcp: { spur: server } }),
                },
                method: 'project-local opencode.json',
                source: 'opencode mcp --help; project config file',
            };
        },
    },
    {
        id: 'omp',
        binary: 'omp',
        runArgs: (prompt, cfg) => ['--config', cfg.overlay ?? '', '-p', prompt],
        config: (transport, target, dir) => {
            const file = join(dir, `omp-${transport}.yml`);
            // A proper mapping: `command:` + `args:` as a YAML list. A single scalar command line
            // is a YAML parse error, which is how the first attempt failed.
            const server =
                transport === 'http'
                    ? `  spur:\n    url: ${target.url}\n    headers:\n      Authorization: "Bearer \${${TOKEN_ENV}}"\n`
                    : `  spur:\n    command: ${JSON.stringify(target.stdio[0] ?? '')}\n    args:\n${target.stdio
                          .slice(1)
                          .map((part) => `      - ${JSON.stringify(part)}`)
                          .join('\n')}\n`;
            return {
                files: { [file]: `mcp_servers:\n${server}` },
                runVars: { overlay: file },
                method: 'per-run --config overlay',
                source: 'omp --help ("--config=<value> Load an extra config.yml-style overlay for this run")',
            };
        },
    },
    {
        id: 'openclaw',
        binary: 'openclaw',
        runArgs: (prompt, cfg) => ['run', '--config', cfg.mcpConfig ?? '', prompt],
        config: (transport, target, dir) => {
            const file = join(dir, `openclaw-${transport}.json`);
            const server =
                transport === 'http'
                    ? { url: target.url, headers: { Authorization: `Bearer \${${TOKEN_ENV}}` } }
                    : { command: target.stdio };
            return {
                files: { [file]: JSON.stringify({ mcp: { servers: { spur: server } } }), [join(dir, 'state')]: '' },
                env: { OPENCLAW_CONFIG_PATH: file, OPENCLAW_STATE_DIR: join(dir, 'state') },
                runVars: { mcpConfig: file },
                method: 'OPENCLAW_CONFIG_PATH + OPENCLAW_STATE_DIR into the temp project',
                source: 'openclaw --help (OPENCLAW_STATE_DIR / OPENCLAW_CONFIG_PATH)',
            };
        },
    },
    {
        id: 'grok',
        binary: 'grok',
        runArgs: (prompt) => ['-p', prompt],
        config: () => ({
            unavailable:
                'grok mcp add writes its own config store; no per-invocation or project-local path was verified',
        }),
    },
    {
        id: 'antigravity',
        binary: 'antigravity',
        runArgs: (prompt) => ['-p', prompt],
        config: () => ({ unavailable: 'not installed in this environment' }),
    },
    {
        id: 'hermes',
        binary: 'hermes',
        runArgs: (prompt) => ['-p', prompt],
        config: () => ({ unavailable: 'not installed in this environment' }),
    },
];

/** The operator's global config paths this run must not touch (R5). */
function globalConfigPaths(): string[] {
    const home = getEnvVar('HOME') ?? '';
    return [
        join(home, '.claude.json'),
        join(home, '.claude', 'settings.json'),
        join(home, '.codex', 'config.toml'),
        join(home, '.gemini', 'settings.json'),
        join(home, '.pi', 'agent', 'mcp.json'),
        join(home, '.config', 'opencode', 'opencode.json'),
        join(home, '.openclaw', 'config.json'),
        join(home, '.grok', 'config.json'),
    ];
}

/** sha256 of one path's bytes, or `absent` (so "created" also counts as a change). */
function hashPath(path: string): string {
    if (!existsSync(path)) return 'absent';
    try {
        return createHash('sha256').update(readFileSync(path)).digest('hex');
    } catch {
        return 'unreadable';
    }
}

function globalConfigFingerprint(): Record<string, string> {
    return Object.fromEntries(globalConfigPaths().map((path) => [path, hashPath(path)]));
}

/** A free TCP port. */
async function freePort(): Promise<number> {
    return new Promise((resolvePort, reject) => {
        const server = createServer();
        server.on('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            const port = typeof address === 'object' && address !== null ? address.port : 0;
            server.close(() => resolvePort(port));
        });
    });
}

/** The log of the case currently running; the proxy appends to it, one case at a time. */
let activeLog: ProxiedRequest[] = [];

/** The recording proxy: forwards to `/mcp` and keeps only method/revision/status/errorCode. */
function startProxy(upstream: string) {
    return Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        async fetch(request) {
            const url = new URL(request.url);
            if (!url.pathname.endsWith('/mcp')) return new Response('not found', { status: 404 });
            const body = await request.text();
            let method = request.headers.get('Mcp-Method') ?? '';
            if (method === '') {
                try {
                    const parsed = JSON.parse(body) as { method?: unknown };
                    if (typeof parsed.method === 'string') method = parsed.method;
                } catch {
                    // a body we cannot parse is the server's INVALID_REQUEST, not ours to guess
                }
            }
            const revision = request.headers.get('Mcp-Protocol-Version');
            const upstreamRes = await fetch(`${upstream}/mcp`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(revision === null ? {} : { 'Mcp-Protocol-Version': revision }),
                    ...(request.headers.get('Authorization') === null
                        ? {}
                        : { Authorization: request.headers.get('Authorization') as string }),
                },
                body,
            });
            const text = await upstreamRes.text();
            let errorCode: string | null = null;
            try {
                const parsed = JSON.parse(text) as { error?: { code?: unknown; data?: { code?: unknown } } };
                const code = parsed.error?.data?.code ?? parsed.error?.code;
                if (typeof code === 'string') errorCode = code;
            } catch {
                // non-JSON is not a code
            }
            activeLog.push({ method, revision, status: upstreamRes.status, errorCode });
            return new Response(text, { status: upstreamRes.status, headers: { 'Content-Type': 'application/json' } });
        },
    });
}

/** Classify one case from the proxy log plus the process outcome. */
function classify(
    entry: ProxiedRequest[],
    exitCode: number | null,
    timedOut: boolean,
): { classification: Classification; callOutcome: InteropRow['callOutcome'] } {
    if (entry.length === 0) {
        return {
            classification: timedOut || exitCode === null ? 'agent-error' : 'no-request',
            callOutcome: 'not-attempted',
        };
    }
    if (entry.some((request) => request.errorCode === 'PROTOCOL_VERSION_UNSUPPORTED')) {
        return { classification: 'rejected-legacy-revision', callOutcome: 'not-attempted' };
    }
    if (entry.some((request) => request.status === 401 || request.status === 403)) {
        return { classification: 'auth-failed', callOutcome: 'not-attempted' };
    }
    const called = entry.find((request) => request.method === 'tools/call');
    if (called !== undefined && called.status < 400) return { classification: 'pass', callOutcome: 'pass' };
    if (called !== undefined) return { classification: 'call-failed', callOutcome: 'fail' };
    return { classification: timedOut || exitCode === null ? 'agent-error' : 'call-failed', callOutcome: 'fail' };
}

/** Run one case: config, turn, classify. Persists the row through `onRow`. */
async function runCase(
    spec: AgentSpec,
    transport: 'http' | 'stdio',
    probe: { proxyUrl: string; stdio: string[]; dir: string; installed: boolean; version: string },
    onRow: (row: InteropRow) => void,
): Promise<void> {
    const base: InteropRow = {
        agent: spec.id,
        version: probe.version,
        transport,
        installed: probe.installed,
        configMethod: null,
        configSource: null,
        clientRevision: null,
        requests: [],
        requestCount: 0,
        toolsSeen: null,
        callOutcome: 'not-attempted',
        classification: 'not-installed',
        errorExcerpt: null,
    };
    if (!probe.installed) {
        onRow(base);
        return;
    }
    const config = spec.config(transport, { url: probe.proxyUrl, stdio: probe.stdio }, probe.dir);
    if ('unavailable' in config) {
        onRow({ ...base, classification: 'config-isolation-unavailable', errorExcerpt: config.unavailable });
        return;
    }
    for (const [file, content] of Object.entries(config.files ?? {})) {
        if (content === '') {
            mkdirSync(file, { recursive: true });
            continue;
        }
        mkdirSync(join(file, '..'), { recursive: true });
        writeFileSync(file, content);
    }
    const argv = [spec.binary, ...spec.runArgs(PROMPT, config.runVars ?? {})];
    activeLog = [];
    const env = {
        ...getEnvVars(),
        // The `spur mcp` bridge resolves the bearer through the same variable names serve uses.
        SPUR_MCP_ENABLED: '1',
        SPUR_MCP_AUTH_ENV: TOKEN_ENV,
        [TOKEN_ENV]: TOKEN,
        ...(config.env ?? {}),
    } as Record<string, string>;
    let exitCode: number | null = null;
    let timedOut = false;
    const child = spawn({ cmd: argv, cwd: probe.dir, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env });
    const collected = (async () =>
        `${await new Response(child.stdout).text()}${await new Response(child.stderr).text()}`)();
    const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
    }, CASE_TIMEOUT_MS);
    exitCode = await child.exited;
    clearTimeout(timer);
    const output = await collected;
    const observed = activeLog.slice();
    const verdict = classify(observed, exitCode, timedOut);
    // The tail only: enough to name a cause, never the whole transcript.
    const excerpt = timedOut
        ? `timed out after ${CASE_TIMEOUT_MS}ms: ${output.slice(-300)}`
        : output.slice(-300) || null;
    onRow({
        ...base,
        configMethod: config.method,
        configSource: config.source,
        clientRevision: observed.find((request) => request.revision !== null)?.revision ?? null,
        requests: observed.slice(0, REQUEST_LOG_CAP),
        requestCount: observed.length,
        toolsSeen: observed.some((request) => request.method === 'tools/list') ? 1 : null,
        callOutcome: verdict.callOutcome,
        classification: verdict.classification,
        errorExcerpt: excerpt,
    });
}

/** Drive one run and write the receipt. */
export async function runMcpAgentInterop(args: string[] = []): Promise<number> {
    const keep = args.includes('--keep');
    const subsetArg = args.find((arg) => arg.startsWith('--agents='));
    const subset = subsetArg
        ?.slice('--agents='.length)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
    const previous = (() => {
        try {
            const parsed = JSON.parse(readFileSync(RECEIPT, 'utf8')) as { rows?: InteropRow[] };
            return parsed.rows ?? [];
        } catch {
            return [];
        }
    })();

    const dir = mkdtempSync(join(tmpdir(), 'spur-mcp-interop-'));
    const port = await freePort();
    const root = `http://127.0.0.1:${port}`;
    const before = globalConfigFingerprint();
    const rows = new Map<string, InteropRow>();
    for (const row of previous) rows.set(`${row.agent}:${row.transport}`, row);

    const writeReceipt = (floor: string) => {
        mkdirSync(join(REPO_ROOT, 'docs/reports'), { recursive: true });
        writeFileSync(
            RECEIPT,
            `${JSON.stringify(
                {
                    artifact: 'mcp-agent-interop',
                    generatedAt: new Date().toISOString(),
                    serverProtocolFloor: floor,
                    context: { port, project: keep ? dir : '(removed)' },
                    rows: [...rows.values()].sort((a, b) =>
                        `${a.agent}:${a.transport}`.localeCompare(`${b.agent}:${b.transport}`),
                    ),
                },
                null,
                4,
            )}\n`,
        );
    };

    const serve: Subprocess<'ignore', 'pipe', 'pipe'> = spawn({
        cmd: ['bun', CLI, 'self', 'serve', '--port', String(port), '--host', '127.0.0.1', '--no-open'],
        cwd: dir,
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
            ...getEnvVars(),
            SPUR_PROJECTS_FILE: join(dir, 'projects.json'),
            SPUR_SLASH_COMMANDS_FILE: join(dir, 'slash_commands.json'),
            SPUR_MCP_ENABLED: '1',
            SPUR_MCP_AUTH_ENV: TOKEN_ENV,
            [TOKEN_ENV]: TOKEN,
        },
    });
    const floor = (await import('../../apps/server/src/modules/mcp/protocol')).MIN_MCP_PROTOCOL_VERSION;
    const proxy = startProxy(root);

    try {
        const healthy = await (async () => {
            const deadline = Date.now() + 45_000;
            while (Date.now() < deadline) {
                try {
                    const res = await fetch(`${root}/api/health`);
                    if (res.ok) return true;
                } catch {
                    // not up yet
                }
                await Bun.sleep(250);
            }
            return false;
        })();
        if (!healthy) throw new Error('spur self serve never answered /api/health');

        const targets = AGENTS.filter((spec) => subset === undefined || subset.includes(spec.id));
        for (const spec of targets) {
            const versionProbe = (() => {
                try {
                    return Bun.spawnSync({ cmd: [spec.binary, '--version'], stdout: 'pipe', stderr: 'pipe' });
                } catch {
                    return null; // no binary on PATH: not-installed, not an agent error
                }
            })();
            const installed = versionProbe !== null && versionProbe.exitCode === 0;
            const version = installed ? (versionProbe?.stdout.toString().split('\n')[0]?.trim() ?? '') : '';
            for (const transport of ['http', 'stdio'] as const) {
                await runCase(
                    spec,
                    transport,
                    {
                        proxyUrl: `http://127.0.0.1:${proxy.port}`,
                        stdio: ['bun', CLI, 'mcp', '--url', `http://127.0.0.1:${proxy.port}/mcp`],
                        dir,
                        installed,
                        version,
                    },
                    (row) => {
                        rows.set(`${row.agent}:${row.transport}`, row);
                        writeReceipt(floor);
                    },
                );
            }
        }
    } catch (error) {
        rows.set('harness:http', {
            agent: 'harness',
            version: '',
            transport: 'http',
            installed: true,
            configMethod: null,
            configSource: null,
            clientRevision: null,
            requests: [],
            requestCount: 0,
            toolsSeen: null,
            callOutcome: 'not-attempted',
            classification: 'agent-error',
            errorExcerpt: error instanceof Error ? error.message : String(error),
        });
    } finally {
        proxy.stop(true);
        serve.kill();
        if (!keep) rmSync(dir, { recursive: true, force: true });
    }

    const after = globalConfigFingerprint();
    const changed = Object.keys(before).filter((path) => before[path] !== after[path]);
    writeReceipt(floor);
    const all = [...rows.values()];
    console.log(`mcp-agent-interop receipt: ${relative(REPO_ROOT, RECEIPT)}`);
    for (const row of all) {
        console.log(
            `  ${row.transport.padEnd(5)} ${row.agent.padEnd(12)} ${row.classification.padEnd(28)} requests=${row.requests.length} ${row.errorExcerpt?.slice(0, 80) ?? ''}`,
        );
    }
    if (changed.length > 0) {
        console.error(`mcp-agent-interop: global agent config changed: ${changed.join(', ')} (R5)`);
        return 1;
    }
    const installedAgents = all.filter((row) => row.installed).map((row) => row.agent);
    const classified = all.filter((row) => row.installed && row.classification !== 'not-installed').length;
    if (classified < installedAgents.length) {
        console.error('mcp-agent-interop: some installed agents have no classification row');
        return 1;
    }
    return 0;
}

if (import.meta.main) {
    process.exit(await runMcpAgentInterop(process.argv.slice(2)));
}
