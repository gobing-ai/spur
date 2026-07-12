#!/usr/bin/env bun
/**
 * context-session-start — SessionStart hook for indexed-context.
 *
 * Generates a session ID, writes `.spur/context/.session.json` (tracking the current session
 * for PostToolUse and Stop hooks), and appends a `session_start` event to
 * `token-ledger.jsonl`. Task 0246: best-effort agent/model hints on session file + event.
 *
 * **Fail-open contract:** every error path exits 0 with no output.
 *
 * Self-contained by design (task 0232/0246).
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Best-effort agent name from env (never required). */
export function resolveAgentHint(env: NodeJS.ProcessEnv = process.env): string | undefined {
    const candidates = [env.SPUR_AGENT, env.CLAUDE_CODE_ENTRYPOINT, env.TERM_PROGRAM, env.SPUR_DEFAULT_AGENT];
    for (const c of candidates) {
        if (typeof c === 'string' && c.trim()) return c.trim();
    }
    return undefined;
}

/** Best-effort model id from env (never required). */
export function resolveModelHint(env: NodeJS.ProcessEnv = process.env): string | undefined {
    const candidates = [env.SPUR_MODEL, env.ANTHROPIC_MODEL, env.OPENAI_MODEL, env.CLAUDE_MODEL];
    for (const c of candidates) {
        if (typeof c === 'string' && c.trim()) return c.trim();
    }
    return undefined;
}

/**
 * Core session-start path (testable). Returns session id on success, null on I/O failure.
 */
export function recordSessionStart(
    dir: string,
    env: NodeJS.ProcessEnv = process.env,
    now: () => Date = () => new Date(),
): string | null {
    try {
        mkdirSync(dir, { recursive: true });
    } catch {
        return null;
    }

    const at = now();
    const pad = (n: number) => String(n).padStart(2, '0');
    const sessionId = `session-${at.toISOString().slice(0, 10)}-${pad(at.getHours())}${pad(at.getMinutes())}`;
    const ts = at.toISOString();
    const agent = resolveAgentHint(env);
    const model = resolveModelHint(env);

    const sessionBody: Record<string, unknown> = {
        session: sessionId,
        started: ts,
        reads: 0,
        writes: 0,
        tokens: 0,
    };
    if (agent) sessionBody.agent = agent;
    if (model) sessionBody.model = model;

    const sessionFile = join(dir, '.session.json');
    try {
        writeFileSync(sessionFile, JSON.stringify(sessionBody));
    } catch {
        return null;
    }

    const startEvent: Record<string, unknown> = { ts, session: sessionId, type: 'session_start' };
    if (agent) startEvent.agent = agent;
    if (model) startEvent.model = model;

    const ledgerPath = join(dir, 'token-ledger.jsonl');
    try {
        appendFileSync(ledgerPath, `${JSON.stringify(startEvent)}\n`);
    } catch {
        return null;
    }

    return sessionId;
}

// Entrypoint — kept minimal so unit coverage focuses on pure helpers above.
if (import.meta.main) {
    try {
        recordSessionStart(join(process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), '.spur', 'context'));
    } catch {
        /* fail-open */
    }
    process.exit(0);
}
