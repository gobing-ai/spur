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
import { getEnvVar, removeEnvVar, setEnvVar } from '../../lib/env';
import { recordToolUseEvent } from '../context-post-tool';
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
    event: { toolName?: string; input?: Record<string, unknown>; content?: unknown },
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
const ORIGINAL_SPUR_BIN = getEnvVar('SPUR_BIN');
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
    if (ORIGINAL_SPUR_BIN === undefined) removeEnvVar('SPUR_BIN');
    else setEnvVar('SPUR_BIN', ORIGINAL_SPUR_BIN);
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
        setEnvVar('SPUR_BIN', makeFakeSpur(dir, 3));
        try {
            const ctx = makeCtx();
            const res = await callTool({ toolName: 'write', input: { path: join(dir, 'src', 'a.ts') } }, ctx);
            expect(res.block).toBeUndefined();
            expect(ctx.notes).toHaveLength(0);
        } finally {
            removeEnvVar('SPUR_BIN');
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
        setEnvVar('SPUR_BIN', makeFakeSpur(dir, 0));
        try {
            const ctx = makeCtx();
            const target = join(dir, 'docs', 'tasks', '0001_x.md');
            const res = await callTool({ toolName: 'write', input: { path: target } }, ctx);
            expect(res.block).toBe(true);
            expect(res.reason).toContain('spur task update');
            expect(ctx.notes.some((n) => n.level === 'error')).toBe(true);
        } finally {
            removeEnvVar('SPUR_BIN');
        }
    });

    test('SPUR_WRITE_GUARD=off allows an owned task file, matching the Claude hook', async () => {
        const dir = makeTempDir('spur-pi-g5b-');
        setEnvVar('SPUR_BIN', makeFakeSpur(dir, 0));
        setEnvVar('SPUR_WRITE_GUARD', 'off');
        try {
            const res = await callTool(
                { toolName: 'write', input: { path: join(dir, 'docs', 'tasks', '0001_x.md') } },
                makeCtx(),
            );
            expect(res.block).toBeUndefined();
        } finally {
            removeEnvVar('SPUR_BIN');
            removeEnvVar('SPUR_WRITE_GUARD');
        }
    });

    test('allows a corpus-shaped path when spur reports unowned', async () => {
        const dir = makeTempDir('spur-pi-g6-');
        setEnvVar('SPUR_BIN', makeFakeSpur(dir, 1));
        try {
            const res = await callTool(
                { toolName: 'write', input: { path: join(dir, 'docs', 'tasks', '0001_x.md') } },
                makeCtx(),
            );
            expect(res.block).toBeUndefined();
        } finally {
            removeEnvVar('SPUR_BIN');
        }
    });

    test('never blocks when no spur binary yields an ownership verdict', async () => {
        // SPUR_BIN exits 3 — not a valid resolve verdict — so the candidate loop runs.
        // On machines with a real spur install it resolves the temp path as unowned;
        // on machines without one the result is 'unknown'. Both must allow the write.
        const dir = makeTempDir('spur-pi-g7-');
        setEnvVar('SPUR_BIN', makeFakeSpur(dir, 3));
        try {
            const res = await callTool(
                { toolName: 'write', input: { path: join(dir, 'docs', 'tasks', '0001_x.md') } },
                makeCtx(),
            );
            expect(res.block).toBeUndefined();
        } finally {
            removeEnvVar('SPUR_BIN');
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

    test('SPUR_CAREFUL=off skips the prompt, matching the Claude hook', async () => {
        makeTempDir('spur-pi-c5-');
        const ctx = makeCtx(false);
        setEnvVar('SPUR_CAREFUL', 'off');
        try {
            const res = await callTool({ toolName: 'bash', input: { command: 'rm -rf /tmp/scratch-pi-guard' } }, ctx);
            expect(res.block).toBeUndefined();
            expect(ctx.confirms).toHaveLength(0);
        } finally {
            removeEnvVar('SPUR_CAREFUL');
        }
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
        expect(typeof session.session).toBe('string');
        expect(String(session.session)).toMatch(/^session-\d{4}-\d{2}-\d{2}-\d{4}$/);
        expect(session.started).toBeDefined();
        expect(session.session_id).toBeUndefined();
        expect(session.started_at).toBeUndefined();

        const ledger = readLedger(dir);
        expect(ledger).toHaveLength(1);
        expect(ledger[0]?.type).toBe('session_start');
        expect(ledger[0]?.session).toBe(session.session);
        expect(typeof ledger[0]?.contextFreshness).toBe('object');
    });

    test('tool_result records a bash event with a token estimate from the response', async () => {
        const dir = makeTempDir('spur-pi-s2-');
        await handlers.session_start?.({}, makeCtx());
        await handlers.tool_result?.(
            { toolName: 'bash', input: { command: 'ls' }, content: [{ type: 'text', text: 'abcd' }] },
            makeCtx(),
        );

        const events = readLedger(dir).filter((e) => e.type === 'bash');
        expect(events).toHaveLength(1);
        expect(events[0]?.summary).toBe('ls');
        expect(events[0]?.tokens).toBe(1); // ceil(4/4)
    });

    test('a Pi read tool_result records a read event with its path; tokens are omitted without content', async () => {
        const dir = makeTempDir('spur-pi-s3-');
        await handlers.session_start?.({}, makeCtx());
        await handlers.tool_result?.({ toolName: 'read', input: { path: '/x.ts' } }, makeCtx());

        const events = readLedger(dir).filter((e) => e.type === 'read');
        expect(events).toHaveLength(1);
        expect(events[0]?.file).toBe('/x.ts');
        expect(events[0]?.tokens).toBeUndefined();
    });

    test('a Pi-native read (lowercase tool, `path` input) records a read event with its path', async () => {
        const dir = makeTempDir('spur-pi-s3b-');
        await handlers.session_start?.({}, makeCtx());
        await handlers.tool_result?.({ toolName: 'read', input: { path: '/y.ts' } }, makeCtx());

        const events = readLedger(dir).filter((e) => e.type === 'read');
        expect(events).toHaveLength(1);
        expect(events[0]?.file).toBe('/y.ts');
    });

    test('secret-bearing commands are redacted before token estimation', async () => {
        const dir = makeTempDir('spur-pi-s4-');
        await handlers.session_start?.({}, makeCtx());
        const command = `echo ghp_${'a'.repeat(36)} sk-${'b'.repeat(20)} AKIA${'C'.repeat(16)} api_key="${'d'.repeat(16)}"`;
        await handlers.tool_result?.(
            { toolName: 'bash', input: { command }, content: [{ type: 'text', text: command }] },
            makeCtx(),
        );

        const events = readLedger(dir).filter((e) => e.type === 'bash');
        expect(events).toHaveLength(1);
        expect(typeof events[0]?.tokens).toBe('number');
        // The persisted summary must not carry the raw secrets.
        const summary = String(events[0]?.summary);
        for (const secret of ['a'.repeat(36), 'b'.repeat(20), 'C'.repeat(16), 'd'.repeat(16)]) {
            expect(summary).not.toContain(secret);
        }
    });

    test('token estimates cap at 4 KiB of command text', async () => {
        const dir = makeTempDir('spur-pi-s5-');
        await handlers.session_start?.({}, makeCtx());
        await handlers.tool_result?.(
            {
                toolName: 'bash',
                input: { command: 'x'.repeat(5000) },
                content: [{ type: 'text', text: 'y'.repeat(5000) }],
            },
            makeCtx(),
        );

        const events = readLedger(dir).filter((e) => e.type === 'bash');
        expect(events[0]?.tokens).toBe(Math.ceil(4096 / 4));
        // The summary is truncated at 200 chars
        expect(String(events[0]?.summary)).toHaveLength(200);
        expect(String(events[0]?.summary).endsWith('…')).toBe(true);
    });

    test('a Pi grep records a grep row with a pattern summary; an unmapped tool writes nothing', async () => {
        const dir = makeTempDir('spur-pi-s6-');
        await handlers.session_start?.({}, makeCtx());
        await handlers.tool_result?.({ toolName: 'grep', input: { pattern: 'TODO' } }, makeCtx());
        await handlers.tool_result?.({ toolName: 'ToolX', input: {} }, makeCtx());

        const events = readLedger(dir).filter((e) => e.type === 'grep');
        expect(events).toHaveLength(1);
        expect(events[0]?.summary).toBe('/TODO/');
        // The unmapped ToolX writes no row (R1 filter).
        expect(readLedger(dir)).toHaveLength(2);
    });

    test('every row carries the fields the ledger reader requires (ts, session, type)', async () => {
        // parseLedgerLine (packages/app/src/services/token-ledger-service.ts) drops any row
        // missing a string `ts`/`session`/`type`; Pi rows once used `timestamp` and vanished.
        const dir = makeTempDir('spur-pi-schema-');
        await handlers.session_start?.({}, makeCtx());
        await handlers.tool_result?.({ toolName: 'read', input: { path: '/z.ts' } }, makeCtx());
        await handlers.session_shutdown?.({}, makeCtx());

        const rows = readLedger(dir);
        expect(rows.map((r) => r.type)).toEqual(['session_start', 'read', 'session_end']);
        for (const row of rows) {
            expect(typeof row.ts).toBe('string');
            expect(typeof row.session).toBe('string');
            expect(row.timestamp).toBeUndefined();
        }
        expect(rows[1]?.file).toBe('/z.ts');
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
        await handlers.tool_result?.({ toolName: 'read', input: { path: '/a' } }, ctx);
        await handlers.tool_result?.({ toolName: 'write', input: { path: '/b', content: 'aaaa' } }, ctx); // 1 token

        const ledgerPath = join(dir, '.spur', 'context', 'token-ledger.jsonl');
        writeFileSync(
            ledgerPath,
            `${readFileSync(ledgerPath, 'utf-8')}not json\n${JSON.stringify({ session: 'other', type: 'read', tokens: 99 })}\n`,
        );

        await handlers.session_shutdown?.({}, ctx);

        const end = readLedger(dir).find((e) => e.type === 'session_end');
        expect(end).toBeDefined();
        expect(end?.totals).toEqual({ reads: 1, writes: 1, tokens: 1 });
        expect(typeof end?.ts).toBe('string');
        expect(typeof end?.session).toBe('string');
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

// ─── Pi/Claude parity (task 0969) ────────────────────────────────────────

/** Drop the wall-clock `ts` so two rows recorded at different instants can be compared. */
function withoutTs(row: Record<string, unknown> | undefined): Record<string, unknown> {
    const { ts: _ts, ...rest } = row ?? {};
    return rest;
}

describe('Pi/Claude ledger parity (0969 R1)', () => {
    const cases: Array<{
        pi: string;
        input: Record<string, unknown>;
        claude: string;
        claudeInput: Record<string, unknown>;
    }> = [
        { pi: 'read', input: { path: '/a.ts' }, claude: 'Read', claudeInput: { file_path: '/a.ts' } },
        {
            pi: 'write',
            input: { path: '/b.ts', content: 'hello' },
            claude: 'Write',
            claudeInput: { file_path: '/b.ts', content: 'hello' },
        },
        {
            pi: 'edit',
            input: { path: '/c.ts', edits: [{ oldText: 'a', newText: 'b' }] },
            claude: 'Edit',
            claudeInput: { file_path: '/c.ts', old_string: 'a', new_string: 'b' },
        },
        {
            pi: 'grep',
            input: { pattern: 'TODO', path: 'src', glob: '*.ts' },
            claude: 'Grep',
            claudeInput: { pattern: 'TODO', path: 'src', glob: '*.ts' },
        },
        {
            pi: 'find',
            input: { pattern: '*.md', path: 'docs' },
            claude: 'Glob',
            claudeInput: { pattern: '*.md', path: 'docs' },
        },
        { pi: 'bash', input: { command: 'ls -la' }, claude: 'Bash', claudeInput: { command: 'ls -la' } },
    ];

    test('every mapped Pi tool row deep-equals the Claude row for the same event after ts', async () => {
        for (const c of cases) {
            const dirA = makeTempDir('parity-pi-');
            await handlers.session_start?.({}, makeCtx());
            await handlers.tool_result?.({ toolName: c.pi, input: c.input }, makeCtx());
            const piRow = readLedger(dirA).find((r) => r.type !== 'session_start');

            // dir B: the same `.session.json`, the equivalent Claude payload through the core.
            const dirB = makeTempDir('parity-claude-');
            const bCtx = join(dirB, '.spur', 'context');
            mkdirSync(bCtx, { recursive: true });
            writeFileSync(join(bCtx, '.session.json'), readFileSync(join(dirA, '.spur', 'context', '.session.json')));
            recordToolUseEvent(bCtx, { tool_name: c.claude, tool_input: c.claudeInput });
            const claudeRow = readLedger(dirB).find((r) => r.type !== 'session_start');

            expect(withoutTs(piRow), `${c.pi} vs ${c.claude}`).toEqual(withoutTs(claudeRow));
        }
    });

    test('an ls event and an unknown custom tool write no row', async () => {
        const dir = makeTempDir('parity-none-');
        await handlers.session_start?.({}, makeCtx());
        await handlers.tool_result?.({ toolName: 'ls', input: { path: '/a' } }, makeCtx());
        await handlers.tool_result?.({ toolName: 'custom_tool', input: {} }, makeCtx());
        expect(readLedger(dir).filter((r) => r.type !== 'session_start')).toHaveLength(0);
    });
});

describe('Pi session schema and reuse (0969 R2)', () => {
    test('session_start writes the Claude schema with a pi agent fallback and a freshness stamp', async () => {
        const dir = makeTempDir('parity-session-');
        const saved: Record<string, string | undefined> = {};
        for (const key of ['SPUR_AGENT', 'CLAUDE_CODE_ENTRYPOINT', 'TERM_PROGRAM', 'SPUR_DEFAULT_AGENT']) {
            saved[key] = getEnvVar(key);
            removeEnvVar(key);
        }
        try {
            await handlers.session_start?.({}, makeCtx());
            const session = JSON.parse(readFileSync(join(dir, '.spur', 'context', '.session.json'), 'utf-8')) as Record<
                string,
                unknown
            >;
            expect(Object.keys(session)).toContain('session');
            expect(String(session.session)).toMatch(/^session-\d{4}-\d{2}-\d{2}-\d{4}$/);
            expect(session.started).toBeDefined();
            expect(session.session_id).toBeUndefined();
            expect(session.started_at).toBeUndefined();
            expect(session.agent).toBe('pi');

            const starts = readLedger(dir).filter((r) => r.type === 'session_start');
            expect(starts).toHaveLength(1);
            expect(typeof starts[0]?.contextFreshness).toBe('object');
        } finally {
            for (const [key, value] of Object.entries(saved)) {
                if (value === undefined) removeEnvVar(key);
                else setEnvVar(key, value);
            }
        }
    });

    test('a fresh session with SPUR_RUN_ID is reused byte-identically with no new row', async () => {
        const dir = makeTempDir('parity-reuse-');
        await handlers.session_start?.({}, makeCtx());
        const sessionFile = join(dir, '.spur', 'context', '.session.json');
        const before = readFileSync(sessionFile, 'utf-8');
        const rowsBefore = readLedger(dir).length;
        setEnvVar('SPUR_RUN_ID', 'x');
        try {
            await handlers.session_start?.({}, makeCtx());
        } finally {
            removeEnvVar('SPUR_RUN_ID');
        }
        expect(readFileSync(sessionFile, 'utf-8')).toBe(before);
        expect(readLedger(dir)).toHaveLength(rowsBefore);
    });
});

describe('Pi session shutdown rollup (0969 R3)', () => {
    test('session_end carries nested totals, satisfies the reader contract, and removes the pointer', async () => {
        const dir = makeTempDir('parity-shutdown-');
        const ctx = makeCtx();
        await handlers.session_start?.({}, ctx);
        await handlers.tool_result?.({ toolName: 'read', input: { path: '/a' } }, ctx);
        await handlers.tool_result?.({ toolName: 'write', input: { path: '/b', content: 'aaaa' } }, ctx); // 1 token
        await handlers.session_shutdown?.({}, ctx);

        const end = readLedger(dir).find((r) => r.type === 'session_end');
        expect(end).toBeDefined();
        expect(end?.totals).toEqual({ reads: 1, writes: 1, tokens: 1 });
        // Reader contract (token-ledger-service.ts:97-117): string ts/session/type + object totals.
        expect(typeof end?.ts).toBe('string');
        expect(typeof end?.session).toBe('string');
        expect(typeof end?.totals).toBe('object');
        expect(existsSync(join(dir, '.spur', 'context', '.session.json'))).toBe(false);
    });
});
