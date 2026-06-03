import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMessageCommand } from '../../src/commands/message';
import { type CliContext, createCliContext } from '../../src/context';
import { createCapturedOutput } from '../helpers';

/** A CLI context bound to a temp project and a shared in-memory database. */
async function makeCtx(): Promise<{
    ctx: CliContext;
    out: ReturnType<typeof createCapturedOutput>;
    cleanup: () => Promise<void>;
}> {
    const cwd = await mkdtemp(join(tmpdir(), 'spur-msg-'));
    const out = createCapturedOutput();
    const ctx = createCliContext({ cwd, output: out, dbUrl: ':memory:' });
    return { ctx, out, cleanup: async () => rm(cwd, { recursive: true, force: true }) };
}

describe('spur message send', () => {
    test('enqueues a message and prints the id', async () => {
        const { ctx, out, cleanup } = await makeCtx();
        try {
            const code = await runMessageCommand('send', ctx, { to: 'planner' }, ['hello', 'there']);
            expect(code).toBe(0);
            expect(out.messages.join('\n')).toMatch(/queued .+ → planner/);
        } finally {
            await cleanup();
        }
    });

    test('--json emits the structured result', async () => {
        const { ctx, out, cleanup } = await makeCtx();
        try {
            const code = await runMessageCommand('send', ctx, { to: 'planner', json: true }, ['hi']);
            expect(code).toBe(0);
            const payload = JSON.parse(out.messages[0] ?? '{}');
            expect(payload.toId).toBe('planner');
            expect(payload.status).toBe('queued');
        } finally {
            await cleanup();
        }
    });

    test('requires --to', async () => {
        const { ctx, out, cleanup } = await makeCtx();
        try {
            const code = await runMessageCommand('send', ctx, {}, ['hi']);
            expect(code).toBe(2);
            expect(out.errors.join('\n')).toMatch(/requires --to/);
        } finally {
            await cleanup();
        }
    });

    test('requires a non-empty body', async () => {
        const { ctx, out, cleanup } = await makeCtx();
        try {
            const code = await runMessageCommand('send', ctx, { to: 'planner' }, []);
            expect(code).toBe(2);
            expect(out.errors.join('\n')).toMatch(/non-empty body/);
        } finally {
            await cleanup();
        }
    });

    test('rejects a malformed --to id with exit 2', async () => {
        const { ctx, out, cleanup } = await makeCtx();
        try {
            const code = await runMessageCommand('send', ctx, { to: 'Bad Id' }, ['hi']);
            expect(code).toBe(2);
            expect(out.errors.join('\n')).toMatch(/Invalid agent id/);
        } finally {
            await cleanup();
        }
    });
});

describe('spur message inbox', () => {
    test('lists messages for an agent', async () => {
        const { ctx, out, cleanup } = await makeCtx();
        try {
            await runMessageCommand('send', ctx, { to: 'planner' }, ['first']);
            const code = await runMessageCommand('inbox', ctx, { agent: 'planner' }, []);
            expect(code).toBe(0);
            expect(out.messages.join('\n')).toContain('first');
        } finally {
            await cleanup();
        }
    });

    test('reports empty inbox', async () => {
        const { ctx, out, cleanup } = await makeCtx();
        try {
            const code = await runMessageCommand('inbox', ctx, { agent: 'ghost' }, []);
            expect(code).toBe(0);
            expect(out.messages.join('\n')).toMatch(/No messages/);
        } finally {
            await cleanup();
        }
    });

    test('--json lists messages structurally', async () => {
        const { ctx, out, cleanup } = await makeCtx();
        try {
            await runMessageCommand('send', ctx, { to: 'planner' }, ['hi']);
            const code = await runMessageCommand('inbox', ctx, { agent: 'planner', json: true }, []);
            expect(code).toBe(0);
            const payload = JSON.parse(out.messages.at(-1) ?? '{}');
            expect(payload.count).toBe(1);
            expect(payload.messages[0].body).toBe('hi');
        } finally {
            await cleanup();
        }
    });

    test('requires --agent', async () => {
        const { ctx, out, cleanup } = await makeCtx();
        try {
            const code = await runMessageCommand('inbox', ctx, {}, []);
            expect(code).toBe(2);
            expect(out.errors.join('\n')).toMatch(/requires --agent/);
        } finally {
            await cleanup();
        }
    });
});

describe('spur message reply', () => {
    test('threads a reply back to the original sender', async () => {
        const { ctx, out, cleanup } = await makeCtx();
        try {
            // coder → planner, then reply must address coder.
            await runMessageCommand('send', ctx, { to: 'planner', from: 'coder' }, ['need plan']);
            const inbox = await runMessageCommand('inbox', ctx, { agent: 'planner', json: true }, []);
            expect(inbox).toBe(0);
            const msgId = JSON.parse(out.messages.at(-1) ?? '{}').messages[0].id;

            const code = await runMessageCommand('reply', ctx, {}, [msgId, 'here', 'is', 'the', 'plan']);
            expect(code).toBe(0);
            expect(out.messages.at(-1)).toMatch(/replied .+ → coder/);
        } finally {
            await cleanup();
        }
    });

    test('requires a msg id', async () => {
        const { ctx, out, cleanup } = await makeCtx();
        try {
            const code = await runMessageCommand('reply', ctx, {}, []);
            expect(code).toBe(2);
            expect(out.errors.join('\n')).toMatch(/requires <msg-id>/);
        } finally {
            await cleanup();
        }
    });
});

describe('spur message dispatch', () => {
    test('rejects an unknown subcommand', async () => {
        const { ctx, out, cleanup } = await makeCtx();
        try {
            const code = await runMessageCommand('bogus', ctx, {}, []);
            expect(code).toBe(1);
            expect(out.errors.join('\n')).toMatch(/Unknown message command/);
        } finally {
            await cleanup();
        }
    });
});
