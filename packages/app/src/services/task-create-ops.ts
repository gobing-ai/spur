import {
    buildTaskSkeleton,
    DEFAULT_TASK_VARIANT,
    MarkdownDocument,
    normalizeAcFence,
    serializeTaskFrontmatter,
    type TaskBatchItem,
    type TaskSection,
    taskBatchSchema,
} from '@gobing-ai/spur-domain';
import type { CheckFindings } from './planning-check-base';
import type { EntityRef, PlanningWriteService, WriteResult } from './planning-write-service';
import { TaskCheckService } from './task-check';
import type { TaskFeatureLink } from './task-feature-link';
import type { TaskFiles } from './task-files';
import { bulletizeRequirements } from './task-section-bodies';
import { normalizeTaskSection } from './task-section-normalizer';
import type { ParentWireResult, TaskService, TaskServiceContext } from './task-service';
import { DuplicateFollowUpError, TaskCandidateInvalidError } from './task-service-errors';

/**
 * Resolved shape of a candidate task awaiting its WBS (F21 task 0787). Everything
 * create/batchCreate need to render the file, decided BEFORE the create lock so
 * content validation cannot race allocation. `fm` is the frontmatter OBJECT —
 * serialized at render time by `serializeTaskFrontmatter`, never hand-interpolated (R4).
 */
interface TaskCandidateShape {
    readonly variant: string;
    readonly status: string;
    readonly fm: Record<string, unknown>;
    readonly taskBodies: Partial<Record<TaskSection, string>>;
    /** 1132 R1: normalizations applied while resolving the bodies (reported via `--json`). */
    readonly normalized?: Array<{ section: string; kind: string; count: number }>;
}

/**
 * Synthetic WBS for candidate validation renders (F21 task 0787). No L1/L2/L3
 * content rule reads the wbs value (only the `## <wbs>. <title>` heading), so a
 * probe at `0000` is byte-equivalent for policy purposes to the final render.
 */
const CANDIDATE_PROBE_WBS = '0000';

/**
 * `spur task create` / `spur task batch-create` for {@link TaskService}: candidate shape
 * resolution and validation (F21 task 0787), duplicate follow-up detection, WBS allocation and
 * batch parent wiring.
 */
export class TaskCreateOps {
    constructor(
        private readonly host: TaskService,
        private readonly ctx: TaskServiceContext,
        private readonly writeService: PlanningWriteService,
        private readonly featureLink: TaskFeatureLink,
        private readonly files: TaskFiles,
    ) {}

