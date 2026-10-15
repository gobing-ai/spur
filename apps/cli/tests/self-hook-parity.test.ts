/**
 * Parity proof for `spur self hook <id>` (script-absorption plan PR-2a, §5).
 *
 * The same fixture stdin payloads are fed to the **old** plugin hook file
 * (`bun plugins/sp/hooks/<id>.ts`) and to the **new** transport
 * (`bun apps/cli/src/index.ts self hook <id> --host <host>`), each in its own identical scratch
 * project, and the test asserts byte-identical stdout, identical exit codes and identical side
 * effects (context-ledger rows, the session pointer, and the argv every `spur` child received).
 *
 * - Claude and Codex hosts: compared against the plugin hook files.
 * - Pi host: compared against the Pi extension's real handlers (`hooks/pi/guard-extension.ts`),
 *   mapping `{block, reason}` ↔ `{"action":"deny"}`, `ctx.ui.confirm(msg)` ↔ `{"action":"ask"}`
 *   and `{}` ↔ `{"action":"allow"}`.
 * - Intentional divergences are pinned explicitly: the plugin guards crash (exit 1, stack trace)
 *   on a non-object payload or a non-string field; the new transport fails open as documented.
 *
 * `spur` children run through a fake `spur` (on PATH and as `SPUR_BIN`) that records its argv,
 * so both sides' CLI calls are compared without a real fleet or task corpus.
 * Set `SPUR_HOOK_PARITY_REPORT=<file>` to write one JSON line per compared fixture.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
    appendFileSync,
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
import { getEnvVar, setEnvVar } from '@gobing-ai/spur-config';

const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..');
const CLI = join(REPO_ROOT, 'apps', 'cli', 'src', 'index.ts');
const PLUGIN_HOOKS = join(REPO_ROOT, 'plugins', 'sp', 'hooks');
const REPORT = getEnvVar('SPUR_HOOK_PARITY_REPORT');

const FAKE_SPUR = `#!/bin/sh
echo "$*" >> "$FAKE_SPUR_LOG"
case "$1 $2" in
  "task resolve") case "$3" in *owned*) echo '{"wbs":"0001"}'; exit 0;; *) exit 1;; esac;;
  "agent wait") if [ "$FAKE_QUEUED" = 1 ]; then exit 0; else exit 1; fi;;
  "message inbox") echo '[{"from_id":"lead","body":"please   do X","status":"queued"},{"from_id":"x","body":"old","status":"read"}]'; exit 0;;
  "agent report") exit 0;;
esac
exit 1
`;

let root: string;
let fakeDir: string;

beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'spur-hook-parity-')));
    fakeDir = join(root, 'bin');
    mkdirSync(fakeDir);
    writeFileSync(join(fakeDir, 'spur'), FAKE_SPUR);
    chmodSync(join(fakeDir, 'spur'), 0o755);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

type Host = 'claude' | 'codex' | 'pi';

interface Step {
    id: string;
    stdin: string;
    env?: Record<string, string>;
}

interface Side {
    project: string;
    log: string;
}

function makeSide(label: string, guest: boolean): Side {
    const project = join(root, label);
    mkdirSync(join(project, '.spur', 'context'), { recursive: true });
    if (guest) {
        mkdirSync(join(project, '.spur', 'run', 'guests'), { recursive: true });
        writeFileSync(
            join(project, '.spur', 'run', 'guests', 'proj-g.json'),
            JSON.stringify({ id: 'proj-g', sessionId: 'sess-joined' }),
        );
    }
    return { project, log: join(project, 'spur-argv.log') };
}

function childEnv(side: Side, host: Host, extra: Record<string, string> = {}): Record<string, string> {
    return {
        PATH: `${fakeDir}:${getEnvVar('PATH') ?? ''}`,
        HOME: getEnvVar('HOME') ?? '',
        SPUR_BIN: join(fakeDir, 'spur'),
        FAKE_SPUR_LOG: side.log,
        ...(host === 'claude' ? { CLAUDE_PROJECT_DIR: side.project } : {}),
        ...extra,
    };
}

async function spawnHook(argv: string[], side: Side, host: Host, step: Step) {
    const proc = Bun.spawn(argv, {
        cwd: side.project,
        stdin: new TextEncoder().encode(step.stdin),
        stdout: 'pipe',
        stderr: 'pipe',
        env: childEnv(side, host, step.env),
    });
    const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    return { stdout, stderr, exitCode };
}

const oldArgv = (id: string) => [process.execPath, join(PLUGIN_HOOKS, `${id}.ts`)];
const newArgv = (id: string, host: Host) => [process.execPath, CLI, 'self', 'hook', id, '--host', host];

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const SESSION = /session-\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]{8}/g;

/** Side-effect snapshot with run-specific values (time, minted ids, paths, seq) normalized. */
async function snapshot(side: Side, waitForLog = 0): Promise<Record<string, unknown>> {
    for (let i = 0; i < waitForLog && !existsSync(side.log); i++) await Bun.sleep(50);
    const read = (path: string) => (existsSync(path) ? readFileSync(path, 'utf-8') : null);
    const norm = (text: string | null) =>
        text === null
            ? null
            : text
                  .replaceAll(side.project, '<PROJECT>')
                  .replace(ISO, '<TS>')
                  .replace(SESSION, '<SESSION>')
                  .replace(/--seq \d+/g, '--seq <SEQ>')
                  .replace(/"(durationMs|elapsedMs)":\d+/g, '"$1":0');
    return {
        ledger: norm(read(join(side.project, '.spur', 'context', 'token-ledger.jsonl'))),
        pointer: norm(read(join(side.project, '.spur', 'context', '.session.json'))),
        spurArgv: norm(read(side.log)),
        db: existsSync(join(side.project, '.spur', 'spur.db')),
    };
}

