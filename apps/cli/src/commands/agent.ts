import type { Command } from '@commander-js/extra-typings';
import {
    AGENT_INLINE_HEADLESS_MESSAGE,
    type AgentRunDeps,
    AgentService,
    type AgentSpecInput,
    followSystemEventsAfter,
    type SystemEventBus,
    TeamService,
    WaitError,
    type WaitUntil,
    waitForOccupant,
} from '@gobing-ai/spur-app';
import { resolveExecutor } from '@gobing-ai/spur-config';
import { SystemEventDao, type SystemEventRow } from '@gobing-ai/spur-domain';
import { type AgentSpec, isAgentName } from '@gobing-ai/ts-ai-runner';
import { EventBus } from '@gobing-ai/ts-infra';
import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import type { CliContext } from '../context';
import { toJson } from '../output';
import { attachSystemEventLedger } from '../system-event-ledger';

export type { AgentRunDeps };

/** Register `spur agent` commands on the CLI program. */
export function registerAgentCommand(program: Command, context: CliContext): void {
    const agent = program.command('agent').summary('run and inspect supported coding agents');

    agent
        .command('list')
        .description('List detected coding agents, or team agent specs with --specs.')
        .option('--json', 'Output machine-readable JSON')
        .option('--specs', 'List team specs instead of detected agents')
        .action(async (options) => {
            const svc = new AgentService({ cwd: context.cwd, env: context.env, output: context.output });
            const code = await runAgentList(svc, context, { json: options.json, specs: options.specs });
            context.setExitCode(code);
        });

    agent
        .command('doctor')
        .description('Check agent readiness.')
        .option('--json', 'Output machine-readable JSON')
        .argument('[agent]', 'Agent to check')
        .action(async (agentName, options) => {
            const svc = context.agentService();
            const code = await svc.doctor({ json: options.json === true, agent: agentName }, undefined);
            context.setExitCode(code);
        });

    agent
        .command('run')
        .description('Execute a prompt or slash command via a coding agent.')
        .option(
            '--agent <name>',
            'Role, executor, agent binary, auto, or inline (host-session-only; errors on headless surfaces)',
        )
        .option('--spec <id>', 'Team agent spec id (occupant addressing; pairs with --drain)')
        .option('--continue', 'Resume the previous agent session')
        .option('--model <name>', 'Agent model argument')
        .option('--mode <mode>', 'Agent output mode: text|json')
        .option('--cwd <path>', 'Working directory for agent execution')
        .option('--json', 'Output machine-readable JSON where supported')
        .option('--drain', 'Prepend pending inbox messages for --spec <id>')
        .argument('<prompt>', 'The prompt or slash command to execute')
        .action(async (prompt, options) => {
            const flags = commanderOptionsToFlags(options);
            const code = await runAgentRun(prompt, context, flags);
            context.setExitCode(code);
        });

    agent
        .command('loop')
        .description('Run the persistent self-draining loop for a team member (used by the supervisor).')
        .option('--spec <id>', 'Agent spec id / message recipient')
        .option('--agent <id>', 'Agent spec id / message recipient (legacy — prefer --spec)')
        .option('--poll <ms>', 'Idle poll interval in milliseconds', String(DEFAULT_LOOP_POLL_MS))
        .action(async (options) => {
            const controller = new AbortController();
            const onSignal = () => controller.abort();
            process.on('SIGINT', onSignal);
            process.on('SIGTERM', onSignal);
            try {
                const flags = commanderOptionsToFlags(options);
                const code = await runAgentLoop(context, flags, { signal: controller.signal });
                context.setExitCode(code);
            } finally {
                process.off('SIGINT', onSignal);
                process.off('SIGTERM', onSignal);
            }
        });

    agent
        .command('wait')
        .description('Wait for a pinned occupant run to reach a lifecycle state (G4 wave 2).')
        .argument('<specId>', 'Agent spec id whose occupant to wait on')
        .option('--run <runId>', 'Pin a specific run id (default: spec latest run)')
        .option('--until <state>', 'Lifecycle state to wait for (repeatable OR)', collectUntil, [])
        .option('--timeout <ms>', 'Caller deadline in milliseconds', parseTimeout)
        .option('--json', 'Output machine-readable JSON')
        .action(async (specId, options) => {
            const code = await runAgentWait(context, specId, options);
            context.setExitCode(code);
        });

    agent
        .command('create')
        .description('Write a team agent spec to .spur/agents/<id>.yaml.')
        .option('--type <agent-type>', 'Agent spec type for create')
        .option('--tags <a,b>', 'Team identity tags')
        .option('--system-prompt <text>', 'Team identity system prompt')
        .option('--name <name>', 'Agent name')
        .option('--workspace <path>', 'Workspace path')
        .option('--purpose <text>', 'Team identity purpose')
        .option('--auto-start', 'Auto-start flag')
        .option('--model <name>', 'Agent model argument')
        .option('--autonomy <level>', 'Autonomy level')
        .option('--no-identity-preamble', 'Disable identity preamble')
        .option('--json', 'Output machine-readable JSON')
        .argument('<id>', 'Agent spec id')
        .action(async (id, options) => {
            const flags = commanderOptionsToFlags(options);
            const code = await runAgentCreate(id, context, flags);
            context.setExitCode(code);
        });

    agent
        .command('edit')
        .description('Open an agent spec in $EDITOR, or print its path.')
        .argument('<id>', 'Agent spec id')
        .action(async (id) => {
            const code = await runAgentEdit(id, context);
            context.setExitCode(code);
        });

    agent
        .command('delete')
        .description('Remove an agent spec.')
        .option('--force', 'Required for delete')
        .argument('<id>', 'Agent spec id')
        .action(async (id, options) => {
            const flags = commanderOptionsToFlags(options);
            const code = await runAgentDelete(id, context, flags);
            context.setExitCode(code);
        });
}

