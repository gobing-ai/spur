import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src';
import { type CapturedOutput, createCapturedOutput } from '../helpers';

/** Replace `globalThis.fetch` with a stub for one test, restoring the previous value. */
async function withMockedFetch(
    stub: (...args: Parameters<typeof fetch>) => Promise<Response>,
    fn: () => Promise<void>,
): Promise<void> {
    const original = globalThis.fetch;
    globalThis.fetch = stub as typeof fetch;
    try {
        await fn();
    } finally {
        globalThis.fetch = original;
    }
}

/** JSON response helper for the mock fetch. */
function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

async function makeCtx(): Promise<{
    cwd: string;
    out: CapturedOutput;
    cleanup: () => Promise<void>;
}> {
    const cwd = await mkdtemp(join(tmpdir(), 'spur-team-cli-'));
    const out = createCapturedOutput();
    return { cwd, out, cleanup: async () => rm(cwd, { recursive: true, force: true }) };
}

describe('spur team assign', () => {
    test('sets assignee in the task frontmatter', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const tasksDir = join(cwd, 'docs', 'tasks');
            await mkdir(tasksDir, { recursive: true });
            const taskPath = join(tasksDir, '0042_demo.md');
            await writeFile(taskPath, '---\nname: "Demo"\nstatus: Todo\n---\n\nbody\n');

            const code = await main(['team', 'assign', '0042', 'planner'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            const updated = await readFile(taskPath, 'utf8');
            expect(updated).toContain('assignee: planner');
            expect(out.messages.join('\n')).toMatch(/assigned 0042 → planner/);
        } finally {
            await cleanup();
        }
    });

    test('requires both task id and agent id', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['team', 'assign', '0042'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/missing required argument/);
        } finally {
            await cleanup();
        }
    });

    test('surfaces a missing task file as a clean exit 1', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['team', 'assign', '9999', 'planner'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/No task file found/);
        } finally {
            await cleanup();
        }
    });
});

describe('spur team status', () => {
    test('lists created specs as stopped', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await main(['agent', 'create', '--type', 'claude-code', '--purpose', 'plan it', 'planner'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
            });
            const code = await main(['team', 'status', '--json'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            const payload = JSON.parse(out.messages.at(-1) ?? '{}');
            expect(payload.agents).toHaveLength(1);
            expect(payload.agents[0].id).toBe('planner');
            expect(payload.agents[0].status).toBe('stopped');
        } finally {
            await cleanup();
        }
    });

    test('reports no specs on an empty project', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['team', 'status'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            expect(out.messages.join('\n')).toMatch(/No agent specs found/);
        } finally {
            await cleanup();
        }
    });

    test('plain-text status formats one row per spec', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await main(['agent', 'create', '--type', 'codex', '--purpose', 'write code', 'coder'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
            });
            const code = await main(['team', 'status'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            const line = out.messages.at(-1) ?? '';
            // status \t id \t type \t purpose
            expect(line).toContain('stopped');
            expect(line).toContain('coder');
            expect(line).toContain('write code');
        } finally {
            await cleanup();
        }
    });
});

describe('spur team start/stop (task 0195/0209)', () => {
    test('start requires an agent-id argument', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['team', 'start'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/agent-id/);
        } finally {
            await cleanup();
        }
    });

    test('stop requires an agent-id argument', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['team', 'stop'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/agent-id/);
        } finally {
            await cleanup();
        }
    });

    test('start with no server running surfaces connection error', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['team', 'start', 'planner', '--server', 'http://127.0.0.1:1/api'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
            });
            // Fails because nothing is listening on port 1.
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/Cannot reach server/);
        } finally {
            await cleanup();
        }
    });

    test('rejects an unknown subcommand', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['team', 'bogus'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/unknown command/);
        } finally {
            await cleanup();
        }
    });
});

