import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
    IntegrationsAgentReadiness,
    IntegrationsAgentReadinessEntry,
    IntegrationsAgentReadinessState,
} from '@gobing-ai/spur-contracts';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { parse as parseYaml } from 'yaml';

/**
 * Read-only per-agent MCP readiness (1449 R4; design `docs/design/integrations-module.md` §2).
 *
 * Three passive signals, no fourth: an installed binary, the agent's OWN native config entry, and
 * `tools/call` traffic already attributed to that agent by `X-Spur-Actor`. Nothing here writes a
 * file, spawns a CLI or runs a turn — the module's read-only contract is what makes it safe to call
 * from a Board refresh.
 *
 * Every native format is the one `scripts/commands/mcp-agent-interop.ts` verified against the
 * installed binaries, so a state this probe reports `configured` is a shape an agent accepts.
 */

/** A native config entry as the probe reads it; only the shape it needs to classify. */
interface NativeEntry {
    transport: 'stdio' | 'http';
    url: string | null;
    command: string | null;
    /** Codex's own allowlist; any other agent leaves it undefined. */
    envVars?: string[];
}

/** One supported agent and where its native MCP entry lives. */
interface AgentSpec {
    id: string;
    label: string;
    binary: string;
    format: 'json' | 'toml' | 'yaml';
    /** Project-relative (`cwd`) or `~/`-rooted (`home`) config paths, in probe order. */
    paths: readonly string[];
    /** Where the entry sits in that format's tree. */
    entry: (document: unknown) => unknown;
    /** Actors `X-Spur-Actor` may report for this agent. */
    actors: readonly string[];
    /**
     * True when the client's MCP revision predates 2026-07-28: it can reach `spur mcp` over stdio but
     * not a direct HTTP endpoint (`docs/design/mcp-agent-adoption.md`).
     */
    legacyRevision: boolean;
    /** True when the agent passes no environment to a stdio child without an explicit allowlist. */
    needsEnvVars: boolean;
}

/** `mcpServers.spur` (Claude Code, pi, Gemini CLI). */
const jsonMcpServers = (document: unknown): unknown => read(document, ['mcpServers', 'spur']);
/** `mcp_servers.spur` (Codex, Grok, omp). */
const underscoredServers = (document: unknown): unknown => read(document, ['mcp_servers', 'spur']);
/** `mcp.spur` (OpenCode). */
const opencodeEntry = (document: unknown): unknown => read(document, ['mcp', 'spur']);
/** `mcp.servers.spur` (OpenClaw). */
const openclawEntry = (document: unknown): unknown => read(document, ['mcp', 'servers', 'spur']);

/** The agents this probe covers, in the Board's display order. */
export const READINESS_AGENTS: readonly AgentSpec[] = [
    {
        id: 'claude',
        label: 'Claude Code',
        binary: 'claude',
        format: 'json',
        paths: ['~/.claude.json', '.mcp.json'],
        entry: jsonMcpServers,
        actors: ['claude', 'claude-code'],
        legacyRevision: true,
        needsEnvVars: false,
    },
    {
        id: 'codex',
        label: 'Codex',
        binary: 'codex',
        format: 'toml',
        paths: ['~/.codex/config.toml'],
        entry: underscoredServers,
        actors: ['codex'],
        legacyRevision: true,
        needsEnvVars: true,
    },
    {
        id: 'gemini',
        label: 'Gemini CLI',
        binary: 'gemini',
        format: 'json',
        paths: ['~/.gemini/settings.json'],
        entry: jsonMcpServers,
        actors: ['gemini'],
        legacyRevision: false,
        needsEnvVars: false,
    },
    {
        id: 'pi',
        label: 'pi',
        binary: 'pi',
        format: 'json',
        paths: ['~/.pi/agent/mcp.json', '.pi/mcp.json'],
        entry: jsonMcpServers,
        actors: ['pi'],
        legacyRevision: true,
        needsEnvVars: false,
    },
    {
        id: 'omp',
        label: 'omp',
        binary: 'omp',
        format: 'yaml',
        paths: ['~/.omp/agent/config.yml'],
        entry: underscoredServers,
        actors: ['omp'],
        legacyRevision: false,
        needsEnvVars: false,
    },
    {
        id: 'opencode',
        label: 'OpenCode',
        binary: 'opencode',
        format: 'json',
        paths: ['opencode.json', '~/.config/opencode/opencode.json'],
        entry: opencodeEntry,
        actors: ['opencode'],
        legacyRevision: false,
        needsEnvVars: false,
    },
    {
        id: 'grok',
        label: 'Grok CLI',
        binary: 'grok',
        format: 'toml',
        paths: ['.grok/config.toml', '~/.grok/config.toml'],
        entry: underscoredServers,
        actors: ['grok'],
        legacyRevision: false,
        needsEnvVars: false,
    },
    {
        id: 'openclaw',
        label: 'OpenClaw',
        binary: 'openclaw',
        format: 'json',
        paths: ['~/.openclaw/openclaw.json', '~/.openclaw/config.json'],
        entry: openclawEntry,
        actors: ['openclaw'],
        legacyRevision: false,
        needsEnvVars: false,
    },
];

