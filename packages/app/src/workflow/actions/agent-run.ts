import { dirname, isAbsolute, join } from 'node:path';
import type { ActionResult, ActionRunContext, ActionRunner } from '@gobing-ai/ts-dual-workflow-engine';
import { createNodeFileSystem, NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import type { AgentExecutionObserver } from '../../observability/agent-execution';
import { RunOutputSink, type RunOutputSinkConfig } from '../../observability/run-output-sink';
import type { AgentRunInvocation, AgentRunTracedResult, AgentService } from '../../services/agent-service';
import type { WorkflowObservabilityBus } from '../observability';
import { parseSteeringPolicy, type WorkflowSteeringController } from '../steering';

/** Bound the stdout/stderr tail captured into the partial-work artifact (R2b). */
const PARTIAL_ARTIFACT_TAIL_CHARS = 4000;

const KIND = 'agent.run';

/**
 * Workflow action that delegates to AgentService.runTraced — the pipeline's
 * non-interactive agent dispatch path (task 0295 / R3).
 *
 * **Non-interactive contract (R3 / task 0295):** every `agent.run` dispatched
 * by a workflow uses {@link AgentService.runTraced}, which forces
 * `{ mode: 'buffered' }` output regardless of TTY. The subprocess therefore
 * never inherits the parent's stdout, so a translated slash command (e.g.
 * `/sp:dev-run --mode implement … --auto`) cannot stall waiting on an
 * interactive confirmation prompt that never arrives. Direct `spur agent run`
 * from a terminal keeps its interactive streaming behavior because it uses
 * {@link AgentService.run}, not this action.
 *
 * **Invocation capture (R1 / task 0295):** the resolved agent, argv (post
 * slash-command translation), cwd, output mode, timeout, continue state, and
 * stdin interactivity are captured before dispatch and returned in
 * `ActionResult.data.invocation` for the workflow run trace.
 *
 * Options:
 * - `input` (string, conditionally required): prompt or slash command. Only optional
 *   when `continue: true` on an agent whose resume mode carries no prompt (codex).
 * - `agent` (string): agent selector; defaults to the service's default.
 * - `model` (string): model override.
 * - `mode` ("text" | "json"): agent output mode (→ PromptOptions.mode).
 * - `cwd` (string): working directory; defaults to context.workdir.
 * - `continue` (boolean): explicit continue flag. When unset, the session latch
 *   (`vars.__agentSession`) auto-determines continue-on/open-new.
 * - `capture` (boolean): when true, the agent's stdout is also returned in
 *   `data.answer` for downstream steps (e.g. `response.validate`). Output is
 *   always buffered under the non-interactive contract, so `capture` here only
 *   controls whether `answer` is surfaced in `data` — it does NOT switch the
 *   dispatch path. Kept for backward compatibility with existing workflow yaml.
 * - `answerFile` (string): persist the captured stdout to a file (implies capture).
 *   Relative paths resolve against `cwd`; parent dirs are created.
 * - `expectFile` (string): post-exit verification — after a successful (exit-0)
 *   agent run, assert the file exists. If absent, downgrade to `ok:false` with a
 *   clear error. Catches "agent exited 0 but didn't produce the expected artifact"
 *   defects (R6-S2a). Relative paths resolve against `cwd`.
 * - `requireDiff` (boolean): post-exit verification — after a successful (exit-0)
 *   agent run, fail the step unless the working tree has non-corpus changes
 *   (untracked/staged/unstaged, docs/tasks3|docs/features excluded). Catches the
 *   silent no-op defect — "agent exited 0 but did nothing" (R3, task 0424).
 * - `timeoutMs` (number): subprocess timeout in milliseconds. Forwarded via
 *   `AgentRunOptions.timeout` to `ProcessExecutor.run`, which kills the child
 *   on elapse. On timeout, the agent step exits non-zero → `ok:false` → pipeline
 *   routes to `failed`. Absent by default (no timeout).
 *
 * On any failed run (non-zero/null exit, signal, or dispatch error), a
 * partial-work handoff artifact is written to
 * `.spur/run/<runId>-<stateOrNodeId>-partial.md` (R2b / G2 + R1 / task 0295):
 * exit reason (signal vs exit code vs dispatch error), elapsed ms, the resolved
 * invocation, `git diff --stat`, and a bounded tail of captured stdout/stderr.
 * Best-effort — a write failure here never masks the underlying `ok:false` result.
 *
 * Session latch (Q8): the first executed agent.run opens a session (continue: false);
 * subsequent ones inherit it (continue: true). On success, sets `__agentSession: "open"`.
 * Relies on engine `ActionResult.setVars` (F1, available ≥ 0.3.9); on older engines the
 * field is ignored and the latch degrades to explicit per-step `continue`.
 *
 * Resume-mode fallback (task 0406): when the latch auto-sets continue and the agent's
 * resume mode rejects a new prompt (codex), the action retries once as a fresh dispatch
 * and writes `__agentSession: "no-resume"` so subsequent steps skip the latch.
 *
 * Live output capture (task 0414): when an `outputLog` config is provided, the
 * redacted incremental lifecycle events are appended to
 * `.spur/run/<runId>-output.log` (bounded, best-effort) so the run is observable
 * mid-flight via `spur workflow trace`. The child's output policy stays buffered
 * and stdin stays `'ignore'` — the sink consumes the `onOutput` relay as-is.
 */
export class AgentRunActionRunner implements ActionRunner {
    readonly kind = KIND;

    private readonly agentService: AgentService;

    constructor(
        agentService: AgentService,
        private readonly observabilityBus?: WorkflowObservabilityBus,
        private readonly steeringController?: WorkflowSteeringController,
        private readonly outputLog?: RunOutputSinkConfig,
    ) {
        this.agentService = agentService;
    }

    async execute(options: Record<string, unknown>, context: ActionRunContext): Promise<ActionResult> {
        const input = asOptionalString(options.input);
        const agent = asOptionalString(options.agent);
        const model = asOptionalString(options.model);
        const mode = asOptionalString(options.mode) ?? 'text';
        const cwd = asOptionalString(options.cwd) ?? context.workdir ?? '.';

        // Session latch (Q8): auto-determine continue from vars.__agentSession
        // unless the step author set `continue` explicitly.
        let continueFlag = asOptionalBoolean(options.continue);
        const latch = context.vars.__agentSession;
        // Track whether the latch (not an explicit step flag) set continue so
        // the dispatch loop can fall back to a fresh dispatch if the agent's
        // resume mode rejects a new prompt (task 0406 — codex incompatibility).
        const latchAutoContinued = continueFlag === undefined && latch === 'open';
        if (latchAutoContinued) {
            continueFlag = true;
        }

        // Input required unless continue is effectively true on a resume-only agent.
        if (input === undefined && !continueFlag) {
            return {
                ok: false,
                error: `agent.run: input is required (use continue: true for resume-only, or provide a prompt)`,
            };
        }

        const flags: Record<string, string | boolean> = {};
        if (agent !== undefined) flags.agent = agent;
        if (model !== undefined) flags.model = model;
        flags.mode = mode as string;
        if (cwd !== '') flags.cwd = cwd as string;

        const timeoutMs = asOptionalNumber(options.timeoutMs);
        if (timeoutMs !== undefined && timeoutMs <= 0) {
            return {
                ok: false,
                error: 'agent.run: timeoutMs must be > 0',
            };
        }
        if (timeoutMs !== undefined) flags.timeout = String(timeoutMs);
        if (continueFlag !== undefined) flags.continue = continueFlag;

        // `answerFile` implies capture: persist the agent's stdout to a file a
        // downstream shell step can read (the engine only propagates setVars, not
        // result.data, so a file is the deterministic transport for the answer —
        // e.g. the verify step writing its PASS/FAIL verdict artifact).
        const answerFile = asOptionalString(options.answerFile);
        const expectFile = asOptionalString(options.expectFile);
        const requireDiff = asOptionalBoolean(options.requireDiff);
        const capture = asOptionalBoolean(options.capture) || answerFile !== undefined;
        const agentLabel = agent ?? '<default>';

        // Always dispatch via runTraced: forces non-interactive buffered output
        // (R3 / task 0295) and returns the resolved invocation for the run
        // trace (R1). The legacy capture/non-capture branch collapses into a
        // single dispatch path — `capture` now only controls whether the
        // stdout is surfaced as `data.answer`.
        // Live output capture (task 0414): the sink appends redacted lifecycle
        // events to `.spur/run/<runId>-output.log` so a supervisor can tail the
        // run mid-flight. The observer fans out to the sink AND the J3
        // observability bus — both are consumers of the same bounded relay.
        const outputLog = this.outputLog;
        const sink =
            outputLog === undefined
                ? undefined
                : new RunOutputSink({
                      dir: join(cwd, '.spur', 'run'),
                      runId: context.runId,
                      ...(outputLog.maxBytes !== undefined ? { maxBytes: outputLog.maxBytes } : {}),
                      ...(outputLog.maxLines !== undefined ? { maxLines: outputLog.maxLines } : {}),
                  });
        const observer: AgentExecutionObserver | undefined =
            this.observabilityBus === undefined && sink === undefined
                ? undefined
                : (event) => {
                      sink?.observe(event);
                      void this.observabilityBus?.emit('workflow.agent', event);
                  };
        const actionId = context.actionId ?? `${context.runId}:${context.stateOrNodeId}`;
        const steeringPolicy = parseSteeringPolicy(options);
        let resumeRetried = false;
        let steeringNote: string | undefined;
        let traced: AgentRunTracedResult;
        try {
            // Outer loop: resume-mode fallback (task 0406). If the session latch
            // auto-set continue and the agent's resume mode rejects a new prompt
            // (exitCode 2 = shim threw before process launch), retry once as a
            // fresh dispatch. Agent-agnostic — works for codex and any agent with
            // the same limitation. The sentinel `__agentSession: 'no-resume'`
            // written on success prevents future steps from repeating the cycle.
            for (;;) {
                steeringNote = undefined;
                let steeringSignal = this.steeringController?.begin(context.runId, actionId, steeringPolicy);
                while (true) {
                    traced = await this.agentService.runTraced(input, flags, undefined, {
                        correlation: {
                            runId: context.runId,
                            executionId: crypto.randomUUID(),
                            actionId,
                        },
                        ...(observer !== undefined ? { observer } : {}),
                        ...(steeringSignal !== undefined ? { signal: steeringSignal } : {}),
                    });
                    if (this.steeringController === undefined) break;
                    const decision = await this.steeringController.boundary(traced.exitCode === 0);
                    if (decision.operation === 'retry') {
                        steeringSignal = this.steeringController.nextAttempt();
                        continue;
                    }
                    if (decision.operation === 'note') steeringNote = decision.note;
                    if (decision.operation === 'abort' && traced.exitCode === 0) {
                        traced = {
                            ...traced,
                            exitCode: 3,
                            signal: 'STEERING_ABORT',
                            message: 'aborted at steering boundary',
                        };
                    }
                    break;
                }
                this.steeringController?.complete();

                // Resume-mode fallback: exitCode 2 signals a dispatch error (shim
                // threw before process launch), not an agent failure or timeout.
                if (!resumeRetried && latchAutoContinued && traced.exitCode === 2) {
                    resumeRetried = true;
                    delete flags.continue;
                    continue;
                }
                break;
            }
            const { exitCode, stdout: answer } = traced;
            const ok = exitCode === 0;
            const invocation = traced.invocation;

            if (capture && answerFile !== undefined) {
                const target = isAbsolute(answerFile) ? answerFile : join(cwd, answerFile);
                const fs = createNodeFileSystem(cwd);
                await fs.ensureDir(dirname(target));
                await fs.writeFile(target, answer);
            }

            // R6-S2a: verify expected side-effect artifact exists after exit-0.
            if (ok && expectFile !== undefined) {
                const target = isAbsolute(expectFile) ? expectFile : join(cwd, expectFile);
                const fs = createNodeFileSystem(cwd);
                if (!(await fs.exists(target))) {
                    return {
                        ok: false,
                        data: buildResultData(exitCode, agentLabel, capture, answer, invocation),
                        error: `agent.run (${agentLabel}) exited 0 but expected file is absent: ${expectFile}`,
                    };
                }
            }

            const stepLabel = context.stateOrNodeId;

            // R3 (task 0424): empty-implement no-op guard. After exit-0, fail the
            // step when the agent produced no non-corpus working-tree changes — a
            // silent no-op must not drift into test/review where it is caught only
            // after a full pipeline pass. Mirrors expectFile's post-exit check, but
            // over `git status --porcelain` (covers untracked new files too, which
            // `git diff` misses) with the corpus dirs excluded (the pipeline itself
            // writes docs/tasks3|docs/features). Tree-level approximation: a
            // pre-existing dirty tree reads as non-empty — safe direction, a false
            // pass would silently certify an empty implement.
            if (ok && requireDiff === true && !(await gitHasNonCorpusChanges(cwd))) {
                return {
                    ok: false,
                    data: buildResultData(exitCode, agentLabel, capture, answer, invocation),
                    error: `agent.run '${stepLabel}' (${agentLabel}) exited 0 but produced zero non-corpus file changes — empty implement (no-op). The implement agent must change at least one file outside docs/tasks3|docs/features; fix the implement input and re-run the pipeline.`,
                };
            }

            if (!ok) {
                await writePartialWorkArtifact(context, agentLabel, model, traced, cwd);
            }

            // Actionable failure message (R4 / task 0295): identify the workflow
            // step and configured timeout, then distinguish signal termination from
            // dispatch failure and a plain non-zero exit.
            // R2 (task 0424): subprocess failures name the partial-work artifact
            // path and the resume action — a timed-out implement must not be a dead
            // end that leaves the partial tree undiscoverable.
            const partialWorkHint = `partial work (if any) preserved at .spur/run/${context.runId}-${stepLabel}-partial.md; resume from that tree per the timed-out-implement runbook (plugins/sp/skills/spur-dev/references/execution-workflow.md)`;
            const error = ok
                ? undefined
                : traced.signal !== undefined
                  ? timeoutMs !== undefined
                      ? `agent.run '${stepLabel}' (${agentLabel}) terminated by signal ${traced.signal} (configured timeout: ${timeoutMs}ms; timeout or cancellation); ${partialWorkHint}`
                      : `agent.run '${stepLabel}' (${agentLabel}) was cancelled by signal ${traced.signal}; ${partialWorkHint}`
                  : traced.message !== undefined
                    ? `agent.run '${stepLabel}' (${agentLabel}) dispatch failed: ${traced.message}`
                    : `agent.run '${stepLabel}' (${agentLabel}) exited with code ${exitCode}; ${partialWorkHint}`;

            return {
                ok,
                data: buildResultData(exitCode, agentLabel, capture, answer, invocation),
                error,
                // Latch: mark the session open after the first successful agent.run so later
                // steps auto-continue (Q8). When we fell back to a fresh dispatch because
                // the agent's resume mode rejected continue (task 0406), write 'no-resume'
                // so subsequent steps skip the latch and avoid repeating the wasted dispatch.
                setVars: ok
                    ? {
                          __agentSession: resumeRetried ? 'no-resume' : 'open',
                          ...(steeringNote !== undefined ? { __steeringNote: steeringNote } : {}),
                      }
                    : undefined,
            };
        } finally {
            sink?.close();
        }
    }
}

/**
 * Build the `ActionResult.data` payload. Always includes `exitCode`, `agent`,
 * and (when available) the resolved `invocation` for the run trace (R1 / task
 * 0295). Includes `answer` only when the caller asked for capture, to keep
 * non-capture results lean.
 */
function buildResultData(
    exitCode: number,
    agentLabel: string,
    capture: boolean,
    answer: string,
    invocation: AgentRunInvocation | undefined,
): Record<string, unknown> {
    const data: Record<string, unknown> = { exitCode, agent: agentLabel };
    if (capture) data.answer = answer;
    if (invocation !== undefined) data.invocation = invocation;
    return data;
}

function asOptionalString(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    return String(value);
}

function asOptionalBoolean(value: unknown): boolean | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return undefined;
}

