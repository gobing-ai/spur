/**
 * Task 0848 — `spur team` noun retirement (feature G64).
 *
 * Every `spur team` capability moved to its owning noun; this file pins the moved
 * seams from the CLI boundary:
 * - R1: the owning nouns registered the moved verbs/flags (`agent start|stop`,
 *   `task update --assignee`, `agent list --server`).
 * - R2/R3: `agent start|stop` hit the same supervisor endpoints with the same
 *   error text as the deprecated `team start|stop` (moved, not copied).
 * - R5: the one-time stderr retirement warning names the replacement and fires
 *   once per process; the shim is two-sided (source marker + manifest entry).
 * - R6: `agent list --specs` merges live run status exactly like `team status`.
 * - R1: `task update --assignee` writes the frontmatter through the same
 *   TeamService.assignTask and persists `team.member.assigned` (0371 R6).
 */
import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SystemEventDao, type SystemEventRow } from '@gobing-ai/spur-domain';
import { buildProgram, main } from '../../src';
import {
    resetTeamFetchForTesting,
    resetTeamNounRetiredWarningForTesting,
    setTeamFetchForTesting,
} from '../../src/commands/team';
import { createCliContext, createMigratedDbAdapter } from '../../src/context';
import { type CapturedOutput, createCapturedOutput } from '../helpers';

const SHIM_MARKER = '@transition-shim(team-noun-retired)';

/** JSON response helper for the mock fetch. */
function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

/** Replace fetch with a capturing stub for one test, restoring via resetTeamFetchForTesting. */
async function withMockedFetch(
    stub: (url: string, init: RequestInit) => Promise<Response>,
    fn: () => Promise<void>,
): Promise<void> {
    setTeamFetchForTesting(stub as typeof fetch);
    try {
        await fn();
    } finally {
        resetTeamFetchForTesting();
    }
}

async function makeCtx(): Promise<{
    cwd: string;
    out: CapturedOutput;
    cleanup: () => Promise<void>;
}> {
    const cwd = await mkdtemp(join(tmpdir(), 'spur-team-retire-'));
    await mkdir(join(cwd, 'docs', 'tasks'), { recursive: true });
    const out = createCapturedOutput();
    return { cwd, out, cleanup: async () => rm(cwd, { recursive: true, force: true }) };
}

/** Seed one task file and one agent spec, like the 0371/0544 fixtures do. */
async function seedTaskAndSpec(cwd: string, taskId: string, specId: string): Promise<string> {
    const taskPath = join(cwd, 'docs', 'tasks', `${taskId}_demo.md`);
    await writeFile(taskPath, '---\nname: "Demo"\nstatus: Todo\n---\n\nbody\n');
    const create = await main(['agent', 'create', '--type', 'claude-code', '--purpose', 'plan it', specId], {
        cwd,
        output: createCapturedOutput(),
        dbUrl: ':memory:',
    });
    if (create !== 0) throw new Error(`agent create failed with ${create}`);
    return taskPath;
}

/** Read every system_events row from the workspace ledger (same sink the Board reads). */
async function readSystemEvents(cwd: string): Promise<SystemEventRow[]> {
    const db = await createMigratedDbAdapter(cwd);
    try {
        return await new SystemEventDao(db).query({ limit: 500 });
    } finally {
        await db.close();
    }
}

/** Navigate the commander tree the dispatcher actually registers. */
// Structural type sidesteps commander's generic variance (Command<[], {}, {}> is
// not assignable to the bare Command type under the installed commander version).
type AnyCommand = {
    commands: readonly AnyCommand[];
    name(): string;
    options: readonly { long?: string }[];
};

function findNoun(program: AnyCommand, name: string): AnyCommand | undefined {
    return program.commands.find((c) => c.name() === name);
}

function findVerb(noun: AnyCommand | undefined, name: string): AnyCommand | undefined {
    return noun?.commands.find((c) => c.name() === name);
}

function hasOption(cmd: AnyCommand | undefined, long: string): boolean {
    return cmd?.options.some((o) => o.long === long) ?? false;
}

describe('0848 R1 — moved verbs/flags registered on owning nouns', () => {
    test('team keeps all six verbs (shim still active), agent owns start/stop, task update owns --assignee', () => {
        const out = createCapturedOutput();
        const program = buildProgram(createCliContext({ output: out }), out);
        const team = findNoun(program, 'team');
        const teamVerbs = team?.commands.map((c) => c.name()).sort();
        expect(teamVerbs).toEqual(['assign', 'down', 'start', 'status', 'stop', 'up']);

        const agent = findNoun(program, 'agent');
        expect(findVerb(agent, 'start')).toBeDefined();
        expect(findVerb(agent, 'stop')).toBeDefined();
        const list = findVerb(agent, 'list');
        expect(hasOption(list, '--server')).toBe(true);

        const taskUpdate = findVerb(findNoun(program, 'task'), 'update');
        expect(hasOption(taskUpdate, '--assignee')).toBe(true);
    });
});

