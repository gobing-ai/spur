import { createHash } from 'node:crypto';
import { getEnvVars, type SpurConfig } from '@gobing-ai/spur-config';
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
import { createDecisionMaker } from '@gobing-ai/ts-ai-runner';
import { type ClefDriverOptions, createClefDriver } from '@gobing-ai/ts-decision-clef';
import {
    createLayaClient,
    type LayaClient,
    type LayaDriverOptions,
    type LayaWorkerResult,
    type WorkerQuestion,
} from '@gobing-ai/ts-laya-mlx';
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
import type { DecisionLogSink, DecisionLogWrite, DecisionPhase } from './decision-log';

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
    type: DecisionSummary['type'];
    maker: string;
    source: DecisionMakerSource;
    registered: boolean;
    /** Winning catalog layer, so the report can name where the served contract comes from. */
    layer: DecisionLayerId;
    /** Effective confidence floor (decision → catalog defaults → hub default). */
    minConfidence: number;
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
/**
 * Caller-built decision-log plumbing (task 1100): the sink from this caller's own
 * config plus any phases observed before the service call (an evidence read).
 * Absent ⇒ the lifecycle emits events exactly as before with no row written.
 */
export interface DecisionLogOption {
    readonly sink: DecisionLogSink;
    /** Caller prelude: clock opened before pre-service work, with its phases. */
    readonly prelude?: { readonly startedAt: number; readonly phases: readonly DecisionPhase[] };
}

/** Inputs for the decision service's `decide` hop: optional maker override plus engine-context bookkeeping. */
export interface DecideOptions {
    /** `--maker` override; outranks every configured and catalog source. */
    readonly maker?: string;
    /** Optional decision-event bus: lifecycle/rejection events emit only when set. */
    readonly bus?: SystemEventBus;
    /** Caller attribution carried by every emitted decision event. */
    readonly context?: DecisionCallContext;
    /** Decision-log sink (task 1100): every terminal state lands as one `decision_logs` row. */
    readonly decisionLog?: DecisionLogOption;
}

/** One decide outcome plus the maker resolution that served it. */
export type ServedDecision = DecisionResult & { makerSource: DecisionMakerSource };

/** One maker's liveness-probe result (feature P11 R5) — the readiness report's "working now" mark. */
export interface DecisionProbeOutcome {
    maker: string;
    /** The maker answered without falling back (`source: model`). */
    ok: boolean;
    /** The served value; null when no answer was obtained before the deadline. */
    value: string | number | boolean | null;
    reason: DecisionResult['reason'];
    durationMs: number;
}

/**
 * A `laya-local` client Spur owns so it can be released again. The driver the registry builds
 * keeps its worker "warm for the client's lifetime" and exposes no disposal seam, so the piped
 * stdio of its Python worker holds the event loop open: without this, a one-shot Spur process
 * prints its decision result and then never exits (measured: still alive after 150 s, and a
 * ~1 h block in a real session). The real client is built on FIRST ASK rather than here — its
 * constructor runs the Apple-Silicon host check, and `list`/`status` must keep working on a host
 * that cannot serve this backend at all (a construction throw is mapped to `no-backend` by the
 * hub, exactly as the lazy registry factory did before). Rebuilt on demand after {@link dispose}.
 */
class OwnedLayaClient implements LayaClient {
    private client: LayaClient | undefined;

    constructor(private readonly options: LayaDriverOptions) {}

    async ask(state: string, questions: Record<string, WorkerQuestion>): Promise<LayaWorkerResult> {
        this.client ??= createLayaClient(this.options);
        return await this.client.ask(state, questions);
    }

    dispose(): void {
        this.client?.dispose();
        this.client = undefined;
    }
}

/**
 * Per-driver budget for a probe call. A cold local model legitimately needs its load budget
 * (the `laya-local` startup handshake defaults to 120 s), so the probe sets a bounded but
 * generous ceiling per driver rather than racing every call on a short timer — a healthy but
 * cold backend must not be reported as broken.
 */
const PROBE_DRIVER_BUDGET_MS = 120_000;

