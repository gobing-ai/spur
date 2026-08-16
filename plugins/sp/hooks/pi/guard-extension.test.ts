/**
 * guard-extension — Pi hook extension tests.
 *
 * The extension resolves its ledger/session paths per call from process.cwd(),
 * so tests chdir into a temp project before driving handlers and never touch
 * the repo's real `.spur/context/`.
 *
 * Deliberately uncovered: `resolveSpurJsPath` and fallback branch 3 of
 * `resolveSpurTaskOwnership` (run spur.js via process.execPath). Bun caches
 * `os.homedir()` at first call, so $HOME cannot be re-pointed per test, and
 * branch 3 depends on machine-global paths (/opt/homebrew/bin/spur,
 * /usr/local/bin/spur) the test cannot control — asserting through it would be
 * environment-dependent. Branch 2 (candidate binaries) IS exercised by the
 * "no verdict" test whenever a real spur install exists on the machine.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import guardExtension from './guard-extension';

// ─── Harness ─────────────────────────────────────────────────────────────

interface FakeCtx {
    notes: Array<{ msg: string; level: string }>;
    confirms: string[];
    confirmResult: boolean;
    ui: {
        notify: (msg: string, level: string) => void;
        confirm: (title: string, msg: string) => Promise<boolean>;
    };
}

function makeCtx(confirmResult = true): FakeCtx {
    const ctx: FakeCtx = {
        notes: [],
        confirms: [],
        confirmResult,
        ui: {
            notify(msg, level) {
                ctx.notes.push({ msg, level });
            },
            confirm(_title, msg) {
                ctx.confirms.push(msg);
                return Promise.resolve(ctx.confirmResult);
            },
        },
    };
    return ctx;
}

type Handler = (
    event: { toolName?: string; input?: Record<string, unknown> },
    ctx: FakeCtx,
) => Promise<{ block?: boolean; reason?: string } | undefined>;

type Handlers = Record<string, Handler>;

const handlers: Handlers = {};
guardExtension({
    on: (event: string, fn: Handler) => {
        handlers[event] = fn;
    },
} as unknown as Parameters<typeof guardExtension>[0]);

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_SPUR_BIN = process.env.SPUR_BIN;
const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    process.chdir(dir);
    return dir;
}

async function callTool(
    event: { toolName: string; input?: Record<string, unknown> },
    ctx: FakeCtx,
): Promise<{ block?: boolean; reason?: string }> {
    const handler = handlers.tool_call;
    if (!handler) throw new Error('no tool_call handler registered');
    return (await handler(event, ctx)) ?? {};
}

/** Fake spur binary: a shell script exiting with the given code. */
function makeFakeSpur(dir: string, exitCode: number): string {
    const bin = join(dir, 'spur');
    writeFileSync(bin, `#!/bin/sh\nexit ${exitCode}\n`);
    chmodSync(bin, 0o755);
    return bin;
}

function readLedger(projectDir: string): Array<Record<string, unknown>> {
    const ledgerPath = join(projectDir, '.spur', 'context', 'token-ledger.jsonl');
    if (!existsSync(ledgerPath)) return [];
    const rows: Array<Record<string, unknown>> = [];
    for (const line of readFileSync(ledgerPath, 'utf-8').split('\n')) {
        if (!line.trim()) continue;
        try {
            rows.push(JSON.parse(line) as Record<string, unknown>);
        } catch {
            // mirror production: skip unparseable rows
        }
    }
    return rows;
}

