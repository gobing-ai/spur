import type { ActionResult, ActionRunContext, ActionRunner, HitlResponder } from '@gobing-ai/ts-dual-workflow-engine';

const KIND = 'hitl.input';

/**
 * Human-in-the-loop free-text input action.
 *
 * Options:
 * - `prompt` (string, required): the question to present.
 * - `var` (string, optional): var name for the answer; defaults to `__hitlInput`.
 */
export class HitlInputActionRunner implements ActionRunner {
    readonly kind = KIND;

    private readonly responder: HitlResponder;

    constructor(responder: HitlResponder) {
        this.responder = responder;
    }

    async execute(options: Record<string, unknown>, context: ActionRunContext): Promise<ActionResult> {
        const prompt = asString(options.prompt);
        if (prompt === undefined) {
            return { ok: false, error: 'hitl.input: prompt is required' };
        }

        const varName = asString(options.var) ?? '__hitlInput';

        const answer = await this.responder.respond({
            kind: 'input',
            prompt,
            runId: context.runId,
            node: context.stateOrNodeId,
        });

        if (answer.cancelled) {
            return { ok: false, error: 'hitl.input cancelled' };
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
