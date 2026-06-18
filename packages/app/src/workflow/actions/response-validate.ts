import type { ActionResult, ActionRunContext, ActionRunner } from '@gobing-ai/ts-dual-workflow-engine';

const KIND = 'response.validate';

/** Result returned by a {@link ResponseValidateEngine} validation. */
export interface ResponseValidateResult {
    ok: boolean;
    reason: string;
    issues?: string[];
}

/**
 * Engine that validates response text against an anti-hallucination protocol.
 * Implemented by superskill 0041's guard engine; Spur injects the concrete
 * implementation via {@link ResponseValidateActionRunner}'s constructor.
 */
export interface ResponseValidateEngine {
    validate(text: string): ResponseValidateResult;
}

/**
 * Workflow action that validates response text against the anti-hallucination
 * guard engine. Mirrors the `rule.check` pattern: constructor DI, service call,
 * map to `ActionResult`.
 *
 * Options:
 * - `text` (string, required): the response text to validate. Typically
 *   templated from a prior step's data, e.g. `{{ steps.generate.answer }}`.
 *
 * The engine is injected via {@link ResponseValidateEngine}. The concrete
 * implementation is owned by superskill (task 0041); Spur wires it in
 * `builtins.ts` via `SpurWorkflowBuiltinsOptions.responseValidateEngine`.
 */
export class ResponseValidateActionRunner implements ActionRunner {
    readonly kind = KIND;

    private readonly engine: ResponseValidateEngine;

    constructor(engine: ResponseValidateEngine) {
        this.engine = engine;
    }

    async execute(options: Record<string, unknown>, _context: ActionRunContext): Promise<ActionResult> {
        const text = asString(options.text);
        if (text === undefined) {
            return {
                ok: false,
                error: 'response.validate: text is required (use a template like {{ steps.generate.answer }})',
            };
        }

        const result = this.engine.validate(text);
        return {
            ok: result.ok,
            data: {
                reason: result.reason,
                ...(result.issues !== undefined ? { issues: result.issues } : {}),
            },
            error: result.ok ? undefined : result.reason,
        };
    }
}

function asString(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    return String(value);
}
