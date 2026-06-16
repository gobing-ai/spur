import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { ApplicationRuntime, ApplicationStopReason } from '@gobing-ai/ts-infra/application';

describe('startServer', () => {
    let origServe: typeof Bun.serve;

    afterEach(() => {
        mock.restore();
        if (origServe) {
            Bun.serve = origServe;
        }
    });

    test('exports as a function', async () => {
        const { startServer } = await import('../src/serve');
        expect(typeof startServer).toBe('function');
    });

    test('StartServerOptions shape validates at type level', () => {
        const opts = {
            port: 3000,
            host: 'localhost',
            openBrowser: false,
        } as const;
        expect(opts.port).toBe(3000);
        expect(opts.host).toBe('localhost');
        expect(opts.openBrowser).toBe(false);
    });

    test('start callback wires Bun.serve with correct port/host and serves health', async () => {
        origServe = Bun.serve;

        let capturedFetch: ((req: Request) => Response | Promise<Response>) | undefined;

        Bun.serve = ((opts: {
            fetch: (req: Request) => Response | Promise<Response>;
            port?: number;
            hostname?: string;
        }) => {
            capturedFetch = opts.fetch;
            expect(opts.port).toBe(4321);
            expect(opts.hostname).toBe('127.0.0.1');
            return { stop: () => {}, ref: () => {}, unref: () => {} };
        }) as typeof Bun.serve;

        mock.module('@gobing-ai/ts-infra/application-node', () => ({
            runNodeApplication: async (opts: {
                config: unknown;
                start: (rt: ApplicationRuntime) => Promise<void>;
            }) => {
                const mockRt = {
                    config: {},
                    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
                    events: { emit: () => {}, on: () => {}, off: () => {} },
                    db: undefined,
                    stop: async (_reason: ApplicationStopReason) => {},
                } as unknown as ApplicationRuntime;
                await opts.start(mockRt);
            },
        }));

        const { startServer } = await import('../src/serve');

        await startServer({ port: 4321, host: '127.0.0.1', openBrowser: false });

        expect(capturedFetch).toBeDefined();
        if (!capturedFetch) throw new Error('capturedFetch not set');

        const res = await capturedFetch(new Request('http://127.0.0.1:4321/api/health'));
        expect(res.status).toBe(200);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.status).toBe('ok');
    });
});
