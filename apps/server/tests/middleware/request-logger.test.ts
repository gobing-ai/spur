import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { globalErrorHandler } from '../../src/middleware/error-handler';
import { requestId } from '../../src/middleware/request-id';
import { requestLogger } from '../../src/middleware/request-logger';
import { mockRuntime } from './helpers';

describe('requestLogger middleware', () => {
    test('logs method, path, status, duration, requestId', async () => {
        const logCalls: { msg: string; data?: Record<string, unknown> }[] = [];
        const appRt = mockRuntime(logCalls);

        const app = new Hono();
        app.use('*', requestId());
        app.use('*', requestLogger(appRt));
        app.get('/test', (c) => c.text('hello'));

        await app.request('/test');
        expect(logCalls.length).toBe(1);
        expect(logCalls[0]?.msg).toBe('GET /test');
        expect(logCalls[0]?.data).toMatchObject({
            method: 'GET',
            path: '/test',
            status: 200,
        });
        expect(typeof logCalls[0]?.data?.duration_ms).toBe('number');
        expect(logCalls[0]?.data?.requestId).toMatch(/^[0-9a-f]{8}-/);
    });

    test('captures error status codes from onError', async () => {
        const logCalls: { msg: string; data?: Record<string, unknown> }[] = [];
        const appRt = mockRuntime(logCalls);

        const app = new Hono();
        app.use('*', requestId());
        app.use('*', requestLogger(appRt));
        app.onError(globalErrorHandler);
        app.get('/fail', () => {
            throw new Error('boom');
        });

        await app.request('/fail');
        expect(logCalls.length).toBe(1);
        expect(logCalls[0]?.data?.status).toBe(500);
    });
});
