import { join } from 'node:path';
import type { DecisionType } from '@gobing-ai/ts-ai-decision';
import type { DecisionMaker } from '@gobing-ai/ts-ai-runner';
import type { ActionResult, ActionRunContext, ActionRunner } from '@gobing-ai/ts-dual-workflow-engine';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { z } from 'zod';
import {
    beginDecisionInvocation,
    decisionCorrelationFromVars,
    emitDecisionRejected,
} from '../../decision/decision-events';
import { readDecisionEvidence } from '../../decision/decision-evidence-input';
import type { DecisionDescription, DecisionService } from '../../decision/decision-service';
import type { SystemEventBus } from '../../services/system-event-tap';
import { DEFAULT_MIN_CONFIDENCE, type DecideMethod, type DecideResult, runDecide } from '../decide';
import type { WorkflowObservabilityBus } from '../observability';

/**
 * Non-pausing `decide` action runner (task 0941, ADR-125). Executes {@link runDecide} against
 * the configured DecisionMaker, writes the frozen resultFile row (schemaVersion 1), and returns
 * `ok: true` with `data.value` so the trace row carries the decision. Guards read the result
 * through file guards — this runner never reads the resultFile back (0941 Design).
 */

export const DECIDE_KIND = 'decide';

/**
 * Inline option validation (0941 R1) — the workflow-validate walker (`collectDecideViolations`,
 * `workflow/composition-lint.ts`) parses with the SAME schema, so validation and execution cannot
 * drift. Only this schema fails the action; every model-level outcome degrades (0941 R3).
 * Deprecated by task 1094 in favor of the catalog-reference form; still the executed contract
 * until the 1114–1116 catalog migrations land.
 */
export const InlineDecideOptionsSchema = z
    .object({
        id: z.string().min(1),
        method: z.enum(['choice', 'noul']),
        question: z.string().min(1),
        choices: z.array(z.string().min(1)).min(2).optional(),
        evidence: z.array(z.string().min(1)).optional(),
        default: z.string().min(1),
        minConfidence: z.number().min(0).max(1).optional(),
        resultFile: z.string().min(1),
    })
    .strict()
    .superRefine((options, ctx) => {
        if (options.method === 'choice') {
            if (options.choices === undefined) {
                ctx.addIssue({ code: 'custom', message: 'choices is required for method choice (at least 2 labels)' });
            } else if (!options.choices.includes(options.default)) {
                ctx.addIssue({
                    code: 'custom',
                    message: `default "${options.default}" is not one of choices [${options.choices.join(', ')}]`,
                });
            }
            return;
        }
        if (options.choices !== undefined) {
            ctx.addIssue({
                code: 'custom',
                message: 'choices is only valid for method choice; noul uses the engine yes/no outcomes',
            });
        }
        if (options.default !== 'yes' && options.default !== 'no') {
            ctx.addIssue({ code: 'custom', message: 'default must be "yes" or "no" for method noul' });
        }
    });

/** Inline `question`/`method`/`default` form — deprecated by task 1094; see {@link CatalogDecideOptionsSchema}. */
export type InlineDecideOptions = z.infer<typeof InlineDecideOptionsSchema>;

/**
 * Catalog-reference form (task 1094): `decision` names a loaded catalog id served by the
 * shared {@link DecisionService}; `params` carries the catalog's declared inputs. `instructions`
 * is the implicit-input channel (matching the CLI `--evidence` join) and is reserved — a
 * `params.instructions` collision fails the action, and `evidence` + `instructions` together
 * are a schema error. Confidence gating stays in the catalog descriptor; no inline
 * `default`/`method`/`question` here — the service owns them.
 */
export const CatalogDecideOptionsSchema = z
    .object({
        id: z.string().min(1),
        decision: z.string().min(1),
        params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
        evidence: z.array(z.string().min(1)).optional(),
        instructions: z.string().min(1).optional(),
        resultFile: z.string().min(1),
    })
    .strict()
    .superRefine((options, ctx) => {
        if (options.evidence !== undefined && options.instructions !== undefined) {
            ctx.addIssue({
                code: 'custom',
                message:
                    'instructions is reserved and cannot be combined with evidence; declare one implicit-input channel',
            });
        }
    });

/** Structural form of {@link CatalogDecideOptionsSchema} — a catalog-reference decide step. */
export type CatalogDecideOptions = z.infer<typeof CatalogDecideOptionsSchema>;