    /**
     * Resolve which sections a newly created task carries for `status`, solely
     * from the Section-Status-Matrix (`required ∪ optional`, §3.2) — the SINGLE
     * semantic authority for creation layout (F92 R1). The variant resolves to
     * its own entry, falling back to the `standard` variant for unknown variants.
     * A missing matrix (or a missing entry for the status) is a hard error:
     * there is no hand-maintained creation fallback — a permissive default here
     * would make the same task render differently by installation layout and
     * defeat the SSOT. `History` is always appended (the machine-owned log).
     */
    private sectionsForStatus(variant: string, status: string): string[] {
        const matrix = this.ctx.sectionMatrix;
        if (matrix === undefined) {
            throw new Error(
                `no section-matrix available for create (variant=${variant}, status=${status}); ` +
                    'a canonical section-matrix.yaml is required for task creation (F92 R1)',
            );
        }
        const entry = matrix.variants[variant]?.[status] ?? matrix.variants.standard?.[status];
        if (entry === undefined) {
            throw new Error(
                `no section-matrix entry for variant="${variant}" status="${status}" during create; ` +
                    'resolve the canonical section-matrix.yaml',
            );
        }
        // Append the universal sections every task file structurally carries
        // (History — machine-appended log; References — the closed-world link
        // section present in every file, matching the shipped template scaffold).
        // These are structural/closed-world, not per-status section policy.
        return [...(entry.required ?? []), ...(entry.optional ?? []), 'References', 'History'];
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
                ? await this.host.list({ featureId })
                : (await this.host.list()).filter(
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

    // ── candidate construction + content-policy validation (F21 task 0787) ──

    /**
     * Resolve everything about a candidate that does not depend on the allocated
     * WBS: variant, task-specific bodies, Background, status, and the frontmatter
     * object (F21 task 0787 R2/R4).
     *
     * Background precedence: supplied → feature-derived → a capture line quoting
     * the title, so a bare record's REQUIRED Background is substantive provenance
     * rather than a placeholder the checker would have to reject.
     *
     * Status policy (R2): an explicit status wins; otherwise the candidate is
     * granted `todo` exactly when it passes the checker's own content policy
     * (L1+L2+L3, no L4) evaluated AS `todo` — "creation and checking agree" by
     * construction. Bare/partial captures stay `backlog` (§2.3: backlog = still
     * preparing, todo = ready to start).
     */
    private async resolveCandidateShape(input: {
        title: string;
        featureId?: string;
        parentWbs?: string;
        template?: string;
        explicitStatus?: string;
        background?: string;
        requirements?: string;
        design?: string;
        plan?: string;
        acceptanceCriteria?: string;
        priority?: string;
        tags?: string[];
        estimateHours?: number;
    }): Promise<TaskCandidateShape> {
        // A feature link defaults the variant to `feature-impl`; otherwise `standard`.
        // An explicit template always wins.
        const variant = input.template ?? (input.featureId !== undefined ? 'feature-impl' : DEFAULT_TASK_VARIANT);

        let background = input.background ?? '';
        if (background === '' && input.featureId !== undefined) {
            background = await this.deriveBackground(input.featureId);
        }

        const taskBodies: Partial<Record<TaskSection, string>> = {};
        const normalized: Array<{ section: string; kind: string; count: number }> = [];
        // 1132 R1 (review 2, P3): a normalization may imply frontmatter (gherkin-only AC ⇒
        // `ac_altitude`/`ac_numbering: task-local`). Carrying only `normalized` reported a change
        // that was never applied, so the DD-09 subset rule stayed armed and the `(req: Rn)`
        // coverage opt-in stayed off on the primary decomposition verb.
        let impliedFrontmatter: Record<string, string> = {};
        if (background !== '') taskBodies.Background = background;
        if ((input.requirements ?? '').trim() !== '') {
            // 1132 R1: batch-create normalizes loose requirement shapes at write time.
            const nb = normalizeTaskSection('Requirements', bulletizeRequirements(input.requirements ?? ''));
            taskBodies.Requirements = nb.body;
            normalized.push(...nb.normalized);
        }
        if ((input.design ?? '').trim() !== '') {
            taskBodies.Design = (input.design ?? '').trim();
        }
        if ((input.plan ?? '').trim() !== '') {
            taskBodies.Plan = (input.plan ?? '').trim();
        }
        if ((input.acceptanceCriteria ?? '').trim() !== '') {
            const nb = normalizeTaskSection(
                'Acceptance Criteria',
                normalizeAcFence((input.acceptanceCriteria ?? '').trim()),
            );
            taskBodies['Acceptance Criteria'] = nb.body;
            normalized.push(...nb.normalized);
            if (nb.frontmatter !== undefined) impliedFrontmatter = { ...impliedFrontmatter, ...nb.frontmatter };
        }
        if (taskBodies.Background === undefined) {
            taskBodies.Background = `Captured from the creation title: "${input.title}".`;
        }
        // A variant template's own Background body (e.g. review's
        // `#### Review Findings` input table) is INPUT seeded beneath the
        // capture line — the old create let it survive whenever no explicit
        // background overrode it, and template-as-skeleton keeps that. A
        // supplied/feature-derived background still wins outright.
        const templateBackground = this.ctx.resolveTemplateBodies?.(variant).Background;
        if (
            input.background === undefined &&
            input.featureId === undefined &&
            templateBackground !== undefined &&
            templateBackground.trim() !== ''
        ) {
            taskBodies.Background = `${taskBodies.Background}\n\n${templateBackground}`;
        }

        // created_at/updated_at are pre-formatted ISO strings captured once so the
        // probe render, the final render, and the persisted file carry identical
        // frontmatter (the read side parses them with the same yaml library).
        const now = new Date().toISOString();
        const fmFor = (status: string): Record<string, unknown> => ({
            schema_version: 1,
            name: input.title,
            status,
            template: variant,
            created_at: now,
            updated_at: now,
            ...impliedFrontmatter,
            ...(input.featureId !== undefined ? { feature_id: input.featureId } : {}),
            ...(input.parentWbs !== undefined ? { parent_wbs: input.parentWbs } : {}),
            ...(input.priority !== undefined ? { priority: input.priority } : {}),
            ...(input.tags !== undefined && input.tags.length > 0 ? { tags: input.tags } : {}),
            ...(input.estimateHours !== undefined ? { estimate_hours: input.estimateHours } : {}),
        });

        let status: string;
        if (input.explicitStatus !== undefined) {
            status = input.explicitStatus;
        } else {
            // Todo-eligibility probe (R2): render the candidate AS `todo` with the
            // synthetic probe WBS and let the checker's policy decide. A candidate
            // whose todo-required bodies (Background/AC/Design/Plan per the matrix)
            // are still placeholders is not implementation-ready → `backlog`.
            const probe = buildTaskSkeleton({
                wbs: CANDIDATE_PROBE_WBS,
                title: input.title,
                frontmatter: serializeTaskFrontmatter(fmFor('todo')),
                sections: this.sectionsForStatus(variant, 'todo'),
                bodies: this.bodiesFor(variant, taskBodies),
            });
            const probeFindings = this.checkCandidateContent(probe, CANDIDATE_PROBE_WBS, 'todo');
            status = probeFindings.some((f) => f.severity === 'error') ? 'backlog' : 'todo';
        }

        // 1132 R1: carry the normalizations applied while building the bodies so the CLI can
        // report them (`normalized`) — `create` and `batchCreate` both read this.
        return { variant, status, fm: fmFor(status), taskBodies, ...(normalized.length > 0 ? { normalized } : {}) };
    }

    /**
     * Run the shared content policy — L1 schema + L2 matrix + L3 format, the
     * same rules `spur task check` enforces, no L4 — over a candidate document
     * (F21 task 0787 R2). L4 needs the persisted file and real corpus edges, and
     * genuine missing-feature/dependency diagnostics must stay visible on the
     * persisted task rather than fail its creation.
     */
    private checkCandidateContent(raw: string, wbs: string, asStatus: string): CheckFindings[] {
        const matrix = this.ctx.sectionMatrix;
        if (matrix === undefined) {
            throw new Error(
                `no section-matrix available for candidate validation (status=${asStatus}); ` +
                    'a canonical section-matrix.yaml is required for task creation (F92 R1)',
            );
        }
        const checker = new TaskCheckService(this.ctx.fs, matrix);
        return checker.checkContentPolicy(raw, wbs, { asStatus }).findings;
    }

    /**
     * Render the full file content for a resolved candidate at `wbs`. The
     * frontmatter is serialized from the OBJECT via `serializeTaskFrontmatter`
     * (R4) — the yaml emitter and MarkdownDocument.parse share the library, so
     * quotes/backslashes/colons/newlines/Unicode in titles round-trip exactly.
     */
    private renderCandidate(title: string, wbs: string, shape: TaskCandidateShape): string {
        return buildTaskSkeleton({
            wbs,
            title,
            frontmatter: serializeTaskFrontmatter(shape.fm),
            sections: this.sectionsForStatus(shape.variant, shape.status),
            bodies: this.bodiesFor(shape.variant, shape.taskBodies),
        });
    }

    /**
     * Reject a candidate whose final content would fail `spur task check` BEFORE
     * any WBS allocation or file write (F21 task 0787 R2/R4). The probe render
     * uses the synthetic WBS — validated content and written content differ only
     * in the heading wbs, which no L1/L2/L3 rule reads.
     *
     * @throws {TaskCandidateInvalidError} carrying the error findings.
     */
    private validateCandidateOrThrow(title: string, shape: TaskCandidateShape): void {
        const probe = this.renderCandidate(title, CANDIDATE_PROBE_WBS, shape);
        const findings = this.checkCandidateContent(probe, CANDIDATE_PROBE_WBS, shape.status);
        if (findings.some((f) => f.severity === 'error')) {
            throw new TaskCandidateInvalidError(title, findings);
        }
    }

    /** Implementation of {@link TaskService.create} (see its doc comment for the contract). */
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
        const folder = this.ctx.tasksDir;

        // F21 task 0787 (R2): resolve the full candidate shape (variant, status,
        // bodies, frontmatter) and validate its content policy BEFORE the create
        // lock — a candidate that would fail `spur task check` is rejected before
        // any WBS allocation or file write.
        const shape = await this.resolveCandidateShape({
            title: params.title,
            featureId: params.featureId,
            parentWbs: params.parentWbs,
            template: params.template,
            explicitStatus: params.status,
        });
        this.validateCandidateOrThrow(params.title, shape);

        // 1132 R2: the parent-status link guard runs AFTER candidate validation and BEFORE the
        // write — a create that fails validation never touches the parent. It runs inside the
        // create lock, immediately after the dedupe refusal, so a refused duplicate also cannot
        // leave a `verifying` parent reopened: away from the lock the dedupe check would have to
        // run twice. A terminal parent still rejects before anything lands. Residual: an
        // allocation failure after this point can leave the parent reopened; that is an I/O
        // fault (WBS collision / disk), and re-running the create is the documented recovery.
        let featureReopened: WriteResult['featureReopened'];

        // WBS allocation + write run inside the create-lock so concurrent
        // creates cannot allocate the same number and clobber each other.
        const created = await this.writeService.createAllocated(folder, async () => {
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
            if (params.featureId !== undefined) {
                featureReopened = await this.featureLink.guardParentFeature(params.featureId, params.noReopen);
            }
            const slug = this.files.slugify(params.title);
            const { wbs, filePath } = await this.files.allocateWbsChecked(slug);

            const content = this.renderCandidate(params.title, wbs, shape);

            const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder };
            return { ref, content };
        });
        // 1132 R1/R2: surface normalizations recorded on the shape and the guarded
        // parent reopen without changing the write-service return contract.
        if (featureReopened === undefined && shape.normalized === undefined) return created;
        return {
            ...created,
            ...(featureReopened !== undefined ? { featureReopened } : {}),
            ...(shape.normalized !== undefined ? { normalized: shape.normalized } : {}),
        };
    }

