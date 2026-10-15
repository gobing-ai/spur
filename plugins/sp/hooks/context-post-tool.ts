#!/usr/bin/env bun
/** @transition-shim(sp-context-hook-imports) superskill ≤0.3.37 imports this export; the logic is `spur self hook context-post-tool`. */
import { resolve } from 'node:path';
import { runSpurHook } from '../lib/spur-hook';

/** Forward a PostToolUse payload to spur, run from the project that owns `<project>/.spur/context` (fail-open). */
export function recordToolUseEvent(contextDir: string, payload: unknown): void {
    runSpurHook('context-post-tool', JSON.stringify(payload), { host: 'auto', cwd: resolve(contextDir, '..', '..') });
}
if (import.meta.main) runSpurHook('context-post-tool', await Bun.stdin.text(), { host: 'auto' });
