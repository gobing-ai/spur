import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
