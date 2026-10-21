import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentCoordinationService, CLAIM_LEASE_MS, InboxService, MAX_DELIVERY_ATTEMPTS } from '@gobing-ai/spur-app';
import { CoordinationRunDao, createMigratedDb, SystemEventDao } from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { defaultSleep, parseInterval, runMessageWatch } from '../../src/commands/message';
import { main } from '../../src/index';
import { createCapturedOutput, inboxFixture } from '../helpers';

/** A shared temp dir with file-based SQLite for multi-call main() tests. */
async function makeCtx(): Promise<{
    cwd: string;
    out: ReturnType<typeof createCapturedOutput>;
    dbUrl: string;
    cleanup: () => Promise<void>;
}> {
    // mkdtemp's random suffix is mixed-case; agent ids are lowercase-only, so the
    // project is a fixed lowercase dir inside the temp parent. The fleet slug falls
    // back to that basename, which is what the role-resolution assertions expect.
    const root = await mkdtemp(join(tmpdir(), 'spur-msg-'));
    const cwd = join(root, 'alpha');
    await mkdir(cwd, { recursive: true });
    const out = createCapturedOutput();
    const dbUrl = join(cwd, 'test.db');
    return { cwd, out, dbUrl, cleanup: async () => rm(root, { recursive: true, force: true }) };
}