function asOptionalNumber(value: unknown): number | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const n = Number(value);
        return Number.isNaN(n) ? undefined : n;
    }
    return undefined;
}

/**
 * Write a machine-readable partial-work handoff artifact after a failed
 * `agent.run` (R2b / G2 — implement-step timeouts, bugs 742/744/746/748;
 * R1 / task 0295 — include the resolved invocation for post-mortem).
 * Destination: `.spur/run/<runId>-<stateOrNodeId>-partial.md`, relative to `cwd`.
 * Best-effort: any error here is swallowed so it never masks the real `ok:false`
 * action result the caller already returns.
 */
async function writePartialWorkArtifact(
    context: ActionRunContext,
    agentLabel: string,
    model: string | undefined,
    traced: AgentRunTracedResult,
    cwd: string,
): Promise<void> {
    try {
        const signal = traced.signal;
        const exitReason =
            signal !== undefined
                ? `killed by signal ${signal} (likely timeout or cancellation)`
                : traced.message !== undefined
                  ? `dispatch error: ${traced.message}`
                  : `exited with code ${traced.exitCode}`;
        const diffStat = await gitDiffStat(cwd);
        const stdoutTail = tail(traced.stdout, PARTIAL_ARTIFACT_TAIL_CHARS);
        const stderrTail = tail(traced.stderr ?? '', PARTIAL_ARTIFACT_TAIL_CHARS);
        const headerLine = model !== undefined ? `${agentLabel} (model: ${model})` : agentLabel;
        const inv = traced.invocation;
        const argvLine = inv ? `${inv.command} ${inv.argv.join(' ')}` : '(invocation not captured)';
        const body = [
            `# Partial-work handoff — ${headerLine}`,
            '',
            `- run: ${context.runId}`,
            `- state: ${context.stateOrNodeId}`,
            `- agent: ${agentLabel}`,
            `- model: ${model ?? '(default)'}`,
            `- exit reason: ${exitReason}`,
            `- elapsed: ${traced.durationMs ?? 'unknown'}ms`,
            '',
            '## resolved invocation',
            '',
            `- command: ${argvLine}`,
            `- cwd: ${inv?.cwd ?? '(inherit)'}`,
            `- mode: ${inv?.mode ?? 'unknown'}`,
            `- timeoutMs: ${inv?.timeoutMs ?? '(none)'}`,
            `- continue: ${inv?.continue ?? false}`,
            `- output: ${inv?.outputMode ?? 'unknown'}`,
            `- stdinInteractive: ${inv?.stdinInteractive ?? false}`,
            `- translatedFrom: ${inv?.translatedFrom ?? '(none)'}`,
            '',
            '## git diff --stat',
            '```',
            diffStat || '(no diff)',
            '```',
            '',
            '## stdout tail',
            '```',
            stdoutTail || '(empty)',
            '```',
            '',
            '## stderr tail',
            '```',
            stderrTail || '(empty)',
            '```',
            '',
        ].join('\n');

        const target = join(cwd, '.spur', 'run', `${context.runId}-${context.stateOrNodeId}-partial.md`);
        const fs = createNodeFileSystem(cwd);
        await fs.ensureDir(dirname(target));
        await fs.writeFile(target, body);
    } catch {
        // Best-effort — never let artifact-writing mask the real failure.
    }
}

