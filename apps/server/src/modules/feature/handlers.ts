import type { WriteResult } from '@gobing-ai/spur-app';
import { FeatureCheckService } from '@gobing-ai/spur-app';
import { contract } from '@gobing-ai/spur-contracts';
import { normalizeFeatureStatus, PRIORITIES, type Priority } from '@gobing-ai/spur-domain/schema';
import { NotFoundError } from '@gobing-ai/ts-utils';
import { implement } from '@orpc/server';
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
            if (!result) throw new NotFoundError(`Feature ${input.id} not found`);
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
            // The global error handler maps "Lifecycle transition denied" → 409 GUARD_DENIED.
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
            if (!feature) throw new NotFoundError(`Feature ${input.id} not found`);
            const svc = new FeatureCheckService(ctx.fs);
            return {
                ok: true as const,
                data: await svc.check(feature.filePath, input.id, {
                    featuresDir: folders.featuresDir,
                    tasksDir: folders.tasksDir,
                }),
            };
        }),
    };
}
