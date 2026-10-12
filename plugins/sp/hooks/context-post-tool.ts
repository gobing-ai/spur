#!/usr/bin/env bun
/**
 * context-post-tool — installed PostToolUse entry for indexed-context
 * (matcher: Bash|Grep|Glob|Read|Write|Edit — task 0248).
 *
 * Task 1174: the capture logic lives in `plugins/sp/lib/context-post-tool.ts`; this file is the
 * argv/stdin adapter the installed `superskill hook run sp context-post-tool` entry resolves to.
 * The redaction, byte-cap and fail-open contract (every error path exits 0 with no output) is
 * unchanged — the adapter adds no policy of its own.
 */

import { join } from 'node:path';
import { recordToolUseEvent, type ToolPayload } from '../lib/context-post-tool';
import { getEnvVar } from '../lib/env';

if (import.meta.main) {
    void (async () => {
        const dir = join(getEnvVar('CLAUDE_PROJECT_DIR') ?? process.cwd(), '.spur', 'context');
        try {
            const stdinText = await Bun.stdin.text();
            const payload = JSON.parse(stdinText) as ToolPayload;
            recordToolUseEvent(dir, payload);
        } catch {
            /* fail-open: malformed stdin / I/O */
        }
        process.exit(0);
    })();
}