/** What the probe needs to know about the surfaces an entry should point at. */
export interface AgentReadinessSurface {
    mcpEnabled: boolean;
    /** The gateway port a `http://localhost:<port>/mcp` entry is expected to name. */
    gatewayPort: number;
    /** The project's own `/mcp` endpoint, when the surface is on. */
    projectUrl: string | null;
}

/** Injectable collaborators; nothing here is reached through a process global. */
export interface AgentMcpReadinessDeps {
    cwd: string;
    home?: string;
    fs: Pick<FileSystem, 'exists' | 'readFile'>;
    /** `which`-shaped lookup, resolved to an absolute path or null. */
    resolveBinary: (binary: string) => Promise<string | null> | string | null;
    /** Per-actor call attribution already folded from the event ledger. */
    usageActors: ReadonlyArray<{ actor: string; calls: number }>;
    surface: AgentReadinessSurface;
}

/** A path in the spec resolved against `cwd` or `home`. */
function resolvePath(path: string, deps: AgentMcpReadinessDeps): string {
    if (path.startsWith('~/')) return join(deps.home ?? homedir(), path.slice(2));
    return join(deps.cwd, path);
}

/** Safe nested read: an absent branch is `undefined`, never a throw. */
function read(document: unknown, keys: readonly string[]): unknown {
    let node = document;
    for (const key of keys) {
        if (node === null || typeof node !== 'object') return undefined;
        node = (node as Record<string, unknown>)[key];
    }
    return node;
}

/** One config document, or null when the file is absent or unparseable. */
async function readDocument(
    path: string,
    format: AgentSpec['format'],
    deps: AgentMcpReadinessDeps,
): Promise<{ document: unknown } | null> {
    try {
        if (!(await deps.fs.exists(path))) return null;
        const text = await deps.fs.readFile(path);
        if (format === 'toml') return { document: Bun.TOML.parse(text) };
        if (format === 'yaml') return { document: parseYaml(text) };
        return { document: JSON.parse(text) as unknown };
    } catch {
        // A malformed config is the agent's own problem, not a probe failure: treat it as no entry.
        return null;
    }
}

/** The entry's transport and target, or null when the value is not an object. */
function nativeEntry(value: unknown): NativeEntry | null {
    if (value === null || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const url =
        typeof record.url === 'string' ? record.url : typeof record.httpUrl === 'string' ? record.httpUrl : null;
    const command = Array.isArray(record.command)
        ? String(record.command[0] ?? '')
        : typeof record.command === 'string'
          ? record.command
          : null;
    if (url !== null) return { transport: 'http', url, command: null };
    if (command !== null && command !== '') {
        const envVars = Array.isArray(record.env_vars)
            ? record.env_vars.filter((v) => typeof v === 'string')
            : undefined;
        return { transport: 'stdio', url: null, command, ...(envVars === undefined ? {} : { envVars }) };
    }
    return null;
}

/** Calls attributed to any of one agent's actors. */
function observedCalls(spec: AgentSpec, actors: AgentMcpReadinessDeps['usageActors']): number {
    const names = new Set(spec.actors.map((actor) => actor.toLowerCase()));
    return actors.filter((row) => names.has(row.actor.toLowerCase())).reduce((sum, row) => sum + row.calls, 0);
}

/** Why one entry cannot work, in the operator's words; null when it can. */
function entryIssue(spec: AgentSpec, entry: NativeEntry, surface: AgentReadinessSurface): string | null {
    if (entry.transport === 'http') {
        if (spec.legacyRevision)
            return `${spec.label} speaks MCP before 2026-07-28, so a direct HTTP entry is rejected; point it at \`spur mcp\` instead`;
        const url = entry.url ?? '';
        if (!surface.mcpEnabled) return 'the MCP surface is off on this server';
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            return `the entry's url is not a URL: ${url}`;
        }
        if (parsed.pathname !== '/mcp') return `the entry points at ${parsed.pathname}, not /mcp`;
        const loopback = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
        const declaredPort = parsed.port === '' ? 80 : Number(parsed.port);
        if (loopback && parsed.pathname === '/mcp' && declaredPort !== surface.gatewayPort)
            return `the entry targets port ${declaredPort} but this server's gateway port is ${surface.gatewayPort}`;
        return null;
    }
    if (spec.needsEnvVars && (entry.envVars === undefined || entry.envVars.length === 0))
        return `${spec.label} passes no environment to a stdio child without \`env_vars\`, so \`spur mcp\` gets no token`;
    return null;
}

