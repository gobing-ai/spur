import { join } from 'node:path';
import {
    configuredSecretValues,
    EscalationPacketSink,
    registeredWorkflowPaths,
    type SystemEventBus,
    WorkflowAppService,
    type WorkflowObservabilityBus,
} from '@gobing-ai/spur-app';
import { getAppOptions, getEnvVar, getEnvVars, removeEnvVar, type SpurConfig } from '@gobing-ai/spur-config';
import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import { EMBEDDED_SPUR_SCHEMAS } from '../../config/embedded-schemas';
import type { CliContext } from '../../context';
import { makeTaskLocator } from '../task';

/** POSIX single-quote for `sh -c` argv embedding. */
export function shQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Consume the launcher→worker handshake once (task 1117): `spawnAsyncWorkflowWorker`
 * ships `SPUR_EXPECTED_DEFINITION_DIGEST` + `SPUR_ASYNC_WORKER=1` to the worker, whose
 * startup digest check and pid recording are the variables' only legitimate consumers.
 * Removing both from the worker environment at action entry keeps every step child (shell,
 * `agent.run`, guard, nested `spur`) from inheriting an expectation that would make a
 * nested run on any other definition refuse with a phantom digest mismatch.
 */
export function takeAsyncWorkerEnv(): { expectedDigest: string | undefined; isAsyncWorker: boolean } {
    const expectedDigest = getEnvVar('SPUR_EXPECTED_DEFINITION_DIGEST');
    const isAsyncWorker = getEnvVar('SPUR_ASYNC_WORKER') === '1';
    removeEnvVar('SPUR_EXPECTED_DEFINITION_DIGEST');
    removeEnvVar('SPUR_ASYNC_WORKER');
    return { expectedDigest, isAsyncWorker };
}

/** Windows workers use Start-Process with data-only env handoff, never cmd's argv interpolation. */
export function buildWindowsAsyncWorkflowLaunch(argv: readonly string[]): {
    command: string;
    args: string[];
    env: Record<string, string>;
} {
    const executable = argv[0];
    if (!executable || argv.some((arg) => arg.includes('\0'))) {
        throw new Error('async workflow launch: expected a non-empty executable and NUL-free argv');
    }
    if (/\.(cmd|bat)$/i.test(executable)) {
        throw new Error('async workflow launch: batch launchers re-expand arguments; use a native executable');
    }
    // Start-Process joins ArgumentList: pass one Windows-escaped command line, preserving JSON quotes and empty args.
    const argumentLine = argv
        .slice(1)
        .map((arg) => `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`)
        .join(' ');
    return {
        command: 'powershell.exe',
        args: [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            '$ErrorActionPreference = "Stop"; Start-Process -FilePath $env:SPUR_WORKFLOW_COMMAND -ArgumentList $env:SPUR_WORKFLOW_ARGS -WindowStyle Hidden',
        ],
        env: { SPUR_WORKFLOW_COMMAND: executable, SPUR_WORKFLOW_ARGS: argumentLine },
    };
}

/**
 * Launch a long-lived async workflow worker via ProcessExecutor + nohup.
 * Avoids direct child_process.spawn (no-direct-process-spawn).
 */
export async function spawnAsyncWorkflowWorker(
    spurArgv: readonly string[],
    cmd: string[],
    extraEnv?: Record<string, string>,
): Promise<void> {
    const argv = [...spurArgv, ...cmd];
    const line = argv.map(shQuote).join(' ');
    const windowsLaunch = process.platform === 'win32' ? buildWindowsAsyncWorkflowLaunch(argv) : undefined;
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(getEnvVars())) {
        if (value !== undefined) env[key] = value;
    }
    env.SPUR_ASYNC_WORKER = '1';
    // 0768 R2: the launcher resolves the definition BEFORE the worker starts and
    // ships the expected digest across the process boundary; the worker re-resolves
    // and refuses to act on a mismatch (drift between launcher resolution and the
    // worker's own resolution fails the run before any action).
    for (const [key, value] of Object.entries(extraEnv ?? {})) {
        env[key] = value;
    }
    await new NodeProcessExecutor().run({
        command: windowsLaunch?.command ?? '/bin/sh',
        args: windowsLaunch?.args ?? ['-c', `nohup ${line} </dev/null >/dev/null 2>&1 &`],
        env: { ...env, ...windowsLaunch?.env },
        forceBuffered: true,
        rejectOnError: false,
    });
}

/**
 * Registration-confirmation budget in ms. 5s is ample for a local worker to write its
 * run row, but a heavily loaded host can legitimately start slower — and a false
 * negative here reports a working run as failed. `bootstrap.options.asyncRegisterTimeoutMs`
 * raises the ceiling on such hosts (and lets tests drive the failure branch without
 * paying the full wait). A malformed value throws — config drift must not silently
 * disable the check (task 0484 R2; env origin replaced in task 0902 wave 2).
 */