describe('0848 R5 — one-time noun retirement warning', () => {
    test('warns once per process naming the replacement; the verb still works', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        resetTeamNounRetiredWarningForTesting();
        try {
            await seedTaskAndSpec(cwd, '0042', 'planner');

            const first = await main(['team', 'assign', '0042', 'planner'], { cwd, output: out, dbUrl: ':memory:' });
            expect(first).toBe(0);
            expect(out.errors).toHaveLength(1);
            expect(out.errors[0]).toMatch(/warning: `spur team assign` is deprecated/);
            expect(out.errors[0]).toContain('spur task update <wbs> --assignee <spec-id>');
            const updated = await readFile(join(cwd, 'docs', 'tasks', '0042_demo.md'), 'utf8');
            expect(updated).toContain('assignee: planner');

            // Same process, different verb: the one-time flag suppresses the second warning.
            const before = out.errors.length;
            const second = await main(['team', 'status'], { cwd, output: out, dbUrl: ':memory:' });
            expect(second).toBe(0);
            expect(out.errors.length).toBe(before);

            // After the reset seam, the warning returns and names THIS verb's replacement.
            resetTeamNounRetiredWarningForTesting();
            const third = await main(['team', 'status'], { cwd, output: out, dbUrl: ':memory:' });
            expect(third).toBe(0);
            expect(out.errors.length).toBe(before + 1);
            expect(out.errors.at(-1)).toContain('spur agent list --specs');
        } finally {
            resetTeamNounRetiredWarningForTesting();
            await cleanup();
        }
    });

    test('warning goes to stderr only and every verb names its own replacement', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        resetTeamNounRetiredWarningForTesting();
        try {
            await seedTaskAndSpec(cwd, '0042', 'planner');
            const code = await main(['team', 'assign', '0042', 'planner'], { cwd, output: out, dbUrl: ':memory:' });
            expect(code).toBe(0);
            expect(out.errors).toHaveLength(1);
            // stdout carries only the command's normal output, never the warning.
            expect(out.messages.at(-1)).toMatch(/assigned 0042 → planner/);

            resetTeamNounRetiredWarningForTesting();
            await withMockedFetch(
                async () => {
                    throw new Error('ECONNREFUSED');
                },
                async () => {
                    resetTeamNounRetiredWarningForTesting();
                    const stopCode = await main(['team', 'stop', 'planner'], { cwd, output: out, dbUrl: ':memory:' });
                    expect(stopCode).toBe(1);
                    const stopWarning = out.errors.find((m) => m.includes('spur team stop'));
                    expect(stopWarning).toContain('spur agent stop <spec-id>');
                },
            );
        } finally {
            resetTeamNounRetiredWarningForTesting();
            await cleanup();
        }
    });
});

describe('0848 R2/R3 — spur agent start/stop parity with team start/stop', () => {
    test('agent start posts to the same supervisor endpoint and prints the started line', async () => {
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

    test('agent stop posts to the stop endpoint and prints the stopped line', async () => {
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
                    const payload = JSON.parse(out.messages.at(-1) ?? '{}') as { ok?: boolean };
                    expect(payload.ok).toBe(true);
                },
            );
        } finally {
            await cleanup();
        }
    });

    test('unreachable server: agent start matches the team start error text and exit code', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await withMockedFetch(
                async () => {
                    throw new Error('ECONNREFUSED');
                },
                async () => {
                    const agentErrors: string[] = [];
                    const agentOut = { ...out, error: (m: string) => agentErrors.push(m) };
                    const agentCode = await main(['agent', 'start', 'planner'], {
                        cwd,
                        output: agentOut,
                        dbUrl: ':memory:',
                    });
                    expect(agentCode).toBe(1);

                    resetTeamNounRetiredWarningForTesting();
                    const teamErrors: string[] = [];
                    const teamOut = { ...out, error: (m: string) => teamErrors.push(m) };
                    const teamCode = await main(['team', 'start', 'planner'], {
                        cwd,
                        output: teamOut,
                        dbUrl: ':memory:',
                    });
                    expect(teamCode).toBe(1);

                    // R2: moved, not copied — the transport failure surfaces identically.
                    expect(agentErrors.at(-1)).toBe(teamErrors.at(-1));
                    expect(agentErrors.at(-1)).toMatch(/Cannot reach server at .* — is spur serve running\?/);
                },
            );
        } finally {
            await cleanup();
        }
    });
});

