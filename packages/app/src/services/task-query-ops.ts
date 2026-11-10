import { atomicWriteAsync, MarkdownDocument, normalizeTaskStatus, type TaskStatus } from '@gobing-ai/spur-domain';
import { ValidationError } from '@gobing-ai/ts-utils';
import { PlanningReadError } from '../errors';
import type { TaskFiles } from './task-files';
import type { TaskLocator } from './task-locator';
import { taskMetadata } from './task-metadata';
import { ROSTER_END, ROSTER_REGION_RE, ROSTER_START, renderRosterTable } from './task-roster-table';
import type {
    TaskListFilters,
    TaskService,
    TaskServiceContext,
    TaskShowResult,
    TaskShowSectionEntry,
    TaskShowSectionsResult,
    TaskSummary,
} from './task-service';

/**
 * Read-side task verbs for {@link TaskService}: `task show`, `task list`, path resolution and the
 * roster/index refresh.
 */
export class TaskQueryOps {
    constructor(
        private readonly host: TaskService,
        private readonly ctx: TaskServiceContext,
        private readonly locator: TaskLocator,
        private readonly files: TaskFiles,
    ) {}

    /**
     * Shared read behind `show`/`showSections`/`showSummary`: resolve the file,
     * parse once, and project the metadata summary every variant returns.
     */
    private async readTaskSummary(wbs: string): Promise<{ summary: TaskSummary; doc: MarkdownDocument; raw: string }> {
        const filePath = await this.files.resolveTaskFile(wbs);
        const raw = await this.ctx.fs.readFile(filePath);
        const doc = MarkdownDocument.parse(raw, 'task');
        const fm = doc.frontmatterData ?? {};
        const { status, featureId } = taskMetadata(fm);

        return {
            summary: {
                wbs,
                name: (fm.name as string) ?? '',
                status,
                filePath,
                // The same two promotions `list()` makes, so `task show --json` and
                // `task list --json` project the same shape (session review).
                dependencies: Array.isArray(fm.dependencies)
                    ? (fm.dependencies as unknown[]).filter((dep): dep is string => typeof dep === 'string')
                    : [],
                feature_id: featureId,
                frontmatter: fm as Record<string, unknown>,
            },
            doc,
            raw,
        };
    }

    /** Implementation of {@link TaskService.show} (see its doc comment for the contract). */
    async show(wbs: string): Promise<TaskShowResult> {
        const { summary, doc } = await this.readTaskSummary(wbs);
        return { ...summary, content: doc.bodyWithoutFrontmatter };
    }

    /**
     * Implementation of {@link TaskService.showSections} (see its doc comment for
     * the contract). Unknown names fail BEFORE any output with the present
     * section names, so a caller can correct itself in one round-trip.
     */
    async showSections(wbs: string, requested: readonly string[]): Promise<TaskShowSectionsResult> {
        const { summary, doc, raw } = await this.readTaskSummary(wbs);
        const present = doc.sectionNames;
        const unknown = requested.filter((name) => !present.includes(name));
        if (unknown.length > 0) {
            const err: Error & { cliCode?: string } = new Error(
                `Unknown section(s): ${unknown.map((n) => `"${n}"`).join(', ')}. ` +
                    `Sections in task ${wbs}: ${present.join(', ') || '(none)'}`,
            );
            err.cliCode = 'VALIDATION_FAILED';
            throw err;
        }
        // File order; `present` is already deduped by the parser, so repeated
        // flags naming the same section collapse to one entry.
        const sections = present
            .filter((name) => requested.includes(name))
            .map((name): TaskShowSectionEntry => {
                const content = doc.sectionContent(name);
                return {
                    name,
                    headingLine: content?.headingLine ?? '',
                    // Byte counts are bytes (UTF-8), never characters.
                    byteCount: Buffer.byteLength(content?.text ?? ''),
                    content: content?.text ?? '',
                };
            });
        return { ...summary, sections, totalBytes: Buffer.byteLength(raw) };
    }

    /** Implementation of {@link TaskService.showSummary} (see its doc comment for the contract). */
    async showSummary(wbs: string): Promise<TaskShowSectionsResult> {
        const { summary, doc, raw } = await this.readTaskSummary(wbs);
        const sections = doc.sectionNames.map((name): TaskShowSectionEntry => {
            const content = doc.sectionContent(name);
            return {
                name,
                headingLine: content?.headingLine ?? '',
                byteCount: Buffer.byteLength(content?.text ?? ''),
                // Summary mode carries NO bodies — the whole point is reading the
                // index without paying for the section text.
            };
        });
        return { ...summary, sections, totalBytes: Buffer.byteLength(raw) };
    }

    /** Implementation of {@link TaskService.refresh} (see its doc comment for the contract). */
    async refresh(): Promise<{ folders: number; tasks: number }> {
        const folders = this.files.allFolderDirs();

        let totalTasks = 0;
        for (const folder of folders) {
            const tasks = await this.host.list({ folder });
            totalTasks += tasks.length;
        }
        return { folders: folders.length, tasks: totalTasks };
    }

