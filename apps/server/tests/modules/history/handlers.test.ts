import { describe, expect, test } from 'bun:test';
import { MockHistoryBoardService } from '@gobing-ai/spur-app';
import type { ServerContext } from '../../../src/context';
import { createHistoryHandlers } from '../../../src/modules/history';

describe('history handlers', () => {
    function makeCtx() {
        const mockService = new MockHistoryBoardService();
        return {
            historyBoardService: () => mockService,
        } as unknown as ServerContext;
    }

    test('getSummary handler returns ok:true with summary data', async () => {
        const ctx = makeCtx();
        const handlers = createHistoryHandlers(ctx);
        const handler = (
            handlers.getSummary as unknown as { '~orpc': { handler: (arg: unknown) => Promise<unknown> } }
        )['~orpc'].handler;
        const result = (await handler({ input: { range: '30d' } })) as {
            ok: boolean;
            data: { kpis: { totalBilledTokens: number } };
        };

        expect(result.ok).toBe(true);
        expect(result.data.kpis.totalBilledTokens).toBeGreaterThan(0);
    });

    test('getTimeline handler returns ok:true with timeline data', async () => {
        const service = new MockHistoryBoardService();
        const sessions = await service.getSessions({ page: 1, pageSize: 1 });
        const item = sessions.items[0];
        expect(item).toBeDefined();
        const ctx = { historyBoardService: () => service } as unknown as ServerContext;
        const handlers = createHistoryHandlers(ctx);
        const handler = (
            handlers.getTimeline as unknown as { '~orpc': { handler: (arg: unknown) => Promise<unknown> } }
        )['~orpc'].handler;
        const result = (await handler({
            input: { mode: 'session', source: item?.source ?? 'claude', sessionId: item?.id ?? 'sess-1' },
        })) as {
            ok: boolean;
            data: { scope: { sessionId: string } };
        };

        expect(result.ok).toBe(true);
        expect(result.data.scope.sessionId).toBeDefined();
    });

    test('getToolSequence handler returns ok:true with tool sequence data', async () => {
        const service = new MockHistoryBoardService();
        const sessions = await service.getSessions({ page: 1, pageSize: 1 });
        const item = sessions.items[0];
        expect(item).toBeDefined();
        const ctx = { historyBoardService: () => service } as unknown as ServerContext;
        const handlers = createHistoryHandlers(ctx);
        const handler = (
            handlers.getToolSequence as unknown as { '~orpc': { handler: (arg: unknown) => Promise<unknown> } }
        )['~orpc'].handler;
        const result = (await handler({
            input: { mode: 'session', source: item?.source ?? 'claude', sessionId: item?.id ?? 'sess-1' },
        })) as {
            ok: boolean;
            data: { scope: { totalCalls: number }; items: unknown[] };
        };

        expect(result.ok).toBe(true);
        expect(result.data.items).toBeDefined();
        expect(result.data.scope.totalCalls).toBeGreaterThan(0);
    });

    test('getSessions handler returns ok:true with session list', async () => {
        const ctx = makeCtx();
        const handlers = createHistoryHandlers(ctx);
        const handler = (
            handlers.getSessions as unknown as { '~orpc': { handler: (arg: unknown) => Promise<unknown> } }
        )['~orpc'].handler;
        const result = (await handler({ input: { page: 1, pageSize: 10 } })) as {
            ok: boolean;
            data: { items: unknown[]; total: number };
        };

        expect(result.ok).toBe(true);
        expect(result.data.items.length).toBe(10);
    });

    test('getInsights handler returns ok:true with insights data', async () => {
        const ctx = makeCtx();
        const handlers = createHistoryHandlers(ctx);
        const handler = (
            handlers.getInsights as unknown as { '~orpc': { handler: (arg: unknown) => Promise<unknown> } }
        )['~orpc'].handler;
        const result = (await handler({ input: {} })) as { ok: boolean; data: { loops: unknown[] } };

        expect(result.ok).toBe(true);
        expect(result.data.loops.length).toBeGreaterThan(0);
    });

    test('getSources handler returns ok:true with sources overview', async () => {
        const ctx = makeCtx();
        const handlers = createHistoryHandlers(ctx);
        const handler = (
            handlers.getSources as unknown as { '~orpc': { handler: (arg: unknown) => Promise<unknown> } }
        )['~orpc'].handler;
        const result = (await handler({})) as { ok: boolean; data: { agents: unknown[] } };

        expect(result.ok).toBe(true);
        expect(result.data.agents.length).toBe(9);
    });

    test('triggerImport handler returns ok:true with import receipt', async () => {
        const ctx = makeCtx();
        const handlers = createHistoryHandlers(ctx);
        const handler = (
            handlers.triggerImport as unknown as { '~orpc': { handler: (arg: unknown) => Promise<unknown> } }
        )['~orpc'].handler;
        const result = (await handler({ input: { mode: 'incremental' } })) as { ok: boolean; data: { runId: string } };

        expect(result.ok).toBe(true);
        expect(result.data.runId).toBeDefined();
    });
});
