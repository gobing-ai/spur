import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CoordinationRunDao, createMigratedDb, SystemEventDao } from '@gobing-ai/spur-domain';
import { main } from '../../src/index';
import { createCapturedOutput } from '../helpers';

/** A shared temp dir with in-memory DB for multi-call main() tests. */
async function makeCtx(): Promise<{
    cwd: string;
    out: ReturnType<typeof createCapturedOutput>;
    cleanup: () => Promise<void>;
}> {
    const cwd = await mkdtemp(join(tmpdir(), 'spur-wait-'));
    const out = createCapturedOutput();
    return { cwd, out, cleanup: async () => rm(cwd, { recursive: true, force: true }) };
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

describe('spur agent wait (G4 wave 2, R4)', () => {
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
