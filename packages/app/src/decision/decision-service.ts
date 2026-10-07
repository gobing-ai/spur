import { createHash } from 'node:crypto';
import type { SpurConfig } from '@gobing-ai/spur-config';
import {
    DecisionCatalogError,
    type DecisionDescriptor,
    DecisionHub,
    DecisionMakerRegistry,
    type DecisionResult,
    type DecisionSummary,
    resolveDecisionInput,
    UnknownDecisionError,
    UnknownDecisionMakerError,
} from '@gobing-ai/ts-ai-decision';
import { redactAndBound } from '../observability/agent-execution';
import type { SystemEventBus } from '../services/system-event-tap';
import {
    type DecisionLayerId,
    type DecisionResolution,
    registeredDecisionPaths,
    resolveDecisionCatalogs,
} from './decision-catalog-resolver';
import {
    beginDecisionInvocation,
    type DecisionCallContext,
    type DecisionInvocationContext,
    emitDecisionRejected,
} from './decision-events';

/**
 * Where the effective maker of one decision came from (design §3.6). The first
 * source that is set wins; operator config outranks the shipped catalog
 * because only the machine owner knows which backends exist there.
 */
export type DecisionMakerSource =
    | 'flag'
    | 'config-decision'
    | 'config-default'
    | 'catalog-decision'
    | 'catalog-default';

/** The effective maker for one decision, with the source that selected it. */
export interface EffectiveMaker {
    name: string;
    source: DecisionMakerSource;
}

/** One entry of {@link DecisionService.list}: the hub summary plus its catalog layer. */
export interface DecisionListEntry extends DecisionSummary {
    layer: DecisionLayerId;
}

/** {@link DecisionService.describe} result: the served contract plus maker resolution. */
export interface DecisionDescription {
    id: string;
    type: DecisionSummary['type'];
    description?: string;
    catalog: string;
    layer: DecisionLayerId;
    minConfidence: number;
    /** The closed answer vocabulary (choice criteria) the maker must answer from. */
    criteria: DecisionDescriptor['criteria'];
    fallback: string | number | boolean;
    parameters: Readonly<Record<string, unknown>>;
    /** Catalog model (decision → catalog defaults); absent when neither declares one. */
    model?: string;
    effectiveMaker: EffectiveMaker;
}

/** Per-decision row of {@link DecisionStatus}. */
export interface DecisionStatusRow {
    id: string;
    maker: string;
    source: DecisionMakerSource;
    registered: boolean;
}

/** Readiness report behind `spur decision status` (design §3.4). */
export interface DecisionStatus {
    ok: boolean;
    /** Unresolved per-layer catalog counts, keyed by layer id. */
    layers: Record<DecisionLayerId, number>;
    loadErrors: DecisionResolution['loadErrors'];
    duplicateIds: DecisionResolution['duplicateIds'];
    registeredMakers: string[];
    /** `decisions.maker` as configured, when set. */
    configDefaultMaker?: string;
    /** `decisions.makers.<id>` as configured, when set. */
    configDecisionMakers: Record<string, string>;
    perDecision: DecisionStatusRow[];
    /** Human-readable catalog/maker-config errors; non-empty ⇒ `ok: false`. */
    errors: string[];
}

/** Options for {@link DecisionService.decide}. */
export interface DecideOptions {
    /** `--maker` override; outranks every configured and catalog source. */
    readonly maker?: string;
    /** Optional decision-event bus: lifecycle/rejection events emit only when set. */
    readonly bus?: SystemEventBus;
    /** Caller attribution carried by every emitted decision event. */
    readonly context?: DecisionCallContext;
}

/** One decide outcome plus the maker resolution that served it. */
export type ServedDecision = DecisionResult & { makerSource: DecisionMakerSource };

/**
 * One decision service over one cached hub (design §3.3). The service resolves
 * catalogs, builds `createDecisionHub`-equivalent state with the default maker
 * registry and caches the result per process. `list`/`describe`/`status` never
 * construct a maker; makers are built lazily by the registry on first
 * `decide`. The service never reads `workflow.decideDecisionMaker` — that
 * switch governs only the workflow decide action, while `spur decision run`
 * (and every P1 workflow adoption later, through this same service) is an
 * explicit operator decision point.
 */
