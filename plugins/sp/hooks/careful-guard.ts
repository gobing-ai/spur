#!/usr/bin/env bun
/**
 * careful-guard — PreToolUse guard for destructive shell commands (task 0215, R3).
 *
 * Warn (permission `ask`) before a `Bash` tool call runs a destructive command — `rm -rf`
 * (any flag spelling, including the POSIX uppercase `-R`), `DROP TABLE`/`DROP DATABASE`/
 * `TRUNCATE`, `git push --force`/`-f`/`+refspec`, `git reset --hard`, `git checkout .`/
 * `git restore .`, `kubectl delete`, `docker system prune`. The operator can confirm to
 * proceed. Pure pattern-match + decision, no domain logic (mirrors `task-write-guard`).
 *
 * **Safe exceptions:** `rm -rf` of well-known build/dependency caches (`node_modules`, `dist`,
 * `.next`, `coverage`, `build`, `.turbo`, `.cache`) passes without a warning — deleting a rebuildable
 * cache is routine, not dangerous.
 *
 * **Fail-open contract:** every error path — unparseable payload, non-Bash tool, empty command —
 * emits an `allow` decision. A broken guard must never wedge an agent tool call.
 *
 * **Escape hatch:** `SPUR_CAREFUL=off` short-circuits to allow.
 *
 * Classification itself lives in `destructive-policy.ts` — one policy, every platform
 * adapter. This file owns the Claude Code payload/decision shape only.
 */

import { classifyCommand } from './destructive-policy';

interface ToolPayload {
    tool_name?: string;
    tool_input?: { command?: string };
}

type Decision = 'allow' | 'ask';

function preToolUseDecision(decision: Decision, reason?: string): never {
    const hookSpecificOutput: Record<string, unknown> = {
        hookEventName: 'PreToolUse',
        permissionDecision: decision,
    };
    if (reason !== undefined) hookSpecificOutput.permissionDecisionReason = reason;
    const out: Record<string, unknown> = { hookSpecificOutput };
    if (reason !== undefined) out.systemMessage = reason;
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
}

async function main(): Promise<void> {
    if (process.env.SPUR_CAREFUL === 'off') preToolUseDecision('allow');

    const stdinText = await Bun.stdin.text();
    let payload: ToolPayload;
    try {
        payload = JSON.parse(stdinText) as ToolPayload;
    } catch {
        preToolUseDecision('allow'); // unparseable payload — fail open
    }

    if (payload.tool_name !== 'Bash') preToolUseDecision('allow');

    const command = payload.tool_input?.command ?? '';
    if (command.trim() === '') preToolUseDecision('allow');

    const hit = classifyCommand(command);
    if (hit !== null) {
        preToolUseDecision(
            'ask',
            `This command looks like ${hit} — a destructive operation. Confirm you intend to run it. ` +
                'Set SPUR_CAREFUL=off to disable this guard.',
        );
    }
    preToolUseDecision('allow');
}

if (import.meta.main) void main();
