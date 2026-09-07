/**
 * Catalog-open system-event ingestion (task 0794 / ADR-110): every emitted
 * event name persists, with the catalog retained as the presentation and
 * promotion layer — never an ingestion gate.
 *
 * Three pieces:
 * - {@link genericSystemEventCatalogEntry} synthesizes a catalog entry for a
 *   name absent from `SYSTEM_EVENT_CATALOG` (prefix = first dot-segment,
 *   renderer `generic`, default tier, payload severity else `info`).
 * - {@link createSystemEventCatchAllSink} builds the shared persist seam used
 *   at both attach points (server boot + CLI ledger): standard envelope
 *   normalization + configured-secret redaction, then a D3c scoped prune.
 * - {@link installSystemEventCatchAll} idempotently wraps the bus `emit` so
 *   uncataloged names persist through a {@link SystemEventSink}. Cataloged
 *   names pass through untouched — the tap/emitter already owns them, so no
 *   duplicate row (R8). Cataloged diagnostic-tier names stay gated by the
 *   diagnostic toggle; the catch-all never rescues them.
 */

import { createId, type SystemEventDao, type SystemEventRetentionQuotas } from '@gobing-ai/spur-domain';
import type { Logger } from '@gobing-ai/ts-infra';
import { type SystemEventCatalogEntry, systemEventCatalogEntry } from './event-names';
import {
    buildSystemEventEnvelope,
    type SystemEventProjectContext,
    systemEventProjectContext,
} from './system-event-envelope';
import {
    DEFAULT_SYSTEM_EVENT_RETENTION_QUOTA,
    resolveRetentionQuotas,
    type SystemEventRetentionConfig,
} from './system-event-retention';
import {
    extractSystemEventActor,
    extractSystemEventCorrelation,
    type SystemEventBus,
    safeStringify,
} from './system-event-tap';

/** Renderer literal persisted on generic (uncataloged) rows — the drift-audit marker (D4). */
export const GENERIC_SYSTEM_EVENT_RENDERER = 'generic';

/** Warn-log event name emitted once per uncataloged name per process (R11). */
export const SYSTEM_EVENT_UNCATALOGED_WARN_EVENT = 'system_events.uncataloged';

/** Async persist seam for one uncataloged emission (raw name + payload). */
export type SystemEventSink = (name: string, payload: unknown) => Promise<void>;

/** Handle returned by {@link installSystemEventCatchAll}. */
export interface SystemEventCatchAll {
    /** Whether this call installed the emit wrapper (`false` when already installed). */
    readonly installed: boolean;
    /** Resolve once every in-flight catch-all persist has settled (test/shutdown drain). */
    flush: () => Promise<void>;
}

/**
 * Synthesize a catalog entry for a name absent from the system-event catalog
 * (D3a). Prefix = the name's first dot-segment; renderer = `generic`; tier =
 * the default (non-diagnostic) tier; severity defaults to `info` — a valid
 * payload `severity` overrides it inside {@link buildSystemEventEnvelope}
 * (Q5: nothing is inferred from the name). Payload projection keeps the same
 * bounded core-metadata allow-list (plus configured-secret redaction) the
 * cataloged metadata-only path uses.
 */
export function genericSystemEventCatalogEntry(name: string): SystemEventCatalogEntry {
    return {
        name,
        prefix: name.split('.')[0] ?? name,
        source: 'bus',
        tier: 'default',
        persisted: true,
        streamed: true,
        payloadPolicy: 'metadata-only',
        renderer: GENERIC_SYSTEM_EVENT_RENDERER,
        producerPackage: 'spur',
        subsystem: 'unknown',
        severity: 'info',
        description: 'Uncataloged system event captured by the generic fallback; pending catalog promotion.',
        metadataFields: [],
        remediationKind: 'none',
    };
}

/**
 * D3c: make sure the quota list carries an observed prefix before a scoped
 * prune. Uncataloged prefixes are absent from `resolveRetentionQuotas` (it
 * enumerates catalog prefixes only, preserving its typo-guard for operator
 * config override keys), so the persist site appends
 * `{ prefix, quota: fallbackQuota }` when absent. Pruning stays scoped to the
 * just-written prefix so one prefix's overflow never evicts another's rows.
 */
export function ensureRetentionQuotaForPrefix(
    quotas: SystemEventRetentionQuotas,
    prefix: string,
    fallbackQuota: number,
): SystemEventRetentionQuotas {
    return quotas.some((quota) => quota.prefix === prefix) ? quotas : [...quotas, { prefix, quota: fallbackQuota }];
}

