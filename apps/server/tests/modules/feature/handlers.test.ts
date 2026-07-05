import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import type { ServerContext } from '../../../src/context';
import { createFeatureHandlers } from '../../../src/modules/feature';

describe('feature handlers', () => {
    function makeCtx(overrides?: Record<string, unknown>, fsRoot?: string) {
        const fs = createNodeFileSystem(fsRoot ?? tmpdir());
        return {
            fs,
            planningFolders: () => ({
                featuresDir: fsRoot ?? '/tmp',
                tasksDir: '/tmp',
                foldersConfig: { active_folder: '/tmp', folders: {} },
            }),
            featureService: () => ({
                list: async () => [{ id: 'F2', name: 'Test', status: 'active' }],
                show: async (id: string) => ({
                    id,
                    name: 'Test',
                    status: 'active',
                    filePath: fsRoot ? join(fsRoot, `${id}.md`) : `/test/${id}.md`,
                    frontmatter: {},
                    content: '# Test',
                }),
                create: async () => ({
                    ref: { id: 'A', filePath: '/test/A.md', kind: 'feature' as const, folder: '.' },
                }),
                transition: async () => ({
                    ref: { id: 'A', filePath: '/test/A.md', kind: 'feature' as const, folder: '.' },
                }),
                refresh: async () => ({ index: '', tasksUpdated: 3 }),
                ...overrides,
            }),
        } as unknown as ServerContext;
    }

    test('returns expected route keys', () => {
        const handlers = createFeatureHandlers(makeCtx());
        expect(Object.keys(handlers).sort()).toEqual(['check', 'create', 'list', 'refresh', 'show', 'transition']);
    });

    test('list handler returns ok:true with data', async () => {
        const handlers = createFeatureHandlers(makeCtx());
        const fn = handlers.list['~orpc'].handler as unknown as (
            opts: Record<string, unknown>,
        ) => Promise<{ ok: boolean; data: unknown[] }>;
        const result = await fn({});
        expect(result.ok).toBe(true);
        expect(Array.isArray(result.data)).toBe(true);
        // The handler maps FeatureService.list() to the contract DTO, narrowing
        // status to the FEATURE_STATUSES enum. wbsCount is intentionally absent —
        // no corpus source produces it yet (contract field is optional).
        const first = (result.data as Array<Record<string, unknown>>)[0];
        expect(first?.id).toBe('F2');
        expect(first?.status).toBe('active');
        expect(first?.wbsCount).toBeUndefined();
    });

    test('show handler returns feature detail', async () => {
        const handlers = createFeatureHandlers(makeCtx());
        const fn = handlers.show['~orpc'].handler as unknown as (opts: {
            input: { id: string };
        }) => Promise<{ ok: boolean; data: { id: string; name: string } }>;
        const result = await fn({ input: { id: 'A' } });
        expect(result.ok).toBe(true);
        expect(result.data.id).toBe('A');
        expect(result.data.name).toBe('Test');
    });

    test('show handler throws NotFoundError when service returns null', async () => {
        const handlers = createFeatureHandlers(makeCtx({ show: async () => null }));
        const fn = handlers.show['~orpc'].handler as unknown as (opts: { input: { id: string } }) => Promise<unknown>;
        await expect(fn({ input: { id: 'Z' } })).rejects.toThrow('Feature Z not found');
    });

    test('create handler returns id and filePath', async () => {
        const handlers = createFeatureHandlers(makeCtx());
        const fn = handlers.create['~orpc'].handler as unknown as (opts: {
            input: { name: string; parentId?: string };
        }) => Promise<{ ok: boolean; data: { id: string; filePath: string } }>;
        const result = await fn({ input: { name: 'New', parentId: 'A' } });
        expect(result.ok).toBe(true);
        expect(result.data.id).toBe('A');
    });

    test('transition handler returns id and status', async () => {
        const handlers = createFeatureHandlers(makeCtx());
        const fn = handlers.transition['~orpc'].handler as unknown as (opts: {
            input: { id: string; toStatus: string };
        }) => Promise<{ ok: boolean; data: { id: string; status: string } }>;
        const result = await fn({ input: { id: 'A', toStatus: 'done' } });
        expect(result.ok).toBe(true);
        expect(result.data.status).toBe('done');
    });

    test('refresh handler returns rebuilt count', async () => {
        const handlers = createFeatureHandlers(makeCtx());
        const fn = handlers.refresh['~orpc'].handler as unknown as (
            opts: Record<string, unknown>,
        ) => Promise<{ ok: boolean; data: { rebuilt: number } }>;
        const result = await fn({});
        expect(result.ok).toBe(true);
        expect(result.data.rebuilt).toBe(3);
    });

    test('check handler runs FeatureCheckService and returns findings', async () => {
        const root = mkdtempSync(join(tmpdir(), 'spur-feat-check-'));
        try {
            // Write a minimal valid feature file so the check runs for real.
            const featureDir = join(root, 'features');
            const taskDir = join(root, 'tasks');
            await mkdir(featureDir, { recursive: true });
            await mkdir(taskDir, { recursive: true });
            const content = [
                '---',
                'name: Test Feature',
                'status: backlog',
                '---',
                '',
                '## Goal',
                '',
                'Test goal.',
                '',
                '## Scope',
                '',
                'Test scope.',
                '',
                '## Acceptance Criteria',
                '',
                '```gherkin',
                'Feature: X',
                '  Scenario: Y',
                '    Given Z',
                '    When W',
                '    Then V',
                '```',
                '',
                '## Tasks',
                '',
                'No tasks yet.',
                '',
            ].join('\n');
            await writeFile(join(featureDir, 'X.md'), content);

            const ctx = makeCtx({}, root) as unknown as ServerContext & {
                planningFolders: () => { featuresDir: string; tasksDir: string };
            };
            // Override planningFolders to point at our temp dirs.
            (ctx as unknown as Record<string, unknown>).planningFolders = () => ({
                featuresDir: featureDir,
                tasksDir: taskDir,
                foldersConfig: { active_folder: featureDir, folders: {} },
            });
            // Override featureService.show to return the temp file path.
            (ctx as unknown as Record<string, unknown>).featureService = () => ({
                show: async () => ({
                    id: 'X',
                    filePath: join(featureDir, 'X.md'),
                    name: 'Test Feature',
                    status: 'backlog',
                    frontmatter: {},
                    content,
                }),
            });

            const handlers = createFeatureHandlers(ctx);
            const fn = handlers.check['~orpc'].handler as unknown as (opts: { input: { id: string } }) => Promise<{
                ok: boolean;
                data: {
                    id: string;
                    pass: boolean;
                    findings: unknown[];
                    requiredSections: unknown[];
                    missingSections: unknown[];
                };
            }>;
            const result = await fn({ input: { id: 'X' } });

            expect(result.ok).toBe(true);
            expect(result.data.id).toBe('X');
            expect(typeof result.data.pass).toBe('boolean');
            expect(Array.isArray(result.data.findings)).toBe(true);
            expect(Array.isArray(result.data.requiredSections)).toBe(true);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
