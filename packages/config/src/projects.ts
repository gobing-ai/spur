import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

/** Zod schema for a single project entry in projects.json. */
export const projectEntrySchema = z.object({
    /** Human-readable display name. */
    name: z.string().min(1),
    /** Absolute or tilde-expandable project root path. */
    path: z.string().min(1),
    /** 0 = stopped; >0 = active listening port. */
    port: z.number().int().nonnegative().default(0),
});

/** Inferred type for {@link projectEntrySchema}. */
export type ProjectEntry = z.infer<typeof projectEntrySchema>;

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
    if (process.env.SPUR_PROJECTS_FILE) {
        return process.env.SPUR_PROJECTS_FILE;
    }
    return join(homedir(), '.config', 'spur', 'projects.json');
}
