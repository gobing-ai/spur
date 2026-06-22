import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import { contract } from '../src';
// Re-exported schemas for direct testing (avoids accessing oRPC internals via `~orpc`).
import {
    featureContract,
    featureCreateInputSchema,
    featureCreateResponseSchema,
    featureListResponseSchema,
    featureShowResponseSchema,
    featureTransitionInputSchema,
    featureTransitionResponseSchema,
} from '../src/feature';
import { planningEventContract, planningEventEnvelopeSchema } from '../src/planning-event';
import { apiErrorSchema, apiSuccessSchema, paginatedResponseSchema, paginationMetaSchema } from '../src/shared';
import {
    taskBodyUpdateInputSchema,
    taskBodyUpdateResponseSchema,
    taskContract,
    taskCreateInputSchema,
    taskCreateResponseSchema,
    taskListResponseSchema,
    taskShowResponseSchema,
    taskTransitionInputSchema,
    taskTransitionResponseSchema,
} from '../src/task';

// ─── Helpers ────────────────────────────────────────────────────────────────
/** Extract the route metadata from an oRPC contract procedure. */
function routeOf(proc: object): { method: string; path: string } | undefined {
    const orpc = (proc as Record<string, unknown>)['~orpc'] as { route: { method: string; path: string } } | undefined;
    return orpc?.route;
}

// ─── Shared envelopes ───────────────────────────────────────────────────────

describe('shared envelopes', () => {
    test('apiSuccessSchema wraps data with ok:true', () => {
        const schema = apiSuccessSchema(z.object({ name: z.string() }));
        const result = schema.parse({ ok: true, data: { name: 'test' } });
        expect(result).toEqual({ ok: true, data: { name: 'test' } });
    });

    test('apiSuccessSchema rejects ok:false', () => {
        const schema = apiSuccessSchema(z.object({ name: z.string() }));
        expect(() => schema.parse({ ok: false, data: { name: 'test' } })).toThrow();
    });

    test('apiErrorSchema accepts valid error envelope', () => {
        const result = apiErrorSchema.parse({
            ok: false,
            error: { code: 'NOT_FOUND', message: 'Task not found' },
        });
        expect(result).toEqual({
            ok: false,
            error: { code: 'NOT_FOUND', message: 'Task not found' },
        });
    });

    test('apiErrorSchema accepts error with optional details', () => {
        const result = apiErrorSchema.parse({
            ok: false,
            error: { code: 'VALIDATION_FAILED', message: 'Invalid input', details: { field: 'title' } },
        });
        expect(result.ok).toBe(false);
        expect(result.error.details).toEqual({ field: 'title' });
    });

    test('apiErrorSchema rejects unknown error code', () => {
        expect(() =>
            apiErrorSchema.parse({
                ok: false,
                error: { code: 'UNKNOWN_CODE', message: 'nope' },
            }),
        ).toThrow();
    });

    test('paginationMetaSchema validates correctly', () => {
        const result = paginationMetaSchema.parse({ nextCursor: 'abc', hasMore: true, limit: 20 });
        expect(result).toEqual({ nextCursor: 'abc', hasMore: true, limit: 20 });
    });

    test('paginationMetaSchema allows missing nextCursor', () => {
        const result = paginationMetaSchema.parse({ hasMore: false, limit: 20 });
        expect(result.nextCursor).toBeUndefined();
    });

    test('paginatedResponseSchema wraps array data with meta', () => {
        const schema = paginatedResponseSchema(z.object({ id: z.string() }));
        const result = schema.parse({
            ok: true,
            data: [{ id: 'a' }, { id: 'b' }],
            meta: { hasMore: false, limit: 20 },
        });
        expect(result.data).toHaveLength(2);
        expect(result.meta.hasMore).toBe(false);
    });
});

// ─── Task contract ──────────────────────────────────────────────────────────