/** Map commander-style camelCase option keys to kebab-case flags internal handlers expect. */
function commanderOptionsToFlags(options: Record<string, unknown>): Record<string, string | boolean> {
    const flags: Record<string, string | boolean> = {};
    for (const [k, v] of Object.entries(options)) {
        if (v === undefined) continue;
        // commander camelCase → kebab-case (e.g. systemPrompt → system-prompt)
        const key = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
        // --no-* flags: commander strips "no" prefix and sets value=false; restore.
        if (v === false && /^[a-z]/.test(k)) flags[`no-${key}`] = true;
        else flags[key] = v as string | boolean;
    }
    return flags;
}

/**
 * Validate an `--agent` value at the flag boundary, before any agent process
 * spawns (0536 R3). `omit`/`auto` pass. Explicit `inline` is rejected with the
 * frozen headless-surface message (G5 / ADR-047 amendment): a headless surface
 * cannot host a session, so `inline` never resolves to `agent.default` here. A
 * role, a configured executor, or a bare coding-agent binary name passes — the
 * service warns once under the registered shim (`agent-bare-binary-name`).
 * Returns an error message, or null to proceed. Exported as a test seam.
 */
export function validateAgentSelector(flags: Record<string, string | boolean>, context: CliContext): string | null {
    const raw = typeof flags.agent === 'string' ? flags.agent : undefined;
    if (raw === undefined || raw === 'auto') return null;
    if (raw === 'inline') return AGENT_INLINE_HEADLESS_MESSAGE;
    if (context.agentRoles?.has(raw) === true) return null;
    if ((context.agentConfig?.executors ?? []).some((e) => e.name === raw)) return null;
    if (isAgentName(raw)) return null;
    const roleList =
        context.agentRoles !== undefined
            ? [...context.agentRoles.keys()].join(', ')
            : 'scribe, coder, reviewer, planner';
    const executors = (context.agentConfig?.executors ?? []).map((e) => e.name);
    const executorList = executors.length > 0 ? executors.join(', ') : '(none configured)';
    return `Unknown agent: '${raw}'. Accepted: role (${roleList}), configured executor (${executorList}), or 'auto'.`;
}

