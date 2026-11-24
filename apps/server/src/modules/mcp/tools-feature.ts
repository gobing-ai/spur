/**
 * Feature tools: read, create, section/field writes, guarded transition, sync and refresh.
 *
 * Task 1445 R7 split: the descriptors and handlers that used to sit in `index.ts`, moved here
 * verbatim so each domain owns one file.
 */

import type { FeatureSyncOptions } from '@gobing-ai/spur-app';
import { FEATURE_STATUSES, normalizeFeatureStatus } from '@gobing-ai/spur-domain';
import { InvalidArgumentsError, type McpToolDescriptor } from './protocol';
import {
    optionalString,
    READ_TOOL,
    requiredString,
    summarizeWrite,
    type ToolHandler,
    WRITE_TOOL,
    withServiceCode,
    writeInlineSection,
} from './tools-shared';

/** Descriptor rows the module entry composes into `TOOL_DESCRIPTORS`. */
export const descriptors: McpToolDescriptor[] = [
    {
        name: 'sp_feature_check',
        annotations: READ_TOOL,
        description: 'Run the feature structure/acceptance check. Read-only.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Feature id (e.g. "J94")' },
                as: {
                    type: 'string',
                    enum: ['backlog', 'active', 'verifying', 'done'],
                    description: 'Target lifecycle state',
                },
                strict: { type: 'boolean', description: 'Fail on any finding rather than advisory ones only' },
            },
            required: ['id'],
            additionalProperties: false,
        },
    },
    {
        name: 'sp_feature_show',
        annotations: READ_TOOL,
        description: 'Show one Spur feature: metadata plus the full markdown content. Read-only.',
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string', description: 'Feature id (e.g. "A1")' } },
            required: ['id'],
            additionalProperties: false,
        },
    },
    {
        name: 'sp_feature_list',
        annotations: READ_TOOL,
        description: 'List features, optionally filtered by status, or by direct parent id (DD-14 id tree).',
        inputSchema: {
            type: 'object',
            properties: {
                status: {
                    type: 'string',
                    description: `Lifecycle status filter (${FEATURE_STATUSES.join(', ')})`,
                },
                parentId: { type: 'string', description: 'Direct parent feature id (its 9 child slots)' },
            },
            additionalProperties: false,
        },
    },
    {
        name: 'sp_feature_create',
        annotations: WRITE_TOOL,
        description: 'Create one feature from a name, optionally as a child of a parent feature (DD-14 id allocation).',
        inputSchema: {
            type: 'object',
            properties: {
                name: { type: 'string', description: 'Feature name' },
                parentId: { type: 'string', description: 'Parent feature id for a child feature' },
            },
            required: ['name'],
            additionalProperties: false,
        },
    },
    {
        name: 'sp_feature_update',
        annotations: WRITE_TOOL,
        description:
            'Update one feature: exactly one of a section body, or a frontmatter field (priority, tags). Status is refused — use sp_feature_transition, which runs the guards.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Feature id' },
                section: { type: 'string', description: 'Existing section name to replace' },
                content: { type: 'string', description: 'Section body (inline, never a file path)' },
                field: {
                    type: 'string',
                    description: 'Frontmatter field to set: priority or tags (status is refused)',
                },
                value: { type: 'string', description: 'Field value' },
            },
            required: ['id'],
            additionalProperties: false,
        },
    },
    {
        name: 'sp_feature_transition',
        annotations: WRITE_TOOL,
        description:
            'Move one feature to another lifecycle status through the guarded transition seam (graph edges and shell guards apply exactly as in the CLI).',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Feature id' },
                to: { type: 'string', description: 'Target status (declared `to` of an edge from the current status)' },
            },
            required: ['id', 'to'],
            additionalProperties: false,
        },
    },
    {
        name: 'sp_feature_sync',
        annotations: WRITE_TOOL,
        description:
            'Sync a feature derived status from its tasks (dry-run previews without writing); without an id, sync every feature that has linked tasks.',
        inputSchema: {
            type: 'object',
            properties: {
                id: { type: 'string', description: 'Feature id (default: all features with linked tasks)' },
                dryRun: { type: 'boolean', description: 'Preview the proposal without writing' },
                force: { type: 'boolean', description: 'Bypass repeated-BLOCKED suppression' },
            },
            additionalProperties: false,
        },
    },
    {
        name: 'sp_feature_refresh',
        annotations: WRITE_TOOL,
        description:
            'Regenerate features/INDEX.md and each feature `## Tasks` marker region from task feature edges; `id` scopes the Tasks rewrite to one feature.',
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string', description: 'Restrict the Tasks rewrite to this feature id' } },
            additionalProperties: false,
        },
    },
];

