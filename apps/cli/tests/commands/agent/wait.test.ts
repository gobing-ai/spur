import { describe, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FleetGuestService } from '@gobing-ai/spur-app';
import { CoordinationRunDao, createMigratedDb, SystemEventDao } from '@gobing-ai/spur-domain';
import { runAgentJoin, runAgentWaitInbox } from '../../../src/commands/agent';
import { createCliContext } from '../../../src/context';
import { main } from '../../../src/index';
import { createCapturedOutput, inboxFixture } from '../../helpers';

/** A shared temp dir with in-memory DB for multi-call main() tests. */
async function makeCtx(): Promise<{
    cwd: string;
    out: ReturnType<typeof createCapturedOutput>;
    cleanup: () => Promise<void>;
}> {
    // mkdtemp's random suffix is mixed-case; agent ids are lowercase-only, so the project
    // is a fixed lowercase dir inside the temp parent (the fleet slug falls back to its
    // basename for the unregistered project).
    const root = await mkdtemp(join(tmpdir(), 'spur-wait-'));
    const cwd = join(root, 'alpha');
    await mkdir(cwd, { recursive: true });
    const out = createCapturedOutput();
    return { cwd, out, cleanup: async () => rm(root, { recursive: true, force: true }) };
}

/** Seed an occupant + invoke events into the CLI's file DB, then close it. */
async function seedOccupant(opts: {
    dbUrl: string;
    specId: string;
    runId: string;
    generation?: number;
    events?: { eventName: 'agent.invoke.start' | 'agent.invoke.exit'; sequence: number }[];
}): Promise<void> {
    const db = await createMigratedDb({ url: opts.dbUrl });
    const runDao = new CoordinationRunDao(db);
    await runDao.insertStart({
        specId: opts.specId,
        agentKind: 'claude-code',
        processId: null,
        runId: opts.runId,
        generation: opts.generation ?? 1,
        startedAt: new Date().toISOString(),
    });
    const eventDao = new SystemEventDao(db);
    for (const ev of opts.events ?? []) {
        await eventDao.insert({
            id: `${opts.runId}-${ev.sequence}`,
            event_name: ev.eventName,
            occurred_at: new Date().toISOString(),
            run_id: opts.runId,
            sequence: ev.sequence,
        });
    }
    db.close();
}

/** Seed the `agent.fleet` declaration role resolution reads (G72 R1: derived, not a spec file). */
async function seedRoleSpec(cwd: string, id: string, role: string): Promise<void> {
    const dir = join(cwd, '.spur');
    await mkdir(dir, { recursive: true });
    await writeFile(
        join(dir, 'config.yaml'),
        [
            'agent:',
            '  executors:',
            '    - name: claude',
            '      agent: claude',
            '  fleet:',
            '    enabled: true',
            '    members:',
            `      - id: ${id}`,
            `        role: ${role}`,
            '        executor: claude',
            '',
        ].join('\n'),
        'utf8',
    );
}

describe('spur agent wait (G4 wave 2, R4)', () => {
    test('requires exactly one of specId or --role', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            expect(await main(['agent', 'wait', '--json'], { cwd, output: out, dbUrl: ':memory:' })).toBe(2);
            const parsed = JSON.parse(out.messages.join(''));
            expect(parsed.error.code).toBe('usage');
        } finally {
            await cleanup();
        }
    });

    test('rejects specId and --role together', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            expect(
                await main(['agent', 'wait', 'reviewer', '--role', 'reviewer', '--json'], {
                    cwd,
                    output: out,
                    dbUrl: ':memory:',
                }),
            ).toBe(2);
            const parsed = JSON.parse(out.messages.join(''));
            expect(parsed.error.code).toBe('usage');
        } finally {
            await cleanup();
        }
    });

    test('no occupant → exit 1 with occupant_gone (--json envelope)', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['agent', 'wait', 'reviewer', '--json', '--timeout', '50'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
            });
            expect(code).toBe(1);
            const parsed = JSON.parse(out.messages.join(''));
            expect(parsed.error.code).toBe('occupant_gone');
            expect(parsed.error.message).toMatch(/no occupant for specId "reviewer"/);
        } finally {
            await cleanup();
        }
    });

    test('no occupant → exit 1 with plain-text error', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['agent', 'wait', 'reviewer', '--timeout', '50'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
            });
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/occupant_gone/);
        } finally {
            await cleanup();
        }
    });

    test('--until blocked (sole target) → exit 2 usage', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['agent', 'wait', 'reviewer', '--until', 'blocked', '--json'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
            });
            expect(code).toBe(2);
            const parsed = JSON.parse(out.messages.join(''));
            expect(parsed.error.code).toBe('usage');
        } finally {
            await cleanup();
        }
    });

    test('invalid --until value → commander error (exit non-zero)', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['agent', 'wait', 'reviewer', '--until', 'bogus'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
            });
            expect(code).not.toBe(0);
        } finally {
            await cleanup();
        }
    });

    test('invalid --timeout → commander error (exit non-zero)', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            const code = await main(['agent', 'wait', 'reviewer', '--timeout', 'abc'], {
                cwd,
                output: out,
                dbUrl: ':memory:',
            });
            expect(code).not.toBe(0);
        } finally {
            await cleanup();
        }
    });
});

