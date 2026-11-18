import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startGateway } from '../src/gateway';
import { MIN_MCP_PROTOCOL_VERSION } from '../src/modules/mcp/protocol';

/**
 * Task 1382 — the gateway's own MCP entry at the root.
 *
 * A real listener over a fixture registry (no handler mocks): the point of the task is that `/mcp`
 * is the gateway's surface, not a project prefix routing to an upstream that does not exist.
 */
const TOKEN = 'gateway-mcp-token-1382';
const TOKEN_VAR = 'SPUR_E2E_GATEWAY_MCP_TOKEN';

interface Fixture {
    name: string;
    path: string;
    host?: string;
    prefix?: string;
}

function project(name: string, options: { manifest?: string; host?: string } = {}): Fixture {
    const path = mkdtempSync(join(tmpdir(), `gw-mcp-${name}-`));
    mkdirSync(join(path, 'docs', 'tasks'), { recursive: true });
    if (options.manifest !== undefined) {
        mkdirSync(join(path, 'plugins', 'fixture'), { recursive: true });
        writeFileSync(join(path, 'plugins', 'fixture', 'plugin.json'), JSON.stringify({ name: options.manifest }));
    }
    return { name, path, ...(options.host !== undefined ? { host: options.host } : {}) };
}

function rpc(method: string, params?: unknown): Record<string, unknown> {
    return { jsonrpc: '2.0', id: 1, method, ...(params === undefined ? {} : { params }) };
}

function headers(token?: string): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        'Mcp-Protocol-Version': MIN_MCP_PROTOCOL_VERSION,
        ...(token !== undefined ? { Authorization: `Bearer ${token}` } : {}),
    };
}

async function withGateway(
    options: {
        mcp?: { enabled: boolean; authEnv?: string; env?: Record<string, string | undefined> };
        projects?: Fixture[];
    },
    run: (url: string) => Promise<void>,
): Promise<void> {
    const projects = options.projects ?? [];
    const handle = startGateway({
        port: 0,
        host: '127.0.0.1',
        ...(options.mcp !== undefined ? { mcp: options.mcp } : {}),
        deps: {
            port: 0,
            listProjects: async () => projects as never,
            ensureUpstream: async () => {
                throw new Error('the gateway MCP entry must never proxy to a project');
            },
        },
    });
    try {
        await run(handle.url);
    } finally {
        handle.stop();
        for (const entry of projects) rmSync(entry.path, { recursive: true, force: true });
    }
}

const ENABLED = { enabled: true, authEnv: TOKEN_VAR, env: { [TOKEN_VAR]: TOKEN } };

describe('gateway MCP entry (task 1382)', () => {
    test('is a 404 when disabled — never a proxy attempt', async () => {
        await withGateway({ projects: [project('alpha')] }, async (url) => {
            const res = await fetch(`${url}/mcp`, { method: 'POST', headers: headers(), body: '{}' });
            expect(res.status).toBe(404);
        });
    });

    test('refuses a missing and a wrong token with the gateway realm', async () => {
        await withGateway({ mcp: ENABLED, projects: [project('alpha')] }, async (url) => {
            const missing = await fetch(`${url}/mcp`, {
                method: 'POST',
                headers: headers(),
                body: JSON.stringify(rpc('server/discover')),
            });
            expect(missing.status).toBe(401);
            expect(missing.headers.get('www-authenticate')).toContain('spur-gateway-mcp');

            const wrong = await fetch(`${url}/mcp`, {
                method: 'POST',
                headers: headers('not-the-token'),
                body: JSON.stringify(rpc('server/discover')),
            });
            expect(wrong.status).toBe(401);
        });
    });

    test('fails closed with 500 when the token variable is unset', async () => {
        await withGateway(
            {
                mcp: { enabled: true, authEnv: 'SPUR_E2E_MISSING_GATEWAY_TOKEN', env: {} },
                projects: [project('alpha')],
            },
            async (url) => {
                const res = await fetch(`${url}/mcp`, {
                    method: 'POST',
                    headers: headers(TOKEN),
                    body: JSON.stringify(rpc('server/discover')),
                });
                expect(res.status).toBe(500);
                const body = (await res.json()) as { error: { code: string } };
                expect(body.error.code).toBe('INTERNAL_ERROR');
            },
        );
    });

    test('a tool or resource request names the 1383 seam instead of failing silently', async () => {
        // 1382 ships discover only; the tool/resource surface is 1383's. The refusal must say so.
        await withGateway({ mcp: ENABLED, projects: [project('alpha')] }, async (url) => {
            const call = await fetch(`${url}/mcp`, {
                method: 'POST',
                headers: headers(TOKEN),
                body: JSON.stringify(rpc('tools/call', { name: 'sp_alpha_task_show', arguments: {} })),
            });
            expect(call.status).toBe(500);
            const callBody = (await call.json()) as { error: { message: string } };
            expect(callBody.error.message).toContain('no tools yet');

            const read = await fetch(`${url}/mcp`, {
                method: 'POST',
                headers: headers(TOKEN),
                body: JSON.stringify(rpc('resources/read', { uri: 'spur://tasks/1' })),
            });
            const readBody = (await read.json()) as { error: { message: string } };
            expect(readBody.error.message).toContain('no resources yet');
        });
    });

    test('discover lists local projects with namespaces and names remote exclusions (R3)', async () => {
        const local = project('alpha', { manifest: 'alphans' });
        const plain = project('beta');
        const remote = project('gamma', { host: 'remote.example.test' });
        await withGateway({ mcp: ENABLED, projects: [local, plain, remote] }, async (url) => {
            const res = await fetch(`${url}/mcp`, {
                method: 'POST',
                headers: headers(TOKEN),
                body: JSON.stringify(rpc('server/discover')),
            });
            expect(res.status).toBe(200);
            const body = (await res.json()) as {
                result: {
                    projects: Array<{ name: string; prefix: string; namespace: string | null }>;
                    diagnostics: Array<{ name: string; reason: string; remedy: string }>;
                };
            };
            const byName = new Map(body.result.projects.map((entry) => [entry.name, entry]));
            expect(byName.get('alpha')?.namespace).toBe('alphans');
            expect(byName.get('alpha')?.prefix).toBe('/alpha');
            expect(byName.get('beta')?.namespace).toBeNull();
            expect(byName.has('gamma')).toBe(false);

            const excluded = body.result.diagnostics.find((entry) => entry.name === 'gamma');
            expect(excluded?.reason).toContain('remote-not-proxied');
            expect(excluded?.remedy).toContain('spur projects add');
        });
    });
});
