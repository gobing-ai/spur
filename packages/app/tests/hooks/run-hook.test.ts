/**
 * `runSpurHook` — the registry/dispatcher behind `spur self hook <id>` (script-absorption PR-2a).
 * Host resolution, the `spur` child argv, each id's host shapes and the fail-open fallbacks.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HOOK_DEFINITIONS, HOOK_HOSTS, HOOK_IDS, hookSpurArgv, resolveHookHost, runSpurHook } from '../../src/hooks';
import type { HookRunInput } from '../../src/hooks/run-hook';

function project(): string {
    const dir = mkdtempSync(join(tmpdir(), 'spur-run-hook-'));
    mkdirSync(join(dir, '.spur', 'context'), { recursive: true });
    return dir;
}

function ledger(dir: string): Array<Record<string, unknown>> {
    const path = join(dir, '.spur', 'context', 'token-ledger.jsonl');
    if (!existsSync(path)) return [];
    return readFileSync(path, 'utf-8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function run(id: string, input: Partial<HookRunInput> & { stdin: string }) {
    return runSpurHook(id, { host: 'claude', env: {}, cwd: tmpdir(), ...input });
}

describe('registry', () => {
    test('registers the seven sp hook ids in hooks.json order with unique ids', () => {
        expect(HOOK_IDS).toEqual([
            'task-write-guard',
            'careful-guard',
            'context-post-tool',
            'context-session-start',
            'context-session-stop',
            'agent-lifecycle',
            'fleet-guest-stop',
        ]);
        for (const definition of HOOK_DEFINITIONS) {
            expect(definition.events.length).toBeGreaterThan(0);
            expect(existsSync(join(import.meta.dir, '../../../..', definition.pluginSource))).toBe(true);
        }
        expect(HOOK_HOSTS).toEqual(['claude', 'codex', 'pi', 'auto']);
    });

    test('every hooks.json `superskill hook run sp <id>` entry names a registered id', () => {
        const hooksJson = readFileSync(join(import.meta.dir, '../../../../plugins/sp/hooks/hooks.json'), 'utf-8');
        const wired = [...hooksJson.matchAll(/superskill hook run sp ([a-z-]+)/g)].map((match) => match[1]);
        expect(wired.length).toBeGreaterThan(0);
        for (const id of wired) expect(HOOK_IDS).toContain(id as string);
    });
});

describe('host and child resolution', () => {
    test('auto resolves to claude under Claude Code and codex otherwise; explicit hosts pass through', () => {
        expect(resolveHookHost('auto', { CLAUDE_PROJECT_DIR: '/p' })).toBe('claude');
        expect(resolveHookHost('auto', {})).toBe('codex');
        expect(resolveHookHost('pi', { CLAUDE_PROJECT_DIR: '/p' })).toBe('pi');
    });

    test('the spur child is SPUR_BIN split on spaces, else the running build, else bare spur', () => {
        expect(hookSpurArgv({ SPUR_BIN: 'bun /src/index.ts' }, ['/opt/spur'])).toEqual(['bun', '/src/index.ts']);
        expect(hookSpurArgv({ SPUR_BIN: '' }, ['/opt/spur'])).toEqual(['/opt/spur']);
        expect(hookSpurArgv({}, [])).toEqual(['spur']);
        expect(hookSpurArgv({})).toEqual(['spur']);
    });

    test('an unknown id exits 0 with no stdout and one stderr line', () => {
        const result = run('nope', { stdin: '{}' });
        expect(result).toMatchObject({ stdout: '', exitCode: 0, host: 'claude' });
        expect(result.stderr).toContain("unknown hook id 'nope'");
    });
});

describe('task-write-guard', () => {
    const owned = () => 'owned' as const;
    const write = (path: string) => JSON.stringify({ tool_name: 'Write', tool_input: { file_path: path } });

    test('claude: denies an owned task file with the plugin message, probing CLAUDE_PROJECT_DIR', () => {
        const probed: string[] = [];
        const result = run('task-write-guard', {
            stdin: write('docs/tasks/0001_x.md'),
            env: { CLAUDE_PROJECT_DIR: '/proj' },
            ownershipResolver: (_path, cwd) => {
                probed.push(cwd);
                return 'owned';
            },
        });
        const out = JSON.parse(result.stdout) as Record<string, unknown>;
        expect(out.hookSpecificOutput).toEqual({ hookEventName: 'PreToolUse', permissionDecision: 'deny' });
        expect(String(out.systemMessage)).toStartWith('docs/tasks/0001_x.md is a task file owned by the spur corpus.');
        expect(probed).toEqual(['/proj']);
    });

    test('claude: allows every fail-open path', () => {
        const allow = '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}';
        for (const stdin of ['not json', 'null', '{"tool_name":"Read"}', write(''), write('src/a.ts')]) {
            expect(run('task-write-guard', { stdin, ownershipResolver: owned }).stdout).toBe(allow);
        }
        expect(
            run('task-write-guard', {
                stdin: write('0001_x.md'),
                env: { SPUR_WRITE_GUARD: 'off' },
                ownershipResolver: owned,
            }).stdout,
        ).toBe(allow);
        expect(run('task-write-guard', { stdin: write('0001_x.md'), ownershipResolver: () => 'unknown' }).stdout).toBe(
            allow,
        );
    });

    test('pi: resolves relative paths against cwd and replies with {action, reason}', () => {
        const seen: string[] = [];
        const stdin = JSON.stringify({ toolName: 'edit', input: { path: 'docs/tasks/0002_y.md' } });
        const result = run('task-write-guard', {
            host: 'pi',
            stdin,
            cwd: '/work',
            ownershipResolver: (path) => {
                seen.push(path);
                return 'owned';
            },
        });
        expect(JSON.parse(result.stdout)).toEqual({
            action: 'deny',
            reason: "Denied: /work/docs/tasks/0002_y.md is a Spur task file. Use 'spur task update' instead.",
        });
        expect(seen).toEqual(['/work/docs/tasks/0002_y.md']);
        const viaFilePath = JSON.stringify({ toolName: 'write', input: { file_path: '/abs/0003_z.md' } });
        expect(
            JSON.parse(run('task-write-guard', { host: 'pi', stdin: viaFilePath, ownershipResolver: owned }).stdout),
        ).toEqual({
            action: 'deny',
            reason: "Denied: /abs/0003_z.md is a Spur task file. Use 'spur task update' instead.",
        });
    });

    test('pi: allows other tools, empty paths, non-task names, off and garbage', () => {
        const allow = '{"action":"allow"}';
        for (const stdin of [
            'garbage',
            JSON.stringify({ toolName: 'bash', input: {} }),
            JSON.stringify({ toolName: 'write', input: {} }),
            JSON.stringify({ toolName: 'write', input: { path: 'src/a.ts' } }),
        ]) {
            expect(run('task-write-guard', { host: 'pi', stdin, ownershipResolver: owned }).stdout).toBe(allow);
        }
        const task = JSON.stringify({ toolName: 'write', input: { path: '0001_x.md' } });
        expect(run('task-write-guard', { host: 'pi', stdin: task, env: { SPUR_WRITE_GUARD: 'off' } }).stdout).toBe(
            allow,
        );
    });

    test('a throwing resolver degrades to the host-shaped allow', () => {
        const boom = () => {
            throw new Error('boom');
        };
        expect(run('task-write-guard', { stdin: write('0001_x.md'), ownershipResolver: boom }).stdout).toBe(
            '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}',
        );
        const pi = JSON.stringify({ toolName: 'write', input: { path: '0001_x.md' } });
        expect(run('task-write-guard', { host: 'pi', stdin: pi, ownershipResolver: boom }).stdout).toBe(
            '{"action":"allow"}',
        );
    });
});

describe('careful-guard', () => {
    test('claude/codex: ask with reason in both fields; allow otherwise', () => {
        const ask = JSON.parse(
            run('careful-guard', {
                host: 'codex',
                stdin: '{"tool_name":"Bash","tool_input":{"command":"git reset --hard"}}',
            }).stdout,
        ) as { hookSpecificOutput: Record<string, unknown>; systemMessage: string };
        expect(ask.hookSpecificOutput.permissionDecision).toBe('ask');
        expect(ask.hookSpecificOutput.permissionDecisionReason).toBe(ask.systemMessage);
        const allow = '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}';
        for (const stdin of [
            'x',
            '{"tool_name":"Read"}',
            '{"tool_name":"Bash","tool_input":{"command":"  "}}',
            '{"tool_name":"Bash","tool_input":{"command":"ls"}}',
        ]) {
            expect(run('careful-guard', { stdin }).stdout).toBe(allow);
        }
        expect(
            run('careful-guard', {
                stdin: '{"tool_name":"Bash","tool_input":{"command":"git reset --hard"}}',
                env: { SPUR_CAREFUL: 'off' },
            }).stdout,
        ).toBe(allow);
    });

    test('pi: ask names the hit and the first 120 command chars; allow otherwise', () => {
        const command = `git push --force ${'x'.repeat(200)}`;
        const out = JSON.parse(
            run('careful-guard', { host: 'pi', stdin: JSON.stringify({ toolName: 'bash', input: { command } }) })
                .stdout,
        ) as { action: string; reason: string };
        expect(out.action).toBe('ask');
        expect(out.reason).toStartWith('Warning: destructive command — ');
        expect(out.reason.endsWith(command.slice(0, 120))).toBe(true);
        for (const stdin of ['x', '{"toolName":"read"}', '{"toolName":"bash","input":{}}']) {
            expect(run('careful-guard', { host: 'pi', stdin }).stdout).toBe('{"action":"allow"}');
        }
        const off = JSON.stringify({ toolName: 'bash', input: { command: 'git reset --hard' } });
        expect(run('careful-guard', { host: 'pi', stdin: off, env: { SPUR_CAREFUL: 'off' } }).stdout).toBe(
            '{"action":"allow"}',
        );
    });
});

describe('context capture', () => {
    test('claude: start → tool → stop writes a balanced, owned ledger under CLAUDE_PROJECT_DIR', () => {
        const dir = project();
        try {
            const env = { CLAUDE_PROJECT_DIR: dir };
            expect(run('context-session-start', { stdin: '{"session_id":"c-1"}', env }).stdout).toBe('');
            writeFileSync(join(dir, 'a.txt'), 'hello world');
            run('context-post-tool', {
                stdin: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: join(dir, 'a.txt') } }),
                env,
            });
            expect(run('context-post-tool', { stdin: 'not json', env })).toMatchObject({ stdout: '', stderr: '' });
            run('context-session-stop', { stdin: '{"session_id":"c-1"}', env });
            expect(ledger(dir).map((row) => row.type)).toEqual(['session_start', 'read', 'session_end']);
            expect(existsSync(join(dir, '.spur', 'context', '.session.json'))).toBe(false);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('pi: normalizes tool_result events, stamps the Pi session and gates stop on its owner', () => {
        const dir = project();
        try {
            const pi = (id: string, event: Record<string, unknown>) =>
                run(id, {
                    host: 'pi',
                    cwd: dir,
                    env: { CLAUDE_PROJECT_DIR: '/elsewhere' },
                    stdin: JSON.stringify(event),
                });
            pi('context-session-start', { event: 'session_start', sessionId: 'pi-1' });
            const pointer = JSON.parse(readFileSync(join(dir, '.spur', 'context', '.session.json'), 'utf-8')) as Record<
                string,
                unknown
            >;
            expect(pointer.owner).toEqual({ host: 'pi', sessionId: 'pi-1' });
            expect(pointer.agent).toBe('pi');
            pi('context-post-tool', {
                toolName: 'bash',
                input: { command: 'ls' },
                content: [{ text: 'a' }],
                sessionId: 'pi-1',
            });
            pi('context-post-tool', { toolName: 'bash', input: { command: 'pwd' } });
            pi('context-post-tool', { toolName: 'unknown-tool', input: {} });
            pi('context-session-stop', { event: 'session_shutdown', sessionId: 'someone-else' });
            expect(existsSync(join(dir, '.spur', 'context', '.session.json'))).toBe(true);
            pi('context-session-stop', { event: 'session_shutdown', sessionId: 'pi-1' });
            const rows = ledger(dir);
            expect(rows.map((row) => row.type)).toEqual(['session_start', 'bash', 'bash', 'session_end']);
            expect(rows[1]?.sessionId).toBe('pi-1');
            expect(rows[2]?.sessionId).toBeUndefined();
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('pi: an empty or garbage event degrades to an ownerless start and a no-op stop', () => {
        const dir = project();
        try {
            run('context-session-start', { host: 'pi', cwd: dir, stdin: 'garbage' });
            run('context-session-stop', { host: 'pi', cwd: dir, stdin: 'null' });
            expect(ledger(dir).map((row) => row.type)).toEqual(['session_start']);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('fleet-guest-stop', () => {
    function guestProject(): string {
        const dir = project();
        mkdirSync(join(dir, '.spur', 'run', 'guests'), { recursive: true });
        writeFileSync(
            join(dir, '.spur', 'run', 'guests', 'g.json'),
            JSON.stringify({ id: 'proj-g', sessionId: 's-1' }),
        );
        return dir;
    }

    test('claude: a joined session with queued mail gets a newline-terminated block decision', () => {
        const dir = guestProject();
        try {
            const calls: string[][] = [];
            const result = run('fleet-guest-stop', {
                stdin: '{"session_id":"s-1"}',
                env: { CLAUDE_PROJECT_DIR: dir },
                fleetCli: (args) => {
                    calls.push([...args]);
                    return args[0] === 'agent'
                        ? { status: 0, stdout: '' }
                        : { status: 0, stdout: JSON.stringify([{ from_id: 'lead', body: 'do X', status: 'queued' }]) };
                },
            });
            expect(result.stdout.endsWith('\n')).toBe(true);
            expect(JSON.parse(result.stdout)).toMatchObject({ decision: 'block' });
            expect(calls[0]?.slice(0, 3)).toEqual(['agent', 'wait', '--inbox']);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    test('claude: no queued work is silent; pi is always a no-op', () => {
        const dir = guestProject();
        try {
            const idle = () => ({ status: 1, stdout: '' });
            expect(run('fleet-guest-stop', { stdin: '{"session_id":"s-1"}', cwd: dir, fleetCli: idle }).stdout).toBe(
                '',
            );
            expect(run('fleet-guest-stop', { host: 'pi', stdin: '{"session_id":"s-1"}', cwd: dir }).stdout).toBe('');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
