/**
 * guards — the two PreToolUse guard decisions behind `spur self hook task-write-guard` and
 * `spur self hook careful-guard`, shaped per host.
 *
 * Ported from `plugins/sp/hooks/task-write-guard.ts`, `plugins/sp/hooks/careful-guard.ts` and the
 * guard half of `plugins/sp/hooks/pi/guard-extension.ts` (script-absorption plan PR-2a,
 * docs/plans/2026-10-14-spur-script-absorption.md §5). The Claude/Codex output is byte-identical
 * to the plugin hooks; the Pi output is the `{action, reason}` reply the Pi wrapper maps onto
 * `{block}` / `ctx.ui.confirm` (§5.3).
 *
 * **Fail-open contract** (unchanged): every error path — unparseable payload, a tool the guard
 * does not watch, an empty path or command, a missing or broken `spur`, a spawn failure or
 * timeout — yields `allow`. A broken guard must never wedge an agent tool call.
 */

import { spawnSync } from 'node:child_process';
import { isAbsolute, resolve } from 'node:path';
import { classifyCommand } from './destructive-policy';
import { couldBeTaskFile } from './task-file-policy';

/** The decision a guard reaches before host shaping. */
export type GuardDecision = 'allow' | 'deny' | 'ask';

/** Host-neutral guard verdict. */
export interface GuardVerdict {
    decision: GuardDecision;
    reason?: string;
}

/** Ownership answer from `spur task resolve --strict --json`. */
export type TaskOwnership = 'owned' | 'unowned' | 'unknown';

/** Seam: resolve a path's task ownership (tests inject a fake). */
export type OwnershipResolver = (filePath: string, cwd: string) => TaskOwnership;

/** Hard timeout for the ownership probe — identical to the plugin hook's. */
export const OWNERSHIP_PROBE_TIMEOUT_MS = 8000;

/**
 * An {@link OwnershipResolver} that runs `<spurArgv…> task resolve <path> --strict --json`.
 *
 * `strictExitCodes` mirrors the two plugin adapters: the Claude hook treats every non-zero exit as
 * unowned, the Pi extension accepts only 0/1 and treats anything else (127, a broken interpreter)
 * as unknown. Both end in `allow` for anything but an exit-0 owned answer.
 */
export function spurOwnershipResolver(spurArgv: readonly string[], strictExitCodes = false): OwnershipResolver {
    const [command = 'spur', ...prefix] = spurArgv;
    return (filePath, cwd) => {
        const res = spawnSync(command, [...prefix, 'task', 'resolve', filePath, '--strict', '--json'], {
            cwd,
            encoding: 'utf-8',
            timeout: OWNERSHIP_PROBE_TIMEOUT_MS,
        });
        if (res.error || typeof res.status !== 'number') return 'unknown';
        if (strictExitCodes && res.status !== 0 && res.status !== 1) return 'unknown';
        return res.status === 0 ? 'owned' : 'unowned';
    };
}

/** Inputs shared by both guards. */
export interface GuardContext {
    env: Record<string, string | undefined>;
    cwd: string;
}