/** Options for {@link createSystemEventCatchAllSink} — the same DAO/quotas/secrets/project context the tap receives. */
export interface SystemEventCatchAllSinkOptions {
    dao: SystemEventDao;
    logger: Pick<Logger, 'warn'>;
    retention?: SystemEventRetentionConfig;
    secretValues?: readonly string[];
    projectContext?: SystemEventProjectContext;
}

/**
 * Build the shared {@link SystemEventSink} for both catch-all attach points.
 * Persists one uncataloged emission through the standard envelope path
 * (normalization + configured-secret redaction, D3a), then bounds the row's
 * prefix (D3c: append the default quota for the prefix when absent, prune
 * scoped to it). Persist failures are warn-logged and swallowed (R9);
 * {@link SYSTEM_EVENT_UNCATALOGED_WARN_EVENT} is warn-logged once per name per
 * sink (≈ per process, Q4) on first successful persist — the drift signal (R11).
 */
export function createSystemEventCatchAllSink(options: SystemEventCatchAllSinkOptions): SystemEventSink {
    const { dao, logger } = options;
    const quotas = resolveRetentionQuotas(options.retention);
    const fallbackQuota = options.retention?.default ?? DEFAULT_SYSTEM_EVENT_RETENTION_QUOTA;
    const projectContext = options.projectContext ?? systemEventProjectContext('');
    const secretValues = options.secretValues ?? [];
    const driftWarned = new Set<string>();
    return async (name, payload) => {
        const entry = genericSystemEventCatalogEntry(name);
        const actor = extractSystemEventActor(payload);
        try {
            await dao.insert({
                id: createId('sev'),
                event_name: entry.name,
                occurred_at: new Date().toISOString(),
                actor,
                payload_json: safeStringify(
                    buildSystemEventEnvelope(entry, payload, projectContext, secretValues, actor),
                ),
                // Indexed correlation columns: same shared derivation as the
                // cataloged tap/emitter paths, so a row's columns and payload
                // can never disagree.
                ...extractSystemEventCorrelation(payload),
            });
            await dao.pruneQuotas(ensureRetentionQuotaForPrefix(quotas, entry.prefix, fallbackQuota), entry.prefix);
        } catch (error) {
            logger.warn('system_events catch-all: persist failed', {
                event: name,
                error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
            });
            return;
        }
        if (!driftWarned.has(name)) {
            driftWarned.add(name);
            logger.warn(SYSTEM_EVENT_UNCATALOGED_WARN_EVENT, { event: name });
        }
    };
}

/** Property marker stamped on the wrapped `emit` so re-install is a no-op (Q4). */
const CATCH_ALL_MARKER = 'spur.systemEventCatchAll';

/** Loose emit shape the wrapper stamps onto the bus instance. */
type SystemEventEmitFn = (event: string, ...args: unknown[]) => Promise<void>;

/**
 * Idempotently wrap the bus `emit` (D3b): each emission whose name is absent
 * from the catalog is persisted through `sink`; cataloged names pass through
 * untouched — the tap/emitter owns them, so exactly one path writes each row
 * (R8). The wrapper always returns the underlying emit's result and never lets
 * sink failures reach the producer (R9). Prior `bus.emit(...)` call sites
 * resolve the instance property dynamically, so they see the wrapper.
 */
export function installSystemEventCatchAll(bus: SystemEventBus, sink: SystemEventSink): SystemEventCatchAll {
    // SAFETY: EventBus.emit is a prototype method of shape (event, ...args) =>
    // Promise<void>; stamping an instance own-property shadows it for every
    // dynamic `bus.emit(...)` call site, which is the wrapper seam TypeScript
    // cannot express on the generic EventBus type.
    const holder = bus as unknown as { emit: SystemEventEmitFn };
    const current = holder.emit;
    if ((current as Partial<Record<typeof CATCH_ALL_MARKER, boolean>>)[CATCH_ALL_MARKER] === true) {
        return { installed: false, flush: async () => {} };
    }
    const underlying = current.bind(bus);
    const inFlight = new Set<Promise<void>>();
    const wrapped: SystemEventEmitFn = (event, ...args) => {
        const result = underlying(event, ...args);
        if (systemEventCatalogEntry(event) === undefined) {
            // Detached on purpose: the emit path never awaits or fails on
            // ledger writes (R9). The factory-built sink logs its own
            // failures; this catch is the last-resort guard for a
            // contract-breaking sink.
            const pending = Promise.resolve().then(() => sink(event, args[0]));
            inFlight.add(pending);
            void pending
                .catch(() => {})
                .finally(() => {
                    inFlight.delete(pending);
                });
        }
        return result;
    };
    Object.defineProperty(wrapped, CATCH_ALL_MARKER, { value: true });
    holder.emit = wrapped;
    return {
        installed: true,
        flush: async () => {
            while (inFlight.size > 0) {
                await Promise.allSettled([...inFlight]);
            }
        },
    };
}
