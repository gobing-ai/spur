import { dirname, isAbsolute, join } from 'node:path';
import type { ActionResult, ActionRunContext, ActionRunner } from '@gobing-ai/ts-dual-workflow-engine';
import { createNodeFileSystem, NodeProcessExecutor } from '@gobing-ai/ts-runtime';
import type { AgentExecutionObserver } from '../../observability/agent-execution';
import type { AgentRunInvocation, AgentRunTracedResult, AgentService } from '../../services/agent-service';
import { TaskLocator } from '../../services/task-locator';
import type { WorkflowObservabilityBus } from '../observability';
import { parseSteeringPolicy, type WorkflowSteeringController } from '../steering';

/** Bound the stdout/stderr tail captured into the partial-work artifact (R2b). */
const PARTIAL_ARTIFACT_TAIL_CHARS = 4000;

/** Progress heartbeat interval for agent.run steps (R3, task 0454). */
export const AGENT_RUN_PROGRESS_INTERVAL_MS = 30_000;

const KIND = 'agent.run';

/** Config slice injected at composition root for agent.run steps (R1, task 0451). */
export interface AgentRunAgentConfig {
    default?: string;
    sessionAffinity?: boolean;
    /**
     * Pathspec exclude globs for the requireDiff empty-implement gate (R4, task 0451).
     * Defaults to `['docs/tasks3/*', 'docs/features/*']` when absent.
     */
    excludeGlobs?: string[];
}

/**
 * Workflow action that delegates to AgentService.runTraced — the pipeline's
 * non-interactive agent dispatch path (task 0295 / R3).
 *
 * **Non-interactive contract (R3 / task 0295):** every `agent.run` dispatched
 * by a workflow uses {@link AgentService.runTraced}, which forces
 * `{ mode: 'pipe' }` output (nonInteractive) — the subprocess therefore
 * inherits pipe-no-TTY stdout/stderr, so output streams live via onOutput
 * without a child TTY. Direct `spur agent run` from a terminal keeps its
 * interactive streaming behavior because it uses {@link AgentService.run},
 * not this action.
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
 *   `data.answer` for downstream steps (e.g. `response.validate`). Capture is
 *   available because the non-interactive path captures stdout regardless —
 *   `capture` here only controls whether `answer` is surfaced in `data`.
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
 * Session latch (Q8) + affinity matrix (H83 / 0451 R3 / 0452 R4 docs):
 *
 *   | affinityOn  | resume via sessionDir/sessionId; latch does NOT set bare continue |
 *   | affinityOff | Q8 latch may set continue:true; 0406 exit-2 → no-resume fallback  |
 *
 * On success, sets `__agentSession: "open"`. Relies on engine `ActionResult.setVars`
 * (F1, available ≥ 0.3.9); on older engines the field is ignored and the latch
 * degrades to explicit per-step `continue`.
 *
 * Resume-mode fallback (task 0406): when affinityOff latch auto-sets continue and the
 * agent's resume mode rejects a new prompt (codex), the action retries once as a fresh
 * dispatch and writes `__agentSession: "no-resume"` so subsequent steps skip the latch.
 *
 * Live output capture (feature D2 / task 0426): the redacted incremental
 * lifecycle events are emitted to the observability bus as `workflow.agent`;
 * the consolidated run-log sink (`.spur/run/<runId>.log`) subscribes there and
 * captures the child's stdout/stderr (bounded, best-effort) for `spur workflow
 * trace`. The child's output policy is pipe-no-TTY (nonInteractive) and stdin stays `'ignore'`
 * — the observer consumes the `onOutput` relay as-is.
 */
export class AgentRunActionRunner implements ActionRunner {
    readonly kind = KIND;

    private readonly agentService: AgentService;

    constructor(
        agentService: AgentService,
        private readonly observabilityBus?: WorkflowObservabilityBus,
        private readonly steeringController?: WorkflowSteeringController,
        private readonly agentConfig: AgentRunAgentConfig = {},
    ) {
        this.agentService = agentService;
    }

