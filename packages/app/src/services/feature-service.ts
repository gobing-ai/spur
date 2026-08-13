/**
 * FeatureService — core feature verbs over PlanningWriteService and direct corpus reads.
 *
 * Design §2.2/§2.4, delivery §1.1. Features use position-encoding hierarchical IDs
 * (DD-14): single-letter top-level nodes, children append one digit per level.
 * Parent is derived by dropping the last character.
 */

import { acquireCreateLock, atomicWriteAsync, MarkdownDocument } from '@gobing-ai/spur-domain';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import {
    type CheckFeatureFindings,
    defaultVerdictRunDir,
    FeatureCheckService,
    findOtherP0InStatus,
} from './feature-check';
import type { EntityRef, PlanningWriteService, WriteResult } from './planning-write-service';
import { TaskLocator } from './task-locator';

/** A task row rendered into a feature's `## Tasks` table. */
interface TaskRow {
    wbs: string;
    name: string;
    status: string;
}

/** Proposal returned by `deriveFeatureStatus`. */
export interface FeatureSyncProposal {
    featureId: string;
    from: string;
    to: string;
    reason: string;
    requiresConfirm?: boolean;
    gateBlocked?: boolean;
    gateFindings?: CheckFeatureFindings[];
    hops?: string[];
}

/** Options for feature status sync operations. */
export interface FeatureSyncOptions {
    dryRun?: boolean;
    forceConfirm?: boolean;
}

/** Result of a single feature status sync. */
export interface FeatureSyncResult {
    proposal: FeatureSyncProposal;
    applied: boolean;
    appliedHops: string[];
    /**
     * 0418 R3: set when a proposed hop into `active` was refused because another
     * P0 feature is already `active` (one-active-goal WIP limit). Surfaces the
     * conflict at the moment the lifecycle would have created it silently.
     */
    goalConflict?: { featureId: string; status: string };
}

/** Result of a bulk feature status sync over all features with linked tasks. */
export interface FeatureSyncAllResult {
    totalFeatures: number;
    evaluated: number;
    updatedCount: number;
    results: FeatureSyncResult[];
}

/** Dependencies injected into FeatureService. */
export interface FeatureServiceContext {
    fs: FileSystem;
    writeService: PlanningWriteService;
    featuresDir: string;
    /** Active task folder (default I/O). Always scanned. */
    tasksDir: string;
    /**
     * Optional multi-folder task corpus (phase folders from `.spur/config.yaml`).
     * When set, `collectTasksByFeature` / `move` scan **every** registered folder —
     * not only `tasksDir` — so cascade `feature_id` rewrites cover docs/tasks2, tasks3, …
     * Same shape as TaskService / TaskLocator (`folders` keys are resolved via `fs.resolve`).
     */
    foldersConfig?: { folders: Record<string, unknown> };
    projectName?: string;
    actor?: string;
}

/** Feature summary returned by list/show. */
export interface FeatureSummary {
    id: string;
    name: string;
    status: string;
    priority: string;
    filePath: string;
    frontmatter: Record<string, unknown>;
}

/** Show result: feature summary + full markdown content. */
export interface FeatureShowResult extends FeatureSummary {
    content: string;
}

/** Job enqueued when a feature action is invoked. */
export interface FeatureActionJob {
    featureId: string;
    action: string;
    command: string;
    channel?: string;
    skipDeps?: boolean;
}

/** Supported feature action names array. */
export const FEATURE_ACTION_NAMES = ['brainstorm', 'plan'] as const;

/** Union type of supported feature action names. */
export type FeatureActionName = (typeof FEATURE_ACTION_NAMES)[number];

/** Check if an action name is a supported feature action. */
export function isFeatureActionName(action: string): action is FeatureActionName {
    return (FEATURE_ACTION_NAMES as readonly string[]).includes(action as FeatureActionName);
}

/** Map supported feature action names to their CLI command invocations. */
export const FEATURE_ACTION_COMMANDS: Record<FeatureActionName, (id: string) => string> = {
    brainstorm: (id) => `spur dev brainstorm --feature ${id}`,
    plan: (id) => `spur dev plan --feature ${id}`,
};

const FEATURE_FILE_RE = /^([A-Z][1-9]*)_(.+)\.md$/;

/**
 * Strip a redundant leading section header from a feature section body.
 *
 * This mirrors task section updates: callers pass the section name separately,
 * so a body file that starts with `## Acceptance Criteria` would duplicate the
 * heading unless stripped before the shared write path replaces the section.
 */