describe('spur agent wait — seeded occupant resolves', () => {
    test('--role exact-one snapshots the resolved instance pin', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        const dbUrl = join(cwd, 'test.db');
        await seedRoleSpec(cwd, 'demo-reviewer', 'reviewer');
        await seedOccupant({
            dbUrl,
            specId: 'alpha-demo-reviewer',
            runId: 'R-role',
            events: [{ eventName: 'agent.invoke.exit', sequence: 2 }],
        });
        try {
            const code = await main(['agent', 'wait', '--role', 'reviewer', '--json'], {
                cwd,
                output: out,
                dbUrl,
            });
            expect(code).toBe(0);
            const parsed = JSON.parse(out.messages.join(''));
            expect(parsed.pin).toMatchObject({ specId: 'alpha-demo-reviewer', runId: 'R-role', generation: 1 });
        } finally {
            await cleanup();
        }
    });

    test('default --until idle resolves when the latest event is invoke-exit', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        const dbUrl = join(cwd, 'test.db');
        await seedOccupant({
            dbUrl,
            specId: 'reviewer',
            runId: 'R1',
            events: [{ eventName: 'agent.invoke.exit', sequence: 2 }],
        });
        try {
            const code = await main(['agent', 'wait', 'reviewer', '--json'], { cwd, output: out, dbUrl });
            expect(code).toBe(0);
            const parsed = JSON.parse(out.messages.join(''));
            expect(parsed.satisfied).toBe('idle');
            expect(parsed.pin.runId).toBe('R1');
        } finally {
            await cleanup();
        }
    });

    test('--until working resolves immediately when the latest event is invoke-start', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        const dbUrl = join(cwd, 'test.db');
        await seedOccupant({
            dbUrl,
            specId: 'reviewer',
            runId: 'R1',
            events: [{ eventName: 'agent.invoke.start', sequence: 1 }],
        });
        try {
            const code = await main(['agent', 'wait', 'reviewer', '--until', 'working', '--json'], {
                cwd,
                output: out,
                dbUrl,
            });
            expect(code).toBe(0);
            const parsed = JSON.parse(out.messages.join(''));
            expect(parsed.satisfied).toBe('working');
        } finally {
            await cleanup();
        }
    });

    test('--until invoke-exit resolves on an exit at/after snapshot', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        const dbUrl = join(cwd, 'test.db');
        await seedOccupant({
            dbUrl,
            specId: 'reviewer',
            runId: 'R1',
            events: [{ eventName: 'agent.invoke.exit', sequence: 4 }],
        });
        try {
            const code = await main(['agent', 'wait', 'reviewer', '--until', 'invoke-exit', '--json'], {
                cwd,
                output: out,
                dbUrl,
            });
            expect(code).toBe(0);
            const parsed = JSON.parse(out.messages.join(''));
            expect(parsed.satisfied).toBe('invoke-exit');
        } finally {
            await cleanup();
        }
    });

    test('caller --timeout elapses first when it is ≤ stall budget (timeout, exit 1)', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        const dbUrl = join(cwd, 'test.db');
        await seedOccupant({
            dbUrl,
            specId: 'reviewer',
            runId: 'R1',
            events: [{ eventName: 'agent.invoke.exit', sequence: 2 }],
        });
        try {
            const code = await main(
                ['agent', 'wait', 'reviewer', '--until', 'working', '--timeout', '1200', '--json'],
                {
                    cwd,
                    output: out,
                    dbUrl,
                },
            );
            expect(code).toBe(1);
            const parsed = JSON.parse(out.messages.join(''));
            // Design: when --timeout ≤ stall budget, the caller deadline wins.
            expect(parsed.error.code).toBe('timeout');
        } finally {
            await cleanup();
        }
    });

    test('--run pins an explicit runId', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        const dbUrl = join(cwd, 'test.db');
        await seedOccupant({
            dbUrl,
            specId: 'reviewer',
            runId: 'R1',
            events: [{ eventName: 'agent.invoke.exit', sequence: 2 }],
        });
        try {
            const code = await main(['agent', 'wait', 'reviewer', '--run', 'R1', '--json'], {
                cwd,
                output: out,
                dbUrl,
            });
            expect(code).toBe(0);
            const parsed = JSON.parse(out.messages.join(''));
            expect(parsed.satisfied).toBe('idle');
            expect(parsed.pin.runId).toBe('R1');
        } finally {
            await cleanup();
        }
    });
});

