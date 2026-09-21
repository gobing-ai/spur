import type { ActionResult, ActionRunContext, ActionRunner, HitlResponder } from '@gobing-ai/ts-dual-workflow-engine';
import { type DecisionEvaluator, parseDecisionConfig, resolveDecision } from '../decision-hitl-responder';

const KIND = 'hitl.select';

/**
 * Human-in-the-loop select action (choose from a list).
 *
 * Options:
 * - `prompt` (string, required): the question to present.
 * - `options` (string[], required, non-empty): the choices.
 * - `var` (string, optional): var name for the answer; defaults to `__hitlAnswer`.
 * - `decision` (object, optional): explicit never/evidence policy (0911); evidence mode requires
 *   at least two distinct non-empty choices and forbids the reserved `defer` label.
 */
export class HitlSelectActionRunner implements ActionRunner {
    readonly kind = KIND;

    constructor(
        private readonly responder: HitlResponder,
        private readonly evaluator?: DecisionEvaluator,
    ) {}

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
        const parsed = parseDecisionConfig(options, varName, 'select');
        if (!parsed.ok) {
            return { ok: false, error: `hitl.select: ${parsed.error}` };
        }
        if (parsed.config.mode === 'evidence') {
            const invalid = validateEvidenceChoices(choiceList);
            if (invalid !== null) {
                return { ok: false, error: `hitl.select: ${invalid}` };
            }
        }

        context.events?.emit('workflow.hitl.ask', {
            runId: context.runId,
            node: context.stateOrNodeId,
            kind: 'select',
            message: prompt,
            severity: 'info',
        });
        const resolved = await resolveDecision(
            this.responder,
            this.evaluator,
            { kind: 'select', prompt, options: choiceList, runId: context.runId, node: context.stateOrNodeId },
            parsed.config,
        );
        const { answer } = resolved;
        context.events?.emit('workflow.hitl.response', {
            runId: context.runId,
            node: context.stateOrNodeId,
            ok: !answer.cancelled,
            severity: 'info',
        });

        if (answer.cancelled) {
            return { ok: false, error: 'hitl.select cancelled' };
        }

        const setVars: Record<string, string> = { [varName]: answer.value };
        if (resolved.statusVar !== undefined && resolved.statusValue !== undefined) {
            setVars[resolved.statusVar] = resolved.statusValue;
        }

        return {
            ok: true,
            data: {
                answer: answer.value,
                ...(resolved.provenance !== undefined ? { decision: resolved.provenance } : {}),
            },
            setVars,
        };
    }
}

/** Evidence-mode choice invariants (D2): at least two, distinct, non-empty, no reserved defer. */
export function validateEvidenceChoices(choices: string[]): string | null {
    if (choices.length < 2) return 'evidence mode requires at least two options';
    if (new Set(choices).size !== choices.length) return 'options must be distinct';
    if (choices.some((choice) => choice === '')) return 'options must be non-empty strings';
    if (choices.some((choice) => choice === 'defer')) return 'options cannot use the reserved "defer" label';
    return null;
}

function asString(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    return String(value);
}

function asStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    return value.map((v) => String(v));
}
