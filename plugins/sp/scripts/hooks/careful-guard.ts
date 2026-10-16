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
 * Git global options between the executable and the subcommand (`-C <path>`, `-c <name>=<value>`,
 * `--git-dir[=<path>]`, `--work-tree[=<path>]`) are recognized, so `git -C . push --force` is
 * classified exactly like `git push --force`; the lexical pass only removes that option span and
 * never executes git or expands a substitution.
 *
 * **Safe exceptions:** `rm -rf` of well-known build/dependency caches (`node_modules`, `dist`,
 * `.next`, `coverage`, `build`, `.turbo`, `.cache`) passes without a warning — deleting a rebuildable
 * cache is routine, not dangerous.
 *
 * **Output contract** (superskill ADR-039 `hook run`): allow prints **nothing** (exit 0). Ask prints
 * Claude-native PreToolUse JSON with the reason in `permissionDecisionReason` (the confirm prompt) and
 * `systemMessage` (Claude Code's user-facing warning, which the host-neutral `{decision,reason}` form
 * cannot carry). Hosts that cannot confirm (Codex, omp, generic) receive a deny with the reason:
 * superskill fails an unconfirmable ask closed. Pi confirms through its native host adapter.
 *
 * **Fail-open contract:** every error path — unparseable payload, non-Bash tool, empty command —
 * allows (prints nothing). A broken guard must never wedge an agent tool call.
 *
 * **Escape hatch:** `SPUR_CAREFUL=off` short-circuits to allow.
 *
 * Classification itself lives in `lib/destructive-policy.ts` — one policy, every platform
 * adapter runs this hook through superskill). This file owns the hook payload/decision shape only.
 * Registered in `hooks/hooks.json` as `PreToolUse` / matcher `Bash` (task 0215 R3).
 */

import { classifyCommand } from '../../lib/destructive-policy';
import { getEnvVar } from '../../lib/env';

interface ToolPayload {
    tool_name?: string;
    tool_input?: { command?: string };
}

/** Allow: print nothing and exit 0 (no objection; the host's own permission rules still apply). */
function allow(): never {
    process.exit(0);
}

/** Ask the operator to confirm, with the reason on the prompt and as a user-facing warning. */
function ask(reason: string): never {
    process.stdout.write(
        JSON.stringify({
            hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'ask',
                permissionDecisionReason: reason,
            },
            systemMessage: reason,
        }),
    );
    process.exit(0);
}

async function main(): Promise<void> {
    if (getEnvVar('SPUR_CAREFUL') === 'off') allow();

    const stdinText = await Bun.stdin.text();
    let payload: ToolPayload;
    try {
        payload = JSON.parse(stdinText) as ToolPayload;
    } catch {
        allow(); // unparseable payload — fail open
    }

    if (payload.tool_name !== 'Bash') allow();

    const command = payload.tool_input?.command ?? '';
    if (command.trim() === '') allow();

    const hit = classifyCommand(command);
    if (hit !== null) {
        ask(
            `This command looks like ${hit} — a destructive operation. Confirm you intend to run it. ` +
                'Set SPUR_CAREFUL=off to disable this guard.',
        );
    }
    allow();
}

if (import.meta.main) void main();
