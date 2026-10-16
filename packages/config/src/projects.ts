import { homedir } from 'node:os';
import { join } from 'node:path';
import { getEnvVar } from '@gobing-ai/ts-utils';
import { z } from 'zod';

/** Zod schema for a single project entry in projects.json. */
export const projectEntrySchema = z.object({
    /** Human-readable display name. */
    name: z.string().min(1),
    /** Absolute or tilde-expandable project root path. */
    path: z.string().min(1),
    /** Host for local or remote project (default: 'localhost'). In case of missing or omitted, treated as 'localhost'. */
    host: z.string().optional(),
    /** 0 = stopped; >0 = active listening port. */
    port: z.number().int().nonnegative().default(0),
});

/** Inferred type for {@link projectEntrySchema}. */
export type ProjectEntry = z.infer<typeof projectEntrySchema>;

/** Resolve the effective host for a project entry (default: 'localhost'). */
export function resolveProjectHost(entry?: { host?: string | null }): string {
    if (!entry?.host || entry.host.trim() === '') {
        return 'localhost';
    }
    return entry.host.trim();
}

/** Zod schema for ~/.config/spur/projects.json registry file. */
export const projectsFileSchema = z.object({
    schema_version: z.literal(1).default(1),
    projects: z.array(projectEntrySchema).default([]),
});

/** Inferred type for {@link projectsFileSchema}. */
export type ProjectsFile = z.infer<typeof projectsFileSchema>;

/**
 * Get the path to ~/.config/spur/projects.json.
 * Respects SPUR_PROJECTS_FILE env override for tests and custom locations.
 */
export function getProjectsFilePath(): string {
    const override = getEnvVar('SPUR_PROJECTS_FILE');
    if (override) {
        return override;
    }
    return join(homedir(), '.config', 'spur', 'projects.json');
}