describe('0848 R6 — agent list --specs live run-status merge', () => {
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
                    const code = await main(['agent', 'list', '--specs'], { cwd, output: out, dbUrl: ':memory:' });
                    expect(code).toBe(0);
                    const lines = out.messages.at(-1)?.split('\n') ?? [];
                    const planner = lines.find((l) => l.startsWith('planner\t'));
                    const worker = lines.find((l) => l.startsWith('worker-1\t'));
                    expect(planner).toBeDefined();
                    expect(planner).toContain('\trunning pid=4132');
                    expect(worker).toBeDefined();
                    expect(worker?.endsWith('\tstopped')).toBe(true);
                    expect(out.errors).toHaveLength(0);

                    const jsonCode = await main(['agent', 'list', '--specs', '--json'], {
                        cwd,
                        output: out,
                        dbUrl: ':memory:',
                    });
                    expect(jsonCode).toBe(0);
                    const payload = JSON.parse(out.messages.at(-1) ?? '{}') as {
                        specs?: Array<{ id: string; status?: string; pid?: number }>;
                    };
                    const specs = payload.specs ?? [];
                    expect(specs.find((s) => s.id === 'planner')).toMatchObject({ status: 'running', pid: 4132 });
                    expect(specs.find((s) => s.id === 'worker-1')).toMatchObject({ status: 'stopped' });
                },
            );
        } finally {
            await cleanup();
        }
    });

    test('unreachable server falls back to stopped with the same warning as team status', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            await seedTaskAndSpec(cwd, '0042', 'planner');
            await withMockedFetch(
                async () => {
                    throw new Error('ECONNREFUSED');
                },
                async () => {
                    const code = await main(['agent', 'list', '--specs'], { cwd, output: out, dbUrl: ':memory:' });
                    expect(code).toBe(0);
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

describe('0848 R1 — task update --assignee (moved home of team assign)', () => {
    test('writes the frontmatter through TeamService.assignTask and persists team.member.assigned', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        resetTeamNounRetiredWarningForTesting();
        try {
            const taskPath = await seedTaskAndSpec(cwd, '0042', 'planner');
            const code = await main(['task', 'update', '0042', '--assignee', 'planner'], { cwd, output: out });
            expect(code).toBe(0);
            const updated = await readFile(taskPath, 'utf8');
            expect(updated).toContain('assignee: planner');

            const rows = await readSystemEvents(cwd);
            const assigned = rows.find((r) => r.event_name === 'team.member.assigned');
            expect(assigned).toBeDefined();
            expect(assigned?.payload_json).toContain('0042');
            expect(assigned?.payload_json).toContain('planner');
        } finally {
            resetTeamNounRetiredWarningForTesting();
            await cleanup();
        }
    });

    test('rejects an id that fails the agent-id format with VALIDATION_FAILED (exit 2)', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        resetTeamNounRetiredWarningForTesting();
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
            resetTeamNounRetiredWarningForTesting();
            await cleanup();
        }
    });

    test('rejects an unknown spec id with VALIDATION_FAILED (exit 2)', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        resetTeamNounRetiredWarningForTesting();
        try {
            const code = await main(['task', 'update', '0042', '--assignee', 'ghost'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
            });
            expect(code).toBe(2);
            expect(out.errors.at(-1)).toContain("Unknown agent spec 'ghost'");
        } finally {
            resetTeamNounRetiredWarningForTesting();
            await cleanup();
        }
    });

    test('refuses to combine --assignee with --section (exit 2)', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        resetTeamNounRetiredWarningForTesting();
        try {
            const code = await main(['task', 'update', '0042', '--assignee', 'planner', '--section', 'Plan'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
            });
            expect(code).toBe(2);
            expect(out.errors.at(-1)).toContain('--assignee cannot be combined with --section');
        } finally {
            resetTeamNounRetiredWarningForTesting();
            await cleanup();
        }
    });
});

describe('0848 R5 — transition shim is two-sided (marker + manifest)', () => {
    test('team.ts carries the marker and the manifest baselines it', async () => {
        const source = await readFile(join(import.meta.dir, '..', '..', 'src', 'commands', 'team.ts'), 'utf8');
        expect(source).toContain(SHIM_MARKER);

        const manifestPath = join(import.meta.dir, '..', '..', '..', '..', 'config', 'transition-shims.json');
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
            entries?: Array<{ id?: string; wbs?: string }>;
        };
        const entry = manifest.entries?.find((s) => s.id === 'team-noun-retired');
        expect(entry).toBeDefined();
        expect(entry?.wbs).toBe('0848');
    });
});
