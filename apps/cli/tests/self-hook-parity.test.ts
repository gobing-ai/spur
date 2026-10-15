/**
 * Parity proof for `spur self hook <id>` against the **retired** sp hook implementation
 * (script-absorption plan PR-2a/PR-2b, §5).
 *
 * PR-2a compared the old plugin hook files and the new transport side by side. PR-2b deleted the
 * old files, so their observable behavior was frozen first: `fixtures/self-hook-golden.json` holds
 * the old side's stdout, exit codes and normalized side effects (context-ledger rows, the session
 * pointer, the argv every `spur` child received) for every fixture below, captured from the old
 * implementation at the commit named in its `_meta` while the PR-2a suite passed 76/76.
 *
 * Routes asserted against that golden output:
 * - **direct** — `bun apps/cli/src/index.ts self hook <id> --host <claude|codex>` (what superskill S-1
 *   and every other host call).
 * - **shim** — the three `hooks/context-*.ts` transition shims, imported and called exactly as
 *   released superskill (≤0.3.37) does; they forward to `spur self hook` (`@transition-shim`).
 * - **pi** — the thin Pi extension's real handlers, in-process, mapping `{block, reason}` ↔ deny,
 *   `ctx.ui.confirm(msg)` ↔ ask and `{}` ↔ allow.
 * Intentional divergences stay pinned: the old guards crashed (exit 1, TypeError) on a non-object
 * payload or non-string field; the transport fails open.
 *
 * `spur` is a fake (on PATH and as `SPUR_BIN`) that records its argv and `exec`s the real CLI for
 * `self hook` (the shim and Pi hops), so the CLI calls the transport makes in turn are compared
 * without a real fleet or task corpus; the `self hook` hop lines themselves are not part of the
 * golden effects. Set `SPUR_HOOK_PARITY_REPORT=<file>` to write one JSON line per fixture.
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
import guardExtension from '../../../plugins/sp/hooks/pi/guard-extension';
import golden from './fixtures/self-hook-golden.json';

const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..');
const CLI = join(REPO_ROOT, 'apps', 'cli', 'src', 'index.ts');
const PLUGIN_HOOKS = join(REPO_ROOT, 'plugins', 'sp', 'hooks');
const REPORT = getEnvVar('SPUR_HOOK_PARITY_REPORT');

interface GoldenRun {
    steps: Array<{ id: string; stdout: string; exitCode: number }>;
    effects: Record<string, unknown>;
}
const GOLDEN = golden as unknown as {
    hosts: Record<string, GoldenRun>;
    divergences: Record<string, Record<string, unknown>>;
    pi: Record<string, unknown>;
};

const FAKE_SPUR = `#!/bin/sh
echo "$*" >> "$FAKE_SPUR_LOG"
case "$1 $2" in
  "self hook") exec "${process.execPath}" "${CLI}" "$@";;
  "task resolve") case "$3" in *owned*) echo '{"wbs":"0001"}'; exit 0;; *) exit 1;; esac;;
  "agent wait") if [ "$FAKE_QUEUED" = 1 ]; then exit 0; else exit 1; fi;;
  "message inbox") echo '[{"from_id":"lead","body":"please   do X","status":"queued"},{"from_id":"x","body":"old","status":"read"}]'; exit 0;;
  "agent report") exit 0;;
esac
exit 1
`;

/** Calls a context shim the way superskill's `loadSpPluginDelegate` does: import, then call the export. */
const SHIM_RUNNER = `import { join } from 'node:path';
const [id, hooks, project] = Bun.argv.slice(2);
const text = await Bun.stdin.text();
try {
    if (id === 'context-session-start') (await import(join(hooks, 'context-session-start.ts'))).recordSessionStartFromPayloadText(text);
    if (id === 'context-session-stop') (await import(join(hooks, 'context-session-stop.ts'))).recordSessionEndFromPayloadText(text);
    if (id === 'context-post-tool') (await import(join(hooks, 'context-post-tool.ts'))).recordToolUseEvent(join(project, '.spur', 'context'), JSON.parse(text));
} catch {}
`;

let root: string;
let fakeDir: string;
let shimRunner: string;

beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'spur-hook-parity-')));
    fakeDir = join(root, 'bin');
    mkdirSync(fakeDir);
    writeFileSync(join(fakeDir, 'spur'), FAKE_SPUR);
    chmodSync(join(fakeDir, 'spur'), 0o755);
    shimRunner = join(root, 'shim-runner.ts');
    writeFileSync(shimRunner, SHIM_RUNNER);
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

type Host = 'claude' | 'codex' | 'pi';
type Route = 'direct' | 'shim';

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

const newArgv = (id: string, host: Host) => [process.execPath, CLI, 'self', 'hook', id, '--host', host];
const shimArgv = (id: string, side: Side) => [process.execPath, shimRunner, id, PLUGIN_HOOKS, side.project];

const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const SESSION = /session-\d{4}-\d{2}-\d{2}-\d{6}-[0-9a-f]{8}/g;

