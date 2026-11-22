/**
 * mcp-agent-interop — exercise each installed agent's MCP handshake against a live server (feature
 * B93, task 1432; design in the task's Design section).
 *
 * Usage: bun scripts/spur-dev.ts mcp-agent-interop [--agents a,b] [--keep]
 *
 * One temp project, one `spur self serve` with MCP enabled and a generated bearer token, and an
 * in-process recording proxy in front of `/mcp`. For every supported agent it runs two cases —
 * HTTP (entry pointed at the proxy URL) and stdio (`entry` → `spur mcp --url <proxy>`) — with a
 * fixed prompt (Codex uses its native catalog/tool-call API), and records what the PROXY saw,
 * never what the agent said.
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
import { configuredSecretValues, redactAndBound, redactProbeOutput } from '@gobing-ai/spur-app';
import { getEnvVar, getEnvVars } from '@gobing-ai/spur-config';
import { type Subprocess, spawn } from 'bun';

const REPO_ROOT = resolve(import.meta.dir, '../..');
const CLI = join(REPO_ROOT, 'apps/cli/src/index.ts');
const RECEIPT = join(REPO_ROOT, 'docs/reports/mcp-agent-interop-receipt.json');
const PROMPT =
    'Use your MCP tools: list the tools whose names start with "sp_", then call sp_task_list with no arguments. ' +
    'Reply with one short line naming the tools you saw.';
const TOKEN_ENV = 'SPUR_MCP_TOKEN';
const TOKEN = `interop-${crypto.randomUUID()}`;
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
    requestedRevision: string | null;
    status: number;
    errorCode: string | null;
    toolName: string | null;
    toolCount: number | null;
    responseOk: boolean;
}

/** One receipt row: one agent on one transport. */
interface InteropRow {
    agent: string;
    version: string;
    observedAt: string;
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

/** Per-agent isolated configuration and invocation contracts used by this proof. */
export const AGENTS: AgentSpec[] = [
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
        runArgs: (prompt) => ['--no-session', '--approve', '-p', prompt],
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
        runArgs: (_prompt, vars) => ['-c', `mcp_servers.spur_interop=${vars.server ?? '{}'}`, 'app-server'],
        // A unique name prevents inherited stdio fields from being merged into the HTTP entry.
        config: (transport, target) => ({
            runVars: {
                server:
                    transport === 'http'
                        ? `{url=${JSON.stringify(target.url)},bearer_token_env_var=${JSON.stringify(TOKEN_ENV)}}`
                        : `{command=${JSON.stringify(target.stdio[0])},args=${JSON.stringify(target.stdio.slice(1))},env={SPUR_MCP_AUTH_ENV=${JSON.stringify(TOKEN_ENV)},SPUR_MCP_TOKEN=${JSON.stringify(TOKEN)}}}`,
            },
            method: 'per-invocation TOML override; native app-server ephemeral thread catalog and tool-call APIs',
            source: 'codex-cli 0.171.0: mcp get --json, app-server generate-ts (mcpServerStatus/list, mcpServer/tool/call)',
        }),
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
        runArgs: (prompt) => ['agent', '--local', '--session-id', crypto.randomUUID(), '--message', prompt],
        config: (transport, target, dir) => {
            const file = join(dir, `openclaw-${transport}.json`);
            const server =
                transport === 'http'
                    ? { url: target.url, headers: { Authorization: `Bearer \${${TOKEN_ENV}}` } }
                    : { command: target.stdio[0], args: target.stdio.slice(1) };
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
        config: (transport, target, dir) => ({
            files: {
                [join(dir, '.grok/config.toml')]:
                    `[mcp_servers.spur]\nenabled = true\n` +
                    (transport === 'http'
                        ? `url = ${JSON.stringify(target.url)}\n[mcp_servers.spur.headers]\nAuthorization = ${JSON.stringify(`Bearer ${TOKEN}`)}\n`
                        : `command = ${JSON.stringify(target.stdio[0])}\nargs = ${JSON.stringify(target.stdio.slice(1))}\n`),
            },
            method: 'project-local .grok/config.toml',
            source: 'grok mcp add --help (--scope project); native writer output verified for HTTP and stdio',
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
        join(home, '.grok', 'config.toml'),
        join(home, '.omp', 'agent', 'config.yml'),
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
export function startProxy(upstream: string, log?: ProxiedRequest[]) {
    return Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        async fetch(request) {
            const caseLog = log ?? activeLog;
            const url = new URL(request.url);
            if (!url.pathname.endsWith('/mcp')) return new Response('not found', { status: 404 });
            const body = await request.text();
            let method = request.headers.get('Mcp-Method') ?? '';
            let toolName = request.headers.get('Mcp-Name');
            let requestedRevision: string | null = null;
            try {
                const parsed = JSON.parse(body) as {
                    method?: unknown;
                    params?: { name?: string; protocolVersion?: string };
                };
                if (method === '' && typeof parsed.method === 'string') method = parsed.method;
                toolName ??= parsed.params?.name ?? null;
                requestedRevision = parsed.params?.protocolVersion ?? null;
            } catch {
                // Malformed bodies are forwarded unchanged for the server to reject.
            }
            const revision = request.headers.get('Mcp-Protocol-Version');
            const upstreamRes = await fetch(`${upstream}/mcp`, {
                method: request.method,
                headers: request.headers,
                body: request.method === 'GET' || request.method === 'HEAD' ? undefined : body,
            });
            const text = await upstreamRes.text();
            let errorCode: string | null = null;
            let toolCount: number | null = null;
            let responseOk = false;
            try {
                const payload = text.startsWith('event:')
                    ? (text
                          .split('\n')
                          .find((line) => line.startsWith('data: '))
                          ?.slice(6) ?? '')
                    : text;
                const parsed = JSON.parse(payload) as {
                    error?: { code?: unknown; errorCode?: string; data?: { code?: unknown } };
                    result?: { isError?: boolean; tools?: unknown[] };
                    isError?: boolean;
                    tools?: unknown[];
                };
                const code = parsed.error?.errorCode ?? parsed.error?.data?.code ?? parsed.error?.code;
                if (typeof code === 'string') errorCode = code;
                const result = parsed.result ?? parsed;
                responseOk = upstreamRes.ok && !parsed.error && result.isError !== true;
                if (method === 'tools/list' && responseOk && Array.isArray(result.tools))
                    toolCount = result.tools.length;
            } catch {
                // non-JSON is not a code
            }
            caseLog.push({
                method,
                revision,
                requestedRevision,
                status: upstreamRes.status,
                errorCode,
                toolName,
                toolCount,
                responseOk,
            });
            const responseHeaders = new Headers(upstreamRes.headers);
            // fetch decoded the body; retaining wire compression/length corrupts the next client's response.
            responseHeaders.delete('Content-Encoding');
            responseHeaders.delete('Content-Length');
            return new Response(text, { status: upstreamRes.status, headers: responseHeaders });
        },
    });
}

/** Classify one case from the proxy log plus the process outcome. */
export function classify(
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
    const called = entry.find((request) => request.method === 'tools/call' && request.toolName === 'sp_task_list');
    if (called?.responseOk && entry.some((request) => request.method === 'tools/list' && (request.toolCount ?? 0) > 0))
        return { classification: 'pass', callOutcome: 'pass' };
    if (called !== undefined) return { classification: 'call-failed', callOutcome: 'fail' };
    return { classification: timedOut || exitCode === null ? 'agent-error' : 'call-failed', callOutcome: 'fail' };
}

/** Exercise the installed Codex MCP client deterministically through its native app-server API. */
export async function runCodexClient(argv: string[], cwd: string, env: Record<string, string>): Promise<string> {
    const child = spawn({ cmd: argv, cwd, env, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
    const stderr = new Response(child.stderr).text();
    let nextId = 0;
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    const failPending = (error: Error) => {
        for (const entry of pending.values()) entry.reject(error);
        pending.clear();
    };
    const reader = (async () => {
        let buffer = '';
        const decoder = new TextDecoder();
        for await (const chunk of child.stdout) {
            buffer += decoder.decode(chunk, { stream: true });
            let newline = buffer.indexOf('\n');
            while (newline !== -1) {
                const line = buffer.slice(0, newline);
                buffer = buffer.slice(newline + 1);
                const message = JSON.parse(line) as { id?: number; result?: unknown; error?: { message: string } };
                if (message.id !== undefined) {
                    const entry = pending.get(message.id);
                    pending.delete(message.id);
                    if (message.error) entry?.reject(new Error(message.error.message));
                    else entry?.resolve(message.result);
                }
                newline = buffer.indexOf('\n');
            }
        }
        failPending(new Error('Codex app-server closed before responding'));
    })().catch((error: unknown) => failPending(error instanceof Error ? error : new Error(String(error))));
    const timer = setTimeout(() => {
        failPending(new Error(`Codex app-server timed out after ${CASE_TIMEOUT_MS}ms`));
        child.kill();
    }, CASE_TIMEOUT_MS);
    const call = (method: string, params: unknown): Promise<unknown> =>
        new Promise((resolveReply, reject) => {
            const id = ++nextId;
            pending.set(id, { resolve: resolveReply, reject });
            child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
        });
    try {
        await call('initialize', {
            clientInfo: { name: 'spur-interop', version: '1' },
            capabilities: { experimentalApi: true },
        });
        child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
        const started = (await call('thread/start', { cwd, ephemeral: true, sandbox: 'read-only' })) as {
            thread: { id: string };
        };
        const threadId = started.thread.id;
        const catalog = (await call('mcpServerStatus/list', { threadId, serverName: 'spur_interop' })) as {
            data: Array<{ tools: Record<string, unknown>; toolsError?: string | null }>;
        };
        const server = catalog.data[0];
        if (!server?.tools.sp_task_list) throw new Error(server?.toolsError ?? 'Codex MCP catalog has no sp_task_list');
        const result = (await call('mcpServer/tool/call', {
            threadId,
            server: 'spur_interop',
            tool: 'sp_task_list',
            arguments: {},
        })) as { isError?: boolean };
        if (result.isError) throw new Error('Codex sp_task_list returned a tool error');
        return `Codex app-server listed ${Object.keys(server.tools).length} tools and called sp_task_list`;
    } finally {
        clearTimeout(timer);
        child.kill();
        await child.exited;
        await reader;
        await stderr;
    }
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
        observedAt: new Date().toISOString(),
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
    let output: string;
    if (spec.id === 'codex') {
        try {
            output = await runCodexClient(argv, probe.dir, env);
            exitCode = 0;
        } catch (error) {
            output = error instanceof Error ? error.message : String(error);
            exitCode = 1;
        }
    } else {
        const child = spawn({ cmd: argv, cwd: probe.dir, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env });
        const collected = Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]).then(
            (parts) => parts.join(''),
        );
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, CASE_TIMEOUT_MS);
        exitCode = await child.exited;
        clearTimeout(timer);
        output = await collected;
    }
    output = redactProbeOutput(redactAndBound(output, [TOKEN, ...configuredSecretValues(env)], output.length));
    const observed = activeLog.slice();
    const verdict = classify(observed, exitCode, timedOut);
    // The tail only: enough to name a cause, never the whole transcript.
    const diagnostic = output.split('\n').filter((line) => /mcp|spur_interop|error|failed/i.test(line));
    const excerpt =
        `${timedOut ? `timed out after ${CASE_TIMEOUT_MS}ms: ` : ''}${diagnostic.slice(0, 4).join('\n').slice(0, 600)}\n${output.slice(-300)}`.trim() ||
        null;
    onRow({
        ...base,
        configMethod: config.method,
        configSource: config.source,
        clientRevision:
            observed.find((request) => request.requestedRevision !== null)?.requestedRevision ??
            observed.find((request) => request.revision !== null)?.revision ??
            null,
        requests: observed.slice(0, REQUEST_LOG_CAP),
        requestCount: observed.length,
        toolsSeen: observed.find((request) => request.toolCount !== null)?.toolCount ?? null,
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
    let globalConfigUnchanged: boolean | null = null;
    let completed = false;
    const rows = new Map<string, InteropRow>();
    for (const row of previous) {
        if (AGENTS.some((spec) => spec.id === row.agent)) rows.set(`${row.agent}:${row.transport}`, row);
    }

    const writeReceipt = (floor: string) => {
        mkdirSync(join(REPO_ROOT, 'docs/reports'), { recursive: true });
        writeFileSync(
            RECEIPT,
            `${JSON.stringify(
                {
                    artifact: 'mcp-agent-interop',
                    generatedAt: new Date().toISOString(),
                    serverProtocolFloor: floor,
                    completed,
                    globalConfigIntegrity: {
                        checkedPaths: Object.keys(before).length,
                        unchanged: globalConfigUnchanged,
                    },
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
                    const res = await fetch(`${root}/api/health`, { signal: AbortSignal.timeout(1_000) });
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
                    return Bun.spawnSync({
                        cmd: [spec.binary, '--version'],
                        stdout: 'pipe',
                        stderr: 'pipe',
                        timeout: 10_000,
                    });
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
                        proxyUrl: `http://127.0.0.1:${proxy.port}/mcp`,
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
        completed = true;
    } catch (error) {
        rows.set('harness:http', {
            agent: 'harness',
            version: '',
            observedAt: new Date().toISOString(),
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
    globalConfigUnchanged = changed.length === 0;
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
    if (!completed) return 1;
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
