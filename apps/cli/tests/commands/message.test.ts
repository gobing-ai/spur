import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TeamService } from '@gobing-ai/spur-app';
import { CoordinationRunDao, createMigratedDb, SystemEventDao } from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { defaultSleep, parseInterval, runMessageWatch } from '../../src/commands/message';
import { main } from '../../src/index';
import { createCapturedOutput } from '../helpers';

/** A shared temp dir with file-based SQLite for multi-call main() tests. */
async function makeCtx(): Promise<{
    cwd: string;
    out: ReturnType<typeof createCapturedOutput>;
    dbUrl: string;
    cleanup: () => Promise<void>;
}> {
    const cwd = await mkdtemp(join(tmpdir(), 'spur-msg-'));
    const out = createCapturedOutput();
    const dbUrl = join(cwd, 'test.db');
    return { cwd, out, dbUrl, cleanup: async () => rm(cwd, { recursive: true, force: true }) };
}

describe('spur message send', () => {
    test('enqueues a message and prints the id', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            const code = await main(['message', 'send', '--to', 'planner', 'hello there'], {
                cwd,
                output: out,
                dbUrl,
            });
            expect(code).toBe(0);
            expect(out.messages.join('\n')).toMatch(/queued .+ → planner/);
        } finally {
            await cleanup();
        }
    });

    test('--json emits the structured result', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            const code = await main(['message', 'send', '--to', 'planner', '--json', 'hi'], {
                cwd,
                output: out,
                dbUrl,
            });
            expect(code).toBe(0);
            const payload = JSON.parse(out.messages[0] ?? '{}');
            expect(payload.toId).toBe('planner');
            expect(payload.status).toBe('queued');
        } finally {
            await cleanup();
        }
    });

    test('requires --to', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            const code = await main(['message', 'send', 'hi'], { cwd, output: out, dbUrl });
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/--to/);
        } finally {
            await cleanup();
        }
    });

    test('requires a non-empty body', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            const code = await main(['message', 'send', '--to', 'planner'], { cwd, output: out, dbUrl });
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/body/);
        } finally {
            await cleanup();
        }
    });

    test('--json empty body emits a single usage error envelope (R10)', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            const code = await main(['message', 'send', '--to', 'planner', '--json', ''], {
                cwd,
                output: out,
                dbUrl,
            });
            expect(code).toBe(2);
            const parsed = JSON.parse(out.messages[0] ?? '{}');
            expect(parsed).toEqual({ error: { code: 'usage', message: 'message send requires a non-empty body' } });
            // Nothing plain-text on the error stream in json mode.
            expect(out.errors.join('\n')).not.toMatch(/non-empty body/);
        } finally {
            await cleanup();
        }
    });

    test('rejects a malformed --to id with exit 1', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            const code = await main(['message', 'send', '--to', 'Bad Id', 'hi'], { cwd, output: out, dbUrl });
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/agent|Invalid/);
        } finally {
            await cleanup();
        }
    });
});

describe('spur message inbox', () => {
    test('lists messages for an agent', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            await main(['message', 'send', '--to', 'planner', 'first'], { cwd, output: out, dbUrl });
            const code = await main(['message', 'inbox', '--agent', 'planner'], { cwd, output: out, dbUrl });
            expect(code).toBe(0);
            expect(out.messages.join('\n')).toContain('first');
        } finally {
            await cleanup();
        }
    });

    test('reports empty inbox', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            const code = await main(['message', 'inbox', '--agent', 'ghost'], { cwd, output: out, dbUrl });
            expect(code).toBe(0);
            expect(out.messages.join('\n')).toMatch(/No messages/);
        } finally {
            await cleanup();
        }
    });

    test('--json lists messages structurally', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            await main(['message', 'send', '--to', 'planner', 'hi'], { cwd, output: out, dbUrl });
            const code = await main(['message', 'inbox', '--agent', 'planner', '--json'], { cwd, output: out, dbUrl });
            expect(code).toBe(0);
            const payload = JSON.parse(out.messages.at(-1) ?? '{}');
            expect(payload.count).toBe(1);
            expect(payload.messages[0].body).toBe('hi');
        } finally {
            await cleanup();
        }
    });

    test('requires --agent', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            const code = await main(['message', 'inbox'], { cwd, output: out, dbUrl });
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/--agent/);
        } finally {
            await cleanup();
        }
    });
});

