import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Command } from '@commander-js/extra-typings';
import type { AgentQuotaEventBus } from '@gobing-ai/spur-app';
import {
    assertStartStateStartable,
    buildWorkflowSteps,
    configuredSecretValues,
    createShellOutputRedactor,
    createWorkflowEventIdentity,
    decorateWorkflowEvent,
    preStartStepIds,
    type ResolvedWorkflowDefinition,
    readContinuedFrom,
    redactAndBound,
    renderActionHeartbeat,
    renderRunPlan,
    renderStepLine,
    resolveOutputLogConfig,
    resolveWorkflowDefinition,
    runStoragePaths,
    type SteeringAck,
    type StepEvent,
    type SystemEventBus,
    type WorkflowAppService,
    type WorkflowObservabilityBus,
    type WorkflowOutputDetail,
    WorkflowRunLogSink,
    WorkflowSteeringController,
    WorkflowTraceWriter,
} from '@gobing-ai/spur-app';
import {
    capabilityDiagnostic,
    evaluateCapabilities,
    parseRequiresCapabilities,
} from '@gobing-ai/spur-app/capability-attestation';
import { getEnvVar, removeEnvVar, setEnvVar } from '@gobing-ai/spur-config';
import { EventBus } from '@gobing-ai/ts-infra';
import { attachAgentQuotaPersistence } from '../../agent-quota-persistence';
import { EMBEDDED_SPUR_SCHEMAS } from '../../config/embedded-schemas';
import type { CliContext } from '../../context';
import { maybeTriggerHistoryRefresh } from '../../history-refresh';
import { toEnvelopeJson, toJson, writeJsonError } from '../../output';
import { attachSystemEventLedger } from '../../system-event-ledger';
import { resolveSpurBin } from '../../workflow/resolve-spur-bin';
import { SHARED_OPTIONS } from '../shared-options';
import {
    asyncRegisterTimeoutMs,
    makeEscalationPacketSink,
    makeWorkflowService,
    resolveWorkflowPaths,
    spawnAsyncWorkflowWorker,
    takeAsyncWorkerEnv,
} from './shared';

/**
 * Nested-run refusal marker (task 0610 R4).
 *
 * `agent.run` spawns its agent as a child of the running workflow process, and that agent's shell
 * inherits this process's environment — so a marker set here reaches any `spur workflow run` the
 * agent tries to start, at any depth. Before this, the only protection was a prose NOTE in
 * `task-pipeline.yaml` asking the model not to recurse; a recursing run forks a worktree and an
 * agent per level with no bound.
 *
 * Set immediately before EXECUTION, never before the `--async` spawn: the detached worker is a
 * legitimate top-level run, and marking the parent would make the worker refuse itself. Setting it
 * late needs no exemption — and an exemption would be inherited by the worker's own agent children,
 * re-opening the hole one level out.
 */
export const WORKFLOW_RUN_ACTIVE_ENV = 'SPUR_WORKFLOW_RUN_ACTIVE';

function markWorkflowRunActive(): void {
    setEnvVar(WORKFLOW_RUN_ACTIVE_ENV, '1');
}

/**
 * Clear the marker once the run finishes. Children spawned DURING the run already inherited their
 * own copy, so clearing does not weaken the guard — it keeps the marker scoped to the run rather
 * than poisoning the process (which would refuse a legitimate second run in the same process, and
 * leaks across in-process tests).
 */
function clearWorkflowRunActive(): void {
    removeEnvVar(WORKFLOW_RUN_ACTIVE_ENV);
}

/**
 * Named error for run IDs that escape their confinement directory
 * (0753 R2 / F-6: `apps/cli/src/commands/workflow.ts` previously handed
 * `options.runId` straight to path construction). Validation rejects
 * the input at the CLI parse boundary rather than sanitizing — a silently
 * rewritten ID breaks the correlation between the operator's typed value
 * and the directory that appears.
 */
export class InvalidRunIdError extends Error {
    readonly code = 'INVALID_RUN_ID';
    constructor(
        message: string,
        public readonly runId: string,
    ) {
        super(message);
        this.name = 'InvalidRunIdError';
    }
}

/**
 * Validate a CLI-supplied run ID at the boundary, once. Rejects any input
 * that would let the ID escape its `.spur/run/<id>...` confinement: path
 * separators (`/`, `\`), traversal segments (anything containing `.`),
 * absolute paths (`/foo`, `C:\\foo`), and shell metacharacters. The
 * accepted shape — alphanumerics and dashes — is exactly the shape the
 * generated UUIDs already use; the engine never needs anything richer.
 *
 * Empty / undefined input is allowed and lets the caller mint a UUID —
 * not every invocation must supply `--run-id`.
 */
export function validateRunId(runId: string | undefined): string {
    if (runId === undefined || runId === '') return '';
    // UUID-like shape: alphanumerics + dashes only. This rejects path
    // separators, traversal segments (anything containing `.`), absolute
    // paths (`/foo`, `C:\foo`), and shell metas, without enumerating them.
    if (!/^[A-Za-z0-9-]+$/.test(runId)) {
        throw new InvalidRunIdError(
            `run ID must contain only alphanumerics and dashes (got ${JSON.stringify(runId)})`,
            runId,
        );
    }
    return runId;
}

