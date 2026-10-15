import type { ObjectiveEscalationSignal } from '@gobing-ai/spur-domain';
import type { AgentRunResult } from '@gobing-ai/ts-ai-runner';
import type { AgentRoutingAttribution } from '../observability/agent-execution';
import type { AgentResolveResult } from './agent-service';
import { classifyDispatch } from './failure-classification';

/**
 * Classify a dispatch result into an objective escalation signal (0407 R1).
 *
 * Biased toward precision: the multi-pattern match avoids false positives on
 * ordinary stderr noise. Only registry-backed resource-exhaustion/auth evidence
 * and subprocess termination signals map to escalation triggers — everything
 * else returns `undefined` and the result stands as-is.
 *
 * Trigger vocabulary mirrors {@link ObjectiveEscalationSignal} (0405 R8):
 * `resource-exhaustion`, `auth`, and `timeout` are auto-classifiable signals;
 * `gate-fail`, `insufficient-evidence`, and `retry-exhausted` require human or
 * upstream judgement and are never inferred from process output.
 */
export function classifyObjectiveFailure(result: AgentRunResult): ObjectiveEscalationSignal | undefined {
    return classifyDispatch(result);
}

/**
 * Project a resolution result into the routing attribution carried on lifecycle
 * events (0545 R1). Resolutions without a tier or executor (legacy Tier-1
 * priority, bare-binary pins with no executor entry) carry no attribution —
 * there is no decision to record. Everything else records identifiers and the
 * selection source; role and tier ride along when the funnel produced them.
 */
export function buildRoutingAttribution(result: AgentResolveResult): AgentRoutingAttribution | undefined {
    if (!result.ok) return undefined;
    const tier = result.tier ?? result.stage?.executorTier;
    const executor = result.executor ?? result.stage?.executorName;
    if (tier === undefined && executor === undefined) return undefined;
    return {
        ...(result.role !== undefined ? { role: result.role } : {}),
        tier: tier ?? 'unknown',
        executor: executor ?? result.agent,
        source: result.source,
        // 0679 R7: resolved model override, so agent.invoke.* payloads stop carrying
        // a universally-null $.data.model. Absent when nothing resolved one.
        ...(result.model !== undefined ? { model: result.model } : {}),
    };
}