describe('spur agent wait — text output and selector failures', () => {
    test('text mode prints the reached state', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        const dbUrl = join(cwd, 'test.db');
        await seedOccupant({
            dbUrl,
            specId: 'reviewer',
            runId: 'R1',
            events: [{ eventName: 'agent.invoke.exit', sequence: 2 }],
        });
        try {
            expect(await main(['agent', 'wait', 'reviewer'], { cwd, output: out, dbUrl })).toBe(0);
            expect(out.messages.at(-1)).toBe('reviewer/R1 reached idle');
        } finally {
            await cleanup();
        }
    });

    test('an unknown --role is a usage error (exit 2) in text and --json', async () => {
        const { cwd, out, cleanup } = await makeCtx();
        try {
            expect(await main(['agent', 'wait', '--role', 'nosuch'], { cwd, output: out, dbUrl: ':memory:' })).toBe(2);
            expect(out.errors.join('\n')).toContain('nosuch');
            const json = createCapturedOutput();
            expect(
                await main(['agent', 'wait', '--role', 'nosuch', '--json'], { cwd, output: json, dbUrl: ':memory:' }),
            ).toBe(2);
            expect(JSON.parse(json.messages.at(-1) ?? '{}')).toMatchObject({ error: { code: 'unknown_selector' } });
        } finally {
            await cleanup();
        }
    });
});

describe('spur agent wait --inbox — JSON and lease surfaces', () => {
    async function guestCtx() {
        const { cwd, out, cleanup } = await makeCtx();
        return { ctx: createCliContext({ cwd, output: out, dbUrl: ':memory:' }), out, cleanup };
    }

    test('a never-joined guest fails with a not-joined JSON error', async () => {
        const { ctx, out, cleanup } = await guestCtx();
        try {
            expect(await runAgentWaitInbox(ctx, { id: 'ghost', timeoutMs: 50, json: true, pollMs: 10 })).toBe(1);
            expect(JSON.parse(out.messages.at(-1) ?? '{}')).toMatchObject({ error: { code: 'not-joined' } });
        } finally {
            await cleanup();
        }
    });

    test('pending work is reported as JSON', async () => {
        const { ctx, out, cleanup } = await guestCtx();
        try {
            await runAgentJoin(ctx, { role: 'reviewer', id: 'g-json', json: false });
            await inboxFixture(await ctx.getDb()).enqueue('proj-lead', 'g-json', 'hello');
            expect(await runAgentWaitInbox(ctx, { id: 'g-json', timeoutMs: 5000, json: true, pollMs: 10 })).toBe(0);
            expect(JSON.parse(out.messages.at(-1) ?? '{}')).toEqual({ id: 'g-json', pending: 1 });
        } finally {
            await cleanup();
        }
    });

    test('a released lease fails instead of waiting, in text and --json', async () => {
        const { ctx, out, cleanup } = await guestCtx();
        const heartbeat = spyOn(FleetGuestService.prototype, 'heartbeat').mockResolvedValue(false);
        try {
            await runAgentJoin(ctx, { role: 'reviewer', id: 'g-gone', json: false });
            expect(await runAgentWaitInbox(ctx, { id: 'g-gone', timeoutMs: 50, json: false, pollMs: 10 })).toBe(1);
            expect(out.errors.join('\n')).toContain('lease was released');
            expect(await runAgentWaitInbox(ctx, { id: 'g-gone', timeoutMs: 50, json: true, pollMs: 10 })).toBe(1);
            expect(JSON.parse(out.messages.at(-1) ?? '{}')).toMatchObject({ error: { code: 'lease-released' } });
        } finally {
            heartbeat.mockRestore();
            await cleanup();
        }
    });
});