/**
 * Wait up to `timeoutMs` (required; callers pass {@link asyncRegisterTimeoutMs} so the
 * `bootstrap.options` chain applies) for the async worker to register `runId`, returning
 * true once `spur workflow trace <runId>` resolves. The nohup + `&` wrapper in
 * `spawnAsyncWorkflowWorker` makes a dead-on-arrival worker invisible on every
 * channel (the shell exits 0, output is discarded, `rejectOnError: false`), so a
 * failed spawn otherwise reports a phantom run id that a caller polls forever. Only
 * an existing run row proves the handle is real (task 0484 R2).
 */
export async function waitForRunRegistration(
    service: Pick<WorkflowAppService, 'trace'>,
    runId: string,
    timeoutMs: number,
    pollMs = 250,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        try {
            await service.trace(runId);
            return true;
        } catch (error) {
            // 1259 R2: ONLY a genuine "Run not found" observation means "not registered yet".
            // A store/read/permission failure is not a deadline and polling cannot fix it, so it
            // propagates to the caller's bounded handler — swallowing it here is what turned a
            // broken read into a worker-failure verdict with a synchronous replay as "recovery".
            if (!isRunNotFound(error)) throw error;
            if (Date.now() >= deadline) {
                return false;
            }
            await sleep(pollMs);
        }
    }
}

/**
 * The engine's own "this run row does not exist" signal — the ONE absence predicate shared by the
 * registration poll (1259 R2) and the pre-launch existing-run check (0901 R1).
 */
function isRunNotFound(error: unknown): boolean {
    return error instanceof Error && error.message.startsWith('Run not found:');
}

/**
 * 0901 R1: existing-run check before any run-banner/plan/log mutation or worker
 * launch. Only a genuine `Run not found` counts as absence — DB failures
 * propagate so a broken store never silently enables an overwrite. The engine's
 * createRun collision check remains the race backstop.
 */
export async function existingWorkflowRun(service: Pick<WorkflowAppService, 'trace'>, runId: string): Promise<boolean> {
    if (runId === '') return false;
    try {
        await service.trace(runId);
        return true;
    } catch (error) {
        if (isRunNotFound(error)) return false;
        throw error;
    }
}

/** 0901 R1 refusal message for an existing run id. */
export function existingRunRefusal(runId: string): string {
    return `workflow run: run id ${runId} already exists — refusing to overwrite. Choose a fresh id with --run-id.`;
}

/**
 * 1072 R3: refuse an illegal `--from` / `--from-run` BEFORE any plan artifact, run
 * record, run row or async worker exists. Returns `true` when the run may proceed;
 * otherwise it writes the refusal, sets exit 2, and returns `false`.
 *
 * The source-run read goes through the SAME `readContinuedFrom` seam the app service
 * uses for var inheritance, so the pre-check exercises exactly the read the run will
 * take (same existence and readability rule), instead of a second, divergent lookup.
 * The app service re-validates on `run()` (and would refuse before the run row); this
 * earlier gate exists because the async launcher resolves the definition and writes
 * the plan artifact itself, so the engine never gets the chance to refuse first.
 */
async function refuseIllegalStartState(
    context: CliContext,
    options: Record<string, unknown>,
    workflow: ResolvedWorkflowDefinition['workflow'],
    fromState: string | undefined,
    fromRun: string | undefined,
): Promise<boolean> {
    if (fromState === undefined) return true;
    try {
        assertStartStateStartable(workflow, fromState);
    } catch (error) {
        writeJsonError(
            context.output,
            options,
            error instanceof Error ? error.message : String(error),
            'VALIDATION_FAILED',
        );
        context.setExitCode(2);
        return false;
    }
    if (fromRun !== undefined) {
        try {
            await readContinuedFrom(await context.getDb(), fromRun);
        } catch (error) {
            writeJsonError(
                context.output,
                options,
                error instanceof Error ? error.message : String(error),
                'VALIDATION_FAILED',
            );
            context.setExitCode(2);
            return false;
        }
    }
    return true;
}

/**
 * Verify the worker's own resolution against the expected digest shipped by the
 * async launcher (0768 R2). Returns the refusal message, or null when the run
 * may start. A missing resolution counts as a mismatch: the worker cannot prove
 * it is executing what the launcher planned.
 */
export function expectedDigestMismatch(
    resolvedDigest: string | undefined,
    expectedDigest: string | undefined,
): string | null {
    if (expectedDigest === undefined) return null;
    if (resolvedDigest !== expectedDigest) {
        return (
            'workflow run: refusing to start — resolved definition digest ' +
            `${resolvedDigest ?? '<resolution failed>'} differs from the expected digest ` +
            `${expectedDigest} sent by the async launcher`
        );
    }
    return null;
}

/**
 * Write the run-scoped plan artifact `.spur/run/<runId>-workflow-plan.json`
 * BEFORE an async worker starts (0768 R2): the show-compatible todo projection
 * plus the runId. Step descriptions pass through the same redaction + bounding
 * as other observability surfaces. Throws on write failure — the caller must
 * not start actions when the artifact cannot be written.
 */
