/**
 * indexed-context hooks — fail-open + side-effect tests (task 0232).
 *
 * Unlike `task-write-guard`, these hooks emit no JSON decision on stdout — they are silent
 * and always exit 0. Tests verify the exit code and the filesystem side effects on
 * `.session.json` and `token-ledger.jsonl` inside a per-test temp project dir.
 *
 * Tested:
 *  1. **context-session-start** — writes `.session.json`, appends `session_start` event.
 *  2. **context-post-tool** — appends `read`/`write` events with token estimates; ignores wrong tools.
 *  3. **context-session-stop** — scans ledger, writes `session_end` with totals, removes `.session.json`.
 *  4. **Fail-open** — every hook exits 0 on errors (malformed payload, missing `.session.json`, etc.).
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOOKS_DIR = import.meta.dir;
const START_HOOK = join(HOOKS_DIR, 'context-session-start.ts');
const POST_TOOL_HOOK = join(HOOKS_DIR, 'context-post-tool.ts');
const STOP_HOOK = join(HOOKS_DIR, 'context-session-stop.ts');

/** Create a temp project root with `.spur/context/` ready for hook side effects. Returns the project dir. */
function makeTempProject(): string {
    const projectDir = mkdtempSync(join(tmpdir(), 'spur-ctx-test-'));
    mkdirSync(join(projectDir, '.spur', 'context'), { recursive: true });
    return projectDir;
}

