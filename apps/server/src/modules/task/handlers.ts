import type { WriteResult } from '@gobing-ai/spur-app';
import { contract } from '@gobing-ai/spur-contracts';
import { normalizeTaskStatusSafe, TASK_TYPES } from '@gobing-ai/spur-domain/schema';
import { implement } from '@orpc/server';
import { HTTPException } from 'hono/http-exception';
import type { ServerContext } from '../../context';

const os = implement(contract);

/** Map contract query params to TaskService filters; drop unmapped keys. */
function toFilters(query?: Record<string, unknown>): { status?: string; parentWbs?: string; folder?: string } {
    if (!query) return {};
    const f: { status?: string; parentWbs?: string; folder?: string } = {};
    // `taskListInputSchema.status` is a free-form string (aliases and case must
    // resolve). The raw value passes through: `TaskService.list()` normalizes and
    // throws the typed `ValidationError` on an unknown one (task 0800 R4), which
    // the transport maps to 422 VALIDATION_FAILED — no handler-local catch.
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
                const estimateHours =
                    typeof fm.estimate_hours === 'number'
                        ? fm.estimate_hours
                        : typeof fm.estimated_hours === 'number'
                          ? fm.estimated_hours
                          : undefined;
                const deps = Array.isArray(fm.dependencies) ? fm.dependencies : [];
                return {
                    wbs: t.wbs,
                    name: t.name,
                    status: normalizeTaskStatusSafe(t.status),
                    priority: typeof fm.priority === 'string' ? fm.priority : undefined,
                    featureId: (fm.feature_id as string | null) ?? undefined,
                    parentWbs: (fm.parent_wbs as string | null) ?? undefined,
                    type: (TASK_TYPES as readonly string[]).includes(fm.type as string)
                        ? (fm.type as (typeof TASK_TYPES)[number])
                        : undefined,
                    template: typeof fm.template === 'string' ? fm.template : undefined,
                    estimateHours,
                    dependencyCount: deps.length > 0 ? deps.length : undefined,
                    filePath: t.filePath,
                    updatedAt: fm.updated_at as string | undefined,
                };
            });
            return { ok: true as const, data };
        }),

        show: os.task.show.handler(async ({ input }) => {
            const result = await ctx.taskService().show(input.wbs);
            if (!result) throw new HTTPException(404, { message: `Task ${input.wbs} not found` });
            return {
                ok: true as const,
                data: {
                    wbs: result.wbs,
                    name: result.name,
                    status: normalizeTaskStatusSafe(result.status),
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
            // Guarded transition (task 0966 R3): one shared gate with the CLI — the
            // structural `testing`/`done` check plus the done-verdict gate. A denial
            // throws GuardDeniedError → 409 GUARD_DENIED via the error handler.
            const guarded = await ctx.transitionTask(input);
            // 1051 R3: a post-commit bookkeeping failure (task-lifecycle row
            // reconciliation) must reach the operator log through the existing server
            // logger — dropping the guarded result also dropped the only record of the
            // unreconciled row. Same contract as the CLI warning (1047 R3): the task
            // file write stands, the transport DTO is unchanged, and replaying the same
            // terminal transition repairs the row.
            if (guarded.kind === 'transitioned' && guarded.result.bookkeepingError !== undefined) {
                ctx.logger.error(
                    `task ${input.wbs}: failed to reconcile task-lifecycle bookkeeping row after transition to ${guarded.result.toStatus}: ${guarded.result.bookkeepingError} ` +
                        `(task file is committed; replay the same terminal transition, e.g. \`spur task record ${input.wbs} --transition ${input.toStatus}\`, to repair)`,
                    { wbs: input.wbs, toStatus: guarded.result.toStatus },
                );
            }
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
            // `activeFolder` carries `tasks.active` so the client selects the configured
            // folder, not the first declared one (declaration order ≠ active order).
            const { foldersConfig } = ctx.planningFolders();
            const data = Object.entries(foldersConfig.folders).map(([path, cfg]) => ({
                path,
                label: cfg.label,
            }));
            return { ok: true as const, data, activeFolder: foldersConfig.active_folder };
        }),
    };
}