    /** Implementation of {@link TaskService.refreshRoster} (see its doc comment for the contract). */
    async refreshRoster(wbs: string): Promise<{ wbs: string; childCount: number; written: boolean }> {
        const filePath = await this.files.resolveTaskFile(wbs);
        const kids = (await this.host.list())
            .filter((t) => ((t.frontmatter.parent_wbs as string | undefined) ?? undefined) === wbs)
            .sort((a, b) => a.wbs.localeCompare(b.wbs));

        if (kids.length === 0) return { wbs, childCount: 0, written: false };

        const raw = await this.ctx.fs.readFile(filePath);
        const doc = MarkdownDocument.parse(raw, 'task');
        if (!doc.hasSection('Plan')) {
            throw new Error(`Task ${wbs} has no ## Plan section to host the sub-task roster`);
        }

        const table = renderRosterTable(
            kids.map((t) => ({
                wbs: t.wbs,
                name: (t.frontmatter.name as string | undefined) ?? t.name,
                status: t.status,
            })),
        );
        const block = `${ROSTER_START}\n${table}\n${ROSTER_END}`;

        const planBody = doc.getSection('Plan') ?? '';
        const stripped = planBody.replace(ROSTER_REGION_RE, '').trimEnd();
        doc.replaceSection('Plan', stripped.length > 0 ? `${stripped}\n\n${block}` : block);

        await atomicWriteAsync(filePath, doc.serialize(), wbs, this.ctx.fs, this.ctx.projectName ?? 'spur');
        return { wbs, childCount: kids.length, written: true };
    }

    /** Implementation of {@link TaskService.list} (see its doc comment for the contract). */
    async list(filters?: TaskListFilters): Promise<TaskSummary[]> {
        // A caller-supplied filter that fails to normalize is a validation
        // failure, not an internal error: the domain throws a plain Error, which
        // the HTTP transport would map to 500 (error-handler.ts:166). Rethrow the
        // typed ts-utils error every transport already maps to 422
        // VALIDATION_FAILED (task 0800 R4). The domain function keeps its plain
        // Error — it is also called on values read from disk, where a throw means
        // a corrupt file, not a bad request.
        const canonical = (raw: string): TaskStatus => {
            try {
                return normalizeTaskStatus(raw);
            } catch (err) {
                throw new ValidationError(err instanceof Error ? err.message : String(err));
            }
        };
        const wantStatus = filters?.status === undefined ? undefined : canonical(filters.status);
        const wantPhase = filters?.phase === undefined ? undefined : canonical(filters.phase);
        const dir = this.files.resolveListDir(filters?.folder);

        let entries: string[];
        try {
            entries = await this.ctx.fs.readDir(dir);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
            throw new PlanningReadError(dir, error);
        }
        const tasks: TaskSummary[] = [];

        for (const name of entries) {
            const [, wbs] = /^(\d{4})_.+\.md$/.exec(name) ?? [];
            if (!wbs) continue;
            // Read each file from the listed folder — not tasksDir — so a non-default
            // `folder` lists and reads consistently from the same directory.
            const actualPath = `${dir}/${name}`;
            try {
                const raw = await this.ctx.fs.readFile(actualPath);
                const doc = MarkdownDocument.parse(raw, 'task');
                const fm = doc.frontmatterData ?? {};
                const { status, featureId } = taskMetadata(fm);
                const parentWbs = (fm.parent_wbs as string | null) ?? undefined;

                if (wantStatus !== undefined && wantStatus !== status) continue;
                if (filters?.parentWbs !== undefined && filters.parentWbs !== parentWbs) continue;
                if (filters?.featureId !== undefined && filters.featureId !== featureId) continue;
                if (wantPhase !== undefined && wantPhase !== status) continue;

                // Promote the two fields every documented projection reads (session review):
                // `dependencies[]` and `feature_id` used to be reachable only via `.frontmatter`.
                const declaredDeps = Array.isArray(fm.dependencies)
                    ? (fm.dependencies as unknown[]).filter((dep): dep is string => typeof dep === 'string')
                    : [];
                tasks.push({
                    wbs,
                    name: (fm.name as string) ?? name,
                    status,
                    filePath: actualPath,
                    dependencies: declaredDeps,
                    feature_id: (featureId as string | undefined) ?? null,
                    frontmatter: fm as Record<string, unknown>,
                });
            } catch (error) {
                throw new PlanningReadError(actualPath, error);
            }
        }
        return tasks;
    }

    /** Implementation of {@link TaskService.resolve} (see its doc comment for the contract). */
    async resolve(
        filePath: string,
        opts: { strict?: boolean } = {},
    ): Promise<{ wbs: string; filePath: string } | null> {
        // Strategy 1: exact match against EVERY registered folder (not just the active
        // one) — the corpus may span folders (e.g. docs/tasks + docs/tasks2). Compare
        // normalized absolute paths so a relative or absolute input both match.
        const hit = await this.locator.exactMatch(filePath);
        if (hit !== null) return { wbs: hit.wbs, filePath: hit.filePath };

        if (opts.strict === true) return null;

        // Strategy 2: parse a WBS out of the basename and resolve it in the corpus.
        const basename = filePath.split('/').pop() ?? '';
        const capturedWbs = /^(\d{4})_.+\.md$/.exec(basename)?.[1];
        if (capturedWbs) {
            const taskPath = await this.locator.findPathByWbs(capturedWbs);
            if (taskPath !== null) return { wbs: capturedWbs, filePath: taskPath };
        }

        return null;
    }

    /** Implementation of {@link TaskService.getFilePath} (see its doc comment for the contract). */
    async getFilePath(wbs: string): Promise<string | null> {
        const result = await this.files.findTaskFileName(wbs);
        if (!result) return null;
        return result.filePath;
    }
}
