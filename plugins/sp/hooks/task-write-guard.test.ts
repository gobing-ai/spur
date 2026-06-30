/**
 * task-write-guard — portability tests (task 0151).
 *
 * The guard logic now lives in superskill's hook runtime registry; installed hook configs call the
 * PATH command `superskill hook run sp task-write-guard`. This repo owns two things, tested here:
 *
 *  1. The compat **shim** (`task-write-guard.ts`) — forwards stdin to `superskill hook run` and
 *     mirrors its decision, but MUST fail open when that runtime is absent or produces no parseable
 *     decision (an older `superskill` without the `run` subcommand, a crash, a timeout). A broken
 *     runtime must never wedge the agent's tool call.
 *  2. The guard **decision logic** via the superskill source CLI — deny an owned corpus task file,
 *     allow everything else. (The unit-level decision matrix is also covered by superskill's
 *     `apps/cli/tests/commands/hook-run.test.ts`; this asserts the end-to-end path against a real
 *     corpus.)
 *
 * Source-checkout guard: the superskill source CLI is resolved relative to this repo's sibling
 * checkout. When it is not present (e.g. CI without the sibling repo), the runtime-backed cases are
 * skipped with a clear reason rather than silently passing.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dir, '..', '..', '..');
const HOOK = join(import.meta.dir, 'task-write-guard.ts');
const SUPERSKILL_CLI = join(REPO_ROOT, '..', 'superskill', 'apps', 'cli', 'src', 'index.ts');
const HAS_SOURCE_CLI = existsSync(SUPERSKILL_CLI);

const OWNED_TASK = join(REPO_ROOT, 'docs', 'tasks', '0067_W3_task-write-guard_hook_and_resolve_info_decision.md');
const UNOWNED_SRC = join(REPO_ROOT, 'packages', 'app', 'src', 'services', 'task-service.ts');

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

/** Drive the guard through the superskill SOURCE CLI (the real runtime, independent of the global install). */
async function runViaRuntime(payload: unknown, env: Record<string, string> = {}): Promise<Decision> {
    const localSpur = `bun run ${join(REPO_ROOT, 'apps', 'cli', 'src', 'index.ts')}`;
    const proc = Bun.spawn(['bun', 'run', SUPERSKILL_CLI, 'hook', 'run', 'sp', 'task-write-guard'], {
        cwd: REPO_ROOT,
        stdin: new TextEncoder().encode(JSON.stringify(payload)),
        stdout: 'pipe',
        stderr: 'pipe',
        env: { ...process.env, CLAUDE_PROJECT_DIR: REPO_ROOT, SPUR_BIN: localSpur, ...env },
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return parseDecision(out);
}

/**
 * Drive the shim directly with an unresolvable runtime to assert fail-open. We point the shim's
 * `superskill` lookup at an empty dir via PATH (so the binary is not found) while keeping a real
 * interpreter on PATH so the shim itself can run. This reproduces "superskill absent" — the shim
 * must still emit an allow decision rather than empty/erroring output.
 */
async function runShimWithNoRuntime(payload: unknown): Promise<Decision> {
    const bunDir = join(process.execPath, '..'); // dir holding the `bun` binary
    const proc = Bun.spawn(['bun', 'run', HOOK], {
        cwd: REPO_ROOT,
        stdin: new TextEncoder().encode(JSON.stringify(payload)),
        stdout: 'pipe',
        stderr: 'pipe',
        // PATH = only the bun dir → `bun`/`spawnSync` work, but `superskill` is not found → fail open.
        env: { CLAUDE_PROJECT_DIR: REPO_ROOT, PATH: bunDir, HOME: process.env.HOME ?? '' },
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    return parseDecision(out);
}

describe('task-write-guard shim — fail-open contract', () => {
    test('fails open (allow) when the superskill runtime is unavailable — a broken runtime never wedges a tool call', async () => {
        const d = await runShimWithNoRuntime({ tool_name: 'Edit', tool_input: { file_path: OWNED_TASK } });
        // Even for an owned task file, an absent runtime yields allow — the deny only comes from a
        // working `superskill hook run` that confirms ownership.
        expect(d.permissionDecision).toBe('allow');
    });

    test('has no source-tree CLI coupling — no findCli(), no `bun run .../index.ts`, no CLAUDE_PLUGIN_ROOT in code (portability regression)', async () => {
        const src = await Bun.file(HOOK).text();
        // Strip block + line comments so prose that *names* the old coupling (to explain its removal)
        // doesn't trip the regression — we assert the absence of live code, not of documentation.
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        expect(code).not.toContain('apps/cli/src/index.ts'); // no in-repo CLI spawn
        expect(code).not.toContain('CLAUDE_PLUGIN_ROOT'); // no Claude-only variable
        expect(code).not.toMatch(/findCli/); // the source-tree walk is gone
        // The shim's only runtime target is the PATH command.
        expect(code).toContain('superskill');
    });
});

describe.if(HAS_SOURCE_CLI)('task-write-guard runtime — decision logic (via superskill source CLI)', () => {
    test('denies a raw Edit to a task file so the corpus is only mutated through the CLI', async () => {
        const d = await runViaRuntime({ tool_name: 'Edit', tool_input: { file_path: OWNED_TASK } });
        expect(d.permissionDecision).toBe('deny');
        expect(d.systemMessage).toContain('spur task update');
    });

    test('denies a raw Write to a task file (Write is as dangerous as Edit for the corpus)', async () => {
        const d = await runViaRuntime({ tool_name: 'Write', tool_input: { file_path: OWNED_TASK } });
        expect(d.permissionDecision).toBe('deny');
    });

    test('allows edits to non-task source files so the guard never blocks normal work', async () => {
        const d = await runViaRuntime({ tool_name: 'Write', tool_input: { file_path: UNOWNED_SRC } });
        expect(d.permissionDecision).toBe('allow');
    });

    test('SPUR_WRITE_GUARD=off is the escape hatch — even a task-file edit is allowed', async () => {
        const d = await runViaRuntime(
            { tool_name: 'Edit', tool_input: { file_path: OWNED_TASK } },
            { SPUR_WRITE_GUARD: 'off' },
        );
        expect(d.permissionDecision).toBe('allow');
    });

    test('ignores non-mutating tools (Read on a task file is fine)', async () => {
        const d = await runViaRuntime({ tool_name: 'Read', tool_input: { file_path: OWNED_TASK } });
        expect(d.permissionDecision).toBe('allow');
    });

    test('allows when no file_path is present (nothing to guard)', async () => {
        const d = await runViaRuntime({ tool_name: 'Edit', tool_input: {} });
        expect(d.permissionDecision).toBe('allow');
    });

    // Regression: a /tmp scratch file that merely SHARES a `NNNN_` prefix with a real corpus task is
    // NOT the corpus file — `--strict` resolution must allow it.
    test('allows a /tmp scratch file that only shares a WBS prefix with a real task', async () => {
        const d = await runViaRuntime({ tool_name: 'Write', tool_input: { file_path: '/tmp/0067_design.md' } });
        expect(d.permissionDecision).toBe('allow');
    });
});