export async function writeWorkflowPlanArtifact(
    cwd: string,
    runId: string,
    resolved: ResolvedWorkflowDefinition,
    secretValues: readonly string[],
    startState?: string,
): Promise<string> {
    const def = resolved.workflow;
    // 1072 R4: a continued run marks the steps that precede its start point with the
    // existing `unattempted` outcome — never `completed` — so the plan artifact cannot
    // claim work this run will not do.
    const preStart = startState === undefined ? undefined : preStartStepIds(def, startState);
    const payload = toJson({
        runId,
        name: def.name,
        kind: def.kind ?? 'state-machine',
        format: 'todo',
        version: def.version ?? null,
        definitionDigest: resolved.digest,
        ...(startState !== undefined ? { startState } : {}),
        steps: buildWorkflowSteps(def).map((step) => ({
            ...step,
            ...(startState === undefined
                ? {}
                : step.id === startState
                  ? { outcome: 'active' as const, note: 'run start state' }
                  : preStart?.has(step.id) === true
                    ? { outcome: 'unattempted' as const, note: 'before start state' }
                    : {}),
            ...(step.description !== undefined
                ? { description: redactAndBound(step.description, secretValues, 512) }
                : {}),
        })),
    });
    const { mkdir, writeFile } = await import('node:fs/promises');
    const artifactsDir = join(cwd, '.spur', 'run');
    await mkdir(artifactsDir, { recursive: true });
    const artifactPath = join(artifactsDir, `${runId}-workflow-plan.json`);
    await writeFile(artifactPath, payload);
    return artifactPath;
}

/**
 * Parse the `--vars` flag into a string→string map, or `undefined` when absent.
 * Workflow vars are `Record<string, string>`; reject anything else loudly rather
 * than passing malformed values into the engine's template resolution.
 */
function parseVars(raw: string | undefined): Record<string, string> | undefined {
    if (raw === undefined) {
        return undefined;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(`--vars must be a valid JSON object: ${raw}`);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('--vars must be a JSON object, e.g. \'{"taskId":"0042"}\'');
    }
    const vars: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
        if (typeof value !== 'string') {
            throw new Error(`--vars values must be strings; "${key}" is ${typeof value}`);
        }
        vars[key] = value;
    }
    return vars;
}

/** Submit one local steering line and report malformed input without throwing. */
export function submitSteeringLine(
    controller: WorkflowSteeringController,
    output: { error(message: string): void },
    line: string,
): void {
    const ack = controller.submitLine(line);
    if (ack === undefined) output.error(`[steer] ignored command: ${line}`);
}

