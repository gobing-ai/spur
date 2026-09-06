import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Command } from '@commander-js/extra-typings';
import {
    buildWorkflowSteps,
    configuredSecretValues,
    createWorkflowEventIdentity,
    decorateWorkflowEvent,
    EscalationPacketSink,
    type ResolvedWorkflowDefinition,
    redactAndBound,
    renderActionHeartbeat,
    renderRunPlan,
    renderStepLine,
    renderWorkflowTodo,
    resolveOutputLogConfig,
    resolveWorkflowDefinition,
    resolveWorkflowFile,
    resolveWorkflowLogRetentionDays,
    type SteeringAck,
    type StepEvent,
    type SystemEventBus,
    type TimelineEvent,
    WorkflowAppService,
    type WorkflowListEntry,
    type WorkflowListResult,
    type WorkflowObservabilityBus,
    type WorkflowOutputDetail,
    WorkflowRunLogSink,
    WorkflowSteeringController,
    type WorkflowTraceListResult,
    type WorkflowTraceTimeline,
    WorkflowTraceWriter,
} from '@gobing-ai/spur-app';
import {
    capabilityDiagnostic,
    evaluateCapabilities,
    parseRequiresCapabilities,
} from '@gobing-ai/spur-app/capability-attestation';
import type { SpurConfig } from '@gobing-ai/spur-config';
import { bundledConfigRoot } from '@gobing-ai/spur-config/loader';
import type { ActionCost } from '@gobing-ai/spur-domain';
import { EventBus } from '@gobing-ai/ts-infra';
import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import { EMBEDDED_SPUR_SCHEMAS } from '../config/embedded-schemas';
import type { CliContext } from '../context';
import { maybeTriggerHistoryRefresh } from '../history-refresh';
import { toEnvelopeJson, toJson, writeJsonError } from '../output';
import { attachSystemEventLedger } from '../system-event-ledger';
import { renderWorkflowMermaid } from '../workflow/mermaid-render';
import { resolveSpurBin } from '../workflow/resolve-spur-bin';
import { SHARED_OPTIONS } from './shared-options';
import { makeTaskLocator } from './task';

/** POSIX single-quote for `sh -c` argv embedding. */
function shQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

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
    process.env[WORKFLOW_RUN_ACTIVE_ENV] = '1';
}

/**
 * Clear the marker once the run finishes. Children spawned DURING the run already inherited their
 * own copy, so clearing does not weaken the guard — it keeps the marker scoped to the run rather
 * than poisoning the process (which would refuse a legitimate second run in the same process, and
 * leaks across in-process tests).
 */
function clearWorkflowRunActive(): void {
    delete process.env[WORKFLOW_RUN_ACTIVE_ENV];
}

/**
 * Launch a long-lived async workflow worker via ProcessExecutor + nohup.
 * Avoids direct child_process.spawn (no-direct-process-spawn).
 */
async function spawnAsyncWorkflowWorker(
    spurBin: string,
    cmd: string[],
    extraEnv?: Record<string, string>,
): Promise<void> {
    const line = [spurBin, ...cmd].map(shQuote).join(' ');
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
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
        command: process.platform === 'win32' ? 'cmd' : '/bin/sh',
        args:
            process.platform === 'win32'
                ? ['/c', `start /b "" ${[spurBin, ...cmd].map((c) => `"${c.replace(/"/g, '""')}"`).join(' ')}`]
                : ['-c', `nohup ${line} </dev/null >/dev/null 2>&1 &`],
        env,
        forceBuffered: true,
        rejectOnError: false,
    });
}

/**
 * Registration-confirmation budget in ms. 5s is ample for a local worker to write its
 * run row, but a heavily loaded host can legitimately start slower — and a false
 * negative here reports a working run as failed. `SPUR_ASYNC_REGISTER_TIMEOUT_MS`
 * raises the ceiling on such hosts (and lets tests drive the failure branch without
 * paying the full wait). Invalid or non-positive values fall back to the default
 * rather than disabling the check (task 0484 R2).
 */