function report(entry: Record<string, unknown>): void {
    if (REPORT !== undefined) appendFileSync(REPORT, `${JSON.stringify(entry)}\n`);
}

/** Run a fixture's steps through both sides; assert per-step stdout/exit parity and final side effects. */
async function assertParity(
    name: string,
    host: Exclude<Host, 'pi'>,
    steps: Step[],
    opts: { guest?: boolean; waitForLog?: number } = {},
): Promise<{ stdout: string[]; effects: Record<string, unknown> }> {
    const outputs: string[] = [];
    const key = `${host}-${name}`.replace(/[^a-z0-9-]+/gi, '_');
    const oldSide = makeSide(`old-${key}`, opts.guest === true);
    const newSide = makeSide(`new-${key}`, opts.guest === true);
    for (const step of steps) {
        const [before, after] = await Promise.all([
            spawnHook(oldArgv(step.id), oldSide, host, step),
            spawnHook(newArgv(step.id, host), newSide, host, step),
        ]);
        expect({ step: step.id, stdout: after.stdout, exitCode: after.exitCode }).toEqual({
            step: step.id,
            stdout: before.stdout,
            exitCode: before.exitCode,
        });
        expect(after.stderr).toBe('');
        outputs.push(after.stdout);
        report({
            host,
            fixture: name,
            id: step.id,
            exitCode: after.exitCode,
            stdoutBytes: after.stdout.length,
            identical: true,
        });
    }
    const [a, b] = await Promise.all([snapshot(oldSide, opts.waitForLog), snapshot(newSide, opts.waitForLog)]);
    expect(b.db).toBe(false);
    expect({ ...b, db: a.db } as Record<string, unknown>).toEqual(a);
    return { stdout: outputs, effects: b };
}

/** Guard fixtures name their expected decision after the arrow (`… → deny`). */
async function assertGuardParity(name: string, host: Exclude<Host, 'pi'>, step: Step): Promise<void> {
    const { stdout } = await assertParity(name, host, [step]);
    const decision = /→ (allow|deny|ask)/.exec(name)?.[1];
    expect(stdout[0]).toContain(`"permissionDecision":"${decision}"`);
}

const write = (path: string, tool = 'Write') => JSON.stringify({ tool_name: tool, tool_input: { file_path: path } });
const bash = (command: string) => JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
const TIMEOUT = 30_000;

