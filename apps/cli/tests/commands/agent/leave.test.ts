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
import { runAgentLeave } from '../../../src/commands/agent';
import { type CliContext, createCliContext } from '../../../src/context';
import { createCapturedOutput, inboxFixture } from '../../helpers';

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

describe('guest CLI surface through the real command tree (1081 E2E)', () => {
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
            const inbox = inboxFixture(await (await createCliContext(deps)).getDb());
            const messageId = await inbox.enqueue('proj-lead', 'g-env', 'work');
            expect(await main(['agent', 'wait', '--inbox', 'g-env', '--timeout', '5000'], deps)).toBe(0);
            expect(out.messages.join('\n')).toContain(`[${messageId}] proj-lead: work`);
            expect((await inbox.getById(messageId))?.status).toBe('delivered');

            // leave by an explicit --session-id, then a second leave is a usage error
            expect(await main(['agent', 'leave', '--session-id', 'sess-env'], deps)).toBe(0);
            expect(await main(['agent', 'leave', '--session-id', 'sess-env', '--json'], deps)).toBe(2);
            expect(out.messages.join('\n')).toContain('no guest joined by session sess-env');
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
