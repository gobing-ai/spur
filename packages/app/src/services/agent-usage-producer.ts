/**
 * Run-once codexbar usage producer (feature B6, task 0892; design
 `docs/design/session-pinned-dispatch.md` §3.4). An external scheduler (cron/
 * launchd) runs `spur agent usage`; Spur never schedules it itself (0892 R4).
 *
 * One invocation: capture provider usage → classify with the fixed exhaustion
 * rule → map providers to configured executors (`agent.executors[].agent`,
 * or the model's `<provider>/` prefix) → record `owner: quota` observations
 * into `agent_executor_updates` (the task-0799/0890 delivery table) → drain
 * them through {@link drainPendingAgentQuotaUpdates} — the single availability
 * write path. The producer emits observations; it never edits YAML itself.
 *
 * Exhaustion rule (fixed at readiness, not per-implementation): a provider is
 * exhausted when any non-null `primary|secondary|tertiary` window has
 * `usedPercent >= 100`, and has headroom when every non-null window is below
 * 100. `extraRateWindows` is preserved in the snapshot `raw` only. A provider
 * whose windows are all null carries no signal and is skipped as `no-usage`.
 *
 * Fail-closed (0892 R3): a missing binary or an unparsable/non-array payload
 * throws before anything is written — snapshot and previous observations stay
 * intact. codexbar's non-zero exit with a parsable array is NOT a failure:
 * `{ "error": … }` entries are skipped per provider (listed, no observation,
 * never treated as recovery) while healthy entries still apply.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { type AgentExecutorConfig, normalizeExecutorAvailability } from '@gobing-ai/spur-config';
import { normalizeQuotaTimestamp, resolveQuotaExecutorBinding } from '@gobing-ai/spur-config/agent-quota-events';
import { AgentExecutorUpdateDao, type DbAdapter } from '@gobing-ai/spur-domain';
import { z } from 'zod';
import {
    type AgentQuotaDrainSummary,
    type AgentQuotaUpdatesContext,
    drainPendingAgentQuotaUpdates,
} from './agent-quota-updates';
import { type UsageSource, UsageSourceError } from './agent-usage-source';

/** One codexbar rate window (P1-verified shape; floats allowed). */
const codexbarWindowSchema = z.object({
    usedPercent: z.number(),
    resetsAt: z.string().optional(),
    windowMinutes: z.number().optional(),
    resetDescription: z.string().optional(),
});

/** One codexbar provider entry: healthy (`usage`) or failed (`error`). */
const codexbarEntrySchema = z
    .object({
        provider: z.string().min(1),
        source: z.string().optional(),
        error: z
            .object({ code: z.unknown().optional(), message: z.string().optional(), kind: z.string().optional() })
            .passthrough()
            .optional(),
        usage: z
            .object({
                updatedAt: z.string().optional(),
                primary: codexbarWindowSchema.nullish(),
                secondary: codexbarWindowSchema.nullish(),
                tertiary: codexbarWindowSchema.nullish(),
                extraRateWindows: z.unknown().optional(),
            })
            .passthrough()
            .optional(),
    })
    .passthrough();

type CodexbarEntry = z.infer<typeof codexbarEntrySchema>;

/** The named primary/secondary/tertiary windows of one healthy entry. */
const RATE_WINDOW_NAMES = ['primary', 'secondary', 'tertiary'] as const;

/** Classified per-provider outcome used for rows, changes and the snapshot. */
export type ProviderUsageStatus = 'exhausted' | 'headroom' | 'no-usage' | 'error';

/** Exhaustion classification of one healthy provider entry (module rule, see file header). */
export interface ProviderUsageClassification {
    status: Exclude<ProviderUsageStatus, 'error'>;
    /** First exhausted window, when {@link status} is `exhausted`. */
    exhaustedWindow:
        | { name: (typeof RATE_WINDOW_NAMES)[number]; usedPercent: number; resetsAt: string | undefined }
        | undefined;
}

/** Fail-closed producer failure after a usable capture (unparsable payload, unusable config). */
export class AgentUsageProducerError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AgentUsageProducerError';
    }
}