/** `spur agent list [--json] [--specs]` — optionally list team agent specs instead of detection. */
async function runAgentList(
    svc: AgentService,
    context: CliContext,
    opts: { json?: boolean; specs?: boolean },
): Promise<number> {
    if (!opts.specs) {
        return svc.list({ json: opts.json ?? false });
    }
    const specs = await new TeamService(context).listAgentSpecs();
    if (opts.json) {
        context.output.write(
            toJson({
                specs: specs.map((spec) => ({
                    id: spec.id,
                    type: spec.type,
                    purpose: spec.purpose,
                    // 0544 R2: role and executor are DISTINCT fields — never merged.
                    ...(typeof spec.config?.role === 'string' && spec.config.role.length > 0
                        ? { role: spec.config.role }
                        : {}),
                    ...(spec.executor !== undefined ? { executor: spec.executor } : {}),
                    path: `.spur/agents/${spec.id}.yaml`,
                })),
            }),
        );
        return 0;
    }
    if (specs.length === 0) {
        context.output.write('No agent specs found in .spur/agents/');
        return 0;
    }
    // 0544 R2/R4: role and executor are distinct columns; undeclared renders `unset`.
    context.output.write(
        specs
            .map((spec) => {
                const role =
                    typeof spec.config?.role === 'string' && spec.config.role.length > 0 ? spec.config.role : 'unset';
                const executor = spec.executor ?? 'unset';
                return `${spec.id}\t${spec.type}\t${role}\t${executor}\t${spec.purpose}`;
            })
            .join('\n'),
    );
    return 0;
}

/** `spur agent create <id> --type <agent-type> [flags]` */
async function runAgentCreate(
    id: string | undefined,
    context: CliContext,
    flags: Record<string, string | boolean>,
): Promise<number> {
    if (id === undefined) {
        context.output.error('agent create requires <id>');
        return 2;
    }
    const type = typeof flags.type === 'string' ? flags.type : '';
    if (type === '') {
        context.output.error('agent create requires --type <agent-type>');
        return 2;
    }
    const tags = typeof flags.tags === 'string' ? flags.tags : '';
    const systemPrompt = typeof flags.systemPrompt === 'string' ? flags.systemPrompt : '';
    const input: AgentSpecInput = {
        id,
        type,
        ...(typeof flags.name === 'string' ? { name: flags.name } : {}),
        ...(typeof flags.workspace === 'string' ? { workspace: flags.workspace } : {}),
        ...(typeof flags.purpose === 'string' ? { purpose: flags.purpose } : {}),
        ...(tags === '' ? {} : { tags: parseTags(tags) }),
        ...(flags.autoStart === true ? { autoStart: true } : {}),
        config: buildAgentConfig(flags, systemPrompt),
    };

    try {
        const spec = await new TeamService(context).createAgentSpec(input);
        if (flags.json === true) {
            context.output.write(toJson({ ok: true, spec }));
        } else {
            context.output.write(`created .spur/agents/${spec.id}.yaml`);
        }
        return 0;
    } catch (error) {
        context.output.error(error instanceof Error ? error.message : String(error));
        return 1;
    }
}

/** Split a comma-separated `--tags` value into trimmed, non-empty tags. */
function parseTags(raw: string): string[] {
    return raw
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
}

/** Collect spec-level config from create flags (model, autonomy, system prompt, preamble toggle). */
function buildAgentConfig(flags: Record<string, string | boolean>, systemPrompt: string): Record<string, unknown> {
    const config: Record<string, unknown> = {};
    if (typeof flags.model === 'string') config.model = flags.model;
    if (typeof flags.autonomy === 'string') config.autonomy = flags.autonomy;
    if (systemPrompt !== '') config.systemPrompt = systemPrompt;
    if (flags['no-identity-preamble'] === true) config.identityPreamble = false;
    return config;
}

/**
 * Split `$EDITOR` into argv tokens so multi-word values (`code -w`, `vim -f`)
 * spawn correctly. Whitespace-only input yields `[]`.
 */
export function splitEditorCommand(editor: string): string[] {
    return editor.trim().split(/\s+/).filter(Boolean);
}

/** `spur agent edit <id>` — open the spec in $EDITOR or print its path. */
async function runAgentEdit(id: string | undefined, context: CliContext): Promise<number> {
    if (id === undefined) {
        context.output.error('agent edit requires <id>');
        return 2;
    }
    const spec = (await new TeamService(context).listAgentSpecs()).find((entry) => entry.id === id);
    if (spec === undefined) {
        context.output.error(`No agent spec found: ${id}`);
        return 1;
    }
    // Use the spec's canonical (already-validated) id to build the path.
    const path = `${context.cwd}/.spur/agents/${spec.id}.yaml`;
    const editor = context.env.EDITOR;
    if (editor === undefined || editor === '') {
        context.output.write(path);
        return 0;
    }
    const editorArgv = splitEditorCommand(editor);
    if (editorArgv.length === 0) {
        context.output.write(path);
        return 0;
    }
    // Interactive $EDITOR via ProcessExecutor (stream/TTY). See no-direct-process-spawn.
    const [editorCmd, ...editorArgs] = editorArgv;
    if (editorCmd === undefined) {
        context.output.write(path);
        return 0;
    }
    const result = await new NodeProcessExecutor({
        output: { mode: 'stream', isTTY: true },
    }).run({
        command: editorCmd,
        args: [...editorArgs, path],
        forceBuffered: false,
        rejectOnError: false,
    });
    return result.exitCode ?? 1;
}

