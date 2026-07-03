/**
 * task-write-guard — decision matrix tests (task 0181, R3).
 *
 * The guard logic is now **inlined** in `task-write-guard.ts` (previously a compat shim that
 * forwarded to `superskill hook run sp task-write-guard`). Installed hook configs still use the
 * portable superskill runtime command, while this repo's gate exercises the versioned script
 * directly so local changes to the decision matrix cannot drift untested.
 *
 * Tested here:
 *  1. **Fail-open contract** — every error path (unparseable payload, non-Write/Edit tool, empty
 *     path, missing spur binary, `SPUR_WRITE_GUARD=off` short-circuit) emits an `allow` decision.
 *  2. **Decision logic** — denies a raw Write/Edit to a corpus task file; allows non-task source
 *     files. The `spur task resolve --strict` exit code is the sole ownership signal.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const HOOK = join(import.meta.dir, 'task-write-guard.ts');

const OWNED_TASK = join(REPO_ROOT, 'docs', 'tasks2', '0181_0176-wave-e-comprehensive-sweep-cleanup.md');
const UNOWNED_SRC = join(REPO_ROOT, 'packages', 'app', 'src', 'services', 'task-service.ts');
// Default SPUR_BIN: the in-repo source CLI. The guard spawns this to resolve task ownership via
// `spur task resolve --strict --json`. Tests that explicitly want to test fail-open paths (missing
// spur binary) override SPUR_BIN or PATH in the per-test env.
const LOCAL_SPUR = `bun run ${join(REPO_ROOT, 'apps', 'cli', 'src', 'index.ts')}`;

interface Decision {
    permissionDecision: 'allow' | 'deny';
    systemMessage?: string;
}

function parseDecision(out: string): Decision {
    const parsed = JSON.parse(out) as {
        hookSpecificOutput: { permissionDecision: 'allow' | 'deny' };
        systemMessage?: string;
    };
    return { permissionDecision: parsed.hookSpecificOutput.permissionDecision, systemMessage: parsed.systemMessage };
}

/** Run the inlined guard with a synthetic stdin payload and the provided env. */
async function runGuard(payload: unknown, env: Record<string, string> = {}, stdinText?: string): Promise<Decision> {
    const proc = Bun.spawn([process.execPath, HOOK], {
        cwd: REPO_ROOT,
        stdin: new TextEncoder().encode(stdinText ?? JSON.stringify(payload)),
        stdout: 'pipe',
        stderr: 'pipe',
        env: {
            CLAUDE_PROJECT_DIR: REPO_ROOT,
            SPUR_BIN: LOCAL_SPUR,
            PATH: `${join(process.execPath, '..')}:${process.env.PATH ?? ''}`,
            ...env,
        },
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return parseDecision(out);
}

const HAS_OWNED_TASK = existsSync(OWNED_TASK);

describe('task-write-guard — fail-open contract', () => {
    test('fails open (allow) for a non-Write/Edit tool', async () => {
        const d = await runGuard({ tool_name: 'Read', tool_input: { file_path: '/tmp/x.md' } });
        expect(d.permissionDecision).toBe('allow');
    });

    test('fails open (allow) on a malformed payload', async () => {
        const d = await runGuard({}, {}, 'not json');
        // Even a malformed payload must not crash the guard.
        expect(d.permissionDecision).toBe('allow');
    });

    test('fails open (allow) when the path is empty', async () => {
        const d = await runGuard({ tool_name: 'Edit', tool_input: { file_path: '' } });
        expect(d.permissionDecision).toBe('allow');
    });

    test('fails open (allow) when no file_path is present (nothing to guard)', async () => {
        const d = await runGuard({ tool_name: 'Edit', tool_input: {} });
        expect(d.permissionDecision).toBe('allow');
    });

    test('SPUR_WRITE_GUARD=off is the escape hatch — even a task-file edit is allowed', async () => {
        const d = await runGuard(
            { tool_name: 'Edit', tool_input: { file_path: OWNED_TASK } },
            { SPUR_WRITE_GUARD: 'off' },
        );
        expect(d.permissionDecision).toBe('allow');
    });

    test('fails open (allow) when spur is not on PATH — a broken runtime never wedges a tool call', async () => {
        const bunDir = join(process.execPath, '..'); // dir holding the `bun` binary
        const proc = Bun.spawn([process.execPath, HOOK], {
            cwd: REPO_ROOT,
            stdin: new TextEncoder().encode(
                JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: OWNED_TASK } }),
            ),
            stdout: 'pipe',
            stderr: 'pipe',
            // PATH = only the bun dir → `bun` works, but `spur` is not found → fail open.
            env: { CLAUDE_PROJECT_DIR: REPO_ROOT, PATH: bunDir, HOME: process.env.HOME ?? '' },
        });
        const out = await new Response(proc.stdout).text();
        await proc.exited;
        // Even for an owned task file, an absent spur binary yields allow.
        expect(JSON.parse(out).hookSpecificOutput.permissionDecision).toBe('allow');
    });
});

describe.if(HAS_OWNED_TASK)('task-write-guard — decision logic', () => {
    test('denies a raw Edit to a task file so the corpus is only mutated through the CLI', async () => {
        const d = await runGuard({ tool_name: 'Edit', tool_input: { file_path: OWNED_TASK } });
        expect(d.permissionDecision).toBe('deny');
        expect(d.systemMessage).toContain('spur task update');
    });

    test('denies a raw Write to a task file (Write is as dangerous as Edit for the corpus)', async () => {
        const d = await runGuard({ tool_name: 'Write', tool_input: { file_path: OWNED_TASK } });
        expect(d.permissionDecision).toBe('deny');
    });

    test('allows edits to non-task source files so the guard never blocks normal work', async () => {
        const d = await runGuard({ tool_name: 'Write', tool_input: { file_path: UNOWNED_SRC } });
        expect(d.permissionDecision).toBe('allow');
    });

    // Regression: a /tmp scratch file that merely SHARES a `NNNN_` prefix with a real corpus task is
    // NOT the corpus file — `--strict` resolution must allow it.
    test('allows a /tmp scratch file that only shares a WBS prefix with a real task', async () => {
        const d = await runGuard({ tool_name: 'Write', tool_input: { file_path: '/tmp/0181_design.md' } });
        expect(d.permissionDecision).toBe('allow');
    });
});
