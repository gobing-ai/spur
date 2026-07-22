#!/usr/bin/env bun
/**
 * context-session-stop — SessionEnd hook for indexed-context (session teardown).
 *
 * Scans `token-ledger.jsonl` for the current session's events, computes rollup totals, appends
 * a `session_end` event, and cleans up `.session.json`. Registered on SessionEnd (not Stop) so it
 * runs once at true session teardown: on Claude Code the rollup counts the whole session (Stop fired
 * per-turn and tore down after turn 1), and on Pi/omp it maps to `session_shutdown` — off the
 * `agent_end`/Stop event where blocking gates (e.g. cc/anti-hallucination) live and would collide.
 *
 * **Fail-open contract:** every error path — missing `.spur/context/`, missing/unparseable
 * `.session.json`, write failure — exits 0 with no output.
 *
 * Self-contained by design (task 0232). Installed hook configs use the portable
 * `superskill hook run sp context-session-stop` entrypoint.
 */

import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

interface LedgerEvent {
    session: string;
    type: string;
    tokens?: number;
}

/** Scan the token-ledger JSONL for this session's events and compute rollup totals. */
function computeSessionTotals(
    ledgerPath: string,
    sessionId: string,
): { reads: number; writes: number; tokens: number } {
    if (!existsSync(ledgerPath)) return { reads: 0, writes: 0, tokens: 0 };
    let reads = 0;
    let writes = 0;
    let tokens = 0;
    for (const line of readFileSync(ledgerPath, 'utf-8').split('\n')) {
        if (!line.trim()) continue;
        try {
            const evt = JSON.parse(line) as LedgerEvent;
            if (evt.session !== sessionId) continue;
            if (evt.type === 'read') reads++;
            else if (evt.type === 'write') writes++;
            if (evt.tokens) tokens += evt.tokens;
        } catch {
            // skip unparseable lines
        }
    }
    return { reads, writes, tokens };
}

function exitOk(): never {
    process.exit(0);
}

async function main(): Promise<void> {
    const dir = join(process.env.CLAUDE_PROJECT_DIR ?? process.cwd(), '.spur', 'context');

    const sessionFile = join(dir, '.session.json');
    if (!existsSync(sessionFile)) exitOk();

    let sessionId = '';
    try {
        const session = JSON.parse(readFileSync(sessionFile, 'utf-8')) as { session?: string };
        sessionId = session.session ?? '';
    } catch {
        exitOk();
    }

    if (!sessionId) exitOk();

    const totals = computeSessionTotals(join(dir, 'token-ledger.jsonl'), sessionId);

    const event = {
        ts: new Date().toISOString(),
        session: sessionId,
        type: 'session_end' as const,
        totals,
    };

    try {
        appendFileSync(join(dir, 'token-ledger.jsonl'), `${JSON.stringify(event)}\n`);
    } catch {
        exitOk();
    }

    try {
        rmSync(sessionFile, { force: true });
    } catch {
        // cleanup is best-effort
    }

    exitOk();
}

void main().catch(exitOk);