function parseObject(text: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(text) as unknown;
        return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

function field(obj: unknown, key: string): unknown {
    return obj !== null && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined;
}

const WRITE_GUARD_DENY_SUFFIX =
    'Edit it through the spur CLI (e.g. `spur task update <wbs> --section <name> --from-file <file>`), not a raw ' +
    'Write/Edit. Set SPUR_WRITE_GUARD=off to bypass.';

/** Claude/Codex task-write-guard (payload: `{tool_name, tool_input: {file_path}}`). */
export function taskWriteGuardClaude(stdin: string, ctx: GuardContext, resolver: OwnershipResolver): GuardVerdict {
    if (ctx.env.SPUR_WRITE_GUARD === 'off') return { decision: 'allow' };
    const payload = parseObject(stdin);
    if (payload === null) return { decision: 'allow' };
    const toolName = payload.tool_name ?? '';
    if (toolName !== 'Write' && toolName !== 'Edit') return { decision: 'allow' };
    const rawPath = field(payload.tool_input, 'file_path');
    const filePath = typeof rawPath === 'string' ? rawPath : '';
    if (filePath === '' || !couldBeTaskFile(filePath)) return { decision: 'allow' };
    const projectDir = ctx.env.CLAUDE_PROJECT_DIR ?? ctx.cwd;
    if (resolver(filePath, projectDir) !== 'owned') return { decision: 'allow' };
    return {
        decision: 'deny',
        reason: `${filePath} is a task file owned by the spur corpus. ${WRITE_GUARD_DENY_SUFFIX}`,
    };
}

/** Pi task-write-guard (event: `{toolName: 'write'|'edit', input: {path|file_path}}`). */
export function taskWriteGuardPi(stdin: string, ctx: GuardContext, resolver: OwnershipResolver): GuardVerdict {
    if (ctx.env.SPUR_WRITE_GUARD === 'off') return { decision: 'allow' };
    const event = parseObject(stdin);
    if (event === null) return { decision: 'allow' };
    if (event.toolName !== 'write' && event.toolName !== 'edit') return { decision: 'allow' };
    const input = event.input;
    const raw =
        typeof field(input, 'path') === 'string'
            ? (field(input, 'path') as string)
            : typeof field(input, 'file_path') === 'string'
              ? (field(input, 'file_path') as string)
              : '';
    if (raw === '') return { decision: 'allow' };
    const filePath = isAbsolute(raw) ? raw : resolve(ctx.cwd, raw);
    if (!couldBeTaskFile(filePath) || resolver(filePath, ctx.cwd) !== 'owned') return { decision: 'allow' };
    return { decision: 'deny', reason: `Denied: ${filePath} is a Spur task file. Use 'spur task update' instead.` };
}

/** Claude/Codex careful-guard (payload: `{tool_name: 'Bash', tool_input: {command}}`). */
export function carefulGuardClaude(stdin: string, ctx: GuardContext): GuardVerdict {
    if (ctx.env.SPUR_CAREFUL === 'off') return { decision: 'allow' };
    const payload = parseObject(stdin);
    if (payload === null || payload.tool_name !== 'Bash') return { decision: 'allow' };
    const rawCommand = field(payload.tool_input, 'command');
    const command = typeof rawCommand === 'string' ? rawCommand : '';
    if (command.trim() === '') return { decision: 'allow' };
    const hit = classifyCommand(command);
    if (hit === null) return { decision: 'allow' };
    return {
        decision: 'ask',
        reason:
            `This command looks like ${hit} — a destructive operation. Confirm you intend to run it. ` +
            'Set SPUR_CAREFUL=off to disable this guard.',
    };
}

/** Pi careful-guard (event: `{toolName: 'bash', input: {command}}`). */
export function carefulGuardPi(stdin: string, ctx: GuardContext): GuardVerdict {
    if (ctx.env.SPUR_CAREFUL === 'off') return { decision: 'allow' };
    const event = parseObject(stdin);
    if (event === null || event.toolName !== 'bash') return { decision: 'allow' };
    const rawCommand = field(event.input, 'command');
    const command = typeof rawCommand === 'string' ? rawCommand : '';
    const hit = command ? classifyCommand(command) : null;
    if (hit === null) return { decision: 'allow' };
    return { decision: 'ask', reason: `Warning: destructive command — ${hit}: ${command.slice(0, 120)}` };
}

/**
 * Shape a write-guard verdict for Claude/Codex exactly as `plugins/sp/hooks/task-write-guard.ts`
 * prints it (reason as `systemMessage` only).
 */
export function formatWriteGuardClaude(verdict: GuardVerdict): string {
    const out: Record<string, unknown> = {
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: verdict.decision },
    };
    if (verdict.reason !== undefined) out.systemMessage = verdict.reason;
    return JSON.stringify(out);
}

/**
 * Shape a careful-guard verdict for Claude/Codex exactly as `plugins/sp/hooks/careful-guard.ts`
 * prints it (reason as both `permissionDecisionReason` and `systemMessage`).
 */
export function formatCarefulGuardClaude(verdict: GuardVerdict): string {
    const hookSpecificOutput: Record<string, unknown> = {
        hookEventName: 'PreToolUse',
        permissionDecision: verdict.decision,
    };
    if (verdict.reason !== undefined) hookSpecificOutput.permissionDecisionReason = verdict.reason;
    const out: Record<string, unknown> = { hookSpecificOutput };
    if (verdict.reason !== undefined) out.systemMessage = verdict.reason;
    return JSON.stringify(out);
}

/** Shape any guard verdict for the Pi wrapper: `{"action":"allow"|"deny"|"ask","reason"?}`. */
export function formatGuardPi(verdict: GuardVerdict): string {
    return JSON.stringify(
        verdict.reason === undefined
            ? { action: verdict.decision }
            : { action: verdict.decision, reason: verdict.reason },
    );
}
