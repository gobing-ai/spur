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
    /** Gateway URL path prefix for a local entry only, stored as `/slug`. */
    prefix: z.string().optional(),
});

/** First URL segment the gateway owns, so a project may not claim it as a prefix. */
export const RESERVED_PREFIX_SEGMENTS = ['api', 'board', 'modules', '_astro', 'openapi.json', 'health'] as const;

/** Max prefix length after the leading slash. */
const PREFIX_SLUG_MAX = 63;

/** Check whether a host is local (localhost, 127.0.0.1, ::1, or empty/omitted). */
export function isLocalHost(host?: string): boolean {
    if (!host) return true;
    const trimmed = host.trim().toLowerCase();
    return trimmed === 'localhost' || trimmed === '127.0.0.1' || trimmed === '::1' || trimmed === '';
}

/** Lowercase slug of a project display name, used as the default gateway prefix. */
export function slugifyProjectName(name: string): string {
    const slug = name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, PREFIX_SLUG_MAX)
        .replace(/-+$/, '');
    return slug === '' ? 'project' : slug;
}

/** Normalize operator input to the stored form: leading slash, no trailing slash, lowercase. */
export function normalizePrefix(input: string): string {
    const trimmed = input.trim().replace(/\/+$/, '').toLowerCase();
    return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

/** Validate a normalized prefix; returns an actionable message or null. */
export function validatePrefix(prefix: string): string | null {
    const segment = prefix.slice(1).split('/')[0] ?? '';
    if ((RESERVED_PREFIX_SEGMENTS as readonly string[]).includes(segment)) {
        return `Prefix segment "${segment}" is reserved by Spur; choose another with --prefix`;
    }
    if (!/^\/[a-z0-9][a-z0-9-]{0,62}$/.test(prefix)) {
        return `Prefix "${prefix}" is not a slug: use one lowercase segment of letters, digits and dashes, e.g. /knowledge-kit`;
    }
    return null;
}

/**
 * Resolve the gateway prefix a project is routable under.
 *
 * Remote entries never route through the gateway, so they resolve to `null` even when a stored
 * prefix is present (the field is local-only and refused on write).
 */
export function resolveProjectPrefix(entry: Pick<ProjectEntry, 'name' | 'host' | 'prefix'>): string | null {
    if (!isLocalHost(entry.host)) {
        return null;
    }
    return entry.prefix ?? `/${slugifyProjectName(entry.name)}`;
}

/**
 * Map each resolved prefix shared by more than one local entry to those entry names.
 *
 * Derived collisions must not fail a load (a pre-existing registry has to stay readable),
 * so they are reported here for `projects list` and the gateway to surface instead.
 */
export function findPrefixCollisions(entries: ProjectEntry[]): Map<string, string[]> {
    const byPrefix = new Map<string, string[]>();
    for (const entry of entries) {
        const prefix = resolveProjectPrefix(entry);
        if (prefix === null) continue;
        byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), entry.name]);
    }
    return new Map([...byPrefix].filter(([, names]) => names.length > 1));
}

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