describe('parity: task-write-guard (claude, codex)', () => {
    const fixtures: Array<[string, Step]> = [
        ['owned task file → deny', { id: 'task-write-guard', stdin: write('docs/tasks/0001_owned.md') }],
        [
            'unowned task-shaped name → allow (probed)',
            { id: 'task-write-guard', stdin: write('docs/tasks/0002_free.md', 'Edit') },
        ],
        ['source file → allow (no probe)', { id: 'task-write-guard', stdin: write('src/index.ts') }],
        ['non-write tool → allow', { id: 'task-write-guard', stdin: write('docs/tasks/0001_owned.md', 'Read') }],
        ['empty path → allow', { id: 'task-write-guard', stdin: write('') }],
        ['empty stdin → allow', { id: 'task-write-guard', stdin: '' }],
        ['malformed stdin → allow', { id: 'task-write-guard', stdin: '{nope' }],
        [
            'SPUR_WRITE_GUARD=off → allow',
            { id: 'task-write-guard', stdin: write('docs/tasks/0001_owned.md'), env: { SPUR_WRITE_GUARD: 'off' } },
        ],
    ];
    for (const host of ['claude', 'codex'] as const) {
        for (const [name, step] of fixtures) {
            test(`${host}: ${name}`, () => assertGuardParity(name, host, step), TIMEOUT);
        }
    }
});

describe('parity: careful-guard (claude, codex)', () => {
    const fixtures: Array<[string, Step]> = [
        ['rm -rf / → ask', { id: 'careful-guard', stdin: bash('rm -rf /') }],
        ['git push --force → ask', { id: 'careful-guard', stdin: bash('git push --force origin main') }],
        ['DROP TABLE → ask', { id: 'careful-guard', stdin: bash('psql -c "DROP TABLE users"') }],
        ['rm -rf node_modules → allow', { id: 'careful-guard', stdin: bash('rm -rf node_modules') }],
        ['ls → allow', { id: 'careful-guard', stdin: bash('ls -la') }],
        ['blank command → allow', { id: 'careful-guard', stdin: bash('   ') }],
        ['non-Bash tool → allow', { id: 'careful-guard', stdin: write('a.ts') }],
        ['malformed stdin → allow', { id: 'careful-guard', stdin: 'not json' }],
        ['SPUR_CAREFUL=off → allow', { id: 'careful-guard', stdin: bash('rm -rf /'), env: { SPUR_CAREFUL: 'off' } }],
    ];
    for (const host of ['claude', 'codex'] as const) {
        for (const [name, step] of fixtures) {
            test(`${host}: ${name}`, () => assertGuardParity(name, host, step), TIMEOUT);
        }
    }
});

describe('parity: context ledger (claude, codex)', () => {
    const sequence: Step[] = [
        {
            id: 'context-session-start',
            stdin: JSON.stringify({ session_id: 'host-1', hook_event_name: 'SessionStart' }),
        },
        {
            id: 'context-post-tool',
            stdin: JSON.stringify({
                session_id: 'host-1',
                tool_name: 'Write',
                tool_input: { file_path: 'a.ts', content: 'export const a = 1;\n' },
            }),
        },
        {
            id: 'context-post-tool',
            stdin: JSON.stringify({
                session_id: 'host-1',
                tool_name: 'Bash',
                tool_input: { command: 'curl -H "Authorization: Bearer abc123" https://x' },
                tool_response: { stdout: 'ok' },
            }),
        },
        {
            id: 'context-post-tool',
            stdin: JSON.stringify({ tool_name: 'Grep', tool_input: { pattern: 'TODO', path: 'src' } }),
        },
        { id: 'context-post-tool', stdin: JSON.stringify({ tool_name: 'WebFetch', tool_input: {} }) },
        { id: 'context-post-tool', stdin: '{malformed' },
        { id: 'context-session-start', stdin: JSON.stringify({ session_id: 'nested-child' }) },
        { id: 'context-session-stop', stdin: JSON.stringify({ session_id: 'someone-else' }) },
        { id: 'context-session-stop', stdin: JSON.stringify({ session_id: 'host-1' }) },
    ];
    for (const host of ['claude', 'codex'] as const) {
        test(
            `${host}: start → tool events → foreign stop → owner stop`,
            async () => {
                const { effects } = await assertParity('ledger sequence', host, sequence);
                const types = String(effects.ledger)
                    .split('\n')
                    .filter(Boolean)
                    .map((line) => (JSON.parse(line) as { type: string }).type);
                expect(types).toEqual(['session_start', 'write', 'bash', 'grep', 'session_end']);
                expect(effects.pointer).toBeNull();
            },
            TIMEOUT,
        );
    }
    test(
        'claude: empty/malformed starts open an ownerless session; stop without pointer is a no-op',
        () =>
            assertParity('ownerless', 'claude', [
                { id: 'context-session-stop', stdin: '' },
                { id: 'context-session-start', stdin: '' },
                { id: 'context-session-start', stdin: 'garbage' },
                { id: 'context-session-stop', stdin: 'garbage' },
            ]),
        TIMEOUT,
    );
    test(
        'claude: SPUR_RUN_ID reuse and CLAUDE_CODE_SESSION_ID owner fallback',
        () =>
            assertParity('nested run', 'claude', [
                { id: 'context-session-start', stdin: '{}', env: { CLAUDE_CODE_SESSION_ID: 'env-owner' } },
                { id: 'context-session-start', stdin: '{}', env: { SPUR_RUN_ID: 'run-9' } },
                { id: 'context-session-stop', stdin: '{}', env: { CLAUDE_CODE_SESSION_ID: 'env-owner' } },
            ]),
        TIMEOUT,
    );
});

