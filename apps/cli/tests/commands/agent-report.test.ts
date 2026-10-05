/**
 * Task 1080 R1/R2 — the `spur agent report` verb (the host hooks' only CLI call).
 *
 * Covers the contracts the hook depends on: the `SPUR_SPEC_ID` default, the stale-seq
 * drop (exit 0, no state change), and the usage errors (exit 2) that make a misconfigured
 * hook surface instead of silently dropping reports.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLifecycle } from '@gobing-ai/spur-domain';
import { runAgentReport } from '../../src/commands/agent';
import { type CliContext, createCliContext } from '../../src/context';
import { createCapturedOutput } from '../helpers';

async function makeCtx(env: Record<string, string | undefined> = {}): Promise<{
    ctx: CliContext;
    out: ReturnType<typeof createCapturedOutput>;
    cleanup: () => Promise<void>;
}> {
    const root = await mkdtemp(join(tmpdir(), 'spur-agent-report-'));
    const out = createCapturedOutput();
    const ctx = createCliContext({ cwd: root, output: out, env, dbUrl: ':memory:' });
    return { ctx, out, cleanup: async () => rm(root, { recursive: true, force: true }) };
}

describe('spur agent report (1080)', () => {
    test('reports through the service when --spec is given, and the ledger carries the row', async () => {
        const { ctx, cleanup } = await makeCtx();
        try {
            const code = await runAgentReport(ctx, { state: 'blocked', seq: '7', spec: 'proj-worker-1', json: true });
            expect(code).toBe(0);
            expect((await readLifecycle(await ctx.getDb(), ['proj-worker-1'])).get('proj-worker-1')).toMatchObject({
                state: 'blocked',
                seq: 7,
            });
        } finally {
            await cleanup();
        }
    });

    test('SPUR_SPEC_ID is the member id when --spec is absent', async () => {
        const { ctx, out, cleanup } = await makeCtx({ SPUR_SPEC_ID: 'proj-worker-2' });
        try {
            expect(await runAgentReport(ctx, { state: 'working', seq: '9', json: false })).toBe(0);
            expect(out.messages.join('\n')).toContain('proj-worker-2: working');
            expect((await readLifecycle(await ctx.getDb(), ['proj-worker-2'])).get('proj-worker-2')).toMatchObject({
                state: 'working',
            });
        } finally {
            await cleanup();
        }
    });

    test('a stale sequence is ignored — exit 0, state unchanged', async () => {
        const { ctx, out, cleanup } = await makeCtx({ SPUR_SPEC_ID: 'proj-worker-3' });
        try {
            await runAgentReport(ctx, { state: 'working', seq: '5', json: false });
            expect(await runAgentReport(ctx, { state: 'idle', seq: '4', json: false })).toBe(0);
            expect(out.messages.join('\n')).toContain('ignored stale report');
            expect((await readLifecycle(await ctx.getDb(), ['proj-worker-3'])).get('proj-worker-3')).toMatchObject({
                state: 'working',
                seq: 5,
            });
        } finally {
            await cleanup();
        }
    });

    test('no member id is a usage error (exit 2), not a silent no-op', async () => {
        const { ctx, out, cleanup } = await makeCtx({});
        try {
            expect(await runAgentReport(ctx, { state: 'idle', seq: '1', json: false })).toBe(2);
            expect(out.errors.join('\n')).toContain('no member id (set SPUR_SPEC_ID or --spec)');
        } finally {
            await cleanup();
        }
    });

    test('an unknown state or a non-numeric seq is a usage error', async () => {
        const { ctx, cleanup } = await makeCtx({ SPUR_SPEC_ID: 'proj-worker-4' });
        try {
            expect(await runAgentReport(ctx, { state: 'flying', seq: '1', json: false })).toBe(2);
            expect(await runAgentReport(ctx, { state: 'idle', seq: 'soon', json: false })).toBe(2);
            expect(await runAgentReport(ctx, { state: undefined, seq: '1', json: false })).toBe(2);
        } finally {
            await cleanup();
        }
    });
});