    async execute(options: Record<string, unknown>, context: ActionRunContext): Promise<ActionResult> {
        const input = asOptionalString(options.input);
        const agent = asOptionalString(options.agent);
        // R1 (0451): config is injected at composition root, not read from a fake cast.
        // Affinity config via this.agentConfig below.
        // ADR-047 (0449 R2): `inline` on a headless dispatch surface ≡ omit → agent.default.
        // Normalize to the configured default executor name before dispatch so session
        // affinity / labels key off the real executor, never the literal `inline`.
        const dispatchAgent = agent === 'inline' ? (this.agentConfig.default ?? undefined) : agent;
        const model = asOptionalString(options.model);
        const mode = asOptionalString(options.mode) ?? 'text';
        const cwd = asOptionalString(options.cwd) ?? context.workdir ?? '.';

        const sessionAffinityVar = context.vars.sessionAffinity;
        const affinityDisabled =
            sessionAffinityVar === 'false' ||
            (typeof sessionAffinityVar === 'boolean' && !sessionAffinityVar) ||
            options.sessionAffinity === false ||
            this.agentConfig.sessionAffinity === false;
        const affinityOn = !affinityDisabled;

        const agentLabel = dispatchAgent ?? '<default>';
        const targetAgentDir = dispatchAgent ?? this.agentConfig.default ?? 'omp';
        const prevAgent = asOptionalString(context.vars.__agentSessionAgent);

        let sessionDir = asOptionalString(context.vars.__agentSessionDir);
        if (affinityOn) {
            if (!sessionDir || (prevAgent && prevAgent !== targetAgentDir)) {
                sessionDir = join(cwd, '.spur', 'run', context.runId, 'agent-sessions', targetAgentDir);
            }
        } else {
            // Without affinity, still write session logs under .spur/run/<runId>/agent-sessions/
            // instead of the agent's cwd (project root). One-hop dir only — not persisted to
            // __agentSessionDir for subsequent hops, since affinity tracking is off.
            if (!sessionDir) {
                sessionDir = join(cwd, '.spur', 'run', context.runId, 'agent-sessions', targetAgentDir);
            }
        }
        const storedSessionId = asOptionalString(context.vars.__agentSessionId);

        // Session latch (Q8): auto-determine continue from vars.__agentSession
        // unless the step author set `continue` explicitly.
        let continueFlag = asOptionalBoolean(options.continue);
        const latch = context.vars.__agentSession;
        // Track whether the latch (not an explicit step flag) set continue so
        // the dispatch loop can fall back to a fresh dispatch if the agent's
        // resume mode rejects a new prompt (task 0406 — codex incompatibility).
        const latchAutoContinued = continueFlag === undefined && latch === 'open';
        if (latchAutoContinued) {
            // R3 (0451): affinity on → resume via sessionDir/sessionId only, not bare continue.
            // Affinity off → restore Q8: latch open sets continue:true.
            if (!affinityOn) {
                continueFlag = true;
            }
            // affinityOn: leave continueFlag undefined — resume via sessionDir/sessionId only.
        }

        // Input required unless continue is effectively true on a resume-only agent.
        if (input === undefined && !continueFlag) {
            return {
                ok: false,
                error: `agent.run: input is required (use continue: true for resume-only, or provide a prompt)`,
            };
        }

        const flags: Record<string, string | boolean> = {};
        if (dispatchAgent !== undefined) flags.agent = dispatchAgent;
        if (model !== undefined) flags.model = model;
        flags.mode = mode as string;
        if (cwd !== '') flags.cwd = cwd as string;

        if (sessionDir) {
            flags.sessionDir = sessionDir;
            if (affinityOn && storedSessionId) {
                flags.sessionId = storedSessionId;
            }
        }

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

        // Always dispatch via runTraced: forces non-interactive pipe-no-TTY
        // output (H83 R5 / task 0295+0448) so onOutput streams live without a
        // child TTY, and returns the resolved invocation for the run trace
        // (R1). Capture still only controls whether stdout is surfaced as
        // `data.answer` (answerFile / expectFile path).
        // Child-agent lifecycle is fanned out to the observability bus as the
        // `workflow.agent` event; the consolidated run-log sink (feature D2) is a
        // subscriber on that bus, so the agent's stdout/stderr reach the log without
        // a per-step file sink here.
        const observer: AgentExecutionObserver | undefined =
            this.observabilityBus === undefined
                ? undefined
                : (event) => {
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
                        heartbeatMs: AGENT_RUN_PROGRESS_INTERVAL_MS,
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
            if (ok && requireDiff === true && !(await gitHasNonCorpusChanges(cwd, this.agentConfig.excludeGlobs))) {
                return {
                    ok: false,
                    data: buildResultData(exitCode, agentLabel, capture, answer, invocation),
                    error: `agent.run '${stepLabel}' (${agentLabel}) exited 0 but produced zero non-corpus file changes — empty implement (no-op). The implement agent must change at least one file outside the configured task/feature folders; fix the implement input and re-run the pipeline.`,
                };
            }

            if (!ok) {
                await writePartialWorkArtifact(context, agentLabel, model, traced, cwd, sessionDir);
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

            // R2 (0451): key __agentSessionAgent off the resolved invocation.agent
            const resolvedAgent = invocation?.agent ?? targetAgentDir;
            let resolvedSessionDir = sessionDir;
            if (ok && affinityOn && resolvedAgent !== targetAgentDir && !context.vars.__agentSessionDir) {
                resolvedSessionDir = join(cwd, '.spur', 'run', context.runId, 'agent-sessions', resolvedAgent);
            }

            let discoveredSessionId = storedSessionId;
            if (ok && affinityOn && resolvedSessionDir && !discoveredSessionId) {
                discoveredSessionId = await discoverSessionId(resolvedSessionDir);
            }

            if (ok && affinityOn && resolvedSessionDir) {
                try {
                    const sidecarPath = join(cwd, '.spur', 'run', `${context.runId}-agent-session.json`);
                    const fs = createNodeFileSystem(cwd);
                    await fs.ensureDir(dirname(sidecarPath));
                    await fs.writeFile(
                        sidecarPath,
                        JSON.stringify(
                            {
                                agent: resolvedAgent,
                                sessionId: discoveredSessionId ?? null,
                                sessionDir: resolvedSessionDir,
                                openedAt: new Date().toISOString(),
                            },
                            null,
                            2,
                        ),
                    );
                } catch {
                    // R9 (0452): best-effort sidecar write — never overrides agent ok/error.
                    // No workflow.debug bus event; failure is informational only.
                }
            }

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
                          ...(affinityOn && resolvedSessionDir ? { __agentSessionDir: resolvedSessionDir } : {}),
                          ...(affinityOn && (discoveredSessionId || storedSessionId)
                              ? { __agentSessionId: discoveredSessionId || storedSessionId }
                              : {}),
                          ...(affinityOn ? { __agentSessionAgent: resolvedAgent } : {}),
                          ...(steeringNote !== undefined ? { __steeringNote: steeringNote } : {}),
                      }
                    : undefined,
            };
        } finally {
            // Nothing to clean up per-step: agent output is owned by the consolidated
            // run-log sink via the observability bus (feature D2 / task 0426).
        }
    }
}

