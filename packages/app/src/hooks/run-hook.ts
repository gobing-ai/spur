/**
 * run-hook — the registry and dispatcher behind `spur self hook <id> [--host …]`.
 *
 * Script-absorption plan PR-2a (docs/plans/2026-10-14-spur-script-absorption.md §5.1). The CLI
 * layer reads stdin and prints {@link HookRunResult}; everything host-specific lives here so the
 * command placement (`self hook`) can move without touching hook behaviour.
 *
 * **Contract.** Every id exits 0. Guards print one host-shaped JSON decision; capture and
 * lifecycle ids print nothing; `fleet-guest-stop` prints a `decision:block` line only when a joined
 * guest has queued work. Any internal error degrades to the id's silent/allow outcome, never to a
 * non-zero exit — the same fail-open contract the plugin hook files carry. An unknown id is
 * reported on stderr and still exits 0, matching superskill's `hook run` for unknown ids.
 *
 * **`spur` children.** Three ids still talk to the CLI through a child process, exactly like the
 * plugin hooks: `task-write-guard` (`task resolve --strict --json`), `agent-lifecycle` (detached
 * `agent report`) and `fleet-guest-stop` (`agent wait --inbox`, `message inbox`). The child is
 * `SPUR_BIN` (split on spaces, as the plugin guards do) when set, otherwise {@link HookRunInput.selfArgv}
 * — the launch argv of the `spur` that is running the hook, so the child is the same build.
 */

import { join } from 'node:path';
import { reportLifecycleHook, runHookFromStdin } from './agent-lifecycle';
import { claudeHookOwnerFromPayloadText, type SessionOwner } from './context-owner';
import { recordToolUseEvent, type ToolPayload } from './context-post-tool';
import { recordSessionStart } from './context-session-start';
import { recordSessionEnd } from './context-session-stop';
import { runStopFromStdin, spurCliFor } from './fleet-guest-stop';
import {
    carefulGuardClaude,
    carefulGuardPi,
    formatCarefulGuardClaude,
    formatGuardPi,
    formatWriteGuardClaude,
    type OwnershipResolver,
    spurOwnershipResolver,
    taskWriteGuardClaude,
    taskWriteGuardPi,
} from './guards';
import { normalizePiToolEvent } from './pi-event';

/** Hosts `spur self hook` shapes output for. `codex` shares Claude's hook wire format. */
export const HOOK_HOSTS = ['claude', 'codex', 'pi', 'auto'] as const;

/** A requested host (including `auto`). */
export type HookHostOption = (typeof HOOK_HOSTS)[number];

/** A concrete host after `auto` resolution. */
export type HookHost = Exclude<HookHostOption, 'auto'>;

/** What a hook id does — drives output expectations and docs. */
export type HookKind = 'guard' | 'capture' | 'lifecycle' | 'delivery';

/** One registered hook id. */
export interface HookDefinition {
    id: string;
    kind: HookKind;
    /** Host events the id is wired to (Claude/Codex event names; Pi event names in parentheses). */
    events: readonly string[];
    summary: string;
    /** Plugin source this id was ported from (removed by later absorption PRs). */
    pluginSource: string;
}

/** The seven sp hook ids, in `hooks.json` order. */
export const HOOK_DEFINITIONS: readonly HookDefinition[] = [
    {
        id: 'task-write-guard',
        kind: 'guard',
        events: ['PreToolUse(Write|Edit)', '(tool_call: write|edit)'],
        summary: 'deny raw Write/Edit of a spur-owned task file',
        pluginSource: 'plugins/sp/hooks/task-write-guard.ts',
    },
    {
        id: 'careful-guard',
        kind: 'guard',
        events: ['PreToolUse(Bash) [opt-in]', '(tool_call: bash)'],
        summary: 'ask before a destructive shell command',
        pluginSource: 'plugins/sp/hooks/careful-guard.ts',
    },
    {
        id: 'context-post-tool',
        kind: 'capture',
        events: ['PostToolUse', '(tool_result)'],
        summary: 'append one tool-use event to .spur/context/token-ledger.jsonl',
        pluginSource: 'plugins/sp/hooks/context-post-tool.ts',
    },
    {
        id: 'context-session-start',
        kind: 'capture',
        events: ['SessionStart', '(session_start)'],
        summary: 'open (or reuse) the context-ledger session',
        pluginSource: 'plugins/sp/hooks/context-session-start.ts',
    },
    {
        id: 'context-session-stop',
        kind: 'capture',
        events: ['SessionEnd', '(session_shutdown)'],
        summary: 'finalize the owned context-ledger session',
        pluginSource: 'plugins/sp/hooks/context-session-stop.ts',
    },
    {
        id: 'agent-lifecycle',
        kind: 'lifecycle',
        events: [
            'SessionStart',
            'UserPromptSubmit',
            'Notification(permission_prompt)',
            'Stop',
            '(agent_start)',
            '(agent_settled)',
        ],
        summary: 'report fleet member state via a detached `spur agent report`',
        pluginSource: 'plugins/sp/hooks/agent-lifecycle.ts',
    },
    {
        id: 'fleet-guest-stop',
        kind: 'delivery',
        events: ['Stop'],
        summary: "deliver a joined guest's queued fleet inbox at turn end",
        pluginSource: 'plugins/sp/hooks/fleet-guest-stop.ts',
    },
];