/** One schema for validation and execution (0941 R1): inline (deprecated) or catalog-reference. */
export const DecideOptionsSchema = z.union([InlineDecideOptionsSchema, CatalogDecideOptionsSchema]);

/** Discriminator: true when a decide step uses the catalog-reference form (task 1094). */
export function isCatalogDecideOptions(
    options: InlineDecideOptions | CatalogDecideOptions,
): options is CatalogDecideOptions {
    return 'decision' in options;
}

/** Constructor dependencies: the feature switch (R4), the optional provider factory, and the optional decision-event bus (1095). */
export interface DecideActionDeps {
    enabled: boolean;
    decisionMaker?: () => Promise<DecisionMaker>;
    /**
     * Catalog service factory (task 1094): resolves the catalog-reference decide path.
     * Absent ⇒ a catalog-form action fails without touching any backend.
     */
    decisionService?: () => Promise<DecisionService>;
    /** Deprecation sink for inline decide options (task 1094 R7): once per run per id. */
    warn?: (message: string) => void;
    /** Workflow observability bus carrying the cataloged `decision.*` events (task 1095). */
    observabilityBus?: WorkflowObservabilityBus;
}

/** Runs the non-pausing `decide` action: resolves a DecisionMaker answer (or a degraded default) and writes the schemaVersion-1 result row (0941). */
export class DecideActionRunner implements ActionRunner {
    readonly kind = DECIDE_KIND;

    /** Inline-form deprecation warnings already emitted, per run id (task 1094 R7). */
    private readonly inlineWarned = new Map<string, Set<string>>();

    constructor(
        private readonly fileSystem: FileSystem,
        private readonly deps: DecideActionDeps,
    ) {}

    async execute(rawOptions: Record<string, unknown>, context: ActionRunContext): Promise<ActionResult> {
        const parsed = DecideOptionsSchema.safeParse(rawOptions);
        if (!parsed.success) {
            return {
                ok: false,
                error: `${DECIDE_KIND}: invalid options — ${parsed.error.issues.map((i) => i.message).join('; ')}`,
            };
        }
        const options = parsed.data;
        return isCatalogDecideOptions(options)
            ? await this.executeCatalog(options, context)
            : await this.executeInline(options, context);
    }

    /** Task 1113 R3: full correlation — workflowName/wbs from the run vars (`__workflowName`
     * injected on the `__runId` seam), node id from the engine context, runId from the context
     * of record.
     */
    private decisionCorrelation(context: ActionRunContext) {
        return (
            decisionCorrelationFromVars({
                ...(context.vars as Record<string, string | undefined>),
                __runId: context.runId,
                __nodeId: context.stateOrNodeId,
            }) ?? { runId: context.runId, nodeId: context.stateOrNodeId }
        );
    }

