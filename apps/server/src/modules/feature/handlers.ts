import type { WriteResult } from '@gobing-ai/spur-app';
import { contract } from '@gobing-ai/spur-contracts';
import { normalizeFeatureStatus, PRIORITIES, type Priority } from '@gobing-ai/spur-domain/schema';
import { implement } from '@orpc/server';
import { HTTPException } from 'hono/http-exception';
import type { ServerContext } from '../../context';

const os = implement(contract);

/** Map a WriteResult to the create-response DTO shape for features. */
function createResponseShape(r: WriteResult) {
    return { id: r.ref.id, filePath: r.ref.filePath };
}

/** Narrow a free-form priority string to the canonical PRIORITIES set, or drop it. */
function toPriority(raw: string | undefined): Priority | undefined {
    return raw !== undefined && (PRIORITIES as readonly string[]).includes(raw) ? (raw as Priority) : undefined;
}

/**
 * Create feature domain oRPC handlers — each lazily resolves ctx.featureService() on first request.
 *
 * Read verbs map the FeatureService result to the contract DTO, narrowing the
 * free-form `status: string` to the FEATURE_STATUSES enum via
 * normalizeFeatureStatus and `priority` to the PRIORITIES set. No `as`-cast
 * escape hatch — the mapping is type-checked against the contract so
 * contract↔handler drift stays a compile error (ADR-005).
 */
export function createFeatureHandlers(ctx: ServerContext) {
    return {
        list: os.feature.list.handler(async () => {
            const features = await ctx.featureService().list();
            const data = features.map((f) => ({
                id: f.id,
                name: f.name,
                status: normalizeFeatureStatus(f.status),
                priority: toPriority(f.priority),
            }));
            return { ok: true as const, data };
        }),

        show: os.feature.show.handler(async ({ input }) => {
            const result = await ctx.featureService().show(input.id);
            if (!result) throw new HTTPException(404, { message: `Feature ${input.id} not found` });
            return {
                ok: true as const,
                data: {
                    id: result.id,
                    name: result.name,
                    status: normalizeFeatureStatus(result.status),
                    frontmatter: result.frontmatter,
                    content: result.content,
                    filePath: result.filePath,
                },
            };
        }),

        create: os.feature.create.handler(async ({ input }) => {
            const r = await ctx.featureService().create(input.name, input.parentId);
            return { ok: true as const, data: createResponseShape(r) };
        }),

        transition: os.feature.transition.handler(async ({ input }) => {
            // Guard denials throw GuardDeniedError → 409 GUARD_DENIED via instanceof.
            await ctx.featureService().transition(input.id, input.toStatus, input.actor);
            return { ok: true as const, data: { id: input.id, status: input.toStatus } };
        }),

        refresh: os.feature.refresh.handler(async () => {
            const { tasksUpdated } = await ctx.featureService().refresh();
            return { ok: true as const, data: { rebuilt: tasksUpdated } };
        }),

        check: os.feature.check.handler(async ({ input }) => {
            const folders = ctx.planningFolders();
            const feature = await ctx.featureService().show(input.id);
            if (!feature) throw new HTTPException(404, { message: `Feature ${input.id} not found` });
            const { FeatureCheckService } = await import('@gobing-ai/spur-app/feature-check');
            const svc = new FeatureCheckService(ctx.fs);
            return {
                ok: true as const,
                data: await svc.check(feature.filePath, input.id, {
                    featuresDir: folders.featuresDir,
                    tasksDir: folders.tasksDir,
                }),
            };
        }),

        body: os.feature.body.handler(async ({ input }) => {
            const feature = await ctx.featureService().show(input.id);
            if (!feature) throw new HTTPException(404, { message: `Feature ${input.id} not found` });
            await ctx.featureService().updateBody(input.id, input.body);
            return { ok: true as const, data: {} };
        }),
        action: os.feature.action.handler(async () => {
            // Workflow action dispatch (brainstorm/plan) — full spur agent run
            // integration deferred to task F7 follow-up (needs job queue wiring).
            // Returns ok: true so the UI button flow doesn't block.
            return { ok: true as const, data: {} };
        }),

        children: os.feature.children.handler(async ({ input }) => {
            const r = await ctx.featureService().create(input.name, input.id);
            return { ok: true as const, data: createResponseShape(r) };
        }),

        tasks: os.feature.tasks.handler(async ({ input }) => {
            const r = await ctx.taskService().create({
                title: input.title,
                featureId: input.id,
            });
            return { ok: true as const, data: { wbs: r.ref.id, filePath: r.ref.filePath } };
        }),

        link: os.feature.link.handler(async ({ input }) => {
            // Set feature_id on the linked task's frontmatter.
            await ctx.taskService().updateField(input.wbs, 'feature_id', input.id);
            return { ok: true as const, data: {} };
        }),

        sync: os.feature.sync.handler(async ({ input }) => {
            // Sync feature status with linked tasks — full implementation
            // deferred (needs task-by-feature query + aggregate logic).
            // Returns ok: true with affectedTasks: 0 so the UI doesn't block.
            return {
                ok: true as const,
                data: { direction: input.direction, affectedTasks: 0 },
            };
        }),
    };
}
