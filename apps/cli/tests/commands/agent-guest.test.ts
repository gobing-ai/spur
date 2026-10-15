/**
 * Task 1081 R2/R3/R4 — the guest CLI surface.
 *
 * Failure list pinned here:
 *   - `wait --inbox` never returns      → returns 0 on queued work, 1 on timeout, never hangs
 *   - a guest is routed a stage         → `agent run --spec <guest>` is refused (R3)
 *   - a guest is addressed by `--role`  → a guest id never resolves through the declared roster
 */
import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InboxMessageDao } from '@gobing-ai/spur-domain';
import { refuseGuestStageTarget, runAgentJoin, runAgentWaitInbox } from '../../src/commands/agent';
import { type CliContext, createCliContext } from '../../src/context';
import { createCapturedOutput } from '../helpers';

async function makeCtx(env: Record<string, string | undefined> = {}): Promise<{
    ctx: CliContext;
    out: ReturnType<typeof createCapturedOutput>;
    cleanup: () => Promise<void>;
}> {
    const root = await mkdtemp(join(tmpdir(), 'spur-agent-guest-'));
    const out = createCapturedOutput();
    const ctx = createCliContext({ cwd: root, output: out, env, dbUrl: ':memory:' });
    return { ctx, out, cleanup: async () => rm(root, { recursive: true, force: true }) };
}

describe('spur agent join/leave (1081 R2)', () => {
    test('an unknown role exits 2 with the accepted vocabulary', async () => {
        const { ctx, out, cleanup } = await makeCtx();
        try {
            expect(await runAgentJoin(ctx, { role: 'wizard', json: false })).toBe(2);
            expect(out.errors.join('\n')).toContain('not a Layer-1 role');
        } finally {
            await cleanup();
        }
    });
});

describe('spur agent wait --inbox (1081 R4)', () => {
    test('returns 0 as soon as queued work exists for the guest', async () => {
        const { ctx, out, cleanup } = await makeCtx();
        try {
            await runAgentJoin(ctx, { role: 'reviewer', id: 'g-review', json: false });
            await new InboxMessageDao(await ctx.getDb()).enqueue('proj-lead', 'g-review', 'please review');
            expect(await runAgentWaitInbox(ctx, { id: 'g-review', timeoutMs: 5000, json: false, pollMs: 10 })).toBe(0);
            expect(out.messages.join('\n')).toContain('g-review: 1 pending message(s)');
        } finally {
            await cleanup();
        }
    });

    test('times out with exit 1 (never a silent hang) when nothing is queued', async () => {
        const { ctx, out, cleanup } = await makeCtx();
        try {
            await runAgentJoin(ctx, { role: 'reviewer', id: 'g-idle', json: false });
            expect(await runAgentWaitInbox(ctx, { id: 'g-idle', timeoutMs: 50, json: false, pollMs: 10 })).toBe(1);
            expect(out.errors.join('\n')).toContain('no inbox work for guest "g-idle"');
        } finally {
            await cleanup();
        }
    });

    test('a never-joined id fails fast instead of polling', async () => {
        const { ctx, out, cleanup } = await makeCtx();
        try {
            expect(await runAgentWaitInbox(ctx, { id: 'ghost', timeoutMs: 50, json: false, pollMs: 10 })).toBe(1);
            expect(out.errors.join('\n')).toContain('is not joined');
        } finally {
            await cleanup();
        }
    });
});

describe('guest stage refusal (1081 R3)', () => {
    test('a joined guest id is refused as a stage target; an ordinary id is not', async () => {
        const { ctx, out, cleanup } = await makeCtx();
        try {
            await runAgentJoin(ctx, { role: 'coder', id: 'g-coder', json: false });
            expect(await refuseGuestStageTarget(ctx, 'g-coder')).toBe(2);
            expect(out.errors.join('\n')).toContain('never dispatched a stage');

            expect(await refuseGuestStageTarget(ctx, 'proj-declared-coder')).toBeNull();
            expect(await refuseGuestStageTarget(ctx, 'g-coder')).not.toBeNull();
        } finally {
            await cleanup();
        }
    });

    test('the refusal is enveloped under --json (never bare stderr on a JSON surface)', async () => {
        const { ctx, out, cleanup } = await makeCtx();
        try {
            await runAgentJoin(ctx, { role: 'coder', id: 'g-json', json: false });
            expect(await refuseGuestStageTarget(ctx, 'g-json', { json: true, jsonEnvelope: true })).toBe(2);
            expect(out.errors).toEqual([]);
            expect(out.messages.join('\n')).toContain('GUARD_DENIED');
        } finally {
            await cleanup();
        }
    });
});

describe('guest CLI surface through the real command tree (1081 E2E)', () => {});
