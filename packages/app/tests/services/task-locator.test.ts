import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeFileSystem } from '@gobing-ai/ts-runtime';
import { TaskLocator } from '../../src/services/task-locator';

/** Corpus with an active `tasks/` folder and a sibling `tasks2/`. */
function seedCorpus(): {
    fs: ReturnType<typeof createNodeFileSystem>;
    tasksDir: string;
    otherDir: string;
    root: string;
    cleanup(): void;
} {
    const root = mkdtempSync(join(tmpdir(), 'spur-locator-'));
    const tasksDir = join(root, 'tasks');
    const otherDir = join(root, 'tasks2');
    mkdirSync(tasksDir, { recursive: true });
    mkdirSync(otherDir, { recursive: true });
    writeFileSync(join(tasksDir, '0001_first.md'), 'first');
    writeFileSync(join(otherDir, '0002_second.md'), 'second');
    writeFileSync(join(tasksDir, 'kanban.md'), 'not a task');

    return {
        fs: createNodeFileSystem(),
        tasksDir,
        otherDir,
        root,
        cleanup: () => rmSync(root, { recursive: true, force: true }),
    };
}

function multiFolder(seed: ReturnType<typeof seedCorpus>): TaskLocator {
    return new TaskLocator({
        fs: seed.fs,
        tasksDir: seed.tasksDir,
        foldersConfig: { folders: { [seed.tasksDir]: {}, [seed.otherDir]: {} } },
    });
}

