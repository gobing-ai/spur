import { setTimeout as sleep } from 'node:timers/promises';
import type { Command } from '@commander-js/extra-typings';
import type { AgentQuotaEventBus } from '@gobing-ai/spur-app';
import {
    configuredSecretValues,
    createShellOutputRedactor,
    resolveOutputLogConfig,
    runStoragePaths,
    type SystemEventBus,
    type WorkflowAppService,
    type WorkflowObservabilityBus,
    WorkflowRunLogSink,
} from '@gobing-ai/spur-app';
import { EventBus } from '@gobing-ai/ts-infra';
import { attachAgentQuotaPersistence } from '../../agent-quota-persistence';
import type { CliContext } from '../../context';
import { maybeTriggerHistoryRefresh } from '../../history-refresh';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { attachSystemEventLedger } from '../../system-event-ledger';
import { resolveSpurBin } from '../../workflow/resolve-spur-bin';
import { SHARED_OPTIONS } from '../shared-options';
import {
    asyncRegisterTimeoutMs,
    makeEscalationPacketSink,
    makeWorkflowService,
    spawnAsyncWorkflowWorker,
    takeAsyncWorkerEnv,
} from './shared';

/**
 * 0901 R4: continue-path start confirmation. Unlike a fresh run (whose row only
 * exists once the worker created it), a resumed run's row already exists in its
 * pre-resume status — so the ack is the row LEAVING paused/interrupted, which
 * only a successful ownership claim can cause. Timeout reports failed-start.
 */
export async function waitForResumeClaim(
    service: Pick<WorkflowAppService, 'trace'>,
    runId: string,
    timeoutMs: number,
    pollMs = 250,
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        try {
            const entry = await service.trace(runId);
            if (entry.run.status !== 'paused' && entry.run.status !== 'interrupted') return true;
        } catch {
            // Transient read failures just keep polling until the deadline.
        }
        if (Date.now() >= deadline) return false;
        await sleep(pollMs);
    }
}

