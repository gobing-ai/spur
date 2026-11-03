import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ORPCError } from '@orpc/server';
import type { ServerContext } from '../../../src/context';
import { createSearchHandlers } from '../../../src/modules/search';

/** Read a procedure's raw handler for direct invocation (pattern: history handlers.test). */
function rawHandler(key: string, handlers: ReturnType<typeof createSearchHandlers>) {
    return (
        handlers[key as keyof typeof handlers] as unknown as {
            '~orpc': { handler: (arg: unknown) => Promise<unknown> };
        }
    )['~orpc'].handler;
}

describe('search handlers', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'spur-search-handlers-'));
    mkdirSync(join(cwd, 'docs'));
    writeFileSync(
        join(cwd, 'docs', 'overview.md'),
        '# Overview\n\nThe Spur Board renders hybrid search results with exact and fuzzy routes.\n',
    );

    afterAll(() => {
        rmSync(cwd, { recursive: true, force: true });
    });

    function makeCtx(): ServerContext {
        return { cwd } as unknown as ServerContext;
    }

    test('query handler returns ok:true with grouped hits bound to ctx.cwd', async () => {
        const handler = rawHandler('query', createSearchHandlers(makeCtx()));
        const result = (await handler({ input: { query: 'hybrid search', mode: 'exact' } })) as {
            ok: boolean;
            data: { query: string; mode: string; groups: { exact: Array<{ path: string }> | null; fuzzy: unknown } };
        };

        expect(result.ok).toBe(true);
        expect(result.data.query).toBe('hybrid search');
        expect(result.data.mode).toBe('exact');
        expect(result.data.groups.exact?.[0]?.path).toContain('docs/overview.md');
    });

    test('query handler rejects client-supplied root (root never overridable)', async () => {
        const handler = rawHandler('query', createSearchHandlers(makeCtx()));
        try {
            await handler({
                input: { query: 'x', root: '/etc', mode: 'exact' } as unknown as Record<string, unknown>,
            });
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(ORPCError);
            expect((error as { code: string }).code).toBe('BAD_REQUEST');
        }
    });

    test('status handler returns ok:true with rg/zg availability', async () => {
        const handler = rawHandler('status', createSearchHandlers(makeCtx()));
        const result = (await handler({ input: undefined })) as {
            ok: boolean;
            data: { rg: { available: boolean }; zg: { available: boolean; index: string } };
        };

        expect(result.ok).toBe(true);
        expect(typeof result.data.rg.available).toBe('boolean');
        expect(['ready', 'stale', 'missing', 'unknown']).toContain(result.data.zg.index);
    });
});
