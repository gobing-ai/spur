import { homedir } from 'node:os';
import { join, normalize } from 'node:path';
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

/** One actionable registry finding, formatted by the CLI and rendered by the Board. */
export interface RegistryFinding {
    /** `prefix-collision` blocks gateway routing; `duplicate-path` blocks host-keyed resolution. */
    kind: 'prefix-collision' | 'duplicate-path';
    /** Prefix claimed by more than one local entry (`prefix-collision` only). */
    prefix?: string;
    /** Entry names involved, in registry order. */
    names: string[];
    /** Project path shared by the entries (`duplicate-path` only). */
    path?: string;
    /** One-line operator-facing message including the remedy. */
    message: string;
}

/**
 * Derive the registry findings an operator must act on: a prefix two local entries claim, and a
 * path registered for more than one host. Both make a route ambiguous, so both are reported by
 * `spur projects list` and the Board from this single derivation.
 */
export function findRegistryFindings(entries: ProjectEntry[]): RegistryFinding[] {
    const canonicalize = canonicalPath;
    const findings: RegistryFinding[] = [];
    for (const [prefix, names] of findPrefixCollisions(entries)) {
        findings.push({
            kind: 'prefix-collision',
            prefix,
            names,
            message: `Prefix ${prefix} is claimed by "${names.join('" and "')}"; set one with spur projects add <path> --prefix /<other>`,
        });
    }
    const byPath = new Map<string, { display: string; names: string[] }>();
    for (const entry of entries) {
        // Compare canonical paths: a remote entry keeps the path as typed while a local one is
        // normalized, so `/private/var/...` and `/var/...` are the same project on macOS.
        const key = canonicalize(entry.path);
        const bucket = byPath.get(key) ?? { display: entry.path, names: [] };
        bucket.names.push(entry.name);
        byPath.set(key, bucket);
    }
    for (const [, { display, names }] of byPath) {
        if (names.length < 2) continue;
        findings.push({
            kind: 'duplicate-path',
            path: display,
            names,
            message: `Path ${display} is registered ${names.length} times; make sure the host you intend is the one serving it`,
        });
    }
    return findings;
}

/**
 * Path identity: expand `~` and normalize separators/segments.
 *
 * shortcut: symlink-level identity (`/private/tmp` vs `/tmp`) needs the filesystem, which this
 * package may not touch (`no-direct-fs-io`); both root spellings are listed in EPHEMERAL_ROOTS so
 * the classification still holds, upgrade if a duplicate pair ever appears in only one spelling.
 */
function canonicalPath(path: string): string {
    return normalize(path.startsWith('~') ? join(homedir(), path.slice(1)) : path);
}

/** Why a registry entry looks stale: two path facts, plus one live-port mismatch. */
export type SuspectReason = 'ephemeral-path' | 'duplicate-path' | 'foreign-port';

/** One registry entry the operator should review, with the reasons that flagged it. */
export interface RegistrySuspect {
    name: string;
    path: string;
    host?: string;
    reasons: SuspectReason[];
    /** One-line operator-facing message naming every reason. */
    message: string;
}

/** Directories whose projects are scaffolding, not long-lived registrations. */
const EPHEMERAL_ROOTS = ['/tmp', '/private/tmp', '/var/folders', '/private/var/folders'];

/** Test-visible override for the ephemeral roots (`TMPDIR` is machine-specific). */
function ephemeralRoots(tmpdir?: string): string[] {
    return tmpdir && tmpdir !== '' ? [...EPHEMERAL_ROOTS, tmpdir] : EPHEMERAL_ROOTS;
}

/**
 * Classify registry entries that `spur projects clean` cannot purge, because their directory still
 * exists: an ephemeral project root (a test fixture under `/tmp` or `$TMPDIR`) or a path registered
 * for more than one host. Classification is read-only — removal is always an explicit operator act.
 */
export function findRegistrySuspects(
    entries: ProjectEntry[],
    options: {
        tmpdir?: string;
        /** Canonical path → the port that path's live owner actually serves, when known. */
        portOwners?: ReadonlyMap<string, number>;
    } = {},
): RegistrySuspect[] {
    const roots = ephemeralRoots(options.tmpdir);
    const canonicalize = canonicalPath;
    const portOwners = options.portOwners;
    const byPath = new Map<string, number>();
    for (const entry of entries) {
        const key = canonicalize(entry.path);
        byPath.set(key, (byPath.get(key) ?? 0) + 1);
    }
    const suspects: RegistrySuspect[] = [];
    for (const entry of entries) {
        const reasons: SuspectReason[] = [];
        // A remote entry's path is a path on THAT host; this machine's roots say nothing about it.
        if (isLocalHost(entry.host)) {
            const canonical = canonicalize(entry.path);
            if (roots.some((root) => canonical === root || canonical.startsWith(`${root}/`))) {
                reasons.push('ephemeral-path');
            }
            if ((byPath.get(canonical) ?? 0) > 1) reasons.push('duplicate-path');
            // A stored port that disagrees with the port the path's live owner serves is a stale
            // number, reported only: removing an entry over a liveness artifact would be destructive.
            const ownerPort = portOwners?.get(canonical);
            if (entry.port > 0 && ownerPort !== undefined && ownerPort !== entry.port) reasons.push('foreign-port');
        }
        if (reasons.length === 0) continue;
        const parts = reasons.map((reason) => {
            if (reason === 'ephemeral-path') return 'path is an ephemeral directory';
            if (reason === 'duplicate-path') return 'path is registered more than once';
            return 'stored port is not the port its owner serves';
        });
        suspects.push({
            name: entry.name,
            path: entry.path,
            ...(entry.host === undefined ? {} : { host: entry.host }),
            reasons,
            message: `${entry.name} (${entry.path}): ${parts.join('; ')}`,
        });
    }
    return suspects;
}
