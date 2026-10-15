/**
 * guard-extension — the thin Pi wrapper over `spur self hook <id> --host pi`.
 *
 * Handlers run in-process (the extension resolves the project from process.cwd(), so each test
 * chdirs into a scratch project). `spur` is a fake that `exec`s the real CLI for `self hook` —
 * so verdicts, ledger rows and session ownership come from the real transport — and fakes the
 * CLI calls the transport makes in turn (`task resolve`, `agent report`), logging every argv.
 * Byte-level parity with the retired 304-line extension is pinned separately by
 * apps/cli/tests/self-hook-parity.test.ts against frozen golden output.
 */

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import guardExtension from '../../../hooks/pi/guard-extension';
import { getEnvVar, setEnvVar } from '../../../lib/env';

const CLI = resolve(import.meta.dir, '..', '..', '..', '..', '..', 'apps', 'cli', 'src', 'index.ts');
const root = realpathSync(mkdtempSync(join(tmpdir(), 'sp-pi-wrapper-')));
const log = join(root, 'spur-argv.log');
const fake = join(root, 'spur');
writeFileSync(
    fake,
    `#!/bin/sh
echo "$*" >> "${log}"
case "$1 $2" in
  "self hook") exec "${process.execPath}" "${CLI}" "$@";;
  "task resolve") case "$3" in *owned*) echo '{"wbs":"0001"}'; exit 0;; *) exit 1;; esac;;
  "agent report") exit 0;;
esac
exit 1
`,
);
chmodSync(fake, 0o755);

type Verdict = { block?: boolean; reason?: string } | undefined;
type Handler = (event: Record<string, unknown>, ctx: unknown) => Promise<Verdict>;
const handlers = new Map<string, Handler>();
guardExtension({ on: (event: string, fn: Handler) => handlers.set(event, fn) } as unknown as Parameters<
    typeof guardExtension
>[0]);

const ORIGINAL_CWD = process.cwd();
const saved = Object.fromEntries(
    ['SPUR_BIN', 'SPUR_WRITE_GUARD', 'SPUR_CAREFUL', 'SPUR_SPEC_ID', 'CLAUDE_PROJECT_DIR'].map((k) => [
        k,
        getEnvVar(k),
    ]),
);
afterAll(() => {
    process.chdir(ORIGINAL_CWD);
    for (const [key, value] of Object.entries(saved)) setEnvVar(key, value);
    rmSync(root, { recursive: true, force: true });
});

let project: string;
let n = 0;
beforeEach(() => {
    project = join(root, `p${n++}`);
    mkdirSync(join(project, '.spur', 'context'), { recursive: true });
    process.chdir(project);
    rmSync(log, { force: true });
    setEnvVar('SPUR_BIN', fake);
    for (const key of ['SPUR_WRITE_GUARD', 'SPUR_CAREFUL', 'SPUR_SPEC_ID', 'CLAUDE_PROJECT_DIR'])
        setEnvVar(key, undefined);
});

function makeCtx(confirmResult = false, sessionId = 'pi-sess') {
    const ctx = {
        notes: [] as Array<[string, string]>,
        confirms: [] as string[],
        sessionManager: { getSessionId: () => sessionId },
        ui: {
            notify: (msg: string, level: string) => void ctx.notes.push([msg, level]),
            confirm: async (_title: string, msg: string) => {
                ctx.confirms.push(msg);
                return confirmResult;
            },
        },
    };
    return ctx;
}

const fire = (event: string, payload: Record<string, unknown>, ctx: unknown = makeCtx()) =>
    (handlers.get(event) as Handler)(payload, ctx);