describe('parity: agent-lifecycle (claude, codex)', () => {
    const fleet = { SPUR_SPEC_ID: 'proj-worker-1' };
    const event = (name: string, extra: Record<string, unknown> = {}) =>
        JSON.stringify({ hook_event_name: name, ...extra });
    const fixtures: Array<[string, Step, number]> = [
        ['SessionStart in fleet → idle', { id: 'agent-lifecycle', stdin: event('SessionStart'), env: fleet }, 60],
        ['UserPromptSubmit → working', { id: 'agent-lifecycle', stdin: event('UserPromptSubmit'), env: fleet }, 60],
        [
            'permission_prompt → blocked',
            {
                id: 'agent-lifecycle',
                stdin: event('Notification', { notification_type: 'permission_prompt' }),
                env: fleet,
            },
            60,
        ],
        ['Stop → idle', { id: 'agent-lifecycle', stdin: event('Stop'), env: fleet }, 60],
        [
            'idle_prompt → nothing',
            { id: 'agent-lifecycle', stdin: event('Notification', { notification_type: 'idle_prompt' }), env: fleet },
            0,
        ],
        ['outside a fleet → nothing', { id: 'agent-lifecycle', stdin: event('Stop') }, 0],
        ['malformed → nothing', { id: 'agent-lifecycle', stdin: '{x', env: fleet }, 0],
    ];
    for (const host of ['claude', 'codex'] as const) {
        for (const [name, step, wait] of fixtures) {
            test(
                `${host}: ${name}`,
                async () => {
                    const { effects } = await assertParity(name, host, [step], { waitForLog: wait * 4 });
                    if (wait > 0) {
                        expect(String(effects.spurArgv)).toMatch(
                            /^agent report --state (idle|working|blocked) --seq <SEQ>\n$/,
                        );
                    } else {
                        expect(effects.spurArgv).toBeNull();
                    }
                },
                TIMEOUT,
            );
        }
    }
});

describe('parity: fleet-guest-stop (claude, codex)', () => {
    const fixtures: Array<[string, Step]> = [
        [
            'joined + queued → block',
            { id: 'fleet-guest-stop', stdin: JSON.stringify({ session_id: 'sess-joined' }), env: { FAKE_QUEUED: '1' } },
        ],
        [
            'joined + nothing queued → silent',
            { id: 'fleet-guest-stop', stdin: JSON.stringify({ session_id: 'sess-joined' }) },
        ],
        [
            'not joined → silent, no CLI call',
            { id: 'fleet-guest-stop', stdin: JSON.stringify({ session_id: 'other' }), env: { FAKE_QUEUED: '1' } },
        ],
        [
            'stop_hook_active → silent',
            {
                id: 'fleet-guest-stop',
                stdin: JSON.stringify({ session_id: 'sess-joined', stop_hook_active: true }),
                env: { FAKE_QUEUED: '1' },
            },
        ],
        ['malformed → silent', { id: 'fleet-guest-stop', stdin: 'nope' }],
    ];
    for (const host of ['claude', 'codex'] as const) {
        for (const [name, step] of fixtures) {
            test(
                `${host}: ${name}`,
                async () => {
                    const { stdout } = await assertParity(name, host, [step], { guest: true });
                    if (name.includes('→ block')) {
                        expect(JSON.parse(stdout[0] ?? '')).toMatchObject({ decision: 'block' });
                    } else {
                        expect(stdout[0]).toBe('');
                    }
                },
                TIMEOUT,
            );
        }
    }
});

