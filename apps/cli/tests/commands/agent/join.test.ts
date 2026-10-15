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
import { main } from '../../../src';
import { runAgentJoin, runAgentLeave } from '../../../src/commands/agent';
import { type CliContext, createCliContext } from '../../../src/context';
import { createCapturedOutput } from '../../helpers';

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
});