async function gitDiffStat(cwd: string): Promise<string> {
    try {
        const result = await new NodeProcessExecutor().run({
            command: 'git',
            args: ['diff', '--stat'],
            cwd,
            maxOutput: 1024 * 1024,
            forceBuffered: true,
            rejectOnError: false,
        });
        return result.exitCode === 0 ? result.stdout.trim() : '';
    } catch {
        return '';
    }
}

/**
 * Empty-implement gate probe (R3, task 0424): does the working tree have any
 * non-corpus changes? `git status --porcelain` — covers untracked new files
 * (which `git diff` misses) plus staged and unstaged modifications — with the
 * corpus pathspecs excluded. Non-git or unreadable trees read as "no changes"
 * so the gate rejects (conservative: a false rejection is a diagnostic, a false
 * pass would certify an empty implement).
 */
async function gitHasNonCorpusChanges(cwd: string): Promise<boolean> {
    try {
        const result = await new NodeProcessExecutor().run({
            command: 'git',
            args: ['status', '--porcelain', '--', '.', ':(exclude)docs/tasks3/*', ':(exclude)docs/features/*'],
            cwd,
            maxOutput: 1024 * 1024,
            forceBuffered: true,
            rejectOnError: false,
        });
        return result.exitCode === 0 && result.stdout.trim() !== '';
    } catch {
        return false;
    }
}

function tail(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return `... (truncated) ...\n${text.slice(text.length - maxChars)}`;
}
