import { createRequire } from 'node:module';
import {
    DEFAULT_SOURCE_TIMEOUT_MS,
    HISTORY_SOURCE_TIMEOUT_ENV,
    HistoryService,
    normalizeLegacyTimeoutMs,
    parseTimeoutInput,
    resolvePlanningFolders,
    TaskLocator,
    type TimeoutPolicyMs,
} from '@gobing-ai/spur-app';
import { type CapabilityKind, type CapabilityOrigin, canonicalizeSkillName } from '@gobing-ai/ts-llm-jsonl-importer';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import type { CliContext } from '../../context';

/**
 * Resolve the per-source import execution policy for the history CLI (task 0813 R3):
 * an explicit `--source-timeout` is strictly validated first — `'none'` means
 * unlimited and malformed input is a usage error — then the refresh job's
 * propagated policy env ({@link HISTORY_SOURCE_TIMEOUT_ENV}, legacy channel:
 * invalid values fall back rather than disable the deadline), then the
 * ten-minute application default.
 */
export function resolveCliSourceTimeout(
    explicit: string | undefined,
    env: Record<string, string | undefined>,
): TimeoutPolicyMs {
    if (explicit !== undefined) return parseTimeoutInput(explicit);
    return normalizeLegacyTimeoutMs(env[HISTORY_SOURCE_TIMEOUT_ENV], DEFAULT_SOURCE_TIMEOUT_MS);
}

/**
 * Resolve the running CLI's own invocation path and the resolved importer package version
 * (task 0504 R4). Real-data validation must record which binary actually ran — a rebuilt
 * source-local CLI can otherwise silently lose to a stale global `spur` on PATH. Best-effort:
 * provenance is advisory and must never abort an import.
 */
export async function resolveImportProvenance(fs: FileSystem): Promise<{ binary: string; importer: string }> {
    const binary = process.argv[1] ?? 'unknown';
    let importer = 'unknown';
    try {
        const require = createRequire(import.meta.url);
        const packagePath = require.resolve('@gobing-ai/ts-llm-jsonl-importer/package.json');
        const raw = JSON.parse(await fs.readFile(packagePath)) as unknown;
        const version = raw !== null && typeof raw === 'object' && 'version' in raw ? raw.version : undefined;
        if (typeof version === 'string' && version.length > 0) importer = version;
    } catch {
        // best-effort — no resolved package.json (e.g. dev alias) degrades to 'unknown'
    }
    return { binary, importer };
}

export const CAPABILITY_KINDS: ReadonlySet<string> = new Set(['command', 'subagent', 'skill']);

/**
 * Parse one `--capability-origin` spec (E93 task 1029):
 * `source:skillName:artifactDigest:capabilityKind:originIdentity` — the five fields the
 * importer's `CapabilityOrigin` requires (`skillPath` stays a flag-less omission; the
 * importer derives it when the index knows the artifact). Malformed input is a usage
 * error, never a silent skip: a mis-typed origin would silently downgrade classification.
 */
export function parseCapabilityOriginSpec(spec: string): CapabilityOrigin {
    // Structural split, not fixed 5-way: canonical harness names contain colons
    // (`sp:demo`), so `source` is the first segment and digest:kind:originIdentity are
    // the last three — the colon-bearing remainder in between is the skill name.
    const parts = spec.split(':').map((part) => part.trim());
    const source = parts[0];
    const [artifactDigest, kind, originIdentity] = parts.slice(-3);
    const skillName = parts.slice(1, -3).join(':');
    if (parts.length < 5 || !source || !skillName || !artifactDigest || !kind || !originIdentity) {
        throw new Error(
            `--capability-origin expects source:skillName:artifactDigest:capabilityKind:originIdentity (got ${parts.length} parts)`,
        );
    }
    if (!/^[0-9a-f]{64}$/.test(artifactDigest)) {
        throw new Error('--capability-origin: artifactDigest must be a 64-char lowercase sha-256 hex digest');
    }
    if (!CAPABILITY_KINDS.has(kind)) {
        throw new Error(`--capability-origin: capabilityKind must be one of command|subagent|skill (got '${kind}')`);
    }
    // Canonicalize like the importer does (harness names `sp-demo` -> `sp:demo`):
    // matchCapabilityOrigin compares the origin's skillName to the observed canonical
    // name verbatim, so a non-canonical flag value would silently never classify.
    return {
        source,
        skillName: canonicalizeSkillName(skillName),
        artifactDigest,
        capabilityKind: kind as CapabilityKind,
        originIdentity,
    };
}

// One construction site for the service context (J8 R2): `agentConfig` feeds the
// analyze artifact's executor ladderSnapshot; the import path never reads it.
// `taskLocator` feeds the verified-outcome fold (0712) — absent when folder
// resolution fails, so analyze degrades to omitting the additive block.
export async function makeHistoryService(context: CliContext, capabilityOrigins?: readonly CapabilityOrigin[]) {
    let taskLocator: { findByWbs(wbs: string): Promise<{ filePath: string } | null> } | undefined;
    try {
        const { foldersConfig } = await resolvePlanningFolders(context.fs);
        taskLocator = TaskLocator.forDirs(context.fs, [
            context.fs.resolve(foldersConfig.active_folder),
            ...Object.keys(foldersConfig.folders ?? {}).map((f) => context.fs.resolve(f)),
        ]);
    } catch {
        taskLocator = undefined;
    }
    // 0726 R1: resolve importer provenance before service construction so the
    // full-pi-import guard sees the real installed version, not 'unknown'.
    const provenance = await resolveImportProvenance(context.fs);
    return new HistoryService({
        getDb: () => context.getDb(),
        agentConfig: context.agentConfig,
        ...(taskLocator ? { taskLocator } : {}),
        importerVersion: provenance.importer,
        ...(capabilityOrigins ? { capabilityOrigins } : {}),
        fs: context.fs,
        cwd: context.cwd,
    });
}

/**
 * Parse `--top <n>`: a positive integer, or `undefined` when the flag is absent.
 *
 * Throws on anything else. Silently dropping an unparseable value rendered the
 * whole artifact as if no narrowing had been asked for — indistinguishable, in the
 * output, from a deliberate full report (task 0564 R3: "never a silent unfiltered
 * render"). Exported as a test seam.
 */
export function parseTopOrThrow(raw: string | undefined): number | undefined {
    if (raw === undefined) return undefined;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1) {
        throw new Error(`--top must be a positive integer (got "${raw}")`);
    }
    return n;
}