describe('spur team start/stop happy paths (coverage)', () => {
    test('start prints plain text when server returns ok', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        await withMockedFetch(
            async () => jsonResponse(201, { ok: true, pid: 4242, status: 'running' }),
            async () => {
                try {
                    const code = await main(['team', 'start', 'planner'], { cwd, output: out, dbUrl: ':memory:' });
                    expect(code).toBe(0);
                    expect(out.messages.join('\n')).toMatch(/started planner \(pid=4242, status=running\)/);
                } finally {
                    await cleanup();
                }
            },
        );
    });

    test('start emits JSON when server returns ok and --json is set', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        await withMockedFetch(
            async () => jsonResponse(201, { ok: true, pid: 7, status: 'running' }),
            async () => {
                try {
                    const code = await main(['team', 'start', 'planner', '--json'], {
                        cwd,
                        output: out,
                        dbUrl: ':memory:',
                    });
                    expect(code).toBe(0);
                    const parsed = JSON.parse(out.messages.join('\n')) as { ok?: boolean; pid?: number };
                    expect(parsed.ok).toBe(true);
                    expect(parsed.pid).toBe(7);
                } finally {
                    await cleanup();
                }
            },
        );
    });

    test('start surfaces server-side error message verbatim', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        await withMockedFetch(
            async () => jsonResponse(409, { error: 'agent disabled' }),
            async () => {
                try {
                    const code = await main(['team', 'start', 'planner'], { cwd, output: out, dbUrl: ':memory:' });
                    expect(code).toBe(1);
                    expect(out.errors.join('\n')).toMatch(/agent disabled/);
                } finally {
                    await cleanup();
                }
            },
        );
    });

    test('start falls back to status when server returns non-OK without body.error', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        await withMockedFetch(
            async () => jsonResponse(500, { detail: 'oops' }),
            async () => {
                try {
                    const code = await main(['team', 'start', 'planner'], { cwd, output: out, dbUrl: ':memory:' });
                    expect(code).toBe(1);
                    expect(out.errors.join('\n')).toMatch(/start failed: 500/);
                } finally {
                    await cleanup();
                }
            },
        );
    });

    test('stop prints plain text when server returns ok', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        await withMockedFetch(
            async () => jsonResponse(200, { ok: true }),
            async () => {
                try {
                    const code = await main(['team', 'stop', 'planner'], { cwd, output: out, dbUrl: ':memory:' });
                    expect(code).toBe(0);
                    expect(out.messages.join('\n')).toMatch(/stopped planner/);
                } finally {
                    await cleanup();
                }
            },
        );
    });

    test('stop emits JSON when server returns ok and --json is set', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        await withMockedFetch(
            async () => jsonResponse(200, { ok: true }),
            async () => {
                try {
                    const code = await main(['team', 'stop', 'planner', '--json'], {
                        cwd,
                        output: out,
                        dbUrl: ':memory:',
                    });
                    expect(code).toBe(0);
                    const parsed = JSON.parse(out.messages.join('\n')) as { ok?: boolean };
                    expect(parsed.ok).toBe(true);
                } finally {
                    await cleanup();
                }
            },
        );
    });

    test('stop surfaces server-side error message verbatim', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        await withMockedFetch(
            async () => jsonResponse(404, { error: 'agent not supervised' }),
            async () => {
                try {
                    const code = await main(['team', 'stop', 'planner'], { cwd, output: out, dbUrl: ':memory:' });
                    expect(code).toBe(1);
                    expect(out.errors.join('\n')).toMatch(/agent not supervised/);
                } finally {
                    await cleanup();
                }
            },
        );
    });

    test('stop falls back to status when server returns non-OK without body.error', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        await withMockedFetch(
            async () => jsonResponse(500, { detail: 'oops' }),
            async () => {
                try {
                    const code = await main(['team', 'stop', 'planner'], { cwd, output: out, dbUrl: ':memory:' });
                    expect(code).toBe(1);
                    expect(out.errors.join('\n')).toMatch(/stop failed: 500/);
                } finally {
                    await cleanup();
                }
            },
        );
    });
});