/** `spur agent delete <id> [--force]` */
async function runAgentDelete(
    id: string | undefined,
    context: CliContext,
    flags: Record<string, string | boolean>,
): Promise<number> {
    if (id === undefined) {
        context.output.error('agent delete requires <id>');
        return 2;
    }
    if (flags.force !== true) {
        context.output.error(`Refusing to delete ${id} without --force`);
        return 2;
    }
    try {
        await new TeamService(context).deleteAgentSpec(id);
        context.output.write(`deleted .spur/agents/${id}.yaml`);
        return 0;
    } catch (error) {
        context.output.error(error instanceof Error ? error.message : String(error));
        return 1;
    }
}

/** Execute `spur agent run <prompt> [flags]`. */
export async function runAgentRun(
    prompt: string | undefined,
    context: CliContext,
    flags: Record<string, string | boolean>,
    deps?: AgentRunDeps,
): Promise<number> {
    // Task 0370: direct `spur agent run` emits cataloged `agent.invoke.*` on a
    // CLI-local bus with a SystemEventDao tap — the EventBus dual of task 0249's
    // SystemEventEmitter for planning. Workflow-dispatched agent.run stays on the
    // workflow path (`workflow.agent` series only) so a nested execution never
    // double-counts (R4). Route through context.agentService({ events }) so the
    // validated agentConfig (0126) is still threaded into resolution.
    const bus = new EventBus() as SystemEventBus;
    const ledger = await attachSystemEventLedger(bus, context);
    const svc = context.agentService({ events: bus });
    try {
        // `--spec <id>` (canonical, 0542 R1) or the legacy `--agent <spec-id>`
        // names the occupant address; `--drain` is DB-backed, so it is resolved in
        // the command layer (where getDb lives) rather than in the app service.
        // The addressed id names a message recipient (an agent spec id), which is
        // a different namespace from the coding-agent type the runner resolves.
        // When a matching spec exists we rewrite `--agent` to the spec's underlying
        // executor/type so resolution still works; in Phase 1-3 there is no live
        // stdin, so prepending is how deferred messages reach the agent.
        if (flags.drain === true || typeof flags.spec === 'string') {
            const { prompt: drained, flags: rewritten } = await drainIntoPrompt(prompt, context, flags);
            // R1 (0542): an explicit --spec must resolve to a real team spec — a
            // typo'd id must not silently fall through to auto resolution.
            if (typeof flags.spec === 'string' && flags.spec !== '' && rewritten['spec-id'] !== flags.spec) {
                context.output.error(`--spec "${flags.spec}" does not match a team agent spec`);
                return 2;
            }
            const invalid = validateAgentSelector(rewritten, context);
            if (invalid !== null) {
                context.output.error(invalid);
                return 2;
            }
            return await svc.run(drained, rewritten, deps);
        }
        // R3 (0536): reject a value that is neither a role, a configured executor,
        // nor auto at the flag boundary — before any agent process spawns.
        // Explicit `inline` is rejected here too (G5 / ADR-047 amendment): exit 2
        // with the frozen headless-surface message, zero spawn, no fallback.
        const invalid = validateAgentSelector(flags, context);
        if (invalid !== null) {
            context.output.error(invalid);
            return 2;
        }
        return await svc.run(prompt, flags, deps);
    } finally {
        await ledger.flush();
        ledger.unsubscribe();
    }
}

/**
 * Drain pending inbox messages for the addressed agent spec and prepend them to
 * the prompt — or, with `--spec` alone, just address the occupant without
 * touching the inbox. Returns possibly-rewritten flags (with `--agent` mapped
 * from spec id to the spec's executor name — or coding-agent type when the spec
 * carries no executor field — when a spec is found).
 *
 * R1 (0542): the spec id is read from `--spec <id>` (canonical). A spec id
 * passed to the legacy `--agent <spec-id>` still works during the transition,
 * warned once under the registered shim (`agent-flag-spec-id`). `spec-id` is
 * set BEFORE the rewrite so AgentService.executeRun can persist an occupant pin
 * (ADR-057 wave 1 R1) — the flag survives even when the inbox is empty, because
 * runAgentLoop relies on it.
 */
