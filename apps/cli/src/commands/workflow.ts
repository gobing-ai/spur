import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Command } from '@commander-js/extra-typings';
import {
    configuredSecretValues,
    renderActionHeartbeat,
    renderRunPlan,
    renderStepLine,
    resolveOutputLogConfig,
    resolveWorkflowLogRetentionDays,
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
import { loadSpurConfig } from '@gobing-ai/spur-config/loader';
import { loadWorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import { EventBus } from '@gobing-ai/ts-infra';
import { NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import { EMBEDDED_SPUR_SCHEMAS } from '../config/embedded-schemas';
import type { CliContext } from '../context';
import { toJson } from '../output';
import { attachSystemEventLedger } from '../system-event-ledger';
import { resolveSpurBin } from '../workflow/resolve-spur-bin';

/** POSIX single-quote for `sh -c` argv embedding. */
function shQuote(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Launch a long-lived async workflow worker via ProcessExecutor + nohup.
 * Avoids direct child_process.spawn (no-direct-process-spawn).
 */
async function spawnAsyncWorkflowWorker(spurBin: string, cmd: string[]): Promise<void> {
    const line = [spurBin, ...cmd].map(shQuote).join(' ');
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) env[key] = value;
    }
    env.SPUR_ASYNC_WORKER = '1';
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

/** Read configured workflow search paths, defaulting to `['.spur/workflows/']`. */
async function resolveWorkflowPaths(cwd: string): Promise<string[]> {
    try {
        const config = await loadSpurConfig(cwd, { embeddedSchemas: EMBEDDED_SPUR_SCHEMAS });
        return config.workflows?.paths ?? ['.spur/workflows/'];
    } catch {
        return ['.spur/workflows/'];
    }
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
    const makeSvc = (json?: boolean, bus?: WorkflowObservabilityBus) =>
        new WorkflowAppService({
            cwd: context.cwd,
            getDb: () => context.getDb(),
            // Intentionally leave AgentService without a server-style events bus: the
            // workflow-dispatched agent lifecycle is the single `workflow.agent` series
            // (0365 R9 / 0370 R4). Wiring AiRunner.events here would dual-emit
            // `agent.invoke.*` for the same execution.
            agentService: () => context.agentService(),
            ruleService: () => context.ruleService(),
            hitlResponder: () => context.hitlResponder(json),
            // Resolve bundled-workflow `$schema` refs from the embedded map rather than
            // node_modules, so validate works in a --compile binary and from any cwd.
            embeddedSchemas: () => EMBEDDED_SPUR_SCHEMAS,
            ...(bus
                ? {
                      observabilityBus: () => bus,
                      events: () => bus as unknown as SystemEventBus,
                  }
                : {}),
        });

    const workflow = program.command('workflow').summary('validate and execute workflow YAML files');

    workflow
        .command('validate')
        .description('Validate a workflow definition.')
        .argument('<file>', 'Workflow YAML file')
        .option('--no-schema', 'Skip schema validation')
        .option('--json', 'Output machine-readable JSON where supported')
        .action(async (file, options) => {
            const result = await makeSvc().validate(file, { validateSchema: options.schema });
            if (options.json) {
                context.output.write(toJson(result));
            } else if (result.valid) {
                context.output.write(`workflow valid: ${result.workflow.name}`);
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
        .option('--run-id <id>', 'Persisted run id for workflow run')
        .option('--vars <json>', 'Per-run variable overrides as a JSON object, e.g. \'{"taskId":"0042"}\'')
        .option('--dry-run', 'Validate and walk transitions without executing actions')
        .option(
            '--async',
            'Start the workflow in the background and exit immediately — monitor with `spur workflow trace <run-id>`',
        )
        .option('--no-plan', 'Suppress the run-start plan preview (synchronous runs only)')
        .option('--quiet', 'Suppress plan and per-step progress; keep the final summary')
        .option('--silent', 'Suppress all routine output; errors still set a non-zero exit status')
        .option('--verbose', 'Include transitions and correlation diagnostics in human progress')
        .option('--detail <level>', 'Human detail level: minimal, invocation, or full')
        .option('--trace-file', 'Append a redacted schema-versioned JSONL trace under .spur/runs/workflow/')
        .option('--no-log', 'Opt out of writing the consolidated .spur/run/<RUNID>.log')
        .option('--steer', 'Accept local in-process steering commands on stdin at declared action boundaries')
        .option('--json', 'Output machine-readable JSON where supported')
        .action(async (file, options) => {
            const json = options.json === true;
            const silent = !json && options.silent === true;
            const quiet = !json && options.quiet === true;
            if (!json && options.quiet === true && options.verbose === true) {
                context.output.error('--quiet and --verbose are mutually exclusive');
                context.setExitCode(2);
                return;
            }
            if (!json && options.silent === true && (options.quiet === true || options.verbose === true)) {
                context.output.error('--silent cannot be combined with --quiet or --verbose');
                context.setExitCode(2);
                return;
            }
            if (options.steer === true && (json || options.async === true)) {
                context.output.error(
                    '--steer is synchronous and in-process; it cannot be combined with --json or --async',
                );
                context.setExitCode(2);
                return;
            }
            const requestedDetail = options.detail as string | undefined;
            if (requestedDetail !== undefined && !['minimal', 'invocation', 'full'].includes(requestedDetail)) {
                context.output.error('--detail must be one of: minimal, invocation, full');
                context.setExitCode(2);
                return;
            }
            const detail: WorkflowOutputDetail =
                options.verbose === true
                    ? 'full'
                    : ((requestedDetail as WorkflowOutputDetail | undefined) ?? 'invocation');

            // When --async, spawn a detached child process that runs the workflow
            // synchronously and exit immediately with the run ID. The child is its
            // own session/process-group LEADER (`detached: true` → setsid), so it
            // survives parent termination AND its pid doubles as a group id: the
            // worker self-records that pid (SPUR_ASYNC_WORKER=1 → recordSelfPid), and
            // `spur workflow cancel` SIGTERMs the negated pid to reach the worker +
            // the agent.run grandchild it spawns.
            if (options.async) {
                const runId = options.runId || crypto.randomUUID();
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
                try {
                    // Detached via ProcessExecutor + nohup (SPUR_ASYNC_WORKER set in env).
                    await spawnAsyncWorkflowWorker(spurBin, cmd);
                } catch {
                    // If spawn throws, fall through to the sync path so the workflow still runs.
                    const result = await makeSvc(options.json).run(file, {
                        runId,
                        vars: { spurBin: resolveSpurBin(), ...parseVars(options.vars) },
                        dryRun: options.dryRun || undefined,
                    });
                    if (json) context.output.write(toJson(result));
                    else if (!silent) {
                        context.output.write(
                            `workflow ${result.status}: ${result.workflowName} -> ${result.finalState} (async spawn failed, ran sync)`,
                        );
                    }
                    context.setExitCode(result.status === 'done' ? 0 : 1);
                    return;
                }
                const asyncResult = { runId, status: 'started', workflowName: file };
                if (json) context.output.write(toJson(asyncResult));
                else if (!silent) {
                    context.output.write(
                        `Started async run: ${runId}\nMonitor with: spur workflow trace ${runId} --follow`,
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

            // Observability: always build a CLI-local bus so engine + adapter events
            // reach the system_events ledger (task 0370). Human progress / --trace-file
            // / --steer reuse the same bus; under --json the progress handlers stay off
            // so machine output remains byte-identical. commander negates --no-plan to
            // options.plan=false.
            const runId = options.runId || crypto.randomUUID();
            const humanProgress = !json && !quiet && !silent;
            const bus: WorkflowObservabilityBus = new EventBus();
            const ledger = await attachSystemEventLedger(bus as unknown as SystemEventBus, context);
            let traceWriter: WorkflowTraceWriter | undefined;
            const heartbeats = new Map<string, ReturnType<typeof setInterval>>();
            if (options.traceFile === true) {
                traceWriter = new WorkflowTraceWriter(context.cwd, runId);
                traceWriter.attach(bus);
            }
            // Plan preview (R2): rendered once from the parsed definition, shared by the
            // human renderer and the consolidated run log. Advisory — a parse failure
            // must not block the run.
            let planPreview: string | undefined;
            if (options.plan !== false) {
                try {
                    const def = await loadWorkflowDef(resolve(context.cwd, file), { validateSchema: false });
                    planPreview = renderRunPlan(def);
                } catch {
                    // Preview is advisory — a parse failure must not block the run.
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
                          ...(await resolveOutputLogConfig(context.cwd)),
                      });
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
                    ? new WorkflowSteeringController(
                          (ack) => {
                              void bus.emit('workflow.steering', ack);
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
                      )
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
                result = await makeSvc(json, bus).run(file, {
                    runId,
                    vars,
                    dryRun: options.dryRun || undefined,
                    // Async worker self-records its pid so `spur workflow cancel` can
                    // signal the live process group (set by the --async launcher).
                    recordSelfPid: process.env.SPUR_ASYNC_WORKER === '1',
                    ...(steeringController !== undefined ? { steeringController } : {}),
                });
            } finally {
                for (const timer of heartbeats.values()) clearInterval(timer);
                heartbeats.clear();
                await traceWriter?.flush();
                runLog?.close();
                await ledger.flush();
                ledger.unsubscribe();
                steeringInput?.close();
            }
            if (json) context.output.write(toJson(result));
            else if (!silent) {
                context.output.write(
                    `workflow ${result.status}: ${result.workflowName} -> ${result.finalState}${typeof result.reason === 'string' ? ` — ${result.reason}` : ''}`,
                );
            }
            context.setExitCode(result.status === 'done' ? 0 : 1);
        });

    workflow
        .command('continue')
        .description('Resume a paused (HITL) workflow run. Omit run-id to resume the most recent paused run.')
        .argument('[run-id]', 'Run ID to resume (default: the most recent paused run)')
        .option('--yes', 'Skip the CLI resume confirmation (does not set the persisted HITL answer)')
        .option(
            '--answer <yes|no|cancel>',
            'Inject a HITL gate answer before guard re-evaluation (0433). Does not imply --yes.',
        )
        .option('--json', 'Output machine-readable JSON where supported')
        .action(async (runId, options) => {
            const json = options.json === true;
            // Validate --answer enum (R1): commander does not natively enforce choices.
            let hitlAnswer: 'yes' | 'no' | 'cancel' | undefined;
            if (options.answer !== undefined) {
                const v = String(options.answer).toLowerCase();
                if (v !== 'yes' && v !== 'no' && v !== 'cancel') {
                    context.output.error(`Invalid --answer value "${options.answer}" - must be yes, no, or cancel.`);
                    context.setExitCode(2);
                    return;
                }
                hitlAnswer = v;
            }
            // Resume path shares the 0370 ledger bridge so continued runs also
            // surface workflow.* rows (adapter verb-form + engine-native).
            const bus: WorkflowObservabilityBus = new EventBus();
            const ledger = await attachSystemEventLedger(bus as unknown as SystemEventBus, context);
            const svc = makeSvc(json, bus);
            try {
                let targetId = runId;
                if (targetId === undefined) {
                    // Discover the most recent paused run (E3).
                    const latest = await svc.latestPausedRun();
                    if (latest === null) {
                        context.output.error('No paused workflow run to continue.');
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
                            context.output.error(`Aborted - run ${latest.runId} not resumed.`);
                            context.setExitCode(1);
                            return;
                        }
                    }
                }
                const result = await svc.continuePaused(targetId, {
                    ...(hitlAnswer !== undefined ? { hitlAnswer } : {}),
                });
                context.output.write(
                    json ? toJson(result) : `workflow ${result.status}: ${result.workflowName} -> ${result.finalState}`,
                );
                context.setExitCode(result.status === 'done' ? 0 : 1);
            } catch (err) {
                context.output.error(String(err));
                context.setExitCode(1);
            } finally {
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
        .option('--force', 'Clean ALL non-terminal runs regardless of age (overrides --older-than)')
        .option('--logs', 'Scope to retained run-log reclamation only (skip stale-run finalization)')
        .option('--dry-run', 'List what would be cleaned without writing (applies to both scopes)')
        .option('--json', 'Output machine-readable JSON where supported')
        .action(async (options) => {
            const dryRun = options.dryRun === true;
            const logsOnly = options.logs === true;
            const force = options.force === true;
            const minutes = force ? 0 : Number.parseInt(options.olderThan ?? '30', 10);
            if (!Number.isFinite(minutes) || minutes < 0) {
                context.output.error(`Invalid --older-than value: ${options.olderThan}`);
                context.setExitCode(2);
                return;
            }
            const svc = makeSvc(options.json);
            const result = logsOnly ? undefined : await svc.clean(minutes, dryRun);
            const retentionDays = await resolveWorkflowLogRetentionDays(context.cwd);
            const logResult = await svc.cleanRunLogs(retentionDays, dryRun);
            if (options.json) {
                context.output.write(toJson(logsOnly ? logResult : { ...result, logs: logResult }));
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
            }
        });

    workflow
        .command('cancel')
        .description(
            'Cancel a single non-terminal run by id (mark as failed). The bulk/stale variant is `spur workflow clean`.',
        )
        .argument('<run-id>', 'Run id to cancel')
        .option('--json', 'Output machine-readable JSON where supported')
        .action(async (runId, options) => {
            const result = await makeSvc(options.json).cancel(runId);
            if (options.json) {
                context.output.write(toJson(result));
                return;
            }
            if (result.status === 'not_found') {
                context.output.error(`Run ${runId} not found.`);
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
        .option('--json', 'Output machine-readable JSON where supported')
        .action(async (options) => {
            const paths = await resolveWorkflowPaths(context.cwd);
            const result = await makeSvc().list(paths);
            if (options.json) {
                context.output.write(toJson(result));
            } else {
                context.output.write(formatListHuman(result));
            }
        });

    workflow
        .command('trace')
        .description('Show persisted workflow run history.')
        .argument('[run-id]', 'Run ID for per-run timeline detail')
        .option('--workflow <name>', 'Filter by workflow name')
        .option('--status <status>', 'Filter by status: done, failed, running')
        .option('--since <iso-date>', 'Filter runs started on or after this date')
        .option('--last <n>', 'Limit results (default 20)', '20')
        .option('--follow', 'Replay a run timeline and poll persisted state until it becomes terminal')
        .option('--poll <ms>', 'Follow polling interval in milliseconds', '1000')
        .option('--output', 'With --follow: stream .spur/run/<RUNID>.log instead of the DB timeline')
        .option('--json', 'Output machine-readable JSON where supported')
        .action(async (runId, options) => {
            const svc = makeSvc();
            const last = parseInt(options.last, 10);
            if (Number.isNaN(last) || last < 1) {
                context.output.error('--last must be a positive integer');
                context.setExitCode(1);
                return;
            }
            const pollMs = parseInt(options.poll, 10);
            if (Number.isNaN(pollMs) || pollMs < 50) {
                context.output.error('--poll must be an integer of at least 50ms');
                context.setExitCode(1);
                return;
            }
            if (options.follow === true && runId === undefined) {
                context.output.error('--follow requires a run-id');
                context.setExitCode(1);
                return;
            }
            if (options.follow === true && options.json === true) {
                context.output.error('--follow is a human streaming mode and cannot be combined with --json');
                context.setExitCode(1);
                return;
            }
            if (options.output === true && options.follow !== true) {
                context.output.error('--output requires --follow');
                context.setExitCode(1);
                return;
            }
            if (options.output === true && options.json === true) {
                context.output.error('--output is a human streaming mode and cannot be combined with --json');
                context.setExitCode(1);
                return;
            }
            if (options.status !== undefined && !['done', 'failed', 'running'].includes(options.status)) {
                context.output.error('--status must be one of: done, failed, running');
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
                context.output.write(toJson(result));
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
    const lines = ['RUN ID    WORKFLOW             MODE           STATUS  STARTED               COMPLETED'];
    for (const entry of result.entries) {
        const dryLabel = entry.isDryRun ? ' [dry]' : '';
        lines.push(
            `${entry.runId.padEnd(10)} ${entry.workflowName.padEnd(22)} ${entry.mode.padEnd(15)} ${entry.status.padEnd(7)} ${entry.startedAt.padEnd(22)} ${(entry.completedAt ?? '-').padEnd(22)}${dryLabel}`,
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
        `Started: ${run.startedAt}   Completed: ${run.completedAt ?? '-'}   Events: ${events.length}`,
        '',
    ];
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
        (e) => e.kind === 'action' && e.cost !== undefined && e.cost.totals.records === 0,
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
        return `    → ${event.to}${guard}`;
    }
    const costSuffix = formatActionCost(event);
    return `    ⚡ ${event.actionKind.padEnd(15)} ${event.duration.padEnd(6)}${event.label}${costSuffix}`;
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
            write(`Run finalized: ${next.run.status}${reason}`);
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
 * Render per-step cost and cache-hit for the human-readable trace timeline.
 *
 * Returns an empty string for non-agent.run actions; ` · cost n/a` when the
 * step cannot be joined to usage data (never `$0.00` — 0281/0284 invariant);
 * ` · ~$X.XX · cache ~Y%` when the time-window heuristic was used (R1b);
 * ` · $X.XX · cache Y%` for exact session-id joins (R1a).
 */
export function formatActionCost(event: TimelineEvent): string {
    if (event.kind !== 'action') return '';
    const cost = event.cost;
    if (!cost) return '';
    // Unjoinable agent.run step (no matched usage) → render `n/a`, never `$0.00`
    // (0281/0284 never-fabricate invariant; R3).
    if (cost.totals.records === 0) return ' · cost n/a';
    const est = cost.estimated ? '~' : '';
    if (cost.cacheHit === null) {
        // Records matched but carried no cache dimensions — cost known, ratio not.
        return cost.totals.costUsd > 0 ? ` · ${est}$${cost.totals.costUsd.toFixed(3)} · cache n/a` : ' · cost n/a';
    }
    return ` · ${est}$${cost.totals.costUsd.toFixed(3)} · cache ${est}${(cost.cacheHit * 100).toFixed(0)}%`;
}
