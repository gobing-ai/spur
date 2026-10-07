import { join } from 'node:path';
import type { DecisionMaker } from '@gobing-ai/ts-ai-runner';
import type { ActionResult, ActionRunContext, ActionRunner } from '@gobing-ai/ts-dual-workflow-engine';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { z } from 'zod';
import { beginDecisionInvocation, decisionCorrelationFromVars } from '../../decision/decision-events';
import type { SystemEventBus } from '../../services/system-event-tap';
import { DEFAULT_MIN_CONFIDENCE, runDecide } from '../decide';
import type { WorkflowObservabilityBus } from '../observability';

/**
 * Non-pausing `decide` action runner (task 0941, ADR-125). Executes {@link runDecide} against
 * the configured DecisionMaker, writes the frozen resultFile row (schemaVersion 1), and returns
 * `ok: true` with `data.value` so the trace row carries the decision. Guards read the result
 * through file guards — this runner never reads the resultFile back (0941 Design).
 */

export const DECIDE_KIND = 'decide';

/**
 * Option validation (0941 R1) — the workflow-validate walker (`collectDecideViolations`,
 * `workflow/composition-lint.ts`) parses with the SAME schema, so validation and execution cannot
 * drift. Only this schema fails the action; every model-level outcome degrades (0941 R3).
 */
export const DecideOptionsSchema = z
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

/** Constructor dependencies: the feature switch (R4), the optional provider factory, and the optional decision-event bus (1095). */
export interface DecideActionDeps {
    enabled: boolean;
    decisionMaker?: () => Promise<DecisionMaker>;
    /** Workflow observability bus carrying the cataloged `decision.*` events (task 1095). */
    observabilityBus?: WorkflowObservabilityBus;
}

/** Runs the non-pausing `decide` action: resolves a DecisionMaker answer (or a degraded default) and writes the schemaVersion-1 result row (0941). */
export class DecideActionRunner implements ActionRunner {
    readonly kind = DECIDE_KIND;

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
                    // Task 1113 R3: full correlation — workflowName/wbs from the run
                    // vars (__workflowName injected on the __runId seam), node id from
                    // the engine context, runId from the context of record.
                    correlation: decisionCorrelationFromVars({
                        ...(context.vars as Record<string, string | undefined>),
                        __runId: context.runId,
                        __nodeId: context.stateOrNodeId,
                    }) ?? { runId: context.runId, nodeId: context.stateOrNodeId },
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
}
