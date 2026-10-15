import { isAbsolute, relative } from 'node:path';
import { MarkdownDocument } from '@gobing-ai/spur-domain';
import type { TaskLocator } from './task-locator';
import type { TaskServiceContext } from './task-service';
import { WbsCollisionError } from './task-service-errors';

/**
 * Task-file location and WBS allocation for {@link TaskService}: folder walks, sibling-worktree
 * WBS reservation, path/slug resolution and the small frontmatter reads (status, dependencies)
 * shared by the verb modules. Owned by one TaskService instance; holds no state of its own.
 */
export class TaskFiles {
    constructor(
        private readonly ctx: TaskServiceContext,
        private readonly locator: TaskLocator,
    ) {}

    /** Read a sibling task file's frontmatter `status` (null when absent or unparsable). */
    async readTaskStatus(filePath: string): Promise<string | null> {
        const raw = await this.ctx.fs.readFile(filePath);
        const status = MarkdownDocument.parse(raw, 'task').frontmatterData?.status;
        return typeof status === 'string' ? status : null;
    }

    /** Read the current `dependencies[]` array from a task file (empty if absent). */
    async readDependencyArray(filePath: string): Promise<string[]> {
        const raw = await this.ctx.fs.readFile(filePath);
        const fm = MarkdownDocument.parse(raw, 'task').frontmatterData ?? {};
        const deps = fm.dependencies;
        if (!Array.isArray(deps)) return [];
        const out: string[] = [];
        for (const item of deps) {
            if (typeof item === 'string') out.push(item);
        }
        return out;
    }

    /** All registered task-folder directories as absolute paths. See {@link TaskLocator}. */
    allFolderDirs(): readonly string[] {
        return this.locator.folderDirs();
    }

    private async allocateWbs(): Promise<string> {
        // Scan ALL configured folders for global WBS uniqueness (rd3:tasks model).
        // Reuse the locator's already-resolved absolute folder list so the config
        // lookup (which keys on relative paths in config.yaml) can be resolved
        // to the same absolute shape the directory walk uses (task 0416 R3/R4).
        let max = 0;
        const dirs = this.allFolderDirs();

        // Build an absolute-path -> baseCounter lookup so the active folder's
        // floor is found regardless of whether it was sourced from tasksDir
        // (absolute) or a config key (relative). Without this, folders[dir]
        // misses for the active folder because tasksDir is absolute but config
        // keys are relative (task 0416 root cause).
        const folderFloors = new Map<string, number>();
        if (this.ctx.foldersConfig) {
            for (const [key, entry] of Object.entries(this.ctx.foldersConfig.folders)) {
                folderFloors.set(this.ctx.fs.resolve(key), entry.baseCounter);
            }
        }

        for (const dir of dirs) {
            const baseCounter = folderFloors.get(dir) ?? 0;
            if (baseCounter > max) max = baseCounter;
            max = Math.max(max, await this.folderMax(dir));
        }
        // WBS ids are unique per REPOSITORY, not per checkout: two worktrees allocating
        // independently both returned 1086 on 2026-10-04 and the duplicate only surfaced at merge
        // time. A sibling tree's ids therefore count toward the local maximum.
        const siblings = await this.siblingWorktreeRoots();
        if (siblings !== null) {
            for (const root of siblings.roots) {
                if (root === siblings.repoRoot) continue;
                for (const dir of dirs) {
                    if (!dir.startsWith(`${siblings.repoRoot}/`)) continue;
                    max = Math.max(max, await this.folderMax(`${root}${dir.slice(siblings.repoRoot.length)}`));
                }
            }
        }
        return String(max + 1).padStart(4, '0');
    }

    /** Highest `NNNN_*.md` WBS id in one folder; 0 when the folder is absent or unreadable. */
    private async folderMax(dir: string): Promise<number> {
        let max = 0;
        try {
            for (const name of await this.ctx.fs.readDir(dir)) {
                const [, digits] = /^(\d{4})_.*\.md$/.exec(name) ?? [];
                if (digits) max = Math.max(max, parseInt(digits, 10));
            }
        } catch {
            /* folder may not exist yet */
        }
        return max;
    }

