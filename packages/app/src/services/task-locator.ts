/**
 * TaskLocator — the single owner of "which directories hold task files, and which
 * file belongs to WBS `nnnn`".
 *
 * Task files live at `<folder>/<wbs>_<slug>.md`, and the corpus may span several
 * folders (the active `tasksDir` plus every `spur.yaml` `tasks.folders` key). That
 * lookup was previously reimplemented in TaskService, TaskScaffoldService,
 * TaskCheckService and TeamService, and the copies had already drifted:
 * TaskCheckService searched only the checked file's own directory, so a dependency
 * living in a sibling folder was reported as missing while `spur task show` found
 * it. Centralizing the walk keeps the filename convention and the folder set in one
 * place so they cannot disagree again.
 */

import { resolve as resolvePath } from 'node:path';
import type { FileSystem } from '@gobing-ai/ts-runtime';

/** The folder set a locator searches: the active tasks dir plus configured folders. */
export interface TaskFolderSource {
    fs: FileSystem;
    /** Active tasks directory (absolute). */
    tasksDir: string;
    /** Optional multi-folder config; keys are folder paths resolved against the fs root. */
    foldersConfig?: { folders: Record<string, unknown> };
}

/** A located task file. */
export interface TaskFileHit {
    wbs: string;
    /** Basename, e.g. `0042_add-widget.md`. */
    name: string;
    /** Absolute path to the task file. */
    filePath: string;
}

/** `<wbs>_<slug>.md` — the corpus task filename convention. */
const TASK_FILENAME_RE = /^(\d{4})_(.+)\.md$/;

/**
 * Read a directory, treating "not there" as empty but letting every other failure
 * surface. A bare `catch {}` here would also swallow EACCES and ENOTDIR and report
 * the task as simply missing, which is how a permissions problem turns into a
 * confusing "task not found".
 */
async function readDirIfPresent(fs: FileSystem, dir: string): Promise<string[]> {
    try {
        return await fs.readDir(dir);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') return [];
        throw error;
    }
}

/**
 * Locates task files across configured task directories.
 */
export class TaskLocator {
    private readonly fs: FileSystem;
    /** Absolute folder list, active folder first, deduped. */
    private readonly dirs: readonly string[];

    constructor(source: TaskFolderSource | { fs: FileSystem; dirs: readonly string[] }) {
        this.fs = source.fs;
        if ('dirs' in source) {
            this.dirs = [...new Set(source.dirs)];
            return;
        }
        const folderKeys = source.foldersConfig ? Object.keys(source.foldersConfig.folders) : [];
        this.dirs = [...new Set([source.tasksDir, ...folderKeys.map((key) => source.fs.resolve(key))])];
    }

    /**
     * A locator restricted to one directory. For callers that genuinely know the
     * single folder to search and have no folder config to consult.
     */
    static forSingleDir(fs: FileSystem, dir: string): TaskLocator {
        return new TaskLocator({ fs, tasksDir: dir });
    }

    /**
     * A locator over an explicit, already-absolute folder list. For callers that
     * resolve folder paths against a base of their own (e.g. an invocation `cwd`
     * rather than the fs project root) and must not have that base reinterpreted.
     */
    static forDirs(fs: FileSystem, dirs: readonly string[]): TaskLocator {
        return new TaskLocator({ fs, dirs });
    }

    /** The task-folder directories this locator searches, as absolute paths. */
    folderDirs(): readonly string[] {
        return this.dirs;
    }

    /** Locate the file for `wbs` across every registered folder. */
    async findByWbs(wbs: string): Promise<TaskFileHit | null> {
        const prefix = `${wbs}_`;
        for (const dir of this.folderDirs()) {
            for (const name of await readDirIfPresent(this.fs, dir)) {
                if (name.startsWith(prefix) && name.endsWith('.md')) {
                    return { wbs, name, filePath: `${dir}/${name}` };
                }
            }
        }
        return null;
    }

    /** `findByWbs` returning only the path. */
    async findPathByWbs(wbs: string): Promise<string | null> {
        return (await this.findByWbs(wbs))?.filePath ?? null;
    }

    /**
     * Find the corpus task whose real path equals `target`. `target` need not be
     * absolute — it is normalized before comparison, so a relative and an absolute
     * spelling of the same file both match.
     */
    async exactMatch(target: string): Promise<TaskFileHit | null> {
        const normalized = resolvePath(target);
        for (const dir of this.folderDirs()) {
            for (const name of await readDirIfPresent(this.fs, dir)) {
                const captured = TASK_FILENAME_RE.exec(name);
                if (captured === null) continue;
                const filePath = `${dir}/${name}`;
                if (resolvePath(filePath) === normalized) {
                    return { wbs: captured[1] as string, name, filePath };
                }
            }
        }
        return null;
    }

    /**
     * Find WBS prefixes that appear in more than one file across all configured
     * folders (task 0416 R6). Returns groups of hits keyed by WBS - each group
     * has at least two entries. Uses the same folder scan as {@link findByWbs}.
     */
    async findDuplicateWbs(): Promise<TaskFileHit[][]> {
        const wbsMap = new Map<string, TaskFileHit[]>();
        for (const dir of this.folderDirs()) {
            for (const name of await readDirIfPresent(this.fs, dir)) {
                const captured = TASK_FILENAME_RE.exec(name);
                if (captured === null) continue;
                const wbs = captured[1] as string;
                const hit: TaskFileHit = { wbs, name, filePath: `${dir}/${name}` };
                const existing = wbsMap.get(wbs);
                if (existing) {
                    existing.push(hit);
                } else {
                    wbsMap.set(wbs, [hit]);
                }
            }
        }
        return [...wbsMap.values()].filter((hits) => hits.length > 1);
    }
}