async function drainIntoPrompt(
    prompt: string | undefined,
    context: CliContext,
    flags: Record<string, string | boolean>,
): Promise<{ prompt: string | undefined; flags: Record<string, string | boolean> }> {
    const specFlag = typeof flags.spec === 'string' ? flags.spec : '';
    const agentFlag = typeof flags.agent === 'string' ? flags.agent : '';
    const recipient = specFlag !== '' ? specFlag : agentFlag;
    if (recipient === '' || recipient === 'auto') {
        context.output.error('--drain requires an explicit --spec <id> matching a message recipient');
        return { prompt, flags };
    }

    const team = new TeamService(context);
    const spec = (await team.listAgentSpecs()).find((entry) => entry.id === recipient);
    // Legacy `--agent <spec-id>` addressing: warn once per process (agent-flag-spec-id).
    if (specFlag === '' && spec !== undefined) {
        warnAgentSpecIdOnce(context);
    }
    const flagsOut =
        spec === undefined ? flags : { ...flags, 'spec-id': spec.id, agent: drainAgentSelector(spec, context) };

    // `--spec` without `--drain`: address the occupant, leave the inbox alone.
    if (flags.drain !== true) return { prompt, flags: flagsOut };

    const inbox = await team.drainPending(recipient);
    if (inbox.count === 0) return { prompt, flags: flagsOut };

    const header = inbox.messages.map((m) => `- ${m.fromId ?? 'operator'}: ${m.body}`).join('\n');
    const block = `Pending messages:\n${header}`;
    const merged = prompt === undefined ? block : `${block}\n\n${prompt}`;
    return { prompt: merged, flags: flagsOut };
}

/**
 * Resolve the `--agent` selector for a drained spec (0537, feature B2).
 *
 * A spec materialized with an `executor` name routes through that executor so the
 * operator's model + tier binding survives drain (R2). A dangling executor —
 * renamed or removed from `agent.executors` — fails loudly instead of silently
 * falling back to a bare binary on the default model (R5): the error names the
 * spec and the missing executor, and no process spawns. Pre-existing specs with
 * no executor field keep today's `spec.type` behavior.
 */
function drainAgentSelector(spec: AgentSpec, context: CliContext): string {
    // @transition-shim(spec-without-executor-field) — legacy specs carry only `type`, no executor binding
    if (spec.executor === undefined) return spec.type;
    try {
        resolveExecutor(spec.executor, context.agentConfig, { isCanonicalAgent: isAgentName });
    } catch (error) {
        throw new Error(
            `Spec "${spec.id}" references unknown executor "${spec.executor}" — define it under agent.executors or remove the reference (${error instanceof Error ? error.message : String(error)})`,
        );
    }
    return spec.executor;
}

/** Spec ids already warned via the legacy `--agent <spec-id>` path (warn once per process — 0542 R1). */
const warnedAgentSpecId = new Set<string>();

/**
 * One-time transition warning for addressing a team spec via the legacy
 * `--agent <spec-id>` flag; `--spec <id>` is the canonical carrier (0542 R1).
 * Warns once per process, so the supervised loop cannot spam stderr on every
 * drain iteration.
 */
// @transition-shim(agent-flag-spec-id) — a team spec id passed to --agent still addresses the spec
// during the transition, warned once; removal: no --agent <spec-id> usage remains in
// .spur/workflows/, plugins/sp/, or docs/
function warnAgentSpecIdOnce(context: CliContext): void {
    if (warnedAgentSpecId.size > 0) return;
    warnedAgentSpecId.add('*');
    context.output.error(
        'Warning: addressing a team spec via --agent <spec-id> is deprecated; use --spec <id> (config/transition-shims.json: agent-flag-spec-id).',
    );
}

/**
 * Reset the process-global warn-once markers. Test seam: `bun test` batches
 * several test files per worker process, so a marker consumed by one file is
 * invisible to another on some platforms/schedules — assertions on first-warn
 * behavior must reset first.
 */
export function _resetAgentFlagShimsForTest(): void {
    warnedAgentSpecId.clear();
}

/** Default idle poll interval for `spur agent loop` (ms). */
const DEFAULT_LOOP_POLL_MS = 2000;