describe('spur message reply', () => {
    test('threads a reply back to the original sender', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            // coder → planner, then reply must address coder.
            await main(['message', 'send', '--to', 'planner', '--from', 'coder', 'need plan'], {
                cwd,
                output: out,
                dbUrl,
            });
            let code = await main(['message', 'inbox', '--agent', 'planner', '--json'], { cwd, output: out, dbUrl });
            expect(code).toBe(0);
            const msgId = JSON.parse(out.messages.at(-1) ?? '{}').messages[0].id;

            code = await main(['message', 'reply', msgId, 'here is the plan'], { cwd, output: out, dbUrl });
            expect(code).toBe(0);
            expect(out.messages.at(-1)).toMatch(/replied .+ → coder/);
        } finally {
            await cleanup();
        }
    });

    test('requires a msg id', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            const code = await main(['message', 'reply'], { cwd, output: out, dbUrl });
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/msg-id/);
        } finally {
            await cleanup();
        }
    });
});

describe('spur message dispatch', () => {
    test('rejects an unknown subcommand', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            const code = await main(['message', 'bogus'], { cwd, output: out, dbUrl });
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/unknown command/i);
        } finally {
            await cleanup();
        }
    });
});

// ── watch verb (task 0193/0205) ──
// Tests exercise the runMessageWatch core directly with an injected sleep (no real waits)
// and a maxIterations cap so the loop terminates deterministically.

/** Build a TeamService over a temp project dir + in-memory DB for watch tests. */
async function makeWatchService(): Promise<{
    svc: TeamService;
    cleanup: () => Promise<void>;
}> {
    const cwd = await mkdtemp(join(tmpdir(), 'spur-watch-'));
    const db = await createMigratedDb({ url: ':memory:' });
    const svc = new TeamService({
        cwd,
        env: {},
        getDb: async () => db,
        fs: createNodeFileSystem(cwd),
    });
    return {
        svc,
        cleanup: async () => {
            db.close();
            await rm(cwd, { recursive: true, force: true });
        },
    };
}

describe('spur message watch', () => {
    test('surfaces a new message within one poll tick (no real sleep)', async () => {
        const { svc, cleanup } = await makeWatchService();
        const out = createCapturedOutput();
        try {
            // Pre-seed one message; watch starts, sees it on tick 1, then exits at maxIterations.
            await svc.sendMessage('coder', 'planner', 'first message');
            await runMessageWatch(
                svc,
                out,
                { agent: 'planner', intervalMs: 1000, json: false },
                { maxIterations: 1, sleep: async () => {} },
            );
            const lines = out.messages.join('\n');
            expect(lines).toContain('first message');
        } finally {
            await cleanup();
        }
    });

    test('surfaces messages added between polls; each exactly once', async () => {
        const { svc, cleanup } = await makeWatchService();
        const out = createCapturedOutput();
        try {
            // First tick: nothing. Between tick 1 and 2, drop two new messages.
            let tickCount = 0;
            const sleep = async () => {
                tickCount++;
                if (tickCount === 1) {
                    // After the first poll (empty), add two messages before the second poll.
                    await svc.sendMessage('coder', 'planner', 'msg-a');
                    await svc.sendMessage('coder', 'planner', 'msg-b');
                }
            };
            await runMessageWatch(
                svc,
                out,
                { agent: 'planner', intervalMs: 1, json: false },
                { maxIterations: 3, sleep },
            );
            const lines = out.messages.join('\n');
            expect(lines).toContain('msg-a');
            expect(lines).toContain('msg-b');
            // Each surfaced exactly once (dedup by id).
            expect(lines.match(/msg-a/g)?.length).toBe(1);
            expect(lines.match(/msg-b/g)?.length).toBe(1);
        } finally {
            await cleanup();
        }
    });

    test('--json emits one JSON object per new message line', async () => {
        const { svc, cleanup } = await makeWatchService();
        const out = createCapturedOutput();
        try {
            await svc.sendMessage('coder', 'planner', 'json-payload');
            await runMessageWatch(
                svc,
                out,
                { agent: 'planner', intervalMs: 1, json: true },
                { maxIterations: 1, sleep: async () => {} },
            );
            // Each message is a separate JSON line, parseable independently.
            const parsed = out.messages
                .filter((line) => line.trim().length > 0)
                .map((line) => JSON.parse(line) as { id: string; body: string });
            expect(parsed.length).toBe(1);
            expect(parsed[0]?.body).toBe('json-payload');
        } finally {
            await cleanup();
        }
    });

    test('never marks messages read (SURFACES, never CONSUMES)', async () => {
        const { svc, cleanup } = await makeWatchService();
        const out = createCapturedOutput();
        try {
            await svc.sendMessage('coder', 'planner', 'watched');
            await runMessageWatch(
                svc,
                out,
                { agent: 'planner', intervalMs: 1, json: true },
                { maxIterations: 2, sleep: async () => {} },
            );
            // The inbox row stays in its original status — watch did not consume/mark it.
            const inbox = await svc.getInbox('planner');
            expect(inbox.count).toBe(1);
            expect(inbox.messages[0]?.status).toBe('queued');
        } finally {
            await cleanup();
        }
    });

    test('aborts cleanly on signal', async () => {
        const { svc, cleanup } = await makeWatchService();
        const out = createCapturedOutput();
        const controller = new AbortController();
        try {
            // Abort after the first poll — no maxIterations, so the signal is the only exit.
            const sleep = async () => controller.abort();
            await runMessageWatch(
                svc,
                out,
                { agent: 'planner', intervalMs: 1, json: false },
                { signal: controller.signal, sleep },
            );
            // Loop returned without error.
            expect(true).toBe(true);
        } finally {
            await cleanup();
        }
    });
});