    private async executeInline(options: InlineDecideOptions, context: ActionRunContext): Promise<ActionResult> {
        // Task 1094 R7: the inline form is deprecated — one warning per run per id on the
        // deps sink (composition validate emits the same text through ctx.warn).
        const runKey = context.runId ?? 'inline-decide';
        let warned = this.inlineWarned.get(runKey);
        if (this.deps.warn !== undefined && !warned?.has(options.id)) {
            if (warned === undefined) {
                warned = new Set();
                this.inlineWarned.set(runKey, warned);
            }
            warned.add(options.id);
            this.deps.warn(
                `decide ${context.stateOrNodeId}/${options.id}: inline decide options are deprecated; use { decision: <catalog-id>, params?, evidence?, resultFile }`,
            );
        }
        const workdir = context.workdir ?? '.';
        // Evidence and the resultFile resolve against the workflow workdir, exactly like
        // proof.fingerprint's inputs (relative option paths are workdir-relative).
        const result = await runDecide(
            {
                ...options,
                ...(options.evidence !== undefined
                    ? { evidence: options.evidence.map((path) => join(workdir, path)) }
                    : {}),
                resultFile: join(workdir, options.resultFile),
            },
            {
                enabled: this.deps.enabled,
                ...(this.deps.decisionMaker !== undefined ? { decisionMaker: this.deps.decisionMaker } : {}),
                readFile: async (path) => await this.fileSystem.readFile(path),
                now: Date.now.bind(Date),
            },
        );
        // Decision lifecycle events (task 1095): start → (success | failure) → end on the
        // workflow bus. Reason `disabled` emits nothing — no maker was involved, and it must
        // not count as a fallback in the reliability report.
        // SAFETY: WorkflowObservabilityBus and SystemEventBus are nominal names over one
        // structural ts-infra EventBus instance (ADR-044 event bridge), so the decision
        // emitter can share the workflow bus.
        const bus = this.deps.observabilityBus as unknown as SystemEventBus | undefined;
        if (this.deps.enabled && bus !== undefined && result.reason !== 'disabled') {
            const maker = result.backend ?? 'none';
            const invocation = beginDecisionInvocation(
                bus,
                {
                    decisionId: options.id,
                    caller: 'workflow',
                    correlation: this.decisionCorrelation(context),
                },
                {
                    type: options.method,
                    maker,
                    // The inline-question path is not catalog-backed; `inline` marks it.
                    makerSource: 'inline',
                    catalogLayer: '',
                    inputKeys: [],
                    ...(result.evidenceDigest !== null ? { evidenceDigest: result.evidenceDigest } : {}),
                    minConfidence: options.minConfidence ?? DEFAULT_MIN_CONFIDENCE,
                },
            );
            if (result.source === 'model' && result.reason === 'accepted') {
                invocation.succeed({ value: result.value, confidence: result.confidence, maker });
            } else {
                invocation.fail({
                    reason: result.reason,
                    fallbackValue: result.value,
                    confidence: result.confidence,
                    maker,
                });
            }
            invocation.end({
                durationMs: result.durationMs,
                value: result.value,
                source: result.source,
                reason: result.reason,
                maker,
                confidence: result.confidence,
            });
        }
        await this.fileSystem.writeFile(join(workdir, options.resultFile), `${JSON.stringify(result, null, 2)}\n`);
        return { ok: true, data: { value: result.value, decision: result } };
    }

    /** The catalog service is composed per run; both the disabled and enabled paths need it. */
    private async service(): Promise<DecisionService | undefined> {
        if (this.deps.decisionService === undefined) return undefined;
        return await this.deps.decisionService();
    }

    /** R4 field mapping: one served catalog result onto the frozen schemaVersion-1 row. */
    private catalogRow(
        served: {
            type: DecideMethod;
            value: string | number | boolean;
            maker: string;
            confidence: number | null;
            source: 'model' | 'default';
            reason: 'accepted' | DecideResult['reason'];
            durationMs: number;
        },
        actionId: string,
    ): DecideResult {
        return {
            schemaVersion: 1,
            id: actionId,
            value: served.type === 'noul' ? (served.value ? 'yes' : 'no') : String(served.value),
            method: served.type,
            backend: served.maker,
            confidence: served.confidence,
            degraded: served.source === 'default',
            reason: served.reason,
            source: served.source,
            // The digest lives on the service's lifecycle events (input.instructions);
            // the row keeps the frozen field shape without duplicating the service's
            // digest input rule.
            evidenceDigest: null,
            durationMs: served.durationMs,
        };
    }

    /** Degraded catalog row (switch off / evidence error): the declared fallback, zero duration. */
    private degradedCatalogRow(
        description: { fallback: string | number | boolean; type: DecideMethod },
        actionId: string,
        reason: 'disabled' | 'error',
    ): DecideResult {
        return {
            schemaVersion: 1,
            id: actionId,
            value: String(description.fallback),
            method: description.type,
            backend: null,
            confidence: null,
            degraded: true,
            reason,
            source: 'default',
            evidenceDigest: null,
            durationMs: 0,
        };
    }

