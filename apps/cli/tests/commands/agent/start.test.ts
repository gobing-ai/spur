/**
 * Supervisor-backed agent verbs and `task update --assignee` from the CLI boundary:
 * - `agent start|stop` POST to the `spur serve` supervisor and surface its errors.
 * - `agent list --specs` merges live run status from the server, falling back to stopped.
 * - `task update --assignee` writes frontmatter via AgentCoordinationService.assignTask and persists
 *   `task.assigned` (0371 R6; renamed by 0860 R2).
 */
import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../../src';
import { resetAgentServerFetchForTesting, setAgentServerFetchForTesting } from '../../../src/commands/agent';
import { type CapturedOutput, createCapturedOutput } from '../../helpers';

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function withMockedFetch(
    stub: (url: string, init: RequestInit) => Promise<Response>,
    fn: () => Promise<void>,
): Promise<void> {
    setAgentServerFetchForTesting(stub as typeof fetch);
    try {
        await fn();
    } finally {
        resetAgentServerFetchForTesting();
    }
}

async function makeCtx(): Promise<{ cwd: string; out: CapturedOutput; cleanup: () => Promise<void> }> {
    const cwd = await mkdtemp(join(tmpdir(), 'spur-agent-server-'));
    await mkdir(join(cwd, 'docs', 'tasks'), { recursive: true });
    const out = createCapturedOutput();
    return { cwd, out, cleanup: async () => rm(cwd, { recursive: true, force: true }) };
}

describe('spur agent start|stop', () => {
    test('start posts to the supervisor endpoint and prints the started line', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const calls: Array<{ url: string; method: string }> = [];
            await withMockedFetch(
                async (url, init) => {
                    calls.push({ url: String(url), method: init?.method ?? '' });
                    return jsonResponse(200, { ok: true, pid: 99, status: 'running' });
                },
                async () => {
                    const code = await main(['agent', 'start', 'planner', '--server', 'http://x:1/api'], {
                        cwd,
                        output: out,
                        dbUrl: ':memory:',
                    });
                    expect(code).toBe(0);
                    expect(calls).toEqual([{ url: 'http://x:1/api/agents/planner/start', method: 'POST' }]);
                    expect(out.messages.at(-1)).toBe('started planner (pid=99, status=running)');
                },
            );
        } finally {
            await cleanup();
        }
    });
    test('start --json emits the server body', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await withMockedFetch(
                async () => jsonResponse(201, { ok: true, pid: 7, status: 'running' }),
                async () => {
                    const code = await main(['agent', 'start', 'planner', '--json'], {
                        cwd,
                        output: out,
                        dbUrl: ':memory:',
                    });
                    expect(code).toBe(0);
                    expect(JSON.parse(out.messages.at(-1) ?? '{}')).toMatchObject({ ok: true, pid: 7 });
                },
            );
        } finally {
            await cleanup();
        }
    });
    test('unreachable server exits 1 naming spur serve', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await withMockedFetch(
                async () => {
                    throw new Error('ECONNREFUSED');
                },
                async () => {
                    expect(await main(['agent', 'start', 'planner'], { cwd, output: out, dbUrl: ':memory:' })).toBe(1);
                    expect(out.errors.at(-1)).toMatch(/Cannot reach server at .* — is spur serve running\?/);
                },
            );
        } finally {
            await cleanup();
        }
    });
});