/** Classify one healthy provider entry against the fixed exhaustion rule. */
export function classifyProviderUsage(usage: NonNullable<CodexbarEntry['usage']>): ProviderUsageClassification {
    for (const name of RATE_WINDOW_NAMES) {
        const window = usage[name];
        if (window !== null && window !== undefined && window.usedPercent >= 100) {
            return {
                status: 'exhausted',
                exhaustedWindow: { name, usedPercent: window.usedPercent, resetsAt: window.resetsAt },
            };
        }
    }
    const hasWindow = RATE_WINDOW_NAMES.some((n) => usage[n] !== null && usage[n] !== undefined);
    return hasWindow
        ? { status: 'headroom', exhaustedWindow: undefined }
        : { status: 'no-usage', exhaustedWindow: undefined };
}

/**
 * Map provider slugs to executor names (0892 R1): an executor serves a
 * provider when its `agent` field equals the provider (case-insensitive) or
 * its `model` is prefixed `<provider>/`. Deterministic and conservative —
 * providers with no match are listed as unmapped, never guessed.
 */
export function mapProvidersToExecutors(
    providers: readonly string[],
    executors: readonly AgentExecutorConfig[],
): Map<string, string[]> {
    const mapping = new Map<string, string[]>();
    for (const provider of providers) {
        const lower = provider.toLowerCase();
        const names = executors
            .filter(
                (e) =>
                    (e.agent ?? '').toLowerCase() === lower ||
                    (typeof e.model === 'string' && e.model.split('/')[0]?.toLowerCase() === lower),
            )
            .map((e) => e.name);
        if (names.length > 0) mapping.set(provider, names);
    }
    return mapping;
}

/** Render one availability side of a change row for output/snapshot. */
function describeAvailability(state: { disabled: boolean; owner: string | undefined }): string {
    return state.disabled ? `disabled(${state.owner ?? 'quota'})` : 'enabled';
}

/** Observation reason per the fixed rule: window name + resetsAt go into the reason (0892 R1). */
function observationReason(provider: string, classification: ProviderUsageClassification): string {
    if (classification.status === 'exhausted' && classification.exhaustedWindow !== undefined) {
        const { name, usedPercent, resetsAt } = classification.exhaustedWindow;
        return `codexbar ${provider} exhausted: ${name} window usedPercent ${usedPercent}%${
            resetsAt !== undefined ? ` (resetsAt ${resetsAt})` : ''
        }`;
    }
    return `codexbar ${provider} headroom: all usage windows below 100%`;
}

/** One mapped executor's would-be/applied availability change. */
export interface AgentUsageChange {
    executor: string;
    /** Providers that drove this change (all mapped providers of the executor). */
    providers: string[];
    from: string;
    to: string;
    /** Observation owner — always `quota` from this producer (0892 R1). */
    owner: 'quota';
    reason: string;
    action: 'applied' | 'would-apply' | 'no-op';
}

/** Per-provider summary recorded in the snapshot's `providers` array. */
export interface AgentUsageProviderSummary {
    provider: string;
    status: ProviderUsageStatus;
    mappedExecutors: string[];
    reason?: string;
    message?: string;
}

/** Result of one producer run. */
export interface AgentUsageRunResult {
    source: string;
    capturedAt: string;
    /** Snapshot path, or `null` for `--dry-run` (nothing written). */
    snapshotPath: string | null;
    changes: AgentUsageChange[];
    erroredProviders: Array<{ provider: string; message?: string }>;
    /** Healthy providers that match no configured executor — listed, never guessed (0892 R1). */
    unmappedProviders: string[];
    /** Healthy providers whose windows are all null — no signal, skipped. */
    noUsageProviders: string[];
    /** Drain summary; `null` for `--dry-run`. */
    drain: AgentQuotaDrainSummary | null;
}

/** Structural context the producer shares with the quota-update consumer. */
export type AgentUsageProducerContext = Pick<
    AgentQuotaUpdatesContext,
    'getDb' | 'projectRoot' | 'loadAgentConfig' | 'warn'
>;

/** Injectable seams for tests: source, snapshot location, clock. */
export interface RunAgentUsageOptions {
    source?: UsageSource;
    /** Snapshot override; default `~/.config/spur/agent-usage.json` (0892 R1). */
    snapshotPath?: string;
    /** Print would-be changes; write neither snapshot nor config (0892 R2). */
    dryRun?: boolean;
    now?: () => Date;
}

