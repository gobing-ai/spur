import type { ClaudeUsagePayload } from './types';

/** Token counts extracted from a provider `usage` object, with the cache split preserved. */
export interface ExtractedTokens {
    /** Total billed input: fresh input + cache reads + cache writes. */
    inputTokens: number;
    outputTokens: number;
    /** `cache_read_input_tokens` — prompt-cache hits. Included in `inputTokens`. */
    cacheReadTokens: number;
    /** `cache_creation_input_tokens` — prompt-cache writes. Included in `inputTokens`. */
    cacheCreationTokens: number;
    /** Whether a provider `usage` object was present at all. */
    usageReported: boolean;
}

/**
 * Extract token counts from a Claude-style passthrough usage object.
 *
 * `inputTokens` remains the summed total (fresh + cache read + cache write) so cost math
 * is unchanged, but the cache components are now reported alongside it instead of being
 * folded in and discarded — without them a cache-hit ratio cannot be computed from an
 * imported record even though the source JSONL carries the numbers.
 */
export function extractClaudeTokens(payload: ClaudeUsagePayload): ExtractedTokens {
    const usage = payload.usage as Record<string, unknown> | undefined;
    const absent: ExtractedTokens = {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        usageReported: false,
    };
    if (usage === undefined || usage === null) return absent;
    const input = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0;
    const output = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;
    const cacheRead = typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0;
    const cacheCreate = typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0;
    return {
        inputTokens: input + cacheRead + cacheCreate,
        outputTokens: output,
        cacheReadTokens: cacheRead,
        cacheCreationTokens: cacheCreate,
        usageReported: true,
    };
}