/** Register `spur workflow continue`. */
export function registerWorkflowContinueCommand(workflow: Command, context: CliContext): void {
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
        .option(
            '--answer-text <text>',
            'Answer a pending input-gate action gate with free text (H1 R27). Does not imply --yes.',
        )
        .option('--async', 'Detach: resume in a background worker and report started/failed (0901 R4).')
        .option(
            '--no-log',
            'Opt out of appending to the two-file run record .spur/memory/runs/<RUNID>.md + .state.json',
        )
        .option(...SHARED_OPTIONS.jsonSupported)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (runId, options) => {
            // 1117: consume the launcher→worker handshake at entry so the resumed run's
            // step children never inherit it; the resume-owner branch below uses the
            // captured flag (the --async launcher re-injects SPUR_ASYNC_WORKER itself).
            const { isAsyncWorker } = takeAsyncWorkerEnv();
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
            // H1 R2: --answer-text targets input gates exclusively; the two answer flags are
            // mutually exclusive and the text must be non-empty (an empty answer is a typo,
            // not a decision).
            let answerText: string | undefined;
            if (options.answerText !== undefined) {
                if (hitlAnswer !== undefined) {
                    writeJsonError(
                        context.output,
                        options,
                        'Use either --answer or --answer-text, not both - they target different gate kinds (confirm/select vs input).',
                        'VALIDATION_FAILED',
                    );
                    context.setExitCode(2);
                    return;
                }
                if (String(options.answerText).length === 0) {
                    writeJsonError(
                        context.output,
                        options,
                        'Invalid --answer-text value "": the text must be non-empty.',
                        'VALIDATION_FAILED',
                    );
                    context.setExitCode(2);
                    return;
                }
                answerText = String(options.answerText);
            }
            // 0901 R3: a headless continue without an explicit --answer would silently
            // take the persisted headless default (or wedge on the gate). Flat rule —
            // the check does not inspect whether a gate is actually pending. --yes is
            // the CLI resume confirmation and never answers gates. The detached async
            // worker always passes --answer explicitly, so it clears this guard.
            if ((json || !process.stdout.isTTY) && hitlAnswer === undefined && answerText === undefined) {
                writeJsonError(
                    context.output,
                    options,
                    'Refusing headless `workflow continue` without --answer or --answer-text: a non-interactive resume must answer the pending HITL gate explicitly (--answer yes|no|cancel for confirm/select gates, --answer-text <text> for input gates). --yes only skips the CLI resume confirmation and does not answer gates.',
                    'VALIDATION_FAILED',
                );
                context.setExitCode(2);
                return;
            }
            // Resume path shares the 0370 ledger bridge so continued runs also
            // surface workflow.* rows (adapter verb-form + engine-native).
            const bus: WorkflowObservabilityBus = new EventBus();
            // SAFETY: the same EventBus instance is bridged as the system-event ledger (structurally identical
            // nominal types; ADR-044 event bridge).
            const ledger = await attachSystemEventLedger(bus as unknown as SystemEventBus, context);
            // 0799 R1: same persistence bridge as a fresh run — resumed runs emit
            // agent dispatches that must reach `agent_executor_updates` too.
            // SAFETY: one structural ts-infra EventBus behind the nominal names (ADR-044).
            const quotaPersistence = attachAgentQuotaPersistence(bus as unknown as AgentQuotaEventBus, context);
            // Escalation packets (task 0709): resumed runs project the same
            // canonical packet on terminal failure; idempotent per run.
            const escalationSink = await makeEscalationPacketSink(bus, context);
            const svc = makeWorkflowService(context, json, bus);
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
                // H1 R2: gate-kind validation before any resume claim or metadata mutation.
                // Before the --async spawn always; before the TTY confirmation for
                // explicit-run-id resumes (the no-run-id discovery path prompts first).
                // Either way a mismatched flag fails fast with the run untouched.
                if (hitlAnswer !== undefined || answerText !== undefined) {
                    const gate = await svc.pendingGate(targetId);
                    const expectingInput = answerText !== undefined;
                    // A run paused with no gate action (e.g. interrupted) resumes as today:
                    // answer flags are inert there and must not be rejected (0901 R3 relies on
                    // --answer for headless resumes of interrupted runs).
                    const gateMatches =
                        gate === null || (expectingInput ? gate.kind === 'hitl.input' : gate.kind !== 'hitl.input');
                    if (!gateMatches) {
                        const pending = `state '${gate?.stateId}' waits on a ${gate?.kind} gate`;
                        const use = expectingInput ? '--answer yes|no|cancel' : '--answer-text <text>';
                        writeJsonError(
                            context.output,
                            options,
                            `--${expectingInput ? 'answer-text' : 'answer'} does not match the pending gate: ${pending}; use ${use}.`,
                            'VALIDATION_FAILED',
                        );
                        context.setExitCode(2);
                        return;
                    }
                }
                const result = await (async () => {
                    // 0901 R4: async resume. The target is resolved here (arg or
                    // discovery) so the worker never re-discovers a different run;
                    // the worker always passes --yes and forwards --answer/--force
                    // and the JSON/no-log flags. Dead-on-arrival workers are invisible
                    // under nohup, so only the run row leaving its paused/interrupted
                    // state proves the resume actually claimed ownership.
                    if (options.async === true) {
                        const cmd = ['workflow', 'continue', targetId, '--yes'];
                        if (hitlAnswer !== undefined) cmd.push('--answer', hitlAnswer);
                        if (answerText !== undefined) cmd.push('--answer-text', answerText);
                        if (options.force === true) cmd.push('--force');
                        if (json) cmd.push('--json');
                        if (options.jsonEnvelope === true) cmd.push('--json-envelope');
                        if (options.log === false) cmd.push('--no-log');
                        await spawnAsyncWorkflowWorker(resolveSpurBin(), cmd);
                        const started = await waitForResumeClaim(
                            svc,
                            targetId,
                            asyncRegisterTimeoutMs(context.spurConfig),
                        );
                        if (started) {
                            if (json) {
                                context.output.write(
                                    toEnvelopeJson(
                                        { status: 'started', runId: targetId },
                                        { enveloped: options.jsonEnvelope },
                                    ),
                                );
                            } else {
                                context.output.write(
                                    `workflow continue ${targetId}: started in background - follow with \`spur workflow trace ${targetId}\``,
                                );
                            }
                            context.setExitCode(0);
                        } else {
                            const reason = 'async resume worker failed to start or claim the run';
                            const hint = 'run `workflow continue` synchronously (omit --async) to see the failure';
                            if (json) {
                                context.output.write(
                                    toEnvelopeJson(
                                        { status: 'failed', runId: targetId, reason, hint },
                                        { enveloped: options.jsonEnvelope },
                                    ),
                                );
                            } else {
                                context.output.write(`workflow continue failed: ${reason}. ${hint}.`);
                            }
                            context.setExitCode(1);
                        }
                        return undefined;
                    }
                    // 0901 R6: resumed runs append to the same per-run log as fresh
                    // runs so one file carries the full execution history.
                    // ponytail: appended relative to the invoking cwd; a resume from a
                    // different checkout writes that checkout's log, not the recorded
                    // launch workdir — add a workdir lookup when that bites.
                    const runLog =
                        options.log === false
                            ? undefined
                            : new WorkflowRunLogSink({
                                  bus,
                                  dir: runStoragePaths(context.cwd).recordsDir,
                                  runId: targetId,
                                  secrets: configuredSecretValues(context.env),
                                  ...resolveOutputLogConfig(context.spurConfig ?? null),
                              });
                    try {
                        const result = await svc.continuePaused(targetId, {
                            hitlAnswer,
                            answerText,
                            force: options.force === true ? true : undefined,
                            // 0901 R5: persisted shell results keep a secret-redacted
                            // byte tail instead of the engine's full-output default.
                            redactor: createShellOutputRedactor(configuredSecretValues(context.env)),
                            // 0901 R4: the detached worker claims ownership under its
                            // own attempt identity and stamps its pid at the claim so
                            // `workflow cancel` can reach it (flag captured at entry).
                            ...(isAsyncWorker
                                ? {
                                      resumeOwner: { attemptId: crypto.randomUUID(), pid: process.pid },
                                      recordSelfPid: true,
                                  }
                                : {}),
                        });
                        return result;
                    } finally {
                        runLog?.close();
                    }
                })();
                if (result === undefined) return; // async path already reported and set the exit code.
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
                // 0799 R1: flush recorded quota observations before process exit.
                await quotaPersistence.flush();
                quotaPersistence.unsubscribe();
            }
        });
}
