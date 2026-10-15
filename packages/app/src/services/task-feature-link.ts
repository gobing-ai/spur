import { dirname, join } from 'node:path';
import { MarkdownDocument, stripAcFence } from '@gobing-ai/spur-domain';
import { readFeatureAcBody } from './feature-check';
import { FeatureService } from './feature-service';
import type { PlanningWriteService, WriteResult } from './planning-write-service';
import type { TaskServiceContext } from './task-service';
import { ParentFeatureStatusError } from './task-service-errors';

/**
 * The `features/` directory that belongs to a tasks directory (1132 P1). A phase folder
 * (`docs/tasks5`) is still a tasks dir, so the rule is "parent of the tasks dir", never a
 * basename match on `/tasks` — the latter silently resolved to the tasks dir itself for every
 * non-default phase folder, leaving 1132 R2's parent guard inert in the real layout.
 */
export function featuresDirFor(tasksDir: string): string {
    return `${dirname(tasksDir)}/features`;
}

/**
 * Parent-feature reads and guards for {@link TaskService}: the features directory, the parent
 * feature's status guard (1132 R2) and its acceptance-criteria body, shared by `task create`,
 * `task update` and `task record`.
 */
export class TaskFeatureLink {
    constructor(
        private readonly ctx: TaskServiceContext,
        private readonly writeService: PlanningWriteService,
    ) {}

    /**
     * The features dir for this corpus: the configured one, else the `features/` sibling
     * of the active tasks dir. The sibling rule must not key on the folder BASENAME — a
     * phase folder (`docs/tasks5`) is still a tasks dir, and its sibling is `docs/features`.
     */
    deriveFeaturesDir(): string {
        return this.ctx.featuresDir ?? featuresDirFor(this.ctx.tasksDir);
    }

    /**
     * The {@link FeatureService} this task service reads and reopens features through — built
     * from the same resolved dirs the feature verbs use, so lifecycle validation matches.
     */
    private newFeatureService(): FeatureService {
        return new FeatureService({
            fs: this.ctx.fs,
            writeService: this.writeService,
            featuresDir: this.deriveFeaturesDir(),
            tasksDir: this.ctx.tasksDir,
        });
    }

    /**
     * 1132 R2: the parent feature's status, or `undefined` when it cannot be resolved (no
     * features dir, unknown id). Split from {@link guardParentFeature} so batch-create can
     * validate every parent BEFORE reopening any of them.
     */
    async readParentFeatureStatus(featureId: string): Promise<string | undefined> {
        try {
            const summaries = await this.newFeatureService().list();
            return summaries.find((f) => f.id === featureId)?.status;
        } catch {
            return undefined; // no readable features dir → nothing to guard
        }
    }

    /**
     * 1132 R2: parent-status link guard for task→feature links (`create --feature`,
     * `update --feature`). A `done`/`cancelled` parent cannot accept new work — reject
     * with up to three active sibling suggestions. A `verifying` parent is reopened to
     * `active` through the guarded FeatureService.transition (lifecycle validation,
     * history, event) and the reopen is reported as `featureReopened`. `noReopen`
     * (`--no-reopen`) restores the accept-as-is behavior. Unknown features are left to
     * the caller's own validation.
     */
    async guardParentFeature(featureId: string, noReopen?: boolean): Promise<WriteResult['featureReopened']> {
        const svc = this.newFeatureService();
        let summaries: Awaited<ReturnType<typeof svc.list>>;
        try {
            summaries = await svc.list();
        } catch {
            return undefined; // no readable features dir → nothing to guard
        }
        const feature = summaries.find((f) => f.id === featureId);
        if (feature === undefined) return undefined;
        // 1180 R1: a deprecated parent is frozen for new work regardless of `noReopen`
        // (the reopen path exists only for `verifying`, so this branch precedes it).
        if (feature.status === 'deprecated') {
            throw new ParentFeatureStatusError(featureId, feature.status, this.activeSiblingsOf(summaries, featureId));
        }
        if (feature.status === 'verifying') {
            if (noReopen === true) return undefined;
            // The caller's port carries the FEATURE lifecycle profile; the local fallback
            // (service-level tests, callers that resolved nothing) uses this service's own
            // FeatureService.
            const wr =
                this.ctx.featureTransition !== undefined
                    ? await this.ctx.featureTransition(featureId, 'active')
                    : await svc.transition(featureId, 'active');
            return { id: featureId, from: wr?.fromStatus ?? 'verifying', to: wr?.toStatus ?? 'active' };
        }
        if (feature.status === 'done' || feature.status === 'cancelled') {
            throw new ParentFeatureStatusError(featureId, feature.status, this.activeSiblingsOf(summaries, featureId));
        }
        return undefined;
    }

    /**
     * Up to three `active` features sharing `featureId`'s ID group, offered as
     * re-point targets in a {@link ParentFeatureStatusError} message.
     */
    private activeSiblingsOf(summaries: Array<{ id: string; status: string }>, featureId: string): string[] {
        const siblings: string[] = [];
        for (const f of summaries) {
            if (siblings.length >= 3) break;
            if (f.id !== featureId && f.id[0] === featureId[0] && f.status === 'active') siblings.push(f.id);
        }
        return siblings;
    }

    /**
     * Resolve the linked feature's Acceptance Criteria body for a task file —
     * frontmatter `feature_id` → `<tasksDir>/../features/<id>_*.md` via feature-check's
     * {@link readFeatureAcBody}. Shared by `TaskUpdateOps.checkAcSubsetWarning` and
     * `TaskRecordOps.checkScenarioKeyRegression`. Returns null on any miss — no feature_id,
     * no feature file, empty AC — so both callers stay silent in the same cases.
     */
    async resolveFeatureAcBody(
        taskFilePath: string,
    ): Promise<{ featureId: string; ac: string; taskAc: string } | null> {
        const doc = MarkdownDocument.parse(await this.ctx.fs.readFile(taskFilePath), 'task');
        const fm = doc.frontmatterData ?? {};
        const featureId = (fm.feature_id as string | undefined) ?? (fm['feature-id'] as string | undefined);
        if (!featureId || featureId.length === 0) return null;
        const ac = await readFeatureAcBody(this.ctx.fs, join(dirname(taskFilePath), '..', 'features'), featureId);
        if (ac === null) return null;
        return { featureId, ac, taskAc: stripAcFence(doc.getSection('Acceptance Criteria') ?? '') };
    }
}