export class DecisionService {
    private readonly registry = new DecisionMakerRegistry();
    private readonly resolution: DecisionResolution;
    private readonly hub: DecisionHub;
    /** Decision ids served by two different winning files; `run`/`decide` of these fails closed. */
    private readonly duplicateIds: Map<string, string[]>;
    /** Catalog-level errors beyond file loading (e.g. an unregistered catalog maker), from hub loads. */
    private readonly catalogErrors: string[] = [];

    private constructor(resolution: DecisionResolution) {
        this.resolution = resolution;
        this.duplicateIds = new Map(resolution.duplicateIds.map((d) => [d.id, d.sources]));
        this.hub = new DecisionHub({ registry: this.registry });
        // Feed the hub one catalog at a time, in layer order. An id declared by
        // an earlier winning file is stripped from every LATER file before load
        // (hub.load throws on duplicates): the id stays served from its first
        // file, while decide fails closed via {@link duplicateIds}. Any
        // remaining hub load failure (e.g. a catalog naming an unregistered
        // maker) is reported, never thrown.
        const declaredEarlier = new Set<string>();
        for (const file of resolution.files) {
            const decisions = Object.fromEntries(
                Object.entries(file.catalog.decisions).filter(([id]) => !declaredEarlier.has(id)),
            );
            for (const id of Object.keys(file.catalog.decisions)) declaredEarlier.add(id);
            try {
                this.hub.load({ ...file.catalog, decisions });
            } catch (error) {
                this.catalogErrors.push(error instanceof Error ? error.message : String(error));
            }
        }
    }

    /**
     * Build the service: resolve layers, load winning catalogs, construct the
     * hub. `sharedRoot` is injectable for tests; production uses
     * `bundledConfigRoot()`.
     */
    static async create(config: SpurConfig | null, cwd: string, sharedRoot?: string): Promise<DecisionService> {
        const resolution = await resolveDecisionCatalogs({
            cwd,
            registered: registeredDecisionPaths(config),
            sharedRoot,
        });
        return new DecisionService(resolution).withConfig(config);
    }

    /** Every loaded decision, with the layer its winning file came from. */
    list(): DecisionListEntry[] {
        const layerByFile = new Map(this.resolution.files.map((f) => [f.path, f.layer]));
        return this.hub.list().map((summary) => ({ ...summary, layer: layerByFile.get(summary.source) ?? 'shared' }));
    }

    /** One decision's served contract plus the effective maker and its source. Never constructs a maker. */
    describe(id: string): DecisionDescription {
        const descriptor = this.hub.describe(id); // throws UnknownDecisionError for unknown ids
        const file = this.resolution.files.find((f) => Object.keys(f.catalog.decisions).includes(id));
        const raw = file?.catalog.decisions[id];
        return {
            id,
            type: descriptor.type,
            description: descriptor.description,
            catalog: descriptor.source,
            layer: file?.layer ?? 'shared',
            minConfidence: descriptor.minConfidence,
            criteria: descriptor.criteria,
            fallback: descriptor.fallback,
            parameters: descriptor.parameters,
            model: descriptor.model,
            effectiveMaker: this.effectiveMaker(id, raw?.maker, file?.catalog.defaults.maker),
        };
    }

