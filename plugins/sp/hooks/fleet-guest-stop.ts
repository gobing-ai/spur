#!/usr/bin/env bun

/**
 * fleet-guest-stop — deliver pending fleet inbox work to a joined guest session at turn end
 * (G73 R4, task 1081).
 *
 * A guest pulls its own work; this hook is the accelerant that makes the pull arrive at a turn
 * boundary instead of only when the `fleet-join` skill's `wait --inbox` loop wakes. It is
 * deliberately conservative:
 *
 * - **Only a joined session blocks.** The hook matches the hook payload's `session_id` against
 *   `.spur/run/guests/*.json`; no match ⇒ exit 0 with no output (the agent finishes normally).
 * - **Never loops.** A host that reports `stop_hook_active` (Codex) is already continuing → exit 0.
 * - **Fail-open.** Every error path exits 0 silently; a hook must never fail the agent's turn.
 * - **Bounded.** The pending check is `spur agent wait --inbox <id> --timeout 2000`, which also
 *   heartbeats the guest lease (R5), and the reason names at most the first few messages.
 *
 * Block contract (both hosts that support it): exit 0 with JSON on stdout —
 * `{"decision":"block","reason":"<non-empty>"}`. Claude Code uses the reason as the stop reason;
 * Codex turns it into the next user prompt. Hosts that drop the Stop event (`codex exec` on
 * 0.160.0 — see `docs/plans/2026-10-05-codex-guest-spike.md`) simply never call it.
 *
 * Self-contained by design: hooks are bundled standalone at install time, so this file imports
 * only `node:*` builtins and relative paths (plugin-standalone contract).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getEnvVar } from '../lib/env';

/** Budget for the pending-work probe; the hook must never noticeably slow a turn. */
export const GUEST_STOP_PROBE_MS = 2000;

/** How many pending messages the delivered reason names. */
export const GUEST_STOP_MAX_MESSAGES = 5;

/** Characters of each message body the reason carries. */
export const GUEST_STOP_BODY_CHARS = 140;

/** Hard per-invocation timeout for a `spur` child the hook shells out to. */
export const GUEST_STOP_CLI_TIMEOUT_MS = 5000;

/** The hook payload fields this hook reads (Claude Code and Codex both send `session_id`). */
export interface GuestStopPayload {
    session_id?: unknown;
    stop_hook_active?: unknown;
}

/** The guest record fields the hook needs. */
export interface GuestStopRecord {
    id: string;
    sessionId?: string;
}

/** Injection seam for tests: run a `spur` invocation, returning exit code and stdout. */
export type GuestStopCli = (args: readonly string[]) => { status: number | null; stdout: string };

const defaultCli: GuestStopCli = (args) => {
    const result = spawnSync('spur', [...args], { encoding: 'utf-8', timeout: GUEST_STOP_CLI_TIMEOUT_MS });
    return { status: result.status, stdout: result.stdout ?? '' };
};

/**
 * Guest records under `<cwd>/.spur/run/guests/`. Unreadable or malformed records are skipped —
 * a broken record must not block a session's turn.
 */
export function readGuestRecords(cwd: string): GuestStopRecord[] {
    const dir = join(cwd, '.spur', 'run', 'guests');
    if (!existsSync(dir)) return [];
    const records: GuestStopRecord[] = [];
    for (const name of readdirSync(dir)) {
        if (!name.endsWith('.json')) continue;
        try {
            const parsed = JSON.parse(readFileSync(join(dir, name), 'utf-8')) as Record<string, unknown>;
            if (typeof parsed.id !== 'string') continue;
            records.push({
                id: parsed.id,
                ...(typeof parsed.sessionId === 'string' ? { sessionId: parsed.sessionId } : {}),
            });
        } catch {
            // Skip the unreadable record.
        }
    }
    return records;
}

/** The guest joined by this host session, or null. */
export function guestForSession(records: readonly GuestStopRecord[], sessionId: unknown): GuestStopRecord | null {
    if (typeof sessionId !== 'string' || sessionId === '') return null;
    return records.find((record) => record.sessionId === sessionId) ?? null;
}

/**
 * Build the Stop decision for a pending message list. Returns the JSON line to print, or null
 * when there is nothing to deliver (no messages / unparseable output).
 */
export function stopDecisionFor(
    guestId: string,
    inboxJson: string,
    maxMessages: number = GUEST_STOP_MAX_MESSAGES,
): string | null {
    let rows: unknown;
    try {
        rows = JSON.parse(inboxJson);
    } catch {
        return null;
    }
    const list = Array.isArray(rows) ? rows : undefined;
    if (list === undefined) return null;
    const pending = list
        .map((row) => row as { from_id?: unknown; fromId?: unknown; body?: unknown; status?: unknown })
        .filter((row) => row.body !== undefined && (row.status === undefined || row.status === 'queued'))
        .slice(0, maxMessages);
    if (pending.length === 0) return null;
    const lines = pending.map((row) => {
        const from =
            typeof row.from_id === 'string' ? row.from_id : typeof row.fromId === 'string' ? row.fromId : 'fleet';
        const body = String(row.body ?? '')
            .replace(/\s+/g, ' ')
            .trim();
        return `- ${from}: ${body.length > GUEST_STOP_BODY_CHARS ? `${body.slice(0, GUEST_STOP_BODY_CHARS)}…` : body}`;
    });
    const reason = `Pending fleet messages for ${guestId}:\n${lines.join('\n')}\n\nHandle them, then \`spur message reply <msgId> …\` and continue.`;
    return JSON.stringify({ decision: 'block', reason });
}

/** Injectable seams for the hook entrypoint. */
export interface GuestStopDeps {
    cwd?: string;
    cli?: GuestStopCli;
    probeMs?: number;
    maxMessages?: number;
}

/**
 * One hook invocation: return the stdout line to print, or null for a silent exit 0.
 * Never throws.
 */
export function runFleetGuestStop(payload: GuestStopPayload, deps: GuestStopDeps = {}): string | null {
    try {
        // A host that already continued this turn must not continue it again.
        if (payload.stop_hook_active === true) return null;
        const cwd = deps.cwd ?? getEnvVar('CLAUDE_PROJECT_DIR') ?? process.cwd();
        const guest = guestForSession(readGuestRecords(cwd), payload.session_id);
        if (guest === null) return null;
        const cli = deps.cli ?? defaultCli;
        // `wait --inbox` returns 0 only when queued work exists, and it heartbeats the lease.
        const probe = cli([
            'agent',
            'wait',
            '--inbox',
            guest.id,
            '--timeout',
            String(deps.probeMs ?? GUEST_STOP_PROBE_MS),
        ]);
        if (probe.status !== 0) return null;
        const inbox = cli(['message', 'inbox', '--agent', guest.id, '--json']);
        if (inbox.status !== 0) return null;
        return stopDecisionFor(guest.id, inbox.stdout, deps.maxMessages);
    } catch {
        return null;
    }
}

// Entrypoint — minimal so unit coverage focuses on the pure helpers above.
export function runStopFromStdin(raw: string, deps: GuestStopDeps = {}): string | null {
    try {
        const payload = raw.trim() === '' ? {} : (JSON.parse(raw) as GuestStopPayload);
        return runFleetGuestStop(payload, deps);
    } catch {
        return null;
    }
}

if (import.meta.main) {
    const line = runStopFromStdin(await Bun.stdin.text());
    if (line !== null) process.stdout.write(`${line}\n`);
    process.exit(0);
}
