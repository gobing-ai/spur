/**
 * TaskService — core task verbs over PlanningWriteService and direct corpus reads.
 *
 * Design §10, delivery §1.1. Read verbs never lock. Write verbs delegate to
 * PlanningWriteService. WBS allocation is race-safe under the create-lock.
 */

import { dirname, isAbsolute, join, relative } from 'node:path';
import type { TaskFolderEntry, TaskFoldersConfig } from '@gobing-ai/spur-config/loader';
import {
    atomicWriteAsync,
    buildTaskSkeleton,
    checkAcCoverage,
    type DbAdapter,
    DEFAULT_TASK_VARIANT,
    escapeYamlValue,
    MarkdownDocument,
    normalizeAcFence,
    parseChecklist,
    renderTaskTemplate,
    SECTION_GUIDANCE,
    stripAcFence,
    TASK_CANONICAL_SECTIONS,
    type TaskBatchItem,
    type TaskSection,
    taskBatchSchema,
    UNIVERSAL_SECTIONS,
} from '@gobing-ai/spur-domain';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { GuardDeniedError } from '../errors';
import { ensurePipelineRunLink, TASK_FORWARD_CHAIN } from './pipeline-run-link';
import type { SectionMatrix } from './planning-check-base';
import type { EntityRef, PlanningEventName, PlanningWriteService, WriteResult } from './planning-write-service';
import { hasSolutionFileLineCitation } from './task-check';
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
import { evaluateTaskSize } from './task-size-precheck';

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
 * - `invalid-solution` — explicit Solution update lacks a `file:line` citation → exit 3
 */
export class SectionMutationError extends Error {
    readonly code: 'usage' | 'no-matrix' | 'unknown-section' | 'forbidden' | 'invalid-solution';
    constructor(code: SectionMutationError['code'], message: string) {
        super(message);
        this.name = 'SectionMutationError';
        this.code = code;
    }
}

/**
 * Error thrown by `create()` when the dedup guard (task 0341 R4) detects an
 * existing task under the same feature with an identical name created within
 * the dedupe window. The CLI maps this to a stable exit code and surfaces the
 * existing WBS so the operator can reuse the prior task instead of duplicating.
 */
export class DuplicateFollowUpError extends Error {
    readonly existingWbs: string;
    readonly existingName: string;
    readonly attemptedName: string;
    constructor(existingWbs: string, existingName: string, attemptedName: string) {
        super(
            `duplicate-follow-up: task ${existingWbs} ("${existingName}") already exists under this feature ` +
                `with an identical name. Reuse ${existingWbs} or pass --allow-duplicate-name to override.`,
        );
        this.name = 'DuplicateFollowUpError';
        this.existingWbs = existingWbs;
        this.existingName = existingName;
        this.attemptedName = attemptedName;
    }
}

/**
 * Error thrown by the WBS allocation guard (task 0416 R1) when a file with the
 * allocated WBS prefix already exists in any configured folder. The allocation
 * scan returned a stale maximum (e.g. a file was created after the scan but
 * before the write, or the scan missed a non-conventional filename). The guard
 * refuses to write rather than silently overwriting the existing file.
 *
 * The CLI maps this to a non-zero exit and surfaces both paths so the operator
 * can see what would have been overwritten.
 */
