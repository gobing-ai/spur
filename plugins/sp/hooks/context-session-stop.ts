#!/usr/bin/env bun
/**
 * context-session-stop — installed SessionEnd entry for indexed-context (session teardown).
 *
 * Task 1174: the owner-gated finalization logic lives in `plugins/sp/lib/context-session-stop.ts`;
 * this file is the argv/stdin adapter. Every error path exits 0 with no output, and a nested
 * `agent.run`'s shutdown stays a no-op because the owner gate lives in the core, not here.
 */

import { recordSessionEndFromPayloadText } from '../lib/context-session-stop';

if (import.meta.main) {
    try {
        recordSessionEndFromPayloadText(await Bun.stdin.text());
    } catch {
        /* fail-open: every error path exits 0 */
    }
    process.exit(0);
}
