/**
 * Supervisor-backed agent verbs and `task update --assignee` from the CLI boundary:
 * - `agent start|stop` POST to the `spur serve` supervisor and surface its errors.
 * - `agent list --specs` merges live run status from the server, falling back to stopped.
 * - `task update --assignee` writes frontmatter via AgentCoordinationService.assignTask and persists
 *   `task.assigned` (0371 R6; renamed by 0860 R2).
 */
import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
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
    test('stop --json posts to the default server stop endpoint', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const calls: Array<{ url: string; method: string }> = [];
            await withMockedFetch(
                async (url, init) => {
                    calls.push({ url: String(url), method: init?.method ?? '' });
                    return jsonResponse(200, { ok: true });
                },
                async () => {
                    const code = await main(['agent', 'stop', 'planner', '--json'], {
                        cwd,
                        output: out,
                        dbUrl: ':memory:',
                    });
                    expect(code).toBe(0);
                    expect(calls).toEqual([{ url: 'http://localhost:3000/api/agents/planner/stop', method: 'POST' }]);
                    expect((JSON.parse(out.messages.at(-1) ?? '{}') as { ok?: boolean }).ok).toBe(true);
                },
            );
        } finally {
            await cleanup();
        }
    });
    test('stop prints the stopped line', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await withMockedFetch(
                async () => jsonResponse(200, { ok: true }),
                async () => {
                    expect(await main(['agent', 'stop', 'planner'], { cwd, output: out, dbUrl: ':memory:' })).toBe(0);
                    expect(out.messages.at(-1)).toBe('stopped planner');
                },
            );
        } finally {
            await cleanup();
        }
    });
});

describe('spur agent stop default-server resolution', () => {
    test('an unreadable project registry warns on stderr and falls back to the default server', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        const registryFile = join(cwd, 'projects.json');
        await writeFile(registryFile, '{not json');
        setEnvVar('SPUR_PROJECTS_FILE', registryFile);
        try {
            const calls: string[] = [];
            await withMockedFetch(
                async (url) => {
                    calls.push(String(url));
                    return jsonResponse(200, { ok: true, pid: 5, status: 'running' });
                },
                async () => {
                    const code = await main(['agent', 'stop', 'planner'], { cwd, output: out, dbUrl: ':memory:' });
                    expect(code).toBe(0);
                    expect(calls).toEqual(['http://localhost:3000/api/agents/planner/stop']);
                    expect(out.errors.join('\n')).toContain('project registry unreadable');
                },
            );
        } finally {
            removeEnvVar('SPUR_PROJECTS_FILE');
            await cleanup();
        }
    });
});