    /**
     * Catalog-reference path (task 1094). The DecisionService owns lifecycle events —
     * start → success | failure | end, plus `decision.rejected` for caller mistakes
     * (unknown id, bad params, unregistered maker); this runner emits only the
     * evidence-read `rejected` and never runs a ts-ai-runner maker (1094 anti-pattern:
     * one maker stack per catalog). With the switch off nothing leaves the process.
     */
    private async executeCatalog(options: CatalogDecideOptions, context: ActionRunContext): Promise<ActionResult> {
        const workdir = context.workdir ?? '.';
        const bus = this.deps.observabilityBus as unknown as SystemEventBus | undefined;
        const callContext = {
            decisionId: options.decision,
            caller: 'workflow' as const,
            correlation: this.decisionCorrelation(context),
        };
        const writeRow = async (row: DecideResult): Promise<ActionResult> => {
            await this.fileSystem.writeFile(join(workdir, options.resultFile), `${JSON.stringify(row, null, 2)}\n`);
            return { ok: true, data: { value: row.value, decision: row } };
        };

        // Switch off (R1): the disabled row from the catalog's declared fallback — no events,
        // no maker. Identical routing holds because guards read the same resultFile field.
        if (!this.deps.enabled) {
            const description = (await this.service())?.describe(options.decision);
            if (description === undefined) {
                return {
                    ok: false,
                    error: `${DECIDE_KIND}: catalog decision "${options.decision}" cannot run — the decision service is unavailable`,
                };
            }
            if (!isDecidableType(description.type)) {
                return {
                    ok: false,
                    error: `${DECIDE_KIND}: decision "${options.decision}" has type "${description.type}"; workflow decide supports choice and noul`,
                };
            }
            return await writeRow(
                this.degradedCatalogRow(
                    { fallback: description.fallback, type: description.type },
                    options.id,
                    'disabled',
                ),
            );
        }

        const decisionService = await this.service();
        if (decisionService === undefined) {
            return {
                ok: false,
                error: `${DECIDE_KIND}: catalog decision "${options.decision}" cannot run — the decision service is unavailable`,
            };
        }
        // Describe first: an unknown id is a caller mistake rejected before any work, and the
        // degraded evidence-error row below needs the declared fallback.
        let description: DecisionDescription;
        try {
            description = decisionService.describe(options.decision);
        } catch (error) {
            emitDecisionRejected(bus, callContext, error);
            return { ok: false, error: `${DECIDE_KIND}: ${error instanceof Error ? error.message : String(error)}` };
        }
        // Same type gate as validate: score decisions are CLI-only (the inline driver bypasses
        // validate, so this is the runtime backstop).
        if (!isDecidableType(description.type)) {
            return {
                ok: false,
                error: `${DECIDE_KIND}: decision "${options.decision}" has type "${description.type}"; workflow decide supports choice and noul`,
            };
        }

        // Evidence before any backend interaction (R4 step 3): an unreadable declared file is
        // rejected (before decision.start) and degrades to the mapped fallback row.
        if (options.params?.instructions !== undefined) {
            return {
                ok: false,
                error: `${DECIDE_KIND}: params.instructions is reserved — pass implicit input through the instructions option or evidence`,
            };
        }
        let instructionsText: string | undefined;
        try {
            if (options.evidence !== undefined && options.evidence.length > 0) {
                const evidence = await readDecisionEvidence(
                    options.evidence.map((path) => join(workdir, path)),
                    async (path) => await this.fileSystem.readFile(path),
                );
                instructionsText = evidence.join('\n\n');
            } else if (options.instructions !== undefined) {
                instructionsText = options.instructions;
            }
        } catch (error) {
            emitDecisionRejected(bus, callContext, error);
            return await writeRow(
                this.degradedCatalogRow(
                    { fallback: description.fallback, type: description.type },
                    options.id,
                    'error',
                ),
            );
        }

        const input = {
            ...options.params,
            ...(instructionsText !== undefined ? { instructions: instructionsText } : {}),
        };
        // A throw is a caller mistake (unknown id, bad params, unregistered maker); the
        // service already emitted `decision.rejected` — surface it as a failed action.
        const served = await decisionService.decide(options.decision, input, {
            context: { caller: 'workflow', correlation: callContext.correlation },
            ...(bus !== undefined ? { bus } : {}),
        });
        // Validate blocks score ids, but the inline driver parses options without the catalog —
        // this is the runtime backstop: hard failure, never a bogus row.
        if (served.type !== 'choice' && served.type !== 'noul') {
            return {
                ok: false,
                error: `${DECIDE_KIND}: decision "${options.decision}" has type "${served.type}"; workflow decide supports choice and noul`,
            };
        }
        return await writeRow(this.catalogRow({ ...served, type: served.type }, options.id));
    }
}

/** Workflow decide serves choice/noul rows only; score decisions are CLI-only (task 1094 R7). */
function isDecidableType(type: DecisionType): type is 'choice' | 'noul' {
    return type === 'choice' || type === 'noul';
}
