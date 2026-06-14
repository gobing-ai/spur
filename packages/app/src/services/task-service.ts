/**
 * TaskService — core task verbs over PlanningWriteService and direct corpus reads.
 *
 * Design §10, delivery §1.1. Read verbs never lock. Write verbs delegate to
 * PlanningWriteService. WBS allocation is race-safe under the create-lock.
 */

import { MarkdownDocument } from '@gobing-ai/spur-domain';
import type { FileSystem } from '@gobing-ai/ts-runtime';
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
// ─── TaskService ────────────────────────────────────────────────────────

/** Core task verbs over PlanningWriteService and direct corpus reads. */
export class TaskService {
    private readonly ctx: TaskServiceContext;
    private readonly writeService: PlanningWriteService;

    constructor(ctx: TaskServiceContext) {
        this.ctx = ctx;
        this.writeService = ctx.writeService;
    }

    // ── create ──

    /**
     * Create a new task with race-safe WBS allocation and Goal→Background derivation.
     *
     * Allocates the next 4-digit WBS for the tasksDir, derives Background from the
     * active P0 feature's `## Goal` section, and delegates the write to
     * PlanningWriteService.create.
     */
    async create(params: {
        title: string;
        /** Feature ID for traceability and Goal→Background derivation. */
        featureId?: string;
        /** Parent WBS for sub-task grouping. */
        parentWbs?: string;
        /** Custom status (default: backlog). */
        status?: string;
        /** Actor for the history line. */
        actor?: string;
    }): Promise<WriteResult> {
        const wbs = await this.allocateWbs();
        const slug = this.slugify(params.title);
        const filePath = this.resolveTaskPath(wbs, slug);
        const folder = this.ctx.tasksDir;

        // Derive Background from the active P0 feature (B09)
        let background = '';
        if (params.featureId !== undefined) {
            background = await this.deriveBackground(params.featureId);
        }

        // Build content from canonical template
        const now = new Date().toISOString();
        const frontmatter = [
            'schema_version: 1',
            `name: "${params.title}"`,
            `status: ${params.status ?? 'backlog'}`,
            `created_at: ${now}`,
            `updated_at: ${now}`,
            params.featureId !== undefined ? `feature_id: ${params.featureId}` : null,
            params.parentWbs !== undefined ? `parent_wbs: "${params.parentWbs}"` : null,
        ]
            .filter(Boolean)
            .join('\n');

        const content = [
            '---',
            frontmatter,
            '---',
            '',
            `## ${wbs}. ${params.title}`,
            '',
            '### Background',
            '',
            background !== '' ? `${background}\n` : '',
            '### Requirements',
            '',
            '',
            '### Q&A',
            '',
            '',
            '### Design',
            '',
            '',
            '### Solution',
            '',
            '',
            '### Plan',
            '',
            '',
            '### Review',
            '',
            '',
            '### Testing',
            '',
            '',
            '### History',
            '',
            '',
        ].join('\n');

        const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder };
        return this.writeService.create(ref, content);
    }

    // ── show ──

    /**
     * Read and parse a task file, returning frontmatter + content.
     *
     * Read-only — never acquires a lock.
     */
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

    /**
     * Transition a task to a new lifecycle status.
     *
     * Delegates to PlanningWriteService.transition, which runs the 9-step
     * pipeline including lifecycle guard validation.
     */
    async updateStatus(wbs: string, toStatus: string, actor?: string): Promise<WriteResult> {
        const filePath = await this.resolveTaskFile(wbs);
        const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder: this.ctx.tasksDir };
        return this.writeService.transition(ref, toStatus, actor ?? this.ctx.actor ?? 'system');
    }

    // ── update (section from file) ──

    /**
     * Replace a task section body from a file (dominant agent write pattern, A03).
     */
    async updateSection(wbs: string, sectionName: string, sourceFile: string): Promise<WriteResult> {
        const filePath = await this.resolveTaskFile(wbs);
        const body = await this.ctx.fs.readFile(sourceFile);
        const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder: this.ctx.tasksDir };
        return this.writeService.updateSection(ref, sectionName, body);
    }

    // ── list ──

    /**
     * List tasks with optional filtering by status, phase, or parent WBS.
     *
     * Scans the tasksDir for `NNNN_*.md` files, parses frontmatter, and applies filters.
     * Read-only — never acquires a lock.
     */
    async list(filters?: {
        status?: string;
        parentWbs?: string;
        /** Legacy alias: 'phase' maps to status filter for backward compat. */
        phase?: string;
    }): Promise<TaskSummary[]> {
        const entries = await this.ctx.fs.readDir(this.ctx.tasksDir);
        const tasks: TaskSummary[] = [];

        for (const name of entries) {
            const [, wbs] = /^(\d{4})_.+\.md$/.exec(name) ?? [];
            if (!wbs) continue;
            // Resolve actual path since we don't know the slug
            const actualName = await this.findTaskFileName(wbs);
            if (!actualName) continue;
            const actualPath = this.resolveTaskPath(wbs, actualName.replace(/^\d{4}_/, '').replace(/\.md$/, ''));
            try {
                const raw = await this.ctx.fs.readFile(actualPath);
                const doc = MarkdownDocument.parse(raw, 'task');
                const fm = doc.frontmatterData ?? {};
                const status = (fm.status as string) ?? '';
                const parentWbs = (fm.parent_wbs as string | null) ?? undefined;

                // Apply filters
                if (filters?.status !== undefined && filters.status !== status) continue;
                if (filters?.parentWbs !== undefined && filters.parentWbs !== parentWbs) continue;
                if (filters?.phase !== undefined && filters.phase !== status) continue; // legacy alias

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

    /**
     * Map a file path to its owning task WBS + file.
     *
     * Scans all task files for one with a matching frontmatter `id` or whose
     * file path is the given path. If the path is a non-task file, walks up
     * to find the nearest owning task (for write-guard hook usage, A10).
     */
    async resolve(filePath: string): Promise<{ wbs: string; filePath: string } | null> {
        // Direct match: filePath is exactly a task file
        const entries = await this.ctx.fs.readDir(this.ctx.tasksDir);
        for (const name of entries) {
            const [, wbs, slug] = /^(\d{4})_(.+)\.md$/.exec(name) ?? [];
            if (!wbs || !slug) continue;
            const taskPath = this.resolveTaskPath(wbs, slug);
            if (taskPath === filePath) {
                return { wbs, filePath: taskPath };
            }
        }
        return null;
    }

    // ── Private helpers ──

    /** Allocate the next 4-digit WBS by scanning existing task files. */
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

    /** Resolve a WBS to its file path by globbing the folder. */
    private async resolveTaskFile(wbs: string): Promise<string> {
        const fileName = await this.findTaskFileName(wbs);
        if (!fileName) throw new Error(`Task ${wbs} not found in ${this.ctx.tasksDir}`);
        const slug = fileName.replace(/^\d{4}_/, '').replace(/\.md$/, '');
        return this.resolveTaskPath(wbs, slug);
    }

    /** Find the file name for a WBS by globbing. */
    private async findTaskFileName(wbs: string): Promise<string | null> {
        const entries = await this.ctx.fs.readDir(this.ctx.tasksDir);
        for (const name of entries) {
            if (name.startsWith(`${wbs}_`) && name.endsWith('.md')) return name;
        }
        return null;
    }

    /** Derive Background from the active P0 feature's Goal section (B09). */
    private async deriveBackground(featureId: string): Promise<string> {
        const featuresDir = this.ctx.tasksDir.replace(/\/tasks$/, '/features');
        let entries: string[] = [];
        try {
            entries = await this.ctx.fs.readDir(featuresDir);
        } catch {
            return ''; // no features directory
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
            } catch {}
        }
        return '';
    }

    private resolveTaskPath(wbs: string, slug: string): string {
        return `${this.ctx.tasksDir}/${wbs}_${slug}.md`;
    }

    private slugify(title: string): string {
        return title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60);
    }
}