/**
 * The default snapshot location derivation (HOME read) lives in the CLI layer —
 * `packages/app` forbids direct environment reads; callers pass an explicit `snapshotPath`.
 */

/** Atomic snapshot write (tmp + rename in the target directory). */
async function writeSnapshotAtomic(path: string, payload: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${randomUUID()}`;
    await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`);
    await rename(tmp, path);
}

/**
 * Run one producer pass. Throws {@link UsageSourceError} (capture) or
 * {@link AgentUsageProducerError} (parse/config) fail-closed before any
 * write; healthy entries still apply when only some providers errored.
 */
export async function runAgentUsageProducer(
    context: AgentUsageProducerContext,
    options: RunAgentUsageOptions = {},
): Promise<AgentUsageRunResult> {
    // Spawn-capable source is injected by the CLI layer (packages/app forbids spawn).
    const source = options.source;
    if (!source) {
        throw new AgentUsageProducerError(
            'no usage source provided — the CLI layer injects the codexbar capture source',
        );
    }
    const capturedAt = (options.now ?? (() => new Date()))().toISOString();
    const capture = await source.capture();
    let parsed: unknown;
    try {
        parsed = JSON.parse(capture.stdout);
    } catch (error) {
        throw new AgentUsageProducerError(
            `${source.name} output is not valid JSON (exit ${capture.exitCode}): ${
                error instanceof Error ? error.message : String(error)
            }${capture.stderr.trim() !== '' ? ` — stderr: ${capture.stderr.trim().slice(0, 300)}` : ''}`,
        );
    }
    if (!Array.isArray(parsed)) {
        throw new AgentUsageProducerError(
            `${source.name} output is not a JSON array of provider entries (got ${typeof parsed})`,
        );
    }
    const entries: Array<{ entry: CodexbarEntry | undefined; raw: unknown }> = parsed.map((raw) => {
        const result = codexbarEntrySchema.safeParse(raw);
        return { entry: result.success ? result.data : undefined, raw };
    });
    const erroredProviders = entries
        .filter(({ entry }) => entry === undefined || entry.error !== undefined)
        .map(({ entry }) => ({
            provider: entry?.provider ?? '(unnamed entry)',
            message: entry?.error?.message ?? (entry === undefined ? 'malformed entry' : undefined),
        }));
    const healthy = entries
        .map(({ entry }) => entry)
        .filter(
            (entry): entry is CodexbarEntry & { usage: NonNullable<CodexbarEntry['usage']> } =>
                entry !== undefined && entry.error === undefined && entry.usage !== undefined,
        )
        .map((entry) => ({ entry, classification: classifyProviderUsage(entry.usage) }));

    const config = await context.loadAgentConfig(context.projectRoot);
    if (config === null) throw new AgentUsageProducerError('effective agent config unavailable');
    const executors = config.agent?.executors ?? [];

    const healthyProviders = healthy.map(({ entry }) => entry.provider);
    const mapping = mapProvidersToExecutors(healthyProviders, executors);
    const mappedSet = new Set(mapping.keys());
    const unmappedProviders = [...new Set(healthyProviders)].filter((p) => !mappedSet.has(p));
    const noUsageProviders = healthy.filter((h) => h.classification.status === 'no-usage').map((h) => h.entry.provider);

    const providerSummaries: AgentUsageProviderSummary[] = healthy.map(({ entry, classification }) => ({
        provider: entry.provider,
        status: classification.status,
        mappedExecutors: mapping.get(entry.provider) ?? [],
        reason: classification.status === 'no-usage' ? undefined : observationReason(entry.provider, classification),
    }));
    for (const errored of erroredProviders) {
        providerSummaries.push({
            provider: errored.provider,
            status: 'error',
            mappedExecutors: [],
            message: errored.message,
        });
    }

    const snapshotPath = options.snapshotPath;
    if (!snapshotPath) {
        throw new AgentUsageProducerError('no snapshot path provided — the CLI layer derives the default location');
    }
    if (options.dryRun !== true) {
        // Snapshot is written right after a usable parse (0892 R1) — before any
        // DB work, so a drain-side failure still leaves this run's capture durable.
        await writeSnapshotAtomic(snapshotPath, {
            captured_at: capturedAt,
            source: source.name,
            providers: providerSummaries,
            raw: parsed,
        });
    }

    const classificationByProvider = new Map(healthy.map((h) => [h.entry.provider, h.classification]));
    const updatedAtByProvider = new Map(healthy.map((h) => [h.entry.provider, h.entry.usage?.updatedAt]));
    const changes: AgentUsageChange[] = [];
    const pendingRows: Array<Promise<unknown>> = [];
    if (mapping.size > 0) {
        let db: DbAdapter | undefined;
        for (const [executorName, providers] of groupExecutors(mapping)) {
            const profile = resolveQuotaExecutorBinding(executors, executorName);
            if (profile === undefined) continue;
            const entry = executors.find((e) => e.name === executorName);
            const current = normalizeExecutorAvailability(entry?.disabled ?? false);
            // Deterministic severity merge: any mapped provider exhausted → disable;
            // the driver is the alphabetically-first exhausted provider, else the
            // alphabetically-first headroom provider.
            const exhausted = providers.filter((p) => classificationByProvider.get(p)?.status === 'exhausted').sort();
            const driver = exhausted[0] ?? [...providers].sort()[0] ?? '';
            const classification =
                classificationByProvider.get(driver) ?? ({ status: 'headroom' } as ProviderUsageClassification);
            const targetExhausted = exhausted.length > 0;
            const reason = observationReason(driver, classification);
            const needsRow =
                current.disabled !== targetExhausted ||
                (targetExhausted && current.disabled && current.owner !== 'operator');
            const action =
                options.dryRun === true ? (needsRow ? 'would-apply' : 'no-op') : needsRow ? 'applied' : 'no-op';
            changes.push({
                executor: executorName,
                providers,
                from: describeAvailability(current),
                to: targetExhausted ? 'disabled(quota)' : 'enabled',
                owner: 'quota',
                reason,
                action,
            });
            if (options.dryRun !== true && needsRow) {
                db = db ?? (await context.getDb());
                pendingRows.push(
                    recordUsageObservation(context, db, {
                        projectId: context.projectRoot.replace(/[\\/]+$/, ''),
                        executorName,
                        agent: profile.agent,
                        model: profile.model ?? null,
                        disabled: targetExhausted,
                        provider: driver,
                        observedAt: normalizeQuotaTimestamp(updatedAtByProvider.get(driver) ?? '') ?? capturedAt,
                    }),
                );
            }
        }
        await Promise.allSettled(pendingRows);
    }

    const drain =
        options.dryRun === true
            ? null
            : await drainPendingAgentQuotaUpdates({
                  getDb: context.getDb,
                  projectRoot: context.projectRoot,
                  loadAgentConfig: context.loadAgentConfig,
                  warn: context.warn,
              });

    return {
        source: source.name,
        capturedAt,
        snapshotPath: options.dryRun === true ? null : snapshotPath,
        changes,
        erroredProviders,
        unmappedProviders,
        noUsageProviders,
        drain,
    };
}