afterAll(() => {
    process.chdir(ORIGINAL_CWD);
    if (ORIGINAL_SPUR_BIN === undefined) delete process.env.SPUR_BIN;
    else process.env.SPUR_BIN = ORIGINAL_SPUR_BIN;
    for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

// ─── Registration ────────────────────────────────────────────────────────

describe('guard-extension — registration', () => {
    test('registers all four event handlers', () => {
        for (const event of ['tool_call', 'tool_result', 'session_start', 'session_shutdown']) {
            expect(handlers[event]).toBeDefined();
        }
    });
});

// ─── tool_call: task-write-guard ─────────────────────────────────────────

describe('tool_call — task-write-guard', () => {
    test('allows writes to ordinary source files without consulting spur', async () => {
        const dir = makeTempDir('spur-pi-g1-');
        // A failing SPUR_BIN proves the subprocess is skipped for non-corpus paths.
        process.env.SPUR_BIN = makeFakeSpur(dir, 3);
        try {
            const ctx = makeCtx();
            const res = await callTool({ toolName: 'write', input: { path: join(dir, 'src', 'a.ts') } }, ctx);
            expect(res.block).toBeUndefined();
            expect(ctx.notes).toHaveLength(0);
        } finally {
            delete process.env.SPUR_BIN;
        }
    });

    test('resolves relative input paths against cwd', async () => {
        makeTempDir('spur-pi-g2-');
        const res = await callTool({ toolName: 'write', input: { path: 'src/a.ts' } }, makeCtx());
        expect(res.block).toBeUndefined();
    });

    test('allows when the input carries no path', async () => {
        makeTempDir('spur-pi-g3-');
        const res = await callTool({ toolName: 'edit', input: {} }, makeCtx());
        expect(res.block).toBeUndefined();
    });

    test('accepts Claude-style file_path input', async () => {
        const dir = makeTempDir('spur-pi-g4-');
        const res = await callTool({ toolName: 'edit', input: { file_path: join(dir, 'b.ts') } }, makeCtx());
        expect(res.block).toBeUndefined();
    });

    test('blocks a corpus-shaped path when spur reports owned', async () => {
        const dir = makeTempDir('spur-pi-g5-');
        process.env.SPUR_BIN = makeFakeSpur(dir, 0);
        try {
            const ctx = makeCtx();
            const target = join(dir, 'docs', 'tasks', '0001_x.md');
            const res = await callTool({ toolName: 'write', input: { path: target } }, ctx);
            expect(res.block).toBe(true);
            expect(res.reason).toContain('spur task update');
            expect(ctx.notes.some((n) => n.level === 'error')).toBe(true);
        } finally {
            delete process.env.SPUR_BIN;
        }
    });

    test('allows a corpus-shaped path when spur reports unowned', async () => {
        const dir = makeTempDir('spur-pi-g6-');
        process.env.SPUR_BIN = makeFakeSpur(dir, 1);
        try {
            const res = await callTool(
                { toolName: 'write', input: { path: join(dir, 'docs', 'tasks', '0001_x.md') } },
                makeCtx(),
            );
            expect(res.block).toBeUndefined();
        } finally {
            delete process.env.SPUR_BIN;
        }
    });

    test('never blocks when no spur binary yields an ownership verdict', async () => {
        // SPUR_BIN exits 3 — not a valid resolve verdict — so the candidate loop runs.
        // On machines with a real spur install it resolves the temp path as unowned;
        // on machines without one the result is 'unknown'. Both must allow the write.
        const dir = makeTempDir('spur-pi-g7-');
        process.env.SPUR_BIN = makeFakeSpur(dir, 3);
        try {
            const res = await callTool(
                { toolName: 'write', input: { path: join(dir, 'docs', 'tasks', '0001_x.md') } },
                makeCtx(),
            );
            expect(res.block).toBeUndefined();
        } finally {
            delete process.env.SPUR_BIN;
        }
    });
});

// ─── tool_call: careful-guard ────────────────────────────────────────────

describe('tool_call — careful-guard', () => {
    test('allows a safe command without prompting', async () => {
        makeTempDir('spur-pi-c1-');
        const ctx = makeCtx();
        const res = await callTool({ toolName: 'bash', input: { command: 'ls -la' } }, ctx);
        expect(res.block).toBeUndefined();
        expect(ctx.confirms).toHaveLength(0);
    });

    test('warns and blocks a destructive command when the operator declines', async () => {
        makeTempDir('spur-pi-c2-');
        const ctx = makeCtx(false);
        const res = await callTool({ toolName: 'bash', input: { command: 'rm -rf /tmp/scratch-pi-guard' } }, ctx);
        expect(res.block).toBe(true);
        expect(res.reason).toBe('Cancelled by user');
        expect(ctx.notes.some((n) => n.level === 'warning')).toBe(true);
    });

    test('allows a destructive command when the operator approves', async () => {
        makeTempDir('spur-pi-c3-');
        const ctx = makeCtx(true);
        const res = await callTool({ toolName: 'bash', input: { command: 'rm -rf /tmp/scratch-pi-guard' } }, ctx);
        expect(res.block).toBeUndefined();
        expect(ctx.confirms).toHaveLength(1);
    });

    test('ignores non-string command input', async () => {
        makeTempDir('spur-pi-c4-');
        const ctx = makeCtx();
        const res = await callTool({ toolName: 'bash', input: {} }, ctx);
        expect(res.block).toBeUndefined();
        expect(ctx.confirms).toHaveLength(0);
    });
});

// ─── session_start / tool_result / session_shutdown ──────────────────────

describe('session lifecycle and token ledger', () => {
    test('session_start writes .session.json and appends a session_start row', async () => {
        const dir = makeTempDir('spur-pi-s1-');
        await handlers.session_start?.({}, makeCtx());

        const sessionFile = join(dir, '.spur', 'context', '.session.json');
        expect(existsSync(sessionFile)).toBe(true);
        const session = JSON.parse(readFileSync(sessionFile, 'utf-8')) as Record<string, unknown>;
        expect(typeof session.session_id).toBe('string');
        expect(session.started_at).toBeDefined();

        const ledger = readLedger(dir);
        expect(ledger).toHaveLength(1);
        expect(ledger[0]?.type).toBe('session_start');
        expect(ledger[0]?.session).toBe(session.session_id);
    });

    test('tool_result records a bash event with a token estimate', async () => {
        const dir = makeTempDir('spur-pi-s2-');
        await handlers.session_start?.({}, makeCtx());
        await handlers.tool_result?.({ toolName: 'bash', input: { command: 'ls' } }, makeCtx());

        const events = readLedger(dir).filter((e) => e.type === 'write');
        expect(events).toHaveLength(1);
        expect(events[0]?.summary).toBe('ls');
        expect(events[0]?.tokens).toBe(1); // ceil(2/4)
    });

    test('a Read tool_result records a read event with zero tokens (no command)', async () => {
        const dir = makeTempDir('spur-pi-s3-');
        await handlers.session_start?.({}, makeCtx());
        await handlers.tool_result?.({ toolName: 'Read', input: { file_path: '/x.ts' } }, makeCtx());

        const events = readLedger(dir).filter((e) => e.type === 'read');
        expect(events).toHaveLength(1);
        expect(events[0]?.path).toBe('/x.ts');
        expect(events[0]?.tokens).toBe(0);
    });

    test('secret-bearing commands are redacted before token estimation', async () => {
        const dir = makeTempDir('spur-pi-s4-');
        await handlers.session_start?.({}, makeCtx());
        const command = `echo ghp_${'a'.repeat(36)} sk-${'b'.repeat(20)} AKIA${'C'.repeat(16)} api_key="${'d'.repeat(16)}"`;
        await handlers.tool_result?.({ toolName: 'bash', input: { command } }, makeCtx());

        const events = readLedger(dir).filter((e) => e.type === 'write');
        expect(events).toHaveLength(1);
        expect(typeof events[0]?.tokens).toBe('number');
    });

    test('token estimates cap at 4 KiB of command text', async () => {
        const dir = makeTempDir('spur-pi-s5-');
        await handlers.session_start?.({}, makeCtx());
        await handlers.tool_result?.({ toolName: 'bash', input: { command: 'x'.repeat(5000) } }, makeCtx());

        const events = readLedger(dir).filter((e) => e.type === 'write');
        expect(events[0]?.tokens).toBe(Math.ceil(4096 / 4));
        // The summary is truncated at 200 chars
        expect(String(events[0]?.summary)).toHaveLength(200);
        expect(String(events[0]?.summary).endsWith('...')).toBe(true);
    });

    test('summary candidate chain falls back through pattern to a tool-name placeholder', async () => {
        const dir = makeTempDir('spur-pi-s6-');
        await handlers.session_start?.({}, makeCtx());
        await handlers.tool_result?.({ toolName: 'Grep', input: { pattern: 'TODO' } }, makeCtx());
        await handlers.tool_result?.({ toolName: 'ToolX', input: {} }, makeCtx());

        const events = readLedger(dir).filter((e) => e.type === 'write');
        expect(events[0]?.summary).toBe('TODO');
        expect(events[1]?.summary).toBe('(ToolX)');
    });

    test('tool_result is a no-op when no session is active', async () => {
        const dir = makeTempDir('spur-pi-s7-');
        mkdirSync(join(dir, '.spur', 'context'), { recursive: true });
        await handlers.tool_result?.({ toolName: 'Read', input: { file_path: '/x' } }, makeCtx());
        expect(readLedger(dir)).toHaveLength(0);
    });

    test('tool_result fails open when .spur/context does not exist', async () => {
        const dir = makeTempDir('spur-pi-s8-');
        await handlers.tool_result?.({ toolName: 'Read', input: { file_path: '/x' } }, makeCtx());
        expect(existsSync(join(dir, '.spur', 'context', 'token-ledger.jsonl'))).toBe(false);
    });

    test('tool_result fails open when the session file is malformed', async () => {
        const dir = makeTempDir('spur-pi-s9-');
        await handlers.session_start?.({}, makeCtx());
        writeFileSync(join(dir, '.spur', 'context', '.session.json'), 'not json');
        await handlers.tool_result?.({ toolName: 'Read', input: { file_path: '/x' } }, makeCtx());
        expect(readLedger(dir).filter((e) => e.type === 'read')).toHaveLength(0);
    });

    test('tool_result fails open when the ledger cannot be appended', async () => {
        const dir = makeTempDir('spur-pi-s10-');
        await handlers.session_start?.({}, makeCtx());
        const ledgerPath = join(dir, '.spur', 'context', 'token-ledger.jsonl');
        rmSync(ledgerPath);
        mkdirSync(ledgerPath); // a directory at the ledger path makes appendFileSync throw
        await handlers.tool_result?.({ toolName: 'Read', input: { file_path: '/x' } }, makeCtx());
        // no throw = fail-open contract held
    });

    test('session_start fails open when .spur cannot be created', async () => {
        const dir = makeTempDir('spur-pi-s11-');
        writeFileSync(join(dir, '.spur'), 'a file, not a dir');
        await handlers.session_start?.({}, makeCtx());
        expect(existsSync(join(dir, '.spur', 'context'))).toBe(false);
    });

    test('session_shutdown writes a rollup, skips foreign and malformed rows, removes the session file', async () => {
        const dir = makeTempDir('spur-pi-s12-');
        const ctx = makeCtx();
        await handlers.session_start?.({}, ctx);
        await handlers.tool_result?.({ toolName: 'Read', input: { file_path: '/a' } }, ctx);
        await handlers.tool_result?.({ toolName: 'bash', input: { command: 'aaaa' } }, ctx); // 1 token

        const ledgerPath = join(dir, '.spur', 'context', 'token-ledger.jsonl');
        writeFileSync(
            ledgerPath,
            `${readFileSync(ledgerPath, 'utf-8')}not json\n${JSON.stringify({ session: 'other', type: 'read', tokens: 99 })}\n`,
        );

        await handlers.session_shutdown?.({}, ctx);

        const end = readLedger(dir).find((e) => e.type === 'session_end');
        expect(end).toBeDefined();
        expect(end?.reads).toBe(1);
        expect(end?.writes).toBe(1);
        expect(end?.tokens).toBe(1);
        expect(existsSync(join(dir, '.spur', 'context', '.session.json'))).toBe(false);
    });

    test('session_shutdown fails open when no session file exists', async () => {
        const dir = makeTempDir('spur-pi-s13-');
        mkdirSync(join(dir, '.spur', 'context'), { recursive: true });
        await handlers.session_shutdown?.({}, makeCtx());
        expect(readLedger(dir)).toHaveLength(0);
    });

    test('session_shutdown fails open on a malformed session file', async () => {
        const dir = makeTempDir('spur-pi-s14-');
        mkdirSync(join(dir, '.spur', 'context'), { recursive: true });
        writeFileSync(join(dir, '.spur', 'context', '.session.json'), 'not json');
        await handlers.session_shutdown?.({}, makeCtx());
        // no throw = fail-open contract held
    });
});
