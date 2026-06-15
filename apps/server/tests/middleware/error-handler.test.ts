import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { globalErrorHandler } from '../../src/middleware/error-handler';
import { requestId } from '../../src/middleware/request-id';

describe('globalErrorHandler (onError)', () => {
    test('returns structured error envelope with requestId', async () => {
        const app = new Hono();
        let reqId = '';

        app.use('*', requestId());
        app.use('*', async (c, next) => {
            await next();
            reqId = c.get('requestId');
        });
        app.onError(globalErrorHandler);
        app.get('/fail', () => {
            throw new Error('test error');
        });

        const prevEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';
        try {
            const res = await app.request('/fail');
            expect(res.status).toBe(500);
            const body = (await res.json()) as Record<string, unknown>;
            expect(body.code).toBe(500);
            expect(body.message).toBe('test error');
            expect(body.result).toBe('error');
            expect(body.data).toBeNull();
            expect(body.details).toBeDefined();
            expect((body.details as Record<string, unknown>)?.requestId).toBe(reqId);
        } finally {
            process.env.NODE_ENV = prevEnv;
        }
    });

    test('suppresses stack in production', async () => {
        const app = new Hono();
        app.use('*', requestId());
        app.onError(globalErrorHandler);
        app.get('/fail', () => {
            throw new Error('secret');
        });

        const prevEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            const res = await app.request('/fail');
            expect(res.status).toBe(500);
            const body = (await res.json()) as Record<string, unknown>;
            expect(body.message).toBe('Internal server error');
            expect(body.details).toBeUndefined();
        } finally {
            process.env.NODE_ENV = prevEnv;
        }
    });
});