/** Invert the provider→executors map into executor→providers pairs. */
function groupExecutors(mapping: Map<string, string[]>): Map<string, string[]> {
    const grouped = new Map<string, string[]>();
    for (const [provider, names] of mapping) {
        for (const name of names) {
            const existing = grouped.get(name);
            if (existing === undefined) grouped.set(name, [provider]);
            else existing.push(provider);
        }
    }
    return grouped;
}

/** Record one quota-owned observation row through the 0890 delivery table. */
async function recordUsageObservation(
    context: AgentUsageProducerContext,
    db: DbAdapter,
    row: {
        projectId: string;
        executorName: string;
        agent: string;
        model: string | null;
        disabled: boolean;
        provider: string;
        observedAt: string;
    },
): Promise<void> {
    const dao = new AgentExecutorUpdateDao(db);
    const outcome = await dao.recordObservation({
        project_id: row.projectId,
        executor_name: row.executorName,
        observation_id: `usage-${row.provider}-${randomUUID()}`,
        observed_at: row.observedAt,
        agent: row.agent,
        model: row.model,
        disabled: row.disabled,
        owner: 'quota',
        layer: 'project',
    });
    // The upsert is conditional (latest-observation guard): anything not 'recorded'
    // means this usage observation did not become pending — surface it, never throw.
    if (outcome !== 'recorded') {
        context.warn(`agent usage observation for "${row.executorName}" not recorded (${outcome})`);
    }
}
