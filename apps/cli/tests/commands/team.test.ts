import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main } from '../../src';
import { resetTeamFetchForTesting, setTeamFetchForTesting } from '../../src/commands/team';
import { type CapturedOutput, createCapturedOutput } from '../helpers';

/** Replace fetch with a stub for one test, restoring via resetTeamFetchForTesting. */
async function withMockedFetch(
    stub: (...args: Parameters<typeof fetch>) => Promise<Response>,
    fn: () => Promise<void>,
): Promise<void> {
    setTeamFetchForTesting(stub as typeof fetch);
    try {
        await fn();
    } finally {
        resetTeamFetchForTesting();
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
        await withMockedFetch(
            async () => jsonResponse(200, { processes: [], count: 0 }),
            async () => {
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
            },
        );
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
        await withMockedFetch(
            async () => jsonResponse(200, { processes: [], count: 0 }),
            async () => {
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
            },
        );
    });

    test('reflects live run status from the server supervisor', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        await withMockedFetch(
            async () =>
                jsonResponse(200, {
                    processes: [{ agentId: 'planner', pid: 4242, status: 'running', startedAt: 'x', exitCode: null }],
                    count: 1,
                }),
            async () => {
                try {
                    await main(['agent', 'create', '--type', 'claude-code', '--purpose', 'plan it', 'planner'], {
                        cwd,
                        output: out,
                        dbUrl: ':memory:',
                    });
                    out.messages.length = 0;
                    const code = await main(['team', 'status', '--json'], { cwd, output: out, dbUrl: ':memory:' });
                    expect(code).toBe(0);
                    const payload = JSON.parse(out.messages.at(-1) ?? '{}');
                    expect(payload.agents[0].id).toBe('planner');
                    expect(payload.agents[0].status).toBe('running');
                    expect(payload.agents[0].pid).toBe(4242);
                } finally {
                    await cleanup();
                }
            },
        );
    });

    test('falls back to local specs (stopped) when the server is unreachable', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        await withMockedFetch(
            async () => {
                throw new Error('ECONNREFUSED');
            },
            async () => {
                try {
                    await main(['agent', 'create', '--type', 'claude-code', '--purpose', 'plan it', 'planner'], {
                        cwd,
                        output: out,
                        dbUrl: ':memory:',
                    });
                    out.messages.length = 0;
                    const code = await main(['team', 'status'], { cwd, output: out, dbUrl: ':memory:' });
                    expect(code).toBe(0);
                    // Local spec still lists, but stays stopped without a live source.
                    expect(out.messages.join('\n')).toContain('stopped');
                    expect(out.errors.join('\n')).toMatch(/Cannot reach server/);
                } finally {
                    await cleanup();
                }
            },
        );
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

describe('spur team up/down/status --by-team (0258 R4)', () => {
    const TEAM_CONFIG = [
        'agent:',
        '  team:',
        '    alpha:',
        '      name: Alpha',
        '      work_dir: /tmp/alpha-ws',
        '      members:',
        '        - claude',
        '        - executor: codex',
        '          id: codex-reviewer',
        '',
    ].join('\n');

    async function seedTeam(cwd: string): Promise<void> {
        await mkdir(join(cwd, '.spur', 'agents'), { recursive: true });
        await writeFile(join(cwd, '.spur', 'config.yaml'), TEAM_CONFIG);
    }

    test('team up --check reports the diff without writing specs', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await seedTeam(cwd);
            const code = await main(['team', 'up', 'alpha', '--check', '--json'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
            });
            expect(code).toBe(0);
            const payload = JSON.parse(out.messages.join('')) as { upserted: string[]; written: boolean };
            expect(payload.written).toBe(false);
            expect(payload.upserted.sort()).toEqual(['alpha-claude', 'alpha-codex-reviewer']);
            expect(
                await readFile(join(cwd, '.spur', 'agents', 'alpha-claude.yaml'), 'utf8').catch(() => null),
            ).toBeNull();
        } finally {
            await cleanup();
        }
    });

    test('team up materializes generated specs (no autostart → no server call)', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await seedTeam(cwd);
            const code = await main(['team', 'up', 'alpha', '--json'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            const yaml = await readFile(join(cwd, '.spur', 'agents', 'alpha-claude.yaml'), 'utf8');
            expect(yaml).toContain('id: alpha-claude');
            expect(yaml).toContain('spur:generated');
            expect(yaml).toContain('team:alpha');
        } finally {
            await cleanup();
        }
    });

    test('team status --by-team groups specs under their team', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await seedTeam(cwd);
            await main(['team', 'up', 'alpha', '--json'], { cwd, output: out, dbUrl: ':memory:' });
            out.messages.length = 0;
            const code = await main(['team', 'status', '--by-team', '--json'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            const payload = JSON.parse(out.messages.join('')) as {
                teams: Array<{ teamId: string; specs: Array<{ id: string }> }>;
            };
            const alpha = payload.teams.find((t) => t.teamId === 'alpha');
            expect(alpha).toBeDefined();
            expect(alpha?.specs.map((s) => s.id).sort()).toEqual(['alpha-claude', 'alpha-codex-reviewer']);
        } finally {
            await cleanup();
        }
    });

    test('team down --purge removes generated specs (stop is best-effort)', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await seedTeam(cwd);
            await main(['team', 'up', 'alpha', '--json'], { cwd, output: out, dbUrl: ':memory:' });
            await withMockedFetch(
                async () => jsonResponse(200, { ok: true }),
                async () => {
                    const code = await main(['team', 'down', 'alpha', '--purge', '--json'], {
                        cwd,
                        output: out,
                        dbUrl: ':memory:',
                    });
                    expect(code).toBe(0);
                },
            );
            expect(
                await readFile(join(cwd, '.spur', 'agents', 'alpha-claude.yaml'), 'utf8').catch(() => null),
            ).toBeNull();
        } finally {
            await cleanup();
        }
    });

    test('team up on an unknown team surfaces the materialize error (catch path)', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await seedTeam(cwd);
            const code = await main(['team', 'up', 'ghost', '--json'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/not found in agent.team config/);
        } finally {
            await cleanup();
        }
    });

    test('team up best-effort-starts autostart members and prints a plain-text summary', async () => {
        const AUTOSTART_CONFIG = [
            'agent:',
            '  team:',
            '    alpha:',
            '      name: Alpha',
            '      work_dir: /tmp/alpha-ws',
            '      members:',
            '        - executor: claude',
            '          autostart: true',
            '',
        ].join('\n');
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await mkdir(join(cwd, '.spur', 'agents'), { recursive: true });
            await writeFile(join(cwd, '.spur', 'config.yaml'), AUTOSTART_CONFIG);
            await withMockedFetch(
                async () => jsonResponse(201, { ok: true, pid: 99, status: 'running' }),
                async () => {
                    const code = await main(['team', 'up', 'alpha'], { cwd, output: out, dbUrl: ':memory:' });
                    expect(code).toBe(0);
                    const text = out.messages.join('\n');
                    // Plain-text verb (not --check) + the autostart start note.
                    expect(text).toMatch(/materialized 1 member\(s\), prune 0, started 1/);
                },
            );
        } finally {
            await cleanup();
        }
    });

    test('team status --by-team prints a plain-text grouped block (formatTeamBlock)', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await seedTeam(cwd);
            await main(['team', 'up', 'alpha', '--json'], { cwd, output: out, dbUrl: ':memory:' });
            out.messages.length = 0;
            const code = await main(['team', 'status', '--by-team'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            const text = out.messages.join('\n');
            // Header carries the configured name; rows list the materialized specs.
            expect(text).toContain('# alpha (Alpha)');
            expect(text).toContain('alpha-claude');
            expect(text).toContain('alpha-codex-reviewer');
        } finally {
            await cleanup();
        }
    });

    test('team status --by-team reports an empty project plainly', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['team', 'status', '--by-team'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            expect(out.messages.join('\n')).toMatch(/No teams or agent specs found/);
        } finally {
            await cleanup();
        }
    });

    test('team stop surfaces a transport error when the server is unreachable', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        await withMockedFetch(
            async () => {
                throw new Error('ECONNREFUSED');
            },
            async () => {
                try {
                    const code = await main(['team', 'stop', 'planner'], { cwd, output: out, dbUrl: ':memory:' });
                    expect(code).toBe(1);
                    expect(out.errors.join('\n')).toMatch(/Cannot reach server/);
                    expect(out.errors.join('\n')).toMatch(/ECONNREFUSED/);
                } finally {
                    await cleanup();
                }
            },
        );
    });
});
