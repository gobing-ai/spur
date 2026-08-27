import type { ObjectiveEscalationSignal } from '@gobing-ai/spur-domain';
import type { AgentRunResult } from '@gobing-ai/ts-ai-runner';

/** Provider-specific evidence that maps a failed dispatch to an objective escalation signal. */
export type FailureRule = {
    /**
     * Which vendor's vocabulary this rule transcribes. Registry metadata for the reader,
     * deliberately NOT a filter (0687): the exhaustion vocabulary is genuinely
     * cross-vendor — `pi` alone fronts a dozen providers, and "rate limit exceeded" or
     * "out of tokens" means the same thing whoever emitted it. Precision comes from the
     * patterns being narrow, not from guessing the dispatch's provider.
     */
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
        // 0687: `context[_ -]?(?:length|window)` also matched the camelCase identifier
        // `contextWindow`, which appears in any bundled-JS crash dump — a separator is now
        // required so only the prose form matches, never a code symbol.
        patterns: [/(?:out of tokens?|token[_ -]?(?:limit|budget)|context[_ -](?:length|window)|maximum context)/i],
    },
    {
        provider: 'gemini',
        signal: 'resource-exhaustion',
        // 0687: a bare `quota` matched any incidental mention (a path, a field name, a
        // log line about a quota directory). It now needs an exhaustion verb beside it.
        patterns: [
            /(?:usage[_ -]?limit|quota (?:exceeded|exhausted|reached)|exceeded[^.\n]{0,40}quota|overloaded|resource exhausted)/i,
        ],
    },
];

/**
 * OS-level permission denials (task 0687 R9). A sandbox or filesystem refusal is not a
 * provider condition: escalating to a costlier tier cannot grant a permission, it only
 * burns budget and buries the cause. These are checked BEFORE the provider rules so a
 * crash dump carried alongside the denial cannot be pattern-matched into a quota signal.
 */
const PERMISSION_PATTERNS: readonly RegExp[] = [
    /\bEPERM\b/,
    /\bEACCES\b/,
    /operation not permitted/i,
    /permission denied/i,
    /FS_PERMISSION_DENIED/i,
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

/**
 * The permission-denial evidence in a dispatch's output, or `undefined` (0687 R9).
 *
 * Returned as the matching line so a caller can surface the real cause verbatim instead of
 * a bare exit code.
 */
export function permissionFailureEvidence(text: string): string | undefined {
    if (!PERMISSION_PATTERNS.some((pattern) => pattern.test(text))) return undefined;
    const line = text
        .split('\n')
        .map((candidate) => candidate.trim())
        .find((candidate) => PERMISSION_PATTERNS.some((pattern) => pattern.test(candidate)));
    return line !== undefined && line !== '' ? line : undefined;
}

/** Classifies objective failure evidence from a completed agent dispatch. */
export function classifyDispatch(
    result: Pick<AgentRunResult, 'exitCode' | 'stdout' | 'stderr' | 'signal'>,
): ObjectiveEscalationSignal | undefined {
    if (result.signal !== undefined) return 'timeout';
    if (result.exitCode === 0) return undefined;

    const text = `${result.stderr ?? ''} ${result.stdout ?? ''}`;
    // 0687 R9: a permission denial is terminal for this executor AND every costlier one —
    // no escalation signal, so the ladder stops and the real error stands.
    if (permissionFailureEvidence(text) !== undefined) return undefined;

    const statusCodes = extractStatusCodes(text);

    for (const rule of FAILURE_RULES) {
        const statusMatch = rule.statusCodes?.some((code) => statusCodes.has(code)) ?? false;
        const patternMatch = rule.patterns.length > 0 && rule.patterns.every((pattern) => pattern.test(text));
        if (statusMatch || patternMatch) return rule.signal;
    }

    return undefined;
}
