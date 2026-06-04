import {
    type FailOnSeverity,
    type RuleListFileEntry,
    type RuleListServiceResult,
    RuleService,
} from '@gobing-ai/spur-app';
import { booleanFlag, stringFlag } from '../args';
import { makeColorize, shouldColor } from '../colors';
import type { CliContext } from '../context';

/** Render detailed usage for `spur rule`. */
export function helpText(): string {
    return [
        'spur rule - manage constraint rules and presets',
        '',
        'Usage: spur rule <command> [options]',
        '',
        'Commands:',
        '  run [--preset <name>] [--file <path>] [--rule <id>] [--fail-on <severity>] [--verbose] [--json]',
        '      Evaluate constraint rules over the working tree.',
        '  validate [--file <path>|--preset <name>|<path>] [--json]',
        '      Validate a rule file or preset without evaluating it.',
        '  list [--preset <name>] [--json]',
        '      List discovered rule files, or list resolved rules for a preset.',
        '  help',
        '      Show this help.',
        '',
        'Options:',
        '  --preset <name>        Preset to load (default: recommended)',
        '  --file <path>          Ad-hoc rule file for run or validate',
        '  --rule <id>            Filter run to one rule ID',
        '  --fail-on <severity>   Exit 1 threshold: error|warning|info (default: error)',
        '  --verbose              Stream per-rule progress to stderr',
        '  --json                 Output machine-readable JSON where supported',
        '  -h, --help             Show this help',
        '',
        'Examples:',
        '  spur rule run --preset recommended',
        '  spur rule run --preset spur-dev --verbose',
        '  spur rule validate --preset recommended',
        '  spur rule validate .spur/rules/boundary/imports.yaml --json',
        '  spur rule list --preset recommended',
        '',
        'Exit codes:',
        '  0 = success/pass',
        '  1 = validation errors, findings at or above --fail-on, or no rules evaluated',
        '  2 = system error',
    ].join('\n');
}

/** Execute `spur rule` commands backed by @gobing-ai/ts-rule-engine. */
export async function runRuleCommand(
    subcommand: string | undefined,
    context: CliContext,
    flags: Record<string, string | boolean>,
    positionals: string[],
): Promise<number> {
    const service = new RuleService(context);
    switch (subcommand ?? 'run') {
        case 'run': {
            const preset = stringFlag(flags, 'preset', 'recommended');
            const failOn = parseFailOn(stringFlag(flags, 'fail-on', 'error'));
            const file = typeof flags.file === 'string' ? flags.file : undefined;
            const rule = typeof flags.rule === 'string' ? flags.rule : positionals[0];
            const json = booleanFlag(flags, 'json');
            const verbose = booleanFlag(flags, 'verbose') && !json;
            const color = makeColorize(shouldColor(context.env, process.stderr));
            const result = await service.evaluate({ preset, failOn, file, rule, json, verbose, color });
            return result.exitCode;
        }
        case 'validate': {
            const source = resolveSource(flags, positionals);
            const json = booleanFlag(flags, 'json');
            const validateSchema = booleanFlag(flags, 'no-schema') ? false : undefined;
            const result = await service.validate({ source, json, validateSchema });
            return result.exitCode;
        }
        case 'list': {
            const preset = typeof flags.preset === 'string' ? flags.preset : undefined;
            const result = await service.list(preset);
            context.output.write(
                booleanFlag(flags, 'json')
                    ? JSON.stringify(result, null, 2)
                    : preset === undefined
                      ? formatRuleFileList(result)
                      : formatPresetRuleList(result),
            );
            return 0;
        }
        default:
            context.output.error(`Unknown rule command: ${subcommand}`);
            return 1;
    }
}

function formatRuleFileList(result: RuleListServiceResult): string {
    if (result.totalFiles === 0) return 'No rules found.';

    const lines = [
        `Sources: ${result.layers.map((layer) => `${layer.id} (${layer.path})`).join(', ')} (${result.mode} mode)`,
        `Total files: ${result.totalFiles}`,
        '',
    ];

    for (const category of result.categories) {
        lines.push(`  ${category.name}/`);
        for (const file of category.files) {
            lines.push(`    ${formatRuleFileEntry(file)}`);
        }
    }
    for (const file of result.uncategorized) {
        lines.push(`  ${formatRuleFileEntry(file)}`);
    }
    return lines.join('\n');
}

function formatRuleFileEntry(entry: RuleListFileEntry): string {
    const source = sourceLabel(entry.source);
    if (!entry.valid) return `❌ ${entry.path} (invalid: ${entry.error ?? 'unknown error'}) [${source}]`;
    const label = entry.ruleCount === 1 ? 'rule' : 'rules';
    return `✓ ${entry.path} (${entry.ruleCount} ${label}) [${source}]`;
}

function sourceLabel(id: string): string {
    if (id === 'env-override') return 'env override';
    if (id === 'local') return 'project layer';
    if (id === 'global') return 'user layer';
    if (id === 'bundled') return 'bundled layer';
    return id;
}

function formatPresetRuleList(result: RuleListServiceResult): string {
    if (result.rules.length === 0) return 'No rules found.';
    return result.rules
        .map(
            (entry) =>
                `${entry.id}\tseverity=${entry.severity}\tstatus=${
                    entry.enabled ? 'enabled' : 'disabled'
                }\tsource=${entry.file}`,
        )
        .join('\n');
}

function resolveSource(
    flags: Record<string, string | boolean>,
    positionals: readonly string[],
): { kind: 'file' | 'preset'; value: string } {
    if (typeof flags.file === 'string') return { kind: 'file', value: flags.file };
    if (typeof flags.preset === 'string') return { kind: 'preset', value: flags.preset };
    const positional = positionals[0];
    if (positional !== undefined) return { kind: 'file', value: positional };
    return { kind: 'preset', value: 'recommended' };
}

function parseFailOn(value: string): FailOnSeverity {
    if (value === 'error' || value === 'warning' || value === 'info') return value;
    throw new Error(`Invalid --fail-on value "${value}". Expected error, warning, or info.`);
}
