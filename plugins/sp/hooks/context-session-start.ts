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

import { execSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveAgentHint, resolveModelHint } from './agent-hint';
import { checkContextFreshness } from './context-post-tool';

export { resolveAgentHint, resolveModelHint } from './agent-hint';

/**
 * Ancestor-run marker exported by `@gobing-ai/ts-ai-runner` ≥ 0.4.15 (`AGENT_RUN_ID_ENV`).
 *
 * `AiRunner` sets this in the agent subprocess environment whenever the caller supplies an
 * `AgentRunCorrelation`, which Spur's pipeline always does
 * (`packages/app/src/workflow/actions/agent-run.ts:148-152`) as does `spur agent run`
 * (`packages/app/src/services/agent-service.ts:661`). execa's `extendEnv` default propagates it
 * transitively, so every descendant of an agent run — including the hook subprocesses the host
 * fires inside it — inherits the same value. Its mere presence answers "am I nested?" exactly.
 *
 * Deliberately a string literal rather than an import: this hook is self-contained by design
 * (tasks 0232/0246) and runs both as a standalone script and from Superskill's bundled runner, so
 * it must not depend on the workspace's module graph. The name is a published contract on the
 * ts-ai-runner side, so a literal here is a stable coupling, not a guess.
 */
export const AGENT_RUN_ID_ENV = 'SPUR_RUN_ID';

/**
 * Fallback idle window for hosts and code paths that do **not** propagate a run correlation
 * (task 0398 R3).
 *
 * Only consulted when {@link AGENT_RUN_ID_ENV} is absent. With ts-ai-runner ≥ 0.4.15 the
 * agent-run path is detected exactly, so this no longer covers the case that motivated it — it
 * remains as a backstop for nested `SessionStart` fires that arrive outside a correlated run
 * (a host that spawns its own helper processes, or an `agent.run` invoked without a correlation).
 *
 * ponytail: still a wall-clock heuristic on that residual path — two genuinely distinct
 * uncorrelated sessions started inside the window merge into one ledger session. Kept because
 * deleting it would regress every non-correlated nesting path back to the original bug, and the
 * set of hosts is not enumerable from here. Delete it once every nesting path is known to carry a
 * correlation.
 */
export const SESSION_REUSE_IDLE_MS = 4 * 60 * 60 * 1000;

interface SessionFileBody {
    session?: unknown;
    started?: unknown;
}

/**
 * Return the id of the session already in flight, or null when a new one should be minted.
 *
 * **Why this exists (0398 R3).** `SessionStart` fires in every nested `agent.run` subprocess, not
 * once per host session. Each firing used to mint a fresh `session-<date>-<HHMM>` id, append a
 * `session_start` row, and overwrite the `.session.json` pointer that `context-post-tool` reads —
 * so a single pipeline run registered as dozens of sessions and orphaned the parent's event
 * stream. The H6 corpus shows the signature: 332 `session_start` against 157 `session_end` over
 * 18 days, 298 distinct ids, 39 starts in a 2-day window that held a handful of real sessions.
 *
 * **Two signals, in precedence order.**
 *
 * 1. {@link AGENT_RUN_ID_ENV} present → this process is a descendant of an agent run, definitively.
 *    Reuse the recorded session with no time bound: a pipeline step legitimately runs for the full
 *    `implementTimeoutMs` (30 min) and longer batches run for hours, so any wall-clock window would
 *    eventually split a run that is demonstrably still in flight.
 * 2. No marker → fall back to the {@link SESSION_REUSE_IDLE_MS} window on the `started` stamp, for
 *    hosts that nest without propagating a correlation.
 *
 * A crashed session leaves a stale `.session.json`; on path 2 the idle window retires it. On path 1
 * a stale file is only reachable from inside a live agent run, where reusing it is the correct
 * answer anyway.
 */
export function resolveActiveSession(dir: string, now: Date, env: NodeJS.ProcessEnv = process.env): string | null {
    let raw: string;
    try {
        raw = readFileSync(join(dir, '.session.json'), 'utf-8');
    } catch {
        return null; // no in-flight session (or unreadable) → mint a new one
    }

    let body: SessionFileBody;
    try {
        body = JSON.parse(raw) as SessionFileBody;
    } catch {
        return null; // corrupt pointer → mint a new one
    }

    if (typeof body.session !== 'string' || body.session.length === 0) return null;

    // Signal 1 — exact ancestry. No `started` parse, no time bound.
    const runId = env[AGENT_RUN_ID_ENV];
    if (typeof runId === 'string' && runId.trim().length > 0) return body.session;

    // Signal 2 — residual heuristic for uncorrelated nesting.
    if (typeof body.started !== 'string') return null;

    const started = Date.parse(body.started);
    if (Number.isNaN(started)) return null;

    const idleMs = now.getTime() - started;
    if (idleMs < 0 || idleMs > SESSION_REUSE_IDLE_MS) return null; // stale or clock-skewed → new

    return body.session;
}

/**
 * Core session-start path (testable). Returns session id on success, null on I/O failure.
 *
 * Idempotent per in-flight session (0398 R3): when `resolveActiveSession` finds one, this returns
 * that id and writes nothing — no ledger row, no pointer rewrite.
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

    const active = resolveActiveSession(dir, at, env);
    if (active !== null) return active;
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

    // Freshness check (task 0711 R4): report whether the context indexes were
    // regenerated at the current HEAD. Best-effort, fail-open — git failures
    // yield head=null, which marks stale only via the sidecar's own defects.
    let headCommit: string | null = null;
    try {
        const out = execSync('git rev-parse HEAD', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
        const trimmed = out.trim();
        headCommit = trimmed.length > 0 ? trimmed : null;
    } catch {
        headCommit = null;
    }
    let freshnessRaw: string | null = null;
    try {
        freshnessRaw = readFileSync(join(dir, '.freshness.json'), 'utf-8');
    } catch {
        freshnessRaw = null;
    }
    startEvent.contextFreshness = checkContextFreshness(freshnessRaw, headCommit);

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
