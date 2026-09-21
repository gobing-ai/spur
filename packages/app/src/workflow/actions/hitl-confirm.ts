import type { ActionResult, ActionRunContext, ActionRunner, HitlResponder } from '@gobing-ai/ts-dual-workflow-engine';
import { type DecisionEvaluator, parseDecisionConfig, resolveDecision } from '../decision-hitl-responder';

const KIND = 'hitl.confirm';

/**
 * Human-in-the-loop confirm action (Yes / No / Cancel).
 *
 * Options:
 * - `prompt` (string, required): the question to present.
 * - `var` (string, optional): var name for the answer; defaults to `__hitlAnswer`.
 * - `decision` (object, optional): explicit never/evidence policy (0911).
 */
export class HitlConfirmActionRunner implements ActionRunner {
    readonly kind = KIND;

    constructor(
        private readonly responder: HitlResponder,
        private readonly evaluator?: DecisionEvaluator,
    ) {}

    async execute(options: Record<string, unknown>, context: ActionRunContext): Promise<ActionResult> {
        const prompt = asString(options.prompt);
        if (prompt === undefined) {
            return { ok: false, error: 'hitl.confirm: prompt is required' };
        }

        const varName = asString(options.var) ?? '__hitlAnswer';
        const parsed = parseDecisionConfig(options, varName, 'confirm');
        if (!parsed.ok) {
            return { ok: false, error: `hitl.confirm: ${parsed.error}` };
        }

        context.events?.emit('workflow.hitl.ask', {
            runId: context.runId,
            node: context.stateOrNodeId,
            kind: 'confirm',
            message: prompt,
            severity: 'info',
        });
        const resolved = await resolveDecision(
            this.responder,
            this.evaluator,
            { kind: 'confirm', prompt, runId: context.runId, node: context.stateOrNodeId },
            parsed.config,
        );
        const { answer } = resolved;
        context.events?.emit('workflow.hitl.response', {
            runId: context.runId,
            node: context.stateOrNodeId,
            ok: !(answer.cancelled || answer.value === 'cancel'),
            severity: 'info',
        });

        const setVars: Record<string, string> = { [varName]: answer.value };
        if (resolved.statusVar !== undefined && resolved.statusValue !== undefined) {
            setVars[resolved.statusVar] = resolved.statusValue;
        }

        return {
            ok: true,
            data: {
                answer: answer.value,
                cancelled: answer.cancelled === true || answer.value === 'cancel',
                ...(resolved.provenance !== undefined ? { decision: resolved.provenance } : {}),
            },
            setVars,
        };
    }
}

function asString(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    return String(value);
}
