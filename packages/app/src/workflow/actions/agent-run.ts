import type { ActionResult, ActionRunContext, ActionRunner } from '@gobing-ai/ts-dual-workflow-engine';
import type { AgentService } from '../../services/agent-service';

const KIND = 'agent.run';

/**
 * Workflow action that delegates to AgentService.run.
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
 * - `capture` (boolean): when true, use `AgentService.runCapture` to capture the
 *   agent's stdout. The answer text is returned in `data.answer` for downstream
 *   steps (e.g. `response.validate`). Output is buffered, not streamed.
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
        if (continueFlag !== undefined) flags.continue = continueFlag;

        const capture = asOptionalBoolean(options.capture);
        const agentLabel = agent ?? '<default>';

        if (capture) {
            const { exitCode, answer } = await this.agentService.runCapture(input, flags);
            const ok = exitCode === 0;
            return {
                ok,
                data: { exitCode, agent: agentLabel, answer },
                error: ok ? undefined : `agent.run (${agentLabel}) exited with code ${exitCode}`,
                setVars: ok ? { __agentSession: 'open' } : undefined,
            };
        }

        const exitCode = await this.agentService.run(input, flags);
        const ok = exitCode === 0;
        return {
            ok,
            data: { exitCode, agent: agentLabel },
            error: ok ? undefined : `agent.run (${agentLabel}) exited with code ${exitCode}`,
            // Latch: mark the session open after the first successful agent.run so later
            // steps auto-continue (Q8). Requires engine setVars (F1, ≥0.3.9).
            setVars: ok ? { __agentSession: 'open' } : undefined,
        };
    }
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