    /**
     * Serve one decision with fallback-guaranteed semantics (upstream hub) plus
     * maker selection per design §3.6. Caller mistakes — unknown id, duplicate
     * id, unregistered maker from flag or config — reject before any backend
     * call; every backend outcome resolves to the declared fallback.
     */
    async decide(id: string, input?: Record<string, unknown>, options?: DecideOptions): Promise<ServedDecision> {
        const callContext: DecisionCallContext = options?.context ?? { caller: 'cli' };
        const ctx: DecisionInvocationContext = { decisionId: id, ...callContext };
        if (this.duplicateIds.has(id)) {
            const sources = this.duplicateIds.get(id)?.join(', ') ?? '';
            const error = new DecisionCatalogError(
                `decision "${id}" is declared by multiple winning catalogs (${sources}); remove one to unblock decide`,
                sources,
                id,
            );
            emitDecisionRejected(options?.bus, ctx, error);
            throw error;
        }
        let description: DecisionDescription;
        try {
            description = this.describe(id); // UnknownDecisionError before any maker work
        } catch (error) {
            emitDecisionRejected(options?.bus, ctx, error);
            throw error;
        }
        const file = this.resolution.files.find((f) => Object.keys(f.catalog.decisions).includes(id));
        const { name, source } = this.effectiveMaker(
            id,
            file?.catalog.decisions[id]?.maker,
            file?.catalog.defaults.maker,
            options?.maker,
        );
        if (!this.registry.has(name)) {
            const error = new UnknownDecisionMakerError(
                `maker "${name}" for decision "${id}" is not registered (built-ins: ${this.registry.names().join(', ')})`,
                name,
            );
            emitDecisionRejected(options?.bus, ctx, error, name);
            throw error;
        }
        // Task 1113 R1: validate the caller input with the same upstream resolver the
        // hub runs, BEFORE decision.start — a bad parameter must emit only
        // decision.rejected (errorKind `input`), never open a lifecycle the
        // reliability report would read as a maker fault (design §3.1).
        const decisionDefinition = file?.catalog.decisions[id];
        if (decisionDefinition === undefined) {
            // Unreachable after describe() success; fail closed rather than cast.
            const error = new UnknownDecisionError(`decision "${id}" is not served by any loaded catalog`, id);
            emitDecisionRejected(options?.bus, ctx, error);
            throw error;
        }
        try {
            resolveDecisionInput(decisionDefinition, input as Parameters<typeof resolveDecisionInput>[1]);
        } catch (error) {
            emitDecisionRejected(options?.bus, ctx, error);
            throw error;
        }
        const digestSource = evidenceDigestSource(input);
        const invocation = beginDecisionInvocation(options?.bus, ctx, {
            type: description.type,
            maker: name,
            makerSource: source,
            catalogLayer: description.layer,
            inputKeys: Object.keys(input ?? {}),
            // Task 1113 R5: digest the evidence-bearing input consistently — the
            // implicit instructions channel when it is a non-empty string, else a
            // string `evidence` input (the gate path passes evidence there).
            ...(digestSource !== undefined
                ? { evidenceDigest: `sha256:${createHash('sha256').update(digestSource, 'utf8').digest('hex')}` }
                : {}),
            minConfidence: description.minConfidence,
        });
        let outcome: DecisionResult | undefined;
        try {
            outcome = await this.hub.decide(id, input as Parameters<DecisionHub['decide']>[1], { maker: name });
            if (outcome.source === 'model' && outcome.reason === 'accepted') {
                invocation.succeed({ value: outcome.value, confidence: outcome.confidence, maker: outcome.maker });
            } else {
                invocation.fail({
                    reason: outcome.reason,
                    fallbackValue: outcome.value,
                    confidence: outcome.confidence,
                    maker: outcome.maker,
                });
            }
            return { ...outcome, makerSource: source };
        } catch (error) {
            // Task 1113 R2 backstop: an unexpected post-start throw must still keep
            // the fixed order start → failure → end (the old bare finally emitted
            // only end, leaving the lifecycle without a terminal failure event).
            invocation.fail({
                reason: 'error',
                fallbackValue: description.fallback,
                confidence: null,
                maker: name,
                error: redactAndBound(error instanceof Error ? error.message : String(error), [], 512),
            });
            throw error;
        } finally {
            // Always close the lifecycle, even if a maker throw escaped the hub.
            invocation.end(
                outcome !== undefined
                    ? {
                          durationMs: outcome.durationMs,
                          value: outcome.value,
                          source: outcome.source,
                          reason: outcome.reason,
                          maker: outcome.maker,
                          confidence: outcome.confidence,
                      }
                    : { durationMs: 0, reason: 'error', maker: name },
            );
        }
    }

