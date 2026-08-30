/**
 * Normalized optional agent usage contract + pure hard-budget evaluator
 * (task 0707). Availability is explicit: `measured` carries only the fields a
 * runner actually reported; `unavailable` carries a reason and never fabricates
 * numeric zeros. The contract reads ONLY typed structured fields from a runner
 * result — parsing human stdout/stderr for accounting is rejected (R2).
 *
 * Wall-clock remains the only mid-run control (`timeoutMs`); token/cost budgets
 * are post-dispatch, safe-boundary enforcement (R7).
 */

/** One normalized usage measurement at the runner/application seam (R1). */
export interface NormalizedAgentUsage {
    readonly availability: 'measured' | 'unavailable';
    /** Reported token counts are carried as reported; absent stays absent. */
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly cacheReadTokens?: number;
    readonly cacheWriteTokens?: number;
    /** Provider-reported cost in USD; never estimated from public price tables. */
    readonly costUsd?: number;
    /** Which runner/adapter supplied the measurement. */
    readonly source?: string;
    /** Measurement timestamp or contract version, as applicable. */
    readonly measuredAt?: string;
    /** Present only when availability is `unavailable`. */
    readonly unavailabilityReason?: string;
}

const MAX_FIELD_CHARS = 200;

function bound(value: string): string {
    return value.length <= MAX_FIELD_CHARS ? value : `${value.slice(0, MAX_FIELD_CHARS)}…`;
}

/** The canonical honest-unavailable value; the only shape legacy dispatch can produce. */
export function unavailableAgentUsage(reason = 'runner-native usage is not exposed'): NormalizedAgentUsage {
    return { availability: 'unavailable', unavailabilityReason: bound(reason) };
}

function isCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Normalize a raw usage value read from a runner result's typed `usage` field
 * into the contract shape. Malformed or absent input degrades to
 * `unavailable` — never to zeros, never to invented measurements.
 */
export function normalizeAgentUsage(
    raw: unknown,
    unavailabilityReason = 'runner-native usage is not exposed',
): NormalizedAgentUsage {
    if (raw === undefined || raw === null) return unavailableAgentUsage(unavailabilityReason);
    if (typeof raw === 'string') {
        // Legacy event projections carried the bare literal; treat it as unavailable.
        return unavailableAgentUsage(
            raw === 'unavailable' ? unavailabilityReason : `malformed usage payload: ${bound(raw)}`,
        );
    }
    if (typeof raw !== 'object') {
        return unavailableAgentUsage(`malformed usage payload: ${typeof raw}`);
    }
    const obj = raw as Record<string, unknown>;
    if (obj.availability === undefined || obj.availability === 'unavailable') {
        const reason =
            typeof obj.unavailabilityReason === 'string' && obj.unavailabilityReason !== ''
                ? obj.unavailabilityReason
                : unavailabilityReason;
        return unavailableAgentUsage(reason);
    }
    if (obj.availability !== 'measured') {
        return unavailableAgentUsage(`unknown usage availability: ${bound(String(obj.availability))}`);
    }
    return {
        availability: 'measured',
        ...(isCount(obj.inputTokens) ? { inputTokens: obj.inputTokens } : {}),
        ...(isCount(obj.outputTokens) ? { outputTokens: obj.outputTokens } : {}),
        ...(isCount(obj.cacheReadTokens) ? { cacheReadTokens: obj.cacheReadTokens } : {}),
        ...(isCount(obj.cacheWriteTokens) ? { cacheWriteTokens: obj.cacheWriteTokens } : {}),
        ...(isCount(obj.costUsd) ? { costUsd: obj.costUsd } : {}),
        ...(typeof obj.source === 'string' && obj.source !== '' ? { source: bound(obj.source) } : {}),
        ...(typeof obj.measuredAt === 'string' && obj.measuredAt !== '' ? { measuredAt: bound(obj.measuredAt) } : {}),
    };
}

/** Sum of reported token counts; undefined when nothing token-shaped was reported. */
export function totalMeasuredTokens(usage: NormalizedAgentUsage): number | undefined {
    if (usage.availability !== 'measured') return undefined;
    const fields = [usage.inputTokens, usage.outputTokens, usage.cacheReadTokens, usage.cacheWriteTokens];
    if (fields.every((field) => field === undefined)) return undefined;
    return fields.reduce<number>((sum, field) => sum + (field ?? 0), 0);
}

/** Optional per-action hard budgets (R4). `timeoutMs` stays the only duration control. */
export interface AgentBudgetOptions {
    readonly maxTokens?: number;
    readonly maxCostUsd?: number;
}

function parseBudgetBound(value: unknown, name: string): number | string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) value = Number(value);
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return `agent.run: ${name} must be a positive finite number`;
    }
    return value;
}

/** Validate `maxTokens`/`maxCostUsd` workflow options at the action trust boundary. */
export function parseAgentBudget(options: Record<string, unknown>): { budget?: AgentBudgetOptions; error?: string } {
    const maxTokens = parseBudgetBound(options.maxTokens, 'maxTokens');
    if (typeof maxTokens === 'string') return { error: maxTokens };
    const maxCostUsd = parseBudgetBound(options.maxCostUsd, 'maxCostUsd');
    if (typeof maxCostUsd === 'string') return { error: maxCostUsd };
    if (maxTokens === undefined && maxCostUsd === undefined) return {};
    return {
        budget: {
            ...(maxTokens !== undefined ? { maxTokens } : {}),
            ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
        },
    };
}

/** Outcome of comparing measured agent usage against a declared hard budget; `over` carries per-cap violations, `unverifiable` explains why no verdict was possible. */
export type AgentBudgetEvaluation =
    | { verdict: 'within' }
    | { verdict: 'over'; violations: readonly string[] }
    | { verdict: 'unverifiable'; reason: string };

/**
 * Compare measured usage against declared hard budgets (R5/R6). Field-level
 * availability: a token cap evaluates from reported token counts, a cost cap
 * from a reported `costUsd`; a cap whose field is missing is `unverifiable`
 * (fail closed), never silently passed and never estimated.
 */
export function evaluateAgentBudget(usage: NormalizedAgentUsage, budget: AgentBudgetOptions): AgentBudgetEvaluation {
    const violations: string[] = [];
    const unverifiable: string[] = [];
    if (budget.maxTokens !== undefined) {
        const total = totalMeasuredTokens(usage);
        if (total === undefined) {
            unverifiable.push(`maxTokens=${budget.maxTokens} cannot be evaluated: no token counts reported`);
        } else if (total > budget.maxTokens) {
            violations.push(`total tokens ${total} exceed maxTokens ${budget.maxTokens}`);
        }
    }
    if (budget.maxCostUsd !== undefined) {
        if (usage.costUsd === undefined) {
            unverifiable.push(`maxCostUsd=${budget.maxCostUsd} cannot be evaluated: costUsd not reported`);
        } else if (usage.costUsd > budget.maxCostUsd) {
            violations.push(`cost ${usage.costUsd} exceed maxCostUsd ${budget.maxCostUsd}`);
        }
    }
    if (violations.length > 0) return { verdict: 'over', violations };
    if (unverifiable.length > 0) return { verdict: 'unverifiable', reason: unverifiable.join('; ') };
    return { verdict: 'within' };
}