/** Register `spur workflow run`. */
export function registerWorkflowRunCommand(workflow: Command, context: CliContext): void {
    workflow
        .command('run')
        .description('Execute a workflow definition.')
        .argument('<file>', 'Workflow YAML file')
        .option(...SHARED_OPTIONS.runIdWorkflow)
        .option('--vars <json>', 'Per-run variable overrides as a JSON object, e.g. \'{"taskId":"0042"}\'')
        .option(...SHARED_OPTIONS.dryRunWorkflowValidate)
        .option(
            '--async',
            'Start the workflow in the background and exit immediately — monitor with `spur workflow trace <run-id>`',
        )
        .option(
            '--from <state-id>',
            'Start a FRESH run at this state/node (which must be declared startable: true) instead of the entry point',
        )
        .option('--from-run <run-id>', "With --from: inherit the source run's effective vars and record lineage")
        .option('--no-plan', 'Suppress the run-start plan preview (synchronous runs only)')
        .option('--quiet', 'Suppress plan and per-step progress; keep the final summary')
        .option('--silent', 'Suppress all routine output; errors still set a non-zero exit status')
        .option(...SHARED_OPTIONS.verboseWorkflow)
        .option('--detail <level>', 'Human detail level: minimal, invocation, or full')
        .option('--trace-file', 'Append a redacted schema-versioned JSONL trace under .spur/workflow/')
        .option('--no-log', 'Opt out of writing the two-file run record .spur/memory/runs/<RUNID>.md + .state.json')
        .option('--steer', 'Accept local in-process steering commands on stdin at declared action boundaries')
        .option(...SHARED_OPTIONS.jsonSupported)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (file, options) => {
            // 1117: consume the launcher→worker handshake at entry — the worker's own
            // digest check and pid recording below use the captured values; step children
            // get a clean env (the --async launcher re-injects both explicitly).
            const { expectedDigest, isAsyncWorker } = takeAsyncWorkerEnv();
            const json = options.json === true;
            const silent = !json && options.silent === true;
            const quiet = !json && options.quiet === true;
            if (!json && options.quiet === true && options.verbose === true) {
                writeJsonError(
                    context.output,
                    options,
                    '--quiet and --verbose are mutually exclusive',
                    'VALIDATION_FAILED',
                );
                context.setExitCode(2);
                return;
            }
            if (!json && options.silent === true && (options.quiet === true || options.verbose === true)) {
                writeJsonError(
                    context.output,
                    options,
                    '--silent cannot be combined with --quiet or --verbose',
                    'VALIDATION_FAILED',
                );
                context.setExitCode(2);
                return;
            }
            if (options.steer === true && (json || options.async === true)) {
                writeJsonError(
                    context.output,
                    options,
                    '--steer is synchronous and in-process; it cannot be combined with --json or --async',
                    'VALIDATION_FAILED',
                );
                context.setExitCode(2);
                return;
            }
            const requestedDetail = options.detail as string | undefined;
            if (requestedDetail !== undefined && !['minimal', 'invocation', 'full'].includes(requestedDetail)) {
                writeJsonError(
                    context.output,
                    options,
                    '--detail must be one of: minimal, invocation, full',
                    'VALIDATION_FAILED',
                );
                context.setExitCode(2);
                return;
            }
            const detail: WorkflowOutputDetail =
                options.verbose === true
                    ? 'full'
                    : ((requestedDetail as WorkflowOutputDetail | undefined) ?? 'invocation');

            // 1072 R3: `--from-run` is lineage for a start point; without a start point
            // there is nothing to continue from.
            if (options.fromRun !== undefined && options.from === undefined) {
                writeJsonError(
                    context.output,
                    options,
                    '--from-run requires --from: lineage needs a start state',
                    'VALIDATION_FAILED',
                );
                context.setExitCode(2);
                return;
            }

            // Nested-run refusal (task 0610 R4). Refuse BEFORE any side effect — no run record, no
            // worktree, no agent spawn.
            if (getEnvVar(WORKFLOW_RUN_ACTIVE_ENV) === '1') {
                writeJsonError(
                    context.output,
                    options,
                    `workflow run: refusing to start — already inside an active workflow run (${WORKFLOW_RUN_ACTIVE_ENV}=1).\n` +
                        'A pipeline that starts another pipeline forks a worktree and an agent run per level, without bound.\n' +
                        'If you are an agent running inside a pipeline step: do NOT start a pipeline here. Report what you\n' +
                        'needed and let the operator run it from a clean shell.',
                    'VALIDATION_FAILED',
                );
                context.setExitCode(1);
                return;
            }

            // When --async, spawn a detached child process that runs the workflow
            // synchronously and exit immediately with the run ID. The child is its
            // own session/process-group LEADER (`detached: true` → setsid), so it
            // survives parent termination AND its pid doubles as a group id: the
            // worker self-records that pid (SPUR_ASYNC_WORKER=1 → recordSelfPid), and
            // `spur workflow cancel` SIGTERMs the negated pid to reach the worker +
            // the agent.run grandchild it spawns.
            if (options.async) {
                let runId: string;
                try {
                    runId = validateRunId(options.runId) || crypto.randomUUID();
                } catch (error) {
                    if (error instanceof InvalidRunIdError) {
                        writeJsonError(context.output, options, error.message, 'VALIDATION_FAILED');
                    } else {
                        writeJsonError(
                            context.output,
                            options,
                            error instanceof Error ? error.message : String(error),
                            'VALIDATION_FAILED',
                        );
                    }
                    context.setExitCode(1);
                    return;
                }
                // 0901 R1: refuse an existing id BEFORE resolving/writing the plan
                // artifact or launching the worker.
                if (await existingWorkflowRun(makeWorkflowService(context, options.json), runId)) {
                    writeJsonError(context.output, options, existingRunRefusal(runId), 'VALIDATION_FAILED');
                    context.setExitCode(1);
                    return;
                }
                const spurParts = resolveSpurBin().split(' ');
                const spurBin = spurParts[0] ?? process.execPath;
                const spurArgs = spurParts.slice(1);
                const cmd: string[] = [...spurArgs, 'workflow', 'run', file, '--run-id', runId];
                if (options.vars) {
                    cmd.push('--vars', options.vars);
                }
                if (options.dryRun) {
                    cmd.push('--dry-run');
                }
                if (options.traceFile) {
                    cmd.push('--trace-file');
                }
                if (options.log === false) {
                    cmd.push('--no-log');
                }
                // 1072 R6: the worker re-validates and re-resolves from these flags, so
                // the continued run's start point and lineage cross the process boundary.
                if (options.from !== undefined) {
                    cmd.push('--from', options.from);
                }
                if (options.fromRun !== undefined) {
                    cmd.push('--from-run', options.fromRun);
                }
                // 0768 R2: the launcher resolves the definition and writes the
                // run-scoped plan artifact BEFORE the worker starts. A resolution
                // failure or an artifact-write failure must not start actions, so
                // both abort the async launch here.
                let resolvedDefinition: ResolvedWorkflowDefinition;
                let planArtifactPath: string;
                try {
                    resolvedDefinition = await resolveWorkflowDefinition(context.cwd, file, {
                        embeddedSchemas: EMBEDDED_SPUR_SCHEMAS,
                        registered: resolveWorkflowPaths(context.spurConfig ?? null),
                    });
                    // 1072 R3: refuse an illegal start point before the plan artifact below.
                    if (
                        !(await refuseIllegalStartState(
                            context,
                            options,
                            resolvedDefinition.workflow,
                            options.from,
                            options.fromRun,
                        ))
                    ) {
                        return;
                    }
                    planArtifactPath = await writeWorkflowPlanArtifact(
                        context.cwd,
                        runId,
                        resolvedDefinition,
                        configuredSecretValues(context.env),
                        options.from,
                    );
                } catch (error) {
                    writeJsonError(
                        context.output,
                        options,
                        `workflow run --async: ${error instanceof Error ? error.message : String(error)}`,
                        'VALIDATION_FAILED',
                    );
                    context.setExitCode(1);
                    return;
                }
                try {
                    // Detached via ProcessExecutor + nohup (SPUR_ASYNC_WORKER set in env);
                    // the expected digest crosses the process boundary so the worker can
                    // verify its own resolution before acting (0768 R2).
                    await spawnAsyncWorkflowWorker(spurBin, cmd, {
                        SPUR_EXPECTED_DEFINITION_DIGEST: resolvedDefinition.digest,
                    });
                } catch {
                    // If spawn throws, fall through to the sync path so the workflow still runs.
                    markWorkflowRunActive();
                    let result: Awaited<ReturnType<WorkflowAppService['run']>>;
                    try {
                        result = await makeWorkflowService(context, options.json).run(file, {
                            runId,
                            vars: { spurBin: resolveSpurBin(), ...parseVars(options.vars) },
                            dryRun: options.dryRun || undefined,
                            // 1072 R2: the fresh start point and its lineage.
                            ...(options.from !== undefined ? { startState: options.from } : {}),
                            ...(options.fromRun !== undefined ? { continuedFrom: options.fromRun } : {}),
                            // 0768 R1: the fallback run reuses the launcher's resolution.
                            resolvedDefinition,
                            // 0901 R5: shell streams persisted by this run pass the
                            // secret redactor before the 64 KiB tail bound.
                            redactor: createShellOutputRedactor(configuredSecretValues(context.env)),
                        });
                    } finally {
                        clearWorkflowRunActive();
                    }
                    if (json) context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
                    else if (!silent) {
                        context.output.write(
                            `workflow ${result.status}: ${result.workflowName} -> ${result.finalState} (async spawn failed, ran sync)`,
                        );
                    }
                    context.setExitCode(result.status === 'done' ? 0 : 1);
                    // Pipeline-run completion trigger (task 0549) — the async-spawn
                    // fallback completed a run synchronously, so it counts.
                    await maybeTriggerHistoryRefresh(context, 'pipeline-run', runId);
                    return;
                }
                // Confirm the run actually registered before reporting 'started'. The nohup + `&`
                // wrapper in spawnAsyncWorkflowWorker makes a dead-on-arrival worker invisible on
                // every channel, so a failed spawn would otherwise print a phantom run id that
                // `spur workflow trace` cannot resolve and the caller would poll forever (0484 R2).
                // 1259 R7/R8: confirmation runs once. A deadline expiry and a read failure are
                // different observations and say so; neither dispatches anything further, and the
                // started response below stays exactly as it was for a confirmed run.
                const registrationTimeoutMs = asyncRegisterTimeoutMs(context.spurConfig);
                let registered = false;
                let registrationReadError: string | undefined;
                try {
                    registered = await waitForRunRegistration(
                        makeWorkflowService(context, options.json),
                        runId,
                        registrationTimeoutMs,
                    );
                } catch (error) {
                    // 1259 R2: the store could not be read — redact it, name it, and never
                    // recommend (or perform) a replay that could duplicate side effects.
                    const message = error instanceof Error ? error.message : String(error);
                    registrationReadError = redactAndBound(message, configuredSecretValues(context.env), 512);
                }
                if (!registered) {
                    // Deliberately omit runId from BOTH payloads: this handle is precisely the
                    // phantom R2 exists to suppress, and a machine caller reading `.runId`
                    // without checking `.status` would poll it forever — the exact failure the
                    // human-readable branch already avoids (0484 R2).
                    // It is also omitted from the guidance: the id is what the operator checks
                    // WITH, never a confirmed handle.
                    const reason =
                        registrationReadError !== undefined
                            ? `async run registration could not be read: ${registrationReadError}`
                            : `async run registration was not confirmed within ${registrationTimeoutMs}ms`;
                    const caveat =
                        registrationReadError !== undefined
                            ? 'the detached worker may or may not be running'
                            : 'the detached worker may still be starting';
                    const hint = `${caveat}; inspect "spur workflow list" and then "spur workflow trace <run-id>" before deciding whether to rerun`;
                    if (json) {
                        context.output.write(
                            toEnvelopeJson({ status: 'failed', reason, hint }, { enveloped: options.jsonEnvelope }),
                        );
                    } else if (!silent) {
                        context.output.write(`async spawn unconfirmed: ${reason} — ${hint}.`);
                    }
                    context.setExitCode(1);
                    return;
                }
                // 0768 R2: stamp the plan-artifact pointer onto the run row so
                // trace/progress can surface it. Best-effort — the worker is
                // already running, so a metadata failure must not undo registration.
                try {
                    await makeWorkflowService(context, options.json).stampPlanArtifactPath(runId, planArtifactPath);
                } catch {
                    // Metadata stamp failure cannot unstart the run.
                }
                const asyncResult = { runId, status: 'started', workflowName: file, planArtifactPath };
                if (json) context.output.write(toEnvelopeJson(asyncResult, { enveloped: options.jsonEnvelope }));
                else if (!silent) {
                    context.output.write(
                        `Started async run: ${runId}\nPlan: ${planArtifactPath}\nMonitor with: spur workflow trace ${runId} --follow`,
                    );
                }
                context.setExitCode(0);
                return;
            }
            // Inject a PATH-independent spur invocation so workflow shell guards
            // (e.g. `${vars.spurBin} task check ${vars.wbs}`) resolve the correct
            // binary inside the execa-spawned subprocess, whose env may lack PATH.
            // User-supplied --vars win on conflict (spread last is intentional here:
            // spurBin is a default, overridable only if a caller deliberately sets it).
            const vars = { spurBin: resolveSpurBin(), ...parseVars(options.vars) };

            // Validate --run-id BEFORE any path is constructed (0753 R2 / F-6).
            // A run ID containing a path separator, traversal segment, absolute
            // path, or shell metacharacter must be rejected at parse time, not
            // rewritten — a silent rewrite breaks correlation with the operator's
            // typed value. An empty input is allowed; the caller mints a UUID.
            let runId: string;
            try {
                runId = validateRunId(options.runId) || crypto.randomUUID();
            } catch (error) {
                if (error instanceof InvalidRunIdError) {
                    writeJsonError(context.output, options, error.message, 'VALIDATION_FAILED');
                } else {
                    writeJsonError(
                        context.output,
                        options,
                        error instanceof Error ? error.message : String(error),
                        'VALIDATION_FAILED',
                    );
                }
                context.setExitCode(1);
                return;
            }

            // 0901 R1: refuse an operator-supplied id that already exists BEFORE any
            // banner/plan/log mutation. Freshly minted UUIDs cannot collide.
            if (options.runId && (await existingWorkflowRun(makeWorkflowService(context, json), runId))) {
                writeJsonError(context.output, options, existingRunRefusal(runId), 'VALIDATION_FAILED');
                context.setExitCode(1);
                return;
            }

            // Observability: always build a CLI-local bus so engine + adapter events
            // reach the system_events ledger (task 0370). Human progress / --trace-file
            // / --steer reuse the same bus; under --json the progress handlers stay off
            // so machine output remains byte-identical. commander negates --no-plan to
            // options.plan=false.
            const humanProgress = !json && !quiet && !silent;
            const bus: WorkflowObservabilityBus = new EventBus();
            // SAFETY: the same EventBus serves as both the workflow observability bus and the system-event
            // ledger bridge; the nominal WorkflowObservabilityBus/SystemEventBus types are structurally one.
            const ledger = await attachSystemEventLedger(bus as unknown as SystemEventBus, context);
            // 0799 R1: persist quota events from this run's agent dispatches so the
            // server can apply them after restart, independent of this process's exit.
            // SAFETY: one structural ts-infra EventBus behind the nominal names (ADR-044).
            const quotaPersistence = attachAgentQuotaPersistence(bus as unknown as AgentQuotaEventBus, context);
            let traceWriter: WorkflowTraceWriter | undefined;
            const heartbeats = new Map<string, ReturnType<typeof setInterval>>();
            if (options.traceFile === true) {
                traceWriter = new WorkflowTraceWriter(context.cwd, runId);
                traceWriter.attach(bus);
            }
            // Plan preview (R2/0768): rendered once from the resolved definition,
            // shared by the human renderer and the consolidated run log. Resolution
            // happens ONCE here (0768 R1) and is handed to the run so plan, identity
            // stamp, and engine share one resolution. Advisory for the launcher — a
            // resolution failure must not block the run (the engine surfaces it).
            // As WORKER (an expected digest was captured at action entry), resolution is NOT
            // advisory: the launcher's expected digest must match this process's own
            // resolution before any action starts (0768 R2).
            let resolvedDefinition: ResolvedWorkflowDefinition | undefined;
            if (options.plan !== false || expectedDigest !== undefined) {
                try {
                    resolvedDefinition = await resolveWorkflowDefinition(context.cwd, file, {
                        embeddedSchemas: EMBEDDED_SPUR_SCHEMAS,
                        registered: resolveWorkflowPaths(context.spurConfig ?? null),
                    });
                } catch (error) {
                    if (expectedDigest !== undefined) {
                        // Worker: fail BEFORE actions — the launcher could not have
                        // planned for a definition this process cannot resolve.
                        writeJsonError(
                            context.output,
                            options,
                            `workflow run: refusing to start — ${error instanceof Error ? error.message : String(error)}`,
                            'VALIDATION_FAILED',
                        );
                        context.setExitCode(1);
                        return;
                    }
                    // Launcher: preview is advisory.
                }
            }
            const mismatch = expectedDigestMismatch(resolvedDefinition?.digest, expectedDigest);
            if (mismatch !== null) {
                writeJsonError(context.output, options, mismatch, 'VALIDATION_FAILED');
                context.setExitCode(1);
                return;
            }
            let planPreview: string | undefined;
            if (options.plan !== false && resolvedDefinition !== undefined) {
                // 1072 R3: the sync path refuses the start point before the preview and
                // before the service call, so a refused run leaves nothing behind either.
                if (
                    !(await refuseIllegalStartState(
                        context,
                        options,
                        resolvedDefinition.workflow,
                        options.from,
                        options.fromRun,
                    ))
                ) {
                    return;
                }
                planPreview = renderRunPlan(resolvedDefinition.workflow, options.from);
            }
            // 0777 R4 (F4): run-start capability preflight — BEFORE plan display and
            // any dispatch, warn when a pinned executor cannot satisfy a step's
            // requiresCapabilities under attestation. Advisory only: the fail-closed
            // pre-spawn gate (0706 R5) still refuses the dispatch; this moves the
            // signal from ~1s-after-launch to run start.
            if (resolvedDefinition !== undefined) {
                const executors = context.spurConfig?.agent?.executors;
                const flow = resolvedDefinition.workflow;
                const agentRunActions =
                    // `kind` is optional on the state-machine shape, so a discriminant test cannot
                    // narrow the union; membership does (`nodes` exists on transition-flow and dag).
                    'nodes' in flow
                        ? flow.nodes.flatMap((node) => (node.action?.kind === 'agent.run' ? [node.action] : []))
                        : flow.states.flatMap((state) => (state.onEnter ?? []).filter((a) => a.kind === 'agent.run'));
                for (const action of agentRunActions) {
                    const pin = action.options?.agent;
                    const requires = parseRequiresCapabilities(action.options?.requiresCapabilities);
                    if (typeof pin !== 'string' || !requires.ok) continue;
                    const evaluation = evaluateCapabilities(
                        requires.requires,
                        executors?.find((e) => e.name === pin),
                    );
                    if (!evaluation.ok) {
                        context.output.error(
                            `Warning: capability preflight (0777 R4): ${capabilityDiagnostic(pin, evaluation)}`,
                        );
                    }
                }
            }
            // Two-file run record (E7 / task 0925, on the feature D2 / 0426 sink): a
            // read-only subscriber on the bus that appends the durable record pair
            // `.spur/memory/runs/<RUNID>.md` + `.state.json` from creation to
            // terminal status (1026 R1: records are written outside scratch).
            // Built by default (retained after the run ends);
            // `--no-log` (task 0427) opts out entirely so no file is opened or written.
            // Configured secrets are re-scrubbed at the sink's persistence boundary.
            const runLog =
                options.log === false
                    ? undefined
                    : new WorkflowRunLogSink({
                          bus,
                          dir: runStoragePaths(context.cwd).recordsDir,
                          runId,
                          ...(planPreview !== undefined ? { planPreview } : {}),
                          // 1072 R7: lineage in the two-file run record's state projection.
                          ...(options.from !== undefined || options.fromRun !== undefined
                              ? {
                                    lineage: {
                                        ...(options.from !== undefined ? { startState: options.from } : {}),
                                        ...(options.fromRun !== undefined ? { continuedFrom: options.fromRun } : {}),
                                    },
                                }
                              : {}),
                          secrets: configuredSecretValues(context.env),
                          ...resolveOutputLogConfig(context.spurConfig ?? null),
                      });
            // Escalation packets (task 0709): project the canonical packet on
            // trip wires and terminal failures. Advisory — construction never
            // aborts the run, and projection failure cannot erase the failure.
            const escalationSink = await makeEscalationPacketSink(bus, context);
            if (humanProgress) {
                // 1064 R1: the run id prints only once the row is committed, signalled
                // by `workflow.run.started` (the adapter emits it after `createRun`
                // inserts). A pre-row failure now exits without printing an id or
                // creating a record. One-shot via a local latch: the bus can carry two
                // `workflow.run.started` projections (adapter verb-form + engine-native
                // bridge), and EventBus may lack `once`. Subscribed before the report
                // handlers below so the header precedes the first progress line.
                let headerPrinted = false;
                bus.on('workflow.run.started', (event) => {
                    if (headerPrinted) return;
                    headerPrinted = true;
                    context.output.write(`Run: ${event.runId}`);
                    if (planPreview !== undefined) context.output.write(planPreview);
                });
                // Single-run CLI (one `workflow run` = one runId): the run id is
                // already printed in the header, so progress lines omit the
                // `[run <id>]` prefix (R1). showRunId can be re-enabled for
                // multi-run/verbose consumers.
                const stepOptions = { detail, showRunId: false } as const;
                const report = (event: StepEvent): void => {
                    const line = renderStepLine(event, stepOptions);
                    if (line !== null) context.output.write(line);
                };
                bus.on('workflow.phase', report);
                // R7: transitions render in `invocation` (default) and `full`; only
                // `minimal` suppresses them. The renderer owns the detail gate
                // (`step-reporter.ts` `isTransition` branch), so subscribe whenever
                // detail is not minimal.
                if (detail !== 'minimal') bus.on('workflow.transition', report);
                bus.on('workflow.action.started', (event) => {
                    report(event);
                    const startedAt = Date.parse(event.at);
                    const timer = setInterval(() => {
                        const line = renderActionHeartbeat(event, Math.max(0, Date.now() - startedAt), stepOptions);
                        if (line !== null) context.output.write(line);
                    }, 30_000);
                    timer.unref?.();
                    heartbeats.set(event.actionId, timer);
                });
                bus.on('workflow.action.finished', (event) => {
                    const timer = heartbeats.get(event.actionId);
                    if (timer !== undefined) clearInterval(timer);
                    heartbeats.delete(event.actionId);
                    report(event);
                });
                bus.on('workflow.agent', (event) => {
                    if (event.kind === 'started' && event.actionId !== undefined) {
                        const timer = heartbeats.get(event.actionId);
                        if (timer !== undefined) clearInterval(timer);
                        heartbeats.delete(event.actionId);
                    }
                    report(event);
                });
                // Live shell output chunks (task 0421 R9): streamed stdout/stderr
                // from shell actions render as indented child lines while the
                // command is still running.
                bus.on('workflow.action.output', report);
            }
            const steeringController =
                options.steer === true
                    ? await (async () => {
                          // R3 (0601): identity is derived once from the resolved def so
                          // steering acks carry workflowName + nodeLabel (0768 R1: the
                          // resolve-once result is reused — no second parse). An absent
                          // resolution degrades to undecorated acks (steering must still
                          // work).
                          let identity: { workflowName: string; nodeLabels: ReadonlyMap<string, string> } | undefined;
                          if (resolvedDefinition !== undefined) {
                              identity = createWorkflowEventIdentity(resolvedDefinition.workflow);
                          }
                          return new WorkflowSteeringController(
                              (ack) => {
                                  void bus.emit(
                                      'workflow.steering',
                                      identity === undefined
                                          ? ack
                                          : (decorateWorkflowEvent(identity, 'workflow.steering', ack) as SteeringAck),
                                  );
                                  context.output.write(
                                      `[steer] ${ack.accepted ? 'ack' : 'nack'} ${ack.operation} · ${ack.reason ?? `version=${ack.version}`}`,
                                  );
                              },
                              configuredSecretValues(context.env),
                              new Set(['operator']),
                              (snapshot) => {
                                  if (snapshot.state === 'boundary') {
                                      context.output.write(
                                          `[steer] boundary action=${snapshot.actionId} version=${snapshot.version} · commands: continue | note <text> | retry | abort`,
                                      );
                                  }
                              },
                          );
                      })()
                    : undefined;
            const steeringInput =
                steeringController === undefined
                    ? undefined
                    : createInterface({ input: process.stdin, terminal: process.stdin.isTTY === true });
            if (steeringInput !== undefined && steeringController !== undefined) {
                steeringInput.on('line', submitSteeringLine.bind(undefined, steeringController, context.output));
            }

            let result: Awaited<ReturnType<WorkflowAppService['run']>>;
            try {
                markWorkflowRunActive();
                result = await makeWorkflowService(context, json, bus).run(file, {
                    runId,
                    vars,
                    dryRun: options.dryRun || undefined,
                    // 1072 R2: the fresh start point and its lineage.
                    ...(options.from !== undefined ? { startState: options.from } : {}),
                    ...(options.fromRun !== undefined ? { continuedFrom: options.fromRun } : {}),
                    // Async worker self-records its pid so `spur workflow cancel` can
                    // signal the live process group (captured from the launcher env at
                    // action entry).
                    recordSelfPid: isAsyncWorker,
                    // 0901 R5: shell streams persisted by this run pass the secret
                    // redactor before the 64 KiB tail bound.
                    redactor: createShellOutputRedactor(configuredSecretValues(context.env)),
                    ...(steeringController !== undefined ? { steeringController } : {}),
                    // 0768 R1: plan preview, identity stamp, and engine share the one
                    // resolution made above (resolve-once).
                    ...(resolvedDefinition !== undefined ? { resolvedDefinition } : {}),
                });
            } finally {
                clearWorkflowRunActive();
                for (const timer of heartbeats.values()) clearInterval(timer);
                heartbeats.clear();
                await traceWriter?.flush();
                runLog?.close();
                await escalationSink?.flush();
                await ledger.flush();
                ledger.unsubscribe();
                // 0799 R1: flush recorded quota observations before process exit.
                await quotaPersistence.flush();
                quotaPersistence.unsubscribe();
                steeringInput?.close();
            }
            if (json) context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
            else if (!silent) {
                context.output.write(
                    `workflow ${result.status}: ${result.workflowName} -> ${result.finalState}${typeof result.reason === 'string' ? ` — ${result.reason}` : ''}`,
                );
            }
            context.setExitCode(result.status === 'done' ? 0 : 1);
            // Pipeline-run completion trigger (task 0549 R1): a run reaching terminal
            // status enqueues a coalesced history refresh. The `--async` launcher does
            // NOT reach here — its detached worker runs the sync path above, so the
            // trigger fires exactly once, in the worker.
            await maybeTriggerHistoryRefresh(context, 'pipeline-run', runId);
        });
}
