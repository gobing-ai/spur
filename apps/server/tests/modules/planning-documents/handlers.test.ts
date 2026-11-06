import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlanningDocumentError, PlanningDocumentService } from '@gobing-ai/spur-app';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import type { ServerContext } from '../../../src/context';
import { createPlanningDocumentHandlers } from '../../../src/modules/planning-documents';

/**
 * Task 1300 — the oRPC procedures over the shared document owner. The status mapping is the
 * contract the Board's error path reads, so each refusal code is asserted once here.
 */

function makeCtx(root: string): ServerContext {
    const fs = createNodeFileSystem(root);
    return {
        fs,
        cwd: root,
        planningDocumentService: () => new PlanningDocumentService({ fs, cwd: root }),
    } as unknown as ServerContext;
}

function call(handler: unknown, input?: unknown): Promise<unknown> {
    return (handler as (opts: { input: unknown }) => Promise<unknown>)({ input });
}

describe('planning-documents oRPC procedures', () => {
    test('list and show return the shared payloads', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-planning-documents-handlers-'));
        try {
            mkdirSync(join(root, 'docs', 'plans'), { recursive: true });
            writeFileSync(join(root, 'docs', '02_ROADMAP.md'), '# 02 Roadmap — Spur\n');
            writeFileSync(join(root, 'docs', 'plans', '2026-09-21-plan.md'), '# A Plan\n');
            const handlers = createPlanningDocumentHandlers(makeCtx(root));

            const listed = (await call(handlers.planList['~orpc'].handler)) as { files: unknown[]; total: number };
            expect(listed.total).toBe(2);

            const designs = (await call(handlers.designList['~orpc'].handler)) as { files: unknown[]; total: number };
            expect(designs.total).toBe(0);

            const shown = (await call(handlers.planShow['~orpc'].handler, {
                path: 'docs/plans/2026-09-21-plan.md',
            })) as {
                ok: boolean;
                title: string;
            };
            expect(shown.ok).toBe(true);
            expect(shown.title).toBe('A Plan');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    test('every refusal code maps to its documented status', async () => {
        const cases: Array<[ConstructorParameters<typeof PlanningDocumentError>[0], number]> = [
            ['unavailable', 503],
            ['missing-path', 400],
            ['denied', 403],
            ['not-found', 404],
            ['read-failed', 500],
        ];
        for (const [code, status] of cases) {
            const ctx = {
                planningDocumentService: () => ({
                    listPlans: async () => ({ files: [], total: 0 }),
                    listDesigns: async () => ({ files: [], total: 0 }),
                    showPlan: async () => {
                        throw new PlanningDocumentError(code, `refused: ${code}`);
                    },
                    showDesign: async () => {
                        throw new PlanningDocumentError(code, `refused: ${code}`);
                    },
                }),
            } as unknown as ServerContext;
            const handlers = createPlanningDocumentHandlers(ctx);
            await expect(call(handlers.planShow['~orpc'].handler, { path: 'docs/x.md' })).rejects.toMatchObject({
                status,
            });
            await expect(call(handlers.designShow['~orpc'].handler, { path: 'docs/x.md' })).rejects.toMatchObject({
                status,
            });
        }
    });

    test('a non-domain failure is rethrown unchanged', async () => {
        const ctx = {
            planningDocumentService: () => ({
                showPlan: async () => {
                    throw new TypeError('unexpected');
                },
            }),
        } as unknown as ServerContext;
        const handlers = createPlanningDocumentHandlers(ctx);
        await expect(call(handlers.planShow['~orpc'].handler, { path: 'docs/x.md' })).rejects.toThrow('unexpected');
    });

    test('a denied path becomes a 403 HTTP error, an absent one a 404', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-planning-documents-handlers-err-'));
        try {
            mkdirSync(join(root, 'docs', 'plans'), { recursive: true });
            const handlers = createPlanningDocumentHandlers(makeCtx(root));

            await expect(call(handlers.planShow['~orpc'].handler, { path: '../escape.md' })).rejects.toMatchObject({
                status: 403,
            });
            await expect(
                call(handlers.planShow['~orpc'].handler, { path: 'docs/plans/2099-01-01-absent.md' }),
            ).rejects.toMatchObject({ status: 404 });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
