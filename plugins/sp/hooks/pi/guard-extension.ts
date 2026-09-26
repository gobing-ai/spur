/**
 * Pi extension for Spur (sp) plugin hooks.
 *
 * Replaces @vahor/pi-hooks with native Pi event handlers — no spinner,
 * no pi.exec overhead, no "Operation aborted" on Esc.
 *
 * Implements:
 *   - task-write-guard  (tool_call → block Write/Edit to Spur task files)
 *   - careful-guard     (tool_call → warn on destructive Bash commands)
 *   - context-post-tool (tool_result → append to token-ledger.jsonl)
 *   - context-session-start (session_start → init .session.json)
 *   - context-session-stop  (session_shutdown → rollup + cleanup)
 *
 * Installation:
 *   Add to ~/.pi/agent/settings.json packages:
 *     "npm:spur"  (when published), or
 *   Copy to ~/.pi/agent/extensions/sp-guard/ and reference via:
 *     "pi": { "extensions": ["path/to/guard-extension.ts"] }
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { getEnvVar, getEnvVars } from '../../lib/env';
import { resolveAgentHint as resolveAgentHintShared, resolveModelHint as resolveModelHintShared } from '../agent-hint';
import { cappedByteLength, truncateSummary } from '../context-post-tool';
import { classifyCommand } from '../destructive-policy';
import { couldBeTaskFile } from '../task-file-policy';

// ─── Constants ───────────────────────────────────────────────────────────

// Resolved per call, not cached at module load: Pi's cwd is fixed for the
// process lifetime, and lazy resolution keeps the extension testable (tests
// chdir into a temp project before driving handlers).
const spurContextDir = (): string => join(process.cwd(), '.spur', 'context');
const sessionFilePath = (): string => join(spurContextDir(), '.session.json');
const ledgerFilePath = (): string => join(spurContextDir(), 'token-ledger.jsonl');

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

// ─── Token ledger helpers (mirrors context-post-tool.ts) ──────────────────

interface ToolEvent {
    session_id?: string;
    tool_name?: string;
    tool_input?: Record<string, unknown>;
}

// Summaries persist to disk, so they go through the same scrubber as the Claude hook —
// the local copy this replaced stored the raw command (secrets included) as `summary`.
function summarizeToolEvent(event: ToolEvent): string {
    const input = event.tool_input ?? {};
    const candidates = [input.file_path, input.command, input.pattern, input.glob_pattern, input.glob, input.path];
    for (const c of candidates) {
        if (typeof c === 'string' && c.trim()) return truncateSummary(c);
    }
    return `(${event.tool_name ?? 'unknown'})`;
}

function appendToLedger(event: ToolEvent, command: string | undefined): void {
    try {
        if (!existsSync(spurContextDir())) return;
        const sessionId = readSessionId();
        if (!sessionId) return;

        const summary = summarizeToolEvent(event);
        const tokens = command ? Math.ceil(cappedByteLength(command) / 4) : 0;
        const input = event.tool_input ?? {};
        // Pi tool names are lowercase (`read`) and its write/edit tools take `path`, not `file_path`.
        const path = typeof input.file_path === 'string' ? input.file_path : input.path;

        const ledgerEntry = JSON.stringify({
            session: sessionId,
            type: event.tool_name?.toLowerCase() === 'read' ? 'read' : 'write',
            tool: event.tool_name,
            file: typeof path === 'string' ? path : undefined,
            summary,
            tokens,
            ts: new Date().toISOString(),
        });

        appendFileSync(ledgerFilePath(), `${ledgerEntry}\n`);
    } catch {
        // fail-open: skip ledger writes on error
    }
}

function readSessionId(): string | undefined {
    try {
        if (!existsSync(sessionFilePath())) return undefined;
        const data = JSON.parse(readFileSync(sessionFilePath(), 'utf-8')) as { session_id?: string };
        return data.session_id;
    } catch {
        return undefined;
    }
}

// ─── Session helpers (agent/model hints from agent-hint.ts; mirrors context-session-stop.ts) ─

function generateSessionId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 10);
    return `${timestamp}-${random}`;
}

function initSession(): void {
    try {
        mkdirSync(spurContextDir(), { recursive: true });
        const sessionId = generateSessionId();
        const session = {
            session_id: sessionId,
            agent: resolveAgentHintShared(getEnvVars(), 'pi'),
            model: resolveModelHintShared(getEnvVars()),
            started_at: new Date().toISOString(),
        };
        writeFileSync(sessionFilePath(), `${JSON.stringify(session, null, 2)}\n`);

        // Append session_start event to ledger
        const startEntry = JSON.stringify({
            session: sessionId,
            type: 'session_start',
            agent: session.agent,
            model: session.model,
            ts: session.started_at,
        });
        appendFileSync(ledgerFilePath(), `${startEntry}\n`);
    } catch {
        // fail-open
    }
}

function cleanupSession(): void {
    try {
        if (!existsSync(sessionFilePath())) return;
        const session = JSON.parse(readFileSync(sessionFilePath(), 'utf-8')) as { session_id?: string };
        const sessionId = session.session_id;

        // Compute rollup totals from ledger
        let reads = 0;
        let writes = 0;
        let tokens = 0;
        if (sessionId && existsSync(ledgerFilePath())) {
            for (const line of readFileSync(ledgerFilePath(), 'utf-8').split('\n')) {
                if (!line.trim()) continue;
                try {
                    const evt = JSON.parse(line) as { session?: string; type?: string; tokens?: number };
                    if (evt.session !== sessionId) continue;
                    if (evt.type === 'read') reads++;
                    else if (evt.type === 'write') writes++;
                    if (evt.tokens) tokens += evt.tokens;
                } catch {
                    // skip unparseable lines
                }
            }
        }

        // Append session_end event
        const endEntry = JSON.stringify({
            session: sessionId,
            type: 'session_end',
            reads,
            writes,
            tokens,
            ts: new Date().toISOString(),
        });
        appendFileSync(ledgerFilePath(), `${endEntry}\n`);

        // Cleanup session file
        rmSync(sessionFilePath(), { force: true });
    } catch {
        // fail-open
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

    // ── context-post-tool: append to token-ledger.jsonl ───────────────
    pi.on('tool_result', async (event) => {
        const input = event.input as Record<string, unknown> | undefined;
        const command = typeof input?.command === 'string' ? input.command : undefined;
        appendToLedger(
            {
                session_id: readSessionId(),
                tool_name: event.toolName,
                tool_input: input as Record<string, unknown>,
            },
            command,
        );
    });

    // ── context-session-start: init session tracking ─────────────────
    pi.on('session_start', async () => {
        initSession();
    });

    // ── context-session-stop: rollup + cleanup ───────────────────────
    pi.on('session_shutdown', async () => {
        cleanupSession();
    });
}
