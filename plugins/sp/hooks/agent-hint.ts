/**
 * Shared host-agent identification helpers — the **only** host-agent detection path
 * in the sp plugin hooks.
 *
 * Why this file exists (task 0480 R4): `resolveAgentHint()` previously existed in two
 * places — `context-session-start.ts` (4-candidate chain, `undefined` fallback) and
 * `pi/guard-extension.ts` (3-candidate chain missing `CLAUDE_CODE_ENTRYPOINT` and
 * `CLAUDE_MODEL`, `'pi'` fallback). The divergence let the two layers reach opposite
 * conclusions about whether the calling agent is identifiable. Consolidating here
 * guarantees both hooks use the same candidate list and cannot silently diverge again.
 *
 * **Do not duplicate this candidate chain elsewhere.** New host-agent signals are
 * added to the arrays below, not to per-hook copies.
 */

/**
 * Best-effort agent name from env (never required).
 *
 * Candidate chain (checked in order, first non-empty string wins):
 * 1. `SPUR_AGENT` — explicit override
 * 2. `CLAUDE_CODE_ENTRYPOINT` — Claude Code sets this to its entrypoint path
 * 3. `TERM_PROGRAM` — terminal identifier (e.g. `claude`, `ghostty`)
 * 4. `SPUR_DEFAULT_AGENT` — configured default agent
 *
 * @param env - environment record (defaults to `process.env`)
 * @param fallback - value returned when no candidate matches (defaults to `undefined`)
 */
export function resolveAgentHint(
    env: NodeJS.ProcessEnv = process.env,
    fallback: string | undefined = undefined,
): string | undefined {
    const candidates = [env.SPUR_AGENT, env.CLAUDE_CODE_ENTRYPOINT, env.TERM_PROGRAM, env.SPUR_DEFAULT_AGENT];
    for (const c of candidates) {
        if (typeof c === 'string' && c.trim()) return c.trim();
    }
    return fallback;
}

/**
 * Best-effort model id from env (never required).
 *
 * Candidate chain (checked in order, first non-empty string wins):
 * 1. `SPUR_MODEL` — explicit override
 * 2. `ANTHROPIC_MODEL` — Anthropic API model
 * 3. `OPENAI_MODEL` — OpenAI API model
 * 4. `CLAUDE_MODEL` — Claude Code model setting
 *
 * @param env - environment record (defaults to `process.env`)
 * @param fallback - value returned when no candidate matches (defaults to `undefined`)
 */
export function resolveModelHint(
    env: NodeJS.ProcessEnv = process.env,
    fallback: string | undefined = undefined,
): string | undefined {
    const candidates = [env.SPUR_MODEL, env.ANTHROPIC_MODEL, env.OPENAI_MODEL, env.CLAUDE_MODEL];
    for (const c of candidates) {
        if (typeof c === 'string' && c.trim()) return c.trim();
    }
    return fallback;
}