/** Registered ids, for validation and help text. */
export const HOOK_IDS: readonly string[] = HOOK_DEFINITIONS.map((definition) => definition.id);

/** Inputs to one hook invocation. */
export interface HookRunInput {
    host: HookHostOption;
    /** The raw host payload (empty string when the host sent none). */
    stdin: string;
    env: Record<string, string | undefined>;
    cwd: string;
    /** Launch argv of the running `spur` (`resolveSpurArgv()` in the CLI); default `['spur']`. */
    selfArgv?: readonly string[];
    /** Test seam: replaces the `task resolve` child for the write guard. */
    ownershipResolver?: OwnershipResolver;
    /** Test seam: replaces the detached `agent report` spawn. */
    spawnDetached?: (argv: readonly string[]) => void;
    /** Test seam: replaces the fleet `spur` CLI child. */
    fleetCli?: (args: readonly string[]) => { status: number | null; stdout: string };
}

/** Result of one hook invocation; the CLI prints `stdout` / `stderr` verbatim. */
export interface HookRunResult {
    host: HookHost;
    stdout: string;
    stderr: string;
    exitCode: 0;
}

/** Resolve `auto`: Claude Code exports `CLAUDE_PROJECT_DIR`; anything else is Codex-shaped. */
export function resolveHookHost(option: HookHostOption, env: Record<string, string | undefined>): HookHost {
    if (option !== 'auto') return option;
    return env.CLAUDE_PROJECT_DIR !== undefined ? 'claude' : 'codex';
}

/** The `spur` argv a hook child uses: `SPUR_BIN` split on spaces, else the running build. */
export function hookSpurArgv(env: Record<string, string | undefined>, selfArgv?: readonly string[]): string[] {
    const fromEnv = env.SPUR_BIN;
    if (fromEnv !== undefined && fromEnv !== '') return fromEnv.split(' ');
    return selfArgv !== undefined && selfArgv.length > 0 ? [...selfArgv] : ['spur'];
}

