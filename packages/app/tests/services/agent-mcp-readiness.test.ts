/**
 * Read-only per-agent MCP readiness (1449 R4).
 *
 * The failure modes this pins: a state that lies (installed-but-unconfigured read as ready), a probe
 * that touches an agent's config, and a convenience shortcut that carries a token value into the
 * response. Every case below is built from real files in a temp HOME so nothing is simulated that
 * the production path does differently.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { type AgentMcpReadinessDeps, probeAgentMcpReadiness } from '../../src/services/agent-mcp-readiness';

const TOKEN_VALUE = 'mcp-token-value-that-must-not-leak-9f2a';
const GATEWAY_PORT = 3070;
const roots: string[] = [];

/** One temp workspace: a project cwd plus a HOME the probe reads through. */
function workspace(): { cwd: string; home: string } {
    const root = mkdtempSync(join(tmpdir(), 'spur-readiness-'));
    roots.push(root);
    const cwd = join(root, 'project');
    const home = join(root, 'home');
    mkdirSync(cwd, { recursive: true });
    mkdirSync(home, { recursive: true });
    return { cwd, home };
}

/** Write one config file, creating its directory. */
function write(path: string, body: string): void {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, body);
}

/** sha256 of every file under a root, so "the probe wrote nothing" is provable. */
function fingerprint(root: string): Record<string, string> {
    const out: Record<string, string> = {};
    const walk = (dir: string): void => {
        for (const entry of readdirSync(dir)) {
            const path = join(dir, entry);
            if (statSync(path).isDirectory()) walk(path);
            else out[path] = createHash('sha256').update(readFileSync(path)).digest('hex');
        }
    };
    walk(root);
    return out;
}

afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function deps(cwd: string, home: string, overrides: Partial<AgentMcpReadinessDeps> = {}): AgentMcpReadinessDeps {
    return {
        cwd,
        home,
        fs: createNodeFileSystem(cwd),
        resolveBinary: async (binary) => `/${binary}`,
        usageActors: [],
        surface: {
            mcpEnabled: true,
            gatewayMcpEnabled: true,
            gatewayPort: GATEWAY_PORT,
            projectUrl: `http://localhost:${GATEWAY_PORT}/mcp`,
        },
        ...overrides,
    };
}

