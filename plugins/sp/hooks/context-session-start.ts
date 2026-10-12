#!/usr/bin/env bun
/**
 * context-session-start — installed SessionStart entry for indexed-context.
 *
 * Task 1174: the session open + ownership logic lives in `plugins/sp/lib/context-session-start.ts`;
 * this file is the argv/stdin adapter. Malformed/absent stdin still opens the session ownerless
 * (legacy policy) and every error path exits 0 with no output.
 */

import { recordSessionStartFromPayloadText } from '../lib/context-session-start';

if (import.meta.main) {
    try {
        recordSessionStartFromPayloadText(await Bun.stdin.text());
    } catch {
        /* fail-open */
    }
    process.exit(0);
}
