import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { CommandOutput } from './output';

/**
 * Version-carrier type registry for `spur builder bump-ver` (task 0854).
 *
 * A "version carrier" is any file whose version must move with a release beyond
 * the built-ins (workspace package.json files; `.claude-plugin/marketplace.json`
 * + entry plugin.json). Projects declare instances in
 * `.spur/config.yaml` → `builder.bump-ver.versionCarriers`; **types** register
 * here. Adding a new carrier type = one `registerCarrierType` call with a zod
 * schema plus whichever hooks it needs — the release flow in `release-ops.ts`
 * never needs structural edits. Keep the `$schema` (`apps/cli/schemas/spur-config.schema.json`)
 * and `docs/design/cli-contracts.md` in the same commit when registering.
 */

type JsonRecord = Record<string, unknown>;

/** Context passed to repo-wide carrier syncs. */
export interface CarrierSyncContext {
    repoRoot: string;
}

/** A per-package version-literal probe produced by a registered carrier. */
export interface LiteralProbe {
    /** Package-relative file carrying a version literal. */
    file: string;
    /** Identifier whose string-literal value carries the version. */
    identifier: string;
}

/**
 * A registered carrier type. Both hooks are optional: repo-wide manifest
 * carriers implement `syncRepoWide`, per-package literal carriers implement
 * `probePackageLiteral`.
 */
export interface CarrierTypeDef<T extends JsonRecord = JsonRecord> {
    /** Validates one carrier instance from `builder.bump-ver.versionCarriers`. */
    schema: z.ZodType<T>;
    /** Sync repo-wide files to the release version; append repo-relative paths to `staged` for the release commit. */
    syncRepoWide?(
        carrier: T,
        ctx: CarrierSyncContext,
        version: string,
        staged: string[],
        output: CommandOutput,
    ): Promise<void>;
    /** Probe a per-package version literal; return the probe or undefined to fall through to the next carrier. */
    probePackageLiteral?(carrier: T, packageDir: string): LiteralProbe | undefined;
}

/** A validated carrier instance plus its registered definition. */
export interface RegisteredCarrier {
    type: string;
    value: JsonRecord;
    def: CarrierTypeDef;
}

/** Fallback literal probe when no registered carrier probes one (pre-0854 behavior). */
export const defaultLiteralProbe: LiteralProbe = { file: 'src/config.ts', identifier: 'binaryVersion' };

const registry = new Map<string, CarrierTypeDef>();

/** Register a carrier type. Re-registering a name replaces the previous definition. */
export function registerCarrierType<T extends JsonRecord>(type: string, def: CarrierTypeDef<T>): void {
    registry.set(type, def as CarrierTypeDef);
}

/** Sorted names of all registered carrier types (used in error messages). */
export function carrierTypeNames(): string[] {
    return [...registry.keys()].sort();
}

/**
 * Validate `builder.bump-ver.versionCarriers` against the registry. Runs at
 * releaseContext build time — before any mutation — so a bad declaration fails
 * loudly with the registered type names instead of deep in the release flow.
 */
export function parseVersionCarriers(raw: unknown): RegisteredCarrier[] {
    if (!Array.isArray(raw)) throw new Error('builder.bump-ver.versionCarriers must be a list');
    return raw.map((entry, index) => {
        if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new Error(`version carrier #${index} must be an object with a "type" field`);
        }
        const type = (entry as JsonRecord).type;
        if (typeof type !== 'string' || type.length === 0) {
            throw new Error(`version carrier #${index} is missing its "type" field`);
        }
        const def = registry.get(type);
        if (!def) {
            throw new Error(`unknown version carrier type "${type}" (registered: ${carrierTypeNames().join(', ')})`);
        }
        return { type, value: def.schema.parse(entry) as JsonRecord, def };
    });
}

/** First registered probe for a package, or undefined when no carrier probes literals. */
export function findLiteralProbe(carriers: RegisteredCarrier[], packageDir: string): LiteralProbe | undefined {
    for (const carrier of carriers) {
        const probe = carrier.def.probePackageLiteral?.(carrier.value, packageDir);
        if (probe) return probe;
    }
    return undefined;
}

async function readJson(path: string): Promise<JsonRecord | null> {
    if (!existsSync(path)) return null;
    try {
        return JSON.parse(await Bun.file(path).text()) as JsonRecord;
    } catch {
        return null;
    }
}

// ── Built-in: plugin-manifest ────────────────────────────────────────────────
/** Repo-wide version-bearing manifests no marketplace entry covers (e.g. per-platform plugin.json mirrors). */
const PluginManifestCarrierSchema = z.object({
    type: z.literal('plugin-manifest'),
    /** Repo-relative manifest paths, synced to the release version and staged. */
    paths: z.array(z.string().min(1)).min(1),
});

registerCarrierType('plugin-manifest', {
    schema: PluginManifestCarrierSchema,
    async syncRepoWide(carrier, { repoRoot }, version, staged, output) {
        for (const rel of carrier.paths) {
            const absPath = join(repoRoot, rel);
            const manifest = await readJson(absPath);
            if (manifest === null) {
                output.write(`  ⚠ ${rel}: not found or malformed — skipping`);
                continue;
            }
            const previous = typeof manifest.version === 'string' ? manifest.version : '(none)';
            manifest.version = version;
            await Bun.write(absPath, `${JSON.stringify(manifest, null, 4)}\n`);
            staged.push(rel);
            output.write(`  ↳ ${rel}: ${previous} → ${version}`);
        }
    },
});

// ── Built-in: ts-literal ─────────────────────────────────────────────────────
/** Version constant inside a package source file (e.g. `binaryVersion: '1.2.3'` in `src/config.ts`). */
const TsLiteralCarrierSchema = z.object({
    type: z.literal('ts-literal'),
    /** Package-relative file probed per workspace member. Default `src/config.ts`. */
    file: z.string().min(1).default('src/config.ts'),
    /** Identifier whose string-literal value carries the version. Default `binaryVersion`. */
    identifier: z.string().min(1).default('binaryVersion'),
});

registerCarrierType('ts-literal', {
    schema: TsLiteralCarrierSchema,
    probePackageLiteral: (carrier) => ({ file: carrier.file, identifier: carrier.identifier }),
});