export function asyncRegisterTimeoutMs(spurConfig: Pick<SpurConfig, 'bootstrap'> | null | undefined): number {
    const raw = getAppOptions(spurConfig, 'asyncRegisterTimeoutMs', undefined);
    if (raw === undefined) return 5000;
    if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw;
    throw new Error(
        `bootstrap.options.asyncRegisterTimeoutMs must be a positive integer number of milliseconds; received ${JSON.stringify(raw)}`,
    );
}

/** Run-scoped plan artifact path for an async run (0768 R2). */
export function workflowPlanArtifactPath(runId: string): string {
    return join('.spur', 'run', `${runId}-workflow-plan.json`);
}

/**
 * Build the escalation packet sink (task 0709) for a workflow run bus.
 * Advisory: construction failures return `undefined` — an escalation outage
 * must never abort the run itself.
 */
export async function makeEscalationPacketSink(
    bus: WorkflowObservabilityBus,
    context: CliContext,
): Promise<EscalationPacketSink | undefined> {
    try {
        let locator: Awaited<ReturnType<typeof makeTaskLocator>> | undefined;
        try {
            locator = await makeTaskLocator(context);
        } catch {
            locator = undefined;
        }
        return new EscalationPacketSink({
            bus,
            cwd: context.cwd,
            fs: context.fs,
            db: await context.getDb(),
            ...(locator !== undefined ? { locator } : {}),
        });
    } catch {
        return undefined;
    }
}

/**
 * Read the registered workflow layer candidates (ADR-113): the configured
 * `workflows.paths` entries with `bundled:` prefix expansion applied. The project
 * layer is always `<cwd>/.spur/workflows` and the shared layer comes from the
 * installed package, both computed by the app layer — this returns only the
 * registered extras. Sync & pure (A5/ADR-082): the merged config is threaded from
 * the composition root.
 */
export function resolveWorkflowPaths(config: SpurConfig | null): string[] {
    return registeredWorkflowPaths(config);
}

/**
 * `json` selects the HITL responder: interactive prompts must never fire under --json
 * (they would corrupt the JSON stream). Only `run`/`continue` invoke actions, so only
 * those pass json=true. When a bus is supplied it is shared by both seams:
 *   - `observabilityBus` → ObservableWorkflowAdapter verb-form events + workflow.agent
 *   - `events` → engine-native workflow.* names (run-lifecycle / HITL / custom)
 * Task 0370 attaches a SystemEventDao tap to that bus so CLI-driven runs land in
 * the shared ledger the Board reads (same direct-DAO pattern as task 0249).
 */
export function makeWorkflowService(context: CliContext, json?: boolean, bus?: WorkflowObservabilityBus) {
    // SAFETY: the workflow observability bus is the same EventBus instance the system-event
    // ledger consumes; the branded nominal types only differ by name (ADR-044 event bridge),
    // so workflow-dispatch agent events can ride it without double-emission.
    const dispatchBus = bus as unknown as SystemEventBus | undefined;
    return new WorkflowAppService({
        cwd: context.cwd,
        spurConfig: context.spurConfig ?? null,
        // 0799 R3: the launch boundary prefers a fresh merged config so a quota
        // event applied by the updater gates this workflow run immediately.
        // The composition-root closure (ADR-082) owns the loader call.
        reloadAgentConfig: () => context.loadAgentConfig(context.cwd),
        secretValues: configuredSecretValues(context.env),
        warn: (message) => context.output.error(`Warning: ${message}`),
        getDb: () => context.getDb(),
        // Task 0687 R10: thread the ledger bus into AgentService so workflow-dispatched
        // agents write `agent.invoke.*` like the `spur agent run` path does
        // (`commands/agent/run.ts`). The prior comment here withheld the bus to avoid
        // dual-emitting against a single `workflow.agent` series — but that series was
        // never written, so from 2026-08-20 (when dispatches moved into pipelines)
        // until this change NO agent dispatch reached `system_events` at all, and every
        // consumer keyed on `agent.invoke.start`/`.exit` — `pairingSummary`,
        // `roleTokenSummary`, `retroCorrelation`, and therefore the history-anatomy
        // report's run-cost dimension — silently read empty. One dispatch still emits
        // exactly one start/exit pair; the workflow's own `workflow.action.*` series is
        // a different grain (action, not dispatch) and does not double-count.
        agentService: () => (bus ? context.agentService({ events: dispatchBus }) : context.agentService()),
        ruleService: () => context.ruleService(),
        hitlResponder: () => context.hitlResponder(json),
        // Resolve bundled-workflow `$schema` refs from the embedded map rather than
        // node_modules, so validate works in a --compile binary and from any cwd.
        embeddedSchemas: () => EMBEDDED_SPUR_SCHEMAS,
        ...(bus
            ? {
                  observabilityBus: () => bus,
                  // SAFETY: WorkflowObservabilityBus and SystemEventBus are structurally the same EventBus
                  // instance; the branded nominal types only differ by name (ADR-044 event bridge).
                  events: () => bus as unknown as SystemEventBus,
              }
            : {}),
    });
}
