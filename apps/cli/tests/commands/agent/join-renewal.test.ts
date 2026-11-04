/**
 * Task 1279 R1/R2/R4 — guest join records the agent process and gets one renewer.
 *
 * Failure list this pins:
 *   - the record holds the short-lived CLI pid                  → pid is the agent process, or null
 *   - an unverifiable identity still claims liveness            → `identity: 'unverified'`, pid null
 *   - a rejoin spawns a second renewer                          → one renewer pid, stable across rejoin
 *   - a join adds a public flag                                 → `join --help` lists no new option
 *   - the renewer branch joins instead of renewing              → marker branch exits 0, never a guest
 *
 * The renewer launch is real (a detached CLI process), pointed at this checkout's CLI through
 * the test argv seam — under the test runner `Bun.main` is the test file, not the CLI entry.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createPsProcessIdentityReader, FleetGuestService, type GuestRecord } from '@gobing-ai/spur-app';
import { main } from '../../../src';
import { runAgentJoin, setGuestRenewerArgvForTesting } from '../../../src/commands/agent';
import { type CliContext, createCliContext } from '../../../src/context';
import { createCapturedOutput } from '../../helpers';

const reader = createPsProcessIdentityReader();
const CLI_ENTRY = resolve(import.meta.dir, '../../../src/index.ts');

async function makeCtx(env: Record<string, string | undefined> = {}): Promise<{
    ctx: CliContext;
    out: ReturnType<typeof createCapturedOutput>;
    cleanup: () => Promise<void>;
}> {
    const root = await mkdtemp(join(tmpdir(), 'spur-guest-renewal-'));
    const out = createCapturedOutput();
    // File-backed DB: the detached renewer is a separate process and must reach the same
    // lease ledger, or its heartbeat fails the fence on an empty in-memory database.
    const ctx = createCliContext({ cwd: root, output: out, env, dbUrl: join(root, '.spur', 'spur.db') });
    return { ctx, out, cleanup: async () => rm(root, { recursive: true, force: true }) };
}

function guestsOf(ctx: CliContext): FleetGuestService {
    return new FleetGuestService({ cwd: ctx.cwd, fs: ctx.fs, getDb: () => ctx.getDb() });
}

/** A real long-lived process to stand in for the agent. */
function startFixture(): { pid: number; stop: () => Promise<void> } {
    const child = Bun.spawn(['sleep', '60'], { stdout: 'ignore', stderr: 'ignore' });
    return {
        pid: child.pid,
        stop: async () => {
            child.kill();
            await child.exited;
        },
    };
}

/** Poll the guest record until the detached renewer has claimed its slot. */
async function waitForRenewer(ctx: CliContext, id: string, timeoutMs = 10_000): Promise<number | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const record = await guestsOf(ctx).read(id);
        if (typeof record?.renewerPid === 'number') return record.renewerPid;
        if (Date.now() >= deadline) return null;
        await Bun.sleep(100);
    }
}

async function readRecord(ctx: CliContext, id: string): Promise<GuestRecord | null> {
    return await guestsOf(ctx).read(id);
}

describe('spur agent join records the agent process (1279 R2)', () => {
    test('a supplied live --pid is verified and fingerprinted, never replaced by the CLI pid', async () => {
        const { ctx, cleanup } = await makeCtx();
        const fixture = startFixture();
        try {
            expect(await runAgentJoin(ctx, { role: 'coder', id: 'coder-a1', pid: fixture.pid, json: false })).toBe(0);
            const record = await readRecord(ctx, 'coder-a1');
            expect(record?.identity).toBe('verified');
            expect(record?.pid).toBe(fixture.pid);
            expect(record?.processStartedAt ?? '').not.toBe('');
            expect(record?.executable ?? '').not.toBe('');
        } finally {
            await fixture.stop();
            await cleanup();
        }
    });

    test('an unverifiable identity records no pid at all and claims no liveness', async () => {
        const { ctx, cleanup } = await makeCtx();
        try {
            expect(await runAgentJoin(ctx, { role: 'coder', id: 'coder-a2', pid: 999_999, json: false })).toBe(0);
            const record = await readRecord(ctx, 'coder-a2');
            expect(record?.identity).toBe('unverified');
            expect(record?.pid).toBeNull();
            expect(record?.renewerPid).toBeNull();
        } finally {
            await cleanup();
        }
    });
});

