/**
 * Pi extension for Spur (sp) plugin hooks.
 *
 * Replaces @vahor/pi-hooks with native Pi event handlers — no spinner,
 * no pi.exec overhead, no "Operation aborted" on Esc.
 *
 * Implements:
 *   - task-write-guard  (tool_call → block Write/Edit to Spur task files)
 *   - careful-guard     (tool_call → warn on destructive Bash commands)
 *   - context-post-tool (tool_result → shared recordToolUseEvent)
 *   - context-session-start (session_start → shared recordSessionStart)
 *   - context-session-stop  (session_shutdown → shared recordSessionEnd)
 *
 * The ledger and session cores are shared with the Claude hooks (task 0969): this
 * extension only normalizes Pi event shapes and adapts them to those cores.
 *
 * Installation:
 *   Add to ~/.pi/agent/settings.json packages:
 *     "npm:spur"  (when published), or
 *   Copy to ~/.pi/agent/extensions/sp-guard/ and reference via:
 *     "pi": { "extensions": ["path/to/guard-extension.ts"] }
 */

import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { getEnvVar, getEnvVars } from '../../lib/env';
import { recordToolUseEvent, type ToolPayload } from '../context-post-tool';
import { recordSessionStart } from '../context-session-start';
import { recordSessionEnd } from '../context-session-stop';
import { classifyCommand } from '../destructive-policy';
import { couldBeTaskFile } from '../task-file-policy';

// ─── Constants ───────────────────────────────────────────────────────────

// Resolved per call, not cached at module load: Pi's cwd is fixed for the
// process lifetime, and lazy resolution keeps the extension testable (tests
// chdir into a temp project before driving handlers).
const spurContextDir = (): string => join(process.cwd(), '.spur', 'context');

// ─── Helpers ─────────────────────────────────────────────────────────────

type TaskOwnership = 'owned' | 'unowned' | 'unknown';

/**
 * Extract the target path from a write/edit tool input. Pi uses `path`;
 * Claude Code uses `file_path`. Returns an absolute path when present.
 */
function resolveInputPath(input: Record<string, unknown> | undefined): string {
    let raw = '';
    if (input) {
        if (typeof input.path === 'string') raw = input.path;
        else if (typeof input.file_path === 'string') raw = input.file_path;
    }
    if (!raw) return '';
    return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

/**
 * Candidate `spur` executable locations (symlinks). Pi launched from a GUI
 * may not have `~/.bun/bin` or node/bun on PATH, so we try each in order
 * and finally run spur.js via the current Bun executable directly.
 */
const SPUR_BIN_CANDIDATES: string[] = [
    join(homedir(), '.bun', 'bin', 'spur'),
    '/opt/homebrew/bin/spur',
    '/usr/local/bin/spur',
];

/** Resolve a candidate spur symlink to its real spur.js path (for execPath fallback). */
function resolveSpurJsPath(candidate: string): string | undefined {
    try {
        return realpathSync(candidate);
    } catch {
        return existsSync(candidate) ? candidate : undefined;
    }
}

function resolveSpurTaskOwnership(filePath: string): TaskOwnership {
    const run = (cmd: string, args: string[]) =>
        spawnSync(cmd, args, { cwd: process.cwd(), encoding: 'utf-8', timeout: 8000 });

    // 1. SPUR_BIN env override (may include args) or `spur` on PATH
    const envBin = getEnvVar('SPUR_BIN') || 'spur';
    const envParts = envBin.split(' ');
    let res = run(envParts[0] ?? 'spur', [...envParts.slice(1), 'task', 'resolve', filePath, '--strict', '--json']);
    // Only 0 (owned) / 1 (unowned) are valid spur exit codes; 127 (interpreter
    // missing) and other codes mean the environment is broken — keep trying.
    if (!res.error && (res.status === 0 || res.status === 1)) return res.status === 0 ? 'owned' : 'unowned';

    // 2. Absolute symlink paths (needs node/bun on PATH for the shebang)
    for (const candidate of SPUR_BIN_CANDIDATES) {
        if (!existsSync(candidate)) continue;
        res = run(candidate, ['task', 'resolve', filePath, '--strict', '--json']);
        if (!res.error && (res.status === 0 || res.status === 1)) return res.status === 0 ? 'owned' : 'unowned';
    }

    // 3. Run spur.js via the current Bun executable (no PATH dependency)
    for (const candidate of SPUR_BIN_CANDIDATES) {
        const spurJs = resolveSpurJsPath(candidate);
        if (!spurJs) continue;
        res = run(process.execPath, [spurJs, 'task', 'resolve', filePath, '--strict', '--json']);
        if (!res.error && (res.status === 0 || res.status === 1)) return res.status === 0 ? 'owned' : 'unowned';
    }

    return 'unknown';
}

// Destructive-command classification is imported from `../destructive-policy`, the
// single cross-platform policy. This file previously carried its own regex copy; it
// diverged from the Claude matrix on 7 of 10 pinned cases (it allowed
// `rm -rf node_modules /etc/nginx`, `rm -R --force /var/data`, `git push -f` and
// `git push origin +main`, and warned on `git push --force-with-lease`). Do not
// re-introduce a local copy — add cases to `destructive-policy.test.ts` instead.

// ─── Pi → Claude payload normalization (task 0969 R1) ─────────────────────

/** Pi tool name → the Claude tool name the shared core records. */
const PI_TO_CLAUDE: Record<string, string> = {
    read: 'Read',
    write: 'Write',
    edit: 'Edit',
    bash: 'Bash',
    grep: 'Grep',
    find: 'Glob',
};

/** Join the text parts of a Pi tool_result `content` payload. */
function piContentText(content: unknown): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    const parts: string[] = [];
    for (const part of content) {
        if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
            parts.push((part as { text: string }).text);
        }
    }
    return parts.join('\n');
}