function stripLeadingSectionHeader(body: string, sectionName: string): string {
    const match = body.match(/^(\s*)#{1,6}\s+(.+?)\s*(?:\n|$)/);
    if (match === null) return body;
    const headingText = (match[2] ?? '').trim();
    if (headingText.toLowerCase() !== sectionName.trim().toLowerCase()) return body;
    return body.slice(match[0].length).replace(/^\n+/, '');
}

/** Core feature verbs over PlanningWriteService and direct corpus reads. */
export class FeatureService {
    readonly ctx: FeatureServiceContext;

    constructor(ctx: FeatureServiceContext) {
        this.ctx = ctx;
    }

    /** Compute parent ID by dropping the last character. "A1" → "A", "A" → null. */
    parentOf(id: string): string | null {
        if (id.length <= 1) return null;
        return id.slice(0, -1);
    }

    /** Compute depth from ID length. "A" = 1, "A1" = 2, "A11" = 3. */
    depthOf(id: string): number {
        return id.length;
    }

    /** Validate a feature ID against the DD-14 pattern. */
    isValidId(id: string): boolean {
        return /^[A-Z][1-9]*$/.test(id);
    }

    /**
     * Create a new feature file via PlanningWriteService.
     *
     * ID allocation runs **inside the create-lock** (R1, DD-14): the directory
     * scan that picks the next child digit / free group letter and the file
     * write are one atomic critical section, so concurrent creates cannot
     * allocate the same ID and clobber each other.
     */
    async create(name: string, parentId?: string): Promise<WriteResult> {
        return this.ctx.writeService.createAllocated(this.ctx.featuresDir, async () => {
            const id = await this.allocateId(parentId ?? null);
            const slug = this.slugify(name);
            return { ref: this.makeRef(id, slug), content: this.templateContent(id, name) };
        });
    }

    /**
     * Update a feature's scalar frontmatter field (e.g. `priority`) via the
     * shared write path (R2). Status changes go through {@link transition} so
     * the lifecycle guard runs; this is for non-lifecycle fields. Machine-owned
     * keys are rejected so `--field status` cannot bypass the lifecycle FSM,
     * the History append, and the `feature.transitioned` event (mirrors
     * `TaskService.updateField`'s guard).
     *
     * The `tags` field is an array (`z.array(z.string())`) and the scalar
     * `setFrontmatterField` path would write a quoted string that fails the
     * schema on re-parse. Route `tags` through the array write path instead —
     * comma-split the value so `--field tags --value wayfinder-map` and
     * `--field tags --value a,b` both round-trip as a YAML list (task 0473 R6).
     */
    async update(id: string, key: string, value: string): Promise<WriteResult> {
        const protectedKeys = new Set(['status', 'id', 'schema_version', 'created_at', 'updated_at']);
        if (protectedKeys.has(key)) {
            throw new Error(
                `Field "${key}" is not settable via update — status changes go through the lifecycle ` +
                    `transition (spur feature update ${id} <status>); id and timestamps are machine-owned.`,
            );
        }
        const ref = await this.refFor(id);
        if (key === 'tags') {
            const tags = value
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean);
            return this.ctx.writeService.updateFrontmatterArray(ref, key, tags);
        }
        return this.ctx.writeService.updateFrontmatter(ref, key, value);
    }

    /**
     * Transition a feature to a new lifecycle status via the shared write path (R2).
     * The per-call `actor` (e.g. the API caller) takes precedence over the context
     * actor so the History entry attributes the change correctly; mirrors
     * `TaskService.updateStatus`.
     */
    async transition(id: string, toStatus: string, actor?: string): Promise<WriteResult> {
        const ref = await this.refFor(id);
        return this.ctx.writeService.transition(ref, toStatus, actor ?? this.ctx.actor ?? 'system');
    }

    /** Replace an existing feature section body from a source file. */
    async updateSection(id: string, sectionName: string, sourceFile: string): Promise<WriteResult> {
        const ref = await this.refFor(id);
        const current = await this.ctx.fs.readFile(ref.filePath);
        const doc = MarkdownDocument.parse(current, 'feature');
        if (!doc.sectionNames.includes(sectionName)) {
            throw new Error(
                `Feature ${id} does not contain section "${sectionName}". Available sections: ${doc.sectionNames.join(', ')}. ` +
                    'To list valid section names without a failed write: `spur task sections <wbs> list`.',
            );
        }
        const raw = await this.ctx.fs.readFile(sourceFile);
        const body = stripLeadingSectionHeader(raw, sectionName);
        return this.ctx.writeService.updateSection(ref, sectionName, body);
    }

    /** Replace the feature's body content (everything after frontmatter). */
    async updateBody(id: string, body: string): Promise<WriteResult> {
        const ref = await this.refFor(id);
        return this.ctx.writeService.updateBody(ref, body);
    }

    /** List features. */
    async list(): Promise<FeatureSummary[]> {
        const results: FeatureSummary[] = [];
        try {
            const names = await this.ctx.fs.readDir(this.ctx.featuresDir);
            for (const name of names) {
                const match = name.match(FEATURE_FILE_RE);
                if (!match) continue;
                const eid = match[1];
                const eslug = match[2];
                if (!eid || !eslug) continue;
                const filePath = `${this.ctx.featuresDir}/${name}`;
                try {
                    const raw = await this.ctx.fs.readFile(filePath);
                    const doc = MarkdownDocument.parse(raw, 'feature');
                    results.push({
                        id: eid,
                        name: (doc.frontmatterData?.name as string) ?? eslug,
                        status: (doc.frontmatterData?.status as string) ?? 'backlog',
                        priority: (doc.frontmatterData?.priority as string) ?? 'P2',
                        filePath,
                        frontmatter: (doc.frontmatterData ?? {}) as Record<string, unknown>,
                    });
                } catch {
                    // skip unparseable files
                }
            }
        } catch {
            // dir doesn't exist yet
        }
        return results;
    }

    /** Show a single feature by ID. */
    async show(id: string): Promise<FeatureShowResult | null> {
        try {
            const names = await this.ctx.fs.readDir(this.ctx.featuresDir);
            for (const name of names) {
                const match = name.match(FEATURE_FILE_RE);
                if (!match) continue;
                const eid = match[1];
                const eslug = match[2];
                if (!eid || !eslug) continue;
                if (eid !== id) continue;
                const filePath = `${this.ctx.featuresDir}/${name}`;
                const raw = await this.ctx.fs.readFile(filePath);
                const doc = MarkdownDocument.parse(raw, 'feature');
                return {
                    id: eid,
                    name: (doc.frontmatterData?.name as string) ?? eslug,
                    status: (doc.frontmatterData?.status as string) ?? 'backlog',
                    priority: (doc.frontmatterData?.priority as string) ?? 'P2',
                    filePath,
                    frontmatter: (doc.frontmatterData ?? {}) as Record<string, unknown>,
                    content: raw,
                };
            }
        } catch {
            // dir doesn't exist
        }
        return null;
    }

    /**
     * Regenerate `INDEX.md` (the ID-encoded tree) and repopulate each feature's
     * `## Tasks` auto-gen marker region from task `feature_id` edges (design §4.3).
     *
     * - INDEX.md is fully regenerated, deterministic (sorted by ID).
     * - `## Tasks` is rewritten ONLY between the auto-gen markers via
     *   `replaceMarkerRegion`; everything else in the feature file — and every
     *   task file — is left untouched (R2).
     * - A feature is written only when its rendered table actually differs from
     *   what is on disk, so `tasksUpdated` counts real changes rather than writes
     *   and an unrelated feature never lands in the working tree as a no-op touch.
     *
     * @param options.featureId  Restrict the per-feature `## Tasks` rewrite to a single
     *                           feature. INDEX.md is still regenerated (it is global and
     *                           deterministic — it changes only if the tree changed).
     *                           Use this to keep a refresh from sweeping unrelated
     *                           features into the working tree alongside scoped work.
     * @returns the rendered INDEX content and the count of features whose Tasks
     *          region actually changed.
     */
    async refresh(options?: { featureId?: string }): Promise<{ index: string; tasksUpdated: number }> {
        const features = await this.list();
        features.sort((a, b) => a.id.localeCompare(b.id));

        // ── R1: INDEX.md tree ──
        const index = renderIndex(features);
        await atomicWriteAsync(
            `${this.ctx.featuresDir}/INDEX.md`,
            index,
            'INDEX',
            this.ctx.fs,
            this.ctx.projectName ?? 'spur',
        );

        // ── R2: per-feature ## Tasks marker region ──
        const tasksByFeature = await this.collectTasksByFeature();
        const targets = options?.featureId ? features.filter((f) => f.id === options.featureId) : features;
        let tasksUpdated = 0;
        for (const feature of targets) {
            const rows = tasksByFeature.get(feature.id) ?? [];
            const table = renderTasksTable(rows);
            const raw = await this.ctx.fs.readFile(feature.filePath);
            const doc = MarkdownDocument.parse(raw, 'feature');
            if (!doc.hasSection('Tasks')) continue; // no Tasks section → nothing to populate
            try {
                doc.replaceMarkerRegion('Tasks', table);
            } catch {
                continue; // no marker region → leave the feature untouched
            }
            const next = doc.serialize();
            if (next === raw) continue; // roster already current → no write, no working-tree churn
            await atomicWriteAsync(feature.filePath, next, feature.id, this.ctx.fs, this.ctx.projectName ?? 'spur');
            tasksUpdated += 1;
        }

        return { index, tasksUpdated };
    }

    /**
     * Derive proposed feature status from its linked tasks state per ADR/0322.
     * Conservative forward-only derivation mapping.
     */
    async deriveFeatureStatus(featureId: string): Promise<FeatureSyncProposal> {
        const feature = await this.show(featureId);
        if (!feature) {
            throw new Error(`Feature ${featureId} not found`);
        }

        const tasksByFeature = await this.collectTasksByFeature();
        const linkedTasks = tasksByFeature.get(featureId) ?? [];
        const from = feature.status;

        if (linkedTasks.length === 0) {
            return {
                featureId,
                from,
                to: from,
                reason: 'No linked tasks found',
            };
        }

        const isTerminal = (st: string) => st === 'done' || st === 'cancelled';
        const terminalTasks = linkedTasks.filter((t) => isTerminal(t.status));
        const doneTasks = linkedTasks.filter((t) => t.status === 'done');
        const activeTasks = linkedTasks.filter((t) => t.status === 'wip' || t.status === 'testing');
        const nonTerminalTasks = linkedTasks.filter((t) => !isTerminal(t.status));

        // Reopen rule: closed feature with non-terminal tasks
        if (from === 'done' || from === 'cancelled') {
            if (nonTerminalTasks.length > 0) {
                return {
                    featureId,
                    from,
                    to: 'active',
                    reason: 'Linked tasks contain non-terminal work while feature is closed',
                    requiresConfirm: true,
                    hops: ['active'],
                };
            }
            return {
                featureId,
                from,
                to: from,
                reason: 'All linked tasks are terminal and feature is closed',
            };
        }

        // Helper to evaluate L4 AC gate before transitioning into verifying or done
        const checkL4Gate = async (): Promise<{ pass: boolean; findings: CheckFeatureFindings[] }> => {
            const checkSvc = new FeatureCheckService(this.ctx.fs);
            // Multi-folder scan (parity with collectTasksByFeature / feature check CLI).
            const tasksDirs = this.ctx.foldersConfig
                ? Object.keys(this.ctx.foldersConfig.folders).map((p) => this.ctx.fs.resolve(p))
                : [this.ctx.tasksDir];
            if (!tasksDirs.includes(this.ctx.tasksDir)) tasksDirs.unshift(this.ctx.tasksDir);
            const res = await checkSvc.check(feature.filePath, featureId, {
                featuresDir: this.ctx.featuresDir,
                tasksDir: this.ctx.tasksDir,
                tasksDirs,
                runDir: defaultVerdictRunDir(this.ctx.tasksDir),
            });
            const l4Errors = res.findings.filter((f) => f.layer === 'L4' && f.severity === 'error');
            return { pass: l4Errors.length === 0, findings: res.findings };
        };

        // All tasks terminal (with at least 1 done) -> propose advance to done via legal hops
        if (terminalTasks.length === linkedTasks.length && doneTasks.length > 0) {
            if (from === 'done') {
                return { featureId, from, to: 'done', reason: 'All linked tasks are terminal and feature is done' };
            }

            const gate = await checkL4Gate();
            if (!gate.pass) {
                const targetBeforeVerifying = from === 'backlog' || from === 'blocked' ? 'active' : from;
                return {
                    featureId,
                    from,
                    to: targetBeforeVerifying,
                    reason: 'L4 AC-traceability gate failed; stopped before verifying',
                    gateBlocked: true,
                    gateFindings: gate.findings,
                    ...(from !== targetBeforeVerifying ? { hops: [targetBeforeVerifying] } : {}),
                };
            }

            // L4 gate passed -> calculate hops to done
            let hops: string[] = [];
            if (from === 'backlog' || from === 'blocked') {
                hops = ['active', 'verifying', 'done'];
            } else if (from === 'active') {
                hops = ['verifying', 'done'];
            } else if (from === 'verifying') {
                hops = ['done'];
            }

            return {
                featureId,
                from,
                to: 'done',
                reason: 'All linked tasks are terminal and L4 AC gate passed',
                ...(hops.length > 0 ? { hops } : {}),
            };
        }

        // Active work present
        if (activeTasks.length > 0) {
            if (from === 'active') {
                return { featureId, from, to: 'active', reason: 'Linked tasks contain active work' };
            }
            return {
                featureId,
                from,
                to: 'active',
                reason: 'Linked tasks contain active work (wip or testing)',
                hops: ['active'],
            };
        }

        // All non-terminal tasks are blocked
        if (nonTerminalTasks.length > 0 && nonTerminalTasks.every((t) => t.status === 'blocked')) {
            if (from === 'blocked') {
                return { featureId, from, to: 'blocked', reason: 'All non-terminal linked tasks are blocked' };
            }
            return {
                featureId,
                from,
                to: 'blocked',
                reason: 'All non-terminal linked tasks are blocked',
                hops: ['blocked'],
            };
        }

        return {
            featureId,
            from,
            to: from,
            reason: 'Linked tasks state does not trigger status transition',
        };
    }

    /**
     * Sync a feature's status with its linked tasks.
     */
    async syncFeature(featureId: string, options?: FeatureSyncOptions): Promise<FeatureSyncResult> {
        const proposal = await this.deriveFeatureStatus(featureId);

        if (proposal.from === proposal.to) {
            return { proposal, applied: false, appliedHops: [] };
        }

        if (options?.dryRun) {
            return { proposal, applied: false, appliedHops: [] };
        }

        if (proposal.requiresConfirm && !options?.forceConfirm) {
            return { proposal, applied: false, appliedHops: [] };
        }

        const hops = proposal.hops ?? (proposal.from !== proposal.to ? [proposal.to] : []);
        if (hops.length === 0) {
            return { proposal, applied: false, appliedHops: [] };
        }

        const appliedHops: string[] = [];
        for (const hop of hops) {
            // 0418 R3: the lifecycle must not silently create a state its own rules
            // forbid. A P0 feature auto-activating into `active` while another P0 is
            // already active would manufacture the two-active-goal corpus — refuse
            // the hop, surface the conflict, and leave the corpus legal. The
            // operator still has a CLI path (advance the older goal first, or
            // transition manually once a goal slot is free).
            if (hop === 'active') {
                const conflict = await this.findOneActiveGoalConflict(featureId);
                if (conflict !== null) {
                    return {
                        proposal: {
                            ...proposal,
                            reason: `Activation blocked by one-active-goal: P0 feature "${conflict.featureId}" is already ${conflict.status}`,
                        },
                        applied: false,
                        appliedHops,
                        goalConflict: conflict,
                    };
                }
            }
            await this.transition(featureId, hop);
            appliedHops.push(hop);
        }

        return { proposal, applied: true, appliedHops };
    }

    /**
     * 0418 R3: first other P0 feature currently `active`, or null when activating
     * `featureId` would respect the one-active-goal limit. Same corpus scan the
     * feature-check L3 rule uses — one WIP-limit definition, one enforcement.
     */
    private async findOneActiveGoalConflict(featureId: string): Promise<{ featureId: string; status: string } | null> {
        const feature = await this.show(featureId);
        if (feature === null || feature.frontmatter.priority !== 'P0') return null;
        const conflict = await findOtherP0InStatus(this.ctx.fs, this.ctx.featuresDir, featureId, ['active']);
        return conflict === null ? null : { featureId: conflict.id, status: conflict.status };
    }

    /**
     * Sync all features that have linked tasks.
     */
    async syncAllFeatures(options?: FeatureSyncOptions): Promise<FeatureSyncAllResult> {
        const allFeatures = await this.list();
        const tasksByFeature = await this.collectTasksByFeature();
        const evaluated = allFeatures.filter((f) => (tasksByFeature.get(f.id) ?? []).length > 0);

        const results: FeatureSyncResult[] = [];
        let updatedCount = 0;

        for (const f of evaluated) {
            try {
                const res = await this.syncFeature(f.id, options);
                if (res.applied) updatedCount++;
                results.push(res);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                results.push({
                    proposal: {
                        featureId: f.id,
                        from: f.status,
                        to: f.status,
                        reason: `Transition blocked by guard: ${message}`,
                    },
                    applied: false,
                    appliedHops: [],
                });
            }
        }

        return {
            totalFeatures: allFeatures.length,
            evaluated: evaluated.length,
            updatedCount,
            results,
        };
    }

    /** TaskLocator spanning active + configured phase folders (SSOT multi-folder walk). */
    private taskLocator(): TaskLocator {
        return new TaskLocator({
            fs: this.ctx.fs,
            tasksDir: this.ctx.tasksDir,
            foldersConfig: this.ctx.foldersConfig,
        });
    }

    /** Scan registered task folders for `feature_id` edges, grouped by feature ID. */
    async collectTasksByFeature(): Promise<Map<string, TaskRow[]>> {
        const byFeature = new Map<string, TaskRow[]>();
        for (const dir of this.taskLocator().folderDirs()) {
            let names: string[];
            try {
                names = await this.ctx.fs.readDir(dir);
            } catch {
                continue; // folder may not exist yet
            }
            for (const name of names) {
                if (!/^\d{4}_.+\.md$/.test(name)) continue;
                const wbs = name.match(/^(\d{4})_/)?.[1];
                if (!wbs) continue;
                try {
                    const raw = await this.ctx.fs.readFile(`${dir}/${name}`);
                    const doc = MarkdownDocument.parse(raw, 'task');
                    const fm = doc.frontmatterData ?? {};
                    const fid = (fm.feature_id as string | undefined) ?? (fm['feature-id'] as string | undefined);
                    if (fid === undefined) continue;
                    const row: TaskRow = {
                        wbs,
                        name: (fm.name as string | undefined) ?? wbs,
                        status: (fm.status as string | undefined) ?? 'backlog',
                    };
                    const list = byFeature.get(fid) ?? [];
                    list.push(row);
                    byFeature.set(fid, list);
                } catch {
                    // skip unparseable task files
                }
            }
        }
        // Deterministic order: WBS ascending within each feature.
        for (const list of byFeature.values()) {
            list.sort((a, b) => a.wbs.localeCompare(b.wbs));
        }
        return byFeature;
    }

    /**
     * Move a feature to a new parent — a CASCADE RENAME (design §2.4, DD-14).
     *
     * Because the ID encodes position, a move re-IDs the node AND every descendant,
     * renames their files, rewrites each `id` frontmatter + heading, updates every
     * task `feature_id` edge, and appends a History entry on all touched files.
     *
     * Atomicity (R3): the full old→new plan is validated BEFORE any write (collision
     * / ≤9-children / not-into-own-subtree). The apply phase tracks every created
     * and deleted path and rolls back best-effort on a mid-cascade failure.
     *
     * @param id          The feature to move.
     * @param newParentId New parent ID, or `null`/undefined to move to a top-level group letter.
     * @param opts.dryRun When true, returns the plan + affected tasks with ZERO writes.
     */
    async move(
        id: string,
        newParentId?: string | null,
        opts?: { dryRun?: boolean },
    ): Promise<{ movedCount: number; mapping: Record<string, string>; tasksUpdated: string[]; dryRun: boolean }> {
        if (!this.isValidId(id)) throw new Error(`Invalid feature id: ${id}`);
        const parent = newParentId ?? null;
        if (parent !== null && !this.isValidId(parent)) throw new Error(`Invalid parent id: ${parent}`);
        if (parent !== null && (parent === id || parent.startsWith(id))) {
            throw new Error(`Cannot move feature "${id}" into itself or its own subtree (target "${parent}")`);
        }

        // ── Lock domain (R3): the create-lock serializes feature-ID allocation,
        // so a concurrent create/move cannot allocate a colliding target id or
        // interleave with this cascade. Allocation + collision-check + apply are
        // one critical section. ──
        const lock = acquireCreateLock(this.ctx.featuresDir, this.ctx.fs);
        try {
            // ── Build the old→new ID map for the node + all descendants ──
            const all = await this.list();
            const byId = new Map(all.map((f) => [f.id, f]));
            if (!byId.has(id)) throw new Error(`Feature ${id} not found`);

            const newRootId = await this.allocateId(parent); // next free digit/letter, ≤9 enforced
            const subtree = all.filter((f) => f.id === id || f.id.startsWith(id)).map((f) => f.id);
            const mapping: Record<string, string> = {};
            for (const oldId of subtree) {
                mapping[oldId] = newRootId + oldId.slice(id.length); // preserve relative suffix
            }

            // Collision guard: no mapped id may collide with an existing id outside the subtree.
            const movedSet = new Set(subtree);
            for (const newId of Object.values(mapping)) {
                if (byId.has(newId) && !movedSet.has(newId)) {
                    throw new Error(`Move collision: target id "${newId}" already exists`);
                }
            }

            // Affected tasks: any task whose feature_id is in the moved subtree.
            const affectedTasks = await this.tasksWithFeatureIds(new Set(subtree));

            if (opts?.dryRun === true) {
                return {
                    movedCount: subtree.length,
                    mapping,
                    tasksUpdated: affectedTasks.map((t) => t.wbs),
                    dryRun: true,
                };
            }

            return await this.applyMove(all, movedSet, mapping, affectedTasks, subtree.length);
        } finally {
            lock.release();
        }
    }

    /** Execute the validated move plan (best-effort atomic). Called inside the create-lock. */
    private async applyMove(
        all: FeatureSummary[],
        movedSet: Set<string>,
        mapping: Record<string, string>,
        affectedTasks: Array<{ wbs: string; path: string; featureId: string }>,
        movedCount: number,
    ): Promise<{ movedCount: number; mapping: Record<string, string>; tasksUpdated: string[]; dryRun: boolean }> {
        const now = new Date().toISOString();
        const created: string[] = [];
        const removed: Array<{ path: string; content: string }> = [];
        try {
            // 1) Rename + rewrite each feature file in the subtree.
            for (const f of all.filter((x) => movedSet.has(x.id))) {
                const newId = mapping[f.id];
                if (newId === undefined) continue;
                const raw = await this.ctx.fs.readFile(f.filePath);
                const doc = MarkdownDocument.parse(raw, 'feature');
                doc.setFrontmatterField('id', `"${newId}"`);
                doc.setFrontmatterField('updated_at', now);
                appendFeatureHistory(doc, now, `moved ${f.id} → ${newId}`);
                const slug = basename(f.filePath)
                    .replace(/^[A-Z][1-9]*_/, '')
                    .replace(/\.md$/, '');
                const newPath = `${this.ctx.featuresDir}/${newId}_${slug}.md`;
                removed.push({ path: f.filePath, content: raw });
                const movedContent = doc.serialize().replace(/^#\s+[A-Z][1-9]*:/m, `# ${newId}:`);
                await atomicWriteAsync(newPath, movedContent, newId, this.ctx.fs, this.ctx.projectName ?? 'spur');
                created.push(newPath);
                if (newPath !== f.filePath) await this.ctx.fs.deleteFile(f.filePath);
            }

            // 2) Update every task feature_id edge in the moved subtree.
            for (const task of affectedTasks) {
                const newFid = mapping[task.featureId];
                if (newFid === undefined) continue;
                const raw = await this.ctx.fs.readFile(task.path);
                const doc = MarkdownDocument.parse(raw, 'task');
                doc.setFrontmatterField('feature_id', newFid);
                doc.setFrontmatterField('updated_at', now);
                removed.push({ path: task.path, content: raw });
                await atomicWriteAsync(
                    task.path,
                    doc.serialize(),
                    task.wbs,
                    this.ctx.fs,
                    this.ctx.projectName ?? 'spur',
                );
            }
        } catch (err) {
            // Best-effort rollback: drop created files, restore originals.
            for (const p of created) {
                try {
                    await this.ctx.fs.deleteFile(p);
                } catch {
                    /* best-effort */
                }
            }
            for (const { path, content } of removed) {
                try {
                    await atomicWriteAsync(path, content, 'rollback', this.ctx.fs, this.ctx.projectName ?? 'spur');
                } catch {
                    /* best-effort */
                }
            }
            throw new Error(
                `Feature move failed and was rolled back: ${err instanceof Error ? err.message : String(err)}`,
            );
        }

        return { movedCount, mapping, tasksUpdated: affectedTasks.map((t) => t.wbs), dryRun: false };
    }

    /** Find tasks whose `feature_id` is in the given set (all registered task folders). */
    private async tasksWithFeatureIds(
        ids: Set<string>,
    ): Promise<Array<{ wbs: string; path: string; featureId: string }>> {
        const out: Array<{ wbs: string; path: string; featureId: string }> = [];
        for (const dir of this.taskLocator().folderDirs()) {
            let names: string[];
            try {
                names = await this.ctx.fs.readDir(dir);
            } catch {
                continue;
            }
            for (const name of names) {
                if (!/^\d{4}_.+\.md$/.test(name)) continue;
                const wbs = name.match(/^(\d{4})_/)?.[1];
                if (!wbs) continue;
                try {
                    const path = `${dir}/${name}`;
                    const raw = await this.ctx.fs.readFile(path);
                    const fm = MarkdownDocument.parse(raw, 'task').frontmatterData ?? {};
                    const fid = (fm.feature_id as string | undefined) ?? (fm['feature-id'] as string | undefined);
                    if (fid !== undefined && ids.has(fid)) {
                        out.push({ wbs, path, featureId: fid });
                    }
                } catch {
                    // skip unparseable
                }
            }
        }
        out.sort((a, b) => a.wbs.localeCompare(b.wbs));
        return out;
    }

    // ─── Private helpers ────────────────────────────────────────────────

    private resolveFeaturePath(id: string, slug: string): string {
        return `${this.ctx.featuresDir}/${id}_${slug}.md`;
    }

    /** Resolve a feature ID to its `EntityRef` by scanning the corpus. Throws if not found. */
    private async refFor(id: string): Promise<EntityRef> {
        const names = await this.ctx.fs.readDir(this.ctx.featuresDir);
        for (const name of names) {
            const match = name.match(FEATURE_FILE_RE);
            if (match?.[1] === id) {
                return {
                    kind: 'feature',
                    id,
                    filePath: `${this.ctx.featuresDir}/${name}`,
                    folder: this.ctx.featuresDir,
                };
            }
        }
        throw new Error(`Feature ${id} not found in ${this.ctx.featuresDir}`);
    }

    private slugify(name: string): string {
        return name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
    }

    private makeRef(id: string, slug: string): EntityRef {
        return {
            kind: 'feature',
            id,
            filePath: this.resolveFeaturePath(id, slug),
            folder: this.ctx.featuresDir,
        };
    }

    private async allocateId(parentId: string | null): Promise<string> {
        let existing: string[];
        try {
            const names = await this.ctx.fs.readDir(this.ctx.featuresDir);
            existing = [];
            for (const name of names) {
                const match = name.match(FEATURE_FILE_RE);
                const captured = match?.[1];
                if (captured) {
                    existing.push(captured);
                }
            }
        } catch {
            // Directory doesn't exist yet — allocate first ID
            return parentId === null ? 'A' : `${parentId}1`;
        }

        if (parentId === null) {
            for (let c = 'A'.charCodeAt(0); c <= 'Z'.charCodeAt(0); c++) {
                const letter = String.fromCharCode(c);
                if (!existing.includes(letter)) return letter;
            }
            throw new Error('No unused top-level feature letters available (A-Z exhausted)');
        }

        const prefix = parentId;
        const childLength = prefix.length + 1;
        const children = new Set<number>();
        for (const eid of existing) {
            if (eid.startsWith(prefix) && eid.length === childLength) {
                const char = eid[childLength - 1];
                if (char) {
                    const digit = parseInt(char, 10);
                    if (digit >= 1 && digit <= 9) {
                        children.add(digit);
                    }
                }
            }
        }
        for (let d = 1; d <= 9; d++) {
            if (!children.has(d)) return `${prefix}${d}`;
        }
        throw new Error(`Parent ${parentId} has reached the 9-child limit`);
    }

    private templateContent(id: string, name: string): string {
        const now = new Date().toISOString();
        return `---
schema_version: 1
id: "${id}"
name: "${name}"
status: backlog
priority: P2
tags: []
created_at: "${now}"
updated_at: "${now}"
---

# ${id}: ${name}

## Goal

## Scope

- In:
- Out:

## Acceptance Criteria

\`\`\`gherkin
Feature: ${name}

  Scenario: Basic acceptance
    Given a precondition
    When an action
    Then an expected outcome
\`\`\`

## Tasks

<!-- AUTO-GENERATED by spur feature refresh -->
<!-- END AUTO-GENERATED -->

## Notes

## History
`;
    }

    /**
     * Fulfill an asynchronous feature action request by enqueuing a job and
     * returning the `runId`. Note: `check` remains the sole synchronous exception
     * and does NOT go through `fulfillAction` (per F81/0352).
     *
     * @throws if the feature file does not exist or action is unsupported.
     */
    async fulfillAction(
        featureId: string,
        action: string,
        enqueue: (job: FeatureActionJob) => Promise<string>,
        options?: { channel?: string; skipDeps?: boolean },
    ): Promise<{ runId: string; action: string; status: 'queued' }> {
        const feature = await this.show(featureId);
        if (!feature) {
            throw new Error(`Feature not found: ${featureId}`);
        }
        if (!isFeatureActionName(action)) {
            throw new Error(`Unsupported feature action: ${action}`);
        }

        const runId = await enqueue({
            featureId,
            action,
            command: FEATURE_ACTION_COMMANDS[action](featureId),
            channel: options?.channel,
            skipDeps: options?.skipDeps,
        });
        return { runId, action, status: 'queued' };
    }
}

// ─── INDEX + Tasks rendering (module-level, pure) ────────────────────────

/** A feature node for the INDEX tree (subset of FeatureSummary). */
interface IndexNode {
    id: string;
    name: string;
    status: string;
    filePath: string;
}

/**
 * Render the `INDEX.md` ID-encoded tree (design §4.3) — deterministic.
 *
 * Features sort by ID; depth = ID length (DD-14). Each node prints a
 * `tree`-style connector based on whether it is the last child of its parent,
 * followed by `[status] [ID: name](relative-link)`.
 */
function renderIndex(features: IndexNode[]): string {
    const sorted = [...features].sort((a, b) => a.id.localeCompare(b.id));
    const ids = new Set(sorted.map((f) => f.id));

    const lines: string[] = ['# Feature Index', '', '<!-- AUTO-GENERATED by spur feature refresh -->'];
    for (const f of sorted) {
        const depth = f.id.length - 1; // top-level (length 1) = depth 0
        const indent = '    '.repeat(depth);
        const connector = depth === 0 ? '' : isLastChild(f.id, sorted, ids) ? '└── ' : '├── ';
        const slug = basename(f.filePath);
        lines.push(`${indent}${connector}[${f.status}] **${f.id}**: ${f.name} ([${slug}](./${slug}))`);
    }
    lines.push('<!-- END AUTO-GENERATED -->', '');
    return lines.join('\n');
}

/** True if `id` is the highest (lexicographically last) child of its parent in the corpus. */
function isLastChild(id: string, sorted: IndexNode[], _ids: Set<string>): boolean {
    const parent = id.length <= 1 ? null : id.slice(0, -1);
    const siblings = sorted.filter((f) => (f.id.length <= 1 ? null : f.id.slice(0, -1)) === parent);
    const last = siblings.at(-1);
    return last?.id === id;
}

/** The file name of a path (no directory). */
function basename(filePath: string): string {
    const parts = filePath.split('/');
    return parts.at(-1) ?? filePath;
}

/**
 * Append a `## History` bullet line to a feature doc (DD-14 move audit trail).
 * Mirrors the write-service bullet format: `- {ISO-ts} {note} (system)`. Creates
 * the section body if `## History` exists but is empty.
 */
function appendFeatureHistory(doc: MarkdownDocument, timestamp: string, note: string): void {
    if (!doc.hasSection('History')) return; // no History section → nothing to append to
    const existing = doc.getSection('History') ?? '';
    const line = `- ${timestamp} ${note} (system)`;
    const updated = existing.trim().length > 0 ? `${existing.trimEnd()}\n${line}\n` : `\n${line}\n`;
    doc.replaceSection('History', updated);
}

/** Render the `## Tasks` table content (between the auto-gen markers). */
function renderTasksTable(rows: TaskRow[]): string {
    if (rows.length === 0) {
        return '_No linked tasks._';
    }
    const header = '| WBS | Task | Status |\n| --- | ---- | ------ |';
    const body = rows.map((r) => `| ${r.wbs} | ${escapePipes(r.name)} | ${r.status} |`).join('\n');
    return `${header}\n${body}`;
}

/** Escape pipe characters so a task name can't break the markdown table. */
function escapePipes(text: string): string {
    return text.replace(/\|/g, '\\|');
}
