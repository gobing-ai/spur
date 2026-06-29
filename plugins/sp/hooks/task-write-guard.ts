#!/usr/bin/env bun
/**
 * task-write-guard — compatibility shim.
 *
 * The guard logic now lives in superskill's hook runtime registry; installed hook configs call the
 * stable PATH command `superskill hook run sp task-write-guard` (see `plugins/sp/hooks/hooks.json`
 * and task 0151). This file is kept only as a thin adapter for any environment that still invokes
 * the old script path directly: it forwards stdin to the installed command and mirrors its exit code.
 *
 * It performs NO source-tree CLI lookup — that coupling (the old `findCli()` walking to
 * `apps/cli/src/index.ts`) is what made the hook non-portable. If `superskill` is not on PATH the
 * shim fails open (emits an allow decision), matching the guard's overall fail-open contract.
 */

import { spawnSync } from 'node:child_process';

function allow(): never {
    process.stdout.write(
        JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow' } }),
    );
    process.exit(0);
}

async function main(): Promise<void> {
    const stdinText = await Bun.stdin.text();
    const res = spawnSync('superskill', ['hook', 'run', 'sp', 'task-write-guard'], {
        input: stdinText,
        encoding: 'utf-8',
        timeout: 9000,
    });
    // The decision rides in stdout JSON. Forward it ONLY when the child produced a parseable
    // PreToolUse decision. Any other outcome — superskill missing, an older build without the
    // `hook run` subcommand (errors with empty stdout), a crash, a timeout, or non-JSON output —
    // fails open. A broken/absent runtime must never wedge the agent's tool call.
    if (res.error || !res.stdout) return allow();
    try {
        const parsed = JSON.parse(res.stdout) as { hookSpecificOutput?: { permissionDecision?: unknown } };
        if (parsed.hookSpecificOutput?.permissionDecision === undefined) return allow();
    } catch {
        return allow();
    }
    process.stdout.write(res.stdout);
    process.exit(res.status ?? 0);
}

void main();
