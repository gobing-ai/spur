import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MarkdownDocument } from '@gobing-ai/spur-domain';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { PlanningWriteService } from '../../src/services/planning-write-service';
import { TaskService } from '../../src/services/task-service';

let tasksDir: string;
let svc: TaskService;

beforeAll(async () => {
    const root = mkdtempSync(join(tmpdir(), 'spur-task-svc-'));
    tasksDir = join(root, 'tasks');
    const fs = createNodeFileSystem(root);
    await fs.ensureDir(tasksDir);
    const writeService = new PlanningWriteService({ fs });
    svc = new TaskService({ fs, tasksDir, writeService });
});

afterAll(() => {
    rmSync(tasksDir.replace('/tasks', ''), { recursive: true, force: true });
});

describe('TaskService', () => {
    describe('create', () => {
        test('allocates a 4-digit WBS and creates a file', async () => {
            const result = await svc.create({ title: 'Test task' });

            expect(result.ref.kind).toBe('task');
            expect(result.ref.id).toMatch(/^\d{4}$/);
            const fs = createNodeFileSystem(tasksDir.replace('/tasks', ''));
            expect(await fs.exists(result.ref.filePath)).toBe(true);
        });

        test('creates with feature_id in frontmatter', async () => {
            const result = await svc.create({ title: 'Feature task', featureId: 'A' });

            const fs = createNodeFileSystem(tasksDir.replace('/tasks', ''));
            const raw = await fs.readFile(result.ref.filePath);
            const doc = MarkdownDocument.parse(raw, 'task');
            expect(doc.frontmatterData?.feature_id).toBe('A');
        });

        test('creates with parent_wbs in frontmatter', async () => {
            const result = await svc.create({ title: 'Sub-task', parentWbs: '0042' });

            const fs = createNodeFileSystem(tasksDir.replace('/tasks', ''));
            const raw = await fs.readFile(result.ref.filePath);
            const doc = MarkdownDocument.parse(raw, 'task');
            expect(doc.frontmatterData?.parent_wbs).toBe('0042');
        });

        test('defaults status to backlog', async () => {
            const result = await svc.create({ title: 'Def status' });

            const fs = createNodeFileSystem(tasksDir.replace('/tasks', ''));
            const raw = await fs.readFile(result.ref.filePath);
            const doc = MarkdownDocument.parse(raw, 'task');
            expect(doc.frontmatterData?.status).toBe('backlog');
        });
    });

    describe('show', () => {
        test('returns parsed frontmatter and content', async () => {
            const created = await svc.create({ title: 'Show task' });
            const result = await svc.show(created.ref.id);

            expect(result.wbs).toBe(created.ref.id);
            expect(result.name).toBe('Show task');
            expect(result.status).toBe('backlog');
            expect(result.content).toContain('Show task');
        });

        test('throws for non-existent WBS', async () => {
            await expect(svc.show('9999')).rejects.toThrow('not found');
        });
    });

    describe('list', () => {
        test('lists all tasks in the folder', async () => {
            await svc.create({ title: 'List test 1' });
            await svc.create({ title: 'List test 2' });

            const tasks = await svc.list();

            const listNames = tasks.map((t) => t.name);
            expect(listNames).toContain('List test 1');
            expect(listNames).toContain('List test 2');
        });

        test('filters by status', async () => {
            await svc.create({ title: 'Backlog only' });

            const backlog = await svc.list({ status: 'backlog' });
            const done = await svc.list({ status: 'done' });

            expect(backlog.some((t) => t.name === 'Backlog only')).toBe(true);
            expect(done.some((t) => t.name === 'Backlog only')).toBe(false);
        });

        test('filters by parent WBS', async () => {
            await svc.create({ title: 'Parented', parentWbs: '0042' });
            await svc.create({ title: 'Unparented' });

            const parented = await svc.list({ parentWbs: '0042' });
            expect(parented.some((t) => t.name === 'Parented')).toBe(true);
            expect(parented.some((t) => t.name === 'Unparented')).toBe(false);
        });

        test('filters by phase (legacy alias for status)', async () => {
            await svc.create({ title: 'Phase test', status: 'wip' });

            const wip = await svc.list({ phase: 'wip' });
            expect(wip.some((t) => t.name === 'Phase test')).toBe(true);
        });
    });

    describe('resolve', () => {
        test('finds a task by exact file path', async () => {
            const created = await svc.create({ title: 'Resolve me' });
            const result = await svc.resolve(created.ref.filePath);

            expect(result).not.toBeNull();
            expect(result?.wbs).toBe(created.ref.id);
        });

        test('returns null for unknown path', async () => {
            const result = await svc.resolve('/nonexistent/task.md');
            expect(result).toBeNull();
        });
    });
});