function asyncRegisterTimeoutMs(): number {
    const raw = Number(process.env.SPUR_ASYNC_REGISTER_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : 5000;
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
 * Format a workflow definition's optional `version` field for the validate
 * command output (0756 R2). The literal is treated as opaque — not parsed,
 * ordered, or compared for compatibility. Absent field → `unversioned`;
 * present non-empty literal → `explicit(<literal>)`. The literal is
 * wrapped in parentheses verbatim so non-semver strings surface unchanged.
 */
export function formatWorkflowVersion(version: unknown): string {
    if (version === undefined || version === null) return 'unversioned';
    if (typeof version !== 'string') return 'unversioned';
    if (version === '') return 'unversioned';
    return `explicit(${version})`;
}

/**
 * Wait up to `timeoutMs` for the async worker to register `runId`, returning true
 * once `spur workflow trace <runId>` resolves. The nohup + `&` wrapper in
 * `spawnAsyncWorkflowWorker` makes a dead-on-arrival worker invisible on every
 * channel (the shell exits 0, output is discarded, `rejectOnError: false`), so a
 * failed spawn otherwise reports a phantom run id that a caller polls forever. Only
 * an existing run row proves the handle is real (task 0484 R2).
 */
export async function waitForRunRegistration(
    service: Pick<WorkflowAppService, 'trace'>,
    runId: string,
    timeoutMs = asyncRegisterTimeoutMs(),
    pollMs = 250,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        try {
            await service.trace(runId);
            return true;
        } catch {
            if (Date.now() >= deadline) {
                return false;
            }
            await sleep(pollMs);
        }
    }
}

/** Run-scoped plan artifact path for an async run (0768 R2). */
export function workflowPlanArtifactPath(runId: string): string {
    return join('.spur', 'run', `${runId}-workflow-plan.json`);
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
): Promise<string> {
    const def = resolved.workflow;
    const payload = toJson({
        runId,
        name: def.name,
        kind: def.kind ?? 'state-machine',
        format: 'todo',
        version: def.version ?? null,
        definitionDigest: resolved.digest,
        steps: buildWorkflowSteps(def).map((step) => ({
            ...step,
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
 * Build the escalation packet sink (task 0709) for a workflow run bus.
 * Advisory: construction failures return `undefined` — an escalation outage
 * must never abort the run itself.
 */
async function makeEscalationPacketSink(
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

/**
 * Prefix for config-driven workflow paths that resolve against the installed
 * package's bundled config root at read time (`bundled:workflows` →
 * `<package>/<bundled-config>/workflows`). Read-time expansion keeps machine-specific
 * absolute paths out of user-owned config files — the shipped global default
 * survives reinstalls, package-manager switches, and dotfiles sync.
 */
const BUNDLED_PATH_PREFIX = 'bundled:';

/**
 * Read configured workflow search paths, defaulting to `['.spur/workflows/']`.
 * Sync & pure (A5/ADR-082): the merged config is threaded from the composition
 * root; `bundled:` prefix expansion is unchanged, only the config read moves out.
 */
function resolveWorkflowPaths(config: SpurConfig | null): string[] {
    const paths = config?.workflows?.paths ?? ['.spur/workflows/'];
    const bundledRoot = bundledConfigRoot();
    const expanded: string[] = [];
    for (const path of paths) {
        if (path.startsWith(BUNDLED_PATH_PREFIX)) {
            // No bundled root under `bun build --compile` — skip the tier.
            if (bundledRoot !== null) expanded.push(join(bundledRoot, path.slice(BUNDLED_PATH_PREFIX.length)));
        } else {
            expanded.push(path);
        }
    }
    return expanded;
}

/** Register `spur workflow` commands. */
export function registerWorkflowCommand(program: Command, context: CliContext): void {
    // `json` selects the HITL responder: interactive prompts must never fire under --json
    // (they would corrupt the JSON stream). Only `run`/`continue` invoke actions, so only
    // those pass json=true. When a bus is supplied it is shared by both seams:
    //   - `observabilityBus` → ObservableWorkflowAdapter verb-form events + workflow.agent
    //   - `events` → engine-native workflow.* names (run-lifecycle / HITL / custom)
    // Task 0370 attaches a SystemEventDao tap to that bus so CLI-driven runs land in
    // the shared ledger the Board reads (same direct-DAO pattern as task 0249).
    const makeSvc = (json?: boolean, bus?: WorkflowObservabilityBus) => {
        // SAFETY: the workflow observability bus is the same EventBus instance the system-event
        // ledger consumes; the branded nominal types only differ by name (ADR-044 event bridge),
        // so workflow-dispatch agent events can ride it without double-emission.
        const dispatchBus = bus as unknown as SystemEventBus | undefined;
        return new WorkflowAppService({
            cwd: context.cwd,
            spurConfig: context.spurConfig ?? null,
            secretValues: configuredSecretValues(context.env),
            warn: (message) => context.output.error(`Warning: ${message}`),
            getDb: () => context.getDb(),
            // Task 0687 R10: thread the ledger bus into AgentService so workflow-dispatched
            // agents write `agent.invoke.*` like the `spur agent run` path does
            // (`commands/agent.ts`). The prior comment here withheld the bus to avoid
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
    };

    const workflow = program.command('workflow').summary('validate and execute workflow YAML files');

    workflow
        .command('validate')
        .description('Validate a workflow definition.')
        .argument('<file>', 'Workflow YAML file')
        .option(...SHARED_OPTIONS.noSchema)
        .option(...SHARED_OPTIONS.jsonSupported)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (file, options) => {
            const result = await makeSvc().validate(file, { validateSchema: options.schema });
            if (options.json) {
                context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
            } else if (result.valid) {
                context.output.write(
                    `workflow valid: ${result.workflow.name} (${formatWorkflowVersion(result.workflow.version)})`,
                );
                const c = result.composition;
                if (c && c.findings.length > 0) {
                    for (const f of c.findings) {
                        const m =
                            f.measure.kind === 'shell-lines'
                                ? `${f.measure.measured} shell lines (threshold ${f.measure.threshold})`
                                : `${f.measure.measured} prompt chars (severity ${f.measure.severity})`;
                        context.output.error(`composition advisory: ${f.actionKey} — ${m} — ${f.recommendation}`);
                    }
                }
            } else {
                context.output.error(
                    `workflow invalid: ${result.file}\n${result.errors.map((m) => `  - ${m}`).join('\n')}`,
                );
            }
            context.setExitCode(result.valid ? 0 : 1);
        });

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
        .option('--no-plan', 'Suppress the run-start plan preview (synchronous runs only)')
        .option('--quiet', 'Suppress plan and per-step progress; keep the final summary')
        .option('--silent', 'Suppress all routine output; errors still set a non-zero exit status')
        .option(...SHARED_OPTIONS.verboseWorkflow)
        .option('--detail <level>', 'Human detail level: minimal, invocation, or full')
        .option('--trace-file', 'Append a redacted schema-versioned JSONL trace under .spur/runs/workflow/')
        .option('--no-log', 'Opt out of writing the consolidated .spur/run/<RUNID>.log')
        .option('--steer', 'Accept local in-process steering commands on stdin at declared action boundaries')
        .option(...SHARED_OPTIONS.jsonSupported)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (file, options) => {
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

            // Nested-run refusal (task 0610 R4). Refuse BEFORE any side effect — no run record, no
            // worktree, no agent spawn.
            if (process.env[WORKFLOW_RUN_ACTIVE_ENV] === '1') {
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
                // 0768 R2: the launcher resolves the definition and writes the
                // run-scoped plan artifact BEFORE the worker starts. A resolution
                // failure or an artifact-write failure must not start actions, so
                // both abort the async launch here.
                let resolvedDefinition: ResolvedWorkflowDefinition;
                let planArtifactPath: string;
                try {
                    resolvedDefinition = await resolveWorkflowDefinition(context.cwd, file, {
                        embeddedSchemas: EMBEDDED_SPUR_SCHEMAS,
                    });
                    planArtifactPath = await writeWorkflowPlanArtifact(
                        context.cwd,
                        runId,
                        resolvedDefinition,
                        configuredSecretValues(context.env),
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
                        result = await makeSvc(options.json).run(file, {
                            runId,
                            vars: { spurBin: resolveSpurBin(), ...parseVars(options.vars) },
                            dryRun: options.dryRun || undefined,
                            // 0768 R1: the fallback run reuses the launcher's resolution.
                            resolvedDefinition,
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
                if (!(await waitForRunRegistration(makeSvc(options.json), runId))) {
                    // Deliberately omit runId from BOTH payloads: this handle is precisely the
                    // phantom R2 exists to suppress, and a machine caller reading `.runId`
                    // without checking `.status` would poll it forever — the exact failure the
                    // human-readable branch already avoids (0484 R2).
                    const reason = 'async worker failed to start or register the run';
                    const hint = 'run the workflow synchronously (omit --async) to see the failure';
                    if (json) {
                        context.output.write(
                            toEnvelopeJson({ status: 'failed', reason, hint }, { enveloped: options.jsonEnvelope }),
                        );
                    } else if (!silent) {
                        context.output.write(`async spawn failed: ${reason} — ${hint}.`);
                    }
                    context.setExitCode(1);
                    return;
                }
                // 0768 R2: stamp the plan-artifact pointer onto the run row so
                // trace/progress can surface it. Best-effort — the worker is
                // already running, so a metadata failure must not undo registration.
                try {
                    await makeSvc(options.json).stampPlanArtifactPath(runId, planArtifactPath);
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
            // As WORKER (SPUR_EXPECTED_DEFINITION_DIGEST set), resolution is NOT
            // advisory: the launcher's expected digest must match this process's own
            // resolution before any action starts (0768 R2).
            const expectedDigest = process.env.SPUR_EXPECTED_DEFINITION_DIGEST;
            let resolvedDefinition: ResolvedWorkflowDefinition | undefined;
            if (options.plan !== false || expectedDigest !== undefined) {
                try {
                    resolvedDefinition = await resolveWorkflowDefinition(context.cwd, file, {
                        embeddedSchemas: EMBEDDED_SPUR_SCHEMAS,
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
                planPreview = renderRunPlan(resolvedDefinition.workflow);
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
                    flow.kind === 'transition-flow'
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
            // Consolidated all-in-one run log (feature D2 / task 0426): a read-only
            // subscriber on the bus that appends `.spur/run/<RUNID>.log` from creation
            // to terminal status. Built by default (retained after the run ends);
            // `--no-log` (task 0427) opts out entirely so no file is opened or written.
            const runLog =
                options.log === false
                    ? undefined
                    : new WorkflowRunLogSink({
                          bus,
                          dir: join(context.cwd, '.spur', 'run'),
                          runId,
                          ...(planPreview !== undefined ? { planPreview } : {}),
                          ...resolveOutputLogConfig(context.spurConfig ?? null),
                      });
            // Escalation packets (task 0709): project the canonical packet on
            // trip wires and terminal failures. Advisory — construction never
            // aborts the run, and projection failure cannot erase the failure.
            const escalationSink = await makeEscalationPacketSink(bus, context);
            if (humanProgress) {
                context.output.write(`Run: ${runId}`);
                if (planPreview !== undefined) context.output.write(planPreview);
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
                result = await makeSvc(json, bus).run(file, {
                    runId,
                    vars,
                    dryRun: options.dryRun || undefined,
                    // Async worker self-records its pid so `spur workflow cancel` can
                    // signal the live process group (set by the --async launcher).
                    recordSelfPid: process.env.SPUR_ASYNC_WORKER === '1',
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

    workflow
        .command('continue')
        .description('Resume a paused (HITL) workflow run. Omit run-id to resume the most recent paused run.')
        .argument('[run-id]', 'Run ID to resume (default: the most recent paused run)')
        .option('--yes', 'Skip the CLI resume confirmation (does not set the persisted HITL answer)')
        .option(...SHARED_OPTIONS.forceWorkflowContinue)
        .option(
            '--answer <yes|no|cancel>',
            'Inject a HITL gate answer before guard re-evaluation (0433). Does not imply --yes.',
        )
        .option(...SHARED_OPTIONS.jsonSupported)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (runId, options) => {
            const json = options.json === true;
            // Validate --answer enum (R1): commander does not natively enforce choices.
            let hitlAnswer: 'yes' | 'no' | 'cancel' | undefined;
            if (options.answer !== undefined) {
                const v = String(options.answer).toLowerCase();
                if (v !== 'yes' && v !== 'no' && v !== 'cancel') {
                    writeJsonError(
                        context.output,
                        options,
                        `Invalid --answer value "${options.answer}" - must be yes, no, or cancel.`,
                        'VALIDATION_FAILED',
                    );
                    context.setExitCode(2);
                    return;
                }
                hitlAnswer = v;
            }
            // Resume path shares the 0370 ledger bridge so continued runs also
            // surface workflow.* rows (adapter verb-form + engine-native).
            const bus: WorkflowObservabilityBus = new EventBus();
            // SAFETY: the same EventBus instance is bridged as the system-event ledger (structurally identical
            // nominal types; ADR-044 event bridge).
            const ledger = await attachSystemEventLedger(bus as unknown as SystemEventBus, context);
            // Escalation packets (task 0709): resumed runs project the same
            // canonical packet on terminal failure; idempotent per run.
            const escalationSink = await makeEscalationPacketSink(bus, context);
            const svc = makeSvc(json, bus);
            try {
                let targetId = runId;
                if (targetId === undefined) {
                    // Discover the most recent paused run (E3).
                    const latest = await svc.latestPausedRun();
                    if (latest === null) {
                        writeJsonError(context.output, options, 'No paused workflow run to continue.', 'NOT_FOUND');
                        context.setExitCode(1);
                        return;
                    }
                    targetId = latest.runId;
                    // Confirm unless --yes (or a non-interactive responder auto-accepts).
                    // R3: --answer does NOT skip this confirmation - it is a distinct concern.
                    if (options.yes !== true) {
                        const answer = await context.hitlResponder(json).respond({
                            kind: 'confirm',
                            prompt: `Resume paused run ${latest.runId} (${latest.workflowName})?`,
                            runId: latest.runId,
                            node: 'continue',
                        });
                        if (answer.value !== 'yes') {
                            writeJsonError(
                                context.output,
                                options,
                                `Aborted - run ${latest.runId} not resumed.`,
                                'GUARD_DENIED',
                            );
                            context.setExitCode(1);
                            return;
                        }
                    }
                }
                const result = await svc.continuePaused(targetId, {
                    hitlAnswer,
                    force: options.force === true ? true : undefined,
                });
                context.output.write(
                    json
                        ? toEnvelopeJson(result, { enveloped: options.jsonEnvelope })
                        : `workflow ${result.status}: ${result.workflowName} -> ${result.finalState}`,
                );
                context.setExitCode(result.status === 'done' ? 0 : 1);
                // Pipeline-run completion trigger (task 0549): resuming a paused run to a
                // terminal state is a pipeline-run completion.
                await maybeTriggerHistoryRefresh(context, 'pipeline-run', targetId);
            } catch (err) {
                writeJsonError(context.output, options, String(err));
                context.setExitCode(1);
            } finally {
                await escalationSink?.flush();
                await ledger.flush();
                ledger.unsubscribe();
            }
        });

    workflow
        .command('clean')
        .description(
            'Housekeeping: finalize orphaned runs stuck in running/pending past a staleness threshold ' +
                '(mark as failed) and reclaim retained run logs older than workflow.logRetentionDays. ' +
                '`--logs` scopes to log reclamation only. To cancel a single live run by id, use ' +
                '`spur workflow cancel <run-id>` instead.',
        )
        .option('--older-than <minutes>', 'Staleness threshold in minutes (stale-run scope only)', '30')
        .option(...SHARED_OPTIONS.forceWorkflowClean)
        .option('--logs', 'Scope to retained run-log reclamation only (skip stale-run finalization)')
        .option(...SHARED_OPTIONS.dryRunWorkflowClean)
        .option(...SHARED_OPTIONS.jsonSupported)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            const dryRun = options.dryRun === true;
            const logsOnly = options.logs === true;
            const force = options.force === true;
            const minutes = force ? 0 : Number.parseInt(options.olderThan ?? '30', 10);
            if (!Number.isFinite(minutes) || minutes < 0) {
                writeJsonError(
                    context.output,
                    options,
                    `Invalid --older-than value: ${options.olderThan}`,
                    'VALIDATION_FAILED',
                );
                context.setExitCode(2);
                return;
            }
            const svc = makeSvc(options.json);
            const result = logsOnly ? undefined : await svc.clean(minutes, dryRun);
            const retentionDays = resolveWorkflowLogRetentionDays(context.spurConfig ?? null);
            const logResult = await svc.cleanRunLogs(retentionDays, dryRun);
            const checkpointResult = logsOnly ? undefined : await svc.cleanCheckpoints(retentionDays, dryRun);
            if (options.json) {
                context.output.write(
                    toEnvelopeJson(
                        logsOnly ? logResult : { ...result, logs: logResult, checkpoints: checkpointResult },
                        { enveloped: options.jsonEnvelope },
                    ),
                );
            } else {
                if (result !== undefined) {
                    const verb = dryRun ? 'Would finalize' : 'Finalized';
                    if (result.cleaned.length === 0) {
                        const ageMsg = force ? '' : ` older than ${minutes}m`;
                        context.output.write(`No stale runs${ageMsg}.`);
                    } else {
                        const ageMsg = force ? ' (all non-terminal)' : ` (>${minutes}m)`;
                        context.output.write(
                            `${verb} ${result.cleaned.length} stale run(s)${ageMsg}:\n` +
                                result.cleaned.map((r) => `  ${r.runId} (started ${r.startedAt})`).join('\n'),
                        );
                    }
                }
                const logVerb = dryRun ? 'Would reclaim' : 'Reclaimed';
                if (logResult.reclaimed.length === 0) {
                    context.output.write(`No retained run logs older than ${retentionDays}d.`);
                } else {
                    context.output.write(
                        `${logVerb} ${logResult.reclaimed.length} retained run log(s) (>${retentionDays}d):\n` +
                            logResult.reclaimed.map((l) => `  ${l.runId} (mtime ${l.mtime})`).join('\n'),
                    );
                }
                for (const failure of logResult.failures) {
                    context.output.error(`Failed to remove run log ${failure.path}: ${failure.error}`);
                }
                if (checkpointResult !== undefined) {
                    const cpVerb = dryRun ? 'Would reclaim' : 'Reclaimed';
                    if (checkpointResult.reclaimed.length === 0) {
                        context.output.write(`No expired terminal checkpoints older than ${retentionDays}d.`);
                    } else {
                        context.output.write(
                            `${cpVerb} ${checkpointResult.reclaimed.length} expired terminal checkpoint(s) (>${retentionDays}d):\n` +
                                checkpointResult.reclaimed.map((c) => `  ${c.name} (age ${c.age})`).join('\n'),
                        );
                    }
                    for (const skip of checkpointResult.skipped) {
                        context.output.write(`  kept ${skip.name}: ${skip.reason}`);
                    }
                    for (const failure of checkpointResult.failures) {
                        context.output.error(`Failed to remove checkpoint ${failure.path}: ${failure.error}`);
                    }
                }
            }
        });

    workflow
        .command('cancel')
        .description(
            'Cancel a single non-terminal run by id (mark as failed). The bulk/stale variant is `spur workflow clean`.',
        )
        .argument('<run-id>', 'Run id to cancel')
        .option(...SHARED_OPTIONS.jsonSupported)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (runId, options) => {
            const result = await makeSvc(options.json).cancel(runId);
            if (options.json) {
                context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
                return;
            }
            if (result.status === 'not_found') {
                writeJsonError(context.output, options, `Run ${runId} not found.`, 'NOT_FOUND');
                context.setExitCode(1);
                return;
            }
            if (result.finalized) {
                const killNote = result.killed ? ' + signalled worker process group' : '';
                context.output.write(`Cancelled run ${runId} (marked failed${killNote}).`);
            } else {
                context.output.write(`Run ${runId} already terminal (${result.status}) — no change.`);
            }
        });

    workflow
        .command('list')
        .description('List available workflow YAML files.')
        .option(...SHARED_OPTIONS.jsonSupported)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            const paths = resolveWorkflowPaths(context.spurConfig ?? null);
            const result = await makeSvc().list(paths);
            if (options.json) {
                context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
            } else {
                context.output.write(formatListHuman(result));
            }
        });

    workflow
        .command('show')
        .description('Render a workflow definition: mermaid FSM diagram (default) or declared-step todo checklist.')
        .argument('<file>', 'Workflow YAML file')
        .option('--format <name>', 'Projection to render: mermaid (default) or todo', 'mermaid')
        .option(...SHARED_OPTIONS.jsonSupported)
        .action(async (file, options) => {
            // Validate the format before resolving the file so an unknown value fails fast (0695 R7).
            if (options.format !== 'mermaid' && options.format !== 'todo') {
                writeJsonError(
                    context.output,
                    options,
                    `workflow show: unknown --format '${options.format}' — expected mermaid or todo`,
                    'VALIDATION_FAILED',
                );
                context.setExitCode(1);
                return;
            }
            const resolved = resolveWorkflowFile(context.cwd, file);
            if (resolved.path === null) {
                const [probedProject, probedBundled] = resolved.probed;
                writeJsonError(
                    context.output,
                    options,
                    `workflow show: file not found: ${probedProject}${probedBundled !== null ? ` (bundled: ${probedBundled})` : ''}`,
                    'NOT_FOUND',
                );
                context.setExitCode(1);
                return;
            }
            // 0768 R1: `show` resolves through the SAME shared resolver as run/resume,
            // so the displayed identity (digest + version) is exactly what a run of
            // this file would stamp. Error envelopes are preserved: file-not-found
            // stays NOT_FOUND above; a read/parse/schema/version failure stays
            // VALIDATION_FAILED with the resolver's message.
            let resolvedDefinition: ResolvedWorkflowDefinition;
            try {
                resolvedDefinition = await resolveWorkflowDefinition(context.cwd, file, {
                    embeddedSchemas: EMBEDDED_SPUR_SCHEMAS,
                });
            } catch (err) {
                writeJsonError(
                    context.output,
                    options,
                    `workflow show: cannot read or parse ${file} — ${err instanceof Error ? err.message : String(err)}`,
                    'VALIDATION_FAILED',
                );
                context.setExitCode(1);
                return;
            }
            const def = resolvedDefinition.workflow;
            if (options.json) {
                if (options.format === 'todo') {
                    context.output.write(
                        toJson({
                            name: def.name,
                            kind: def.kind ?? 'state-machine',
                            format: 'todo',
                            // 0768 R1 identity: declared version literal or null
                            // (known-unversioned); canonical definition digest.
                            version: resolvedDefinition.workflow.version ?? null,
                            definitionDigest: resolvedDefinition.digest,
                            steps: buildWorkflowSteps(def),
                        }),
                    );
                } else {
                    context.output.write(
                        toJson({
                            name: def.name,
                            kind: def.kind ?? 'state-machine',
                            format: 'mermaid',
                            version: resolvedDefinition.workflow.version ?? null,
                            definitionDigest: resolvedDefinition.digest,
                            diagram: renderWorkflowMermaid(def),
                        }),
                    );
                }
                return;
            }
            context.output.write(options.format === 'todo' ? renderWorkflowTodo(def) : renderWorkflowMermaid(def));
        });

    workflow
        .command('trace')
        .description('Show persisted workflow run history.')
        .argument('[run-id]', 'Run ID for per-run timeline detail')
        .option('--workflow <name>', 'Filter by workflow name')
        .option(...SHARED_OPTIONS.statusDoneFailedRunning)
        .option(...SHARED_OPTIONS.since)
        .option(...SHARED_OPTIONS.last, '20')
        .option('--follow', 'Replay a run timeline and poll persisted state until it becomes terminal')
        .option(...SHARED_OPTIONS.pollWorkflow, '1000')
        .option('--output', 'With --follow: stream .spur/run/<RUNID>.log instead of the DB timeline')
        .option(...SHARED_OPTIONS.jsonSupported)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (runId, options) => {
            const svc = makeSvc();
            const last = parseInt(options.last, 10);
            if (Number.isNaN(last) || last < 1) {
                writeJsonError(context.output, options, '--last must be a positive integer', 'VALIDATION_FAILED');
                context.setExitCode(1);
                return;
            }
            const pollMs = parseInt(options.poll, 10);
            if (Number.isNaN(pollMs) || pollMs < 50) {
                writeJsonError(
                    context.output,
                    options,
                    '--poll must be an integer of at least 50ms',
                    'VALIDATION_FAILED',
                );
                context.setExitCode(1);
                return;
            }
            if (options.follow === true && runId === undefined) {
                writeJsonError(context.output, options, '--follow requires a run-id', 'VALIDATION_FAILED');
                context.setExitCode(1);
                return;
            }
            if (options.follow === true && options.json === true) {
                writeJsonError(
                    context.output,
                    options,
                    '--follow is a human streaming mode and cannot be combined with --json',
                    'VALIDATION_FAILED',
                );
                context.setExitCode(1);
                return;
            }
            if (options.output === true && options.follow !== true) {
                writeJsonError(context.output, options, '--output requires --follow', 'VALIDATION_FAILED');
                context.setExitCode(1);
                return;
            }
            if (options.output === true && options.json === true) {
                writeJsonError(
                    context.output,
                    options,
                    '--output is a human streaming mode and cannot be combined with --json',
                    'VALIDATION_FAILED',
                );
                context.setExitCode(1);
                return;
            }
            if (options.status !== undefined && !['done', 'failed', 'running'].includes(options.status)) {
                writeJsonError(
                    context.output,
                    options,
                    '--status must be one of: done, failed, running',
                    'VALIDATION_FAILED',
                );
                context.setExitCode(1);
                return;
            }
            if (options.follow === true && runId !== undefined) {
                if (options.output === true) {
                    await followRunLog(svc, runId, context.cwd, pollMs, (line) => context.output.write(line));
                } else {
                    await followTrace(svc, runId, pollMs, (line) => context.output.write(line));
                }
                return;
            }
            const result = runId
                ? await svc.trace(runId)
                : await svc.trace({
                      workflow: options.workflow,
                      status: options.status,
                      since: options.since,
                      last,
                  });
            if (options.json) {
                context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
            } else if ('events' in result) {
                context.output.write(formatTraceTimeline(result));
            } else {
                context.output.write(formatTraceList(result));
            }
        });
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

const SOURCE_LABELS: Record<string, string> = {
    project: 'project layer',
    global: 'user layer',
};

function formatListHuman(result: WorkflowListResult): string {
    if (result.totalFiles === 0) {
        return 'No workflows found.';
    }
    const lines: string[] = [];
    const layerLabels = result.layers.map((l) => `${l.id} (${l.path})`).join(', ');
    lines.push(`Sources: ${layerLabels} (layered mode)`);
    lines.push(`Total files: ${result.totalFiles}`);
    lines.push('');

    // Group entries by source layer
    const byLayer = new Map<string, WorkflowListEntry[]>();
    for (const entry of result.entries) {
        const list = byLayer.get(entry.source) ?? [];
        list.push(entry);
        byLayer.set(entry.source, list);
    }

    for (const [layerId, entries] of byLayer) {
        lines.push(`  ${layerId}/`);
        for (const entry of entries) {
            if (entry.valid) {
                lines.push(
                    `    ✓ ${entry.name.padEnd(30)} ${entry.kind.padEnd(20)} ${entry.path}  [${SOURCE_LABELS[layerId] ?? layerId}]`,
                );
            } else {
                lines.push(
                    `    ❌ ${entry.name.padEnd(30)} ${entry.kind.padEnd(20)} ${entry.path}  [${SOURCE_LABELS[layerId] ?? layerId}] (${entry.error ?? 'unknown'})`,
                );
            }
        }
    }

    return lines.join('\n').trimEnd();
}

function formatTraceList(result: WorkflowTraceListResult): string {
    if (result.entries.length === 0) {
        return 'No workflow runs.';
    }
    const lines = [
        'RUN ID    PROJECT              WORKFLOW             MODE            STATUS   STARTED                 COMPLETED               DURATION    OUTCOME      NEXT',
    ];
    for (const entry of result.entries) {
        const dryLabel = entry.isDryRun ? ' [dry]' : '';
        const duration = entry.durationMs === null ? 'unavailable' : `${entry.durationMs}ms`;
        const next = entry.nextAction?.value ?? '-';
        lines.push(
            `${entry.runId.padEnd(10)} ${entry.project.name.padEnd(20)} ${entry.workflowName.padEnd(22)} ${entry.mode.padEnd(15)} ${entry.status.padEnd(8)} ${entry.startedAt.padEnd(23)} ${(entry.completedAt ?? 'unavailable').padEnd(23)} ${duration.padEnd(11)} ${entry.outcome.padEnd(12)} ${next}${dryLabel}`,
        );
    }
    return lines.join('\n');
}
/**
 * Render a per-run timeline for human output: phase entries, transitions, action
 * events, and per-step cost when available.
 */
export function formatTraceTimeline(result: WorkflowTraceTimeline): string {
    const { run, events } = result;
    const dryLabel = run.isDryRun ? ' [DRY RUN]' : '';
    const reasonLabel = run.failureReason ? ` — ${run.failureReason}` : '';
    const lines = [
        `Run: ${run.runId} — ${run.workflowName} (${run.mode}) — ${run.status}${dryLabel}${reasonLabel}`,
        `Project: ${run.project.name} (${run.project.root})`,
        `Started: ${run.startedAt}   Completed: ${run.completedAt ?? 'unavailable'}   Duration: ${run.durationMs === null ? 'unavailable' : `${run.durationMs}ms`}`,
        `Outcome: ${run.outcome}   Events: ${events.length}`,
        '',
    ];
    if (run.nextAction !== undefined) lines.splice(4, 0, `Next: ${run.nextAction.label} — ${run.nextAction.value}`);
    // Per-run agent-output capture (task 0414): point the operator at the live
    // artifact so a long-running agent.run step is observable mid-flight.
    if (result.outputArtifact !== undefined) {
        lines.push(`Run log: ${result.outputArtifact} (tail -f for live view)`);
        lines.push('');
    }
    for (const event of events) {
        lines.push(formatTimelineEvent(event));
    }
    // Import is a precondition, not a trigger (R6): when any agent.run step has no
    // joinable usage, point the operator at `history import` rather than auto-running it (AC2).
    const hasUnjoinedCost = events.some(
        (e) =>
            e.kind === 'action' &&
            e.cost !== undefined &&
            (e.cost.exact?.totals.records ?? 0) + (e.cost.estimated?.totals.records ?? 0) === 0,
    );
    if (hasUnjoinedCost) {
        lines.push('', 'Some agent.run steps show cost n/a — run `spur history import` to populate cost.');
    }
    return lines.join('\n').trimEnd();
}

function formatTimelineEvent(event: TimelineEvent): string {
    if (event.kind === 'phase') {
        const ts = event.startedAt ?? event.completedAt ?? '';
        return `  ${event.phase.padEnd(20)} ${event.status.padEnd(10)} ${ts}`;
    }
    if (event.kind === 'transition') {
        const guard = event.trigger ? `  [${event.trigger}]` : '';
        return `    → ${event.from} → ${event.to}${guard}  ${event.at}`;
    }
    const costSuffix = formatActionCost(event);
    const lines = [
        `    ⚡ ${event.actionId}  ${event.node}/${event.actionKind}  ${event.status}  ${event.duration || 'unavailable'}${event.label}${costSuffix}`,
        `      started=${event.startedAt ?? 'unavailable'} completed=${event.completedAt ?? 'unavailable'} outcome=${event.outcome}`,
    ];
    if (event.result !== null) {
        lines.push(
            `      result=${Object.entries(event.result)
                .map(([key, value]) => `${key}=${String(value)}`)
                .join(' ')}`,
        );
    } else {
        lines.push('      result=unavailable');
    }
    if (event.invocation !== null) {
        lines.push(
            `      invocation=${Object.entries(event.invocation)
                .map(([key, value]) => `${key}=${String(value)}`)
                .join(' ')}`,
        );
    } else {
        lines.push('      invocation=unavailable');
    }
    lines.push(`      error=${event.error ?? 'unavailable'}`);
    if (event.artifacts.length === 0) lines.push('      artifact=unavailable');
    else for (const artifact of event.artifacts) lines.push(`      artifact=${artifact}`);
    if (event.nextAction !== undefined) lines.push(`      Next: ${event.nextAction.label} — ${event.nextAction.value}`);
    return lines.join('\n');
}

/**
 * Replay persisted timeline rows, then poll for inserts/updates until the run is
 * terminal. Updated action rows are emitted again (in-flight → finished), while
 * identical snapshots are deduplicated by a stable serialized fingerprint.
 */
export async function followTrace(
    service: Pick<WorkflowAppService, 'trace'>,
    runId: string,
    pollMs: number,
    write: (line: string) => void,
    wait: (ms: number) => Promise<unknown> = (ms) => sleep(ms),
): Promise<void> {
    let missingAttempts = 0;
    let timeline: WorkflowTraceTimeline;
    while (true) {
        try {
            timeline = await service.trace(runId);
            break;
        } catch (error) {
            if (!String(error).includes('Run not found') || missingAttempts >= 20) throw error;
            missingAttempts++;
            await wait(pollMs);
        }
    }

    write(formatTraceTimeline(timeline));
    const seen = new Set(timeline.events.map((event) => JSON.stringify(event)));
    if (isTerminalTraceStatus(timeline.run.status)) return;

    while (true) {
        await wait(pollMs);
        const next = await service.trace(runId);
        for (const event of next.events) {
            const fingerprint = JSON.stringify(event);
            if (seen.has(fingerprint)) continue;
            seen.add(fingerprint);
            write(formatTimelineEvent(event));
        }
        if (isTerminalTraceStatus(next.run.status)) {
            const reason = next.run.failureReason ? ` — ${next.run.failureReason}` : '';
            const duration = next.run.durationMs === null ? 'unavailable' : `${next.run.durationMs}ms`;
            write(`Run finalized: ${next.run.status}${reason} — outcome=${next.run.outcome} duration=${duration}`);
            if (next.run.nextAction !== undefined) {
                write(`Next: ${next.run.nextAction.label} — ${next.run.nextAction.value}`);
            }
            return;
        }
    }
}

function isTerminalTraceStatus(status: string): boolean {
    return status !== 'running' && status !== 'pending';
}

/**
 * Read complete lines appended to the run log since `offset`, holding back a
 * trailing partial line (line buffering) until a newline lands. Returns whether
 * the file exists, the new complete lines, and the next byte offset to resume
 * from. Read-only — never writes to the log.
 */
function readRunLogChunk(logPath: string, offset: number): { exists: boolean; lines: string[]; offset: number } {
    let fd: number;
    try {
        fd = openSync(logPath, 'r');
    } catch {
        return { exists: false, lines: [], offset };
    }
    try {
        const size = fstatSync(fd).size;
        if (size <= offset) return { exists: true, lines: [], offset };
        const buffer = Buffer.alloc(size - offset);
        readSync(fd, buffer, 0, buffer.length, offset);
        const text = buffer.toString('utf8');
        const lastNewline = text.lastIndexOf('\n');
        const consumed = lastNewline >= 0 ? lastNewline + 1 : 0;
        // split then drop only the trailing empty element from the final newline,
        // preserving intentional blank separator lines inside the chunk.
        const parts = consumed === 0 ? [] : text.slice(0, consumed).split('\n');
        const lines = parts.length > 0 && parts.at(-1) === '' ? parts.slice(0, -1) : parts;
        return { exists: true, lines, offset: offset + consumed };
    } finally {
        closeSync(fd);
    }
}

/**
 * Tail `.spur/run/<RUNID>.log` (read-only) as the run progresses, then exit once
 * the run reaches a terminal status. Best-effort: if the log never appears
 * (e.g. the run was started with `--no-log`), surface a clear message after
 * terminal status rather than hanging forever. This is a distinct source from
 * `followTrace`'s DB timeline — the two never interleave.
 */
export async function followRunLog(
    service: Pick<WorkflowAppService, 'trace'>,
    runId: string,
    dir: string,
    pollMs: number,
    write: (line: string) => void,
    wait: (ms: number) => Promise<unknown> = (ms) => sleep(ms),
): Promise<void> {
    const logPath = join(dir, '.spur', 'run', `${runId}.log`);
    let offset = 0;
    let everRead = false;
    while (true) {
        const chunk = readRunLogChunk(logPath, offset);
        if (chunk.exists && (chunk.lines.length > 0 || chunk.offset > offset)) {
            everRead = true;
            for (const line of chunk.lines) write(line);
            offset = chunk.offset;
        }

        let terminal = false;
        try {
            terminal = isTerminalTraceStatus((await service.trace(runId)).run.status);
        } catch (error) {
            // Run not persisted yet — keep waiting inside the follow window.
            if (!String(error).includes('Run not found')) throw error;
        }
        if (terminal) {
            if (!everRead) {
                write(`No run log at ${logPath} — the run may have been started with --no-log.`);
            }
            return;
        }
        await wait(pollMs);
    }
}

/**
 * Render per-step token cost and cache-hit for the human-readable trace timeline.
 *
 * Returns an empty string for non-agent.run actions; ` · cost n/a` when the step
 * cannot be joined to usage data (never `$0.00` — 0281/0284 invariant); otherwise
 * the token figures derived from `history_message` typed columns via the run→session
 * mapping (task 0559). Exact and estimated figures are rendered apart and never
 * summed (R2); estimated figures carry the `~` prefix. No currency value is ever
 * emitted (R3) — tokens, never prices.
 */
export function formatActionCost(event: TimelineEvent): string {
    if (event.kind !== 'action') return '';
    const cost = event.cost;
    if (!cost) return '';
    const parts: string[] = [];
    if (cost.exact !== null && cost.exact.totals.recordsWithUsage > 0) {
        parts.push(formatTokenCost(cost.exact, false));
    }
    if (cost.estimated !== null && cost.estimated.totals.recordsWithUsage > 0) {
        parts.push(formatTokenCost(cost.estimated, true));
    }
    // Unjoinable agent.run step (no matched usage) → render `n/a`, never a fabricated zero
    // (0281/0284 never-fabricate invariant). Matched rows with no token data also render
    // n/a: absent telemetry is unknown, not 0 tokens.
    if (parts.length === 0) return ' · cost n/a';
    return ` · ${parts.join(' · ')}`;
}

/** One token-figure segment: `~12.4k in / 3.2k out · cache 41%` (est prefix when estimated). */
function formatTokenCost(cost: ActionCost, estimated: boolean): string {
    const est = estimated ? '~' : '';
    const { inputTokens, outputTokens } = cost.totals;
    const ratio = cost.cacheHit === null ? 'n/a' : `${(cost.cacheHit * 100).toFixed(0)}%`;
    return `${est}${formatTokens(inputTokens)} in / ${est}${formatTokens(outputTokens)} out · cache ${est}${ratio}`;
}

/** Compact token rendering: `1250` → `1.3k`, `5000000` → `5.0M`. */
function formatTokens(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
    return String(n);
}