/** Injectable knobs for {@link runAgentLoop} — tests pass maxIterations/sleep to avoid real waits. */
export interface AgentLoopRuntime {
    /** Aborting ends the loop cleanly (SIGINT/SIGTERM in the CLI action). */
    signal?: AbortSignal;
    /** Hard cap on iterations (tests only); undefined = run until aborted. */
    maxIterations?: number;
    /** Sleep override; defaults to a cancellable setTimeout. */
    sleep?: (ms: number) => Promise<void>;
}

/** Parse the `--poll` flag; falls back to the default for non-positive/non-numeric input. */
function parseLoopPoll(raw: string | boolean | undefined): number {
    if (typeof raw !== 'string') return DEFAULT_LOOP_POLL_MS;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_LOOP_POLL_MS;
}

/** Valid `agent wait --until` states. */
const WAIT_UNTIL_STATES = new Set<WaitUntil>(['idle', 'working', 'invoke-exit', 'blocked']);

/** Commander reducer: accumulate repeatable `--until` values into an array. */
function collectUntil(value: string, acc: WaitUntil[]): WaitUntil[] {
    if (!WAIT_UNTIL_STATES.has(value as WaitUntil)) {
        throw new Error(`invalid --until "${value}" (expected one of: ${[...WAIT_UNTIL_STATES].join(', ')})`);
    }
    return [...acc, value as WaitUntil];
}

/** Parse the `--timeout` flag as a positive-integer ms value, or undefined. */
function parseTimeout(raw: string | boolean | undefined): number | undefined {
    if (raw === undefined || typeof raw === 'boolean') return undefined;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n <= 0) {
        throw new Error(`invalid --timeout "${raw}" (expected a positive integer ms)`);
    }
    return n;
}

/** Cancellable sleep; resolves immediately if the signal is already aborted. */
function loopSleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal?.aborted) {
            resolve();
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            'abort',
            () => {
                clearTimeout(timer);
                resolve();
            },
            { once: true },
        );
    });
}

/**
 * `spur agent loop --spec <id> [--poll <ms>]` — the persistent self-draining wrapper
 * the supervisor spawns (0258 R6). Each iteration consumes the inbox via `drainPending`;
 * if messages were drained it runs the agent with them prepended, otherwise it
 * idle-sleeps `--poll` ms. This is the long-lived, attachable process — the member no
 * longer dies after one successful drain. Exits cleanly on abort (SIGINT/SIGTERM);
 * crash-restart is the supervisor's job. Legacy `--agent <id>` still works for the
 * transition, warned once (agent-flag-spec-id).
 */
export async function runAgentLoop(
    context: CliContext,
    flags: Record<string, string | boolean>,
    runtime: AgentLoopRuntime = {},
    deps?: AgentRunDeps,
): Promise<number> {
    const recipient =
        typeof flags.spec === 'string' && flags.spec !== ''
            ? flags.spec
            : typeof flags.agent === 'string'
              ? flags.agent
              : '';
    if (recipient === '' || recipient === 'auto') {
        context.output.error('agent loop requires an explicit --spec <id> matching a team agent spec');
        return 2;
    }
    const pollMs = parseLoopPoll(flags.poll);
    const sleep = runtime.sleep ?? ((ms: number) => loopSleep(ms, runtime.signal));
    const svc = context.agentService();

    let iteration = 0;
    while (!runtime.signal?.aborted && (runtime.maxIterations === undefined || iteration < runtime.maxIterations)) {
        // Consume this member's inbox (queued → injected). A non-empty drain yields a
        // prompt to run the agent on; an empty drain yields `undefined` → idle-sleep.
        const { prompt, flags: rewritten } = await drainIntoPrompt(undefined, context, { ...flags, drain: true });
        if (prompt !== undefined) {
            await svc.run(prompt, rewritten, deps);
        } else {
            await sleep(pollMs);
        }
        iteration++;
    }
    return 0;
}

/** Read the latest cataloged invoke event for a runId from the system_events ledger. */
async function readLatestInvokeEvent(
    dao: SystemEventDao,
    runId: string,
): Promise<{ eventName: string; sequence: number | null } | null> {
    const rows: SystemEventRow[] = await dao.query({
        run_id: runId,
        names: ['agent.invoke.start', 'agent.invoke.exit'],
        limit: 1,
    });
    const row = rows[0];
    if (row === undefined) return null;
    return { eventName: row.event_name, sequence: row.sequence };
}

