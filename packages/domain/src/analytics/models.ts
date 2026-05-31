import type { ModelPricing } from './types';

/** Model pricing table (USD per 1M tokens). Prices as of mid-2026. */
export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
    // Claude models (Anthropic)
    'claude-3-opus-20240229': { inputPricePer1M: 15, outputPricePer1M: 75 },
    'claude-3-5-sonnet-20241022': { inputPricePer1M: 3, outputPricePer1M: 15 },
    'claude-sonnet-4-20250514': { inputPricePer1M: 3, outputPricePer1M: 15 },
    'claude-haiku-4-5': { inputPricePer1M: 0.8, outputPricePer1M: 4 },
    'claude-3-5-haiku-20241022': { inputPricePer1M: 0.8, outputPricePer1M: 4 },
    'claude-3-haiku-20240307': { inputPricePer1M: 0.25, outputPricePer1M: 1.25 },

    // Gemini models (Google)
    'gemini-2.5-flash': { inputPricePer1M: 0.15, outputPricePer1M: 0.6 },
    'gemini-2.5-pro': { inputPricePer1M: 1.25, outputPricePer1M: 10 },
    'gemini-3-flash-preview': { inputPricePer1M: 0.15, outputPricePer1M: 0.6 },
    'gemini-3-flash': { inputPricePer1M: 0.15, outputPricePer1M: 0.6 },
    'gemini-2.0-flash': { inputPricePer1M: 0.1, outputPricePer1M: 0.4 },

    // GPT models (OpenAI) — used via Codex/OpenCode
    'gpt-4o': { inputPricePer1M: 2.5, outputPricePer1M: 10 },
    'gpt-4o-mini': { inputPricePer1M: 0.15, outputPricePer1M: 0.6 },
    'gpt-4-turbo': { inputPricePer1M: 10, outputPricePer1M: 30 },
    'gpt-4': { inputPricePer1M: 30, outputPricePer1M: 60 },
    'gpt-3.5-turbo': { inputPricePer1M: 0.5, outputPricePer1M: 1.5 },
    o1: { inputPricePer1M: 15, outputPricePer1M: 60 },
    'o3-mini': { inputPricePer1M: 1.1, outputPricePer1M: 4.4 },
};

/** Fallback pricing when a model is unrecognized. Conservative estimate. */
export const UNKNOWN_MODEL_PRICING: ModelPricing = { inputPricePer1M: 3, outputPricePer1M: 15 };

/** Resolve pricing for a given model name using fuzzy prefix matching. */
export function resolvePricing(model: string | undefined): ModelPricing {
    if (model === undefined || model.length === 0) return UNKNOWN_MODEL_PRICING;
    const normalized = model.toLowerCase();
    // Exact match
    if (MODEL_PRICING[normalized] !== undefined) return MODEL_PRICING[normalized];
    // Prefix match (e.g., "claude-sonnet-4-20250514" matches "claude-sonnet-4")
    const prefixEntries = Object.entries(MODEL_PRICING).filter(([key]) => normalized.startsWith(key));
    if (prefixEntries.length > 0) return prefixEntries[0]?.[1] ?? UNKNOWN_MODEL_PRICING;
    // Reverse prefix match (e.g., "gemini-2.5-flash" matches when key starts with normalized)
    const reverseEntries = Object.entries(MODEL_PRICING).filter(([key]) => key.startsWith(normalized));
    if (reverseEntries.length > 0) return reverseEntries[0]?.[1] ?? UNKNOWN_MODEL_PRICING;
    return UNKNOWN_MODEL_PRICING;
}
