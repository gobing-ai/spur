import type { ActionResult, ActionRunContext, ActionRunner, HitlResponder } from '@gobing-ai/ts-dual-workflow-engine';

const KIND = 'hitl.select';

/**
 * Human-in-the-loop select action (choose from a list).
 *
 * Options:
 * - `prompt` (string, required): the question to present.
 * - `options` (string[], required, ≥1): the choices.
 * - `var` (string, optional): var name for the answer; defaults to `__hitlAnswer`.
 */
export class HitlSelectActionRunner implements ActionRunner {
    readonly kind = KIND;

    private readonly responder: HitlResponder;

    constructor(responder: HitlResponder) {
        this.responder = responder;
    }

    async execute(options: Record<string, unknown>, context: ActionRunContext): Promise<ActionResult> {
        const prompt = asString(options.prompt);
        if (prompt === undefined) {
            return { ok: false, error: 'hitl.select: prompt is required' };
        }

        const choiceList = asStringArray(options.options);
        if (choiceList === undefined || choiceList.length === 0) {
            return { ok: false, error: 'hitl.select: options is required and must be non-empty' };
        }

        const varName = asString(options.var) ?? '__hitlAnswer';

        context.events?.emit('workflow.hitl.ask', {
            runId: context.runId,
            node: context.stateOrNodeId,
            kind: 'select',
            message: prompt,
            severity: 'info',
        });
        const answer = await this.responder.respond({
            kind: 'select',
            prompt,
            options: choiceList,
            runId: context.runId,
            node: context.stateOrNodeId,
        });
        context.events?.emit('workflow.hitl.response', {
            runId: context.runId,
            node: context.stateOrNodeId,
            ok: !answer.cancelled,
            severity: 'info',
        });

        if (answer.cancelled) {
            return { ok: false, error: 'hitl.select cancelled' };
        }

        return {
            ok: true,
            data: { answer: answer.value },
            setVars: { [varName]: answer.value },
        };
    }
}

function asString(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    return String(value);
}

function asStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    return value.map((v) => String(v));
}
