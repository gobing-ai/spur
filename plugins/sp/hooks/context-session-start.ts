#!/usr/bin/env bun
/** @transition-shim(sp-context-hook-imports) superskill ≤0.3.37 imports this export; the logic is `spur self hook context-session-start`. */
import { runSpurHook } from '../lib/spur-hook';

/** Forward a SessionStart payload to spur (fail-open). Returns null: the session id now lives in spur. */
export function recordSessionStartFromPayloadText(
    text: string,
    env?: Record<string, string | undefined>,
): string | null {
    runSpurHook('context-session-start', text, { host: 'auto', ...(env ? { env } : {}) });
    return null;
}
if (import.meta.main) recordSessionStartFromPayloadText(await Bun.stdin.text());