describe('pinned divergences (plugin crashes, transport fails open)', () => {
    const cases: Array<[string, Step, string]> = [
        [
            'write guard: JSON null',
            { id: 'task-write-guard', stdin: 'null' },
            '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}',
        ],
        [
            'write guard: numeric file_path',
            { id: 'task-write-guard', stdin: '{"tool_name":"Write","tool_input":{"file_path":5}}' },
            '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}',
        ],
        [
            'careful guard: JSON null',
            { id: 'careful-guard', stdin: 'null' },
            '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}',
        ],
        [
            'careful guard: numeric command',
            { id: 'careful-guard', stdin: '{"tool_name":"Bash","tool_input":{"command":5}}' },
            '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}',
        ],
    ];
    for (const [name, step, expected] of cases) {
        test(
            name,
            async () => {
                const side = makeSide(`div-${name.replace(/[^a-z0-9]+/gi, '_')}`, false);
                const [before, after] = await Promise.all([
                    spawnHook(oldArgv(step.id), side, 'claude', step),
                    spawnHook(newArgv(step.id, 'claude'), side, 'claude', step),
                ]);
                expect(before.exitCode).toBe(1);
                expect(before.stderr).toContain('TypeError');
                expect(after).toEqual({ stdout: expected, stderr: '', exitCode: 0 });
                report({
                    host: 'claude',
                    fixture: name,
                    id: step.id,
                    divergence: 'plugin exit 1 (TypeError) → transport allow, exit 0',
                });
            },
            TIMEOUT,
        );
    }
});

// ─── Pi: the extension's real handlers vs `spur self hook --host pi` ─────────

type PiHandler = (event: unknown, ctx: unknown) => Promise<unknown>;

async function loadExtension(): Promise<Map<string, PiHandler>> {
    const mod = (await import(join(PLUGIN_HOOKS, 'pi', 'guard-extension.ts'))) as { default: (pi: unknown) => void };
    const handlers = new Map<string, PiHandler>();
    mod.default({ on: (event: string, fn: PiHandler) => handlers.set(event, fn) });
    return handlers;
}

/** Run one extension handler with cwd and env pinned to `side`, returning its normalized verdict. */
async function piOld(
    handlers: Map<string, PiHandler>,
    piEvent: string,
    event: Record<string, unknown>,
    side: Side,
    env: Record<string, string> = {},
) {
    const vars = childEnv(side, 'pi', env);
    const saved = new Map(Object.keys(vars).map((key) => [key, getEnvVar(key)]));
    const savedSpec = getEnvVar('SPUR_SPEC_ID');
    if (env.SPUR_SPEC_ID === undefined) setEnvVar('SPUR_SPEC_ID', undefined);
    for (const [key, value] of Object.entries(vars)) setEnvVar(key, value);
    const previous = process.cwd();
    process.chdir(side.project);
    let asked: string | undefined;
    try {
        const ctx = {
            sessionManager: { getSessionId: () => (typeof event.sessionId === 'string' ? event.sessionId : '') },
            ui: {
                notify: () => {},
                confirm: async (_title: string, message: string) => {
                    asked = message;
                    return false;
                },
            },
        };
        const result = (await handlers.get(piEvent)?.(event, ctx)) as { block?: boolean; reason?: string } | undefined;
        if (asked !== undefined) return { action: 'ask', reason: asked };
        if (result?.block === true) return { action: 'deny', reason: result.reason };
        return { action: 'allow' };
    } finally {
        process.chdir(previous);
        for (const [key, value] of saved) setEnvVar(key, value);
        setEnvVar('SPUR_SPEC_ID', savedSpec);
    }
}

