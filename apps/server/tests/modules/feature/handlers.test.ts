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
                syncFeature: async (id: string) => ({
                    proposal: { featureId: id, from: 'backlog', to: 'active', reason: 'Active task' },
                    applied: true,
                    appliedHops: ['active'],
                }),
                collectTasksByFeature: async () => new Map([['F3', [{}, {}]]]),
                updateBody: async () => {},
                ...overrides,
            }),
            taskService: () => ({
                create: async () => ({
                    ref: { id: 'T1', filePath: '/test/T1.md' },
                }),
                updateField: async () => {},
            }),
        } as unknown as ServerContext;
    }

    test('returns expected route keys', () => {
        const handlers = createFeatureHandlers(makeCtx());
        expect(Object.keys(handlers).sort()).toEqual([
            'action',
            'body',
            'check',
            'children',
            'create',
            'link',
            'list',
            'refresh',
            'show',
            'sync',
            'tasks',
            'transition',
        ]);
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

    test('show handler throws a 404 HTTP error when service returns null', async () => {
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

    test('body handler updates feature body', async () => {
        let updatedId = '';
        let updatedBody = '';
        const ctx = makeCtx({
            updateBody: async (id: string, body: string) => {
                updatedId = id;
                updatedBody = body;
            },
        });
        const handlers = createFeatureHandlers(ctx);
        const fn = handlers.body['~orpc'].handler as unknown as (opts: {
            input: { id: string; body: string };
        }) => Promise<{ ok: boolean }>;
        const result = await fn({ input: { id: 'F3', body: 'New Body Content' } });
        expect(result.ok).toBe(true);
        expect(updatedId).toBe('F3');
        expect(updatedBody).toBe('New Body Content');
    });

    test('body handler throws a 404 HTTP error when feature not found', async () => {
        const ctx = makeCtx({ show: async () => null });
        const handlers = createFeatureHandlers(ctx);
        const fn = handlers.body['~orpc'].handler as unknown as (opts: {
            input: { id: string; body: string };
        }) => Promise<unknown>;
        await expect(fn({ input: { id: 'F3', body: 'New Body Content' } })).rejects.toThrow('Feature F3 not found');
    });

    test('action handler returns ok true', async () => {
        const handlers = createFeatureHandlers(makeCtx());
        const fn = handlers.action['~orpc'].handler as unknown as (opts: {
            input: { id: string; action: string; channel?: string };
        }) => Promise<{ ok: boolean }>;
        const result = await fn({ input: { id: 'F3', action: 'plan' } });
        expect(result.ok).toBe(true);
    });

    test('children handler creates child feature', async () => {
        let createdName = '';
        let createdParentId = '';
        const ctx = makeCtx({
            create: async (name: string, parentId?: string) => {
                createdName = name;
                createdParentId = parentId ?? '';
                return {
                    ref: { id: 'F3.1', filePath: '/test/F3_1.md', kind: 'feature' as const, folder: '.' },
                };
            },
        });
        const handlers = createFeatureHandlers(ctx);
        const fn = handlers.children['~orpc'].handler as unknown as (opts: {
            input: { id: string; name: string };
        }) => Promise<{ ok: boolean; data: unknown }>;
        const result = await fn({ input: { id: 'F3', name: 'Child Feature' } });
        expect(result.ok).toBe(true);
        expect(createdName).toBe('Child Feature');
        expect(createdParentId).toBe('F3');
    });

    test('tasks handler creates a task for feature', async () => {
        const handlers = createFeatureHandlers(makeCtx());
        const fn = handlers.tasks['~orpc'].handler as unknown as (opts: {
            input: { id: string; title: string };
        }) => Promise<{ ok: boolean; data: { wbs: string; filePath: string } }>;
        const result = await fn({ input: { id: 'F3', title: 'Task Title' } });
        expect(result.ok).toBe(true);
        expect(result.data.wbs).toBe('T1');
        expect(result.data.filePath).toBe('/test/T1.md');
    });

    test('link handler links task to feature', async () => {
        const handlers = createFeatureHandlers(makeCtx());
        const fn = handlers.link['~orpc'].handler as unknown as (opts: {
            input: { id: string; wbs: string };
        }) => Promise<{ ok: boolean }>;
        const result = await fn({ input: { id: 'F3', wbs: 'T1' } });
        expect(result.ok).toBe(true);
    });

    test('sync handler pull direction delegates to syncFeature and returns linked-task count + newStatus', async () => {
        const handlers = createFeatureHandlers(makeCtx());
        const fn = handlers.sync['~orpc'].handler as unknown as (opts: {
            input: { id: string; direction: 'pull' | 'push' };
        }) => Promise<{
            ok: boolean;
            data: { direction: string; affectedTasks: number; applied: boolean; newStatus?: string };
        }>;
        const result = await fn({ input: { id: 'F3', direction: 'pull' } });
        expect(result.ok).toBe(true);
        expect(result.data.direction).toBe('pull');
        expect(result.data.affectedTasks).toBe(2);
        expect(result.data.applied).toBe(true);
        expect(result.data.newStatus).toBe('active');
    });

    test('sync handler push direction throws explicit error', async () => {
        const handlers = createFeatureHandlers(makeCtx());
        const fn = handlers.sync['~orpc'].handler as unknown as (opts: {
            input: { id: string; direction: 'pull' | 'push' };
        }) => Promise<unknown>;
        await expect(fn({ input: { id: 'F3', direction: 'push' } })).rejects.toThrow(
            'Push sync (feature->tasks cascade) is not implemented',
        );
    });
});