    /**
     * The repository root and the roots of every OTHER git worktree sharing it, derived from the
     * shared `.git` metadata — no process spawn (app sources may not use `node:child_process`, and
     * the process-executor seam lives in the workflow layer). Best-effort: a directory that is not
     * a checkout, or unreadable metadata, yields `null` and single-tree behaviour is unchanged.
     */
    private async siblingWorktreeRoots(): Promise<{ repoRoot: string; roots: string[] } | null> {
        let dir = this.ctx.fs.resolve(this.ctx.tasksDir);
        for (;;) {
            const gitPath = `${dir}/.git`;
            // A `.git` FILE only exists in a linked worktree and points at the shared metadata.
            let gitFile: string | null = null;
            try {
                gitFile = await this.ctx.fs.readFile(gitPath);
            } catch {
                gitFile = null;
            }
            if (gitFile !== null) {
                const pointer = gitFile.trim().replace(/^gitdir:\s*/, '');
                const commonDir = pointer.replace(/\/worktrees\/[^/]+\/?$/, '');
                return { repoRoot: dir, roots: await this.readWorktreeRoots(commonDir) };
            }
            // A `.git` DIRECTORY marks the main checkout, whose linked trees live in its metadata.
            try {
                await this.ctx.fs.readDir(gitPath);
                return { repoRoot: dir, roots: await this.readWorktreeRoots(gitPath) };
            } catch {
                /* keep walking up */
            }
            const parent = dir.replace(/\/[^/]+$/, '');
            if (parent === dir || dir === '/') return null;
            dir = parent;
        }
    }

    /** Trees registered under `<commonDir>/worktrees/<id>/gitdir`, each naming a tree's `.git`. */
    private async readWorktreeRoots(commonDir: string): Promise<string[]> {
        const roots: string[] = [];
        try {
            for (const name of await this.ctx.fs.readDir(`${commonDir}/worktrees`)) {
                try {
                    const pointer = (await this.ctx.fs.readFile(`${commonDir}/worktrees/${name}/gitdir`))
                        .trim()
                        .replace(/^gitdir:\s*/, '');
                    roots.push(pointer.replace(/\/\.git\/?$/, ''));
                } catch {
                    /* skip an unreadable worktree entry */
                }
            }
        } catch {
            /* no linked worktrees */
        }
        return roots;
    }

    /**
     * Allocate a WBS and verify no file with that prefix already exists (task
     * 0416 R1/R2). The guard lives at the allocation seam so both `create()`
     * and `createBatchItem()` inherit it and a new caller cannot bypass it.
     * Reuses `locator.findByWbs` rather than adding a second directory walk.
     *
     * @throws {WbsCollisionError} when a file with the allocated WBS prefix exists.
     */
    async allocateWbsChecked(slug: string): Promise<{ wbs: string; filePath: string }> {
        const wbs = await this.allocateWbs();
        const existing = await this.locator.findByWbs(wbs);
        if (existing !== null) {
            throw new WbsCollisionError(wbs, existing.filePath, this.resolveTaskPath(wbs, slug));
        }
        return { wbs, filePath: this.resolveTaskPath(wbs, slug) };
    }

    async resolveTaskFile(wbs: string): Promise<string> {
        const result = await this.findTaskFileName(wbs);
        if (!result) {
            const err: Error & { cliCode?: string } = new Error(`Task ${wbs} not found in any registered task folder`);
            err.cliCode = 'NOT_FOUND';
            throw err;
        }
        return result.filePath;
    }

    /** Search all registered task folders for the task file matching `wbs`. */
    async findTaskFileName(wbs: string): Promise<{ name: string; filePath: string } | null> {
        return await this.locator.findByWbs(wbs);
    }

    private resolveTaskPath(wbs: string, slug: string): string {
        return `${this.ctx.tasksDir}/${wbs}_${slug}.md`;
    }

    /**
     * Resolve the directory `list()` reads from. Defaults to `tasksDir`. A
     * caller-supplied `folder` (web/CLI param) is constrained to the planning
     * workspace — the parent of `tasksDir` (e.g. `docs/`, holding `tasks/` and
     * `features/`). `..` traversal or absolute paths that escape that root are
     * rejected, so an arbitrary `folder` over the wire cannot enumerate the host
     * filesystem outside the workspace.
     */
    resolveListDir(folder?: string): string {
        if (folder === undefined) return this.ctx.tasksDir;
        const root = this.ctx.fs.resolve('.');
        const candidate = this.ctx.fs.resolve(folder);
        const rel = relative(root, candidate);
        if (rel.startsWith('..') || isAbsolute(rel)) {
            throw new Error(`Invalid folder: ${folder} escapes the planning workspace`);
        }
        return candidate;
    }

    slugify(title: string): string {
        return title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60);
    }
}