/** Run a hook binary with a stdin payload (JSON or raw text) and return {exitCode, stdout}. */
async function runHook(
    hookPath: string,
    projectDir: string,
    payload: unknown,
    stdinText?: string,
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    const proc = Bun.spawn([process.execPath, hookPath], {
        cwd: projectDir,
        stdin: new TextEncoder().encode(stdinText ?? JSON.stringify(payload)),
        stdout: 'pipe',
        stderr: 'pipe',
        env: { CLAUDE_PROJECT_DIR: projectDir, PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' },
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return { exitCode, stdout, stderr };
}

function readLedger(projectDir: string): Array<Record<string, unknown>> {
    const ledgerPath = join(projectDir, '.spur', 'context', 'token-ledger.jsonl');
    if (!existsSync(ledgerPath)) return [];
    return readFileSync(ledgerPath, 'utf-8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as Record<string, unknown>);
}

function readSession(projectDir: string): Record<string, unknown> | null {
    const sessionFile = join(projectDir, '.spur', 'context', '.session.json');
    if (!existsSync(sessionFile)) return null;
    return JSON.parse(readFileSync(sessionFile, 'utf-8')) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// context-session-start
// ---------------------------------------------------------------------------

describe('context-session-start — side effects', () => {
    test('writes .session.json and appends session_start event to ledger', async () => {
        const dir = makeTempProject();
        try {
            const { exitCode } = await runHook(START_HOOK, dir, {});
            expect(exitCode).toBe(0);

            const session = readSession(dir);
            expect(session).not.toBeNull();
            expect(session?.session).toMatch(/^session-\d{4}-\d{2}-\d{2}-\d{4}$/);

            const ledger = readLedger(dir);
            expect(ledger).toHaveLength(1);
            expect(ledger[0]?.type).toBe('session_start');
            expect(ledger[0]?.session).toBe(session?.session);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('is idempotent across two starts — appends a second event', async () => {
        const dir = makeTempProject();
        try {
            await runHook(START_HOOK, dir, {});
            await runHook(START_HOOK, dir, {});
            const ledger = readLedger(dir);
            expect(ledger).toHaveLength(2);
            expect(ledger.every((e) => e.type === 'session_start')).toBe(true);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

// ---------------------------------------------------------------------------
// context-post-tool
// ---------------------------------------------------------------------------

describe('context-post-tool — event recording', () => {
    test('records a read event with token estimate for Read tool', async () => {
        const dir = makeTempProject();
        try {
            // Seed a session first.
            await runHook(START_HOOK, dir, {});

            const payload = {
                tool_name: 'Read',
                tool_input: { file_path: '/some/file.ts' },
                tool_response: { content: 'x'.repeat(400) },
            };
            const { exitCode } = await runHook(POST_TOOL_HOOK, dir, payload);
            expect(exitCode).toBe(0);

            const events = readLedger(dir).filter((e) => e.type === 'read');
            expect(events).toHaveLength(1);
            expect(events[0]?.file).toBe('/some/file.ts');
            expect(events[0]?.tokens).toBe(100); // ceil(400/4)
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('records a write event with action=create for Write tool', async () => {
        const dir = makeTempProject();
        try {
            await runHook(START_HOOK, dir, {});

            const payload = {
                tool_name: 'Write',
                tool_input: { file_path: '/out/new.ts' },
                tool_response: { content: 'export const x = 1;' },
            };
            const { exitCode } = await runHook(POST_TOOL_HOOK, dir, payload);
            expect(exitCode).toBe(0);

            const events = readLedger(dir).filter((e) => e.type === 'write');
            expect(events).toHaveLength(1);
            expect(events[0]?.action).toBe('create');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('records a write event with action=edit for Edit tool', async () => {
        const dir = makeTempProject();
        try {
            await runHook(START_HOOK, dir, {});

            const payload = {
                tool_name: 'Edit',
                tool_input: { file_path: '/edit/existing.ts' },
                tool_response: { content: 'patched' },
            };
            const { exitCode } = await runHook(POST_TOOL_HOOK, dir, payload);
            expect(exitCode).toBe(0);

            const events = readLedger(dir).filter((e) => e.type === 'write');
            expect(events[0]?.action).toBe('edit');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('fails open (exit 0, no event) for a non-Read/Write/Edit tool', async () => {
        const dir = makeTempProject();
        try {
            await runHook(START_HOOK, dir, {});
            const before = readLedger(dir).length;

            const { exitCode } = await runHook(POST_TOOL_HOOK, dir, {
                tool_name: 'Bash',
                tool_input: { command: 'ls' },
                tool_response: { content: 'file.txt' },
            });
            expect(exitCode).toBe(0);
            expect(readLedger(dir)).toHaveLength(before);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('fails open (exit 0, no event) when .session.json is missing', async () => {
        const dir = makeTempProject();
        try {
            const { exitCode } = await runHook(POST_TOOL_HOOK, dir, {
                tool_name: 'Read',
                tool_input: { file_path: '/x' },
                tool_response: { content: 'data' },
            });
            expect(exitCode).toBe(0);
            expect(readLedger(dir)).toHaveLength(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('fails open (exit 0) on a malformed payload', async () => {
        const dir = makeTempProject();
        try {
            await runHook(START_HOOK, dir, {});
            const { exitCode } = await runHook(POST_TOOL_HOOK, dir, {}, 'not json');
            expect(exitCode).toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

// ---------------------------------------------------------------------------
// context-session-stop
// ---------------------------------------------------------------------------

describe('context-session-stop — session finalization', () => {
    test('computes totals from ledger and writes session_end event', async () => {
        const dir = makeTempProject();
        try {
            // Start session.
            await runHook(START_HOOK, dir, {});
            const session = readSession(dir);
            const sessionId = session?.session as string;

            // Record 2 reads + 1 write.
            await runHook(POST_TOOL_HOOK, dir, {
                tool_name: 'Read',
                tool_input: { file_path: '/a.ts' },
                tool_response: { content: 'aaaa' }, // 4 bytes → 1 token
            });
            await runHook(POST_TOOL_HOOK, dir, {
                tool_name: 'Read',
                tool_input: { file_path: '/b.ts' },
                tool_response: { content: 'bbbb' }, // 4 bytes → 1 token
            });
            await runHook(POST_TOOL_HOOK, dir, {
                tool_name: 'Write',
                tool_input: { file_path: '/c.ts' },
                tool_response: { content: 'cccccccc' }, // 8 bytes → 2 tokens
            });

            // Stop.
            const { exitCode } = await runHook(STOP_HOOK, dir, {});
            expect(exitCode).toBe(0);

            const ledger = readLedger(dir);
            const endEvent = ledger.find((e) => e.type === 'session_end');
            expect(endEvent).toBeDefined();
            expect(endEvent?.session).toBe(sessionId);
            const totals = endEvent?.totals as { reads: number; writes: number; tokens: number };
            expect(totals.reads).toBe(2);
            expect(totals.writes).toBe(1);
            expect(totals.tokens).toBe(4); // 1 + 1 + 2
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('removes .session.json after writing session_end', async () => {
        const dir = makeTempProject();
        try {
            await runHook(START_HOOK, dir, {});
            await runHook(STOP_HOOK, dir, {});
            expect(readSession(dir)).toBeNull();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('fails open (exit 0) when .session.json is missing', async () => {
        const dir = makeTempProject();
        try {
            const { exitCode } = await runHook(STOP_HOOK, dir, {});
            expect(exitCode).toBe(0);
            expect(readLedger(dir)).toHaveLength(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('fails open (exit 0) when .session.json is malformed', async () => {
        const dir = makeTempProject();
        try {
            writeFileSync(join(dir, '.spur', 'context', '.session.json'), 'not json');
            const { exitCode } = await runHook(STOP_HOOK, dir, {});
            expect(exitCode).toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

// ---------------------------------------------------------------------------
// Cross-hook fail-open
// ---------------------------------------------------------------------------

describe('all context hooks — fail-open contract', () => {
    test('session-start exits 0 even with a malformed payload', async () => {
        const dir = makeTempProject();
        try {
            const { exitCode } = await runHook(START_HOOK, dir, {}, 'not json');
            expect(exitCode).toBe(0);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
