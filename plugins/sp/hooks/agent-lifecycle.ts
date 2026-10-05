#!/usr/bin/env bun

/**
 * agent-lifecycle — report this member's lifecycle state from host hooks (G73 R4, task 1080).
 *
 * A fleet member that blocks on a human (a permission prompt) looks exactly like an
 * idle one to the strategy, which then dispatches work at a member that cannot run it.
 * The host's own hook events say otherwise, so this hook maps them to a
 * `spur agent report --state … --seq …` call.
 *
 * **Fail-open contract (R4):** outside a fleet (`SPUR_SPEC_ID` unset) the hook exits
 * without any CLI call, every error path exits 0, and the report runs in a detached,
 * unref'd child — the agent never waits on it.
 *
 * Event → state:
 *   SessionStart      → idle      (docs.claude.com/en/docs/claude-code/hooks)
 *   UserPromptSubmit  → working
 *   Notification      → blocked   (matcher `permission_prompt`: the host fires it once a
 *                                  tool-use/sandbox approval prompt has waited ~6 s)
 *   Stop              → idle
 *   agent_start       → working   (Pi, ADR-129 — same core from the extension)
 *   agent_settled     → idle
 *
 * Self-contained by design: hooks are bundled standalone at install time, so this file
 * imports only `node:*` builtins and relative paths (plugin-standalone contract).
 */

import { spawn } from 'node:child_process';
import { getEnvVars } from '../lib/env';

/** Lifecycle states `spur agent report` accepts — mirrors MEMBER_LIFECYCLE_STATES in the domain. */
export type MemberLifecycleState = 'working' | 'idle' | 'blocked';

/** The env var that marks a run as a fleet member (stamped by the supervisor and AgentService). */
export const SPEC_ID_ENV = 'SPUR_SPEC_ID';

/** The host hook payload fields this hook reads. */
export interface LifecycleHookPayload {
    hook_event_name?: unknown;
    notification_type?: unknown;
}

/**
 * Map one host event to the state to report; `null` means this event reports nothing.
 *
 * The Notification type check is a second filter, not the primary one: the host matches
 * `matcher: "permission_prompt"` before the hook runs, so a host that omits the field still
 * reports `blocked`. It exists so a widened or mis-abbreviated matcher cannot report a
 * member blocked for an unrelated alert (idle/auth/elicitation prompts are not work blockers).
 */
export function lifecycleStateFor(
    eventName: unknown,
    notificationType: unknown = undefined,
): MemberLifecycleState | null {
    switch (eventName) {
        case 'SessionStart':
            return 'idle';
        case 'UserPromptSubmit':
            return 'working';
        case 'Notification':
            return notificationType === undefined || notificationType === 'permission_prompt' ? 'blocked' : null;
        case 'Stop':
            return 'idle';
        // Pi event names (ADR-129) — the extension calls this same core.
        case 'agent_start':
            return 'working';
        case 'agent_settled':
            return 'idle';
        default:
            return null;
    }
}

/**
 * Monotonic-enough report sequence (G73 Q&A, CLOSED): wall-clock nanoseconds plus the
 * sub-millisecond part of the monotonic clock. Ties lose under the strict `>` rule, which
 * is the intended stale-drop behavior.
 */
export function reportSeq(now: number = Date.now(), hrtimeNs: bigint = process.hrtime.bigint()): string {
    return (BigInt(now) * 1_000_000n + (hrtimeNs % 1_000_000n)).toString();
}

/** Dispatch seam — tests inject a recorder instead of spawning. */
export type LifecycleSpawn = (argv: readonly string[]) => void;

/** The one child we ever spawn: detached + unref'd + silent, so the agent is never delayed. */
const spawnDetached: LifecycleSpawn = (argv) => {
    const [command, ...args] = argv;
    if (command === undefined) return;
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    child.unref();
};

/** Injectable seams for tests. */
export interface ReportDeps {
    spawnDetached?: LifecycleSpawn;
    /** Environment to read `SPUR_SPEC_ID` from; defaults to the live env. */
    env?: Record<string, string | undefined>;
    /** Fixed sequence for a deterministic assertion. */
    seq?: string;
}

/** Outcome of one hook invocation — returned for tests, ignored by the entrypoint. */
export interface ReportOutcome {
    reported: boolean;
    state?: MemberLifecycleState;
    reason?: string;
}

/**
 * Report the payload's lifecycle state to the fleet, or explain why nothing was reported.
 * Never throws: a hook that fails must not fail the agent's turn.
 */
export function reportLifecycleHook(payload: LifecycleHookPayload, deps: ReportDeps = {}): ReportOutcome {
    const env = deps.env ?? getEnvVars();
    const specId = env[SPEC_ID_ENV];
    if (typeof specId !== 'string' || specId === '') {
        return { reported: false, reason: 'outside a fleet (no SPUR_SPEC_ID)' };
    }
    const state = lifecycleStateFor(payload.hook_event_name, payload.notification_type);
    if (state === null) {
        return { reported: false, reason: 'event reports no lifecycle state' };
    }
    const seq = deps.seq ?? reportSeq();
    try {
        (deps.spawnDetached ?? spawnDetached)(['spur', 'agent', 'report', '--state', state, '--seq', seq]);
    } catch (error) {
        return { reported: false, state, reason: error instanceof Error ? error.message : 'spawn failed' };
    }
    return { reported: true, state };
}

/**
 * Parse a hook stdin payload. An empty payload is an empty object; malformed JSON throws
 * and is caught by {@link runHookFromStdin} — the fail-open boundary, not this parser.
 */
export function parseHookPayload(raw: string): LifecycleHookPayload {
    if (raw.trim() === '') return {};
    return JSON.parse(raw) as LifecycleHookPayload;
}

/** One hook invocation from raw stdin — the whole entrypoint behavior, minus the exit. */
export function runHookFromStdin(raw: string, deps: ReportDeps = {}): ReportOutcome {
    try {
        return reportLifecycleHook(parseHookPayload(raw), deps);
    } catch {
        return { reported: false, reason: 'fail-open: unreadable payload' };
    }
}

// Entrypoint — minimal so unit coverage focuses on the pure helpers above.
if (import.meta.main) {
    runHookFromStdin(await Bun.stdin.text());
    process.exit(0);
}