/**
 * Race `promise` against `budgetMs`; `undefined` when the budget expires first. The abandoned
 * call cannot be cancelled and keeps running, but it holds no ledger or event side effect (the
 * probe passes neither), so the report stays truthful and nothing is written after the fact.
 */
async function raceTimeout<T>(promise: Promise<T>, budgetMs: number): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<undefined>((resolve) => {
                timer = setTimeout(() => resolve(undefined), budgetMs);
            }),
        ]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

/**
 * One decision service over one cached hub (design §3.3). The service resolves
 * catalogs, builds `createDecisionHub`-equivalent state with the default maker
 * registry plus the environment-gated `clef` maker (§3.6) and caches the result
 * per process. `list`/`describe`/`status` never
 * construct a maker; makers are built lazily by the registry on first
 * `decide`. The service never reads `workflows.decideDecisionMaker` — that
 * switch governs only the workflow decide action, while `spur decision run`
 * (and every P1 workflow adoption later, through this same service) is an
 * explicit operator decision point.
 */
export class DecisionService {
    private readonly registry: DecisionMakerRegistry;
    private readonly resolution: DecisionResolution;
    private readonly hub: DecisionHub;
    /** Decision ids served by two different winning files; `run`/`decide` of these fails closed. */
    private readonly duplicateIds: Map<string, string[]>;
    /** Catalog-level errors beyond file loading (e.g. an unregistered catalog maker), from hub loads. */
    private readonly catalogErrors: string[] = [];
    /** Probe-only hub (feature P11 R5): bounded drivers, built on first probe, never by `status`. */
    private probeOnlyHub: DecisionHub | undefined;
    /**
     * Process-backed local driver clients this service owns (today only `laya-local`). Held for
     * {@link dispose}; each entry builds its real client on first ask.
     */
    private readonly ownedLayaClients: OwnedLayaClient[] = [];

    private constructor(resolution: DecisionResolution) {
        this.resolution = resolution;
        this.duplicateIds = new Map(resolution.duplicateIds.map((d) => [d.id, d.sources]));
        const env = getEnvVars();
        this.registry = new DecisionMakerRegistry({
            builtins: {
                makerOptions: { env },
                driverOptions: {
                    'laya-local': { env, client: this.ownLayaClient({ env }) },
                },
            },
        });
        const clef = clefCredentials(env);
        if (clef !== undefined) {
            this.registry.register('clef', () => createDecisionMaker({ driver: createClefDriver(clef) }));
        }
        this.hub = new DecisionHub({ registry: this.registry });
        this.catalogErrors.push(...this.loadCatalogs(this.hub));
    }

    /**
     * Take ownership of one `laya-local` client so {@link dispose} can release its worker.
     */
    private ownLayaClient(options: LayaDriverOptions): LayaClient {
        const owned = new OwnedLayaClient(options);
        this.ownedLayaClients.push(owned);
        return owned;
    }

    /**
     * Release the process-backed local driver clients this service created. A `laya-local` maker
     * holds a warm Python worker whose piped stdio keeps the event loop alive, so a one-shot Spur
     * process prints its result and then hangs forever unless the worker is closed; disposing ends
     * its stdin, the worker exits on EOF and the handles are released. Idempotent, and a later
     * decision simply rebuilds a client — the service stays usable after disposal.
     */
    dispose(): void {
        for (const client of this.ownedLayaClients) client.dispose();
        this.ownedLayaClients.length = 0;
    }

