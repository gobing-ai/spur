#!/usr/bin/env bun
/**
 * task-write-guard — PreToolUse guard for the Spur task corpus.
 *
 * Deny a raw `Write` or `Edit` whose target path is owned by a Spur task. Mutate task files through
 * the `spur task` CLI (e.g. `spur task update <wbs> --section <name> --from-file <file>`), never by
 * hand. Pure delegation: ownership is decided by `spur task resolve --strict --json`'s exit code
 * alone (exit 0 → owned, non-zero → unowned).
 *
 * **Fail-open contract** (inherited from the pre-N3 shim and from superskill's runner): every error
 * path — unparseable payload, non-Write/Edit tool, empty path, missing `spur` binary, spawn
 * failure, timeout, `spur task resolve` non-zero exit, non-JSON stdout — emits an `allow`
 * decision. A broken guard must never wedge an agent tool call.
 *
 * **Escape hatch:** `SPUR_WRITE_GUARD=off` short-circuits to allow.
 *
 * Self-contained by design (Wave E, task 0181, R3). Installed hook configs still use the portable
 * `superskill hook run sp task-write-guard` entrypoint from task 0151, while this source script keeps
 * the real guard decisions versioned and covered by this repo's test gate.
 */

import { spawnSync } from 'node:child_process';
import { couldBeTaskFile } from './task-file-policy';

interface ToolPayload {
    tool_name?: string;
    tool_input?: { file_path?: string };
}

type TaskOwnership = 'owned' | 'unowned' | 'unknown';

function preToolUseDecision(decision: 'allow' | 'deny', reason?: string): never {
    const out: Record<string, unknown> = {
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision },
    };
    if (reason !== undefined) out.systemMessage = reason;
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
}

/** Resolve whether a path is owned by a Spur task via `spur task resolve --strict --json`. */
function resolveSpurTaskOwnership(filePath: string, cwd: string): TaskOwnership {
    const spurBin = process.env.SPUR_BIN || 'spur';
    const parts = spurBin.split(' ');
    const cmd = parts[0] ?? 'spur';
    const args = [...parts.slice(1), 'task', 'resolve', filePath, '--strict', '--json'];
    const res = spawnSync(cmd, args, {
        cwd,
        encoding: 'utf-8',
        timeout: 8000,
    });
    if (res.error || typeof res.status !== 'number') return 'unknown';
    return res.status === 0 ? 'owned' : 'unowned';
}

async function main(): Promise<void> {
    if (process.env.SPUR_WRITE_GUARD === 'off') preToolUseDecision('allow');

    const stdinText = await Bun.stdin.text();
    let payload: ToolPayload;
    try {
        payload = JSON.parse(stdinText) as ToolPayload;
    } catch {
        preToolUseDecision('allow'); // unparseable payload — fail open
    }

    const toolName = payload.tool_name ?? '';
    if (toolName !== 'Write' && toolName !== 'Edit') preToolUseDecision('allow');

    const filePath = payload.tool_input?.file_path ?? '';
    if (filePath === '') preToolUseDecision('allow');
    // Skip the `spur task resolve` subprocess (~120ms) for paths whose basename
    // cannot name a task file — that is every ordinary source edit.
    if (!couldBeTaskFile(filePath)) preToolUseDecision('allow');

    const ownership = resolveSpurTaskOwnership(filePath, process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
    if (ownership === 'owned') {
        preToolUseDecision(
            'deny',
            `${filePath} is a task file owned by the spur corpus. Edit it through the spur CLI ` +
                '(e.g. `spur task update <wbs> --section <name> --from-file <file>`), not a raw ' +
                'Write/Edit. Set SPUR_WRITE_GUARD=off to bypass.',
        );
    }
    preToolUseDecision('allow');
}

void main();
