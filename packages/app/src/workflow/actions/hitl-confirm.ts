import type { ActionResult, ActionRunContext, ActionRunner, HitlResponder } from '@gobing-ai/ts-dual-workflow-engine';

const KIND = 'hitl.confirm';

/**
 * Human-in-the-loop confirm action (Yes / No / Cancel).
 *
 * Options:
 * - `prompt` (string, required): the question to present.
 * - `var` (string, optional): var name for the answer; defaults to `__hitlAnswer`.
 */
export class HitlConfirmActionRunner implements ActionRunner {
    readonly kind = KIND;

    private readonly responder: HitlResponder;

    constructor(responder: HitlResponder) {
        this.responder = responder;
    }

    async execute(options: Record<string, unknown>, context: ActionRunContext): Promise<ActionResult> {
        const prompt = asString(options.prompt);
        if (prompt === undefined) {
            return { ok: false, error: 'hitl.confirm: prompt is required' };
        }

        const varName = asString(options.var) ?? '__hitlAnswer';

        context.events?.emit('workflow.hitl.ask', {
            runId: context.runId,
            node: context.stateOrNodeId,
            kind: 'confirm',
            message: prompt,
            severity: 'info',
        });
        const answer = await this.responder.respond({
            kind: 'confirm',
            prompt,
            runId: context.runId,
            node: context.stateOrNodeId,
        });
        context.events?.emit('workflow.hitl.response', {
            runId: context.runId,
            node: context.stateOrNodeId,
            ok: !(answer.cancelled || answer.value === 'cancel'),
            severity: 'info',
        });

        return {
            ok: true,
            data: { answer: answer.value, cancelled: answer.cancelled === true || answer.value === 'cancel' },
            setVars: { [varName]: answer.value },
        };
    }
}

function asString(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    return String(value);
}