/** The remedy for one state, or null when nothing needs fixing. */
function remedyFor(
    spec: AgentSpec,
    state: IntegrationsAgentReadinessState,
    surface: AgentReadinessSurface,
): string | null {
    const target = surface.projectUrl ?? `http://localhost:${surface.gatewayPort}/mcp`;
    if (state === 'not-installed') return `install ${spec.binary} and re-run this check (docs/install.md)`;
    if (state === 'not-configured')
        return spec.legacyRevision
            ? `add a \`spur\` entry running \`spur mcp --url ${target}\` to ${spec.paths[0]}`
            : `add a \`spur\` entry pointing at ${target} to ${spec.paths[0]}`;
    return null;
}

/** Probe one agent: binary, native entry, traffic. */
async function probeAgent(spec: AgentSpec, deps: AgentMcpReadinessDeps): Promise<IntegrationsAgentReadinessEntry> {
    const installed = (await deps.resolveBinary(spec.binary)) !== null;
    const calls = observedCalls(spec, deps.usageActors);
    let configPath: string | null = null;
    let entry: NativeEntry | null = null;
    for (const raw of spec.paths) {
        const path = resolvePath(raw, deps);
        const document = await readDocument(path, spec.format, deps);
        if (document === null) continue;
        configPath = path;
        entry = nativeEntry(spec.entry(document.document));
        if (entry !== null) break;
    }
    const state = ((): IntegrationsAgentReadinessState => {
        if (!installed) return 'not-installed';
        if (entry === null) return 'not-configured';
        if (entryIssue(spec, entry, deps.surface) !== null) return 'misconfigured';
        return calls > 0 ? 'active' : 'configured';
    })();
    const issue = entry === null ? null : entryIssue(spec, entry, deps.surface);
    const detail = ((): string => {
        if (state === 'not-installed') return `${spec.binary} is not on PATH`;
        if (entry === null)
            return configPath === null
                ? `no native config at ${spec.paths.join(' or ')}`
                : `no \`spur\` entry in ${configPath}`;
        if (issue !== null) return issue;
        const where = entry.transport === 'stdio' ? `\`${entry.command ?? 'stdio'}\`` : (entry.url ?? '');
        return `${entry.transport} entry ${where} in ${configPath ?? 'native config'}${
            calls > 0 ? ` · ${calls} call${calls === 1 ? '' : 's'} in the last 24h` : ''
        }`;
    })();
    return {
        agent: spec.id,
        label: spec.label,
        state,
        transport: entry?.transport ?? null,
        configPath,
        detail,
        remedy: remedyFor(spec, state, deps.surface),
        observedCalls: calls,
    };
}

/**
 * Probe every supported agent. Never throws on a missing/unreadable config: "cannot read" degrades
 * to `not-configured` with the path named, which is the actionable fact either way.
 */
export async function probeAgentMcpReadiness(deps: AgentMcpReadinessDeps): Promise<IntegrationsAgentReadiness> {
    const agents = await Promise.all(READINESS_AGENTS.map((spec) => probeAgent(spec, deps)));
    return { available: true, agents };
}
