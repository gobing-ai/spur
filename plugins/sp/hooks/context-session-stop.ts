#!/usr/bin/env bun
/** @transition-shim(sp-context-hook-imports) superskill ≤0.3.37 imports this export; the logic is `spur self hook context-session-stop`. */
import { runSpurHook } from '../lib/spur-hook';

/** Forward a SessionEnd payload to spur (fail-open). Returns null: the totals row is written by spur. */
export function recordSessionEndFromPayloadText(
    text: string,
    env?: Record<string, string | undefined>,
): Record<string, unknown> | null {
    runSpurHook('context-session-stop', text, { host: 'auto', ...(env ? { env } : {}) });
    return null;
}
if (import.meta.main) recordSessionEndFromPayloadText(await Bun.stdin.text());