// ── gap-fill: empty-body guards (exit 2), truncation, interval parsing ──

describe('spur message send — empty-body guard', () => {
    test('rejects a whitespace-only body with exit 2', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            const code = await main(['message', 'send', '--to', 'planner', '   '], { cwd, output: out, dbUrl });
            expect(code).toBe(2);
            expect(out.errors.join('\n')).toMatch(/non-empty body/);
        } finally {
            await cleanup();
        }
    });
});

describe('spur message reply — empty-body guard', () => {
    test('rejects a whitespace-only body with exit 2', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            // Seed a message to get a valid msgId.
            await main(['message', 'send', '--to', 'planner', '--from', 'coder', 'orig'], {
                cwd,
                output: out,
                dbUrl,
            });
            await main(['message', 'inbox', '--agent', 'planner', '--json'], { cwd, output: out, dbUrl });
            const msgId = JSON.parse(out.messages.at(-1) ?? '{}').messages[0].id;

            const code = await main(['message', 'reply', msgId, '   '], { cwd, output: out, dbUrl });
            expect(code).toBe(2);
            expect(out.errors.join('\n')).toMatch(/non-empty body/);
        } finally {
            await cleanup();
        }
    });
});

describe('spur message inbox — body truncation', () => {
    test('truncates bodies longer than 60 chars with ellipsis', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            const longBody = 'A'.repeat(80);
            await main(['message', 'send', '--to', 'planner', longBody], { cwd, output: out, dbUrl });
            const code = await main(['message', 'inbox', '--agent', 'planner'], { cwd, output: out, dbUrl });
            expect(code).toBe(0);
            // formatInboxLine truncates to 57 chars + "..." = 60 total.
            const lines = out.messages.join('\n');
            expect(lines).toContain(`${'A'.repeat(57)}...`);
            expect(lines).not.toContain('A'.repeat(80));
        } finally {
            await cleanup();
        }
    });
});

describe('spur message watch — interval parsing', () => {
    test('rejects a non-positive --interval with exit 2', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            const code = await main(['message', 'watch', '--agent', 'planner', '--interval', '0'], {
                cwd,
                output: out,
                dbUrl,
            });
            expect(code).toBe(2);
            expect(out.errors.join('\n')).toMatch(/invalid --interval/);
        } finally {
            await cleanup();
        }
    });

    test('rejects a non-numeric --interval with exit 2', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            const code = await main(['message', 'watch', '--agent', 'planner', '--interval', 'abc'], {
                cwd,
                output: out,
                dbUrl,
            });
            expect(code).toBe(2);
            expect(out.errors.join('\n')).toMatch(/invalid --interval/);
        } finally {
            await cleanup();
        }
    });
});

describe('spur message watch — happy path via SIGINT', () => {
    test('polls until SIGINT aborts the loop', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            // Kick off the watch action, then raise SIGINT after the loop has
            // entered its poll cycle. The action handler must unregister the
            // listener and resolve cleanly.
            const watchPromise = main(['message', 'watch', '--agent', 'planner', '--interval', '5'], {
                cwd,
                output: out,
                dbUrl,
            });
            // Give the action handler time to register the SIGINT listener and
            // enter the runMessageWatch loop.
            await new Promise((r) => setTimeout(r, 30));
            process.emit('SIGINT');
            const code = await watchPromise;
            expect(code).toBe(0);
        } finally {
            await cleanup();
        }
    });
});

describe('parseInterval', () => {
    test('parses a positive integer', () => {
        expect(parseInterval('2000')).toBe(2000);
        expect(parseInterval('1')).toBe(1);
    });

    test('returns null for zero', () => {
        expect(parseInterval('0')).toBeNull();
    });

    test('returns null for negative numbers', () => {
        expect(parseInterval('-1')).toBeNull();
        expect(parseInterval('-100')).toBeNull();
    });

    test('returns null for non-numeric input', () => {
        expect(parseInterval('abc')).toBeNull();
        expect(parseInterval('')).toBeNull();
        // parseInt('1.5', 10) === 1 — accepted as a positive int per the contract.
        expect(parseInterval('1.5')).toBe(1);
    });
});