describe('task contract routes', () => {
    test('list route', () => {
        expect(routeOf(taskContract.list)).toMatchObject({ method: 'GET', path: '/tasks' });
    });

    test('show route with wbs param', () => {
        expect(routeOf(taskContract.show)).toMatchObject({ method: 'GET', path: '/tasks/{wbs}' });
    });

    test('create route', () => {
        expect(routeOf(taskContract.create)).toMatchObject({ method: 'POST', path: '/tasks' });
    });

    test('transition route', () => {
        expect(routeOf(taskContract.transition)).toMatchObject({ method: 'PATCH', path: '/tasks/{wbs}/status' });
    });

    test('body route', () => {
        expect(routeOf(taskContract.body)).toMatchObject({ method: 'PATCH', path: '/tasks/{wbs}/body' });
    });

    test('body input validates wbs and body', () => {
        const result = taskBodyUpdateInputSchema.parse({ wbs: '0001', body: '# New body' });
        expect(result.wbs).toBe('0001');
        expect(result.body).toBe('# New body');
    });

    test('body input accepts optional actor', () => {
        const result = taskBodyUpdateInputSchema.parse({ wbs: '0001', body: '# Body', actor: 'robin' });
        expect(result.actor).toBe('robin');
    });

    test('body input rejects missing body', () => {
        expect(() => taskBodyUpdateInputSchema.parse({ wbs: '0001' })).toThrow();
    });

    test('body response schema validates output', () => {
        const result = taskBodyUpdateResponseSchema.parse({
            ok: true,
            data: { wbs: '0001', filePath: 'docs/tasks/0001_test.md' },
        });
        expect(result.data.filePath).toBe('docs/tasks/0001_test.md');
    });

    test('list response parses valid data', () => {
        const result = taskListResponseSchema.parse({
            ok: true,
            data: [{ wbs: '0001', name: 'Test task', status: 'todo', filePath: 'docs/tasks/0001_test.md' }],
        });
        expect(result.data[0]?.wbs).toBe('0001');
        expect(result.data[0]?.status).toBe('todo');
    });

    test('show response parses full detail', () => {
        const result = taskShowResponseSchema.parse({
            ok: true,
            data: {
                wbs: '0001',
                name: 'Test task',
                status: 'wip',
                frontmatter: { priority: 'P1' },
                content: '# Task\nContent here',
                filePath: 'docs/tasks/0001_test.md',
            },
        });
        expect(result.data.frontmatter).toEqual({ priority: 'P1' });
    });

    test('create input validates required title', () => {
        expect(() => taskCreateInputSchema.parse({})).toThrow();
        const result = taskCreateInputSchema.parse({ title: 'New task' });
        expect(result.title).toBe('New task');
    });

    test('create input accepts optional fields', () => {
        const result = taskCreateInputSchema.parse({
            title: 'New task',
            featureId: 'F2',
            parentWbs: '0001',
            folder: 'docs/tasks',
        });
        expect(result.featureId).toBe('F2');
        expect(result.parentWbs).toBe('0001');
    });

    test('create response schema validates output', () => {
        const result = taskCreateResponseSchema.parse({
            ok: true,
            data: { wbs: '0001', filePath: 'docs/tasks/0001_test.md' },
        });
        expect(result.data.wbs).toBe('0001');
    });

    test('transition input validates wbs and toStatus', () => {
        const result = taskTransitionInputSchema.parse({ wbs: '0001', toStatus: 'done' });
        expect(result.toStatus).toBe('done');
    });

    test('transition input rejects invalid status', () => {
        expect(() => taskTransitionInputSchema.parse({ wbs: '0001', toStatus: 'invalid' })).toThrow();
    });

    test('transition response schema validates output', () => {
        const result = taskTransitionResponseSchema.parse({
            ok: true,
            data: { wbs: '0001', status: 'done' },
        });
        expect(result.data.status).toBe('done');
    });

    test('wbs rejects non-4-digit values', () => {
        expect(() => taskTransitionInputSchema.parse({ wbs: '001', toStatus: 'done' })).toThrow();
        expect(() => taskTransitionInputSchema.parse({ wbs: '00001', toStatus: 'done' })).toThrow();
    });
});

// ─── Feature contract ───────────────────────────────────────────────────────

describe('feature contract routes', () => {
    test('list route', () => {
        expect(routeOf(featureContract.list)).toMatchObject({ method: 'GET', path: '/features' });
    });

    test('show route with id param', () => {
        expect(routeOf(featureContract.show)).toMatchObject({ method: 'GET', path: '/features/{id}' });
    });

    test('create route', () => {
        expect(routeOf(featureContract.create)).toMatchObject({ method: 'POST', path: '/features' });
    });

    test('transition route', () => {
        expect(routeOf(featureContract.transition)).toMatchObject({ method: 'PATCH', path: '/features/{id}/status' });
    });

    test('refresh route', () => {
        expect(routeOf(featureContract.refresh)).toMatchObject({ method: 'POST', path: '/features/refresh' });
    });

    test('list response parses valid data', () => {
        const result = featureListResponseSchema.parse({
            ok: true,
            data: [{ id: 'F2', name: 'Task management', status: 'active', wbsCount: 5 }],
        });
        expect(result.data[0]?.id).toBe('F2');
    });

    test('show response parses full detail', () => {
        const result = featureShowResponseSchema.parse({
            ok: true,
            data: {
                id: 'A',
                name: 'Feature A',
                status: 'active',
                frontmatter: { priority: 'P0' },
                content: '# Feature\nDescription',
                filePath: 'docs/features/A_feature.md',
            },
        });
        expect(result.data.id).toBe('A');
    });

    test('create input validates name', () => {
        expect(() => featureCreateInputSchema.parse({ name: '' })).toThrow();
        const result = featureCreateInputSchema.parse({ name: 'New feature' });
        expect(result.name).toBe('New feature');
    });

    test('create response schema validates output', () => {
        const result = featureCreateResponseSchema.parse({
            ok: true,
            data: { id: 'F2', filePath: 'docs/features/F2_test.md' },
        });
        expect(result.data.id).toBe('F2');
    });

    test('transition input validates id and toStatus', () => {
        const result = featureTransitionInputSchema.parse({ id: 'A', toStatus: 'done' });
        expect(result.toStatus).toBe('done');
        expect(result.id).toBe('A');
    });

    test('transition response schema validates output', () => {
        const result = featureTransitionResponseSchema.parse({
            ok: true,
            data: { id: 'A', status: 'done' },
        });
        expect(result.data.status).toBe('done');
    });
});

