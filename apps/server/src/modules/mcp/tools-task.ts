/**
 * Task tools: capture, sections, dependencies, check, preflight and batch plan.
 *
 * Task 1445 R7 split: the descriptors and handlers that used to sit in `index.ts`, moved here
 * verbatim so each domain owns one file.
 */
import { normalizeTaskStatus, TASK_STATUSES } from '@gobing-ai/spur-domain';
import { InvalidArgumentsError, type McpToolDescriptor } from './protocol';
import {
    optionalString,
    READ_TOOL,
    requiredString,
    stringArray,
    summarizeWrite,
    type ToolHandler,
    WRITE_TOOL,
    withServiceCode,
    writeInlineSection,
} from './tools-shared';

/** Descriptor rows the module entry composes into `TOOL_DESCRIPTORS`. */
export const descriptors: McpToolDescriptor[] = [
    {
        name: 'sp_task_show',
        annotations: READ_TOOL,
        description: 'Show one Spur task: metadata plus the full markdown content.',
        inputSchema: {
            type: 'object',
            properties: { wbs: { type: 'string', description: 'Task WBS (e.g. "1372")' } },
            required: ['wbs'],
        },
    },
    {
        name: 'sp_task_create',
        annotations: WRITE_TOOL,
        description:
            'Create one task from a title (optionally linked to a feature and parent). Never runs model-backed ready-prep; refine the task explicitly afterwards.',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'Task title' },
                featureId: { type: 'string', description: 'Owning feature id (e.g. "K41")' },
                parentWbs: { type: 'string', description: 'Parent task WBS for a child task' },
                template: { type: 'string', description: 'Task template name (feature-impl, feature-verify, ...)' },
                requirements: { type: 'string', description: 'Requirements section body' },
                plan: { type: 'string', description: 'Plan section body' },
            },
            required: ['title'],
            additionalProperties: false,
        },
    },
    {
        name: 'sp_task_update',
        annotations: WRITE_TOOL,
        description:
            'Update one task: exactly one of a section body, a frontmatter field, or a tag add/remove. Status is refused — use sp_task_transition, which runs the guards.',
        inputSchema: {
            type: 'object',
            properties: {
                wbs: { type: 'string', description: 'Task WBS' },
                section: { type: 'string', description: 'Section name to write' },
                content: { type: 'string', description: 'Section body (inline, never a file path)' },
                field: {
                    type: 'string',
                    description: 'Frontmatter field to set (status is refused)',
                    enum: ['priority', 'feature_id', 'ac_numbering', 'ac_altitude'],
                },
                value: { type: 'string', description: 'Field value' },
                addTags: { type: 'array', items: { type: 'string' }, description: 'Tags to add' },
                removeTags: { type: 'array', items: { type: 'string' }, description: 'Tags to remove' },
                append: {
                    type: 'boolean',
                    description: 'Append to the named section instead of replacing it (section+content only)',
                },
            },
            required: ['wbs'],
            additionalProperties: false,
        },
    },
    {
        name: 'sp_task_check',
        annotations: READ_TOOL,
        description:
            'Run the four-layer task check (the same result list `spur task check <wbs> --json` prints). Read-only.',
        inputSchema: {
            type: 'object',
            properties: {
                wbs: { type: 'string', description: 'Task WBS' },
                as: {
                    type: 'string',
                    enum: [...TASK_STATUSES],
                    description: 'Evaluate the task as this target status (F92 target-state projection)',
                },
            },
            required: ['wbs'],
            additionalProperties: false,
        },
    },
    {
        name: 'sp_task_sections',
        annotations: WRITE_TOOL,
        description:
            'Canonical task sections: op=list is read-only (required/optional/forbidden, present, missing); op=add inserts one canonical section; op=init inserts every required section.',
        inputSchema: {
            type: 'object',
            properties: {
                wbs: { type: 'string', description: 'Task WBS' },
                op: { type: 'string', enum: ['list', 'add', 'init'] },
                section: { type: 'string', description: 'Section name (required for op=add)' },
            },
            required: ['wbs', 'op'],
            additionalProperties: false,
        },
    },
    {
        name: 'sp_task_deps',
        annotations: WRITE_TOOL,
        description:
            'Mutate the task `dependencies[]` graph: set (replace), add, remove, or clear. WBS format, self-edge, duplicate and cycle guards apply.',
        inputSchema: {
            type: 'object',
            properties: {
                wbs: { type: 'string', description: 'Task WBS' },
                op: { type: 'string', enum: ['set', 'add', 'remove', 'clear'] },
                values: { type: 'array', items: { type: 'string' }, description: 'Dependency WBS values' },
            },
            required: ['wbs', 'op'],
            additionalProperties: false,
        },
    },
    {
        name: 'sp_task_preflight',
        annotations: READ_TOOL,
        description:
            'Admission decision for one task: the TABLE A STOP evaluation (default), quick command-aware readiness with `operation`, or the one-shot recovery hint with `recovery`. Read status/deps from the corpus unless `status` is given.',
        inputSchema: {
            type: 'object',
            properties: {
                wbs: { type: 'string', description: 'Task WBS' },
                operation: { type: 'string', enum: ['run', 'refine', 'verify'] },
                status: { type: 'string', description: 'Task status (default: read from the task file)' },
                recovery: { type: 'boolean', description: 'Return the one-shot recovery hop instead of a decision' },
            },
            required: ['wbs'],
            additionalProperties: false,
        },
    },
    {
        name: 'sp_task_batch_plan',
        annotations: READ_TOOL,
        description:
            'Project a batch plan from an INLINE JSON task list: mode=waves ({wbs, name}[]) or mode=order ({wbs, dependencies?, files?}[]). `tasks` is JSON text, never a file path.',
        inputSchema: {
            type: 'object',
            properties: {
                mode: { type: 'string', enum: ['waves', 'order'] },
                tasks: { type: 'string', description: 'Inline JSON array (never a file path)' },
            },
            required: ['mode', 'tasks'],
            additionalProperties: false,
        },
    },
    {
        name: 'sp_task_transition',
        annotations: WRITE_TOOL,
        description:
            'Move one task to another status through the guarded transition seam (verdict and structural gates apply exactly as in the CLI).',
        inputSchema: {
            type: 'object',
            properties: {
                wbs: { type: 'string', description: 'Task WBS' },
                to: { type: 'string', description: 'Target status (todo, wip, verifying, done, blocked, ...)' },
            },
            required: ['wbs', 'to'],
            additionalProperties: false,
        },
    },
    {
        name: 'sp_task_list',
        annotations: READ_TOOL,
        description: 'List Spur tasks, optionally filtered.',
        inputSchema: {
            type: 'object',
            properties: {
                status: { type: 'string' },
                featureId: { type: 'string' },
                parentWbs: { type: 'string' },
                folder: { type: 'string' },
            },
            additionalProperties: false,
        },
    },
];

