import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { PlanningWriteService, type WriteResult } from '../../src/services/planning-write-service';
import type { TaskFeatureLink } from '../../src/services/task-feature-link';
import { TaskFiles } from '../../src/services/task-files';
import { TaskLocator } from '../../src/services/task-locator';
import type { TaskServiceContext } from '../../src/services/task-service';
import { DependencyMutationError, SectionMutationError } from '../../src/services/task-service-errors';
import { TaskUpdateOps } from '../../src/services/task-update-ops';

// TaskUpdateOps holds the `spur task update` verbs. The service-level suite (task-service.test.ts)
// covers the verbs end to end; these tests pin the collaborator seams: the parent-feature guard
// it calls, the done hook, and the validation order of dependency/tag/section mutations.

let root: string;
let tasksDir: string;
let ctx: TaskServiceContext;
let files: TaskFiles;
let writeService: PlanningWriteService;

function writeTask(wbs: string, frontmatter: string, body = ''): string {
    const filePath = join(tasksDir, `${wbs}_task-${wbs}.md`);
    writeFileSync(
        filePath,
        `---\nschema_version: 1\nname: task ${wbs}\ncreated_at: 2026-10-01T00:00:00.000Z\nupdated_at: 2026-10-01T00:00:00.000Z\n${frontmatter}\n---\n\n## ${wbs}. task\n${body}`,
    );
    return filePath;
}

function noGuard(): TaskFeatureLink {
    return { guardParentFeature: mock(async () => undefined), resolveFeatureAcBody: mock(async () => null) } as never;
}

function ops(featureLink: TaskFeatureLink = noGuard(), context = ctx, ws = writeService): TaskUpdateOps {
    return new TaskUpdateOps(context, ws, files, featureLink);
}

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'spur-task-update-ops-'));
    tasksDir = join(root, 'docs', 'tasks');
    mkdirSync(tasksDir, { recursive: true });
    const fs = createNodeFileSystem(root);
    writeService = new PlanningWriteService({ fs });
    ctx = { fs, tasksDir, writeService };
    files = new TaskFiles(ctx, new TaskLocator(ctx));
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

describe('TaskUpdateOps.updateField', () => {
    test('a feature_id write runs the parent guard first and reports the reopen', async () => {
        const filePath = writeTask('0001', 'status: todo');
        const guardParentFeature = mock(async () => ({ id: 'F1', from: 'verifying', to: 'active' }));
        const link = { guardParentFeature, resolveFeatureAcBody: mock(async () => null) } as never;
        const result = await ops(link).updateField('0001', 'feature_id', 'F1', true);
        expect(guardParentFeature).toHaveBeenCalledWith('F1', true);
        expect(result.featureReopened).toEqual({ id: 'F1', from: 'verifying', to: 'active' });
        expect(readFileSync(filePath, 'utf8')).toContain('feature_id: F1');
    });

    test('a non-feature field never consults the guard; estimate_hours is written as a number', async () => {
        const filePath = writeTask('0002', 'status: todo');
        const link = noGuard();
        await ops(link).updateField('0002', 'estimate_hours', '4');
        expect(link.guardParentFeature).not.toHaveBeenCalled();
        expect(readFileSync(filePath, 'utf8')).toMatch(/estimate_hours: 4\b/);
    });

    test('rejects an unsettable key and a non-positive estimate before any write', async () => {
        writeTask('0003', 'status: todo');
        await expect(ops().updateField('0003', 'status', 'done')).rejects.toThrow('not settable');
        await expect(ops().updateField('0003', 'estimate_hours', '0')).rejects.toThrow('positive number');
    });
});

describe('TaskUpdateOps.updateStatus', () => {
    test('a done transition fires onTaskReachedDone, and a failing hook does not fail the write', async () => {
        writeTask('0004', 'status: wip');
        const transition = mock(
            async (_ref: unknown, _to: string, _actor: string) => ({ toStatus: 'done' }) as WriteResult,
        );
        const stubWrites = { transition } as unknown as PlanningWriteService;
        const onTaskReachedDone = mock(async () => {
            throw new Error('queue down');
        });
        const result = await ops(noGuard(), { ...ctx, onTaskReachedDone, actor: 'robin' }, stubWrites).updateStatus(
            '0004',
            'done',
        );
        expect(result.toStatus).toBe('done');
        expect(onTaskReachedDone).toHaveBeenCalledWith('0004');
        expect(transition.mock.calls[0]?.[2]).toBe('robin');
    });
});

describe('TaskUpdateOps tag and dependency mutations', () => {
    test('updateTags removes then appends without duplicates, and refuses blank tags', async () => {
        writeTask('0005', 'status: todo\ntags:\n  - a\n  - b');
        expect((await ops().updateTags('0005', ['c', 'a'], ['b'])).tags).toEqual(['a', 'c']);
        await expect(ops().updateTags('0005', [' '], [])).rejects.toThrow('non-empty');
    });

    test('mutateDependencies validates usage, format, existence, self-edge and cycles', async () => {
        writeTask('0010', 'status: todo');
        writeTask('0011', 'status: todo\ndependencies:\n  - "0010"');
        const reason = (p: Promise<unknown>) =>
            p.then(
                () => 'ok',
                (e: unknown) => (e instanceof DependencyMutationError ? e.code : String(e)),
            );
        const u = ops();
        expect(await reason(u.mutateDependencies('0010', 'clear', ['0011']))).toBe('usage');
        expect(await reason(u.mutateDependencies('0010', 'add'))).toBe('usage');
        expect(await reason(u.mutateDependencies('0010', 'add', ['12']))).toBe('format');
        expect(await reason(u.mutateDependencies('0010', 'add', ['0999']))).toBe('not-found');
        expect(await reason(u.mutateDependencies('0010', 'add', ['0010']))).toBe('self-edge');
        expect(await reason(u.mutateDependencies('0010', 'add', ['0011']))).toBe('cycle');
        expect((await u.mutateDependencies('0011', 'remove', ['0010'])).dependencies).toEqual([]);
    });

    test('mutateSections rejects a misplaced section-name argument', async () => {
        writeTask('0012', 'status: todo');
        await expect(ops().mutateSections('0012', 'add')).rejects.toBeInstanceOf(SectionMutationError);
        await expect(ops().mutateSections('0012', 'list', 'Design')).rejects.toBeInstanceOf(SectionMutationError);
    });
});
