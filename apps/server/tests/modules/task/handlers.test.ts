import { describe, expect, test } from 'bun:test';
import type { ServerContext } from '../../../src/context';
import { createTaskHandlers } from '../../../src/modules/task';

describe('task handlers', () => {
    function makeCtx(overrides?: Record<string, unknown>) {
        const enqueue = async (_type: string, _payload: unknown) => 'run-001';
        return {
            cwd: '/test',
            fs: {
                readFile: async (path: string) => {
                    if (path.includes('config.jsonc')) {
                        return '{ "folders": { "docs/tasks": { "label": "Primary" }, "docs/sprint2": { "label": "Sprint 2" } } }';
                    }
                    throw new Error('not found');
                },
            },
            taskService: () => ({
                list: async () => [
                    {
                        wbs: '0001',
                        name: 'Test',
                        status: 'todo',
                        filePath: '/test/0001.md',
                        frontmatter: {
                            priority: 'P1',
                            feature_id: 'A1',
                            parent_wbs: '0000',
                            type: 'task',
                            updated_at: '2026-06-13T00:00:00.000Z',
                        },
                    },
                ],
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
                updateBody: async () => ({
                    ref: { id: '0001', filePath: '/test/0001.md', kind: 'task' as const, folder: '.' },
                }),
                fulfillAction: async (
                    wbs: string,
                    action: string,
                    fn: (job: unknown) => Promise<string>,
                    options?: { channel?: string; skipDeps?: boolean },
                ) => {
                    const runId = await fn({ wbs, action, channel: options?.channel, skipDeps: options?.skipDeps });
                    return { runId, action, status: 'queued' as const };
                },
                ...overrides,
            }),
            jobQueue: async () => ({ enqueue }),
        } as unknown as ServerContext;
    }

    test('returns expected route keys', () => {
        const handlers = createTaskHandlers(makeCtx());
        expect(Object.keys(handlers).sort()).toEqual([
            'action',
            'body',
            'create',
            'folders',
            'list',
            'show',
            'transition',
        ]);
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

    test('body handler returns wbs and filePath', async () => {
        const handlers = createTaskHandlers(makeCtx());
        const fn = handlers.body['~orpc'].handler as unknown as (opts: {
            input: { wbs: string; body: string; actor?: string };
        }) => Promise<{ ok: boolean; data: { wbs: string; filePath: string } }>;
        const result = await fn({ input: { wbs: '0001', body: '# New body', actor: 'robin' } });
        expect(result.ok).toBe(true);
        expect(result.data.wbs).toBe('0001');
        expect(result.data.filePath).toBe('/test/0001.md');
    });

    test('action handler enqueues run action and returns runId', async () => {
        const handlers = createTaskHandlers(makeCtx());
        const fn = handlers.action['~orpc'].handler as unknown as (opts: {
            input: { wbs: string; action: string };
        }) => Promise<{ ok: boolean; data: { runId: string; action: string; status: string } }>;
        const result = await fn({ input: { wbs: '0001', action: 'run' } });
        expect(result.ok).toBe(true);
        expect(result.data.runId).toBe('run-001');
        expect(result.data.action).toBe('run');
        expect(result.data.status).toBe('queued');
    });

    test('action handler does not throw for non-run actions', async () => {
        const handlers = createTaskHandlers(makeCtx());
        const fn = handlers.action['~orpc'].handler as unknown as (opts: {
            input: { wbs: string; action: string };
        }) => Promise<{ ok: boolean; data: { runId: string; action: string; status: string } }>;
        for (const action of ['refine', 'plan', 'verify', 'decompose', 'evaluate']) {
            const result = await fn({ input: { wbs: '0001', action } });
            expect(result.ok).toBe(true);
            expect(result.data.runId).toBe('run-001');
            expect(result.data.action).toBe(action);
            expect(result.data.status).toBe('queued');
        }
    });

    test('action handler passes channel and skipDeps', async () => {
        let capturedOptions: { channel?: string; skipDeps?: boolean } | undefined;
        const handlers = createTaskHandlers(
            makeCtx({
                fulfillAction: async (
                    wbs: string,
                    action: string,
                    fn: (job: unknown) => Promise<string>,
                    options?: { channel?: string; skipDeps?: boolean },
                ) => {
                    capturedOptions = options;
                    const runId = await fn({ wbs, action, channel: options?.channel, skipDeps: options?.skipDeps });
                    return { runId, action, status: 'queued' as const };
                },
            }),
        );
        const fn = handlers.action['~orpc'].handler as unknown as (opts: {
            input: { wbs: string; action: string; channel?: string; skipDeps?: boolean };
        }) => Promise<unknown>;
        await fn({ input: { wbs: '0001', action: 'run', channel: 'codex', skipDeps: true } });
        expect(capturedOptions).toEqual({ channel: 'codex', skipDeps: true });
    });

    test('list handler returns priority, featureId, parentWbs, type from frontmatter', async () => {
        const handlers = createTaskHandlers(makeCtx());
        const fn = handlers.list['~orpc'].handler as unknown as (
            opts: Record<string, unknown>,
        ) => Promise<{ ok: boolean; data: Array<Record<string, unknown>> }>;
        const result = await fn({});
        expect(result.ok).toBe(true);
        const task = result.data[0];
        expect(task?.priority).toBe('P1');
        expect(task?.featureId).toBe('A1');
        expect(task?.parentWbs).toBe('0000');
        expect(task?.type).toBe('task');
    });

    test('create handler passes template to taskService', async () => {
        let capturedParams: Record<string, unknown> | undefined;
        const handlers = createTaskHandlers(
            makeCtx({
                create: async (params: Record<string, unknown>) => {
                    capturedParams = params;
                    return { ref: { id: '0001', filePath: '/test/0001.md', kind: 'task' as const, folder: '.' } };
                },
            }),
        );
        const fn = handlers.create['~orpc'].handler as unknown as (opts: {
            input: { title: string; featureId?: string; parentWbs?: string; template?: string };
        }) => Promise<unknown>;
        await fn({ input: { title: 'New', template: 'review' } });
        expect(capturedParams).toMatchObject({ title: 'New', template: 'review' });
    });

    test('folders handler returns configured folders', async () => {
        const handlers = createTaskHandlers(makeCtx());
        const fn = handlers.folders['~orpc'].handler as unknown as () => Promise<{
            ok: boolean;
            data: Array<{ path: string; label?: string }>;
        }>;
        const result = await fn();
        expect(result.ok).toBe(true);
        expect(result.data).toEqual([
            { path: 'docs/tasks', label: 'Primary' },
            { path: 'docs/sprint2', label: 'Sprint 2' },
        ]);
    });

    test('folders handler falls back to default when config missing', async () => {
        const ctx = {
            cwd: '/test',
            fs: {
                readFile: async () => {
                    throw new Error('not found');
                },
            },
        } as unknown as ServerContext;
        const handlers = createTaskHandlers(ctx);
        const fn = handlers.folders['~orpc'].handler as unknown as () => Promise<{
            ok: boolean;
            data: Array<{ path: string; label?: string }>;
        }>;
        const result = await fn();
        expect(result.ok).toBe(true);
        expect(result.data).toEqual([{ path: 'docs/tasks', label: 'Primary' }]);
    });
});