const argv = (): string[] => (existsSync(log) ? readFileSync(log, 'utf-8').split('\n').filter(Boolean) : []);
const ledger = () =>
    readFileSync(join(project, '.spur', 'context', 'token-ledger.jsonl'), 'utf-8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>);

const TIMEOUT = 30_000;

test('registers the six Pi events', () => {
    expect([...handlers.keys()].sort()).toEqual([
        'agent_settled',
        'agent_start',
        'session_shutdown',
        'session_start',
        'tool_call',
        'tool_result',
    ]);
});

describe('tool_call — task-write-guard', () => {
    test(
        'blocks an owned task file with spur’s reason and an error notice',
        async () => {
            const ctx = makeCtx();
            const verdict = await fire(
                'tool_call',
                { toolName: 'write', input: { path: 'docs/tasks/0001_owned.md' } },
                ctx,
            );
            const reason = `Denied: ${join(project, 'docs/tasks/0001_owned.md')} is a Spur task file. Use 'spur task update' instead.`;
            expect(verdict).toEqual({ block: true, reason });
            expect(ctx.notes).toEqual([[reason, 'error']]);
        },
        TIMEOUT,
    );

    test(
        'allows an unowned task name, and accepts Claude-style file_path input',
        async () => {
            expect(await fire('tool_call', { toolName: 'edit', input: { path: 'docs/tasks/0002_free.md' } })).toEqual(
                {},
            );
            expect(
                await fire('tool_call', { toolName: 'write', input: { file_path: 'docs/tasks/0001_owned.md' } }),
            ).toMatchObject({
                block: true,
            });
        },
        TIMEOUT,
    );

    test('never spawns spur for a non-markdown path or a pathless input', async () => {
        expect(await fire('tool_call', { toolName: 'write', input: { path: 'src/a.ts' } })).toEqual({});
        expect(await fire('tool_call', { toolName: 'edit', input: {} })).toEqual({});
        expect(await fire('tool_call', { toolName: 'read' })).toEqual({});
        expect(argv()).toEqual([]);
    });

    test(
        'SPUR_WRITE_GUARD=off allows an owned file',
        async () => {
            setEnvVar('SPUR_WRITE_GUARD', 'off');
            expect(await fire('tool_call', { toolName: 'write', input: { path: 'docs/tasks/0001_owned.md' } })).toEqual(
                {},
            );
        },
        TIMEOUT,
    );
});

describe('tool_call — careful-guard', () => {
    test(
        'a safe command passes without a prompt',
        async () => {
            const ctx = makeCtx();
            expect(await fire('tool_call', { toolName: 'bash', input: { command: 'ls -la' } }, ctx)).toEqual({});
            expect(ctx.confirms).toEqual([]);
        },
        TIMEOUT,
    );

    test(
        'a destructive command warns, asks, and blocks when declined',
        async () => {
            const ctx = makeCtx(false);
            const verdict = await fire('tool_call', { toolName: 'bash', input: { command: 'rm -rf /' } }, ctx);
            expect(verdict).toEqual({ block: true, reason: 'Cancelled by user' });
            expect(ctx.confirms[0]).toStartWith('Warning: destructive command — ');
            expect(ctx.notes).toEqual([[ctx.confirms[0] as string, 'warning']]);
        },
        TIMEOUT,
    );

    test(
        'an approved destructive command proceeds; SPUR_CAREFUL=off skips the prompt',
        async () => {
            const ctx = makeCtx(true);
            expect(
                await fire('tool_call', { toolName: 'bash', input: { command: 'git reset --hard HEAD~3' } }, ctx),
            ).toEqual({});
            expect(ctx.confirms).toHaveLength(1);
            setEnvVar('SPUR_CAREFUL', 'off');
            const quiet = makeCtx(false);
            expect(await fire('tool_call', { toolName: 'bash', input: { command: 'rm -rf /' } }, quiet)).toEqual({});
            expect(quiet.confirms).toEqual([]);
        },
        TIMEOUT,
    );
});

describe('fail open', () => {
    test('spur missing: guards allow and events do not throw', async () => {
        setEnvVar('SPUR_BIN', join(root, 'absent'));
        expect(await fire('tool_call', { toolName: 'write', input: { path: 'docs/tasks/0001_owned.md' } })).toEqual({});
        expect(await fire('tool_call', { toolName: 'bash', input: { command: 'rm -rf /' } })).toEqual({});
        await fire('session_start', {});
        await fire('session_shutdown', {});
        expect(existsSync(join(project, '.spur', 'context', 'token-ledger.jsonl'))).toBe(false);
    });

    test('unparseable or unknown verdicts allow', async () => {
        const garbage = join(root, 'garbage-spur');
        writeFileSync(
            garbage,
            '#!/bin/sh\ncase "$4" in task-write-guard) echo nope;; *) echo \'{"action":"maybe"}\';; esac\n',
        );
        chmodSync(garbage, 0o755);
        setEnvVar('SPUR_BIN', garbage);
        expect(await fire('tool_call', { toolName: 'write', input: { path: 'docs/tasks/0001_owned.md' } })).toEqual({});
        expect(await fire('tool_call', { toolName: 'bash', input: { command: 'rm -rf /' } })).toEqual({});
    });
});

describe('events — serial queue into the real transport', () => {
    test(
        'session_start → tool_results → session_shutdown writes an ordered, Pi-owned ledger',
        async () => {
            const ctx = makeCtx();
            await fire('session_start', {}, ctx);
            await fire(
                'tool_result',
                { toolName: 'bash', input: { command: 'ls' }, content: [{ type: 'text', text: 'a\nb' }] },
                ctx,
            );
            await fire('tool_result', { toolName: 'read', input: { path: 'README.md' }, content: 'hello' }, ctx);
            await fire('tool_result', { toolName: 'web_search', input: {} }, ctx);
            await fire('session_shutdown', {}, ctx);
            const rows = ledger();
            expect(rows.map((row) => row.type)).toEqual(['session_start', 'bash', 'read', 'session_end']);
            expect(rows[0]).toMatchObject({ agent: 'pi' });
            expect(rows[1]).toMatchObject({ summary: 'ls', sessionId: 'pi-sess', agent: 'pi' });
            expect(rows[2]).toMatchObject({ file: 'README.md', tokens: 2 });
            expect(rows[3]).toMatchObject({ totals: { reads: 1, writes: 0, tokens: 3 } });
            expect(existsSync(join(project, '.spur', 'context', '.session.json'))).toBe(false);
        },
        TIMEOUT,
    );

    test(
        'a nested Pi session cannot finalize the parent’s ledger',
        async () => {
            await fire('session_start', {}, makeCtx(false, 'parent'));
            await fire('session_shutdown', {}, makeCtx(false, 'child'));
            expect(existsSync(join(project, '.spur', 'context', '.session.json'))).toBe(true);
            await fire('session_shutdown', {}, makeCtx(false, 'parent'));
            expect(ledger().map((row) => row.type)).toEqual(['session_start', 'session_end']);
        },
        TIMEOUT,
    );

    test(
        'agent_start / agent_settled report working / idle inside a fleet, nothing outside',
        async () => {
            await fire('agent_start', {});
            await fire('session_shutdown', {}); // drains the queue
            expect(argv().filter((line) => line.startsWith('agent report'))).toEqual([]);
            setEnvVar('SPUR_SPEC_ID', 'proj-worker-1');
            await fire('agent_start', {});
            await fire('agent_settled', {});
            await fire('session_shutdown', {});
            for (let i = 0; i < 40 && argv().filter((l) => l.startsWith('agent report')).length < 2; i++)
                await Bun.sleep(50);
            expect(
                argv()
                    .filter((line) => line.startsWith('agent report'))
                    .map((l) => l.replace(/--seq \d+/, '--seq N')),
            ).toEqual(['agent report --state working --seq N', 'agent report --state idle --seq N']);
        },
        TIMEOUT,
    );
});
