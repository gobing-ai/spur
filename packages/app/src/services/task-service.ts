import type { TaskFolderEntry, TaskFoldersConfig } from '@gobing-ai/spur-config/loader';
import type { DbAdapter, TaskSection } from '@gobing-ai/spur-domain';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import type { SectionMatrix } from './planning-check-base';
import type { EntityRef, PlanningEventName, PlanningWriteService, WriteResult } from './planning-write-service';
import { TaskFeatureLink } from './task-feature-link';
import { TaskFiles } from './task-files';
import { TaskLocator } from './task-locator';
import type { RecordOptions, RecordResult } from './task-record';

export { featuresDirFor } from './task-feature-link';

import { TaskCreateOps } from './task-create-ops';
import { TaskQueryOps } from './task-query-ops';
import { TaskRecordOps } from './task-record-ops';
import { TaskUpdateOps } from './task-update-ops';

export { sectionIsBare } from './task-section-bodies';
export {
    DependencyMutationError,
    DuplicateFollowUpError,
    ParentFeatureStatusError,
    SectionMutationError,
    TaskCandidateInvalidError,
    WbsCollisionError,
} from './task-service-errors';

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
    /**
     * Features folder path (`features.dir` from config). Omitted → the sibling
     * `features/` directory of {@link tasksDir} (see `featuresDirFor`). Callers that
     * resolve planning folders must pass it: the sibling heuristic only holds for the
     * default `docs/tasks`-style layout, not for a phase folder like `docs/tasks5`.
     */
    featuresDir?: string;
    /**
     * 1132 R2: reopen a feature through ITS OWN lifecycle FSM. Required on every surface
     * that can write a feature: the feature profile declares the `verifying → active`
     * edge, while this service's write service carries the TASK profile, whose FSM has no
     * `verifying` state at all — reusing it for a feature transition fails with
     * `FSMError: … undeclared state "verifying"`. Omitted → {@link TaskService}'s own
     * FeatureService (a caller that resolved neither, e.g. a bare service test).
     */
    featureTransition?: (id: string, to: string) => Promise<{ fromStatus?: string; toStatus?: string } | undefined>;
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
     * Section-Status-Matrix — the SOLE semantic authority for which sections a
     * newly created task carries for its creation status (§3.2, F92). Creation
     * always resolves the matrix entry and builds through `buildTaskSkeleton`;
     * there is no hand-maintained creation fallback (fails loudly on a missing
     * entry — see {@link sectionsForStatus}).
     */
    sectionMatrix?: SectionMatrix;
    /**
     * Resolve per-variant section-body overrides from the variant's template
     * file (e.g. `review`'s P1–P4 table). Templates supply BODY content + guidance
     * only — the heading list always comes from the matrix via `buildTaskSkeleton`
     * (F92 R1). The caller (CLI) owns file reading; returning `{}` (or omitting
     * this) means matrix + guidance only.
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
    private readonly files: TaskFiles;
    private readonly featureLink: TaskFeatureLink;
    private readonly createOps: TaskCreateOps;
    private readonly updateOps: TaskUpdateOps;
    private readonly recordOps: TaskRecordOps;
    private readonly queryOps: TaskQueryOps;

    constructor(ctx: TaskServiceContext) {
        this.ctx = ctx;
        this.writeService = ctx.writeService;
        this.locator = new TaskLocator(ctx);
        this.files = new TaskFiles(this.ctx, this.locator);
        this.featureLink = new TaskFeatureLink(this.ctx, this.writeService);
        this.createOps = new TaskCreateOps(this, this.ctx, this.writeService, this.featureLink, this.files);
        this.updateOps = new TaskUpdateOps(this.ctx, this.writeService, this.files, this.featureLink);
        this.recordOps = new TaskRecordOps(this, this.ctx, this.writeService, this.featureLink, this.files);
        this.queryOps = new TaskQueryOps(this, this.ctx, this.locator, this.files);
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
        /**
         * 1132 R2: keep today's behavior when the parent feature is `verifying` —
         * accept the link WITHOUT reopening the feature to `active`. Default (off)
         * reopens via the guarded FeatureService.transition and reports it.
         */
        noReopen?: boolean;
    }): Promise<WriteResult> {
        return this.createOps.create(params);
    }

    // ── show ──

    async show(wbs: string): Promise<TaskShowResult> {
        return this.queryOps.show(wbs);
    }

    // ── update (status transition) ──

    async updateStatus(wbs: string, toStatus: string, actor?: string): Promise<WriteResult> {
        return this.updateOps.updateStatus(wbs, toStatus, actor);
    }

    // ── updateField (scalar frontmatter write) ──

    /**
     * Set a scalar frontmatter field on an existing task (e.g. `feature_id`,
     * `priority`). Closes the gap where these could only be set at `create` time.
     * The field allow-list keeps the surface narrow — status goes through the
     * lifecycle-guarded `updateStatus`, not here. The L1 schema still validates
     * the value after the write (e.g. an unknown priority is rejected).
     */
    /**
     * Set a task's `assignee` (1078 R2). Deliberately OUTSIDE {@link updateField}'s allow-list:
     * assignment has one validated caller (`spur task assign`) and its own `task.assigned` event,
     * so widening the public `--field` surface for it would add a second write path for no gain.
     * Same atomic frontmatter write and same write-service path as `updateField`.
     */
    async assign(wbs: string, agentId: string): Promise<WriteResult> {
        return this.updateOps.assign(wbs, agentId);
    }

    async updateField(wbs: string, key: string, value: string, noReopen?: boolean): Promise<WriteResult> {
        return this.updateOps.updateField(wbs, key, value, noReopen);
    }

    /**
     * Add/remove entries of the `tags[]` frontmatter array. Tags carry operator
     * authorization (GTD dispatches only `fleet:auto` tasks), so they need a
     * CLI-gated writer like every other corpus field. Adds dedupe, removes
     * no-op on absent tags, other tags keep their order.
     */
    async updateTags(wbs: string, add: string[], remove: string[]): Promise<WriteResult & { tags: string[] }> {
        return this.updateOps.updateTags(wbs, add, remove);
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
     *   6. Deprecated target — a *new* edge onto a `deprecated` task is refused (ADR-137)
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
        return this.updateOps.mutateDependencies(wbs, op, values);
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
        return this.updateOps.mutateSections(wbs, op, sectionName);
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
        return this.updateOps.updateBody(wbs, body, _actor);
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
        await this.files.resolveTaskFile(wbs);
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

    async updateSection(wbs: string, sectionName: string, sourceFile: string, append = false): Promise<WriteResult> {
        return this.updateOps.updateSection(wbs, sectionName, sourceFile, append);
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
        return this.recordOps.record(wbs, opts);
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
     *   template?, estimate_hours?}` items).
     * @returns `children` — one {@link WriteResult} per created task, in the same
     *   order as the input array. `parentsWired` — one {@link ParentWireResult}
     *   per distinct parent touched by the wire-up pass.
     */
    async batchCreate(jsonPath: string): Promise<{
        children: WriteResult[];
        parentsWired: ParentWireResult[];
        /** 1132 R2: parent features reopened to `active` so the batch links could proceed. */
        featureReopened: Array<WriteResult['featureReopened']>;
    }> {
        return this.createOps.batchCreate(jsonPath);
    }

    // ── refresh ──

    /**
     * Re-scan the task corpus and report counts. The generated `kanban.md` artifact
     * was retired (A17 cutover) once the web task-kanban board (task 0191) became the
     * daily driver — this verb no longer writes any file.
     */
    async refresh(): Promise<{ folders: number; tasks: number }> {
        return this.queryOps.refresh();
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
        return this.queryOps.refreshRoster(wbs);
    }

    // ── list ──

    async list(filters?: TaskListFilters): Promise<TaskSummary[]> {
        return this.queryOps.list(filters);
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
        return this.queryOps.resolve(filePath, opts);
    }

    /** Resolve a WBS to its absolute file path. Returns `null` when not found. */
    async getFilePath(wbs: string): Promise<string | null> {
        return this.queryOps.getFilePath(wbs);
    }
}
