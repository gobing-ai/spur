import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { ValidationError } from '@gobing-ai/ts-utils';
import { PlanningWriteService } from '../../src/services/planning-write-service';
import { TaskFiles } from '../../src/services/task-files';
import { TaskLocator } from '../../src/services/task-locator';
import { TaskQueryOps } from '../../src/services/task-query-ops';
import type { TaskService, TaskServiceContext, TaskSummary } from '../../src/services/task-service';

// TaskQueryOps holds the read-side task verbs. `refresh` and `refreshRoster` go back through the
// owning service's public `list` (so a spy or subclass on the service is honoured); the rest read
// the corpus directly. A stub host makes that routing observable.

let root: string;
let tasksDir: string;
let ctx: TaskServiceContext;
let files: TaskFiles;
let locator: TaskLocator;

function writeTask(name: string, frontmatter: string, body = ''): string {
    const filePath = join(tasksDir, name);
    writeFileSync(filePath, `---\n${frontmatter}\n---\n\n## ${name}\n${body}`);
    return filePath;
}

function ops(host: Partial<TaskService> = {}): TaskQueryOps {
    return new TaskQueryOps(host as TaskService, ctx, locator, files);
}

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'spur-task-query-ops-'));
    tasksDir = join(root, 'docs', 'tasks');
    mkdirSync(tasksDir, { recursive: true });
    const fs = createNodeFileSystem(root);
    ctx = { fs, tasksDir, writeService: new PlanningWriteService({ fs }) };
    locator = new TaskLocator(ctx);
    files = new TaskFiles(ctx, locator);
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

describe('TaskQueryOps.list / show', () => {
    test('lists only WBS-named files and applies the status, parent and feature filters', async () => {
        writeTask('0001_a.md', 'name: Alpha\nstatus: todo\nfeature_id: F1');
        writeTask('0002_b.md', 'name: Beta\nstatus: done\nparent_wbs: "0001"');
        writeFileSync(join(tasksDir, 'README.md'), 'not a task');
        const q = ops();
        expect((await q.list()).map((t) => t.wbs).sort()).toEqual(['0001', '0002']);
        expect((await q.list({ status: 'done' })).map((t) => t.wbs)).toEqual(['0002']);
        expect((await q.list({ parentWbs: '0001' })).map((t) => t.wbs)).toEqual(['0002']);
        expect((await q.list({ featureId: 'F1' })).map((t) => t.name)).toEqual(['Alpha']);
    });

    test('an un-normalizable status filter is a typed ValidationError', async () => {
        await expect(ops().list({ status: 'not-a-status' })).rejects.toBeInstanceOf(ValidationError);
    });

    test('show returns frontmatter, name, status and body', async () => {
        const filePath = writeTask('0003_c.md', 'name: Gamma\nstatus: wip', '\nbody text\n');
        const shown = await ops().show('0003');
        expect(shown).toMatchObject({ wbs: '0003', name: 'Gamma', status: 'wip', filePath });
        expect(shown.content).toContain('body text');
    });
});

describe('TaskQueryOps promotes the graph and the feature link (session review)', () => {
    // The batch driver's documented projection is `{wbs, status, dependencies, feature_id}`. Those two
    // fields used to live only under `.frontmatter`, so the projection read null and
    // `spur task batch-plan order` sorted a flat list while the real graph sat one level down.
    test('list and show expose dependencies[] and feature_id at the top level', async () => {
        writeTask('0040_a.md', 'name: A\nstatus: done\nfeature_id: F9\ndependencies: ["0039", "0038"]');
        writeTask('0041_b.md', 'name: B\nstatus: todo');
        const q = ops();

        const rows = await q.list();
        const a = rows.find((t) => t.wbs === '0040');
        const b = rows.find((t) => t.wbs === '0041');
        expect(a?.dependencies).toEqual(['0039', '0038']);
        expect(a?.feature_id).toBe('F9');
        // A task with no graph and no feature is an empty list, never undefined/null-shaped drift.
        expect(b?.dependencies).toEqual([]);
        expect(b?.feature_id).toBeNull();

        const shown = await q.show('0040');
        expect(shown.dependencies).toEqual(['0039', '0038']);
        expect(shown.feature_id).toBe('F9');
    });
});

