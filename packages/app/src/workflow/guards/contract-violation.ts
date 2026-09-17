import type { GuardContext, GuardEvaluationResult, GuardRunner } from '@gobing-ai/ts-dual-workflow-engine';

const KIND = 'contract-violation';

/**
 * Contract-violation guard (ADR-118): passes iff the prior action's result is a
 * named contract violation — `data.outcome === 'contract-violation'`, the third
 * `agent.run` stage outcome established by task 0870 and kept distinct from an
 * executor failure (whose `data` carries no `outcome` discriminator).
 *
 * A definition opts into routing that outcome to a dedicated repair edge by
 * declaring this guard on an outgoing transition. A definition without the edge
 * keeps today's behaviour unchanged (R4) — the guard is inert unless authored.
 *
 * The `report` carries the violated contract and the observed value so the
 * routing decision is traceable to the exact miss, and the transition's YAML
 * `trigger` surfaces the same distinction in the run log.
 */
export class ContractViolationGuardRunner implements GuardRunner {
    readonly kind = KIND;

    constructor() {}

    async evaluate(_options: Record<string, unknown>, context: GuardContext): Promise<GuardEvaluationResult> {
        const data = context.lastActionResult?.data;
        const isObject = typeof data === 'object' && data !== null;
        const violated = isObject && (data as Record<string, unknown>).outcome === 'contract-violation';
        if (!violated) return { passed: false };
        return {
            passed: true,
            report: {
                contract: (data as Record<string, unknown>).contract,
                observed: (data as Record<string, unknown>).observed,
            },
        };
    }
}