describe('spur message send', () => {
    test('request keys survive CLI restarts, replay receipts, and reject changed bodies', async () => {
        const { cwd, dbUrl, cleanup } = await makeCtx();
        const send = async (key: string, body: string) => {
            const output = createCapturedOutput();
            const code = await main(['message', 'send', '--to', 'planner', '--request-key', key, '--json', body], {
                cwd,
                dbUrl,
                output,
            });
            return { code, receipt: JSON.parse(output.messages[0] ?? '{}') };
        };
        try {
            const first = await send('request-1', 'work');
            const replay = await send('request-1', 'work');
            expect(first.code).toBe(0);
            expect(first.receipt).toMatchObject({ requestKey: 'request-1', replayed: false });
            expect(replay.receipt).toMatchObject({
                msgId: first.receipt.msgId,
                requestKey: 'request-1',
                replayed: true,
            });
            expect((await send('request-1', 'different')).code).not.toBe(0);
            expect((await send('request-2', 'different')).receipt.msgId).not.toBe(first.receipt.msgId);
            expect((await send('   ', 'work')).code).not.toBe(0);
            const db = await createMigratedDb({ url: dbUrl });
            expect(await inboxFixture(db).inbox('planner', 10)).toHaveLength(2);
            await db.close();
        } finally {
            await cleanup();
        }
    });

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
            // 0685 R6: missing address is a usage-domain error (exit 2) naming both forms.
            expect(code).toBe(2);
            expect(out.errors.join('\n')).toMatch(/--to <id> or --role <name>/);
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

    // 0834 R6: --unresolved filters to the reconciler's holds; --json rows carry
    // attempts, last error, hold reason, and the run↔message correlation.
    test('0834: --unresolved --json shows held messages with reason, attempts, error, run correlation', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        const out = createCapturedOutput();
        const inbox = inboxFixture(db);
        // G11 R8: reconciliation reads `kind: 'request'` rows only, so these are dispatches.
        // In-flight, receipt missing → outcome-unknown.
        const stuck = (await inbox.enqueueIdempotent('operator', 'planner', 'ambiguous work', 'fleet:task:0841:1')).id;
        await inbox.drainPending('planner');
        // Over budget → attempts-exhausted; the sweep owns the ceiling (G11 R4), so this row is
        // claimed and lease-expired rather than hand-stamped.
        const budget = (await inbox.enqueueIdempotent('operator', 'planner', 'exhausted work', 'fleet:task:0843:1')).id;
        await db.run('UPDATE inbox_messages SET attempts = ?1 WHERE id = ?2', MAX_DELIVERY_ATTEMPTS - 1, budget);
        await inbox.drainPending('planner');
        await db.run('UPDATE inbox_messages SET claimed_at = 0 WHERE id = ?1', budget);
        await inbox.service.sweep(CLAIM_LEASE_MS + 1);
        // Terminal delivery failure with its recorded error.
        const broken = (await inbox.enqueueIdempotent('operator', 'planner', 'broken delivery', 'fleet:task:0844:1'))
            .id;
        // A failed settle is guarded on `claimed` (G11 R4), so claim it like a drain would first.
        await inbox.drainPending('planner');
        await inbox.markFailed(broken, 'invocation never started');
        // Normal redeliverable queued row → omitted from --unresolved. Seeded LAST: a claim takes
        // every queued row for the member, so an earlier seed would be consumed by these claims.
        const normal = (await inbox.enqueueIdempotent('operator', 'planner', 'normal work', 'fleet:task:0842:1')).id;

        const code = await main(['message', 'inbox', '--agent', 'planner', '--unresolved', '--json'], {
            db,
            output: out,
        });
        expect(code).toBe(0);
        const payload = JSON.parse(out.messages.at(-1) ?? '{}');
        const byId = new Map<string, Record<string, unknown>>(
            payload.messages.map((m: Record<string, unknown>) => [m.id as string, m]),
        );
        expect(payload.count).toBe(3);
        expect(new Set(byId.keys())).toEqual(new Set([stuck, budget, broken]));

        const stuckRow = byId.get(stuck) as Record<string, unknown>;
        expect(stuckRow.reason).toBe('outcome-unknown');
        expect(stuckRow.injectAttempts).toBe(1);
        expect(stuckRow.artifacts).toEqual([]);

        const budgetRow = byId.get(budget) as Record<string, unknown>;
        expect(budgetRow.reason).toBe('attempts-exhausted');
        expect(budgetRow.status).toBe('failed'); // marked by this pass
        expect(budgetRow.injectError).toBe('attempts exhausted after 3 deliveries');

        const brokenRow = byId.get(broken) as Record<string, unknown>;
        expect(brokenRow.reason).toBe('delivery-failed');
        expect(brokenRow.injectError).toBe('invocation never started');
        expect(byId.has(normal)).toBe(false);
    });

    test('0834: run-correlated rows carry runId, taskId, and artifacts in --json', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        const out = createCapturedOutput();
        const inbox = inboxFixture(db);
        const runs = new CoordinationRunDao(db);
        // G11 R8: only request rows enter receipt reconciliation, so this is a dispatch.
        const msg = (await inbox.enqueueIdempotent('operator', 'planner', 'exit-only work', 'fleet:task:0007:1')).id;
        await inbox.drainPending('planner');
        await inbox.markDelivered(msg);
        await runs.insertStart({
            specId: 'planner',
            agentKind: 'claude-code',
            processId: null,
            runId: 'run-x',
            generation: 1,
            startedAt: new Date().toISOString(),
        });
        await runs.updateExit(
            'run-x',
            'exited',
            new Date().toISOString(),
            JSON.stringify([{ kind: 'result', path: '/tmp/x.json' }]),
            {
                messageIds: [msg],
                taskId: 'task-7',
                outcome: 'run-exit-only',
            },
        );

        const code = await main(['message', 'inbox', '--agent', 'planner', '--json'], { db, output: out });
        expect(code).toBe(0);
        const payload = JSON.parse(out.messages.at(-1) ?? '{}');
        const row = payload.messages[0];
        expect(row.reason).toBe('run-exit-only');
        expect(row.runId).toBe('run-x');
        expect(row.taskId).toBe('task-7');
        expect(row.artifacts).toEqual([{ kind: 'result', path: '/tmp/x.json' }]);
        expect(row.injectAttempts).toBe(1);
    });

    test('0834: plain-text --unresolved lists only held messages', async () => {
        const db = await createMigratedDb({ url: ':memory:' });
        const out = createCapturedOutput();
        const inbox = inboxFixture(db);
        // G11 R8: a chat row is never unresolved work, so the held one must be a request.
        const stuck = (await inbox.enqueueIdempotent('operator', 'planner', 'ambiguous work', 'fleet:task:0841:1')).id;
        await inbox.drainPending('planner');
        await inbox.enqueue('operator', 'planner', 'normal work');

        const code = await main(['message', 'inbox', '--agent', 'planner', '--unresolved'], { db, output: out });
        expect(code).toBe(0);
        const text = out.messages.join('\n');
        expect(text).toContain(stuck);
        expect(text).not.toContain('normal work');
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

/** Build a AgentCoordinationService over a temp project dir + in-memory DB for watch tests. */
async function makeWatchService(): Promise<{
    svc: AgentCoordinationService;
    service: InboxService;
    cleanup: () => Promise<void>;
}> {
    const cwd = await mkdtemp(join(tmpdir(), 'spur-watch-'));
    const db = await createMigratedDb({ url: ':memory:' });
    const svc = new AgentCoordinationService({
        cwd,
        env: {},
        getDb: async () => db,
        fs: createNodeFileSystem(cwd),
    });
    return {
        svc,
        // The watch loop talks to the inbox plane directly (G11 R5).
        service: new InboxService({ getDb: async () => db }),
        cleanup: async () => {
            db.close();
            await rm(cwd, { recursive: true, force: true });
        },
    };
}

describe('spur message watch', () => {
    test('surfaces a new message within one poll tick (no real sleep)', async () => {
        const { svc, service, cleanup } = await makeWatchService();
        const out = createCapturedOutput();
        try {
            // Pre-seed one message; watch starts, sees it on tick 1, then exits at maxIterations.
            await svc.sendMessage('coder', 'planner', 'first message');
            await runMessageWatch(
                service,
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
        const { svc, service, cleanup } = await makeWatchService();
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
                service,
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
        const { svc, service, cleanup } = await makeWatchService();
        const out = createCapturedOutput();
        try {
            await svc.sendMessage('coder', 'planner', 'json-payload');
            await runMessageWatch(
                service,
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
        const { svc, service, cleanup } = await makeWatchService();
        const out = createCapturedOutput();
        try {
            await svc.sendMessage('coder', 'planner', 'watched');
            await runMessageWatch(
                service,
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
        const { service, cleanup } = await makeWatchService();
        const out = createCapturedOutput();
        const controller = new AbortController();
        try {
            // Abort after the first poll — no maxIterations, so the signal is the only exit.
            const sleep = async () => controller.abort();
            await runMessageWatch(
                service,
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

describe('spur message send --role (G72 R1)', () => {
    /**
     * Seed the `agent.fleet` declaration role/executor addressing resolves over
     * (G72 R1). Members are derived from the declaration — a spec file on disk is no
     * longer a roster carrier, so it must not be addressable.
     */
    async function seedFleet(cwd: string, members: { id: string; executor: string; role?: string }[]): Promise<void> {
        const dir = join(cwd, '.spur');
        await mkdir(dir, { recursive: true });
        const executors = [...new Set(members.map((m) => m.executor))];
        const yaml = [
            'agent:',
            '  executors:',
            ...executors.flatMap((name) => [`    - name: ${name}`, '      agent: claude']),
            '  fleet:',
            '    enabled: true',
            '    members:',
            ...members.flatMap((m) => [
                `      - id: ${m.id}`,
                ...(m.role ? [`        role: ${m.role}`] : []),
                `        executor: ${m.executor}`,
            ]),
            '',
        ].join('\n');
        await writeFile(join(dir, 'config.yaml'), yaml, 'utf8');
    }

    test('--to and --role together is a usage error (exit 2)', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            const code = await main(['message', 'send', '--to', 'a', '--role', 'reviewer', 'hi'], {
                cwd,
                output: out,
                dbUrl,
            });
            expect(code).toBe(2);
            expect(out.errors.join('\n')).toMatch(/accepts --to or --role, not both/);
        } finally {
            await cleanup();
        }
    });

    test('--role outside the vocabulary exits 2 naming accepted names', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            const code = await main(['message', 'send', '--json', '--role', 'nope', 'hi'], {
                cwd,
                output: out,
                dbUrl,
            });
            expect(code).toBe(2);
            const payload = JSON.parse(out.messages[0] ?? '{}');
            expect(payload.error.code).toBe('unknown_selector');
            expect(payload.error.message).toMatch(/reviewer/);
        } finally {
            await cleanup();
        }
    });

    test('--role with zero matching instances exits 1 as selector_unmatched', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            const code = await main(['message', 'send', '--json', '--role', 'reviewer', 'hi'], {
                cwd,
                output: out,
                dbUrl,
            });
            expect(code).toBe(1);
            const payload = JSON.parse(out.messages[0] ?? '{}');
            expect(payload.error.code).toBe('selector_unmatched');
            expect(payload.error.message).toContain('count=0');
            expect(payload.error.message).toContain('candidates: none');
        } finally {
            await cleanup();
        }
    });

    test('--role matching multiple instances exits 1 naming count and candidates', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        await seedFleet(cwd, [
            { id: 'rev-a', executor: 'claude', role: 'reviewer' },
            { id: 'rev-b', executor: 'claude', role: 'reviewer' },
        ]);
        try {
            const code = await main(['message', 'send', '--json', '--role', 'reviewer', 'hi'], {
                cwd,
                output: out,
                dbUrl,
            });
            expect(code).toBe(1);
            const payload = JSON.parse(out.messages[0] ?? '{}');
            expect(payload.error.code).toBe('selector_ambiguous');
            expect(payload.error.message).toContain('count=2');
            expect(payload.error.message).toMatch(/rev-a.*rev-b/s);
        } finally {
            await cleanup();
        }
    });

    test('--role exact-one resolves to the same pinned send-wait path as --to', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        await seedFleet(cwd, [{ id: 'rev-one', executor: 'claude', role: 'reviewer' }]);
        await seedSendOccupant({
            dbUrl,
            specId: 'alpha-rev-one',
            runId: 'R-role',
            events: [{ eventName: 'agent.invoke.exit', sequence: 2 }],
        });
        try {
            const code = await main(
                ['message', 'send', '--role', 'reviewer', '--wait', '--until', 'invoke-exit', '--json', 'hi'],
                { cwd, output: out, dbUrl },
            );
            expect(code).toBe(0);
            const payload = JSON.parse(out.messages[0] ?? '{}');
            expect(payload.toId).toBe('alpha-rev-one');
            expect(payload.wait.satisfied).toBe('invoke-exit');
        } finally {
            await cleanup();
        }
    });
});

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

// 0693 R4: --json usage branches through the ADR-091 envelope seam (raw default +
// enveloped opt-in), including the zod-validating error envelope path.
describe('spur message send --json usage errors (0693 envelope adoption)', () => {
    test('--json --to with --role emits the raw usage error object (exit 2)', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            const code = await main(['message', 'send', '--json', '--to', 'a', '--role', 'reviewer', 'hi'], {
                cwd,
                output: out,
                dbUrl,
            });
            expect(code).toBe(2);
            const parsed = JSON.parse(out.messages[0] ?? '{}');
            expect(parsed).toEqual({
                error: { code: 'usage', message: 'message send accepts --to or --role, not both' },
            });
        } finally {
            await cleanup();
        }
    });

    test('--json --to with --role --json-envelope emits an apiErrorSchema envelope (exit 2)', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            const code = await main(
                ['message', 'send', '--json', '--json-envelope', '--to', 'a', '--role', 'reviewer', 'hi'],
                { cwd, output: out, dbUrl },
            );
            expect(code).toBe(2);
            const parsed = JSON.parse(out.messages[0] ?? '{}');
            expect(parsed.ok).toBe(false);
            expect(parsed.error.code).toBe('INTERNAL_ERROR');
            expect(parsed.error.details.cliCode).toBe('usage');
        } finally {
            await cleanup();
        }
    });

    test('--json with empty --to and no orchestrator emits the usage error (exit 2)', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            const code = await main(['message', 'send', '--json', '--to', '', 'hi'], { cwd, output: out, dbUrl });
            expect(code).toBe(2);
            const parsed = JSON.parse(out.messages[0] ?? '{}');
            // G11 R1 changed the meaning of an empty `--to`: it now means "the orchestrator", so
            // this project (which has none) gets the no-orchestrator usage error instead.
            expect(parsed.error.message).toContain('no orchestrator member');
        } finally {
            await cleanup();
        }
    });

    test('--json --json-envelope success wraps the queued payload under data', async () => {
        const { cwd, out, dbUrl, cleanup } = await makeCtx();
        try {
            const code = await main(['message', 'send', '--json', '--json-envelope', '--to', 'planner', 'hi'], {
                cwd,
                output: out,
                dbUrl,
            });
            expect(code).toBe(0);
            const parsed = JSON.parse(out.messages[0] ?? '{}');
            expect(parsed.ok).toBe(true);
            expect(parsed.data.toId).toBe('planner');
            expect(parsed.data.status).toBe('queued');
        } finally {
            await cleanup();
        }
    });

    describe('G11 1268 — the operator surface', () => {
        test('send with no --to addresses the bound orchestrator as operator', async () => {
            const { cwd, out, dbUrl, cleanup } = await makeCtx();
            try {
                // A declared orchestrator: the planner-role member carrying `purpose: orchestrator`,
                // named by the `agent.fleet.orchestrator` pointer (0836). This is the ONLY branch that
                // proves R1 — an earlier version of this test accepted exit 2 as a pass, which kept a
                // dead resolution path green.
                await mkdir(join(cwd, '.spur'), { recursive: true });
                await writeFile(
                    join(cwd, '.spur', 'config.yaml'),
                    [
                        'agent:',
                        '  fleet:',
                        '    enabled: true',
                        '    orchestrator: orch',
                        '    members:',
                        '      - id: orch',
                        '        role: planner',
                        '        purpose: orchestrator',
                        '        executor: claude',
                        '',
                    ].join('\n'),
                );

                const code = await main(['message', 'send', '--json', 'hello orchestrator'], {
                    cwd,
                    dbUrl,
                    output: out,
                    env: { SPUR_SKIP_GLOBAL_CONFIG: 'true' },
                });
                expect(code).toBe(0);
                const payload = JSON.parse(out.messages.at(-1) ?? '{}');
                // The address is the orchestrator's member instance id, and the sender is the operator.
                expect(payload.toId).toContain('orch');
                expect(payload.status).toBe('queued');

                const db = await createMigratedDb({ url: dbUrl });
                const rows = await new InboxService({ getDb: async () => db }).list(payload.toId, 'in');
                expect(rows.messages).toHaveLength(1);
                expect(rows.messages[0]?.fromId).toBe('operator');
                db.close();
            } finally {
                await cleanup();
            }
        });

        test('send with no --to and no declared orchestrator writes nothing', async () => {
            const { cwd, out, dbUrl, cleanup } = await makeCtx();
            try {
                const code = await main(['message', 'send', '--json', 'nowhere to go'], { cwd, dbUrl, output: out });
                expect(code).toBe(2);
                expect(JSON.parse(out.messages.at(-1) ?? '{}').error.message).toContain('no orchestrator member');
                const db = await createMigratedDb({ url: dbUrl });
                expect(await db.queryAll('SELECT id FROM inbox_messages')).toEqual([]);
                db.close();
            } finally {
                await cleanup();
            }
        });

        test('show prints both directions of a thread, oldest first', async () => {
            const { cwd, out, dbUrl, cleanup } = await makeCtx();
            try {
                // A file-backed DB: `main` owns and closes its own connection, so a test that seeds
                // and then runs the CLI has to share the file, not an in-memory handle.
                const db = await createMigratedDb({ url: dbUrl });
                const service = new InboxService({ getDb: async () => db });
                const root = await service.send({ from: 'operator', to: 'proj-coder', body: 'question' });
                await service.reply(root.message.id, 'proj-coder', 'answer');
                db.close();

                const code = await main(['message', 'show', root.message.id, '--json'], { cwd, dbUrl, output: out });
                expect(code).toBe(0);
                const payload = JSON.parse(out.messages.at(-1) ?? '{}');
                expect(payload.count).toBe(2);
                expect(payload.messages.map((m: { body: string }) => m.body)).toEqual(['question', 'answer']);
                expect(payload.messages[0].threadId).toBe(root.message.id);
            } finally {
                await cleanup();
            }
        });

        test('show on an unknown id exits 1', async () => {
            const { cwd, out, dbUrl, cleanup } = await makeCtx();
            try {
                const code = await main(['message', 'show', 'msg_missing', '--json'], { cwd, dbUrl, output: out });
                expect(code).toBe(1);
            } finally {
                await cleanup();
            }
        });

        test('read stamps the receipt once, and a second read reports the repeat', async () => {
            const { cwd, out, dbUrl, cleanup } = await makeCtx();
            try {
                const db = await createMigratedDb({ url: dbUrl });
                const sent = await new InboxService({ getDb: async () => db }).send({
                    from: 'proj-coder',
                    to: 'operator',
                    body: 'hi',
                });
                db.close();

                const first = await main(['message', 'read', sent.message.id, '--json'], { cwd, dbUrl, output: out });
                expect(first).toBe(0);
                expect(JSON.parse(out.messages.at(-1) ?? '{}').transitioned).toBe(true);

                const again = await main(['message', 'read', sent.message.id, '--json'], { cwd, dbUrl, output: out });
                expect(again).toBe(0);
                expect(JSON.parse(out.messages.at(-1) ?? '{}').transitioned).toBe(false);

                // Only the first mark wrote a `message.read` ledger row.
                const after = await createMigratedDb({ url: dbUrl });
                expect(await new SystemEventDao(after).query({ name: 'message.read', limit: 5 })).toHaveLength(1);
                after.close();
            } finally {
                await cleanup();
            }
        });

        test('read by a non-recipient exits 1 and writes no event', async () => {
            const { cwd, out, dbUrl, cleanup } = await makeCtx();
            try {
                const db = await createMigratedDb({ url: dbUrl });
                const sent = await new InboxService({ getDb: async () => db }).send({
                    from: 'proj-coder',
                    to: 'operator',
                    body: 'hi',
                });
                db.close();

                const code = await main(['message', 'read', sent.message.id, '--reader', 'someone-else', '--json'], {
                    cwd,
                    dbUrl,
                    output: out,
                });
                expect(code).toBe(1);
                const after = await createMigratedDb({ url: dbUrl });
                expect(await new SystemEventDao(after).query({ name: 'message.read', limit: 5 })).toHaveLength(0);
                after.close();
            } finally {
                await cleanup();
            }
        });

        test('inbox --json writes nothing (G11 R3)', async () => {
            const { cwd, out, dbUrl, cleanup } = await makeCtx();
            const db = await createMigratedDb({ url: dbUrl });
            try {
                const service = new InboxService({ getDb: async () => db });
                const sent = await service.send({ from: 'operator', to: 'proj-coder', body: 'x', kind: 'request' });
                await service.claim('proj-coder', 5);
                const before = await db.queryAll<{ n: number }>('SELECT COUNT(*) AS n FROM system_events');

                const code = await main(['message', 'inbox', '--agent', 'proj-coder', '--json'], {
                    cwd,
                    dbUrl,
                    output: out,
                });
                expect(code).toBe(0);
                const after = await createMigratedDb({ url: dbUrl });
                const rows = await after.queryAll<{ n: number }>('SELECT COUNT(*) AS n FROM system_events');
                expect(rows[0]?.n).toBe(before[0]?.n);
                after.close();
                // The read still reports the request it was asked about.
                expect(JSON.parse(out.messages.at(-1) ?? '{}').messages[0].id).toBe(sent.message.id);
            } finally {
                db.close();
                await cleanup();
            }
        });

        test('--wait --until injected resolves when the sent row is claimed (G11 R2)', async () => {
            const { cwd, out, dbUrl, cleanup } = await makeCtx();
            try {
                await seedSendOccupant({ dbUrl, specId: 'proj-coder', runId: 'run-until' });
                // A consumer on its own connection claims the row shortly after the send. R2's point is
                // that the wait keys on THIS row leaving `queued` — not on the inbox being empty, which
                // another consumer emptying a different row would also satisfy.
                const claimer = setTimeout(() => {
                    void (async () => {
                        const db = await createMigratedDb({ url: dbUrl });
                        await new InboxService({ getDb: async () => db }).claim('proj-coder', 5);
                        db.close();
                    })();
                }, 150);

                const code = await main(
                    ['message', 'send', '--json', '--to', 'proj-coder', '--wait', '--until', 'injected', 'work'],
                    { cwd, dbUrl, output: out },
                );
                clearTimeout(claimer);
                expect(code).toBe(0);
                expect(JSON.parse(out.messages.at(-1) ?? '{}').wait.satisfied).toBe('injected');
            } finally {
                await cleanup();
            }
        });
    });
});
