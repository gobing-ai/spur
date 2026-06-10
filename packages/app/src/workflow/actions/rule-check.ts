import type { ActionResult, ActionRunContext, ActionRunner } from '@gobing-ai/ts-dual-workflow-engine';
import type { RuleService } from '../../services/rule-service';
import { NO_COLOR } from '../utils';

const KIND = 'rule.check';

/**
 * Workflow action that delegates to RuleService.evaluate.
 *
 * Options:
 * - `preset` (string): rule preset name; defaults to "recommended-pre-check".
 * - `rule` (string): single rule id to run instead of a preset.
 * - `failOn` ("error" | "warning" | "info"): minimum severity that fails; defaults to "error".
 * - `cwd` (string): working directory; defaults to context.workdir.
 */
export class RuleCheckActionRunner implements ActionRunner {
    readonly kind = KIND;

    private readonly ruleService: RuleService;

    constructor(ruleService: RuleService) {
        this.ruleService = ruleService;
    }

    async execute(options: Record<string, unknown>, _context: ActionRunContext): Promise<ActionResult> {
        const preset = asString(options.preset) ?? 'recommended-pre-check';
        const rule = asString(options.rule);
        const failOn = (asString(options.failOn) ?? 'error') as 'error' | 'warning' | 'info';

        const result = await this.ruleService.evaluate({
            preset,
            failOn,
            ...(rule !== undefined ? { rule } : {}),
            json: true,
            verbose: false,
            color: NO_COLOR,
            fixMode: 'none',
        });

        const ok = result.exitCode === 0;
        return {
            ok,
            data: {
                findings: result.findings,
                preset: result.preset,
                ruleCount: result.ruleCount,
            },
            error: ok ? undefined : `rule.check failed: ${result.findings.length} finding(s) at/above ${failOn}`,
        };
    }
}

function asString(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    return String(value);
}
