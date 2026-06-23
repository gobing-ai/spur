/**
 * TaskService — core task verbs over PlanningWriteService and direct corpus reads.
 *
 * Design §10, delivery §1.1. Read verbs never lock. Write verbs delegate to
 * PlanningWriteService. WBS allocation is race-safe under the create-lock.
 */

import { dirname, isAbsolute, relative, resolve } from 'node:path';
import {
    buildTaskSkeleton,
    DEFAULT_TASK_VARIANT,
    MarkdownDocument,
    TASK_STATUSES,
    type TaskBatchItem,
    type TaskSection,
    taskBatchSchema,
} from '@gobing-ai/spur-domain';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import type { SectionMatrix } from './planning-check-base';
import type { EntityRef, PlanningWriteService, WriteResult } from './planning-write-service';

// ─── Types ──────────────────────────────────────────────────────────────

/** Dependencies injected into TaskService. */
export interface TaskServiceContext {
    fs: FileSystem;
    writeService: PlanningWriteService;
    /** Tasks folder path. */
    tasksDir: string;
    /** Project name for atomic writes. */
    projectName?: string;
    /** Actor identifier for history lines (default: 'system'). */
    actor?: string;
    /**
     * Section-Status-Matrix (config/tasks/section-matrix.yaml). Drives which
     * sections a newly created task carries for its creation status (§3.2).
     * When absent, a built-in default is used so creation never hard-depends on
     * a loadable matrix (e.g. a `--compile` single binary).
     */
    sectionMatrix?: SectionMatrix;
    /**
     * Resolve per-variant section-body overrides from the variant's template
     * file (`config/templates/task/<variant>.md`). The caller (CLI) owns file
     * reading; returning `{}` (or omitting this) means matrix + guidance only.
     */
    resolveTemplateBodies?: (variant: string) => Partial<Record<TaskSection, string>>;
}

/** Job payload enqueued for async task actions. */
export interface TaskActionJob {
    wbs: string;
    action: string;
    channel?: string;
    skipDeps?: boolean;
}

/** Result returned by fulfillAction when a job is enqueued. */
export interface TaskActionResult {
    runId: string;
    action: string;
    status: 'queued';
}

/** Task summary returned by list/show. */
export interface TaskSummary {
    wbs: string;
    name: string;
    status: string;
    /** Absolute file path. */
    filePath: string;
    frontmatter: Record<string, unknown>;
}

/** Show result: task summary + full markdown content. */
export interface TaskShowResult extends TaskSummary {
    /** The full markdown content. */
    content: string;
}

/** Filter options for the list verb. */
export interface TaskListFilters {
    status?: string;
    parentWbs?: string;
    folder?: string;
    /** Legacy alias: 'phase' maps to status filter for backward compat. */
    phase?: string;
}

/**
 * Built-in section sets per creation status, used only when no Section-Status-
 * Matrix is injected (mirrors the shipped `config/tasks/section-matrix.yaml`
 * standard variant — keep in sync). `History` is appended by the resolver.
 */
const DEFAULT_CREATION_SECTIONS: Record<string, string[]> = {
    backlog: ['Background'],
    todo: ['Background', 'Requirements', 'Acceptance Criteria', 'Q&A', 'Design', 'Plan'],
};

/**
 * Normalize a Requirements body to a bulleted markdown list. R-numbered items
 * written as one run-on paragraph (`R1. … R2. …`) become one `- Rn. …` line
 * each, so they render as a clear list in a markdown viewer (dogfood issue #2).
 * Already-bulleted or multi-line input is returned unchanged.
 */
