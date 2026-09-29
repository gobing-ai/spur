import { oc } from '@orpc/contract';
import { z } from 'zod';

// ─── Board module catalog wire shapes (task 0989 R4) ───
//
// Deliberately a transport DTO, not the declaration: the catalog is what a client may read,
// so it carries the resolved public URL of an enabled module and never a project-relative or
// absolute filesystem path (R4 "omit filesystem roots and server-only state"). The host
// descriptor mirrors the `board-runtime.json` manifest the Board build emits (task 0988 R2);
// both are transport facts, which is why the shape is restated here instead of imported
// across workspaces.

/** One reserved host identity: a built-in Board module, or a G64-retired route identity. */
export const boardReservedIdentitySchema = z.object({
    id: z.string(),
    route: z.string(),
    retired: z.literal(true).optional(),
    redirectTo: z.string().optional(),
});

/** Host runtime descriptor published alongside the catalog. */
export const boardHostRuntimeSchema = z.object({
    manifestVersion: z.number(),
    contributionApiVersion: z.number(),
    reactVersion: z.string(),
    reactDomVersion: z.string(),
    reactRouterVersion: z.string(),
    /** Supported bare specifier -> same-origin facade asset URL (the document import map). */
    imports: z.record(z.string(), z.string()),
    reservedModules: z.array(boardReservedIdentitySchema),
});

/**
 * One enabled module a client may render.
 *
 * The react variant exposes the asset URLs the server serves under `/modules/:id/*`; the
 * iframe variant exposes the declared frame source. Neither exposes the declaring directory.
 */
export const boardModuleDescriptorSchema = z.discriminatedUnion('type', [
    z.object({
        id: z.string(),
        name: z.string(),
        icon: z.string(),
        type: z.literal('react'),
        route: z.string(),
        entryUrl: z.string(),
        styles: z.array(z.string()),
        sidebarLabel: z.string().optional(),
        description: z.string().optional(),
        order: z.number().optional(),
    }),
    z.object({
        id: z.string(),
        name: z.string(),
        icon: z.string(),
        type: z.literal('iframe'),
        route: z.string(),
        url: z.string(),
        sidebarLabel: z.string().optional(),
        description: z.string().optional(),
        order: z.number().optional(),
    }),
]);

/** Host runtime descriptor inferred from the wire schema. */
export type BoardHostRuntime = z.infer<typeof boardHostRuntimeSchema>;

/** One enabled module descriptor inferred from the wire schema. */
export type BoardModuleDescriptor = z.infer<typeof boardModuleDescriptorSchema>;

/** Read-only catalog response of `GET /api/board/modules`. */
export const boardCatalogSchema = z.object({
    catalogVersion: z.literal(1),
    /**
     * The selected Board distribution's runtime facts. `null` when no web distribution is
     * installed — the standalone serve path still answers the procedure (R6).
     */
    host: boardHostRuntimeSchema.nullable(),
    modules: z.array(boardModuleDescriptorSchema),
});

/** Read-only Board module catalog DTO. */
export type BoardCatalog = z.infer<typeof boardCatalogSchema>;

/**
 * Board catalog contract.
 *
 * Host-owned and read-only: this server publishes what the selected project declared, so the
 * catalog is one procedure on the existing contract, served by the existing OpenAPI/typed
 * client generation (R4). Downstream backend procedures stay out of scope.
 */
export const boardContract = {
    modules: oc
        .route({
            method: 'GET',
            path: '/board/modules',
            summary: 'Read the project Board module catalog',
            tags: ['board'],
        })
        .output(boardCatalogSchema),
};