describe('TaskLocator', () => {
    describe('folderDirs', () => {
        test('lists the active folder first, then configured folders, deduped', () => {
            const seed = seedCorpus();
            const dirs = multiFolder(seed).folderDirs();
            seed.cleanup();

            expect(dirs[0]).toBe(seed.tasksDir);
            expect(dirs).toContain(seed.otherDir);
            // tasksDir appears both as the active dir and as a folders key.
            expect(dirs.filter((d) => d === seed.tasksDir)).toHaveLength(1);
        });

        test('with no folder config, searches the active folder only', () => {
            const seed = seedCorpus();
            const dirs = new TaskLocator({ fs: seed.fs, tasksDir: seed.tasksDir }).folderDirs();
            seed.cleanup();

            expect(dirs).toEqual([seed.tasksDir]);
        });
    });

    describe('findByWbs', () => {
        test('finds a task in the active folder', async () => {
            const seed = seedCorpus();
            const hit = await multiFolder(seed).findByWbs('0001');
            seed.cleanup();

            expect(hit).not.toBeNull();
            expect(hit?.wbs).toBe('0001');
            expect(hit?.name).toBe('0001_first.md');
            expect(hit?.filePath).toBe(join(seed.tasksDir, '0001_first.md'));
        });

        test('finds a task in a sibling folder', async () => {
            const seed = seedCorpus();
            const hit = await multiFolder(seed).findByWbs('0002');
            seed.cleanup();

            expect(hit?.filePath).toBe(join(seed.otherDir, '0002_second.md'));
        });

        test('does not see a sibling folder when only the active folder is configured', async () => {
            const seed = seedCorpus();
            const hit = await TaskLocator.forSingleDir(seed.fs, seed.tasksDir).findByWbs('0002');
            seed.cleanup();

            expect(hit).toBeNull();
        });

        test('returns null for an unknown wbs', async () => {
            const seed = seedCorpus();
            const hit = await multiFolder(seed).findByWbs('9999');
            seed.cleanup();

            expect(hit).toBeNull();
        });

        test('requires the `<wbs>_` separator — a numeric prefix alone does not match', async () => {
            const seed = seedCorpus();
            writeFileSync(join(seed.tasksDir, '00011_decoy.md'), 'decoy');
            const hit = await multiFolder(seed).findByWbs('0001');
            seed.cleanup();

            expect(hit?.name).toBe('0001_first.md');
        });

        test('skips a configured folder that does not exist', async () => {
            const seed = seedCorpus();
            const locator = new TaskLocator({
                fs: seed.fs,
                tasksDir: join(seed.root, 'missing'),
                foldersConfig: { folders: { [seed.otherDir]: {} } },
            });
            const hit = await locator.findByWbs('0002');
            seed.cleanup();

            expect(hit?.filePath).toBe(join(seed.otherDir, '0002_second.md'));
        });

        test('surfaces a permission error instead of reporting the task missing', async () => {
            // WHY: a bare `catch {}` around readDir turns EACCES into "task not found",
            // which sends the operator hunting for a missing file that is really a
            // permissions problem. Only ENOENT/ENOTDIR may be swallowed.
            const seed = seedCorpus();
            const locked = join(seed.root, 'locked');
            mkdirSync(locked, { recursive: true });
            chmodSync(locked, 0o000);

            const locator = new TaskLocator({
                fs: seed.fs,
                tasksDir: locked,
                foldersConfig: { folders: { [locked]: {} } },
            });

            let raised: unknown;
            try {
                await locator.findByWbs('0001');
            } catch (error) {
                raised = error;
            } finally {
                chmodSync(locked, 0o755);
                seed.cleanup();
            }

            expect((raised as NodeJS.ErrnoException | undefined)?.code).toBe('EACCES');
        });
    });

    describe('exactMatch', () => {
        test('matches a task by its absolute path', async () => {
            const seed = seedCorpus();
            const hit = await multiFolder(seed).exactMatch(join(seed.otherDir, '0002_second.md'));
            seed.cleanup();

            expect(hit?.wbs).toBe('0002');
        });

        test('normalizes the target before comparing', async () => {
            const seed = seedCorpus();
            const messy = join(seed.tasksDir, '..', 'tasks', '0001_first.md');
            const hit = await multiFolder(seed).exactMatch(messy);
            seed.cleanup();

            expect(hit?.wbs).toBe('0001');
        });

        test('ignores files that do not match the `<wbs>_<slug>.md` convention', async () => {
            const seed = seedCorpus();
            const hit = await multiFolder(seed).exactMatch(join(seed.tasksDir, 'kanban.md'));
            seed.cleanup();

            expect(hit).toBeNull();
        });

        test('does not claim a same-named file outside the corpus', async () => {
            const seed = seedCorpus();
            const outside = join(seed.root, '0001_first.md');
            writeFileSync(outside, 'scratch copy');
            const hit = await multiFolder(seed).exactMatch(outside);
            seed.cleanup();

            expect(hit).toBeNull();
        });
    });

    describe('forDirs', () => {
        test('searches exactly the folders given, without reinterpreting them', async () => {
            const seed = seedCorpus();
            const hit = await TaskLocator.forDirs(seed.fs, [seed.otherDir]).findPathByWbs('0002');
            seed.cleanup();

            expect(hit).toBe(join(seed.otherDir, '0002_second.md'));
        });

        test('dedupes repeated folders', () => {
            const seed = seedCorpus();
            const dirs = TaskLocator.forDirs(seed.fs, [seed.tasksDir, seed.tasksDir]).folderDirs();
            seed.cleanup();

            expect(dirs).toEqual([seed.tasksDir]);
        });
    });

    describe('findDuplicateWbs', () => {
        test('returns empty when there are no duplicate WBS prefixes', async () => {
            const seed = seedCorpus();
            const dups = await multiFolder(seed).findDuplicateWbs();
            seed.cleanup();

            expect(dups).toEqual([]);
        });

        test('detects the same WBS across two folders', async () => {
            const seed = seedCorpus();
            writeFileSync(join(seed.otherDir, '0001_dup.md'), 'dup');
            const dups = await multiFolder(seed).findDuplicateWbs();
            seed.cleanup();

            expect(dups).toHaveLength(1);
            const [group] = dups;
            expect(group).toHaveLength(2);
            expect(group?.map((h) => h.wbs)).toEqual(['0001', '0001']);
            const names = group?.map((h) => h.name).sort();
            expect(names).toEqual(['0001_dup.md', '0001_first.md']);
        });

        test('detects the same WBS within a single folder', async () => {
            const seed = seedCorpus();
            writeFileSync(join(seed.tasksDir, '0001_dup.md'), 'dup');
            const dups = await multiFolder(seed).findDuplicateWbs();
            seed.cleanup();

            expect(dups).toHaveLength(1);
            expect(dups[0]).toHaveLength(2);
            expect(dups[0]?.map((h) => h.wbs)).toEqual(['0001', '0001']);
        });

        test('ignores non-task files like kanban.md', async () => {
            const seed = seedCorpus();
            const dups = await multiFolder(seed).findDuplicateWbs();
            seed.cleanup();

            // kanban.md exists in the seed corpus but has no WBS prefix.
            expect(dups).toEqual([]);
        });

        test('returns multiple groups when several WBS prefixes collide', async () => {
            const seed = seedCorpus();
            writeFileSync(join(seed.otherDir, '0001_dup.md'), 'dup1');
            writeFileSync(join(seed.otherDir, '0002_dup.md'), 'dup2');
            const dups = await multiFolder(seed).findDuplicateWbs();
            seed.cleanup();

            expect(dups).toHaveLength(2);
            expect(dups.every((g) => g.length === 2)).toBe(true);
            const wbsValues = dups.map((g) => g[0]?.wbs ?? '').sort();
            expect(wbsValues).toEqual(['0001', '0002']);
        });
    });
});