    /**
     * Feed `hub` one catalog at a time, in layer order, returning the load failures.
     * An id declared by an earlier winning file is stripped from every LATER file before
     * load (hub.load throws on duplicates): the id stays served from its first file, while
     * decide fails closed via {@link duplicateIds}. Any remaining hub load failure (e.g. a
     * catalog naming an unregistered maker) is reported, never thrown.
     */
    private loadCatalogs(hub: DecisionHub): string[] {
        const errors: string[] = [];
        const declaredEarlier = new Set<string>();
        for (const file of this.resolution.files) {
            const decisions = Object.fromEntries(
                Object.entries(file.catalog.decisions).filter(([id]) => !declaredEarlier.has(id)),
            );
            for (const id of Object.keys(file.catalog.decisions)) declaredEarlier.add(id);
            try {
                hub.load({ ...file.catalog, decisions });
            } catch (error) {
                errors.push(error instanceof Error ? error.message : String(error));
            }
        }
        return errors;
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

    /**
     * Serve one liveness probe with a bounded maker (feature P11 R5). The probe gets its own
     * registry so a budget never shortens a real decision call: `probeDriverBudgetMs` is the
     * DRIVER's own timeout (`timeoutMs` for the hosted backend, `startupTimeoutMs` /
     * `requestTimeoutMs` for the local ones), so a dead or cold backend reports `timeout`
     * instead of blocking the readiness report. The wall-clock `backstopMs` covers a driver
     * with no budget of its own (the in-process `mlx-native` core).
     *
     * No bus and no decision log are passed, so a probe emits no event and writes no row: the
     * recorded evidence the probe sits next to can never be satisfied by the probe itself.
     * Caller mistakes (unknown id, unregistered maker, invalid input) still throw — the hub
     * rejects those before any backend call.
     */
    async probeMaker(
        decisionId: string,
        maker: string,
        input: Record<string, unknown>,
        backstopMs: number,
    ): Promise<DecisionProbeOutcome> {
        if (this.duplicateIds.has(decisionId)) {
            const sources = this.duplicateIds.get(decisionId)?.join(', ') ?? '';
            throw new DecisionCatalogError(
                `decision "${decisionId}" is declared by multiple winning catalogs (${sources}); remove one to unblock decide`,
                sources,
                decisionId,
            );
        }
        this.describe(decisionId);
        const startedAt = Date.now();
        const served = await raceTimeout(
            this.probeHub().decide(decisionId, input as Parameters<DecisionHub['decide']>[1], { maker }),
            backstopMs,
        );
        if (served === undefined) {
            return { maker, ok: false, value: null, reason: 'timeout', durationMs: Date.now() - startedAt };
        }
        return {
            maker,
            ok: served.source === 'model',
            value: served.value,
            reason: served.reason,
            durationMs: served.durationMs,
        };
    }

    /** Probe-only hub over the same catalogs, with the probe budget on every driver. */
    private probeHub(): DecisionHub {
        if (this.probeOnlyHub !== undefined) return this.probeOnlyHub;
        const env = getEnvVars();
        const registry = new DecisionMakerRegistry({
            builtins: {
                makerOptions: { env, timeoutMs: PROBE_DRIVER_BUDGET_MS },
                driverOptions: {
                    'laya-local': {
                        env,
                        client: this.ownLayaClient({
                            env,
                            startupTimeoutMs: PROBE_DRIVER_BUDGET_MS,
                            requestTimeoutMs: PROBE_DRIVER_BUDGET_MS,
                        }),
                    },
                    'fm-local': { requestTimeoutMs: PROBE_DRIVER_BUDGET_MS },
                },
            },
        });
        const clef = clefCredentials(env);
        if (clef !== undefined) {
            registry.register('clef', () => createDecisionMaker({ driver: createClefDriver(clef) }));
        }
        const hub = new DecisionHub({ registry });
        this.loadCatalogs(hub);
        this.probeOnlyHub = hub;
        return hub;
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
        // Task 1100: the lifecycle clock opens at the service entry, before
        // resolution, so started_at and the resolve phase are real even for
        // callers that pass a prelude (an evidence read already happened).
        const entryAt = Date.now();
        const logWrite = options?.decisionLog;
        const log: DecisionLogWrite | undefined =
            logWrite !== undefined
                ? {
                      sink: logWrite.sink,
                      startedAt: entryAt,
                      phases: [],
                      ...(logWrite.prelude !== undefined ? { prelude: logWrite.prelude } : {}),
                      ...(input !== undefined ? { input } : {}),
                  }
                : undefined;
        if (this.duplicateIds.has(id)) {
            const sources = this.duplicateIds.get(id)?.join(', ') ?? '';
            const error = new DecisionCatalogError(
                `decision "${id}" is declared by multiple winning catalogs (${sources}); remove one to unblock decide`,
                sources,
                id,
            );
            emitDecisionRejected(options?.bus, ctx, error, undefined, log);
            throw error;
        }
        let description: DecisionDescription;
        try {
            description = this.describe(id); // UnknownDecisionError before any maker work
        } catch (error) {
            emitDecisionRejected(options?.bus, ctx, error, undefined, log);
            throw error;
        }
        if (log !== undefined) {
            log.catalogSource = description.catalog;
            log.fallbackValue = description.fallback;
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
            emitDecisionRejected(
                options?.bus,
                ctx,
                error,
                name,
                log !== undefined ? { ...log, makerSource: source } : undefined,
            );
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
            emitDecisionRejected(options?.bus, ctx, error, undefined, log);
            throw error;
        }
        try {
            resolveDecisionInput(decisionDefinition, input as Parameters<typeof resolveDecisionInput>[1]);
        } catch (error) {
            emitDecisionRejected(options?.bus, ctx, error, undefined, log);
            throw error;
        }
        if (log !== undefined) {
            log.phases.push({ phase: 'resolve', startedAt: entryAt, durationMs: Date.now() - entryAt });
        }
        const digestSource = evidenceDigestSource(input);
        const invocation = beginDecisionInvocation(
            options?.bus,
            ctx,
            {
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
            },
            log,
        );
        const makerStartedAt = Date.now();
        let outcome: DecisionResult | undefined;
        try {
            outcome = await this.hub.decide(id, input as Parameters<DecisionHub['decide']>[1], { maker: name });
            const makerEndedAt = Date.now();
            if (log !== undefined) {
                // maker is the whole hub.decide call: resolve + ask inside one call
                // (ts-ai-decision 0.5.16+), so the hub's own duration is the phase.
                log.phases.push({
                    phase: 'maker',
                    startedAt: makerStartedAt,
                    durationMs: outcome.durationMs > 0 ? outcome.durationMs : makerEndedAt - makerStartedAt,
                });
            }
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
            if (log !== undefined) {
                // serve: mapping + emitting the result back to the caller.
                log.phases.push({ phase: 'serve', startedAt: makerEndedAt, durationMs: Date.now() - makerEndedAt });
            }
            return { ...outcome, makerSource: source };
        } catch (error) {
            if (log !== undefined) {
                // The raw message rides the log arg; the emitter redacts it into
                // the row's `error` column with the caller's configured secrets.
                log.error = error instanceof Error ? error.message : String(error);
                log.phases.push({ phase: 'maker', startedAt: makerStartedAt, durationMs: Date.now() - makerStartedAt });
            }
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
            return {
                id: entry.id,
                type: entry.type,
                maker: name,
                source,
                registered: this.registry.has(name),
                layer: entry.layer,
                minConfidence: this.hub.describe(entry.id).minConfidence,
            };
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
 * Cloudflare credentials for the hosted `clef` maker (design §3.6), read from
 * the environment only. `undefined` — an absent or empty variable — means the
 * maker is not registered at all: a machine without creds must report `clef` as
 * unregistered (a loud config error), never serve a silent per-call
 * `no-backend` fallback that `status` reads as healthy.
 */
function clefCredentials(env: Record<string, string | undefined>): ClefDriverOptions | undefined {
    const { CLOUDFLARE_ACCOUNT_ID: accountId, CLOUDFLARE_AUTH_TOKEN: apiToken } = env;
    if (accountId === undefined || accountId === '' || apiToken === undefined || apiToken === '') return undefined;
    return { accountId, apiToken };
}

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

/**
 * Release every cached service's process-backed local driver clients. Called once as the Spur
 * process winds down (`runCli`), because nothing else ends a warm `laya-local` Python worker and
 * its open pipes otherwise keep the CLI alive after its command has printed its result.
 */
export async function disposeDecisionServices(): Promise<void> {
    const pending = [...serviceCache.values()];
    serviceCache.clear();
    await Promise.all(
        pending.map(async (entry) => {
            try {
                (await entry).dispose();
            } catch {
                // A service that failed to build owns no client; there is nothing to release.
            }
        }),
    );
}

// Re-export for consumers (CLI in task 1093) so the app package stays the one
// import site for decision-catalog resolution errors.
export { UnknownDecisionError, UnknownDecisionMakerError };
