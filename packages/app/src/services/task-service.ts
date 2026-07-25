/**
 * TaskService — core task verbs over PlanningWriteService and direct corpus reads.
 *
 * Design §10, delivery §1.1. Read verbs never lock. Write verbs delegate to
 * PlanningWriteService. WBS allocation is race-safe under the create-lock.
 */

import { isAbsolute, relative } from 'node:path';
import type { TaskFolderEntry, TaskFoldersConfig } from '@gobing-ai/spur-config/loader';
import {
    atomicWriteAsync,
    buildTaskSkeleton,
    DEFAULT_TASK_VARIANT,
    escapeYamlValue,
    MarkdownDocument,
    renderTaskTemplate,
    SECTION_GUIDANCE,
    TASK_CANONICAL_SECTIONS,
    type TaskBatchItem,
    type TaskSection,
    taskBatchSchema,
    UNIVERSAL_SECTIONS,
} from '@gobing-ai/spur-domain';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import type { SectionMatrix } from './planning-check-base';
import type { EntityRef, PlanningEventName, PlanningWriteService, WriteResult } from './planning-write-service';
import { TaskLocator } from './task-locator';
import {
    escapeTablePipe,
    gitDiffU0,
    type RecordOptions,
    type RecordResult,
    readVerdict,
    renderReview,
    renderSolutionFromDiff,
    renderTesting,
} from './task-record';

/**
 * Replace or add a frontmatter field in rendered markdown.
 * The rendered template carries placeholder defaults (e.g. `feature_id: null`,
 * `status: backlog`); this patches them to the create-time resolved values
 * before the file is written.
 *
 * Matching is constrained to the YAML frontmatter block (between the opening
 * and closing `---` fences) so a `key:`-shaped line in the rendered body is
 * never rewritten. A missing key is inserted after the opening fence.
 * The caller owns YAML formatting ({@link escapeYamlValue}) — do not re-format here.
 */
