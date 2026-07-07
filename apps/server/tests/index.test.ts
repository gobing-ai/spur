import { describe, expect, test } from 'bun:test';
import { buildConfigFromEnv } from '@gobing-ai/spur-config';
import { type MainDeps, main } from '../src/index';
import type { StartServerOptions } from '../src/serve';

function makeDeps() {
    let captured: StartServerOptions | null = null;
    const deps: MainDeps = {
        buildConfigFromEnv,
        startServer: async (options: StartServerOptions) => {
            captured = options;
        },
    };
    return { deps, captured: () => captured };
}

describe('index main entry', () => {
    test('main() passes config to startServer with openBrowser=false', async () => {
        const { deps, captured } = makeDeps();

        await main(
            {
                PORT: '3456',
                HOST: '0.0.0.0',
                DATABASE_URL: ':memory:',
                SPUR_LOG_LEVEL: 'error',
                NODE_ENV: 'test',
            },
            deps,
        );

        expect(captured()).not.toBeNull();
        expect(captured()?.port).toBe(3456);
        expect(captured()?.host).toBe('0.0.0.0');
        expect(captured()?.openBrowser).toBe(false);
        expect(captured()?.dbUrl).toBe(':memory:');
        expect(captured()?.webDistPath).toBeNull();
    });

    test('main() uses schema defaults when env is empty', async () => {
        const { deps, captured } = makeDeps();

        await main({}, deps);

        expect(captured()).not.toBeNull();
        expect(captured()?.port).toBe(3000);
        expect(captured()?.host).toBe('localhost');
        expect(captured()?.openBrowser).toBe(false);
        expect(captured()?.webDistPath).toBeNull();
    });

    test('main() uses defaults when called with no env arg', async () => {
        const { deps, captured } = makeDeps();

        await main(undefined, deps);

        expect(captured()).not.toBeNull();
        expect(captured()?.port).toBe(3000);
    });
});