/**
 * Pure Pi-event → Claude-{@link ToolPayload} adapter. An unmapped tool returns null so the
 * shared core writes no row (R1's row filter). Search tools keep `path` (never `file_path`)
 * because the core treats `file_path` as the written file, not a search root.
 */
export function normalizePiToolEvent(
    toolName: string,
    input: Record<string, unknown> | undefined,
    content?: unknown,
): ToolPayload | null {
    const mapped = PI_TO_CLAUDE[toolName];
    if (mapped === undefined) return null;
    const i = input ?? {};
    const str = (value: unknown): string => (typeof value === 'string' ? value : '');
    const path = str(i.path) || str(i.file_path);
    const text = piContentText(content);
    const tool_response = text.length > 0 ? { content: text } : undefined;

    switch (mapped) {
        case 'Read':
            return { tool_name: mapped, tool_input: { file_path: path }, tool_response };
        case 'Write':
            return { tool_name: mapped, tool_input: { file_path: path, content: str(i.content) }, tool_response };
        case 'Edit': {
            const edits = Array.isArray(i.edits) ? (i.edits as Array<Record<string, unknown>>) : [];
            return {
                tool_name: mapped,
                tool_input: {
                    file_path: path,
                    old_string: edits.map((e) => str(e.oldText)).join(''),
                    new_string: edits.map((e) => str(e.newText)).join(''),
                },
                tool_response,
            };
        }
        case 'Grep':
            return {
                tool_name: mapped,
                tool_input: {
                    pattern: str(i.pattern),
                    ...(path ? { path } : {}),
                    ...(str(i.glob) ? { glob: str(i.glob) } : {}),
                },
                tool_response,
            };
        case 'Glob':
            return {
                tool_name: mapped,
                tool_input: { pattern: str(i.pattern), ...(path ? { path } : {}) },
                tool_response,
            };
        case 'Bash':
            return { tool_name: mapped, tool_input: { command: str(i.command) }, tool_response };
        default:
            return null;
    }
}

// ─── Extension entry point ───────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
    // ── task-write-guard + careful-guard ──────────────────────────────
    pi.on('tool_call', async (event, ctx) => {
        // task-write-guard: block Write/Edit to Spur task files.
        // Both guards honor the same `off` escape hatches as the Claude hooks.
        if ((event.toolName === 'write' || event.toolName === 'edit') && getEnvVar('SPUR_WRITE_GUARD') !== 'off') {
            const input = event.input as Record<string, unknown> | undefined;
            // Pi's write/edit tools use `path` (not Claude Code's `file_path`)
            const filePath = resolveInputPath(input);
            // Skip the `spur task resolve` subprocess for paths that cannot name a
            // task file (shared predicate — see task-file-policy.ts).
            if (filePath && couldBeTaskFile(filePath) && resolveSpurTaskOwnership(filePath) === 'owned') {
                const msg = `Denied: ${filePath} is a Spur task file. Use 'spur task update' instead.`;
                ctx.ui.notify(msg, 'error');
                return { block: true, reason: msg };
            }
        }

        // careful-guard: warn on destructive Bash commands
        if (event.toolName === 'bash' && getEnvVar('SPUR_CAREFUL') !== 'off') {
            const input = event.input as Record<string, unknown> | undefined;
            const command = typeof input?.command === 'string' ? input.command : '';
            const hit = command ? classifyCommand(command) : null;
            if (hit !== null) {
                const msg = `Warning: destructive command — ${hit}: ${command.slice(0, 120)}`;
                ctx.ui.notify(msg, 'warning');
                // Ask for confirmation
                const ok = await ctx.ui.confirm('Destructive command', msg);
                if (!ok) return { block: true, reason: 'Cancelled by user' };
            }
        }

        return {};
    });

    // ── context-post-tool: shared recordToolUseEvent (task 0969 R1) ──
    pi.on('tool_result', async (event) => {
        try {
            const payload = normalizePiToolEvent(
                event.toolName,
                event.input as Record<string, unknown> | undefined,
                (event as { content?: unknown }).content,
            );
            if (payload) recordToolUseEvent(spurContextDir(), payload);
        } catch {
            // fail-open
        }
    });

    // ── context-session-start: shared recordSessionStart (R2) ────────
    pi.on('session_start', async () => {
        try {
            recordSessionStart(spurContextDir(), getEnvVars(), undefined, 'pi');
        } catch {
            // fail-open
        }
    });

    // ── context-session-stop: shared recordSessionEnd (R3) ──────────
    pi.on('session_shutdown', async () => {
        try {
            recordSessionEnd(spurContextDir());
        } catch {
            // fail-open
        }
    });
}