/** Side-effect snapshot normalized like the golden capture; `self hook` transport hops are dropped. */
async function snapshot(side: Side, waitForLog = 0): Promise<Record<string, unknown>> {
    const read = (path: string) => (existsSync(path) ? readFileSync(path, 'utf-8') : null);
    const argvLog = (): string | null => {
        const lines = (read(side.log) ?? '')
            .split('\n')
            .filter((line) => line !== '' && !line.startsWith('self hook '));
        return lines.length > 0 ? `${lines.join('\n')}\n` : null;
    };
    for (let i = 0; i < waitForLog && argvLog() === null; i++) await Bun.sleep(50);
    const norm = (text: string | null) =>
        text === null
            ? null
            : text
                  .replaceAll(side.project, '<PROJECT>')
                  .replace(ISO, '<TS>')
                  .replace(SESSION, '<SESSION>')
                  .replace(/--seq \d+/g, '--seq <SEQ>')
                  .replace(/"(durationMs|elapsedMs)":\d+/g, '"$1":0');
    expect(existsSync(join(side.project, '.spur', 'spur.db'))).toBe(false);
    return {
        ledger: norm(read(join(side.project, '.spur', 'context', 'token-ledger.jsonl'))),
        pointer: norm(read(join(side.project, '.spur', 'context', '.session.json'))),
        spurArgv: norm(argvLog()),
    };
}

function report(entry: Record<string, unknown>): void {
    if (REPORT !== undefined) appendFileSync(REPORT, `${JSON.stringify(entry)}\n`);
}

/** Run a fixture's steps through one route; assert per-step stdout/exit and final effects equal golden. */
async function assertGolden(
    name: string,
    host: Exclude<Host, 'pi'>,
    steps: Step[],
    opts: { guest?: boolean; waitForLog?: number; route?: Route } = {},
): Promise<{ stdout: string[]; effects: Record<string, unknown> }> {
    const route = opts.route ?? 'direct';
    const key = `${host}|${steps[0]?.id}|${name}`;
    const expected = GOLDEN.hosts[key];
    if (expected === undefined) throw new Error(`no golden entry for ${key}`);
    expect(expected.steps.map((s) => s.id)).toEqual(steps.map((s) => s.id));
    const side = makeSide(`${route}-${host}-${name}`.replace(/[^a-z0-9-]+/gi, '_'), opts.guest === true);
    const outputs: string[] = [];
    for (const [i, step] of steps.entries()) {
        const want = expected.steps[i] as GoldenRun['steps'][number];
        const after = await spawnHook(
            route === 'shim' ? shimArgv(step.id, side) : newArgv(step.id, host),
            side,
            host,
            step,
        );
        if (route === 'direct') {
            expect({ step: step.id, stdout: after.stdout, exitCode: after.exitCode }).toEqual({
                step: step.id,
                stdout: want.stdout,
                exitCode: want.exitCode,
            });
        } else {
            // A shim prints nothing and never fails its importer; capture ids printed nothing before either.
            expect({ stdout: after.stdout, exitCode: after.exitCode, golden: want.stdout }).toEqual({
                stdout: '',
                exitCode: 0,
                golden: '',
            });
        }
        expect(after.stderr).toBe('');
        outputs.push(after.stdout);
        report({ host, route, fixture: name, id: step.id, exitCode: after.exitCode, matchesGolden: true });
    }
    const effects = await snapshot(side, opts.waitForLog);
    expect(effects).toEqual(expected.effects);
    return { stdout: outputs, effects };
}

/** Guard fixtures name their expected decision after the arrow (`… → deny`). */
async function assertGuardGolden(name: string, host: Exclude<Host, 'pi'>, step: Step): Promise<void> {
    const { stdout } = await assertGolden(name, host, [step]);
    const decision = /→ (allow|deny|ask)/.exec(name)?.[1];
    expect(stdout[0]).toContain(`"permissionDecision":"${decision}"`);
}

const write = (path: string, tool = 'Write') => JSON.stringify({ tool_name: tool, tool_input: { file_path: path } });
const bash = (command: string) => JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
const TIMEOUT = 30_000;

test('the golden file covers every fixture and records its provenance', () => {
    expect(Object.keys(GOLDEN.hosts)).toHaveLength(62);
    expect(Object.keys(GOLDEN.divergences)).toHaveLength(4);
    expect(Object.keys(GOLDEN.pi).sort()).toContain('ledger');
    expect((golden as { _meta: { capturedFrom: string } })._meta.capturedFrom).toContain('cbad976aa');
});

describe('golden: task-write-guard (claude, codex)', () => {
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
            test(`${host}: ${name}`, () => assertGuardGolden(name, host, step), TIMEOUT);
        }
    }
});

describe('golden: careful-guard (claude, codex)', () => {
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
            test(`${host}: ${name}`, () => assertGuardGolden(name, host, step), TIMEOUT);
        }
    }
});

