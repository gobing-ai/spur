/**
 * context-owner — host-native session ownership identity shared by the indexed-context hooks
 * (task 1159).
 *
 * Extracted from `context-session-start`/`context-session-stop` so the Claude stdin-payload →
 * owner derivation is a pure, importable function. A hook's `if (import.meta.main)` entrypoint runs
 * in a subprocess whose body Bun's coverage never attributes, so any real logic left there is
 * untestable; this module keeps that logic where a unit test can reach it.
 *
 * Standalone-safe (sp-plugin-standalone): no imports, so a hook bundles it as a relative path and
 * `context-session-stop` stays free of the session-start module's heavier dependency surface.
 */

/**
 * Who owns a session ledger pointer (task 1159): the host that opened the session plus that host's
 * own native session id — Claude's hook payload `session_id`, Pi's `ctx.sessionManager.getSessionId()`.
 * Deliberately **not** the ledger id (shared by every nested run), `process.pid` (a fresh hook process
 * per event) or `SPUR_RUN_ID` (present on nested children too): none of those separate owner from
 * child, so none may gate teardown; the host-native id can.
 */
export interface SessionOwner {
    host: 'claude' | 'pi';
    sessionId: string;
}

/**
 * Claude hook identity (task 1159): the payload's `session_id`, falling back to
 * `CLAUDE_CODE_SESSION_ID` only when the payload id is absent or empty (some Claude hook payloads
 * omit `session_id`). Returns null when neither yields a nonempty id — the pointer is then written
 * ownerless, so a later shutdown cannot prove ownership of it (bounded legacy policy in
 * context-session-stop).
 */
export function claudeSessionOwner(payload: unknown, env: NodeJS.ProcessEnv): SessionOwner | null {
    const raw = payload && typeof payload === 'object' ? (payload as { session_id?: unknown }).session_id : undefined;
    const fromPayload = typeof raw === 'string' ? raw.trim() : '';
    const fromEnv = (env.CLAUDE_CODE_SESSION_ID ?? '').trim();
    const sessionId = fromPayload.length > 0 ? fromPayload : fromEnv;
    return sessionId.length > 0 ? { host: 'claude', sessionId } : null;
}

/**
 * Derive the Claude owner from a raw hook stdin payload (task 1159).
 *
 * Malformed or empty stdin carries no payload identity, so it degrades to the env-only fallback
 * rather than throwing — both hooks keep their fail-open contract. Behaviour is identical to the
 * former inline `JSON.parse(await Bun.stdin.text())` try/catch in each entrypoint.
 */
export function claudeHookOwnerFromPayloadText(text: string, env: NodeJS.ProcessEnv): SessionOwner | null {
    let payload: unknown;
    try {
        payload = JSON.parse(text) as unknown;
    } catch {
        payload = undefined;
    }
    return claudeSessionOwner(payload, env);
}
