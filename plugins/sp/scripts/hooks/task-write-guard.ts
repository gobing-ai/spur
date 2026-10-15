#!/usr/bin/env bun
/**
 * task-write-guard — PreToolUse guard for the Spur task corpus.
 *
 * Deny a raw `Write` or `Edit` whose target path is owned by a Spur task. Mutate task files through
 * the `spur task` CLI (e.g. `spur task update <wbs> --section <name> --from-file <file>`), never by
 * hand. Pure delegation: ownership is decided by `spur task resolve --strict --json`'s exit code
 * alone (exit 0 → owned, non-zero → unowned).
 *
 * **Output contract** (superskill ADR-039 `hook run`): allow prints **nothing** (exit 0) — a printed
 * Claude `permissionDecision:"allow"` would auto-approve the call and bypass the user's permission
 * rules. Deny prints Claude-native PreToolUse JSON carrying the reason twice: `permissionDecisionReason`
 * (what Claude Code feeds back to the model, and what `hook run` turns into exit 2 + stderr on
 * Codex/omp/generic hosts) and `systemMessage` (Claude Code's user-facing warning — the one field the
 * host-neutral `{decision,reason}` form cannot carry, which is why this guard stays Claude-native).
 *
 * **Fail-open contract** (inherited from the pre-N3 shim and from superskill's runner): every error
 * path — unparseable payload, non-Write/Edit tool, empty path, missing `spur` binary, spawn
 * failure, timeout, `spur task resolve` non-zero exit, non-JSON stdout — allows (prints nothing).
 * A broken guard must never wedge an agent tool call.
 *
 * **Escape hatch:** `SPUR_WRITE_GUARD=off` short-circuits to allow.
 *
 * Self-contained by design (Wave E, task 0181, R3): `node:*` builtins and relative imports only.
 * Installed hook configs invoke `superskill hook run sp task-write-guard`, which resolves this file
 * as `scripts/hooks/task-write-guard.ts` under the native plugin root or the staged scripts root.
 */

import { spawnSync } from 'node:child_process';
import { getEnvVar } from '../../lib/env';
import { couldBeTaskFile } from '../../lib/task-file-policy';

interface ToolPayload {
    tool_name?: string;
    tool_input?: { file_path?: string };
}

type TaskOwnership = 'owned' | 'unowned' | 'unknown';

/** Allow: print nothing and exit 0 (no objection; the host's own permission rules still apply). */
function allow(): never {
    process.exit(0);
}

/** Deny with a reason the model (`permissionDecisionReason`) and the user (`systemMessage`) both see. */
function deny(reason: string): never {
    process.stdout.write(
        JSON.stringify({
            hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: reason,
            },
            systemMessage: reason,
        }),
    );
    process.exit(0);
}

/** Resolve whether a path is owned by a Spur task via `spur task resolve --strict --json`. */
function resolveSpurTaskOwnership(filePath: string, cwd: string): TaskOwnership {
    const spurBin = getEnvVar('SPUR_BIN') || 'spur';
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
    if (getEnvVar('SPUR_WRITE_GUARD') === 'off') allow();

    const stdinText = await Bun.stdin.text();
    let payload: ToolPayload;
    try {
        payload = JSON.parse(stdinText) as ToolPayload;
    } catch {
        allow(); // unparseable payload — fail open
    }

    const toolName = payload.tool_name ?? '';
    if (toolName !== 'Write' && toolName !== 'Edit') allow();

    const filePath = payload.tool_input?.file_path ?? '';
    if (filePath === '') allow();
    // Skip the `spur task resolve` subprocess (~120ms) for paths whose basename
    // cannot name a task file — that is every ordinary source edit.
    if (!couldBeTaskFile(filePath)) allow();

    const ownership = resolveSpurTaskOwnership(filePath, getEnvVar('CLAUDE_PROJECT_DIR') ?? process.cwd());
    if (ownership === 'owned') {
        deny(
            `${filePath} is a task file owned by the spur corpus. Edit it through the spur CLI ` +
                '(e.g. `spur task update <wbs> --section <name> --from-file <file>`), not a raw ' +
                'Write/Edit. Set SPUR_WRITE_GUARD=off to bypass.',
        );
    }
    allow();
}

void main();
