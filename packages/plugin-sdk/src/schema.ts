import { z } from 'zod';

// ── Trust level ──────────────────────────────────────────────────────

export const TrustLevelSchema = z.enum(['bundled', 'curated', 'local', 'untrusted']);

// ── Capabilities manifest ────────────────────────────────────────────

export const CapabilitiesSchema = z
    .object({
        commands: z.array(z.string()).optional(),
        api: z.array(z.string()).optional(),
        ui: z.array(z.string()).optional(),
        events: z.array(z.string()).optional(),
        harnesses: z.array(z.string()).optional(),
        providers: z.array(z.string()).optional(),
        rules: z.array(z.string()).optional(),
        skills: z.array(z.string()).optional(),
        workers: z.array(z.string()).optional(),
    })
    .strict();

export type CapabilitiesManifest = z.infer<typeof CapabilitiesSchema>;

// ── Allow block (policy only in 5a) ──────────────────────────────────

export const AllowSchema = z
    .object({
        filesystem: z.array(z.string()).optional(),
        network: z.array(z.string()).optional(),
        commands: z.array(z.string()).optional(),
    })
    .strict();

// ── Plugin manifest ──────────────────────────────────────────────────

export const PluginManifestSchema = z
    .object({
        name: z.string().regex(/^[a-z][a-z0-9-]*$/),
        version: z.string(),
        description: z.string().optional(),
        author: z.string().optional(),
        trust: TrustLevelSchema,
        capabilities: CapabilitiesSchema.default({}),
        allow: AllowSchema.optional(),
        config: z.record(z.string(), z.unknown()).optional(),
    })
    .strict();

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

// ── Plugin config schema (base; plugins may extend) ──────────────────

export const PluginConfigSchema = z.record(z.string(), z.unknown());

export type PluginConfig = z.infer<typeof PluginConfigSchema>;

// ── Error class ──────────────────────────────────────────────────────

export class PluginManifestError extends Error {
    public readonly issues: z.ZodIssue[];

    constructor(error: z.ZodError) {
        const paths = error.issues.map((i) => i.path.join('.')).join(', ');
        super(`Invalid plugin manifest: ${paths}`);
        this.name = 'PluginManifestError';
        this.issues = error.issues;
    }
}

// ── Validator ────────────────────────────────────────────────────────

/** Validate an already-parsed YAML object; throws PluginManifestError with path-pointed messages on failure. */
export function validateManifest(parsed: unknown): PluginManifest {
    const result = PluginManifestSchema.safeParse(parsed);
    if (!result.success) {
        throw new PluginManifestError(result.error);
    }
    return result.data;
}
