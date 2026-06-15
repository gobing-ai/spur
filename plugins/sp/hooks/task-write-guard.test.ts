/**
 * task-write-guard hook — PreToolUse integration tests.
 *
 * The hook is pure delegation (it shells out to `spur task resolve`), so it is verified the way it
 * actually runs: feed a PreToolUse JSON payload on stdin, assert the emitted decision. Each case
 * encodes WHY the decision matters (corpus protection vs. not blocking unrelated edits), not just
 * the mechanics.
 */

import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const HOOK = join(import.meta.dir, 'task-write-guard.ts');
// A real task file in the corpus — `spur task resolve` reports it as owned.
const OWNED_TASK = join(REPO_ROOT, 'docs', 'tasks', '0067_W3_task-write-guard_hook_and_resolve_info_decision.md');
// A source file that no task owns.
const UNOWNED_SRC = join(REPO_ROOT, 'packages', 'app', 'src', 'services', 'task-service.ts');

interface Decision {
    permissionDecision: 'allow' | 'deny';
    systemMessage?: string;
}

async function runHook(payload: unknown, env: Record<string, string> = {}): Promise<Decision> {
    const proc = Bun.spawn(['bun', 'run', HOOK], {
        cwd: REPO_ROOT,
        stdin: new TextEncoder().encode(JSON.stringify(payload)),
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, CLAUDE_PROJECT_DIR: REPO_ROOT, ...env },
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    const parsed = JSON.parse(out) as {
        hookSpecificOutput: { permissionDecision: 'allow' | 'deny' };
        systemMessage?: string;
    };
    return { permissionDecision: parsed.hookSpecificOutput.permissionDecision, systemMessage: parsed.systemMessage };
}

describe('task-write-guard', () => {
    test('denies a raw Edit to a task file so the corpus is only mutated through the CLI', async () => {
        const d = await runHook({ tool_name: 'Edit', tool_input: { file_path: OWNED_TASK } });
        expect(d.permissionDecision).toBe('deny');
        // The denial must steer the agent to the CLI, not just refuse.
        expect(d.systemMessage).toContain('spur task update');
    });

    test('denies a raw Write to a task file (Write is as dangerous as Edit for the corpus)', async () => {
        const d = await runHook({ tool_name: 'Write', tool_input: { file_path: OWNED_TASK } });
        expect(d.permissionDecision).toBe('deny');
    });

    test('allows edits to non-task source files so the guard never blocks normal work', async () => {
        const d = await runHook({ tool_name: 'Write', tool_input: { file_path: UNOWNED_SRC } });
        expect(d.permissionDecision).toBe('allow');
    });

    test('SPUR_WRITE_GUARD=off is the escape hatch — even a task-file edit is allowed', async () => {
        const d = await runHook(
            { tool_name: 'Edit', tool_input: { file_path: OWNED_TASK } },
            { SPUR_WRITE_GUARD: 'off' },
        );
        expect(d.permissionDecision).toBe('allow');
    });

    test('ignores non-mutating tools (Read on a task file is fine)', async () => {
        const d = await runHook({ tool_name: 'Read', tool_input: { file_path: OWNED_TASK } });
        expect(d.permissionDecision).toBe('allow');
    });

    test('fails open on a malformed payload — a broken hook must never wedge the agent', async () => {
        const proc = Bun.spawn(['bun', 'run', HOOK], {
            cwd: REPO_ROOT,
            stdin: new TextEncoder().encode('not json at all'),
            stdout: 'pipe',
            env: { ...process.env, CLAUDE_PROJECT_DIR: REPO_ROOT },
        });
        const out = await new Response(proc.stdout).text();
        await proc.exited;
        expect(JSON.parse(out).hookSpecificOutput.permissionDecision).toBe('allow');
    });

    test('allows when no file_path is present (nothing to guard)', async () => {
        const d = await runHook({ tool_name: 'Edit', tool_input: {} });
        expect(d.permissionDecision).toBe('allow');
    });
});
