import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { PlanningWriteService } from '../../src/services/planning-write-service';
import { TaskFiles } from '../../src/services/task-files';
import { TaskLocator } from '../../src/services/task-locator';
import type { TaskServiceContext } from '../../src/services/task-service';
import { WbsCollisionError } from '../../src/services/task-service-errors';

// TaskFiles is the location/allocation collaborator TaskService owns (split out of the class
// body). These tests drive it directly against a real temp corpus.

let root: string;
let tasksDir: string;
let ctx: TaskServiceContext;
let files: TaskFiles;

function writeTask(name: string, frontmatter: string): string {
    const filePath = join(tasksDir, name);
    writeFileSync(filePath, `---\n${frontmatter}\n---\n\n## ${name}\n`);
    return filePath;
}

beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'spur-task-files-'));
    tasksDir = join(root, 'docs', 'tasks');
    mkdirSync(tasksDir, { recursive: true });
    const fs = createNodeFileSystem(root);
    ctx = { fs, tasksDir, writeService: new PlanningWriteService({ fs }) };
    files = new TaskFiles(ctx, new TaskLocator(ctx));
});

afterEach(() => {
    rmSync(root, { recursive: true, force: true });
});

describe('TaskFiles', () => {
    test('allocateWbsChecked starts at 0001 in an empty corpus and builds the slugged path', async () => {
        const allocated = await files.allocateWbsChecked('first-task');
        expect(allocated).toEqual({ wbs: '0001', filePath: `${tasksDir}/0001_first-task.md` });
    });

    test('allocateWbsChecked allocates past the highest existing WBS', async () => {
        writeTask('0007_seven.md', 'status: todo');
        writeTask('0003_three.md', 'status: todo');
        writeFileSync(join(tasksDir, 'notes.md'), 'not a task');
        expect((await files.allocateWbsChecked('next')).wbs).toBe('0008');
    });

    test('allocateWbsChecked honours a folder baseCounter floor', async () => {
        const floored = new TaskFiles(
            { ...ctx, foldersConfig: { active_folder: 'docs/tasks', folders: { 'docs/tasks': { baseCounter: 500 } } } },
            new TaskLocator(ctx),
        );
        writeTask('0002_two.md', 'status: todo');
        expect((await floored.allocateWbsChecked('floored')).wbs).toBe('0501');
    });

    test('allocateWbsChecked refuses a WBS whose prefix already exists', async () => {
        writeTask('0001_taken.md', 'status: todo');
        // Shadow the private allocator so it returns the colliding id (stale-scan simulation).
        (files as unknown as { allocateWbs: () => Promise<string> }).allocateWbs = async () => '0001';
        await expect(files.allocateWbsChecked('fresh')).rejects.toBeInstanceOf(WbsCollisionError);
    });

    test('allocation also counts the WBS ids of sibling git worktrees of the same repository', async () => {
        // Main checkout: `.git` is a directory whose `worktrees/<id>/gitdir` names each linked tree.
        const sibling = mkdtempSync(join(tmpdir(), 'spur-task-files-wt-'));
        try {
            mkdirSync(join(root, '.git', 'worktrees', 'wt1'), { recursive: true });
            writeFileSync(join(root, '.git', 'worktrees', 'wt1', 'gitdir'), `gitdir: ${sibling}/.git\n`);
            mkdirSync(join(root, '.git', 'worktrees', 'broken'), { recursive: true });
            mkdirSync(join(sibling, 'docs', 'tasks'), { recursive: true });
            writeFileSync(join(sibling, 'docs', 'tasks', '0050_elsewhere.md'), '---\nstatus: todo\n---\n');
            writeTask('0004_here.md', 'status: todo');
            expect((await files.allocateWbsChecked('next')).wbs).toBe('0051');
        } finally {
            rmSync(sibling, { recursive: true, force: true });
        }
    });

    test('resolveTaskFile returns the file path, or throws a NOT_FOUND-coded error', async () => {
        const filePath = writeTask('0042_answer.md', 'status: todo');
        expect(await files.resolveTaskFile('0042')).toBe(filePath);
        expect(await files.findTaskFileName('0042')).toMatchObject({ filePath });
        const err = await files.resolveTaskFile('0099').catch((e: unknown) => e);
        expect(err).toBeInstanceOf(Error);
        expect((err as { cliCode?: string }).cliCode).toBe('NOT_FOUND');
    });

    test('readTaskStatus and readDependencyArray read frontmatter, tolerating absent/odd values', async () => {
        const withDeps = writeTask('0010_deps.md', "status: wip\ndependencies: ['0001', 7, '0002']");
        const bare = writeTask('0011_bare.md', 'name: bare');
        expect(await files.readTaskStatus(withDeps)).toBe('wip');
        expect(await files.readDependencyArray(withDeps)).toEqual(['0001', '0002']);
        expect(await files.readTaskStatus(bare)).toBeNull();
        expect(await files.readDependencyArray(bare)).toEqual([]);
    });

    test('resolveListDir defaults to tasksDir and rejects folders escaping the workspace', () => {
        expect(files.resolveListDir()).toBe(tasksDir);
        expect(files.resolveListDir('docs/tasks')).toBe(tasksDir);
        expect(() => files.resolveListDir('../../etc')).toThrow(/escapes the planning workspace/);
    });

    test('slugify lowercases, collapses separators, trims dashes and caps at 60 chars', () => {
        expect(files.slugify('  Hello, World!  ')).toBe('hello-world');
        expect(files.slugify('x'.repeat(80))).toHaveLength(60);
    });
});