function patchFrontmatterField(rendered: string, key: string, value: string): string {
    const openIdx = rendered.indexOf('---');
    if (openIdx === -1) return rendered;

    // Content after the opening fence line (`---` + optional newline).
    let fmStart = openIdx + 3;
    if (rendered[fmStart] === '\r') fmStart += 1;
    if (rendered[fmStart] === '\n') fmStart += 1;

    const closeRel = rendered.indexOf('\n---', fmStart);
    if (closeRel === -1) return rendered;

    const before = rendered.slice(0, fmStart);
    const fm = rendered.slice(fmStart, closeRel);
    const after = rendered.slice(closeRel); // starts with \n---

    const existingRe = new RegExp(`^${escapeRegex(key)}:.*$`, 'm');
    if (existingRe.test(fm)) {
        // Replacer function: a value containing `$&`/`$1` must stay literal.
        const newFm = fm.replace(existingRe, () => `${key}: ${value}`);
        return before + newFm + after;
    }
    // Key not present — insert after the opening fence.
    return `${before}${key}: ${value}\n${fm}${after}`;
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Error thrown by `mutateDependencies` for any validation failure (R2).
 * The `code` field is a stable identifier the CLI maps to an exit code:
 *
 * - `usage`     — wrong arg shape (op vs. values count) → exit 2
 * - `format`    — value is not a 4-digit WBS → exit 3
 * - `not-found` — no task file for a referenced WBS → exit 3
 * - `self-edge` — task references itself → exit 3
 * - `duplicate` — duplicate WBS in the resulting array → exit 3
 * - `cycle`     — the resulting graph has a cycle → exit 3
 */
export class DependencyMutationError extends Error {
    readonly code: 'usage' | 'format' | 'not-found' | 'self-edge' | 'duplicate' | 'cycle';
    constructor(code: DependencyMutationError['code'], message: string) {
        super(message);
        this.name = 'DependencyMutationError';
        this.code = code;
    }
}

/**
 * Error thrown by `mutateSections` for any validation failure (R2).
 * The `code` field is a stable identifier the CLI maps to an exit code:
 *
 * - `usage`          — wrong arg shape (op vs. section name) → exit 2
 * - `no-matrix`      — no section-matrix entry for variant/status → exit 3
 * - `unknown-section`— section name not in `TASK_CANONICAL_SECTIONS` → exit 3
 * - `forbidden`      — section is forbidden for the task's current status → exit 3
 */
export class SectionMutationError extends Error {
    readonly code: 'usage' | 'no-matrix' | 'unknown-section' | 'forbidden';
    constructor(code: SectionMutationError['code'], message: string) {
        super(message);
        this.name = 'SectionMutationError';
        this.code = code;
    }
}

/**
 * Result of a section mutation (R3). `list` is read-only and returns no
 * write-event fields; `init`/`add` write through `writeService.updateSection`
 * (atomic, schema-validated, emits `task.updated`) and carry the write result.
 */
export interface SectionMutationResult {
    readonly op: 'init' | 'add' | 'list';
    readonly ref: EntityRef;
    readonly variant: string;
    readonly status: string;
    /** Sections written (init/add); empty when no-op or for `list`. */
    readonly added: string[];
    /** Write-event name; undefined for `list` and for `init`/`add` no-ops (no write, no event). */
    readonly eventName?: PlanningEventName;
    /** Non-fatal advisories (stripped headings, no-op notices). */
    readonly warnings?: string[];
    /** Matrix snapshot for the variant/status (always present for `list`). */
    readonly matrix?: { required: string[]; optional: string[]; forbidden: string[] };
    /** Sections currently in the file (`list` only). */
    readonly present?: string[];
    /** Required sections not yet in the file (`list` only). */
    readonly missing?: string[];
}

/**
 * Render a new task file from the skeleton template + post-render
 * frontmatter patching. Used by both {@link TaskService.create} and
 * {@link TaskService.createBatchItem} to avoid duplicating the
 * template-render → patch flow (~80 lines each).
 *
 * Callers own the legacy `buildTaskSkeleton` fallback when no template
 * resolver is configured.
 */
function renderCreatedTaskContent(params: {
    rawTemplate: string;
    name: string;
    wbs: string;
    background: string;
    createdAt: string;
    status: string;
    variant: string;
    featureId?: string;
    parentWbs?: string;
    priority?: string;
    tags?: string[];
    requirements?: string;
}): string {
    let content = renderTaskTemplate(params.rawTemplate, {
        NAME: params.name,
        WBS: params.wbs,
        BACKGROUND: params.background,
        CREATED_AT: params.createdAt,
        ...(params.featureId !== undefined ? { FEATURE_ID: params.featureId } : {}),
    });
    content = patchFrontmatterField(content, 'status', params.status);
    content = patchFrontmatterField(content, 'template', params.variant);
    if (params.featureId !== undefined) {
        content = patchFrontmatterField(content, 'feature_id', escapeYamlValue(params.featureId));
    }
    if (params.parentWbs !== undefined) {
        content = patchFrontmatterField(content, 'parent_wbs', escapeYamlValue(params.parentWbs));
    }
    if (params.priority !== undefined) {
        content = patchFrontmatterField(content, 'priority', params.priority);
    }
    if (params.tags !== undefined && params.tags.length > 0) {
        content = patchFrontmatterField(
            content,
            'tags',
            `[${params.tags.map((tag) => JSON.stringify(tag)).join(', ')}]`,
        );
    }
    if ((params.requirements ?? '').trim() !== '') {
        const doc = MarkdownDocument.parse(content, 'task');
        doc.replaceSection('Requirements', bulletizeRequirements(params.requirements ?? ''));
        content = doc.serialize();
    }
    return content;
}

// ─── Sub-task roster (0123) ───────────────────────────────────────────────

/** Auto-gen markers for the parent `## Plan` sub-task roster block. */
const ROSTER_START = '<!-- AUTO-GENERATED by spur task refresh-roster -->';
const ROSTER_END = '<!-- END AUTO-GENERATED -->';
/** Matches a full prior roster region (markers inclusive) for idempotent rewrite. */
const ROSTER_REGION_RE = /<!--[ \t]*AUTO-GENERATED[^>]*-->[\s\S]*?<!--[ \t]*END[ \t]*AUTO-GENERATED[^>]*-->/g;

/** Render the sub-task roster table — one row per child (WBS · title · status). */
function renderRosterTable(rows: { wbs: string; name: string; status: string }[]): string {
    const header = '| WBS | Sub-task | Status |\n| --- | -------- | ------ |';
    const body = rows.map((r) => `| ${r.wbs} | ${escapeTablePipe(r.name)} | ${r.status} |`).join('\n');
    return `${header}\n${body}`;
}

// ─── Types ──────────────────────────────────────────────────────────────

/**
 * Per-folder configuration for WBS allocation. The canonical shape lives in
 * `@gobing-ai/spur-config` ({@link TaskFolderEntry}); re-exported under the
 * historical `FolderConfig` name so app consumers' imports stay stable (ADR-027).
 */
export type FolderConfig = TaskFolderEntry;

/**
 * Task-folder configuration sourced from the `tasks:` block in `.spur/config.yaml`.
 * Re-exported from the single config owner so the type identity is shared across the
 * loader↔service seam — no parallel definition (ADR-027).
 */
export type { TaskFoldersConfig };

/** Dependencies injected into TaskService. */
export interface TaskServiceContext {
    fs: FileSystem;
    writeService: PlanningWriteService;
    /** Tasks folder path (active_folder from config; see DEFAULT_TASKS_DIR). */
    tasksDir: string;
    /** Project name for atomic writes. */
    projectName?: string;
    /** Actor identifier for history lines (default: 'system'). */
    actor?: string;
    /**
     * Section-Status-Matrix. Drives which sections a newly created task carries
     * for its creation status (§3.2). When absent, a built-in default is used so
     * creation never hard-depends on a loadable matrix.
     */
    sectionMatrix?: SectionMatrix;
    /**
     * Resolve raw template content for a variant. Returns the template
     * markdown as-is (with `{{ PLACEHOLDERS }}` intact) so the create path
     * can render it with real values via `renderTaskTemplate`. When present,
     * `create()` uses template-as-skeleton rendering; when absent, creation
     * falls back to the legacy `buildTaskSkeleton` path.
     */
    resolveTemplate?: (variant: string) => string | undefined;
    /**
     * Resolve per-variant section-body overrides from the variant's template
     * file. Used by the legacy `buildTaskSkeleton` path (fallback when
     * `resolveTemplate` is absent) and by `batchCreate`. The caller (CLI)
     * owns file reading; returning `{}` (or omitting this) means matrix +
     * guidance only.
     */
    resolveTemplateBodies?: (variant: string) => Partial<Record<TaskSection, string>>;
    /**
     * Multi-folder configuration for WBS allocation. When absent, only
     * `tasksDir` is scanned. Mirrors the old rd3:tasks `config.jsonc` folders
     * model (global WBS uniqueness across all folders).
     */
    foldersConfig?: TaskFoldersConfig;
}

/** Job payload enqueued for async task actions. */
export interface TaskActionJob {
    wbs: string;
    action: string;
    command: string;
    channel?: string;
    skipDeps?: boolean;
}

/** Result returned by fulfillAction when a job is enqueued. */
export interface TaskActionResult {
    runId: string;
    action: string;
    status: 'queued';
}

/** Supported task workflow action names. */
export type TaskActionName = 'refine' | 'plan' | 'run' | 'verify' | 'decompose' | 'evaluate';

/** Action-to-slash-command table used by the task board action queue. */
export const TASK_ACTION_COMMANDS: Record<TaskActionName, (wbs: string) => string> = {
    refine: (wbs) => `/sp:dev-refine ${wbs} --auto`,
    plan: (wbs) => `/sp:dev-plan ${wbs} --auto`,
    run: (wbs) => `/sp:dev-run ${wbs} --auto`,
    verify: (wbs) => `/sp:dev-verify ${wbs} --auto`,
    decompose: (wbs) => `/sp:dev-plan "Decompose task ${wbs} into implementation subtasks" --auto`,
    evaluate: (wbs) => `/sp:dev-review ${wbs} --auto`,
};

function isTaskActionName(action: string): action is TaskActionName {
    return Object.hasOwn(TASK_ACTION_COMMANDS, action);
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

/**
 * Per-parent summary produced by `TaskService.batchCreate` (task 0178, F1/F2).
 * Surfaced alongside the children the batch created so the CLI can report which
 * parents were rostered / transitioned and what (if anything) failed.
 */
export interface ParentWireResult {
    /** Parent WBS. */
    wbs: string;
    /** True if the sub-task roster block was written (false on no-op / error). */
    rostered: boolean;
    /** New status after a successful transition, or `null` if the parent was not `todo`. */
    transitionedTo: string | null;
    /** Per-step error messages, empty when both steps succeeded. */
    errors: string[];
}

/** Filter options for the list verb. */
export interface TaskListFilters {
    status?: string;
    parentWbs?: string;
    /** Filter to tasks linked to this feature (the `feature_id` traceability edge). */
    featureId?: string;
    folder?: string;
    /** Legacy alias: 'phase' maps to status filter for backward compat. */
    phase?: string;
}

/**
 * Built-in section sets per creation status, used only when no Section-Status-
 * Matrix is injected (mirrors the shipped `tasks/section-matrix.yaml`
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

/**
 * Strip a redundant leading section header from `--from-file` body content (R1, task 0115).
 *
 * Agents naturally write a full section (`## Acceptance Criteria\n\n- [ ] AC1 …`) to the
 * temp file, but `--section` already names the section and the CLI supplies the canonical
 * heading. A leading heading line whose text matches `sectionName` (any level `#`–`######`,
 * case-insensitive) is therefore a duplicate — strip it and the blank lines that follow so
 * the body handed to `replaceSection` starts at the first real content line (no triple-newline
 * gap, no visual duplicate header). A heading that does NOT match the section name is left
 * alone — `replaceSection`'s same-level strip (R2) handles any phantom risk.
 */
function stripLeadingSectionHeader(body: string, sectionName: string): string {
    const match = body.match(/^(\s*)#{1,6}\s+(.+?)\s*(?:\n|$)/);
    if (match === null) return body;
    const headingText = (match[2] ?? '').trim();
    if (headingText.toLowerCase() !== sectionName.trim().toLowerCase()) return body;
    // Remove the heading line plus any leading whitespace and the blank lines after it.
    return body.slice(match[0].length).replace(/^\n+/, '');
}

// ─── Section bareness — used by pipeline steps to decide when to write ──

/**
 * Returns `true` if a named section is absent, empty/whitespace-only, guidance-comment-only,
 * or a known pipeline placeholder (the old `printf 'Pipeline run …'` stub).
 *
 * Used by the implement step (write `Solution` only when bare, never clobber
 * a hand-authored change-map) and the record step (backfill `Solution` safety-net,
 * skip `Testing`/`Review` if verify already populated them).
 */
export function sectionIsBare(doc: MarkdownDocument, name: string): boolean {
    if (!doc.hasSection(name)) return true;
    const body = doc.getSection(name);
    if (body === null) return true;
    const trimmed = body.replace(/<!--[\s\S]*?-->/g, '').trim();
    if (trimmed === '') return true;
    // Old pipeline placeholder: "Pipeline run <wbs> — …"
    if (/^Pipeline run \d{4}\b/.test(trimmed)) return true;
    return false;
}

/**
 * Render the placeholder body for a canonical task section — the one-line
 * guidance comment from `SECTION_GUIDANCE` wrapped in `<!-- ... -->`, matching
 * `buildTaskSkeleton`'s rendering (so `sections add` and `sections init`
 * produce the same artifact as `task create`). `History` (machine-owned) and
 * unknown sections render an empty body.
 */
function renderSectionGuidanceBody(name: TaskSection): string {
    const guidance = SECTION_GUIDANCE[name];
    if (guidance === undefined) return '';
    if (name === 'History') return '';
    return `<!-- ${guidance} -->`;
}

// ─── TaskService ────────────────────────────────────────────────────────

/** Core task verbs over PlanningWriteService and direct corpus reads. */
export class TaskService {
    private readonly ctx: TaskServiceContext;
    private readonly writeService: PlanningWriteService;
    private readonly locator: TaskLocator;

    constructor(ctx: TaskServiceContext) {
        this.ctx = ctx;
        this.writeService = ctx.writeService;
        this.locator = new TaskLocator(ctx);
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

            // ── template-as-skeleton path (preferred) ──
            const rawTemplate = this.ctx.resolveTemplate?.(variant);
            if (rawTemplate !== undefined) {
                const content = renderCreatedTaskContent({
                    rawTemplate,
                    name: params.title,
                    wbs,
                    background,
                    createdAt: now,
                    status,
                    variant,
                    featureId: params.featureId,
                    parentWbs: params.parentWbs,
                });
                const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder };
                return { ref, content };
            }

            // ── legacy buildTaskSkeleton fallback ──
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
            content: doc.bodyWithoutFrontmatter,
        };
    }

    // ── update (status transition) ──

    async updateStatus(wbs: string, toStatus: string, actor?: string): Promise<WriteResult> {
        const filePath = await this.resolveTaskFile(wbs);
        const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder: this.ctx.tasksDir };
        return this.writeService.transition(ref, toStatus, actor ?? this.ctx.actor ?? 'system');
    }

    // ── updateField (scalar frontmatter write) ──

    /**
     * Set a scalar frontmatter field on an existing task (e.g. `feature_id`,
     * `priority`). Closes the gap where these could only be set at `create` time.
     * The field allow-list keeps the surface narrow — status goes through the
     * lifecycle-guarded `updateStatus`, not here. The L1 schema still validates
     * the value after the write (e.g. an unknown priority is rejected).
     */
    async updateField(wbs: string, key: string, value: string): Promise<WriteResult> {
        // `done_forced` / `done_reason` are set by the CLI verdict-guard override
        // path (R3, task 0292) — they record an operator's explicit decision to
        // advance a non-PASS task to `done`. Status itself stays on `updateStatus`.
        const allowed: Record<string, true> = {
            feature_id: true,
            parent_wbs: true,
            priority: true,
            done_forced: true,
            done_reason: true,
        };
        if (!(key in allowed)) {
            throw new Error(`Field "${key}" is not settable via update; allowed: ${Object.keys(allowed).join(', ')}.`);
        }
        const filePath = await this.resolveTaskFile(wbs);
        const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder: this.ctx.tasksDir };
        return this.writeService.updateFrontmatter(ref, key, value);
    }

    // ── mutateDependencies (task 0303 — CLI-safe dependencies[] write) ──

    /**
     * Mutate the `dependencies[]` frontmatter array on an existing task.
     *
     * Operations (R1):
     * - `set`    — replace the entire array with `values` (may be empty)
     * - `add`    — append `values`, dedupe against existing entries
     * - `remove` — drop `values` (silently no-ops on absent entries)
     * - `clear`  — empty the array (`values` must be empty)
     *
     * Validation pipeline (R2, atomic — all checks run before any write):
     *   1. WBS format — every value matches `^\d{4}$`
     *   2. WBS existence — every value resolves to a sibling task file
     *   3. Self-edge — `values` must not contain the target `wbs`
     *   4. Duplicates — `values` itself must not contain duplicates
     *   5. Cycle detection — DFS over the resulting dependency graph
     *
     * On success, writes via `writeService.updateFrontmatterArray` (atomic,
     * schema-validated, emits `task.updated`). Throws `DependencyMutationError`
     * with a stable `code` for any validation failure — the CLI maps these to
     * exit codes.
     */
    async mutateDependencies(
        wbs: string,
        op: 'set' | 'add' | 'remove' | 'clear',
        values: string[] = [],
    ): Promise<WriteResult & { dependencies: string[] }> {
        if (op === 'clear') {
            if (values.length > 0) {
                throw new DependencyMutationError('usage', `clear takes no values; got ${values.length}`);
            }
        } else if (values.length === 0) {
            throw new DependencyMutationError('usage', `${op} requires at least one WBS value`);
        }

        // Load the current array (empty if the field is absent).
        const filePath = await this.resolveTaskFile(wbs);
        const current = await this.readDependencyArray(filePath);

        // Compute the next array per `op`.
        let next: string[];
        if (op === 'clear') {
            next = [];
        } else if (op === 'set') {
            next = [...values];
        } else if (op === 'add') {
            next = [...current];
            for (const v of values) {
                if (!next.includes(v)) next.push(v);
            }
        } else {
            // remove
            next = current.filter((v) => !values.includes(v));
        }

        // 1. WBS format.
        for (const v of next) {
            if (!/^\d{4}$/.test(v)) {
                throw new DependencyMutationError('format', `Not a 4-digit WBS: "${v}"`);
            }
        }

        // 2. WBS existence (each value must resolve to a sibling task file).
        for (const v of next) {
            const target = await this.findTaskFileName(v);
            if (target === null) {
                throw new DependencyMutationError('not-found', `No task file for WBS ${v}`);
            }
        }

        // 3. Self-edge.
        if (next.includes(wbs)) {
            throw new DependencyMutationError('self-edge', `Task ${wbs} cannot depend on itself`);
        }

        // 4. Duplicates (defensive — `add` dedupes, but `set` could carry them).
        if (new Set(next).size !== next.length) {
            throw new DependencyMutationError('duplicate', `Duplicate WBS in dependencies: ${next.join(', ')}`);
        }

        // 5. Cycle detection — DFS over the graph that *would* result.
        await this.assertNoCycle(wbs, next);

        const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder: this.ctx.tasksDir };
        const result = await this.writeService.updateFrontmatterArray(ref, 'dependencies', next);
        return { ...result, dependencies: next };
    }

    /**
     * CLI-safe mutation of canonical task sections (task 0304, R4-R6).
     *
     * Operations:
     * - `init`        — add every required section for the task's current status
     *                  that is not already present (idempotent; uses the shipped
     *                  guidance comment as the placeholder body, matching
     *                  `buildTaskSkeleton`).
     * - `add <name>`  — add a single canonical section (rejected if unknown, or
     *                  forbidden for the current status). Idempotent: a no-op when
     *                  the section is already present.
     * - `list`        — read-only: resolve the matrix entry for variant + status
     *                  and return `required`/`optional`/`forbidden`, `present`, and
     *                  `missing` (the required sections not yet in the file).
     *
     * Matrix enforcement (R5): section names are validated against
     * `TASK_CANONICAL_SECTIONS` (closed-world) and against the variant/status
     * matrix entry (`forbidden`). Universal sections (`History`, `References`,
     * `Notes`) are always allowed. All writes go through the existing
     * `planning-write-service.updateSection` pipeline — phantom-section guards,
     * atomic writes, history, and timestamps are inherited.
     *
     * Throws {@link SectionMutationError} with a stable `code` for any validation
     * failure; the CLI maps these to exit codes (2 for `usage`, 3 for the rest).
     */
    async mutateSections(
        wbs: string,
        op: 'init' | 'add' | 'list',
        sectionName?: string,
    ): Promise<SectionMutationResult> {
        if (op === 'add' && sectionName === undefined) {
            throw new SectionMutationError('usage', 'add requires a section name');
        }
        if (op !== 'add' && sectionName !== undefined) {
            throw new SectionMutationError('usage', `${op} takes no section name; got "${sectionName}"`);
        }

        const filePath = await this.resolveTaskFile(wbs);
        const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder: this.ctx.tasksDir };

        const raw = await this.ctx.fs.readFile(filePath);
        const doc = MarkdownDocument.parse(raw, 'task');
        const fm = doc.frontmatterData ?? {};
        const variant = typeof fm.template === 'string' ? fm.template : DEFAULT_TASK_VARIANT;
        const status = typeof fm.status === 'string' ? fm.status : 'backlog';

        const matrix = this.ctx.sectionMatrix;
        const entry = matrix?.variants[variant]?.[status] ?? matrix?.variants.standard?.[status];
        if (entry === undefined) {
            throw new SectionMutationError(
                'no-matrix',
                `No section matrix for variant "${variant}" status "${status}"`,
            );
        }
        const required = entry.required ?? [];
        const optional = entry.optional ?? [];
        const forbidden = entry.forbidden ?? [];
        const present = doc.sectionNames;

        if (op === 'list') {
            return {
                op: 'list',
                ref,
                variant,
                status,
                added: [],
                matrix: { required: [...required], optional: [...optional], forbidden: [...forbidden] },
                present,
                missing: required.filter((s) => !present.includes(s)),
                warnings: [],
            };
        }

        if (op === 'add') {
            const name = sectionName as string;
            if (
                !TASK_CANONICAL_SECTIONS.includes(name as TaskSection) &&
                !(UNIVERSAL_SECTIONS as readonly string[]).includes(name)
            ) {
                throw new SectionMutationError('unknown-section', `Unknown section: "${name}"`);
            }
            if (forbidden.includes(name)) {
                throw new SectionMutationError('forbidden', `Section "${name}" is forbidden for status "${status}"`);
            }
            if (present.includes(name)) {
                // No write happened, so no PlanningEvent was emitted — leave
                // `eventName` undefined rather than claiming one fired.
                return {
                    op: 'add',
                    ref,
                    variant,
                    status,
                    added: [],
                    warnings: [`Section "${name}" already present; no change`],
                };
            }
            const body = renderSectionGuidanceBody(name as TaskSection);
            const result = await this.writeService.updateSection(ref, name, body);
            return {
                op: 'add',
                ref,
                variant,
                status,
                added: [name],
                eventName: result.eventName,
                warnings: result.warnings ?? [],
            };
        }

        // op === 'init'
        const missing = required.filter((s) => !present.includes(s));
        if (missing.length === 0) {
            // No write happened — see the `add` no-op above.
            return {
                op: 'init',
                ref,
                variant,
                status,
                added: [],
                warnings: ['All required sections already present; no change'],
            };
        }
        // Each `updateSection` is individually atomic, but the set is not: a failure
        // part-way through leaves the earlier sections on disk. Batching them would
        // need a new write-pipeline kind, which D3 rules out — so instead report
        // exactly what landed, since `init` is idempotent and a re-run completes
        // the remainder. Without this the throw would discard that progress.
        const written: string[] = [];
        let last: WriteResult | undefined;
        for (const s of missing) {
            const body = renderSectionGuidanceBody(s as TaskSection);
            try {
                last = await this.writeService.updateSection(ref, s, body);
            } catch (err) {
                const landed = written.length > 0 ? written.join(', ') : '(none)';
                throw new Error(
                    `init failed while writing section "${s}"; sections already written: ${landed}. ` +
                        `Re-run init to complete the rest (it is idempotent). Cause: ${String(err)}`,
                );
            }
            written.push(s);
        }
        return {
            op: 'init',
            ref,
            variant,
            status,
            added: written,
            eventName: last?.eventName ?? 'task.updated',
            warnings: last?.warnings ?? [],
        };
    }

    /** Read the current `dependencies[]` array from a task file (empty if absent). */
    private async readDependencyArray(filePath: string): Promise<string[]> {
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

    /**
     * DFS cycle check: starting from `rootWbs`, walk the dependency graph that
     * *would* exist after writing `nextDeps` to `rootWbs`, and fail if the
     * traversal revisits `rootWbs` (a self-feeding cycle through any chain).
     */
    private async assertNoCycle(rootWbs: string, nextDeps: string[]): Promise<void> {
        const visiting = new Set<string>();
        const seen = new Set<string>();
        const stack: string[] = [...nextDeps];
        while (stack.length > 0) {
            const current = stack.pop();
            if (current === undefined) break;
            if (current === rootWbs) {
                throw new DependencyMutationError(
                    'cycle',
                    `Dependency cycle detected: ${rootWbs} -> ... -> ${rootWbs}`,
                );
            }
            if (seen.has(current)) continue;
            if (visiting.has(current)) continue;
            visiting.add(current);
            const found = await this.findTaskFileName(current);
            if (found !== null) {
                const deps = await this.readDependencyArray(found.filePath);
                for (const d of deps) {
                    if (!seen.has(d) && !visiting.has(d)) stack.push(d);
                }
            }
            seen.add(current);
        }
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
        if (!isTaskActionName(action)) {
            throw new Error(`Unsupported task action: ${action}`);
        }

        const runId = await enqueue({
            wbs,
            action,
            command: TASK_ACTION_COMMANDS[action](wbs),
            channel: options?.channel,
            skipDeps: options?.skipDeps,
        });
        return { runId, action, status: 'queued' };
    }

    // ── update (section from file) ──

    async updateSection(wbs: string, sectionName: string, sourceFile: string): Promise<WriteResult> {
        const filePath = await this.resolveTaskFile(wbs);
        const raw = await this.ctx.fs.readFile(sourceFile);
        const body = stripLeadingSectionHeader(raw, sectionName);
        const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder: this.ctx.tasksDir };
        return this.writeService.updateSection(ref, sectionName, body);
    }

    // ── record (pipeline result write-back) ──

    /**
     * Record pipeline results into the task file: Testing + Review from the
     * verify verdict, and optionally backfill Solution from `git diff`.
     *
     * Design: docs/tasks/0108 — the single verb that replaces the pipeline's
     * ~50 lines of embedded shell. Section bodies are generated by pure functions
     * (unit-testable), then written through `writeService.updateSection` (upsert,
     * no temp files). Optionally transitions status (never to `done` — that gate
     * stays in the workflow).
     */
    async record(wbs: string, opts: RecordOptions = {}): Promise<RecordResult> {
        const filePath = await this.resolveTaskFile(wbs);
        const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder: this.ctx.tasksDir };

        // Read the current document to check section bareness for Solution backfill.
        const raw = await this.ctx.fs.readFile(filePath);
        const doc = MarkdownDocument.parse(raw, 'task');

        // Resolve verdict path.
        const verdictPath = opts.verdictFile ?? `.spur/run/${wbs}-verdict.json`;
        const verdict = await readVerdict(this.ctx.fs, verdictPath, wbs);

        const result: RecordResult = {
            testingWritten: false,
            reviewWritten: false,
            solutionBackfilled: false,
        };

        // ── Testing section (R2) ──
        const testingBody = renderTesting(verdict);
        await this.writeService.updateSection(ref, 'Testing', testingBody);
        result.testingWritten = true;

        // ── Review section (R2) — preserve existing review content ──
        // The review agent writes a detailed SECU Review during the `review` step.
        // Only overwrite with the verdict-rendered summary when the section is bare
        // (absent/placeholder), matching the Solution safety-net pattern.
        if (sectionIsBare(doc, 'Review')) {
            const reviewBody = renderReview(verdict);
            await this.writeService.updateSection(ref, 'Review', reviewBody);
            result.reviewWritten = true;
        }

        // ── Solution safety-net (R3) ──
        if (opts.solutionFromDiff && sectionIsBare(doc, 'Solution')) {
            const diffText = gitDiffU0();
            const solutionBody = renderSolutionFromDiff(diffText);
            await this.writeService.updateSection(ref, 'Solution', solutionBody);
            result.solutionBackfilled = true;
        }

        // ── Optional transition (R4) ──
        if (opts.transition !== undefined) {
            const transitionResult = await this.writeService.transition(ref, opts.transition);
            result.transitionedTo = transitionResult.toStatus;
        }

        return result;
    }

    // ── batch-create ──

    /**
     * Atomically create a batch of tasks from a JSON file, then wire up their
     * parents (R11 / G11 — this doc previously duplicated {@link ParentWireResult}'s
     * comment instead of describing this method).
     *
     * Steps:
     * 1. Read `jsonPath` and parse it as JSON; parse/schema failures throw
     *    (`batch validation failed: ...` lists every `taskBatchSchema` issue).
     * 2. Create each item in array order via {@link createBatchItem} (which itself
     *    allocates a fresh WBS under the create-lock, race-safe).
     * 3. If any item fails mid-batch, best-effort delete every task file already
     *    created in this call (no partial batch is left on disk), then rethrow.
     * 4. Post-create wire-up (task 0178, F1/F2): for each distinct `parent_wbs`
     *    seen in the batch, refresh its sub-task roster and transition it
     *    `todo → wip` if applicable — see {@link wireUpParents}.
     *
     * @param jsonPath Path to a batch file matching `taskBatchSchema` (a bare
     *   array of `{name, background?, requirements?, feature_id?, parent_wbs?,
     *   priority?, tags?, template?}` items).
     * @returns `children` — one {@link WriteResult} per created task, in the same
     *   order as the input array. `parentsWired` — one {@link ParentWireResult}
     *   per distinct parent touched by the wire-up pass.
     */
    async batchCreate(jsonPath: string): Promise<{ children: WriteResult[]; parentsWired: ParentWireResult[] }> {
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

        const parentsWired = await this.wireUpParents(this.collectDistinctParents(items));
        return { children: writeResults, parentsWired };
    }

    /**
     * Distinct non-empty `parent_wbs` values from a validated batch, in first-seen
     * order. Skips `null` / `undefined` / empty-string — a childless top-level
     * task is fine. Used by `batchCreate` to know which parents need their roster
     * refreshed and lifecycle transitioned (F1/F2).
     */
    private collectDistinctParents(items: TaskBatchItem[]): string[] {
        const seen = new Set<string>();
        const ordered: string[] = [];
        for (const item of items) {
            const wbs = item.parent_wbs;
            if (typeof wbs !== 'string' || wbs === '') continue;
            if (seen.has(wbs)) continue;
            seen.add(wbs);
            ordered.push(wbs);
        }
        return ordered;
    }

    /**
     * Post-create wire-up pass. For each distinct parent in the batch:
     *   - refresh the sub-task roster (`refreshRoster` — idempotent, marker-delimited)
     *   - transition `todo → wip` if the parent is currently `todo` (F2; skip silently
     *     for every other status so a parent already `wip` or later is not re-noised)
     *
     * Best-effort per parent: a failure on one parent records an entry in the
     * returned `parentsWired` and the loop continues. Rolling children back when
     * a parent's wire-up fails would discard atomic-create success on a heuristic
     * guess; the children are already on disk and a follow-up `spur task
     * refresh-roster` / manual transition is the right escape hatch.
     */
    private async wireUpParents(parentWbsList: string[]): Promise<ParentWireResult[]> {
        const out: ParentWireResult[] = [];
        for (const wbs of parentWbsList) {
            const entry: ParentWireResult = { wbs, rostered: false, transitionedTo: null, errors: [] };
            try {
                const roster = await this.refreshRoster(wbs);
                entry.rostered = roster.written;
            } catch (err) {
                entry.errors.push(`refreshRoster: ${err instanceof Error ? err.message : String(err)}`);
            }
            try {
                const current = await this.show(wbs);
                if (current.status === 'todo') {
                    const filePath = await this.resolveTaskFile(wbs);
                    const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder: this.ctx.tasksDir };
                    const wr = await this.writeService.transition(ref, 'wip', 'system');
                    entry.transitionedTo = wr.toStatus ?? 'wip';
                } else {
                    entry.transitionedTo = null;
                }
            } catch (err) {
                entry.errors.push(`transition: ${err instanceof Error ? err.message : String(err)}`);
            }
            out.push(entry);
        }
        return out;
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

            // ── template-as-skeleton path (preferred) ──
            const rawTemplate = this.ctx.resolveTemplate?.(variant);
            if (rawTemplate !== undefined) {
                const content = renderCreatedTaskContent({
                    rawTemplate,
                    name: item.name,
                    wbs,
                    background,
                    createdAt: now,
                    status,
                    variant,
                    featureId: item.feature_id ?? undefined,
                    parentWbs: item.parent_wbs ?? undefined,
                    priority: item.priority,
                    tags: item.tags,
                    requirements: item.requirements,
                });
                const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder };
                return { ref, content };
            }

            // ── legacy buildTaskSkeleton fallback ──
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

    /**
     * Re-scan the task corpus and report counts. The generated `kanban.md` artifact
     * was retired (A17 cutover) once the web task-kanban board (task 0191) became the
     * daily driver — this verb no longer writes any file.
     */
    async refresh(): Promise<{ folders: number; tasks: number }> {
        const folders = this.allFolderDirs();

        let totalTasks = 0;
        for (const folder of folders) {
            const tasks = await this.list({ folder });
            totalTasks += tasks.length;
        }
        return { folders: folders.length, tasks: totalTasks };
    }

    // ── refresh-roster (0123) ──

    /**
     * Regenerate a decomposition parent's sub-task roster inside its `## Plan` —
     * the generator half of the 0121 roll-up gate (which only *warns* about a
     * missing/stale roster). One row per child task (WBS · title · status),
     * written between auto-gen markers so the block is idempotent.
     *
     * The block is delimited by `refresh-roster`-labeled markers and rewritten in
     * place each run (replacing any prior roster block, or appended when absent),
     * preserving the hand-written Plan content above it (R1/R2). Region handling is
     * done here rather than via `MarkdownDocument.replaceMarkerRegion` — that helper
     * normalizes the marker label to "spur feature refresh", which would mislabel a
     * task roster.
     *
     * A task with zero children is a clean no-op (writes nothing, R4). A task with
     * no `## Plan` section is an error — there is nowhere to host the roster.
     */
    async refreshRoster(wbs: string): Promise<{ wbs: string; childCount: number; written: boolean }> {
        const filePath = await this.resolveTaskFile(wbs);
        const kids = (await this.list())
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
                const featureId = (fm.feature_id as string | null) ?? undefined;

                if (filters?.status !== undefined && filters.status !== status) continue;
                if (filters?.parentWbs !== undefined && filters.parentWbs !== parentWbs) continue;
                if (filters?.featureId !== undefined && filters.featureId !== featureId) continue;
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

    /**
     * Resolve a file path to its owning task.
     *
     * Strategy 1 (always): exact match — the path IS a real corpus task file.
     * Strategy 2 (lenient, default): the basename alone encodes a known WBS, so a
     *   path anywhere (`/some/copy/0042_x.md`) resolves to corpus task 0042.
     *
     * `strict: true` disables Strategy 2. Use it when the question is "is this exact
     * path a protected corpus file?" (the write-guard) — a scratch file that merely
     * shares a `NNNN_` prefix (e.g. `/tmp/0103_design.md`) must NOT be claimed.
     */
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

    /** All registered task-folder directories as absolute paths. See {@link TaskLocator}. */
    private allFolderDirs(): readonly string[] {
        return this.locator.folderDirs();
    }

    private async allocateWbs(): Promise<string> {
        // Scan ALL configured folders for global WBS uniqueness (rd3:tasks model).
        // Falls back to tasksDir-only when foldersConfig is absent.
        let max = 0;
        const dirs = this.ctx.foldersConfig
            ? [...new Set([this.ctx.tasksDir, ...Object.keys(this.ctx.foldersConfig.folders)])]
            : [this.ctx.tasksDir];

        for (const dir of dirs) {
            const baseCounter = this.ctx.foldersConfig?.folders[dir]?.base_counter ?? 0;
            if (baseCounter > max) max = baseCounter;
            try {
                const entries = await this.ctx.fs.readDir(dir);
                for (const name of entries) {
                    const [, digits] = /^(\d{4})_.*\.md$/.exec(name) ?? [];
                    if (digits) {
                        const n = parseInt(digits, 10);
                        if (n > max) max = n;
                    }
                }
            } catch {
                /* folder may not exist yet */
            }
        }
        return String(max + 1).padStart(4, '0');
    }

    /** Resolve a WBS to its absolute file path. Returns `null` when not found. */
    async getFilePath(wbs: string): Promise<string | null> {
        const result = await this.findTaskFileName(wbs);
        if (!result) return null;
        return result.filePath;
    }

    private async resolveTaskFile(wbs: string): Promise<string> {
        const result = await this.findTaskFileName(wbs);
        if (!result) throw new Error(`Task ${wbs} not found in any registered task folder`);
        return result.filePath;
    }

    /** Search all registered task folders for the task file matching `wbs`. */
    private async findTaskFileName(wbs: string): Promise<{ name: string; filePath: string } | null> {
        return await this.locator.findByWbs(wbs);
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
        const root = this.ctx.fs.resolve('.');
        const candidate = this.ctx.fs.resolve(folder);
        const rel = relative(root, candidate);
        if (rel.startsWith('..') || isAbsolute(rel)) {
            throw new Error(`Invalid folder: ${folder} escapes the planning workspace`);
        }
        return candidate;
    }

    private slugify(title: string): string {
        return title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 60);
    }
}