/**
 * `spur agent wait <specId> [--run <runId>] [--until ...] [--timeout <ms>] [--json]`.
 * Identity-pinned wait on an occupant run (G4 wave 2, task 0530 R4). Pins the
 * occupant's specId+runId+generation and waits for the first satisfied
 * `--until` (OR), failing with a typed error on replacement / stall / timeout.
 */
async function runAgentWait(
    context: CliContext,
    specId: string,
    options: { run?: string; until: WaitUntil[]; timeout?: number; json?: boolean },
): Promise<number> {
    const untilList = options.until;
    if (untilList.length === 0) untilList.push('idle');
    // `blocked` has no first-class signal in wave 2 → reject at usage time.
    if (untilList.length === 1 && untilList[0] === 'blocked') {
        return waitUsageError(
            context,
            options,
            '--until blocked has no first-class signal in this wave; use idle|working|invoke-exit',
        );
    }

    const agentService = context.agentService();
    const teamService = new TeamService(context);
    const eventDao = new SystemEventDao(await context.getDb());

    const controller = new AbortController();
    const onSignal = () => controller.abort();
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);

    try {
        // Snapshot once to resolve the default runId + initial pin before waiting.
        const occupant = await agentService.getOccupant({ specId });
        if (occupant === null) {
            return waitFail(context, options, 'occupant_gone', `no occupant for specId "${specId}"`);
        }
        const runId = options.run ?? occupant.runId;
        if (options.run !== undefined && options.run !== occupant.runId) {
            // Pin an explicit (possibly completed) run; read its own events.
        }
        const pin = { specId, runId, generation: occupant.generation };

        // First satisfied `--until` wins (OR semantics). Errors from the first
        // failing target surface as the wait result.
        let result: { pin: typeof pin; satisfied: WaitUntil } | null = null;
        let firstError: WaitError | null = null;
        for (const until of untilList) {
            try {
                result = await waitForOccupant(
                    {
                        getOccupant: (id) => agentService.getOccupant({ specId: id }),
                        countPending: (id) => teamService.countPending(id),
                        latestInvokeEvent: (r) => readLatestInvokeEvent(eventDao, r),
                        // Snapshot-then-follow over the shared ledger (G4 R8):
                        // only the pinned run's invoke events are followed.
                        follow: (afterSequence) =>
                            followSystemEventsAfter(context.getDb, {
                                afterSequence,
                                match: (row) =>
                                    row.run_id === runId &&
                                    (row.event_name === 'agent.invoke.start' || row.event_name === 'agent.invoke.exit'),
                                signal: controller.signal,
                            }),
                        now: () => Date.now(),
                        sleep: (ms) => loopSleep(ms, controller.signal),
                    },
                    {
                        pin,
                        until,
                        timeoutMs: options.timeout,
                        signal: controller.signal,
                    },
                );
                break;
            } catch (error) {
                if (error instanceof WaitError) {
                    firstError = error;
                    // `timeout`/`occupant_gone`/`run_replaced` are terminal — no point
                    // trying the next `--until`; only `wait_stalled` might differ.
                    if (error.code !== 'wait_stalled') break;
                } else {
                    throw error;
                }
            }
        }

        if (result !== null) {
            const payload = { satisfied: result.satisfied, pin: result.pin };
            if (options.json) {
                context.output.write(toJson(payload));
            } else {
                context.output.write(`${pin.specId}/${pin.runId} reached ${result.satisfied}`);
            }
            return 0;
        }
        const err = firstError ?? new WaitError('wait_stalled', 'no --until target satisfied');
        return waitFail(context, options, err.code, err.message);
    } finally {
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
    }
}

/** Emit a usage error (exit 2) for `agent wait`. */
function waitUsageError(context: CliContext, options: { json?: boolean }, message: string): number {
    if (options.json) {
        context.output.write(toJson({ error: { code: 'usage', message } }));
    } else {
        context.output.error(message);
    }
    return 2;
}

/** Emit a typed wait failure (exit 1) with the `--json` error envelope. */
function waitFail(context: CliContext, options: { json?: boolean }, code: string, message: string): number {
    if (options.json) {
        context.output.write(toJson({ error: { code, message } }));
    } else {
        context.output.error(`${code}: ${message}`);
    }
    return 1;
}
