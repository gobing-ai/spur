#!/usr/bin/env bun
/**
 * task-write-guard — PreToolUse hook (Write|Edit).
 *
 * Contract (design §12.3, F04): a raw `Write`/`Edit` whose target path is **owned by a task**
 * (i.e. it is a task file in the corpus) is denied — task files are mutated through the
 * `spur task` CLI, never by hand (the global "task files via CLI only" rule). The hook is **pure
 * delegation**: it asks `spur task resolve <path>` whether the path is owned and decides on the
 * exit code alone. It contains zero validation logic of its own (R3).
 *
 * Ownership-guard only (0067 decision): the hook does NOT gate on `spur task check` pass/fail.
 * `check` enforces the DD-07 schema, which the live rd3-authored corpus does not yet satisfy, so
 * check-gating is deferred until the corpus is migrated (recorded in the task's Review). When that
 * lands, add a `spur task check` delegation here behind the same resolve result.
 *
 * Escape hatch: `SPUR_WRITE_GUARD=off` allows everything (still pure delegation — the toggle short-
 * circuits before any subprocess).
 *
 * stdin payload: {"tool_name":"Edit","tool_input":{"file_path":"…"}}
 * stdout: PreToolUse JSON ({ hookSpecificOutput: { permissionDecision } }). Always exits 0; the
 *   decision rides in the JSON so a guard failure never crashes the agent's tool call.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

interface ToolPayload {
    tool_name?: string;
    tool_input?: { file_path?: string };
}

type PermissionDecision = 'allow' | 'deny';

/** Emit a PreToolUse decision and exit 0 (the decision is carried by the JSON, not the code). */
function decide(decision: PermissionDecision, reason?: string): never {
    const out: Record<string, unknown> = {
        hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision },
    };
    if (reason !== undefined) out.systemMessage = reason;
    process.stdout.write(JSON.stringify(out));
    process.exit(0);
}

/**
 * Locate the workspace spur CLI entry. A PreToolUse hook must call the in-repo CLI, not a globally
 * installed `spur` (which may be a stale published build). Walk up from the project dir to the
 * nearest `apps/cli/src/index.ts`.
 */
function findCli(startDir: string): string | null {
    let dir = resolve(startDir);
    for (let i = 0; i < 8; i++) {
        const candidate = join(dir, 'apps', 'cli', 'src', 'index.ts');
        if (existsSync(candidate)) return candidate;
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    return null;
}

async function main(): Promise<void> {
    // Escape hatch — short-circuit before any work.
    if (process.env.SPUR_WRITE_GUARD === 'off') return decide('allow');

    let payload: ToolPayload = {};
    try {
        payload = JSON.parse(await Bun.stdin.text()) as ToolPayload;
    } catch {
        // Unparseable input — fail open (never block on a malformed payload).
        return decide('allow');
    }

    const toolName = payload.tool_name ?? '';
    if (toolName !== 'Write' && toolName !== 'Edit') return decide('allow');

    const filePath = payload.tool_input?.file_path ?? '';
    if (filePath === '') return decide('allow');

    const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
    const cli = findCli(projectDir);
    if (cli === null) return decide('allow'); // not inside the spur workspace — nothing to guard.

    // Delegate ownership entirely to the CLI: exit 0 = owned by a task, non-zero = not owned.
    const res = spawnSync('bun', ['run', cli, 'task', 'resolve', filePath, '--json'], {
        cwd: projectDir,
        encoding: 'utf-8',
        timeout: 8000,
    });

    if (res.status === 0) {
        return decide(
            'deny',
            `${filePath} is a task file owned by the spur corpus. Edit it through the spur CLI ` +
                '(e.g. `spur task update <wbs> --section <name> --from-file <file>`), not a raw ' +
                'Write/Edit. Set SPUR_WRITE_GUARD=off to bypass.',
        );
    }

    return decide('allow');
}

void main();