/** One handler per descriptor name; the module entry's dispatcher delegates here. */
export const dispatch: Record<string, ToolHandler> = {
    sp_feature_check: async (ctx, args) => {
        const id = requiredString(args, 'id');
        const as = optionalString(args, 'as');
        const strict = args.strict === true;
        const folders = ctx.planningFolders();
        const feature = await ctx.featureService().show(id);
        if (feature === null) throw new Error(`Feature ${id} not found`);
        const { FeatureCheckService } = await import('@gobing-ai/spur-app/feature-check');
        const checked = await new FeatureCheckService(ctx.fs).check(feature.filePath, id, {
            featuresDir: folders.featuresDir,
            tasksDir: folders.tasksDir,
            ...(as !== undefined ? { as } : {}),
            ...(strict ? { strict: true } : {}),
        });
        return Array.isArray(checked) ? [...checked] : { ...checked };
    },
    sp_feature_list: async (ctx, args) => {
        const rawStatus = optionalString(args, 'status');
        let status: string | undefined;
        try {
            status = rawStatus === undefined ? undefined : normalizeFeatureStatus(rawStatus);
        } catch (error) {
            throw new InvalidArgumentsError(error instanceof Error ? error.message : String(error));
        }
        const parentId = optionalString(args, 'parentId');
        const features = await ctx.featureService().list();
        // Filtered here, not in the service: list() takes no filters (R2).
        return features.filter(
            (feature) =>
                (status === undefined || feature.status === status) &&
                // DD-14: a child's id is its parent's id plus exactly one digit.
                (parentId === undefined ||
                    (feature.id.startsWith(parentId) && feature.id.length === parentId.length + 1)),
        );
    },
    sp_feature_show: async (ctx, args) => {
        const id = requiredString(args, 'id');
        const feature = await ctx.featureService().show(id);
        if (feature === null) throw new Error(`Feature ${id} not found`);
        return feature;
    },
    sp_feature_create: async (ctx, args) => {
        const written = await ctx
            .featureService()
            .create(requiredString(args, 'name'), optionalString(args, 'parentId'));
        return { id: written.ref.id, filePath: written.ref.filePath, ...summarizeWrite(written) };
    },
    sp_feature_update: async (ctx, args) => {
        const id = requiredString(args, 'id');
        const section = optionalString(args, 'section');
        const field = optionalString(args, 'field');
        if (section !== undefined) {
            if (field !== undefined) {
                throw new InvalidArgumentsError(
                    'sp_feature_update takes exactly one of section+content or field+value',
                );
            }
            const written = await writeInlineSection(section, requiredString(args, 'content'), (sourceFile) =>
                ctx.featureService().updateSection(id, section, sourceFile),
            );
            return { id, section, ...summarizeWrite(written) };
        }
        if (field === undefined) {
            throw new InvalidArgumentsError('sp_feature_update takes exactly one of section+content or field+value');
        }
        if (field === 'status') {
            // Same rule as sp_task_update: a status write goes through the guarded seam.
            throw new InvalidArgumentsError(
                'sp_feature_update refuses field "status": use sp_feature_transition so the guards run',
            );
        }
        if (field !== 'priority' && field !== 'tags') {
            throw new InvalidArgumentsError('sp_feature_update field must be priority or tags');
        }
        try {
            const written = await ctx.featureService().update(id, field, requiredString(args, 'value'));
            return { id, field, ...summarizeWrite(written) };
        } catch (error) {
            throw withServiceCode(error);
        }
    },
    sp_feature_transition: async (ctx, args) => {
        try {
            const transitioned = await ctx.transitionFeature({
                id: requiredString(args, 'id'),
                to: requiredString(args, 'to'),
            });
            return { ...transitioned };
        } catch (error) {
            // Same as sp_task_transition: the guard's code survives the envelope.
            throw withServiceCode(error);
        }
    },
    sp_feature_sync: async (ctx, args) => {
        const id = optionalString(args, 'id');
        const options: FeatureSyncOptions = {
            ...(args.dryRun === true ? { dryRun: true } : {}),
            ...(args.force === true ? { force: true } : {}),
        };
        return id === undefined
            ? ctx.featureService().syncAllFeatures(options)
            : ctx.featureService().syncFeature(id, options);
    },
    sp_feature_refresh: async (ctx, args) => {
        const featureId = optionalString(args, 'id');
        return ctx.featureService().refresh(featureId === undefined ? {} : { featureId });
    },
};
