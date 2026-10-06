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
import { main } from '../../src';
import { refuseGuestStageTarget, runAgentJoin, runAgentLeave, runAgentWaitInbox } from '../../src/commands/agent';
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
    test('join registers the guest and prints its id; leave releases it', async () => {
        const { ctx, out, cleanup } = await makeCtx({ CLAUDE_CODE_SESSION_ID: 'sess-abc' });
        try {
            expect(await runAgentJoin(ctx, { role: 'reviewer', json: false })).toBe(0);
            expect(out.messages.join('\n')).toContain('guest reviewer-g1 joined as reviewer');
            expect(out.messages.join('\n')).toContain('session sess-abc');

            expect(await runAgentLeave(ctx, { json: false })).toBe(0);
            expect(out.messages.join('\n')).toContain('guest reviewer-g1 left the fleet');
        } finally {
            await cleanup();
        }
    });

    test('an unknown role exits 2 with the accepted vocabulary', async () => {
        const { ctx, out, cleanup } = await makeCtx();
        try {
            expect(await runAgentJoin(ctx, { role: 'wizard', json: false })).toBe(2);
            expect(out.errors.join('\n')).toContain('not a Layer-1 role');
        } finally {
            await cleanup();
        }
    });

    test('leave without an id when this session never joined is a usage error', async () => {
        const { ctx, out, cleanup } = await makeCtx({ CLAUDE_CODE_SESSION_ID: 'sess-none' });
        try {
            expect(await runAgentLeave(ctx, { json: false })).toBe(2);
            expect(out.errors.join('\n')).toContain('no guest joined by session sess-none');
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

describe('guest CLI surface through the real command tree (1081 E2E)', () => {
    test('join → wait --inbox → leave round-trip, JSON branches included', async () => {
        const root = await mkdtemp(join(tmpdir(), 'spur-agent-guest-e2e-'));
        const out = createCapturedOutput();
        // File-backed DB: the lease must survive across `main` calls for the round-trip to be
        // real (an in-memory db per call makes every guest look expired at the next call).
        const deps = {
            cwd: root,
            output: out,
            dbUrl: join(root, '.spur', 'spur.db'),
            env: { CLAUDE_CODE_SESSION_ID: 'sess-e2e' },
        };
        try {
            // join with --json plus explicit --pid/--executor
            expect(
                await main(
                    [
                        'agent',
                        'join',
                        '--role',
                        'reviewer',
                        '--id',
                        'g-e2e',
                        '--pid',
                        '77',
                        '--executor',
                        'pi',
                        '--json',
                    ],
                    deps,
                ),
            ).toBe(0);
            expect(out.messages.join('\n')).toContain('g-e2e');

            // the same host session rejoining renews its guest; another session collides (usage error)
            expect(await main(['agent', 'join', '--role', 'reviewer', '--id', 'g-e2e', '--json'], deps)).toBe(0);
            expect(
                await main(
                    ['agent', 'join', '--role', 'reviewer', '--id', 'g-e2e', '--session-id', 'sess-other', '--json'],
                    deps,
                ),
            ).toBe(2);

            // wait --inbox: nothing queued → exit 1 with the envelope
            expect(await main(['agent', 'wait', '--inbox', 'g-e2e', '--timeout', '50', '--json'], deps)).toBe(1);

            // addressing a spec id and --inbox together is refused
            expect(await main(['agent', 'wait', 'some-spec', '--inbox', 'g-e2e'], deps)).toBe(2);

            // leave by session id, then leaving again is a usage error
            expect(await main(['agent', 'leave', '--json'], deps)).toBe(0);
            expect(await main(['agent', 'leave', 'g-e2e'], deps)).toBe(2);

            // an unknown role is refused by the command tree too
            expect(await main(['agent', 'join', '--role', 'wizard'], deps)).toBe(2);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test('the JSON/envelope and refusal branches of the guest surface', async () => {
        const root = await mkdtemp(join(tmpdir(), 'spur-agent-guest-e2e2-'));
        const out = createCapturedOutput();
        const deps = {
            cwd: root,
            output: out,
            dbUrl: join(root, '.spur', 'spur.db'),
            env: { CLAUDE_CODE_SESSION_ID: 'sess-env' },
        };
        try {
            // join enveloped, then report (the lifecycle verb) through the same tree
            expect(
                await main(['agent', 'join', '--role', 'coder', '--id', 'g-env', '--json', '--json-envelope'], deps),
            ).toBe(0);
            expect(out.messages.join('\n')).toContain('"guest"');
            expect(
                await main(['agent', 'report', '--state', 'working', '--seq', '11', '--spec', 'g-env', '--json'], deps),
            ).toBe(0);
            expect(out.messages.join('\n')).toContain('"accepted": true');

            // a stage dispatch to the guest is refused, in JSON
            expect(await main(['agent', 'run', 'ping', '--spec', 'g-env', '--json'], deps)).toBe(2);
            expect(out.messages.join('\n')).toContain('guest-stage-refused');

            // wait --inbox with queued work returns 0 (text branch)
            await new InboxMessageDao(await (await createCliContext(deps)).getDb()).enqueue(
                'proj-lead',
                'g-env',
                'work',
            );
            expect(await main(['agent', 'wait', '--inbox', 'g-env', '--timeout', '5000'], deps)).toBe(0);
            expect(out.messages.join('\n')).toContain('pending message(s)');

            // leave by an explicit --session-id, then a second leave is a usage error
            expect(await main(['agent', 'leave', '--session-id', 'sess-env'], deps)).toBe(0);
            expect(await main(['agent', 'leave', '--session-id', 'sess-env', '--json'], deps)).toBe(2);
            expect(out.messages.join('\n')).toContain('no guest joined by session sess-env');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