function parsePiEvent(stdin: string): Record<string, unknown> {
    try {
        const parsed = JSON.parse(stdin) as unknown;
        return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

function piOwner(event: Record<string, unknown>): SessionOwner | undefined {
    const raw = event.sessionId;
    const sessionId = typeof raw === 'string' ? raw.trim() : '';
    return sessionId.length > 0 ? { host: 'pi', sessionId } : undefined;
}

/** Claude/Codex context dir (`$CLAUDE_PROJECT_DIR` or cwd); Pi always uses its cwd. */
function contextDir(host: HookHost, input: HookRunInput): string {
    const root = host === 'pi' ? input.cwd : (input.env.CLAUDE_PROJECT_DIR ?? input.cwd);
    return join(root, '.spur', 'context');
}

const silent = (host: HookHost): HookRunResult => ({ host, stdout: '', stderr: '', exitCode: 0 });

function runKnownHook(id: string, host: HookHost, input: HookRunInput): HookRunResult {
    const spurArgv = hookSpurArgv(input.env, input.selfArgv);
    const guardCtx = { env: input.env, cwd: input.cwd };
    switch (id) {
        case 'task-write-guard': {
            if (host === 'pi') {
                const resolver = input.ownershipResolver ?? spurOwnershipResolver(spurArgv, true);
                return { ...silent(host), stdout: formatGuardPi(taskWriteGuardPi(input.stdin, guardCtx, resolver)) };
            }
            const resolver = input.ownershipResolver ?? spurOwnershipResolver(spurArgv);
            return {
                ...silent(host),
                stdout: formatWriteGuardClaude(taskWriteGuardClaude(input.stdin, guardCtx, resolver)),
            };
        }
        case 'careful-guard':
            return {
                ...silent(host),
                stdout:
                    host === 'pi'
                        ? formatGuardPi(carefulGuardPi(input.stdin, guardCtx))
                        : formatCarefulGuardClaude(carefulGuardClaude(input.stdin, guardCtx)),
            };
        case 'context-post-tool': {
            if (host === 'pi') {
                const event = parsePiEvent(input.stdin);
                const payload = normalizePiToolEvent(
                    typeof event.toolName === 'string' ? event.toolName : '',
                    event.input as Record<string, unknown> | undefined,
                    event.content,
                );
                const sessionId = piOwner(event)?.sessionId;
                if (payload) {
                    recordToolUseEvent(
                        contextDir(host, input),
                        sessionId ? { ...payload, session_id: sessionId } : payload,
                    );
                }
                return silent(host);
            }
            recordToolUseEvent(contextDir(host, input), JSON.parse(input.stdin) as ToolPayload);
            return silent(host);
        }
        case 'context-session-start': {
            const owner =
                host === 'pi'
                    ? piOwner(parsePiEvent(input.stdin))
                    : (claudeHookOwnerFromPayloadText(input.stdin, input.env) ?? undefined);
            recordSessionStart(contextDir(host, input), input.env, undefined, host === 'pi' ? 'pi' : undefined, owner);
            return silent(host);
        }
        case 'context-session-stop': {
            const owner =
                host === 'pi'
                    ? piOwner(parsePiEvent(input.stdin))
                    : (claudeHookOwnerFromPayloadText(input.stdin, input.env) ?? undefined);
            recordSessionEnd(contextDir(host, input), undefined, owner);
            return silent(host);
        }
        case 'agent-lifecycle': {
            const deps = {
                env: input.env,
                spurArgv,
                ...(input.spawnDetached !== undefined ? { spawnDetached: input.spawnDetached } : {}),
            };
            if (host === 'pi') {
                reportLifecycleHook({ hook_event_name: parsePiEvent(input.stdin).event }, deps);
            } else {
                runHookFromStdin(input.stdin, deps);
            }
            return silent(host);
        }
        case 'fleet-guest-stop': {
            // Pi has no Stop hook; the guest pull loop (`agent wait --inbox`) covers it.
            if (host === 'pi') return silent(host);
            const line = runStopFromStdin(input.stdin, {
                cwd: input.env.CLAUDE_PROJECT_DIR ?? input.cwd,
                cli: input.fleetCli ?? spurCliFor(spurArgv),
            });
            return { ...silent(host), stdout: line === null ? '' : `${line}\n` };
        }
        default:
            return silent(host);
    }
}

/**
 * Run one hook id. Never throws and always exits 0: an internal error (for example malformed
 * stdin for `context-post-tool`) degrades to the id's fail-open outcome — allow for guards,
 * silence otherwise — without a diagnostic, exactly like the plugin hooks it replaces.
 */
export function runSpurHook(id: string, input: HookRunInput): HookRunResult {
    const host = resolveHookHost(input.host, input.env);
    if (!HOOK_IDS.includes(id)) {
        return {
            ...silent(host),
            stderr: `spur self hook: unknown hook id '${id}' (known: ${HOOK_IDS.join(', ')}); allowing\n`,
        };
    }
    try {
        return runKnownHook(id, host, input);
    } catch {
        const fallback =
            id === 'task-write-guard'
                ? host === 'pi'
                    ? formatGuardPi({ decision: 'allow' })
                    : formatWriteGuardClaude({ decision: 'allow' })
                : id === 'careful-guard'
                  ? host === 'pi'
                      ? formatGuardPi({ decision: 'allow' })
                      : formatCarefulGuardClaude({ decision: 'allow' })
                  : '';
        return { ...silent(host), stdout: fallback };
    }
}