/** One handler per descriptor name; the module entry's dispatcher delegates here. */
export const dispatch: Record<string, ToolHandler> = {
    sp_task_show: async (ctx, args) => ctx.taskService().show(requiredString(args, 'wbs')),
    sp_task_list: async (ctx, args) => ctx.taskService().list(taskListFilters(args)),
    sp_task_create: async (ctx, args) => {
        const result = await ctx.taskService().create({
            title: requiredString(args, 'title'),
            ...(optionalString(args, 'featureId') !== undefined
                ? { featureId: optionalString(args, 'featureId') as string }
                : {}),
            ...(optionalString(args, 'parentWbs') !== undefined
                ? { parentWbs: optionalString(args, 'parentWbs') as string }
                : {}),
            ...(optionalString(args, 'template') !== undefined
                ? { template: optionalString(args, 'template') as string }
                : {}),
            ...(optionalString(args, 'requirements') !== undefined
                ? { requirements: optionalString(args, 'requirements') as string }
                : {}),
            ...(optionalString(args, 'plan') !== undefined ? { plan: optionalString(args, 'plan') as string } : {}),
        });
        // 1392 R1: no ready-prep dispatch from a server tool — the agent refines explicitly.
        return {
            wbs: result.ref.id,
            // `WriteResult` carries the path on `ref` (1392 R1 asks for `filePath`).
            filePath: result.ref.filePath,
            warnings: (result as { warnings?: string[] }).warnings ?? [],
            readiness: 'skipped',
        };
    },
    sp_task_update: async (ctx, args) => {
        const wbs = requiredString(args, 'wbs');
        const section = optionalString(args, 'section');
        const field = optionalString(args, 'field');
        const addTags = stringArray(args, 'addTags');
        const removeTags = stringArray(args, 'removeTags');
        const chosen = [
            section !== undefined,
            field !== undefined,
            addTags !== undefined || removeTags !== undefined,
        ].filter(Boolean).length;
        if (chosen !== 1) {
            throw new InvalidArgumentsError(
                'sp_task_update takes exactly one of section+content, field+value, or addTags/removeTags',
            );
        }
        if (args.append === true && section === undefined) {
            throw new InvalidArgumentsError('sp_task_update append is only valid with section+content');
        }
        if (field === 'status') {
            // R5: a status write must go through the guarded transition seam, never here.
            throw new InvalidArgumentsError(
                'sp_task_update refuses field "status": use sp_task_transition so the guards run',
            );
        }
        if (section !== undefined) {
            const written = await writeInlineSection(section, requiredString(args, 'content'), (sourceFile) =>
                ctx.taskService().updateSection(wbs, section, sourceFile, args.append === true),
            );
            return { wbs, section, ...summarizeWrite(written) };
        }
        if (field !== undefined) {
            try {
                const written = await ctx.taskService().updateField(wbs, field, requiredString(args, 'value'));
                return { wbs, field, ...summarizeWrite(written) };
            } catch (error) {
                throw withServiceCode(error);
            }
        }
        const tagged = await ctx.taskService().updateTags(wbs, addTags ?? [], removeTags ?? []);
        return { wbs, tags: tagged.tags, ...summarizeWrite(tagged) };
    },
    sp_task_transition: async (ctx, args) => {
        const wbs = requiredString(args, 'wbs');
        const rawTarget = requiredString(args, 'to');
        let to: string;
        try {
            to = normalizeTaskStatus(rawTarget);
        } catch (error) {
            throw new InvalidArgumentsError(error instanceof Error ? error.message : String(error));
        }
        try {
            const transitioned = await ctx.transitionTask({ wbs, toStatus: to });
            return { ...transitioned };
        } catch (error) {
            // 1392 R4: the guard's code and message travel together, exactly as the CLI
            // reports them, so an agent can branch on GUARD_DENIED instead of prose.
            throw withServiceCode(error);
        }
    },
    sp_task_check: async (ctx, args) => {
        const check = ctx.checkService();
        if (check === undefined) {
            // A context that never booted the section matrix cannot run the structural gate.
            throw new Error('task check is unavailable: this server booted without a section matrix');
        }
        const wbs = requiredString(args, 'wbs');
        const task = await ctx.taskService().show(wbs);
        const folders = ctx.planningFolders();
        const result = await check.check(task.filePath, wbs, {
            ...(optionalString(args, 'as') !== undefined ? { asStatus: optionalString(args, 'as') as string } : {}),
            ...(folders.severityOverrides !== undefined ? { severityOverrides: folders.severityOverrides } : {}),
        });
        // `spur task check <wbs> --json` prints a one-entry result list.
        return [result];
    },
    sp_task_sections: async (ctx, args) => {
        const result = await ctx
            .taskService()
            .mutateSections(
                requiredString(args, 'wbs'),
                requiredString(args, 'op') as 'init' | 'add' | 'list',
                optionalString(args, 'section'),
            );
        return { ...result };
    },
    sp_task_deps: async (ctx, args) => {
        try {
            const written = await ctx
                .taskService()
                .mutateDependencies(
                    requiredString(args, 'wbs'),
                    requiredString(args, 'op') as 'set' | 'add' | 'remove' | 'clear',
                    stringArray(args, 'values') ?? [],
                );
            // `DependencyMutationError` codes travel to the caller, as in the CLI.
            return { dependencies: written.dependencies, ...summarizeWrite(written) };
        } catch (error) {
            throw withServiceCode(error);
        }
    },
    sp_task_preflight: async (ctx, args) => {
        const { readCorpusFacts, runPreflight } = await import('@gobing-ai/spur-app/pipeline-steps');
        const wbs = requiredString(args, 'wbs');
        const operation = optionalString(args, 'operation');
        let status = optionalString(args, 'status') ?? null;
        let deps: string[] = [];
        const depStatuses: Record<string, string> = {};
        if (status === null) {
            const facts = await readCorpusFacts(ctx.taskService(), wbs, true, depStatuses);
            status = facts.status;
            deps = facts.deps;
            Object.assign(depStatuses, facts.depStatuses);
        }
        const outcome = runPreflight({
            wbs,
            status,
            deps,
            depStatuses,
            recovery: args.recovery === true,
            json: true,
            operation: operation === 'run' || operation === 'refine' || operation === 'verify' ? operation : null,
            force: false,
            filteredCount: null,
            requiredSections: [],
            presentSections: [],
            classifyFeature: null,
        });
        // Empty stdout is the usage path (no status resolvable) — the caller's arguments.
        if (outcome.stdout === '') throw new InvalidArgumentsError(outcome.stderr.trim());
        return { exitCode: outcome.exitCode, result: JSON.parse(outcome.stdout) as unknown };
    },
    sp_task_batch_plan: async (_ctx, args) => {
        const { runBatchPlan } = await import('@gobing-ai/spur-app/pipeline-steps');
        const inline = requiredString(args, 'tasks');
        // Inline JSON only: the read callback answers with the caller's own text, so the
        // server never opens a caller-named path.
        const outcome = await runBatchPlan({ mode: requiredString(args, 'mode'), tasks: '(inline)' }, () => inline);
        if (outcome.exitCode !== 0) {
            throw new InvalidArgumentsError(outcome.stderr.trim() || 'sp_task_batch_plan: invalid request');
        }
        return JSON.parse(outcome.stdout) as unknown;
    },
};

/** The `sp_task_list` filters; absent keys stay undefined so the service sees no filter. */
function taskListFilters(args: Record<string, unknown>): {
    status?: string;
    featureId?: string;
    parentWbs?: string;
    folder?: string;
} {
    const filters: { status?: string; featureId?: string; parentWbs?: string; folder?: string } = {};
    for (const key of ['status', 'featureId', 'parentWbs', 'folder'] as const) {
        const value = optionalString(args, key);
        if (value !== undefined) filters[key] = value;
    }
    return filters;
}
