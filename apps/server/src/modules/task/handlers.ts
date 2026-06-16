import type { WriteResult } from '@gobing-ai/spur-app';
import { contract } from '@gobing-ai/spur-contracts';
import { normalizeTaskStatus } from '@gobing-ai/spur-domain/schema';
import { NotFoundError } from '@gobing-ai/ts-utils';
import { implement } from '@orpc/server';
import type { ServerContext } from '../../context';

const os = implement(contract);

/** Map contract query params to TaskService filters; drop unmapped keys. */
function toFilters(query?: Record<string, unknown>): { status?: string; parentWbs?: string } {
    if (!query) return {};
    const f: { status?: string; parentWbs?: string } = {};
    if (typeof query.status === 'string') f.status = query.status;
    if (typeof query.parent === 'string') f.parentWbs = query.parent;
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
            const data = tasks.map((t) => ({
                wbs: t.wbs,
                name: t.name,
                status: normalizeTaskStatus(t.status),
                filePath: t.filePath,
            }));
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
            const r = await ctx
                .taskService()
                .create({ title: input.title, featureId: input.featureId, parentWbs: input.parentWbs });
            return { ok: true as const, data: createResponseShape(r) };
        }),

        transition: os.task.transition.handler(async ({ input }) => {
            await ctx.taskService().updateStatus(input.wbs, input.toStatus, input.actor);
            return { ok: true as const, data: { wbs: input.wbs, status: input.toStatus } };
        }),
    };
}
