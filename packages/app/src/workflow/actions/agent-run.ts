import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import type { ActionResult, ActionRunContext, ActionRunner } from '@gobing-ai/ts-dual-workflow-engine';
import type { AgentRunInvocation, AgentRunTracedResult, AgentService } from '../../services/agent-service';

const execFileAsync = promisify(execFile);

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
 */
export class AgentRunActionRunner implements ActionRunner {
    readonly kind = KIND;

    private readonly agentService: AgentService;

    constructor(agentService: AgentService) {
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
        if (continueFlag === undefined && latch === 'open') {
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
        const capture = asOptionalBoolean(options.capture) || answerFile !== undefined;
        const agentLabel = agent ?? '<default>';

        // Always dispatch via runTraced: forces non-interactive buffered output
        // (R3 / task 0295) and returns the resolved invocation for the run
        // trace (R1). The legacy capture/non-capture branch collapses into a
        // single dispatch path — `capture` now only controls whether the
        // stdout is surfaced as `data.answer`.
        const traced = await this.agentService.runTraced(input, flags);
        const { exitCode, stdout: answer } = traced;
        const ok = exitCode === 0;
        const invocation = traced.invocation;

        if (capture && answerFile !== undefined) {
            const target = isAbsolute(answerFile) ? answerFile : join(cwd, answerFile);
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, answer, 'utf8');
        }

        // R6-S2a: verify expected side-effect artifact exists after exit-0.
        if (ok && expectFile !== undefined) {
            const target = isAbsolute(expectFile) ? expectFile : join(cwd, expectFile);
            if (!existsSync(target)) {
                return {
                    ok: false,
                    data: buildResultData(exitCode, agentLabel, capture, answer, invocation),
                    error: `agent.run (${agentLabel}) exited 0 but expected file is absent: ${expectFile}`,
                };
            }
        }

        if (!ok) {
            await writePartialWorkArtifact(context, agentLabel, model, traced, cwd);
        }

        // Actionable failure message (R4 / task 0295): identify the workflow
        // step and configured timeout, then distinguish signal termination from
        // dispatch failure and a plain non-zero exit.
        const stepLabel = context.stateOrNodeId;
        const error = ok
            ? undefined
            : traced.signal !== undefined
              ? timeoutMs !== undefined
                  ? `agent.run '${stepLabel}' (${agentLabel}) terminated by signal ${traced.signal} (configured timeout: ${timeoutMs}ms; timeout or cancellation); see partial-work artifact`
                  : `agent.run '${stepLabel}' (${agentLabel}) was cancelled by signal ${traced.signal}; see partial-work artifact`
              : traced.message !== undefined
                ? `agent.run '${stepLabel}' (${agentLabel}) dispatch failed: ${traced.message}`
                : `agent.run '${stepLabel}' (${agentLabel}) exited with code ${exitCode}`;

        return {
            ok,
            data: buildResultData(exitCode, agentLabel, capture, answer, invocation),
            error,
            // Latch: mark the session open after the first successful agent.run so later
            // steps auto-continue (Q8). Requires engine setVars (F1, ≥0.3.9).
            setVars: ok ? { __agentSession: 'open' } : undefined,
        };
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
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, body, 'utf8');
    } catch {
        // Best-effort — never let artifact-writing mask the real failure.
    }
}

async function gitDiffStat(cwd: string): Promise<string> {
    try {
        const { stdout } = await execFileAsync('git', ['diff', '--stat'], { cwd, maxBuffer: 1024 * 1024 });
        return stdout.trim();
    } catch {
        return '';
    }
}

function tail(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return `... (truncated) ...\n${text.slice(text.length - maxChars)}`;
}
