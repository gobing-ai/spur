/**
 * Supervisor-backed agent verbs and `task update --assignee` from the CLI boundary:
 * - `agent start|stop` POST to the `spur serve` supervisor and surface its errors.
 * - `agent list --specs` merges live run status from the server, falling back to stopped.
 * - `task update --assignee` writes frontmatter via TeamService.assignTask and persists
 *   `team.member.assigned` (0371 R6).
 */
import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TeamService } from '@gobing-ai/spur-app';
import { SystemEventDao, type SystemEventRow } from '@gobing-ai/spur-domain';
import { main } from '../../src';
import { resetAgentServerFetchForTesting, setAgentServerFetchForTesting } from '../../src/commands/agent';
import { createCliContext, createMigratedDbAdapter } from '../../src/context';
import { type CapturedOutput, createCapturedOutput } from '../helpers';

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

async function seedTaskAndSpec(cwd: string, taskId: string, specId: string): Promise<string> {
    const taskPath = join(cwd, 'docs', 'tasks', `${taskId}_demo.md`);
    await writeFile(taskPath, '---\nname: "Demo"\nstatus: Todo\n---\n\nbody\n');
    await new TeamService(createCliContext({ cwd, output: createCapturedOutput() })).createAgentSpec({
        id: specId,
        type: 'claude-code',
        purpose: 'plan it',
    });
    return taskPath;
}

async function readSystemEvents(cwd: string): Promise<SystemEventRow[]> {
    const db = await createMigratedDbAdapter(cwd);
    try {
        return await new SystemEventDao(db).query({ limit: 500 });
    } finally {
        await db.close();
    }
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
                    expect(calls).toEqual([{ url: 'http://x:1/api/team/agents/planner/start', method: 'POST' }]);
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
                    expect(calls).toEqual([
                        { url: 'http://localhost:3000/api/team/agents/planner/stop', method: 'POST' },
                    ]);
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

    for (const [verb, status, body, expected] of [
        ['start', 409, { error: 'agent disabled' }, /agent disabled/],
        ['start', 500, { detail: 'oops' }, /start failed: 500/],
        ['stop', 404, { error: 'agent not supervised' }, /agent not supervised/],
        ['stop', 500, { detail: 'oops' }, /stop failed: 500/],
    ] as const) {
        test(`${verb} surfaces a ${status} server error and exits 1`, async () => {
            const { cwd, out, cleanup } = await makeCtx();
            try {
                await withMockedFetch(
                    async () => jsonResponse(status, body),
                    async () => {
                        expect(await main(['agent', verb, 'planner'], { cwd, output: out, dbUrl: ':memory:' })).toBe(1);
                        expect(out.errors.join('\n')).toMatch(expected);
                    },
                );
            } finally {
                await cleanup();
            }
        });
    }

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

describe('spur agent list --specs live run-status merge', () => {
    test('merges running/stopped from the server into plain and JSON listings', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await seedTaskAndSpec(cwd, '0042', 'planner');
            await seedTaskAndSpec(cwd, '0043', 'worker-1');
            await withMockedFetch(
                async (url) => {
                    expect(String(url)).toBe('http://localhost:3000/api/team/processes');
                    return jsonResponse(200, {
                        processes: [
                            { agentId: 'planner', pid: 4132, status: 'running' },
                            { agentId: 'worker-1', pid: null, status: 'stopped' },
                        ],
                    });
                },
                async () => {
                    expect(await main(['agent', 'list', '--specs'], { cwd, output: out, dbUrl: ':memory:' })).toBe(0);
                    const lines = out.messages.at(-1)?.split('\n') ?? [];
                    expect(lines.find((l) => l.startsWith('planner\t'))).toContain('\trunning pid=4132');
                    expect(lines.find((l) => l.startsWith('worker-1\t'))?.endsWith('\tstopped')).toBe(true);
                    expect(out.errors).toHaveLength(0);

                    expect(
                        await main(['agent', 'list', '--specs', '--json'], { cwd, output: out, dbUrl: ':memory:' }),
                    ).toBe(0);
                    const specs =
                        (JSON.parse(out.messages.at(-1) ?? '{}') as { specs?: Array<{ id: string }> }).specs ?? [];
                    expect(specs.find((s) => s.id === 'planner')).toMatchObject({ status: 'running', pid: 4132 });
                    expect(specs.find((s) => s.id === 'worker-1')).toMatchObject({ status: 'stopped' });
                },
            );
        } finally {
            await cleanup();
        }
    });

    test('unreachable server falls back to stopped with a warning', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await seedTaskAndSpec(cwd, '0042', 'planner');
            await withMockedFetch(
                async () => {
                    throw new Error('ECONNREFUSED');
                },
                async () => {
                    expect(await main(['agent', 'list', '--specs'], { cwd, output: out, dbUrl: ':memory:' })).toBe(0);
                    expect(out.errors.at(-1)).toContain(
                        'Cannot reach server at http://localhost:3000/api — showing local specs as stopped.',
                    );
                    const line = (out.messages.at(-1) ?? '').split('\n').find((l) => l.startsWith('planner\t'));
                    expect(line?.endsWith('\tstopped')).toBe(true);
                },
            );
        } finally {
            await cleanup();
        }
    });
});

describe('spur task update --assignee', () => {
    test('writes the frontmatter through TeamService.assignTask and persists team.member.assigned', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const taskPath = await seedTaskAndSpec(cwd, '0042', 'planner');
            expect(await main(['task', 'update', '0042', '--assignee', 'planner'], { cwd, output: out })).toBe(0);
            expect(await readFile(taskPath, 'utf8')).toContain('assignee: planner');
            const assigned = (await readSystemEvents(cwd)).find((r) => r.event_name === 'team.member.assigned');
            expect(assigned?.payload_json).toContain('0042');
            expect(assigned?.payload_json).toContain('planner');
        } finally {
            await cleanup();
        }
    });

    test('rejects an id that fails the agent-id format with VALIDATION_FAILED (exit 2)', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['task', 'update', '0042', '--assignee', 'Bad Id!', '--json', '--json-envelope'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
            });
            expect(code).toBe(2);
            const payload = JSON.parse(out.messages.at(-1) ?? '{}') as { error?: { code?: string; message?: string } };
            expect(payload.error?.code).toBe('VALIDATION_FAILED');
            expect(payload.error?.message).toContain('Invalid agent spec id');
        } finally {
            await cleanup();
        }
    });

    test('rejects an unknown spec id (exit 2)', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['task', 'update', '0042', '--assignee', 'ghost'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
            });
            expect(code).toBe(2);
            expect(out.errors.at(-1)).toContain("Unknown agent spec 'ghost'");
        } finally {
            await cleanup();
        }
    });

    test('refuses to combine --assignee with --section (exit 2)', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['task', 'update', '0042', '--assignee', 'planner', '--section', 'Plan'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
            });
            expect(code).toBe(2);
            expect(out.errors.at(-1)).toContain('--assignee cannot be combined with --section');
        } finally {
            await cleanup();
        }
    });
});
