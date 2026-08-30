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

    test('a second start inside the same session appends nothing (task 0398 R3)', async () => {
        // Superseded assertion: this test previously expected two `session_start` rows from two
        // fires and called that "idempotent". It was encoding RC-2 — SessionStart fires per nested
        // agent.run subprocess, so "one row per fire" meant one pipeline run registered as dozens
        // of sessions (332 starts vs 157 ends across the H6 ledger). One row per *session* is the
        // contract; `resolveActiveSession` enforces it.
        const dir = makeTempProject();
        try {
            await runHook(START_HOOK, dir, {});
            await runHook(START_HOOK, dir, {});
            const ledger = readLedger(dir);
            expect(ledger).toHaveLength(1);
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

    test('records bash event with truncated command summary (task 0248)', async () => {
        const dir = makeTempProject();
        try {
            await runHook(START_HOOK, dir, {});
            const { exitCode } = await runHook(POST_TOOL_HOOK, dir, {
                tool_name: 'Bash',
                tool_input: { command: 'ls -la' },
                tool_response: { content: 'file.txt\n' },
            });
            expect(exitCode).toBe(0);
            const events = readLedger(dir).filter((e) => e.type === 'bash');
            expect(events).toHaveLength(1);
            expect(events[0]?.summary).toBe('ls -la');
            expect(events[0]?.file).toBeUndefined();
            expect(events[0]?.tokens).toBe(Math.ceil(new TextEncoder().encode('file.txt\n').length / 4));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('records grep and glob events without full dumps (task 0248)', async () => {
        const dir = makeTempProject();
        try {
            await runHook(START_HOOK, dir, {});
            await runHook(POST_TOOL_HOOK, dir, {
                tool_name: 'Grep',
                tool_input: { pattern: 'TODO', path: 'src', glob: '*.ts' },
                tool_response: { content: 'src/a.ts:1:TODO' },
            });
            await runHook(POST_TOOL_HOOK, dir, {
                tool_name: 'Glob',
                tool_input: { pattern: '**/*.test.ts', path: 'packages' },
                tool_response: { content: 'packages/app/a.test.ts\n' },
            });
            const ledger = readLedger(dir);
            const grep = ledger.filter((e) => e.type === 'grep');
            const glob = ledger.filter((e) => e.type === 'glob');
            expect(grep).toHaveLength(1);
            expect(String(grep[0]?.summary)).toContain('TODO');
            expect(glob).toHaveLength(1);
            expect(String(glob[0]?.summary)).toContain('**/*.test.ts');
            // Must not store multi-line full dumps as file
            expect(grep[0]?.file).toBeUndefined();
            expect(glob[0]?.file).toBeUndefined();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('caps large Bash stdout for token estimate and never stores body (task 0248)', async () => {
        const dir = makeTempProject();
        try {
            await runHook(START_HOOK, dir, {});
            const huge = 'x'.repeat(20_000);
            const { exitCode } = await runHook(POST_TOOL_HOOK, dir, {
                tool_name: 'Bash',
                tool_input: { command: 'cat big.log' },
                tool_response: { content: huge },
            });
            expect(exitCode).toBe(0);
            const events = readLedger(dir).filter((e) => e.type === 'bash');
            expect(events).toHaveLength(1);
            // tokens reflect 4 KiB cap, not full 20k
            expect(events[0]?.tokens).toBe(Math.ceil(4096 / 4));
            const line = JSON.stringify(events[0]);
            expect(line.includes(huge)).toBe(false);
            expect(events[0]?.summary).toBe('cat big.log');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('fails open (exit 0, no event) for tools outside the allowlist (task 0248)', async () => {
        const dir = makeTempProject();
        try {
            await runHook(START_HOOK, dir, {});
            const before = readLedger(dir).length;

            const { exitCode } = await runHook(POST_TOOL_HOOK, dir, {
                tool_name: 'ToolX',
                tool_input: { command: 'nope' },
                tool_response: { content: 'secret' },
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

    test('token cascade uses Write tool_input.content when response content empty', async () => {
        const dir = makeTempProject();
        try {
            await runHook(START_HOOK, dir, {});
            const body = 'y'.repeat(400);
            const { exitCode } = await runHook(POST_TOOL_HOOK, dir, {
                tool_name: 'Write',
                tool_input: { file_path: '/out.ts', content: body },
                tool_response: {},
            });
            expect(exitCode).toBe(0);
            const events = readLedger(dir).filter((e) => e.type === 'write');
            expect(events[0]?.tokens).toBe(100);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('omits tokens when unknown (does not store 0)', async () => {
        const dir = makeTempProject();
        try {
            await runHook(START_HOOK, dir, {});
            await runHook(POST_TOOL_HOOK, dir, {
                tool_name: 'Edit',
                tool_input: { file_path: '/missing-no-stat-content.ts' },
                tool_response: {},
            });
            const events = readLedger(dir).filter((e) => e.type === 'write');
            expect(events).toHaveLength(1);
            expect(events[0]?.tokens).toBeUndefined();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('copies session_id from payload and agent from session file', async () => {
        const dir = makeTempProject();
        try {
            await runHook(START_HOOK, dir, {});
            // Enrich session file as SessionStart with agent would.
            const sessionPath = join(dir, '.spur', 'context', '.session.json');
            const session = JSON.parse(readFileSync(sessionPath, 'utf-8')) as Record<string, unknown>;
            session.agent = 'claude';
            session.model = 'test-model';
            writeFileSync(sessionPath, JSON.stringify(session));

            await runHook(POST_TOOL_HOOK, dir, {
                session_id: 'platform-sess-1',
                tool_name: 'Read',
                tool_input: { file_path: '/a.ts' },
                tool_response: { content: 'hi' },
            });
            const events = readLedger(dir).filter((e) => e.type === 'read');
            expect(events[0]?.sessionId).toBe('platform-sess-1');
            expect(events[0]?.agent).toBe('claude');
            expect(events[0]?.model).toBe('test-model');
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

describe('context-session-start — idempotency per in-flight session (task 0398 R3)', () => {
    // SessionStart fires in every nested agent.run subprocess, not once per host session. Each
    // firing used to mint a new id, append a session_start row, and overwrite the .session.json
    // pointer that context-post-tool reads — 332 starts vs 157 ends across the H6 ledger.
    const ctxDir = (projectDir: string) => join(projectDir, '.spur', 'context');
    const ledgerLines = (projectDir: string): Record<string, unknown>[] => {
        const p = join(ctxDir(projectDir), 'token-ledger.jsonl');
        if (!existsSync(p)) return [];
        return readFileSync(p, 'utf-8')
            .split('\n')
            .filter((l) => l.trim())
            .map((l) => JSON.parse(l) as Record<string, unknown>);
    };

    test('a nested fire reuses the ancestor session and appends no second session_start', async () => {
        const projectDir = makeTempProject();
        await runHook(START_HOOK, projectDir, {});
        const afterFirst = readFileSync(join(ctxDir(projectDir), '.session.json'), 'utf-8');
        const firstId = (JSON.parse(afterFirst) as { session: string }).session;

        await runHook(START_HOOK, projectDir, {});
        await runHook(START_HOOK, projectDir, {});

        const starts = ledgerLines(projectDir).filter((e) => e.type === 'session_start');
        expect(starts).toHaveLength(1);
        // The pointer must still name the original session — post-tool events key off it.
        const afterNested = JSON.parse(readFileSync(join(ctxDir(projectDir), '.session.json'), 'utf-8')) as {
            session: string;
        };
        expect(afterNested.session).toBe(firstId);
        rmSync(projectDir, { recursive: true, force: true });
    });

    test('a genuinely new host session (no pointer file) still opens one', async () => {
        const projectDir = makeTempProject();
        await runHook(START_HOOK, projectDir, {});
        // True teardown removes .session.json; the next start must mint a fresh session.
        rmSync(join(ctxDir(projectDir), '.session.json'), { force: true });
        await runHook(START_HOOK, projectDir, {});

        const starts = ledgerLines(projectDir).filter((e) => e.type === 'session_start');
        expect(starts).toHaveLength(2);
        // NOTE: ids are minute-granular (`session-<date>-<HHMM>`), so two sessions opened inside
        // the same minute share an id. That collision predates 0398 and is not what R3 fixes —
        // assert the pointer was re-minted rather than asserting id inequality.
        expect(existsSync(join(ctxDir(projectDir), '.session.json'))).toBe(true);
        rmSync(projectDir, { recursive: true, force: true });
    });

    test('start → stop → start yields a balanced, non-reused pair', async () => {
        const projectDir = makeTempProject();
        await runHook(START_HOOK, projectDir, {});
        await runHook(STOP_HOOK, projectDir, {});
        await runHook(START_HOOK, projectDir, {});

        const events = ledgerLines(projectDir);
        expect(events.filter((e) => e.type === 'session_start')).toHaveLength(2);
        expect(events.filter((e) => e.type === 'session_end')).toHaveLength(1);
        rmSync(projectDir, { recursive: true, force: true });
    });
});

describe('resolveActiveSession — unit (task 0398 R3)', () => {
    const seed = (body: unknown): string => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-sess-'));
        writeFileSync(join(dir, '.session.json'), typeof body === 'string' ? body : JSON.stringify(body));
        return dir;
    };
    const NOW = new Date('2026-07-31T12:00:00.000Z');

    test('returns the id when the session is recent', async () => {
        const { resolveActiveSession } = await import('./context-session-start');
        const dir = seed({ session: 'session-2026-07-31-1150', started: '2026-07-31T11:50:00.000Z' });
        expect(resolveActiveSession(dir, NOW, {})).toBe('session-2026-07-31-1150');
        rmSync(dir, { recursive: true, force: true });
    });

    test('returns null past the idle window so a stale file cannot capture a new session', async () => {
        const { resolveActiveSession, SESSION_REUSE_IDLE_MS } = await import('./context-session-start');
        const stale = new Date(NOW.getTime() - SESSION_REUSE_IDLE_MS - 1000).toISOString();
        const dir = seed({ session: 'session-old', started: stale });
        expect(resolveActiveSession(dir, NOW, {})).toBeNull();
        rmSync(dir, { recursive: true, force: true });
    });

    test('returns null on a future timestamp (clock skew)', async () => {
        const { resolveActiveSession } = await import('./context-session-start');
        const dir = seed({ session: 'session-future', started: '2026-08-01T00:00:00.000Z' });
        expect(resolveActiveSession(dir, NOW, {})).toBeNull();
        rmSync(dir, { recursive: true, force: true });
    });

    test.each([
        ['corrupt json', 'not json at all'],
        ['missing session', JSON.stringify({ started: '2026-07-31T11:50:00.000Z' })],
        ['empty session', JSON.stringify({ session: '', started: '2026-07-31T11:50:00.000Z' })],
        ['missing started', JSON.stringify({ session: 'x' })],
        ['unparseable started', JSON.stringify({ session: 'x', started: 'whenever' })],
    ])('returns null on %s', async (_label, body) => {
        const { resolveActiveSession } = await import('./context-session-start');
        const dir = seed(body);
        expect(resolveActiveSession(dir, NOW, {})).toBeNull();
        rmSync(dir, { recursive: true, force: true });
    });

    test('returns null when no pointer file exists', async () => {
        const { resolveActiveSession } = await import('./context-session-start');
        const dir = mkdtempSync(join(tmpdir(), 'spur-sess-none-'));
        expect(resolveActiveSession(dir, NOW, {})).toBeNull();
        rmSync(dir, { recursive: true, force: true });
    });
});

describe('resolveActiveSession — exact ancestor signal (task 0398 R3, ts-ai-runner >= 0.4.15)', () => {
    // AiRunner exports SPUR_RUN_ID into the agent subprocess when the caller supplies a
    // correlation, which Spur's pipeline always does. Its presence proves nesting exactly, so the
    // wall-clock window must not apply — a pipeline step may legitimately run for 30+ minutes.
    const seed = (body: unknown): string => {
        const dir = mkdtempSync(join(tmpdir(), 'spur-sess-env-'));
        writeFileSync(join(dir, '.session.json'), JSON.stringify(body));
        return dir;
    };
    const NOW = new Date('2026-07-31T12:00:00.000Z');

    test('reuses the session when SPUR_RUN_ID is set, even far past the idle window', async () => {
        const { resolveActiveSession, SESSION_REUSE_IDLE_MS, AGENT_RUN_ID_ENV } = await import(
            './context-session-start'
        );
        const ancient = new Date(NOW.getTime() - SESSION_REUSE_IDLE_MS * 10).toISOString();
        const dir = seed({ session: 'session-parent', started: ancient });
        expect(resolveActiveSession(dir, NOW, { [AGENT_RUN_ID_ENV]: 'run-abc' })).toBe('session-parent');
        rmSync(dir, { recursive: true, force: true });
    });

    test('without the marker the same ancient session is retired by the window', async () => {
        const { resolveActiveSession, SESSION_REUSE_IDLE_MS } = await import('./context-session-start');
        const ancient = new Date(NOW.getTime() - SESSION_REUSE_IDLE_MS * 10).toISOString();
        const dir = seed({ session: 'session-parent', started: ancient });
        expect(resolveActiveSession(dir, NOW, {})).toBeNull();
        rmSync(dir, { recursive: true, force: true });
    });

    test('reuses on the marker even when started is missing or unparseable', async () => {
        const { resolveActiveSession, AGENT_RUN_ID_ENV } = await import('./context-session-start');
        for (const body of [{ session: 'session-x' }, { session: 'session-x', started: 'whenever' }]) {
            const dir = seed(body);
            expect(resolveActiveSession(dir, NOW, { [AGENT_RUN_ID_ENV]: 'run-abc' })).toBe('session-x');
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test.each([
        ['empty', ''],
        ['whitespace', '   '],
    ])('a %s SPUR_RUN_ID is not a marker and falls through to the window', async (_label, value) => {
        const { resolveActiveSession, SESSION_REUSE_IDLE_MS, AGENT_RUN_ID_ENV } = await import(
            './context-session-start'
        );
        const ancient = new Date(NOW.getTime() - SESSION_REUSE_IDLE_MS * 10).toISOString();
        const dir = seed({ session: 'session-parent', started: ancient });
        expect(resolveActiveSession(dir, NOW, { [AGENT_RUN_ID_ENV]: value })).toBeNull();
        rmSync(dir, { recursive: true, force: true });
    });

    test('the marker never fabricates a session when no pointer file exists', async () => {
        const { resolveActiveSession, AGENT_RUN_ID_ENV } = await import('./context-session-start');
        const dir = mkdtempSync(join(tmpdir(), 'spur-sess-env-none-'));
        expect(resolveActiveSession(dir, NOW, { [AGENT_RUN_ID_ENV]: 'run-abc' })).toBeNull();
        rmSync(dir, { recursive: true, force: true });
    });

    test('the env var name matches the ts-ai-runner published contract', async () => {
        const { AGENT_RUN_ID_ENV } = await import('./context-session-start');
        expect(AGENT_RUN_ID_ENV).toBe('SPUR_RUN_ID');
    });
});

// ---------------------------------------------------------------------------
// context-post-tool — freshness sidecar (task 0711 R4, in-process units)
// ---------------------------------------------------------------------------

describe('context freshness sidecar (task 0711 R4)', () => {
    test('isContextIndexFile matches only .md files inside the context dir', async () => {
        const { isContextIndexFile } = await import('./context-post-tool');
        const dir = makeTempProject();
        try {
            const ctx = join(dir, '.spur', 'context');
            expect(isContextIndexFile(ctx, join(ctx, 'anatomy.md'))).toBe(true);
            expect(isContextIndexFile(ctx, join(ctx, '.freshness.json'))).toBe(false);
            expect(isContextIndexFile(ctx, join(dir, 'outside.md'))).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('currentHeadCommit returns HEAD inside a repo and null outside one', async () => {
        const { currentHeadCommit } = await import('./context-post-tool');
        expect(currentHeadCommit()).toMatch(/^[0-9a-f]{40}$/);
        const outside = mkdtempSync(join(tmpdir(), 'spur-nogit-'));
        try {
            const prev = process.cwd();
            process.chdir(outside);
            try {
                expect(currentHeadCommit()).toBeNull();
            } finally {
                process.chdir(prev);
            }
        } finally {
            rmSync(outside, { recursive: true, force: true });
        }
    });

    test('stamp + read roundtrip; null commit writes nothing', async () => {
        const { readContextFreshness, stampContextFreshness } = await import('./context-post-tool');
        const dir = makeTempProject();
        try {
            const ctx = join(dir, '.spur', 'context');
            stampContextFreshness(ctx, null, new Date(0));
            expect(readContextFreshness(ctx)).toBeNull();
            stampContextFreshness(ctx, 'c0ffee', new Date('2026-01-01T00:00:00.000Z'));
            const raw = readContextFreshness(ctx);
            expect(raw).not.toBeNull();
            expect(JSON.parse(raw ?? '{}')).toEqual({
                schema_version: 1,
                source_commit: 'c0ffee',
                generated_at: '2026-01-01T00:00:00.000Z',
            });
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('checkContextFreshness classifies all staleness reasons', async () => {
        const { CONTEXT_FRESHNESS_SCHEMA_VERSION, checkContextFreshness } = await import('./context-post-tool');
        expect(checkContextFreshness(null, 'c0ffee')).toEqual({ stale: true, reason: 'never stamped' });
        expect(checkContextFreshness('not json', 'c0ffee')).toEqual({ stale: true, reason: 'malformed sidecar' });
        expect(
            checkContextFreshness(JSON.stringify({ schema_version: 99, source_commit: 'c0ffee' }), 'c0ffee'),
        ).toEqual({ stale: true, reason: `schema_version 99` });
        expect(
            checkContextFreshness(
                JSON.stringify({ schema_version: CONTEXT_FRESHNESS_SCHEMA_VERSION, source_commit: '' }),
                'c0ffee',
            ),
        ).toEqual({ stale: true, reason: 'missing source_commit' });
        expect(
            checkContextFreshness(
                JSON.stringify({ schema_version: CONTEXT_FRESHNESS_SCHEMA_VERSION, source_commit: 'old' }),
                'c0ffee',
            ),
        ).toEqual({ stale: true, reason: 'source commit changed since generation' });
        expect(
            checkContextFreshness(
                JSON.stringify({ schema_version: CONTEXT_FRESHNESS_SCHEMA_VERSION, source_commit: 'c0ffee' }),
                'c0ffee',
            ),
        ).toEqual({ stale: false });
    });

    test('a Write landing on a context index refreshes .freshness.json (producer moment)', async () => {
        const { recordToolUseEvent } = await import('./context-post-tool');
        const dir = makeTempProject();
        try {
            const ctx = join(dir, '.spur', 'context');
            writeFileSync(join(ctx, '.session.json'), JSON.stringify({ session: 'session-x' }));
            const event = recordToolUseEvent(ctx, {
                tool_name: 'Write',
                tool_input: { file_path: join(ctx, 'anatomy.md') },
                tool_response: { content: 'index' },
            });
            expect(event).not.toBeNull();
            const raw = readFileSync(join(ctx, '.freshness.json'), 'utf-8');
            expect(JSON.parse(raw).source_commit).toMatch(/^[0-9a-f]{40}$/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