describe('golden: context ledger (claude, codex)', () => {
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
                const { effects } = await assertGolden('ledger sequence', host, sequence);
                // superskill ≤0.3.37 reaches the same logic through the import shims.
                await assertGolden('ledger sequence', host, sequence, { route: 'shim' });
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
        async () => {
            const steps: Step[] = [
                { id: 'context-session-stop', stdin: '' },
                { id: 'context-session-start', stdin: '' },
                { id: 'context-session-start', stdin: 'garbage' },
                { id: 'context-session-stop', stdin: 'garbage' },
            ];
            await assertGolden('ownerless', 'claude', steps);
            await assertGolden('ownerless', 'claude', steps, { route: 'shim' });
        },
        TIMEOUT,
    );
    test(
        'claude: SPUR_RUN_ID reuse and CLAUDE_CODE_SESSION_ID owner fallback',
        async () => {
            const steps: Step[] = [
                { id: 'context-session-start', stdin: '{}', env: { CLAUDE_CODE_SESSION_ID: 'env-owner' } },
                { id: 'context-session-start', stdin: '{}', env: { SPUR_RUN_ID: 'run-9' } },
                { id: 'context-session-stop', stdin: '{}', env: { CLAUDE_CODE_SESSION_ID: 'env-owner' } },
            ];
            await assertGolden('nested run', 'claude', steps);
            await assertGolden('nested run', 'claude', steps, { route: 'shim' });
        },
        TIMEOUT,
    );
});

describe('golden: agent-lifecycle (claude, codex)', () => {
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
                    const { effects } = await assertGolden(name, host, [step], { waitForLog: wait * 4 });
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

describe('golden: fleet-guest-stop (claude, codex)', () => {
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
                    const { stdout } = await assertGolden(name, host, [step], { guest: true });
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

describe('pinned divergences (the retired plugin crashed, the transport fails open)', () => {
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
                const golden = GOLDEN.divergences[name];
                expect(golden).toMatchObject({
                    id: step.id,
                    stdin: step.stdin,
                    oldExitCode: 1,
                    oldStderrContains: 'TypeError',
                });
                const after = await spawnHook(newArgv(step.id, 'claude'), side, 'claude', step);
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

// ─── Pi: the thin extension's real handlers vs golden ────────────────────

type PiHandler = (event: unknown, ctx: unknown) => Promise<unknown>;
const piHandlers = new Map<string, PiHandler>();
guardExtension({ on: (event: string, fn: PiHandler) => piHandlers.set(event, fn) } as unknown as Parameters<
    typeof guardExtension
>[0]);

/** Run one extension handler with cwd and env pinned to `side`, returning its normalized verdict. */
async function piNew(piEvent: string, event: Record<string, unknown>, side: Side, env: Record<string, string> = {}) {
    const vars = childEnv(side, 'pi', env);
    const saved = new Map([...Object.keys(vars), 'SPUR_SPEC_ID'].map((key) => [key, getEnvVar(key)]));
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
        const result = (await piHandlers.get(piEvent)?.(event, ctx)) as
            | { block?: boolean; reason?: string }
            | undefined;
        if (asked !== undefined) return { action: 'ask', reason: asked };
        if (result?.block === true)
            return { action: 'deny', reason: result.reason?.replaceAll(side.project, '<PROJECT>') };
        return { action: 'allow' };
    } finally {
        process.chdir(previous);
        for (const [key, value] of saved) setEnvVar(key, value);
    }
}

describe('golden: Pi host (thin extension handlers)', () => {
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
    for (const [name, , event, env] of guardCases) {
        test(
            `pi: ${name}`,
            async () => {
                const side = makeSide(`pi-${name.replace(/[^a-z0-9]+/gi, '_')}`, false);
                const verdict = await piNew('tool_call', event, side, env);
                expect(verdict as Record<string, unknown>).toEqual(
                    GOLDEN.pi[`guard|${name}`] as Record<string, unknown>,
                );
                report({ host: 'pi', fixture: name, verdict, matchesGolden: true });
            },
            TIMEOUT,
        );
    }

    test(
        'pi: session_start → tool_result → session_shutdown ledger matches golden',
        async () => {
            const side = makeSide('pi-ledger', false);
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
            for (const [piEvent, , event] of steps) await piNew(piEvent, event, side);
            const effects = await snapshot(side);
            expect(effects).toEqual(GOLDEN.pi.ledger as Record<string, unknown>);
            expect(String(effects.ledger).split('\n').filter(Boolean)).toHaveLength(4);
            report({ host: 'pi', fixture: 'ledger sequence', id: 'context-*', matchesGolden: true });
        },
        TIMEOUT,
    );

    test(
        'pi: agent_start in a fleet reports working through the same CLI argv',
        async () => {
            const side = makeSide('pi-life', false);
            await piNew('agent_start', { event: 'agent_start' }, side, { SPUR_SPEC_ID: 'proj-worker-1' });
            const effects = await snapshot(side, 200);
            expect(effects.spurArgv).toBe('agent report --state working --seq <SEQ>\n');
            expect(effects).toEqual(GOLDEN.pi.lifecycle as Record<string, unknown>);
            report({ host: 'pi', fixture: 'agent_start', id: 'agent-lifecycle', matchesGolden: true });
        },
        TIMEOUT,
    );
});
