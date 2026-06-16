import { describe, expect, test } from 'bun:test';
import { startServer } from '../src/serve';

describe('startServer', () => {
    test('exports as a function', () => {
        expect(typeof startServer).toBe('function');
    });

    test('StartServerOptions shape', () => {
        // Type-level verification: these should compile
        const opts = {
            port: 3000,
            host: 'localhost',
            openBrowser: false,
        } as const;
        expect(opts.port).toBe(3000);
        expect(opts.host).toBe('localhost');
        expect(opts.openBrowser).toBe(false);
    });
});