describe('TaskQueryOps routing through the host service', () => {
    test('refresh lists every registered folder through host.list', async () => {
        const list = mock(async () => [{ wbs: '0001' } as TaskSummary, { wbs: '0002' } as TaskSummary]);
        const result = await ops({ list }).refresh();
        expect(result).toEqual({ folders: 1, tasks: 2 });
        expect(list).toHaveBeenCalledWith({ folder: tasksDir });
    });

    test('refreshRoster renders the host-listed children into the parent Plan section', async () => {
        const parent = writeTask('0010_parent.md', 'name: Parent\nstatus: wip', '\n### Plan\n\nsteps\n');
        const kids = [
            {
                wbs: '0012',
                name: 'Two',
                status: 'todo',
                filePath: '',
                dependencies: [],
                feature_id: null,
                frontmatter: { parent_wbs: '0010', name: 'Two' },
            },
            {
                wbs: '0011',
                name: 'One',
                status: 'done',
                filePath: '',
                dependencies: [],
                feature_id: null,
                frontmatter: { parent_wbs: '0010' },
            },
            {
                wbs: '0013',
                name: 'Other',
                status: 'todo',
                filePath: '',
                dependencies: [],
                feature_id: null,
                frontmatter: { parent_wbs: '0099' },
            },
        ] satisfies TaskSummary[];
        const q = ops({ list: mock(async () => kids) });
        expect(await q.refreshRoster('0010')).toEqual({ wbs: '0010', childCount: 2, written: true });
        const written = readFileSync(parent, 'utf8');
        expect(written).toContain('steps');
        expect(written.indexOf('0011')).toBeLessThan(written.indexOf('0012'));
        expect(written).not.toContain('0013');
    });

    test('refreshRoster without children writes nothing; without a Plan section it refuses', async () => {
        writeTask('0020_lonely.md', 'name: Lonely\nstatus: todo');
        expect(await ops({ list: mock(async () => []) }).refreshRoster('0020')).toEqual({
            wbs: '0020',
            childCount: 0,
            written: false,
        });
        const kid = {
            wbs: '0021',
            name: 'k',
            status: 'todo',
            filePath: '',
            dependencies: [],
            feature_id: null,
            frontmatter: { parent_wbs: '0020' },
        };
        await expect(ops({ list: mock(async () => [kid]) }).refreshRoster('0020')).rejects.toThrow('no ## Plan');
    });
});

describe('TaskQueryOps.resolve / getFilePath', () => {
    test('exact path, then WBS-from-basename, and strict mode skips the fallback', async () => {
        const filePath = writeTask('0030_real.md', 'name: Real\nstatus: todo');
        const q = ops();
        expect(await q.resolve(filePath)).toEqual({ wbs: '0030', filePath });
        expect(await q.resolve('/somewhere/else/0030_renamed.md')).toEqual({ wbs: '0030', filePath });
        expect(await q.resolve('/somewhere/else/0030_renamed.md', { strict: true })).toBeNull();
        expect(await q.resolve('/nowhere/notes.md')).toBeNull();
        expect(await q.getFilePath('0030')).toBe(filePath);
        expect(await q.getFilePath('0999')).toBeNull();
    });
});

describe('1271 — canonical task metadata projection', () => {
    test('legacy feature links and status casing project canonically without rewriting raw metadata', async () => {
        writeTask('0090_legacy.md', 'name: Legacy\nstatus: Done\nfeature-id: F1');
        const q = ops();
        const shown = await q.show('0090');
        expect(shown.status).toBe('done');
        expect(shown.feature_id).toBe('F1');
        expect(shown.frontmatter.status).toBe('Done');
        expect(shown.frontmatter['feature-id']).toBe('F1');
        expect((await q.list({ status: 'done', featureId: 'F1' })).map((task) => task.wbs)).toEqual(['0090']);
    });
});