async function discoverSessionId(sessionDir: string): Promise<string | undefined> {
    try {
        const fs = createNodeFileSystem();
        if (!(await fs.exists(sessionDir))) return undefined;
        const entries = await fs.readDir(sessionDir);
        if (entries.length === 0) return undefined;
        // R5 (0451): prefer only *.json files when selecting newest — non-json files
        // (log, tmp, etc.) should not win by mtime. Newest-json heuristic: when
        // multiple session files exist, the newest by mtime wins. This is a best-effort
        // heuristic; a future agent-native session discovery API would replace it.
        const jsonEntries = entries.filter((e) => e.toLowerCase().endsWith('.json'));
        if (jsonEntries.length === 0) return undefined;
        let newestFile: string | undefined;
        let newestMtime = 0;
        for (const entry of jsonEntries) {
            const fullPath = join(sessionDir, entry);
            const st = await fs.stat(fullPath);
            if (st?.isFile() && st.mtimeMs > newestMtime) {
                newestMtime = st.mtimeMs;
                newestFile = entry;
            }
        }
        if (!newestFile) return undefined;
        return newestFile.replace(/\.json$/i, '');
    } catch {
        return undefined;
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
 * Extract completed requirements from a task markdown body for the partial-work
 * artifact heuristic section (R4, task 0454).
 *
 * Heuristic: Plan `- [x]` items and Solution `R\d+` mentions.
 * Labeled as heuristic — never claims MET.
 */
export function extractCompletedRequirementsHeuristic(taskMarkdown: string): string[] {
    const found = new Set<string>();

    // 1. Plan checklist items currently `- [x]`
    const planMatch = taskMarkdown.match(/^#{2,3}\s+Plan\s*$/m);
    if (planMatch) {
        const rest = taskMarkdown.slice((planMatch.index ?? 0) + planMatch[0].length);
        const nextSection = rest.match(/^#{2,3}\s+/m);
        const planBody = nextSection ? rest.slice(0, nextSection.index ?? 0) : rest;
        const xItems = planBody.match(/^\s*-\s*\[x\]\s*(.+)$/gim);
        if (xItems) {
            for (const item of xItems) {
                const text = item.replace(/^\s*-\s*\[x\]\s*/i, '').trim();
                if (text) found.add(`- [x] ${text}`);
            }
        }
    }

    // 2. Solution body R# mentions (## Solution or ### Solution — task corpus uses H3)
    const solutionMatch = taskMarkdown.match(/^#{2,3}\s+Solution\s*$/m);
    if (solutionMatch) {
        const rest = taskMarkdown.slice((solutionMatch.index ?? 0) + solutionMatch[0].length);
        const nextSection = rest.match(/^#{2,3}\s+/m);
        const solutionBody = nextSection ? rest.slice(0, nextSection.index ?? 0) : rest;
        const rMatches = solutionBody.match(/\bR\d+\b/g);
        if (rMatches) {
            for (const r of [...new Set(rMatches)].sort()) {
                found.add(r);
            }
        }
    }

    return found.size > 0 ? [...found] : ['unknown — Solution empty and Plan checkboxes open'];
}

/**
 * Write a machine-readable partial-work handoff artifact after a failed
 * or timed-out implement hop (R2b / task 0375). Best-effort: never masks
 * the action result the caller already returns.
 */
async function writePartialWorkArtifact(
    context: ActionRunContext,
    agentLabel: string,
    model: string | undefined,
    traced: AgentRunTracedResult,
    cwd: string,
    sessionDir: string | undefined,
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

        // R4 (0482): resume-context block — the dead agent's transcript lives in
        // the session dir (plus the latched sidecar when affinity is on). Naming
        // it here lets an operator resume without re-deriving the output contract.
        const latchedSessionPath = join(cwd, '.spur', 'run', `${context.runId}-agent-session.json`);
        const resumeContext = [
            '',
            '## resume context',
            '',
            `- session dir: ${sessionDir ?? '(none captured)'}`,
            `- latched session file: ${latchedSessionPath}`,
            '',
        ].join('\n');

        // R4 (0454): completed-requirements heuristic section
        let completedSection = '';
        const wbs = String(context.vars.wbs ?? '');
        if (wbs) {
            try {
                const fs = createNodeFileSystem(cwd);
                const locator = TaskLocator.forDirs(fs, [
                    join(cwd, 'docs', 'tasks3'),
                    join(cwd, 'docs', 'tasks2'),
                    join(cwd, 'docs', 'tasks'),
                ]);
                const hit = await locator.findByWbs(wbs);
                if (hit) {
                    const taskMarkdown = await fs.readFile(hit.filePath);
                    const completed = extractCompletedRequirementsHeuristic(taskMarkdown);
                    completedSection = [
                        '',
                        '## completed requirements (heuristic)',
                        '',
                        // Plan rows already start with `- [x]`; R# tokens need a bullet.
                        ...completed.map((l) => (l.startsWith('-') ? l : `- ${l}`)),
                        '',
                    ].join('\n');
                }
            } catch {
                // Best-effort: task file lookup failure is not a partial-artifact failure.
            }
        }
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
            resumeContext,
            completedSection,
        ].join('\n');

        const target = join(cwd, '.spur', 'run', `${context.runId}-${context.stateOrNodeId}-partial.md`);
        const fs = createNodeFileSystem(cwd);
        await fs.ensureDir(dirname(target));
        await fs.writeFile(target, body);
    } catch {
        // R9 (0452): best-effort partial-work artifact — never mask ok:false.
        // Standalone helper has no logger/bus; caller already has the failure result.
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
 *
 * R4 (0451): excludeGlobs parameter replaces the hardcoded pathspec list so
 * all configured task folders (docs/tasks, docs/tasks2, ...) plus docs/features
 * are excluded. When called from tests without excludeGlobs, defaults cover
 * the active folder + docs/features for backward compatibility.
 */
async function gitHasNonCorpusChanges(
    cwd: string,
    excludeGlobs: string[] = ['docs/tasks3/*', 'docs/features/*'],
): Promise<boolean> {
    try {
        const excludes = excludeGlobs.map((g) => `:(exclude)${g}`);
        const result = await new NodeProcessExecutor().run({
            command: 'git',
            args: ['status', '--porcelain', '--', '.', ...excludes],
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
