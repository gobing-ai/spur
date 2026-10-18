import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { PlanningWriteService } from '../../src/services/planning-write-service';
import { loadSectionMatrix } from '../../src/services/section-matrix-loader';
import { TaskCreateOps } from '../../src/services/task-create-ops';
import { TaskFeatureLink } from '../../src/services/task-feature-link';
import { TaskFiles } from '../../src/services/task-files';
import { TaskLocator } from '../../src/services/task-locator';
import type { TaskService, TaskServiceContext, TaskSummary } from '../../src/services/task-service';
import { DuplicateFollowUpError } from '../../src/services/task-service-errors';

// TaskCreateOps holds `task create` / `task batch-create`. Its dedupe guard and the batch
// parent wire-up go back through the owning service's public `list` / `refreshRoster` / `show`,
// so a stub host makes those calls (and their arguments) observable.

let root: string;
let tasksDir: string;
let ctx: TaskServiceContext;
let writeService: PlanningWriteService;
let files: TaskFiles;

function ops(host: Partial<TaskService>): TaskCreateOps {
    return new TaskCreateOps(host as TaskService, ctx, writeService, new TaskFeatureLink(ctx, writeService), files);
}

function recent(name: string, extra: Record<string, unknown> = {}): TaskSummary {
    return {
        wbs: '0042',
        name,
        status: 'backlog',
        filePath: join(tasksDir, '0042_x.md'),
        dependencies: [],
        feature_id: null,
        frontmatter: { created_at: new Date().toISOString(), ...extra },
    };
}

beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'spur-task-create-ops-'));
    tasksDir = join(root, 'docs', 'tasks');
    mkdirSync(tasksDir, { recursive: true });
    const fs = createNodeFileSystem(root);
    writeService = new PlanningWriteService({ fs });
    // The bundled canonical matrix — creation resolves it as the sole section authority (F92 R1).
    ctx = { fs, tasksDir, writeService, sectionMatrix: await loadSectionMatrix(root) };
    files = new TaskFiles(ctx, new TaskLocator(ctx));
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

describe('TaskCreateOps.create dedupe guard', () => {
    test('an unscoped create lists the whole corpus and refuses a fresh same-named unlinked task', async () => {
        const list = mock(async () => [recent('Ship It')]);
        const err = await ops({ list })
            .create({ title: 'ship it' })
            .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(DuplicateFollowUpError);
        expect(list).toHaveBeenCalledWith();
    });

    test('a same-named task linked to a feature is outside the unscoped collision scope', async () => {
        const list = mock(async () => [recent('Ship It', { feature_id: 'F1' })]);
        const created = await ops({ list }).create({ title: 'Ship It' });
        expect(existsSync(created.ref.filePath)).toBe(true);
    });

    test('a feature-scoped create asks the host for that feature only', async () => {
        const list = mock(async () => [recent('Follow up', { feature_id: 'F1' })]);
        await expect(ops({ list }).create({ title: 'Follow up', featureId: 'F1' })).rejects.toBeInstanceOf(
            DuplicateFollowUpError,
        );
        expect(list).toHaveBeenCalledWith({ featureId: 'F1' });
    });

    test('dedupeWithinSec: null skips the guard; a stale same-named task does not collide', async () => {
        const list = mock(async () => [recent('Again', { created_at: '2020-01-01T00:00:00.000Z' })]);
        const first = await ops({ list }).create({ title: 'Again', dedupeWithinSec: null });
        expect(list).not.toHaveBeenCalled();
        const second = await ops({ list }).create({ title: 'Again' });
        expect(list).toHaveBeenCalledTimes(1);
        expect(second.ref.id).not.toBe(first.ref.id);
    });
});

describe('TaskCreateOps.batchCreate parent wire-up', () => {
    test('each distinct parent is rostered and shown through the host; failures are recorded per parent', async () => {
        const batchFile = join(root, 'batch.json');
        writeFileSync(
            batchFile,
            JSON.stringify([
                { name: 'Child one', parent_wbs: '0100' },
                { name: 'Child two', parent_wbs: '0100' },
                { name: 'Child three', parent_wbs: '0200' },
            ]),
        );
        const refreshRoster = mock(async (wbs: string) => {
            if (wbs === '0200') throw new Error('no plan');
            return { wbs, childCount: 2, written: true };
        });
        const show = mock(async (wbs: string) => ({ wbs, status: 'wip' }) as never);
        const { children, parentsWired } = await ops({ list: mock(async () => []), refreshRoster, show }).batchCreate(
            batchFile,
        );
        expect(children).toHaveLength(3);
        expect(refreshRoster.mock.calls.map((c) => c[0])).toEqual(['0100', '0200']);
        expect(show.mock.calls.map((c) => c[0])).toEqual(['0100', '0200']);
        expect(parentsWired).toEqual([
            { wbs: '0100', rostered: true, transitionedTo: null, errors: [] },
            { wbs: '0200', rostered: false, transitionedTo: null, errors: ['refreshRoster: no plan'] },
        ]);
    });
});