describe('one renewer per guest (1279 R1/R4)', () => {
    test('a verified join starts a detached renewer and a rejoin does not start a second', async () => {
        const { ctx, cleanup } = await makeCtx({ CLAUDE_CODE_SESSION_ID: 'sess-x' });
        const fixture = startFixture();
        setGuestRenewerArgvForTesting([process.execPath, CLI_ENTRY]);
        try {
            expect(
                await runAgentJoin(ctx, {
                    role: 'coder',
                    id: 'coder-b1',
                    sessionId: 'sess-x',
                    pid: fixture.pid,
                    json: false,
                }),
            ).toBe(0);
            const first = await waitForRenewer(ctx, 'coder-b1');
            expect(first).not.toBeNull();
            // The renewer is a real live process, not a recorded number.
            expect(await reader.read(first ?? 0)).not.toBeNull();

            // Same host session rejoining renews the same guest — and must not fork a second owner.
            expect(
                await runAgentJoin(ctx, {
                    role: 'coder',
                    id: 'coder-b1',
                    sessionId: 'sess-x',
                    pid: fixture.pid,
                    json: false,
                }),
            ).toBe(0);
            expect(await waitForRenewer(ctx, 'coder-b1')).toBe(first);
        } finally {
            setGuestRenewerArgvForTesting(undefined);
            await fixture.stop();
            await cleanup();
        }
    });

    test('join --help lists no new option — renewal is automatic (R4)', async () => {
        const root = await mkdtemp(join(tmpdir(), 'spur-guest-help-'));
        const out = createCapturedOutput();
        try {
            await main(['agent', 'join', '--help'], { cwd: root, output: out, env: {}, dbUrl: ':memory:' });
            const help = out.messages.join('\n');
            expect(help).toContain('--role');
            expect(help).toContain('--pid');
            // Renewal adds no flag. `--member` is task 1281's separately consented surface and is
            // asserted there, so this list stays scoped to renewal vocabulary.
            for (const absent of ['--renew', '--attach', '--heartbeat']) {
                expect(help).not.toContain(absent);
            }
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});

describe('the renewer branch never joins (1279 R1)', () => {
    test('with no record it exits 0 without creating a guest', async () => {
        const root = await mkdtemp(join(tmpdir(), 'spur-guest-marker-'));
        const out = createCapturedOutput();
        try {
            const deps = { cwd: root, output: out, env: { SPUR_GUEST_RENEWER: 'coder-z1' }, dbUrl: ':memory:' };
            expect(await main(['agent', 'join', '--role', 'coder', '--id', 'coder-z1'], deps)).toBe(0);
            expect(out.messages.join('\n')).not.toContain('joined');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test('a verified guest whose agent died stops the renewer immediately', async () => {
        const { ctx, cleanup } = await makeCtx();
        const fixture = startFixture();
        try {
            expect(await runAgentJoin(ctx, { role: 'coder', id: 'coder-z2', pid: fixture.pid, json: false })).toBe(0);
            await fixture.stop();
            const markerCtx = createCliContext({
                cwd: ctx.cwd,
                output: createCapturedOutput(),
                env: { SPUR_GUEST_RENEWER: 'coder-z2' },
                dbUrl: ':memory:',
            });
            const startedAt = Date.now();
            expect(await runAgentJoin(markerCtx, { role: 'coder', id: 'coder-z2', json: false })).toBe(0);
            // One tick, not a sleep interval: the identity check runs before the heartbeat.
            expect(Date.now() - startedAt).toBeLessThan(2000);
        } finally {
            await fixture.stop();
            await cleanup();
        }
    });
});