describe('defaultSleep', () => {
    test('resolves after the specified duration', async () => {
        const start = Date.now();
        await defaultSleep(20);
        const elapsed = Date.now() - start;
        // Allow generous slack for CI scheduling — just assert it actually waited.
        expect(elapsed).toBeGreaterThanOrEqual(15);
    });

    test('resolves immediately when the signal is already aborted', async () => {
        const controller = new AbortController();
        controller.abort();
        const start = Date.now();
        await defaultSleep(10000, controller.signal);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(50);
    });

    test('resolves early when the signal aborts mid-sleep', async () => {
        const controller = new AbortController();
        const start = Date.now();
        // Abort after 10ms — should resolve well before the 5000ms timeout.
        setTimeout(() => controller.abort(), 10);
        await defaultSleep(5000, controller.signal);
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(200);
    });
});

describe('spur message send --wait (G4 wave 2, R5)', () => {
    test('--wait with no recipient occupant → exit 1 occupant_gone (--json envelope)', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            const code = await main(
                ['message', 'send', '--to', 'reviewer', '--wait', '--timeout', '50', '--json', 'hello'],
                { cwd, output: out, dbUrl },
            );
            expect(code).toBe(1);
            const parsed = JSON.parse(out.messages.join(''));
            expect(parsed.error.code).toBe('occupant_gone');
            expect(parsed.error.message).toMatch(/no occupant for specId "reviewer"/);
        } finally {
            await cleanup();
        }
    });

    test('--wait with no occupant → plain-text error, exit 1', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            const code = await main(['message', 'send', '--to', 'reviewer', '--wait', '--timeout', '50', 'hi'], {
                cwd,
                output: out,
                dbUrl,
            });
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/occupant_gone/);
        } finally {
            await cleanup();
        }
    });

    test('send without --wait still works (no occupant required)', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            const code = await main(['message', 'send', '--to', 'reviewer', '--json', 'hi'], {
                cwd,
                output: out,
                dbUrl,
            });
            expect(code).toBe(0);
            const parsed = JSON.parse(out.messages.join(''));
            expect(parsed.toId).toBe('reviewer');
            expect(parsed.status).toBe('queued');
        } finally {
            await cleanup();
        }
    });
});

/** Seed an occupant (+ optional invoke events) into a file DB, then close it. */
async function seedSendOccupant(opts: {
    dbUrl: string;
    specId: string;
    runId: string;
    events?: { eventName: 'agent.invoke.start' | 'agent.invoke.exit'; sequence: number }[];
}): Promise<void> {
    const db = await createMigratedDb({ url: opts.dbUrl });
    const runDao = new CoordinationRunDao(db);
    await runDao.insertStart({
        specId: opts.specId,
        agentKind: 'claude-code',
        processId: null,
        runId: opts.runId,
        generation: 1,
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

describe('spur message send --wait — seeded occupant resolves (G4 wave 2, R5)', () => {
    test('--wait --until invoke-exit resolves when the pinned run already exited', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        await seedSendOccupant({
            dbUrl,
            specId: 'reviewer',
            runId: 'R1',
            events: [{ eventName: 'agent.invoke.exit', sequence: 2 }],
        });
        try {
            const code = await main(
                [
                    'message',
                    'send',
                    '--to',
                    'reviewer',
                    '--wait',
                    '--until',
                    'invoke-exit',
                    '--timeout',
                    '2000',
                    '--json',
                    'hello',
                ],
                { cwd, output: out, dbUrl },
            );
            expect(code).toBe(0);
            const parsed = JSON.parse(out.messages.join(''));
            expect(parsed.msgId).toBeDefined();
            expect(parsed.wait.satisfied).toBe('invoke-exit');
        } finally {
            await cleanup();
        }
    });

    test('--wait --until injected blocks when nothing drains, then times out (exit 1)', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        await seedSendOccupant({ dbUrl, specId: 'reviewer', runId: 'R1' });
        try {
            const code = await main(
                [
                    'message',
                    'send',
                    '--to',
                    'reviewer',
                    '--wait',
                    '--until',
                    'injected',
                    '--timeout',
                    '1200',
                    '--json',
                    'hello',
                ],
                { cwd, output: out, dbUrl },
            );
            expect(code).toBe(1);
            const parsed = JSON.parse(out.messages.join(''));
            expect(parsed.error.code).toBe('timeout');
        } finally {
            await cleanup();
        }
    });
});