    /** Readiness: layers, load errors, duplicate ids, maker resolution and registration. */
    status(): DecisionStatus {
        const config = this.config;
        const layers = { project: 0, registered: 0, shared: 0 } as Record<DecisionLayerId, number>;
        for (const file of this.resolution.files) layers[file.layer]++;
        const configDefaultMaker = config?.decisions?.maker;
        const configDecisionMakers = config?.decisions?.makers ?? {};
        const errors: string[] = [
            ...this.resolution.loadErrors.map((e) => `load error in ${e.layer} layer (${e.path}): ${e.message}`),
            ...this.resolution.duplicateIds.map((d) => `duplicate decision id "${d.id}" in ${d.sources.join(', ')}`),
            ...this.catalogErrors,
        ];
        if (configDefaultMaker !== undefined && !this.registry.has(configDefaultMaker)) {
            errors.push(
                `configured decisions.maker "${configDefaultMaker}" is not registered (built-ins: ${this.registry.names().join(', ')})`,
            );
        }
        for (const [id, name] of Object.entries(configDecisionMakers)) {
            if (!this.registry.has(name)) {
                errors.push(
                    `configured decisions.makers.${id} "${name}" is not registered (built-ins: ${this.registry.names().join(', ')})`,
                );
            }
        }
        const perDecision = this.list().map((entry): DecisionStatusRow => {
            const file = this.resolution.files.find((f) => Object.keys(f.catalog.decisions).includes(entry.id));
            const { name, source } = this.effectiveMaker(
                entry.id,
                file?.catalog.decisions[entry.id]?.maker,
                file?.catalog.defaults.maker,
            );
            return { id: entry.id, maker: name, source, registered: this.registry.has(name) };
        });
        return {
            ok: errors.length === 0,
            layers,
            loadErrors: this.resolution.loadErrors,
            duplicateIds: this.resolution.duplicateIds,
            registeredMakers: this.registry.names(),
            configDefaultMaker,
            configDecisionMakers,
            perDecision,
            errors,
        };
    }

    /**
     * Maker precedence (design §3.6): flag → `decisions.makers.<id>` →
     * `decisions.maker` → catalog decision entry → catalog defaults. The
     * catalog floor is the hub default (`typesafe`), reported as
     * `catalog-default` because it ships with the catalog layer.
     */
    private effectiveMaker(
        id: string,
        catalogEntryMaker?: string,
        catalogDefaultsMaker?: string,
        flagMaker?: string,
    ): EffectiveMaker {
        const config = this.config;
        if (flagMaker !== undefined) return { name: flagMaker, source: 'flag' };
        const perDecision = config?.decisions?.makers?.[id];
        if (perDecision !== undefined) return { name: perDecision, source: 'config-decision' };
        const global = config?.decisions?.maker;
        if (global !== undefined) return { name: global, source: 'config-default' };
        if (catalogEntryMaker !== undefined) return { name: catalogEntryMaker, source: 'catalog-decision' };
        if (catalogDefaultsMaker !== undefined) return { name: catalogDefaultsMaker, source: 'catalog-default' };
        return { name: this.hub.describe(id).maker, source: 'catalog-default' };
    }

    /** Config threaded at create time; kept off the constructor signature so tests can build without one. */
    private config: SpurConfig | null = null;

    /**
     * Bind the config used for maker resolution (called by {@link create}). Returns a view that
     * shares the loaded catalogs and registry but owns its config, so a later
     * {@link getDecisionService} caller with another config cannot rewrite an earlier caller's.
     */
    withConfig(config: SpurConfig | null): this {
        if (config === this.config) return this;
        return Object.assign(Object.create(this) as this, { config });
    }
}

/** Per-process cache of DecisionService instances, keyed by cwd + shared root (design §3.3). */
const serviceCache = new Map<string, Promise<DecisionService>>();

/**
 * Task 1113 R5 digest source: the implicit `instructions` channel when it is a
 * non-empty string, else a string `evidence` input (gate events pass their
 * evidence there so gate lifecycle rows carry `evidenceDigest`).
 */
function evidenceDigestSource(input: Record<string, unknown> | undefined): string | undefined {
    if (typeof input?.instructions === 'string' && input.instructions !== '') return input.instructions;
    if (typeof input?.evidence === 'string') return input.evidence;
    return undefined;
}

/**
 * Get or build the process-wide service for `cwd`. Config must be the same
 * merged config for every call in one process (the composition root loads it
 * once); a call with a different config object still resolves the cached
 * instance and re-attaches the config for maker resolution.
 */
export async function getDecisionService(
    config: SpurConfig | null,
    cwd: string,
    sharedRoot?: string,
): Promise<DecisionService> {
    // The shared root selects which catalogs load, so it is part of the identity.
    const key = `${cwd}\0${sharedRoot ?? ''}`;
    let pending = serviceCache.get(key);
    if (pending === undefined) {
        pending = DecisionService.create(config, cwd, sharedRoot);
        serviceCache.set(key, pending);
    }
    const service = await pending;
    return service.withConfig(config);
}

// Re-export for consumers (CLI in task 1093) so the app package stays the one
// import site for decision-catalog resolution errors.
export { UnknownDecisionError, UnknownDecisionMakerError };
