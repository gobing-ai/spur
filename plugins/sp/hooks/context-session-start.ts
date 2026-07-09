#!/usr/bin/env bun
/**
 * context-session-start — SessionStart hook for indexed-context.
 *
 * Generates a session ID, writes `.spur/context/.session.json` (tracking the current session
 * for PostToolUse and Stop hooks), and appends a `session_start` event to
 * `token-ledger.jsonl`.
 *
 * **Fail-open contract:** every error path — unparseable payload, missing `.spur/context/`,
 * write failure — exits 0 with no output. A broken context hook must never wedge an agent.
 *
 * Self-contained by design (task 0232). Installed hook configs use the portable
 * `superskill hook run sp context-session-start` entrypoint.
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function contextDir(): string {
    return join(process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), '.spur', 'context');
}

function exitOk(): never {
    process.exit(0);
}

async function main(): Promise<void> {
    const dir = contextDir();

    // Ensure the directory exists; fail-open if we can't create it.
    try {
        mkdirSync(dir, { recursive: true });
    } catch {
        exitOk();
    }

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const sessionId = `session-${now.toISOString().slice(0, 10)}-${pad(now.getHours())}${pad(now.getMinutes())}`;
    const ts = now.toISOString();

    const sessionFile = join(dir, '.session.json');
    try {
        writeFileSync(sessionFile, JSON.stringify({ session: sessionId, started: ts, reads: 0, writes: 0, tokens: 0 }));
    } catch {
        exitOk();
    }

    const ledgerPath = join(dir, 'token-ledger.jsonl');
    try {
        appendFileSync(ledgerPath, `${JSON.stringify({ ts, session: sessionId, type: 'session_start' })}\n`);
    } catch {
        exitOk();
    }

    exitOk();
}

void main().catch(exitOk);