function bulletizeRequirements(raw: string): string {
    const text = raw.trim();
    if (text === '') return text;
    // Already a bullet/numbered list or multi-line — leave as authored.
    if (/\n/.test(text) || /^\s*[-*]\s/.test(text)) return text;
    const parts = text
        .split(/(?=\bR\d+\.)/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
    if (parts.length <= 1) return text;
    return parts.map((p) => `- ${p}`).join('\n');
}

// ─── TaskService ────────────────────────────────────────────────────────

/** Core task verbs over PlanningWriteService and direct corpus reads. */
export class TaskService {
    private readonly ctx: TaskServiceContext;
    private readonly writeService: PlanningWriteService;

    constructor(ctx: TaskServiceContext) {
        this.ctx = ctx;
        this.writeService = ctx.writeService;
    }

    /**
     * Resolve which sections a newly created task carries for `status`, from the
     * injected Section-Status-Matrix (`required ∪ optional`, §3.2). Falls back to
     * a built-in default when no matrix is available so creation never depends on
     * a loadable config (e.g. a `--compile` single binary). `History` is always
     * appended (the machine-owned transition log).
     */
    private sectionsForStatus(variant: string, status: string): string[] {
        const matrix = this.ctx.sectionMatrix;
        const entry = matrix?.variants[variant]?.[status] ?? matrix?.variants.standard?.[status];
        if (entry !== undefined) {
            return [...(entry.required ?? []), ...(entry.optional ?? []), 'History'];
        }
        const fallback = DEFAULT_CREATION_SECTIONS[status] ?? ['Background'];
        return [...fallback, 'History'];
    }

    /**
     * Merge per-variant template body overrides (e.g. `review`'s P1–P4 table)
     * with task-specific bodies (Background, Requirements). Task-specific bodies
     * win — the template supplies boilerplate, the task supplies real content.
     */
    private bodiesFor(
        variant: string,
        taskBodies: Partial<Record<TaskSection, string>>,
    ): Partial<Record<TaskSection, string>> {
        const templateBodies = this.ctx.resolveTemplateBodies?.(variant) ?? {};
        return { ...templateBodies, ...taskBodies };
    }

    // ── create ──

    async create(params: {
        title: string;
        featureId?: string;
        parentWbs?: string;
        status?: string;
        template?: string;
        actor?: string;
    }): Promise<WriteResult> {
        const folder = this.ctx.tasksDir;

        // Feature-derived Background is independent of the allocated WBS, so it
        // can be computed before the lock to keep the critical section short.
        let background = '';
        if (params.featureId !== undefined) {
            background = await this.deriveBackground(params.featureId);
        }

        // A feature link defaults the variant to `feature-impl`; otherwise `standard`.
        // An explicit --template always wins.
        const variant = params.template ?? (params.featureId !== undefined ? 'feature-impl' : DEFAULT_TASK_VARIANT);

        // WBS allocation + write run inside the create-lock so concurrent
        // creates cannot allocate the same number and clobber each other.
        // A task created with a feature link signals intent-to-execute → 'todo'
        // (the HITL-review stage); a bare capture stays 'backlog' (§2.3 semantics:
        // backlog = still preparing, todo = ready to start). Explicit status wins.
        const status = params.status ?? (params.featureId !== undefined ? 'todo' : 'backlog');

        return this.writeService.createAllocated(folder, async () => {
            const wbs = await this.allocateWbs();
            const slug = this.slugify(params.title);
            const filePath = this.resolveTaskPath(wbs, slug);

            const now = new Date().toISOString();
            const frontmatter = [
                'schema_version: 1',
                `name: "${params.title}"`,
                `status: ${status}`,
                `template: ${variant}`,
                `created_at: ${now}`,
                `updated_at: ${now}`,
                params.featureId !== undefined ? `feature_id: ${params.featureId}` : null,
                params.parentWbs !== undefined ? `parent_wbs: "${params.parentWbs}"` : null,
            ]
                .filter(Boolean)
                .join('\n');

            const content = buildTaskSkeleton({
                wbs,
                title: params.title,
                frontmatter,
                sections: this.sectionsForStatus(variant, status),
                bodies: this.bodiesFor(variant, background !== '' ? { Background: background } : {}),
            });

            const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder };
            return { ref, content };
        });
    }

    // ── show ──

    async show(wbs: string): Promise<TaskShowResult> {
        const filePath = await this.resolveTaskFile(wbs);
        const raw = await this.ctx.fs.readFile(filePath);
        const doc = MarkdownDocument.parse(raw, 'task');
        const fm = doc.frontmatterData ?? {};

        return {
            wbs,
            name: (fm.name as string) ?? '',
            status: (fm.status as string) ?? '',
            filePath,
            frontmatter: fm as Record<string, unknown>,
            content: raw,
        };
    }

    // ── update (status transition) ──

    async updateStatus(wbs: string, toStatus: string, actor?: string): Promise<WriteResult> {
        const filePath = await this.resolveTaskFile(wbs);
        const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder: this.ctx.tasksDir };
        return this.writeService.transition(ref, toStatus, actor ?? this.ctx.actor ?? 'system');
    }

    // ── updateBody (body region write) ──

    /**
     * Replace the task's markdown body — everything between the frontmatter and
     * the first `###` section heading. Frontmatter and named sections are untouched.
     *
     * `_actor` is accepted for transport parity with the contract's optional `actor`
     * input but is not used: a body write has no status change, so it appends no
     * `## History` line (history is gated on transitions) and there is nothing to
     * attribute. Kept wired so a future audit-log of body edits needs no signature change.
     */
    async updateBody(wbs: string, body: string, _actor?: string): Promise<WriteResult> {
        const filePath = await this.resolveTaskFile(wbs);
        const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder: this.ctx.tasksDir };
        return this.writeService.updateBody(ref, body);
    }

    // ── fulfillAction ──

    /**
     * Enqueue a task action (run, verify, etc.) for async execution.
     *
     * The caller provides `enqueue` — a function that persists the job and
     * returns the `runId`. The handler provides this via the server jobQueue;
     * the service owns only the business validation (task exists, action is
     * supported).
     *
     * @throws if the task file does not exist.
     */
    async fulfillAction(
        wbs: string,
        action: string,
        enqueue: (job: TaskActionJob) => Promise<string>,
        options?: { channel?: string; skipDeps?: boolean },
    ): Promise<TaskActionResult> {
        // Validate the task file exists (throws if not found).
        await this.resolveTaskFile(wbs);

        const runId = await enqueue({ wbs, action, channel: options?.channel, skipDeps: options?.skipDeps });
        return { runId, action, status: 'queued' };
    }

    // ── update (section from file) ──

    async updateSection(wbs: string, sectionName: string, sourceFile: string): Promise<WriteResult> {
        const filePath = await this.resolveTaskFile(wbs);
        const body = await this.ctx.fs.readFile(sourceFile);
        const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder: this.ctx.tasksDir };
        return this.writeService.updateSection(ref, sectionName, body);
    }

    // ── batch-create ──

    async batchCreate(jsonPath: string): Promise<WriteResult[]> {
        const raw = await this.ctx.fs.readFile(jsonPath);
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            throw new Error('batch file is not valid JSON');
        }

        const result = taskBatchSchema.safeParse(parsed);
        if (!result.success) {
            const issues = result.error.issues.map((i) => `  [${i.path.join('.')}] ${i.message}`).join('\n');
            throw new Error(`batch validation failed:\n${issues}`);
        }

        const items: TaskBatchItem[] = result.data;
        const writeResults: WriteResult[] = [];
        const createdRefs: EntityRef[] = [];

        try {
            for (const item of items) {
                const wr = await this.createBatchItem(item);
                writeResults.push(wr);
                createdRefs.push(wr.ref);
            }
        } catch (err) {
            for (const ref of createdRefs) {
                try {
                    await this.ctx.fs.deleteFile(ref.filePath);
                } catch {
                    // best-effort cleanup
                }
            }
            throw err;
        }

        return writeResults;
    }

    private async createBatchItem(item: TaskBatchItem): Promise<WriteResult> {
        const folder = this.ctx.tasksDir;

        // Feature-derived Background is WBS-independent — compute before the lock.
        let background = item.background ?? '';
        if (!background && item.feature_id !== undefined && item.feature_id !== null) {
            background = await this.deriveBackground(item.feature_id);
        }

        // A batch item with a real spec (background or requirements) is ready to
        // execute → 'todo'; otherwise 'backlog' (§2.3 semantics).
        const hasSpec = background !== '' || (item.requirements ?? '').trim() !== '';
        const status = hasSpec ? 'todo' : 'backlog';

        // Explicit item template wins; a feature link defaults to `feature-impl`, else `standard`.
        const variant =
            item.template ??
            (item.feature_id !== undefined && item.feature_id !== null ? 'feature-impl' : DEFAULT_TASK_VARIANT);

        // Allocate + write inside the create-lock (race-safe WBS allocation).
        return this.writeService.createAllocated(folder, async () => {
            const wbs = await this.allocateWbs();
            const slug = this.slugify(item.name);
            const filePath = this.resolveTaskPath(wbs, slug);

            const now = new Date().toISOString();
            const fmLines = [
                'schema_version: 1',
                `name: "${item.name}"`,
                `status: ${status}`,
                `template: ${variant}`,
                `created_at: ${now}`,
                `updated_at: ${now}`,
                item.feature_id !== undefined ? `feature_id: ${item.feature_id}` : null,
                item.parent_wbs !== undefined ? `parent_wbs: "${item.parent_wbs}"` : null,
                item.priority !== undefined ? `priority: ${item.priority}` : null,
                item.tags !== undefined && item.tags.length > 0
                    ? `tags: [${item.tags.map((t) => `"${t}"`).join(', ')}]`
                    : null,
            ]
                .filter(Boolean)
                .join('\n');

            const taskBodies: Partial<Record<TaskSection, string>> = {};
            if (background !== '') taskBodies.Background = background;
            if ((item.requirements ?? '').trim() !== '') {
                taskBodies.Requirements = bulletizeRequirements(item.requirements ?? '');
            }

            const content = buildTaskSkeleton({
                wbs,
                title: item.name,
                frontmatter: fmLines,
                sections: this.sectionsForStatus(variant, status),
                bodies: this.bodiesFor(variant, taskBodies),
            });

            const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder };
            return { ref, content };
        });
    }

    // ── refresh ──

    async refresh(): Promise<string> {
        const tasks = await this.list();
        const kanban = this.renderKanban(tasks);
        const kanbanPath = `${this.ctx.tasksDir}/kanban.md`;
        await this.ctx.fs.writeFile(kanbanPath, kanban);
        return kanban;
    }

    private renderKanban(tasks: TaskSummary[]): string {
        const statusOrder: Record<string, number> = {};
        TASK_STATUSES.forEach((s, i) => {
            statusOrder[s] = i;
        });

        const byStatus = new Map<string, TaskSummary[]>();
        for (const t of tasks) {
            const status = t.status in statusOrder ? t.status : 'backlog';
            const group = byStatus.get(status);
            if (group) {
                group.push(t);
            } else {
                byStatus.set(status, [t]);
            }
        }

        const sortedStatuses = [...byStatus.keys()].sort((a, b) => {
            const oa = statusOrder[a] ?? 99;
            const ob = statusOrder[b] ?? 99;
            return oa - ob;
        });

        const lines: string[] = ['# Kanban', '', '> Auto-generated by `spur task refresh`. Do not edit.', ''];

        for (const status of sortedStatuses) {
            const group = byStatus.get(status);
            if (!group || group.length === 0) continue;

            const displayStatus = status.charAt(0).toUpperCase() + status.slice(1);
            lines.push(`## ${displayStatus}`, '');

            const unparented: TaskSummary[] = [];
            const byParent = new Map<string, TaskSummary[]>();
            for (const t of group) {
                const parentWbs = t.frontmatter.parent_wbs as string | undefined;
                if (parentWbs) {
                    const pg = byParent.get(parentWbs);
                    if (pg) {
                        pg.push(t);
                    } else {
                        byParent.set(parentWbs, [t]);
                    }
                } else {
                    unparented.push(t);
                }
            }

            for (const t of unparented.sort((a, b) => a.wbs.localeCompare(b.wbs))) {
                const name = t.frontmatter.name ?? t.name;
                lines.push(`- [${t.wbs}](${this.relativePath(t.filePath)}) ${name}`);
            }

            const sortedParents = [...byParent.keys()].sort();
            for (const parentWbs of sortedParents) {
                const children = byParent.get(parentWbs);
                if (!children) continue;
                lines.push(`- **${parentWbs}**`);
                for (const t of children.sort((a, b) => a.wbs.localeCompare(b.wbs))) {
                    const name = t.frontmatter.name ?? t.name;
                    lines.push(`  - [${t.wbs}](${this.relativePath(t.filePath)}) ${name}`);
                }
            }

            lines.push('');
        }

        return lines.join('\n');
    }

    private relativePath(filePath: string): string {
        const prefix = this.ctx.tasksDir;
        if (filePath.startsWith(prefix)) {
            return filePath.slice(prefix.length).replace(/^\//, '');
        }
        return filePath;
    }

    // ── list ──

    async list(filters?: TaskListFilters): Promise<TaskSummary[]> {
        const dir = this.resolveListDir(filters?.folder);

        const entries = await this.ctx.fs.readDir(dir);
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
                const status = (fm.status as string) ?? '';
                const parentWbs = (fm.parent_wbs as string | null) ?? undefined;

                if (filters?.status !== undefined && filters.status !== status) continue;
                if (filters?.parentWbs !== undefined && filters.parentWbs !== parentWbs) continue;
                if (filters?.phase !== undefined && filters.phase !== status) continue;

                tasks.push({
                    wbs,
                    name: (fm.name as string) ?? name,
                    status,
                    filePath: actualPath,
                    frontmatter: fm as Record<string, unknown>,
                });
            } catch {
                // Skip unparseable files
            }
        }
        return tasks;
    }

    // ── resolve ──

    async resolve(filePath: string): Promise<{ wbs: string; filePath: string } | null> {
        const entries = await this.ctx.fs.readDir(this.ctx.tasksDir);
        for (const name of entries) {
            const [, wbs, slug] = /^(\d{4})_(.+)\.md$/.exec(name) ?? [];
            if (!wbs || !slug) continue;
            const taskPath = this.resolveTaskPath(wbs, slug);
            if (taskPath === filePath) {
                return { wbs, filePath: taskPath };
            }
        }

        // Strategy 2: parse a WBS out of the basename and resolve it in the corpus.
        const basename = filePath.split('/').pop() ?? '';
        const capturedWbs = /^(\d{4})_.+\.md$/.exec(basename)?.[1];
        if (capturedWbs) {
            try {
                const taskPath = await this.resolveTaskFile(capturedWbs);
                return { wbs: capturedWbs, filePath: taskPath };
            } catch {
                // basename looked like a task file but no such WBS exists — fall through.
            }
        }

        // A non-task path has no owning task: ownership is "the path IS a task file"
        // (the write-guard hook, 0067, guards on exactly this — it did not add
        // walk-up-to-nearest-owner, which stays out of scope). Report no match.
        return null;
    }

    // ── Private helpers ──

    private async allocateWbs(): Promise<string> {
        const entries = await this.ctx.fs.readDir(this.ctx.tasksDir);
        let max = 0;
        for (const name of entries) {
            const [, digits] = /^(\d{4})_.*\.md$/.exec(name) ?? [];
            if (digits) {
                const n = parseInt(digits, 10);
                if (n > max) max = n;
            }
        }
        return String(max + 1).padStart(4, '0');
    }

    private async resolveTaskFile(wbs: string): Promise<string> {
        const fileName = await this.findTaskFileName(wbs);
        if (!fileName) throw new Error(`Task ${wbs} not found in ${this.ctx.tasksDir}`);
        const slug = fileName.replace(/^\d{4}_/, '').replace(/\.md$/, '');
        return this.resolveTaskPath(wbs, slug);
    }

    private async findTaskFileName(wbs: string): Promise<string | null> {
        const entries = await this.ctx.fs.readDir(this.ctx.tasksDir);
        for (const name of entries) {
            if (name.startsWith(`${wbs}_`) && name.endsWith('.md')) return name;
        }
        return null;
    }

    private async deriveBackground(featureId: string): Promise<string> {
        const featuresDir = this.ctx.tasksDir.replace(/\/tasks$/, '/features');
        let entries: string[] = [];
        try {
            entries = await this.ctx.fs.readDir(featuresDir);
        } catch {
            return '';
        }
        for (const name of entries) {
            if (!name.match(/^[A-Z][1-9]*_.+\.md$/)) continue;
            try {
                const filePath = `${featuresDir}/${name}`;
                const raw = await this.ctx.fs.readFile(filePath);
                const doc = MarkdownDocument.parse(raw, 'feature');
                const fm = doc.frontmatterData ?? {};
                if (fm.id !== featureId) continue;
                if (fm.priority !== 'P0') continue;
                if (!['active', 'verifying'].includes(fm.status as string)) continue;
                const goal = doc.getSection('Goal') ?? '';
                return goal.trim();
            } catch {
                // Skip an unparseable feature file — Background derivation is best-effort.
            }
        }
        return '';
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
    private resolveListDir(folder?: string): string {
        if (folder === undefined) return this.ctx.tasksDir;
        const root = resolve(dirname(this.ctx.tasksDir));
        const candidate = resolve(root, folder);
        const rel = relative(root, candidate);
        if (rel.startsWith('..') || isAbsolute(rel)) {
            throw new Error(`Invalid folder: ${folder} escapes the planning workspace`);
        }
        return folder;
    }

    private slugify(title: string): string {
        return title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60);
    }
}