// ─── Planning event contract ────────────────────────────────────────────────

describe('planning event contract', () => {
    test('envelope schema accepts valid event frame', () => {
        const result = planningEventEnvelopeSchema.parse({
            ok: true,
            data: {
                eventName: 'task.created',
                occurredAt: '2026-06-15T12:00:00.000Z',
                actor: 'robin',
                payload: { wbs: '0001', title: 'Test task' },
            },
        });
        expect(result.data.eventName).toBe('task.created');
    });

    test('envelope schema accepts null actor', () => {
        const result = planningEventEnvelopeSchema.parse({
            ok: true,
            data: {
                eventName: 'task.created',
                occurredAt: '2026-06-15T12:00:00.000Z',
                actor: null,
                payload: {},
            },
        });
        expect(result.data.actor).toBeNull();
    });

    test('envelope schema accepts missing actor', () => {
        const result = planningEventEnvelopeSchema.parse({
            ok: true,
            data: {
                eventName: 'task.created',
                occurredAt: '2026-06-15T12:00:00.000Z',
                payload: {},
            },
        });
        expect(result.data.actor).toBeUndefined();
    });

    test('stream route is defined', () => {
        expect(routeOf(planningEventContract.stream)).toMatchObject({
            method: 'GET',
            path: '/events/planning',
        });
    });

    test('included in composed contract', () => {
        expect(contract.stream).toBeDefined();
    });

    test('contract builds without an SSE handler (invariant #10)', () => {
        expect(planningEventContract).toBeDefined();
        expect(planningEventContract.stream).toBeDefined();
    });
});

// ─── Contract composition ───────────────────────────────────────────────────

describe('contract composition', () => {
    test('health route is preserved', () => {
        const route = routeOf(contract.health);
        expect(route).toMatchObject({ method: 'GET', path: '/health' });
    });

    test('task namespace has all task routes', () => {
        const keys = Object.keys(contract.task).filter((k) => !k.startsWith('~'));
        expect(keys).toContain('list');
        expect(keys).toContain('show');
        expect(keys).toContain('create');
        expect(keys).toContain('transition');
    });

    test('feature namespace has all feature routes', () => {
        const keys = Object.keys(contract.feature).filter((k) => !k.startsWith('~'));
        expect(keys).toContain('list');
        expect(keys).toContain('show');
        expect(keys).toContain('create');
        expect(keys).toContain('transition');
        expect(keys).toContain('refresh');
    });
});

// ─── Domain-type purity (R8) ────────────────────────────────────────────────

describe('domain-type purity', () => {
    test('TASK_STATUSES enum values are valid in task list schema', () => {
        const statuses = ['backlog', 'todo', 'wip', 'testing', 'blocked', 'done', 'cancelled'] as const;
        for (const status of statuses) {
            const result = taskListResponseSchema.parse({
                ok: true,
                data: [{ wbs: '0001', name: 'Test', status, filePath: 'docs/tasks/0001.md' }],
            });
            expect(result.data[0]?.status).toBe(status);
        }
    });

    test('PRIORITIES enum values are valid in task list schema', () => {
        const priorities = ['P0', 'P1', 'P2', 'P3'] as const;
        for (const priority of priorities) {
            const result = taskListResponseSchema.parse({
                ok: true,
                data: [{ wbs: '0001', name: 'Test', status: 'todo', priority, filePath: 'docs/tasks/0001.md' }],
            });
            expect(result.data[0]?.priority).toBe(priority);
        }
    });

    test('FEATURE_STATUSES enum values are valid in feature list schema', () => {
        const statuses = ['backlog', 'active', 'verifying', 'blocked', 'done', 'cancelled'] as const;
        for (const status of statuses) {
            const result = featureListResponseSchema.parse({
                ok: true,
                data: [{ id: 'A', name: 'Feature', status, wbsCount: 0 }],
            });
            expect(result.data[0]?.status).toBe(status);
        }
    });

    test('feature id respects FEATURE_ID_PATTERN from spur-domain', () => {
        // Valid: letter only
        expect(() =>
            featureListResponseSchema.parse({
                ok: true,
                data: [{ id: 'A', name: 'Feature', status: 'active', wbsCount: 0 }],
            }),
        ).not.toThrow();
        // Valid: letter + digits
        expect(() =>
            featureListResponseSchema.parse({
                ok: true,
                data: [{ id: 'F2', name: 'Feature', status: 'active', wbsCount: 0 }],
            }),
        ).not.toThrow();
        // Invalid: starts with digit
        expect(() =>
            featureListResponseSchema.parse({
                ok: true,
                data: [{ id: '1A', name: 'Feature', status: 'active', wbsCount: 0 }],
            }),
        ).toThrow();
        // Invalid: lowercase
        expect(() =>
            featureListResponseSchema.parse({
                ok: true,
                data: [{ id: 'a', name: 'Feature', status: 'active', wbsCount: 0 }],
            }),
        ).toThrow();
    });
});