    /** Implementation of {@link TaskService.batchCreate} (see its doc comment for the contract). */
    async batchCreate(jsonPath: string): Promise<{
        children: WriteResult[];
        parentsWired: ParentWireResult[];
        /** 1132 R2: parent features reopened to `active` so the batch links could proceed. */
        featureReopened: Array<WriteResult['featureReopened']>;
    }> {
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
        // F21 task 0787 (R2): resolve + content-validate EVERY candidate before
        // the first write — a batch with one invalid item leaves no task files
        // and performs no parent mutation. The write loop below only allocates
        // WBS and renders already-validated shapes; the rollback stays for I/O
        // failures (WBS collision, disk).
        const prepared: Array<{ item: TaskBatchItem; shape: TaskCandidateShape }> = [];
        for (const [index, item] of items.entries()) {
            const shape = await this.resolveCandidateShape({
                title: item.name,
                featureId: item.feature_id ?? undefined,
                parentWbs: item.parent_wbs ?? undefined,
                template: item.template,
                explicitStatus: undefined,
                background: item.background,
                requirements: item.requirements,
                design: item.design,
                plan: item.plan,
                acceptanceCriteria: item.acceptance_criteria,
                priority: item.priority,
                tags: item.tags,
                estimateHours: item.estimate_hours,
            });
            try {
                this.validateCandidateOrThrow(item.name, shape);
            } catch (err) {
                if (err instanceof TaskCandidateInvalidError) {
                    throw new TaskCandidateInvalidError(
                        item.name,
                        err.findings,
                        `batch item ${index + 1}/${items.length}`,
                    );
                }
                throw err;
            }
            prepared.push({ item, shape });
        }
        // 1132 R2 (review P4): the parent-status link guard covers batch-create too — the
        // origin defect was a batch runnable against a `verifying`/terminal parent, and it is
        // reachable through this verb as well. Two phases so a terminal parent on a LATER feature
        // cannot abort a batch whose earlier parent was already reopened: phase 1 rejects with
        // `noReopen` (terminal parents throw, nothing is reopened), phase 2 reopens the verifying
        // parents of the surviving set.
        const distinctFeatures = [
            ...new Set(
                prepared
                    .map(({ item }) => item.feature_id)
                    .filter((f): f is string => typeof f === 'string' && f !== ''),
            ),
        ];
        const parentStatuses = new Map<string, string | undefined>();
        for (const fid of distinctFeatures) {
            await this.featureLink.guardParentFeature(fid, true); // reject-only pass
            parentStatuses.set(fid, await this.featureLink.readParentFeatureStatus(fid));
        }
        const reopened: Array<WriteResult['featureReopened']> = [];
        for (const fid of distinctFeatures) {
            if (parentStatuses.get(fid) !== 'verifying') continue;
            reopened.push(await this.featureLink.guardParentFeature(fid));
        }
        const writeResults: WriteResult[] = [];
        const createdRefs: EntityRef[] = [];

        try {
            for (const { item, shape } of prepared) {
                const wr = await this.createBatchItem(item, shape);
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
        return { children: writeResults, parentsWired, featureReopened: reopened };
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
                const roster = await this.host.refreshRoster(wbs);
                entry.rostered = roster.written;
            } catch (err) {
                entry.errors.push(`refreshRoster: ${err instanceof Error ? err.message : String(err)}`);
            }
            try {
                const current = await this.host.show(wbs);
                if (current.status === 'todo') {
                    const filePath = await this.files.resolveTaskFile(wbs);
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

    private async createBatchItem(item: TaskBatchItem, shape: TaskCandidateShape): Promise<WriteResult> {
        const folder = this.ctx.tasksDir;

        // Allocate + write inside the create-lock (race-safe WBS allocation).
        // Content was resolved and content-validated up-front by batchCreate
        // (F21 task 0787 R2) — rendering here only stamps the real allocated WBS.
        const created = await this.writeService.createAllocated(folder, async () => {
            const slug = this.files.slugify(item.name);
            const { wbs, filePath } = await this.files.allocateWbsChecked(slug);

            const content = this.renderCandidate(item.name, wbs, shape);

            const ref: EntityRef = { kind: 'task', id: wbs, filePath, folder };
            return { ref, content };
        });
        // 1132 R1: report the write-time normalizations for this batch item.
        return shape.normalized !== undefined ? { ...created, normalized: shape.normalized } : created;
    }

    private async deriveBackground(featureId: string): Promise<string> {
        const featuresDir = this.featureLink.deriveFeaturesDir();
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
}
