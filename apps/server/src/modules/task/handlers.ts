import type { WriteResult } from '@gobing-ai/spur-app';
import { contract } from '@gobing-ai/spur-contracts';
import { normalizeTaskStatus, TASK_TYPES } from '@gobing-ai/spur-domain/schema';
import { NotFoundError } from '@gobing-ai/ts-utils';
import { implement } from '@orpc/server';
import type { ServerContext } from '../../context';

const os = implement(contract);

/** Map contract query params to TaskService filters; drop unmapped keys. */
function toFilters(query?: Record<string, unknown>): { status?: string; parentWbs?: string; folder?: string } {
    if (!query) return {};
    const f: { status?: string; parentWbs?: string; folder?: string } = {};
    if (typeof query.status === 'string') f.status = query.status;
    if (typeof query.parent === 'string') f.parentWbs = query.parent;
    if (typeof query.folder === 'string') f.folder = query.folder;
    return f;
}

/** Map a WriteResult to the create-response DTO shape. */
function createResponseShape(r: WriteResult) {
    return { wbs: r.ref.id, filePath: r.ref.filePath };
}

/**
 * Create task domain oRPC handlers — each lazily resolves ctx.taskService() on first request.
 *
 * Each read verb maps the TaskService result to the contract DTO, narrowing the
 * free-form `status: string` to the canonical TASK_STATUSES enum via
 * normalizeTaskStatus. No `as`-cast escape hatch — the mapping is type-checked
 * against the contract so contract↔handler drift stays a compile error (ADR-005).
 */
export function createTaskHandlers(ctx: ServerContext) {
    return {
        list: os.task.list.handler(async ({ input }) => {
            const filters = toFilters(input as Record<string, unknown> | undefined);
            const tasks = await ctx.taskService().list(filters);
            const data = tasks.map((t) => {
                const fm = t.frontmatter ?? {};
                return {
                    wbs: t.wbs,
                    name: t.name,
                    status: normalizeTaskStatus(t.status),
                    // Pass the raw priority through — the corpus mixes P0–P3 with high/medium/low.
                    priority: typeof fm.priority === 'string' ? fm.priority : undefined,
                    featureId: (fm.feature_id as string | null) ?? undefined,
                    parentWbs: (fm.parent_wbs as string | null) ?? undefined,
                    type: (TASK_TYPES as readonly string[]).includes(fm.type as string)
                        ? (fm.type as (typeof TASK_TYPES)[number])
                        : undefined,
                    filePath: t.filePath,
                    updatedAt: fm.updated_at as string | undefined,
                };
            });
            return { ok: true as const, data };
        }),

        show: os.task.show.handler(async ({ input }) => {
            const result = await ctx.taskService().show(input.wbs);
            if (!result) throw new NotFoundError(`Task ${input.wbs} not found`);
            return {
                ok: true as const,
                data: {
                    wbs: result.wbs,
                    name: result.name,
                    status: normalizeTaskStatus(result.status),
                    frontmatter: result.frontmatter,
                    content: result.content,
                    filePath: result.filePath,
                },
            };
        }),

        create: os.task.create.handler(async ({ input }) => {
            const r = await ctx.taskService().create({
                title: input.title,
                featureId: input.featureId,
                parentWbs: input.parentWbs,
                template: input.template,
            });
            return { ok: true as const, data: createResponseShape(r) };
        }),

        transition: os.task.transition.handler(async ({ input }) => {
            await ctx.taskService().updateStatus(input.wbs, input.toStatus, input.actor);
            return { ok: true as const, data: { wbs: input.wbs, status: input.toStatus } };
        }),

        body: os.task.body.handler(async ({ input }) => {
            const r = await ctx.taskService().updateBody(input.wbs, input.body, input.actor);
            return { ok: true as const, data: { wbs: r.ref.id, filePath: r.ref.filePath } };
        }),

        action: os.task.action.handler(async ({ input }) => {
            const jobQueue = await ctx.jobQueue();
            const result = await ctx.taskService().fulfillAction(
                input.wbs,
                input.action,
                async (job) => {
                    const runId = await jobQueue.enqueue('task-action', job);
                    return runId;
                },
                { channel: input.channel, skipDeps: input.skipDeps },
            );
            return { ok: true as const, data: result };
        }),

        folders: os.task.folders.handler(async () => {
            // Derived from `.spur/config.yaml` via the context's resolved planning folders
            // (serve.ts resolves them at boot; context holds the schema-default fallback).
            // Never reads the legacy `docs/.tasks/config.jsonc` (retired, ADR-027).
            const { foldersConfig } = ctx.planningFolders();
            const data = Object.entries(foldersConfig.folders).map(([path, cfg]) => ({
                path,
                label: cfg.label,
            }));
            return { ok: true as const, data };
        }),
    };
}
