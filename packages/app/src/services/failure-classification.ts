import type { ObjectiveEscalationSignal } from '@gobing-ai/spur-domain';
import type { AgentRunResult } from '@gobing-ai/ts-ai-runner';

/** Provider-specific evidence that maps a failed dispatch to an objective escalation signal. */
export type FailureRule = {
    provider: string;
    signal: ObjectiveEscalationSignal;
    statusCodes?: number[];
    patterns: RegExp[];
};

/**
 * Provider failure vocabulary. Status codes are matched only when presented as
 * an HTTP/status value; patterns are intentionally narrow to preserve the 0407
 * precision bias. A provider with status-only evidence keeps an empty pattern
 * list, which never matches by itself.
 */
export const FAILURE_RULES: FailureRule[] = [
    {
        provider: 'anthropic',
        signal: 'resource-exhaustion',
        statusCodes: [529],
        patterns: [
            /(?:claude usage limit|you['’]ve hit your weekly limit|5[- ]hour limit|rate[_ -]?limit[_ -]?error)/i,
        ],
    },
    {
        provider: 'grok',
        signal: 'resource-exhaustion',
        statusCodes: [402],
        patterns: [/(?:grok.*(?:usage|balance).*exhausted|payment required.*grok|balance exhausted)/i],
    },
    {
        provider: 'openai',
        signal: 'resource-exhaustion',
        statusCodes: [429],
        patterns: [
            /(?:rate[_ -]?limit(?:[_ -]?(?:exceeded|error))?|too many requests|insufficient[_ -]?(?:credits?|quota|funds)|exceeded your current quota)/i,
        ],
    },
    {
        provider: 'volc',
        signal: 'auth',
        statusCodes: [401],
        patterns: [
            /(?:api key not found for provider ['"]?volc|volc.*(?:api key|authentication).*(?:missing|invalid))/i,
        ],
    },
    {
        provider: 'zai',
        signal: 'auth',
        statusCodes: [403],
        patterns: [
            /(?:api key not found for provider ['"]?zai|(?:zai|glm).*(?:api key|authentication).*(?:missing|invalid))/i,
        ],
    },
    {
        provider: 'ollama',
        signal: 'resource-exhaustion',
        patterns: [/(?:out of tokens?|token[_ -]?(?:limit|budget)|context[_ -]?(?:length|window)|maximum context)/i],
    },
    {
        provider: 'gemini',
        signal: 'resource-exhaustion',
        patterns: [/(?:usage[_ -]?limit|quota|overloaded|resource exhausted)/i],
    },
];

const HTTP_STATUS_PATTERN = /(?:\bstatus|\bhttp(?:\/\d(?:\.\d)?)?|\bapi error)\s*(?:code\s*)?[:(=-]?\s*(\d{3})\b/gi;

function extractStatusCodes(text: string): Set<number> {
    const codes = new Set<number>();
    for (const match of text.matchAll(HTTP_STATUS_PATTERN)) {
        const code = Number(match[1]);
        if (Number.isInteger(code)) codes.add(code);
    }
    return codes;
}

/** Classifies objective failure evidence from a completed agent dispatch. */
export function classifyDispatch(
    result: Pick<AgentRunResult, 'exitCode' | 'stdout' | 'stderr' | 'signal'>,
): ObjectiveEscalationSignal | undefined {
    if (result.signal !== undefined) return 'timeout';
    if (result.exitCode === 0) return undefined;

    const text = `${result.stderr ?? ''} ${result.stdout ?? ''}`;
    const statusCodes = extractStatusCodes(text);

    for (const rule of FAILURE_RULES) {
        const statusMatch = rule.statusCodes?.some((code) => statusCodes.has(code)) ?? false;
        const patternMatch = rule.patterns.length > 0 && rule.patterns.every((pattern) => pattern.test(text));
        if (statusMatch || patternMatch) return rule.signal;
    }

    return undefined;
}