export class WbsCollisionError extends Error {
    readonly wbs: string;
    readonly existingPath: string;
    readonly attemptedPath: string;
    constructor(wbs: string, existingPath: string, attemptedPath: string) {
        super(
            `wbs-collision: WBS ${wbs} already exists at "${existingPath}". ` +
                `Refusing to overwrite with "${attemptedPath}". ` +
                `Re-run create; if the collision persists, inspect the corpus with: spur task check.`,
        );
        this.name = 'WbsCollisionError';
        this.wbs = wbs;
        this.existingPath = existingPath;
        this.attemptedPath = attemptedPath;
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
    design?: string;
    plan?: string;
    acceptanceCriteria?: string;
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
    const sectionPatches: Partial<Record<TaskSection, string>> = {};
    if ((params.requirements ?? '').trim() !== '') {
        sectionPatches.Requirements = bulletizeRequirements(params.requirements ?? '');
    }
    if ((params.design ?? '').trim() !== '') {
        sectionPatches.Design = (params.design ?? '').trim();
    }
    if ((params.plan ?? '').trim() !== '') {
        sectionPatches.Plan = (params.plan ?? '').trim();
    }
    if ((params.acceptanceCriteria ?? '').trim() !== '') {
        sectionPatches['Acceptance Criteria'] = normalizeAcFence((params.acceptanceCriteria ?? '').trim());
    }
    if (Object.keys(sectionPatches).length > 0) {
        const doc = MarkdownDocument.parse(content, 'task');
        for (const [section, body] of Object.entries(sectionPatches)) {
            doc.replaceSection(section as TaskSection, body);
        }
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
     * Lazily resolves the DB adapter, used by {@link TaskService.record} to
     * auto-create a pipeline run-link when a PASS verdict transitions to
     * `done` (R4 — removes the provenance-gate bookkeeping stall). When
     * omitted, record skips run-link creation; a lifecycle adapter that is
     * present will then surface its own provenance denial.
     */
    getDb?: () => Promise<DbAdapter>;
    /**
     * Called after a successful transition to `done` (feature E3). Must not throw
     * into the status write — the completion hook is best-effort.
     */
    onTaskReachedDone?: (wbs: string) => Promise<void>;
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
/**
 * Core task service: task lifecycle verbs (create, read, update, verify, status)
 * over {@link PlanningWriteService} with direct corpus reads for locators and
 * status transitions.
 */
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

    /**
     * Find an existing task with a name matching `title` (case-insensitive) created
     * within the last `withinSec` seconds, scoped to the same collision scope as the
     * create: a feature-scoped create matches tasks under the same `featureId`; an
     * unscoped create matches tasks with no `feature_id`.
     * Returns the matching task's WBS+name, or null if no collision.
     *
     * Used by the dedup guard (task 0341 R4, extended to unscoped creates) to prevent
     * re-creating the same task (double follow-up, or a retried create after a
     * misread `--json` envelope).
     */
    private async findDuplicateFollowUp(
        featureId: string | undefined,
        title: string,
        withinSec: number,
    ): Promise<{ wbs: string; name: string } | null> {
        const siblings =
            featureId !== undefined
                ? await this.list({ featureId })
                : (await this.list()).filter(
                      (t) => ((t.frontmatter?.feature_id as string | null | undefined) ?? undefined) === undefined,
                  );
        const now = Date.now();
        const lowerTitle = title.toLowerCase();
        for (const t of siblings) {
            if ((t.name ?? '').toLowerCase() !== lowerTitle) continue;
            const createdAt = t.frontmatter?.created_at;
            if (typeof createdAt !== 'string') continue;
            const createdMs = Date.parse(createdAt);
            if (Number.isNaN(createdMs)) continue;
            const ageSec = (now - createdMs) / 1000;
            if (ageSec >= 0 && ageSec <= withinSec) {
                return { wbs: t.wbs, name: t.name };
            }
        }
        return null;
    }

    // ── create ──

    async create(params: {
        title: string;
        featureId?: string;
        parentWbs?: string;
        status?: string;
        template?: string;
        actor?: string;
        /**
         * Dedup window in seconds. Defaults to 300 seconds for every create —
         * feature-scoped or unscoped. Pass null to disable the guard. When enabled,
         * refuse creation if an existing task in the same collision scope (same
         * `featureId`, or no `feature_id` for unscoped creates) has an identical
         * (case-insensitive) name and was created within the last N seconds.
         * Guards against the verify fix pass double-creating the same follow-up
         * (task 0341 R4) and against a retried create after a misread `--json`
         * envelope (task 0510 post-mortem).
         */
        dedupeWithinSec?: number | null;
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
            // Dedup guard (task 0341 R4, extended to unscoped creates): when a dedupe
            // window is requested, refuse creation if an existing task in the same
            // collision scope (same feature, or no feature for unscoped creates) has
            // an identical (case-insensitive) name created within the window. Guards
            // against double-creating follow-ups and retried creates after a misread
            // `--json` envelope.
            const dedupeWithinSec = params.dedupeWithinSec === null ? undefined : (params.dedupeWithinSec ?? 300);
            if (dedupeWithinSec !== undefined) {
                const collision = await this.findDuplicateFollowUp(params.featureId, params.title, dedupeWithinSec);
                if (collision !== null) {
                    throw new DuplicateFollowUpError(collision.wbs, collision.name, params.title);
                }
            }
            const slug = this.slugify(params.title);
            const { wbs, filePath } = await this.allocateWbsChecked(slug);

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
        const result = await this.writeService.transition(ref, toStatus, actor ?? this.ctx.actor ?? 'system');
        if (toStatus === 'done' && result.toStatus === 'done') {
            try {
                await this.ctx.onTaskReachedDone?.(wbs);
            } catch {
                // Refresh enqueue must not fail a completed status transition.
            }
        }
        return result;
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
        // `ac_numbering` opts a task into the L3 Requirements↔AC coverage check. It is
        // settable post-create because the templates only ship it on NEW tasks — without
        // this, a task authored before the standard could never adopt it. Opting in is
        // safe for traceability: `normalizeTitle` strips the `R\d+` prefix before DD-09
        // matching, so renumbering AC scenarios cannot break feature coverage.
        const allowed: Record<string, true> = {
            feature_id: true,
            parent_wbs: true,
            priority: true,
            done_forced: true,
            done_reason: true,
            ac_numbering: true,
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
        // R1 (0510): an explicit Solution update must carry a recognized `file:line`
        // citation. Reject before any write so an invalid authored Solution never lands
        // on disk for a later lifecycle check to reject — the same predicate the L3
        // checker uses, so write-time and `task check` behavior cannot drift. The write
        // service is never reached, so file content, `updated_at`, and history are
        // unchanged. Placeholder creation via task templates / `sections init` uses the
        // `writeService.updateSection` path directly and is unaffected.
        if (sectionName === 'Solution' && !hasSolutionFileLineCitation(body)) {
            throw new SectionMutationError(
                'invalid-solution',
                'Solution must contain at least one `file:line` citation',
            );
        }
        const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder: this.ctx.tasksDir };
        const result = await this.writeService.updateSection(ref, sectionName, body);

        if (sectionName === 'Acceptance Criteria') {
            const warnings = await this.checkAcSubsetWarning(filePath, body);
            if (warnings.length > 0) {
                return {
                    ...result,
                    warnings: [...(result.warnings ?? []), ...warnings],
                };
            }
        }

        // 0575 R1: authoring-time size warning — re-run the same evaluation the
        // pipeline precheck uses, at the moment an oversize is authored. Counts
        // the whole post-write body (a Plan write must still see the file's
        // R-items). Advisory only: the write above has already landed, and the
        // reasons ride the existing `warnings[]` channel (stderr in human mode,
        // inside the payload under `--json`) with no CLI change.
        if (sectionName === 'Requirements' || sectionName === 'Plan') {
            const report = evaluateTaskSize(await this.ctx.fs.readFile(filePath));
            if (!report.ok) {
                return {
                    ...result,
                    warnings: [...(result.warnings ?? []), ...report.reasons],
                };
            }
        }

        return result;
    }

    /**
     * R3 (0479): DD-09 subset warning on section write.
     * When writing Acceptance Criteria, warn if task scenarios are not a subset of feature AC.
     *
     * Honors the declared `ac_altitude` (task 0584 R3/R4) exactly as `task check` does. This is
     * the SECOND surface that enforces DD-09 — if only the checker honored the field, an author
     * who correctly declared `task-local` would still be warned every time they wrote their AC,
     * which is the notation-switching pressure 0584 exists to remove.
     */
    private async checkAcSubsetWarning(taskFilePath: string, acBody: string): Promise<string[]> {
        try {
            const raw = await this.ctx.fs.readFile(taskFilePath);
            const doc = MarkdownDocument.parse(raw, 'task');
            const fm = doc.frontmatterData ?? {};
            const featureId = (fm.feature_id as string | undefined) ?? (fm['feature-id'] as string | undefined);
            if (!featureId || featureId.length === 0) return [];

            const tasksDir = dirname(taskFilePath);
            const featuresDir = join(tasksDir, '..', 'features');
            // Feature files are named `<id>_<slug>.md` (e.g. `H1_spur-dev-skill.md`), so resolve by
            // prefix scan — matching `task-check.ts` findFeatureFile. Probing `<id>_feature.md` /
            // `<id>.md` never matches a real file and silently disabled this warning (0479 R3).
            const featurePath = await (async (): Promise<string | null> => {
                try {
                    for (const name of await this.ctx.fs.readDir(featuresDir)) {
                        if (name.startsWith(`${featureId}_`) && name.endsWith('.md')) {
                            return `${featuresDir}/${name}`;
                        }
                    }
                } catch {
                    // Directory missing or unreadable — no warning to emit.
                }
                return null;
            })();
            if (featurePath === null) return [];

            const featureRaw = await this.ctx.fs.readFile(featurePath);
            const featureDoc = MarkdownDocument.parse(featureRaw, 'feature');
            const featureAc = stripAcFence(featureDoc.getSection('Acceptance Criteria') ?? '');
            if (!featureAc.trim()) return [];

            const taskAc = stripAcFence(acBody);
            const taskChecklist = parseChecklist(taskAc);
            const acAltitude = fm.ac_altitude as 'graduating' | 'task-local' | undefined;
            const coverage = checkAcCoverage(featureAc, taskAc, taskChecklist, acAltitude);

            const warnings: string[] = [];
            for (const scenario of coverage.uncovered) {
                warnings.push(`Task scenario "${scenario}" is not in feature "${featureId}"'s AC (DD-09 subset rule)`);
            }
            return warnings;
        } catch {
            return [];
        }
    }

    // ── record (pipeline result write-back) ──

    /**
     * Record pipeline results into the task file: Testing + Review from the
     * verify verdict, and optionally backfill Solution from `git diff`.
     *
     * Design: docs/tasks/0108 — the single verb that replaces the pipeline's
     * ~50 lines of embedded shell. Section bodies are generated by pure functions
     * (unit-testable), then written through `writeService.updateSection` (upsert,
     * no temp files). Optionally transitions status — a `done` target with a PASS
     * verdict auto-walks the forward FSM chain and auto-creates the pipeline
     * run-link (task 0436 R4).
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
        // A request to transition to `done` auto-walks the forward FSM chain
        // (`wip → testing → done`) when the verify verdict is PASS, and
        // auto-creates the pipeline run-link the provenance gate requires —
        // **only immediately before the hop to `done`**, never before earlier
        // hops (avoids a stranded pipeline link when `wip→testing` fails).
        // A non-PASS verdict surfaces a single clear error instead of a
        // confusing multi-hop denial. Mid-walk hop failures rethrow with the
        // status reached so far (FSM per-hop atomicity; no silent rollback).
        if (opts.transition !== undefined) {
            const target = opts.transition;
            const current = ((doc.frontmatterData?.status as string | undefined) ?? '').toLowerCase();

            if (current === target) {
                // Already there — idempotent no-op (avoids an invalid self-transition).
                result.transitionedTo = current;
            } else if (target === 'done') {
                if (verdict.verdict !== 'PASS') {
                    throw new GuardDeniedError(
                        `Cannot transition task ${wbs} to done: verify verdict is ${verdict.verdict}, not PASS. ` +
                            `Re-run the pipeline to a PASS verdict, or use ` +
                            `\`spur task update ${wbs} done --force-done --reason "<why>"\` to override.`,
                    );
                }
                const startIdx = TASK_FORWARD_CHAIN.indexOf(current);
                const targetIdx = TASK_FORWARD_CHAIN.indexOf(target);
                if (startIdx !== -1 && targetIdx !== -1 && targetIdx > startIdx) {
                    // Walk each forward hop so the lifecycle FSM's per-step guards
                    // (e.g. `wip→testing` / `testing→done`) evaluate in order.
                    let reached = current;
                    for (let i = startIdx + 1; i <= targetIdx; i += 1) {
                        const hop = TASK_FORWARD_CHAIN[i] as string;
                        // Provenance is required only for the hop *to* done.
                        if (hop === 'done') {
                            await this.ensurePipelineRunLink(wbs);
                        }
                        try {
                            const hopResult = await this.writeService.transition(ref, hop);
                            reached = hopResult.toStatus ?? hop;
                            result.transitionedTo = reached;
                        } catch (err) {
                            const msg = err instanceof Error ? err.message : String(err);
                            throw new GuardDeniedError(
                                `Record auto-walk for task ${wbs} stopped at '${reached}' ` +
                                    `(failed hop → '${hop}'): ${msg}. ` +
                                    `Re-run \`spur task record ${wbs} --transition done\` once the guard is green.`,
                            );
                        }
                    }
                } else {
                    // Outside the forward chain (e.g. cancelled/blocked) — single hop;
                    // the lifecycle FSM's own guard governs acceptance/denial.
                    await this.ensurePipelineRunLink(wbs);
                    const transitionResult = await this.writeService.transition(ref, target);
                    result.transitionedTo = transitionResult.toStatus;
                }
            } else {
                const transitionResult = await this.writeService.transition(ref, target);
                result.transitionedTo = transitionResult.toStatus;
            }
        }

        return result;
    }

    /**
     * Ensure a `pipeline` provenance run-link exists for the task so the
     * lifecycle adapter's `to === 'done'` provenance gate passes (task 0436 R4).
     * Delegates to the shared {@link ensurePipelineRunLink} helper. No-op when
     * the context has no DB access.
     */
    private async ensurePipelineRunLink(wbs: string): Promise<void> {
        const getDb = this.ctx.getDb;
        if (getDb === undefined) return;
        const db = await getDb();
        await ensurePipelineRunLink(db, wbs);
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
     *   array of `{name, background?, requirements?, design?, plan?,
     *   acceptance_criteria?, feature_id?, parent_wbs?, priority?, tags?,
     *   template?}` items).
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

        // A batch item with a real spec (background/requirements/design/plan/AC) is
        // ready to execute → 'todo'; otherwise 'backlog' (§2.3 semantics).
        const hasSpec =
            background !== '' ||
            (item.requirements ?? '').trim() !== '' ||
            (item.design ?? '').trim() !== '' ||
            (item.plan ?? '').trim() !== '' ||
            (item.acceptance_criteria ?? '').trim() !== '';
        const status = hasSpec ? 'todo' : 'backlog';

        // Explicit item template wins; a feature link defaults to `feature-impl`, else `standard`.
        const variant =
            item.template ??
            (item.feature_id !== undefined && item.feature_id !== null ? 'feature-impl' : DEFAULT_TASK_VARIANT);

        // Allocate + write inside the create-lock (race-safe WBS allocation).
        return this.writeService.createAllocated(folder, async () => {
            const slug = this.slugify(item.name);
            const { wbs, filePath } = await this.allocateWbsChecked(slug);

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
                    design: item.design,
                    plan: item.plan,
                    acceptanceCriteria: item.acceptance_criteria,
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
            if ((item.design ?? '').trim() !== '') {
                taskBodies.Design = (item.design ?? '').trim();
            }
            if ((item.plan ?? '').trim() !== '') {
                taskBodies.Plan = (item.plan ?? '').trim();
            }
            if ((item.acceptance_criteria ?? '').trim() !== '') {
                taskBodies['Acceptance Criteria'] = normalizeAcFence((item.acceptance_criteria ?? '').trim());
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

    /**
     * Allocate a WBS and verify no file with that prefix already exists (task
     * 0416 R1/R2). The guard lives at the allocation seam so both `create()`
     * and `createBatchItem()` inherit it and a new caller cannot bypass it.
     * Reuses `locator.findByWbs` rather than adding a second directory walk.
     *
     * @throws {WbsCollisionError} when a file with the allocated WBS prefix exists.
     */
    private async allocateWbsChecked(slug: string): Promise<{ wbs: string; filePath: string }> {
        const wbs = await this.allocateWbs();
        const existing = await this.locator.findByWbs(wbs);
        if (existing !== null) {
            throw new WbsCollisionError(wbs, existing.filePath, this.resolveTaskPath(wbs, slug));
        }
        return { wbs, filePath: this.resolveTaskPath(wbs, slug) };
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
