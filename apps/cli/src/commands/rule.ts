import { loadPresetRules, loadRuleFile, RuleEngine } from '@gobing-ai/ts-rule-engine';
import { booleanFlag, stringFlag } from '../args';
import type { CliContext } from '../context';
import { toJson } from '../output';

/** Severity threshold accepted by --fail-on. */
export type FailOnSeverity = 'error' | 'warning' | 'info';

const SEVERITY_RANK: Record<FailOnSeverity, number> = {
    info: 0,
    warning: 1,
    error: 2,
};

/** Execute `spur rule` commands backed by @gobing-ai/ts-rule-engine. */
export async function runRuleCommand(
    subcommand: string | undefined,
    context: CliContext,
    flags: Record<string, string | boolean>,
    positionals: string[],
): Promise<number> {
    if (subcommand !== undefined && subcommand !== 'run') {
        context.output.error(`Unknown rule command: ${subcommand}`);
        return 1;
    }

    const preset = stringFlag(flags, 'preset', 'recommended');
    const failOn = parseFailOn(stringFlag(flags, 'fail-on', 'error'));
    const rules =
        typeof flags.file === 'string'
            ? await loadRuleFile(flags.file)
            : await loadPresetRules(preset, { workdir: context.cwd });
    const selectedRule = typeof flags.rule === 'string' ? flags.rule : positionals[0];
    const filteredRules = selectedRule === undefined ? rules : rules.filter((rule) => rule.id === selectedRule);
    const result = await new RuleEngine().evaluate(filteredRules, context.cwd);

    if (booleanFlag(flags, 'json')) {
        context.output.write(toJson({ preset, ruleCount: filteredRules.length, ...result }));
    } else {
        context.output.write(new RuleEngine().host.formatters.get('text').format(result));
    }

    return result.findings.some((finding) => SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[failOn]) ? 1 : 0;
}

function parseFailOn(value: string): FailOnSeverity {
    if (value === 'error' || value === 'warning' || value === 'info') return value;
    throw new Error(`Invalid --fail-on value "${value}". Expected error, warning, or info.`);
}