describe('1449 — the five readiness states', () => {
    test('each agent reads its own state, with a detail and a remedy where one is needed', async () => {
        const { cwd, home } = workspace();
        write(
            join(home, '.claude.json'),
            JSON.stringify({
                mcpServers: { spur: { type: 'stdio', command: 'spur', args: ['mcp', '--gateway'] } },
            }),
        );
        // Codex without `env_vars` cannot hand the bridge a token.
        write(
            join(home, '.codex', 'config.toml'),
            `[mcp_servers.spur]\ncommand = "spur"\nargs = ["mcp", "--gateway"]\n`,
        );
        write(
            join(home, '.gemini', 'settings.json'),
            JSON.stringify({ mcpServers: { spur: { httpUrl: `http://localhost:${GATEWAY_PORT}/mcp` } } }),
        );
        // Grok points at a port this server is not listening on.
        write(join(cwd, '.grok', 'config.toml'), `[mcp_servers.spur]\nurl = "http://localhost:9999/mcp"\n`);
        write(
            join(home, '.omp', 'agent', 'config.yml'),
            'mcp_servers:\n  spur:\n    command: spur\n    args:\n      - mcp\n      - --gateway\n',
        );

        const result = await probeAgentMcpReadiness(
            deps(cwd, home, {
                resolveBinary: async (binary) => (binary === 'omp' || binary === 'opencode' ? null : `/${binary}`),
                // Passive traffic is what separates `configured` from `active`.
                usageActors: [
                    { actor: 'claude-code', calls: 4 },
                    { actor: 'Claude', calls: 1 },
                ],
            }),
        );
        const state = Object.fromEntries(result.agents.map((entry) => [entry.agent, entry]));

        expect(result.available).toBe(true);
        expect(state.claude?.state).toBe('active');
        expect(state.claude?.observedCalls).toBe(5);
        expect(state.claude?.transport).toBe('stdio');

        expect(state.codex?.state).toBe('misconfigured');
        expect(state.codex?.detail).toContain('env_vars');
        expect(state.codex?.remedy).toBeNull();

        expect(state.gemini?.state).toBe('configured');
        expect(state.gemini?.transport).toBe('http');

        expect(state.pi?.state).toBe('not-configured');
        expect(state.pi?.remedy).toContain('spur mcp --url');

        expect(state.grok?.state).toBe('misconfigured');
        expect(state.grok?.detail).toContain('port 9999');
        expect(state.grok?.detail).toContain(`gateway port is ${GATEWAY_PORT}`);

        expect(state.omp?.state).toBe('not-installed');
        expect(state.omp?.remedy).toContain('install omp');

        expect(state.opencode?.state).toBe('not-installed');
    });

    test('a legacy-revision client defaults to a stdio remedy, and an HTTP entry is a misconfiguration', async () => {
        const { cwd, home } = workspace();
        write(
            join(home, '.claude.json'),
            JSON.stringify({ mcpServers: { spur: { type: 'http', url: `http://localhost:${GATEWAY_PORT}/mcp` } } }),
        );
        const result = await probeAgentMcpReadiness(deps(cwd, home));
        const claude = result.agents.find((entry) => entry.agent === 'claude');
        expect(claude?.state).toBe('misconfigured');
        expect(claude?.detail).toContain('2026-07-28');
        expect(claude?.detail).toContain('spur mcp');
    });

    test('the OpenClaw entry is read from openclaw.json, the file its own CLI writes', async () => {
        const { cwd, home } = workspace();
        // `openclaw mcp add` saves to ~/.openclaw/openclaw.json; a probe reading config.json there
        // reports "no native config" for an agent that is in fact configured.
        write(
            join(home, '.openclaw', 'openclaw.json'),
            JSON.stringify({ mcp: { servers: { spur: { command: 'spur', args: ['mcp', '--gateway'] } } } }),
        );
        const result = await probeAgentMcpReadiness(deps(cwd, home));
        const openclaw = result.agents.find((entry) => entry.agent === 'openclaw');
        expect(openclaw?.state).toBe('configured');
        expect(openclaw?.configPath).toBe(join(home, '.openclaw', 'openclaw.json'));
    });

    test('an off project surface makes an entry pointing at /mcp a misconfiguration', async () => {
        const { cwd, home } = workspace();
        write(
            join(home, '.gemini', 'settings.json'),
            JSON.stringify({ mcpServers: { spur: { httpUrl: `http://localhost:${GATEWAY_PORT}/mcp` } } }),
        );
        const result = await probeAgentMcpReadiness(
            deps(cwd, home, {
                surface: { mcpEnabled: false, gatewayMcpEnabled: false, gatewayPort: GATEWAY_PORT, projectUrl: null },
            }),
        );
        expect(result.agents.find((entry) => entry.agent === 'gemini')?.state).toBe('misconfigured');
    });
});

describe('1449 — the probe is read-only and never carries a token', () => {
    test('no agent config file moves, and no token value reaches the result', async () => {
        const { cwd, home } = workspace();
        write(
            join(home, '.claude.json'),
            JSON.stringify({
                mcpServers: { spur: { type: 'stdio', command: 'spur', args: ['mcp', '--gateway'] } },
                token: TOKEN_VALUE,
            }),
        );
        write(join(home, '.codex', 'config.toml'), `[mcp_servers.spur]\ncommand = "spur"\n`);
        const before = { home: fingerprint(home), cwd: fingerprint(cwd) };
        const result = await probeAgentMcpReadiness(deps(cwd, home));
        expect({ home: fingerprint(home), cwd: fingerprint(cwd) }).toEqual(before);
        expect(JSON.stringify(result)).not.toContain(TOKEN_VALUE);
    });

    test('a malformed config file degrades to not-configured rather than throwing', async () => {
        const { cwd, home } = workspace();
        write(join(home, '.gemini', 'settings.json'), '{ this is not json');
        const result = await probeAgentMcpReadiness(deps(cwd, home));
        const gemini = result.agents.find((entry) => entry.agent === 'gemini');
        expect(gemini?.state).toBe('not-configured');
        expect(gemini?.configPath).toBeNull();
    });
});
