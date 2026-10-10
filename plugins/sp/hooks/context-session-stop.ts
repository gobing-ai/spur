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
 * **Owner-gated finalization (task 1159).** A nested `agent.run` reuses its parent's pointer but
 * used to finalize and delete it on its own shutdown, so every later parent tool event landed in a
 * dead ledger. Shutdown now proceeds only when the caller's host-native identity equals the owner
 * recorded on the pointer, so a child's shutdown is a no-op.
 *
 * **Fail-open contract:** every error path — missing `.spur/context/`, missing/unparseable
 * `.session.json`, write failure — exits 0 with no output.
 *
 * Self-contained by design (task 0232). Installed hook configs use the portable
 * `superskill hook run sp context-session-stop` entrypoint.
 */

import { appendFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getEnvVar, getEnvVars } from '../lib/env';
import { claudeHookOwnerFromPayloadText } from './context-owner';
// Type-only import: erased at bundle time, so this hook keeps its minimal
// node:fs/node:path/env dependency surface (sp-plugin-standalone contract).
import type { SessionOwner } from './context-session-start';

interface LedgerEvent {
    session: string;
    type: string;
    tokens?: number;
}

interface SessionPointer {
    session?: unknown;
    owner?: unknown;
}

/** Parse and validate an owner read from the pointer or supplied by a caller. */
function validSessionOwner(raw: unknown): SessionOwner | null {
    if (!raw || typeof raw !== 'object') return null;
    const host = (raw as { host?: unknown }).host;
    const sessionId = (raw as { sessionId?: unknown }).sessionId;
    if (host !== 'claude' && host !== 'pi') return null;
    if (typeof sessionId !== 'string') return null;
    const trimmed = sessionId.trim();
    return trimmed.length > 0 ? { host, sessionId: trimmed } : null;
}

function sameOwner(a: SessionOwner, b: SessionOwner): boolean {
    return a.host === b.host && a.sessionId === b.sessionId;
}

/** Read and validate the private session pointer, or null when absent/corrupt. */
function readPointer(sessionFile: string): SessionPointer | null {
    if (!existsSync(sessionFile)) return null;
    try {
        return JSON.parse(readFileSync(sessionFile, 'utf-8')) as SessionPointer;
    } catch {
        return null;
    }
}

/** Scan the token-ledger JSONL for this session's events and compute rollup totals. */
function computeSessionTotals(
    ledgerPath: string,
    sessionId: string,
): { reads: number; writes: number; tokens: number } {
    let reads = 0;
    let writes = 0;
    let tokens = 0;
    let lines: string[];
    try {
        lines = readFileSync(ledgerPath, 'utf-8').split('\n');
    } catch {
        return { reads, writes, tokens }; // missing/unreadable ledger → zero totals
    }
    for (const line of lines) {
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

/** Return the existing `session_end` row for `sessionId`, or null when the ledger has none. */
function findSessionEnd(ledgerPath: string, sessionId: string): Record<string, unknown> | null {
    let lines: string[];
    try {
        lines = readFileSync(ledgerPath, 'utf-8').split('\n');
    } catch {
        return null;
    }
    for (const line of lines) {
        if (!line.trim()) continue;
        try {
            const evt = JSON.parse(line) as Record<string, unknown>;
            if (evt.type === 'session_end' && evt.session === sessionId) return evt;
        } catch {
            // skip unparseable lines
        }
    }
    return null;
}

/**
 * Finalize one session (task 0969 R3; owner-gated task 1159): read the `.session.json` pointer,
 * compute the session's rollup totals, append the `session_end` row, remove the pointer
 * (best-effort) and return the event. Shared by this hook's entrypoint and Pi's `session_shutdown`
 * so both hosts roll up identically. Returns null on every fail-open path.
 *
 * `caller` is the identity of the process firing shutdown. Finalization requires it to be a valid
 * identity that **equals** the pointer's recorded owner; a missing/mismatched/malformed caller, a
 * legacy ownerless pointer or a corrupt pointer all return null with no writes and no removal.
 * Ownerless pointers stay readable and reusable for tool recording — the bounded legacy policy is
 * that an unattributable session is retired by the existing idle-start expiry, never claimed here.
 *
 * Repeat safety: before appending, an existing `session_end` row for the ledger suppresses a
 * second one, so a replay after a failed pointer cleanup neither duplicates the row nor strands the
 * pointer. Removal re-reads the pointer and requires both the ledger id and the owner to be
 * unchanged, so a pointer replaced since the first read is left untouched.
 */
export function recordSessionEnd(
    dir: string,
    now: () => Date = () => new Date(),
    caller?: SessionOwner,
): Record<string, unknown> | null {
    const sessionFile = join(dir, '.session.json');
    const pointer = readPointer(sessionFile);
    if (!pointer) return null;

    const sessionId = typeof pointer.session === 'string' ? pointer.session : '';
    if (!sessionId) return null;

    // Ownership gate: only the identity recorded at creation may finalize or remove.
    const pointerOwner = validSessionOwner(pointer.owner);
    const callerOwner = validSessionOwner(caller);
    if (!pointerOwner || !callerOwner || !sameOwner(pointerOwner, callerOwner)) return null;

    const ledgerPath = join(dir, 'token-ledger.jsonl');

    let event: Record<string, unknown>;
    const existing = findSessionEnd(ledgerPath, sessionId);
    if (existing) {
        // Replay: the end row survived an earlier failed pointer cleanup. Retry the removal below
        // without appending a duplicate.
        event = existing;
    } else {
        const totals = computeSessionTotals(ledgerPath, sessionId);
        event = { ts: now().toISOString(), session: sessionId, type: 'session_end', totals };
        try {
            appendFileSync(ledgerPath, `${JSON.stringify(event)}\n`);
        } catch {
            return null; // retain the pointer so a later owning shutdown can retry
        }
    }

    // Remove only the exact pointer finalized above: re-read and require the ledger id and owner
    // to be unchanged, so a pointer replaced during recording survives.
    try {
        const current = readPointer(sessionFile);
        const currentOwner = current ? validSessionOwner(current.owner) : null;
        if (current?.session === sessionId && currentOwner && sameOwner(currentOwner, pointerOwner)) {
            rmSync(sessionFile, { force: true });
        }
    } catch {
        // cleanup is best-effort
    }

    return event;
}

/**
 * Finalize the session for a raw Claude stdin payload (task 1159, testable half).
 *
 * Malformed/absent text carries no identity, so shutdown fails closed; the dir resolution lives here
 * rather than in the entrypoint so the untestable subprocess body stays a few lines.
 */
export function recordSessionEndFromPayloadText(
    text: string,
    env: NodeJS.ProcessEnv = getEnvVars(),
): Record<string, unknown> | null {
    const dir = join(getEnvVar('CLAUDE_PROJECT_DIR') ?? process.cwd(), '.spur', 'context');
    return recordSessionEnd(dir, undefined, claudeHookOwnerFromPayloadText(text, env) ?? undefined);
}

// Entrypoint — thin stdin adapter (fail-open); logic lives in the exported core above.
if (import.meta.main) {
    try {
        recordSessionEndFromPayloadText(await Bun.stdin.text());
    } catch {
        /* fail-open: every error path exits 0 */
    }
    process.exit(0);
}