describe('parity: Pi host (extension handlers vs --host pi)', () => {
    let handlers: Map<string, PiHandler>;
    beforeAll(async () => {
        handlers = await loadExtension();
    });

    const guardCases: Array<[string, string, Record<string, unknown>, Record<string, string>?]> = [
        [
            'write to owned task → deny',
            'task-write-guard',
            { toolName: 'write', input: { path: 'docs/tasks/0001_owned.md' } },
        ],
        [
            'edit to unowned task name → allow',
            'task-write-guard',
            { toolName: 'edit', input: { path: 'docs/tasks/0002_free.md' } },
        ],
        ['write to source → allow', 'task-write-guard', { toolName: 'write', input: { path: 'src/a.ts' } }],
        [
            'write guard off → allow',
            'task-write-guard',
            { toolName: 'write', input: { path: 'docs/tasks/0001_owned.md' } },
            { SPUR_WRITE_GUARD: 'off' },
        ],
        ['bash rm -rf / → ask', 'careful-guard', { toolName: 'bash', input: { command: 'rm -rf /' } }],
        [
            'bash git reset --hard → ask',
            'careful-guard',
            { toolName: 'bash', input: { command: 'git reset --hard HEAD~3' } },
        ],
        ['bash ls → allow', 'careful-guard', { toolName: 'bash', input: { command: 'ls' } }],
        [
            'careful off → allow',
            'careful-guard',
            { toolName: 'bash', input: { command: 'rm -rf /' } },
            { SPUR_CAREFUL: 'off' },
        ],
    ];
    for (const [name, id, event, env] of guardCases) {
        test(
            `pi: ${name}`,
            async () => {
                const side = makeSide(`pi-${name.replace(/[^a-z0-9]+/gi, '_')}`, false);
                // Only one guard runs per extension tool_call, so each case isolates its guard.
                const before = await piOld(handlers, 'tool_call', event, side, env);
                const after = await spawnHook(newArgv(id, 'pi'), side, 'pi', { id, stdin: JSON.stringify(event), env });
                expect(after.exitCode).toBe(0);
                expect(JSON.parse(after.stdout)).toEqual(before);
                report({ host: 'pi', fixture: name, id, verdict: before, identical: true });
            },
            TIMEOUT,
        );
    }

    test(
        'pi: session_start → tool_result → session_shutdown ledgers are identical',
        async () => {
            const oldSide = makeSide('pi-ledger-old', false);
            const newSide = makeSide('pi-ledger-new', false);
            const steps: Array<[string, string, Record<string, unknown>]> = [
                ['session_start', 'context-session-start', { event: 'session_start', sessionId: 'pi-sess' }],
                [
                    'tool_result',
                    'context-post-tool',
                    {
                        toolName: 'bash',
                        input: { command: 'ls' },
                        content: [{ type: 'text', text: 'a\nb' }],
                        sessionId: 'pi-sess',
                    },
                ],
                [
                    'tool_result',
                    'context-post-tool',
                    { toolName: 'read', input: { path: 'README.md' }, content: 'hello', sessionId: 'pi-sess' },
                ],
                ['tool_result', 'context-post-tool', { toolName: 'web_search', input: {}, sessionId: 'pi-sess' }],
                ['session_shutdown', 'context-session-stop', { event: 'session_shutdown', sessionId: 'pi-sess' }],
            ];
            for (const [piEvent, id, event] of steps) {
                await piOld(handlers, piEvent, event, oldSide);
                const after = await spawnHook(newArgv(id, 'pi'), newSide, 'pi', { id, stdin: JSON.stringify(event) });
                expect(after).toEqual({ stdout: '', stderr: '', exitCode: 0 });
            }
            const [a, b] = await Promise.all([snapshot(oldSide), snapshot(newSide)]);
            expect(b).toEqual(a);
            expect(String(a.ledger).split('\n').filter(Boolean)).toHaveLength(4);
            report({ host: 'pi', fixture: 'ledger sequence', id: 'context-*', identical: true });
        },
        TIMEOUT,
    );

    test(
        'pi: agent_start in a fleet reports working through the same CLI argv',
        async () => {
            const oldSide = makeSide('pi-life-old', false);
            const newSide = makeSide('pi-life-new', false);
            const env = { SPUR_SPEC_ID: 'proj-worker-1' };
            await piOld(handlers, 'agent_start', { event: 'agent_start' }, oldSide, env);
            const after = await spawnHook(newArgv('agent-lifecycle', 'pi'), newSide, 'pi', {
                id: 'agent-lifecycle',
                stdin: JSON.stringify({ event: 'agent_start' }),
                env,
            });
            expect(after.exitCode).toBe(0);
            const [a, b] = await Promise.all([snapshot(oldSide, 200), snapshot(newSide, 200)]);
            expect(b.spurArgv).toBe('agent report --state working --seq <SEQ>\n');
            expect(b).toEqual(a);
            report({ host: 'pi', fixture: 'agent_start', id: 'agent-lifecycle', identical: true });
        },
        TIMEOUT,
    );
});
