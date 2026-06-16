import { describe, expect, test } from 'bun:test';
import type { ServerContext } from '../../../src/context';
import { createTaskHandlers } from '../../../src/modules/task';

describe('task handlers', () => {
    function makeCtx(overrides?: Record<string, unknown>) {
        return {
            taskService: () => ({
                list: async () => [{ wbs: '0001', name: 'Test', status: 'todo', filePath: '/test/0001.md' }],
                show: async (wbs: string) => ({
                    wbs,
                    name: 'Test',
                    status: 'wip',
                    filePath: `/test/${wbs}.md`,
                    frontmatter: {},
                    content: '# Task',
                }),
                create: async () => ({
                    ref: { id: '0001', filePath: '/test/0001.md', kind: 'task' as const, folder: '.' },
                }),
                updateStatus: async () => ({
                    ref: { id: '0001', filePath: '/test/0001.md', kind: 'task' as const, folder: '.' },
                }),
                ...overrides,
            }),
        } as unknown as ServerContext;
    }

    test('returns expected route keys', () => {
        const handlers = createTaskHandlers(makeCtx());
        expect(Object.keys(handlers).sort()).toEqual(['create', 'list', 'show', 'transition']);
    });

    test('list handler returns ok:true with data', async () => {
        const handlers = createTaskHandlers(makeCtx());
        const fn = handlers.list['~orpc'].handler as unknown as (
            opts: Record<string, unknown>,
        ) => Promise<{ ok: boolean; data: unknown[] }>;
        const result = await fn({});
        expect(result.ok).toBe(true);
        expect((result.data as Array<Record<string, unknown>>)[0]?.wbs).toBe('0001');
    });

    test('list handler passes query params to toFilters', async () => {
        const handlers = createTaskHandlers(makeCtx());
        const fn = handlers.list['~orpc'].handler as unknown as (opts: {
            input?: Record<string, unknown>;
        }) => Promise<unknown>;
        await fn({ input: { status: 'todo', parent: '0001' } });
        await fn({ input: {} });
        await fn({ input: undefined });
    });

    test('show handler returns task detail', async () => {
        const handlers = createTaskHandlers(makeCtx());
        const fn = handlers.show['~orpc'].handler as unknown as (opts: {
            input: { wbs: string };
        }) => Promise<{ ok: boolean; data: { wbs: string; name: string; status: string; content: string } }>;
        const result = await fn({ input: { wbs: '0001' } });
        expect(result.ok).toBe(true);
        expect(result.data.wbs).toBe('0001');
        expect(result.data.status).toBe('wip');
        expect(result.data.content).toBe('# Task');
    });

    test('show handler throws NotFoundError when service returns null', async () => {
        const handlers = createTaskHandlers(makeCtx({ show: async () => null }));
        const fn = handlers.show['~orpc'].handler as unknown as (opts: { input: { wbs: string } }) => Promise<unknown>;
        await expect(fn({ input: { wbs: '9999' } })).rejects.toThrow('Task 9999 not found');
    });

    test('create handler returns wbs and filePath', async () => {
        const handlers = createTaskHandlers(makeCtx());
        const fn = handlers.create['~orpc'].handler as unknown as (opts: {
            input: { title: string; featureId?: string; parentWbs?: string };
        }) => Promise<{ ok: boolean; data: { wbs: string; filePath: string } }>;
        const result = await fn({ input: { title: 'New', featureId: 'F2', parentWbs: '0001' } });
        expect(result.ok).toBe(true);
        expect(result.data.wbs).toBe('0001');
        expect(result.data.filePath).toBe('/test/0001.md');
    });

    test('transition handler returns wbs and new status', async () => {
        const handlers = createTaskHandlers(makeCtx());
        const fn = handlers.transition['~orpc'].handler as unknown as (opts: {
            input: { wbs: string; toStatus: string; actor?: string };
        }) => Promise<{ ok: boolean; data: { wbs: string; status: string } }>;
        const result = await fn({ input: { wbs: '0001', toStatus: 'done', actor: 'robin' } });
        expect(result.ok).toBe(true);
        expect(result.data.wbs).toBe('0001');
        expect(result.data.status).toBe('done');
    });
});
