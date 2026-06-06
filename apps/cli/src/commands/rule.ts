import type { Command } from '@commander-js/extra-typings';
import {
    type FailOnSeverity,
    type RuleListFileEntry,
    type RuleListServiceResult,
    RuleService,
} from '@gobing-ai/spur-app';
import { makeColorize, shouldColor } from '../colors';
import type { CliContext } from '../context';

/** Register `spur rule` commands. */
export function registerRuleCommand(program: Command, context: CliContext): void {
    const rule = program.command('rule').summary('manage constraint rules and presets');

    rule.command('run')
        .summary('Evaluate constraint rules over the working tree.')
        .option('--preset <name>', 'Preset to load (default: recommended)', 'recommended')
        .option('--file <path>', 'Ad-hoc rule file')
        .option('--rule <id>', 'Filter run to one rule ID')
        .option('--fail-on <severity>', 'Exit 1 threshold: error|warning|info (default: error)', 'error')
        .option('--stop-on-first [severity]', 'Stop evaluation after first rule with findings at/above severity')
        .option('--verbose', 'Stream per-rule progress to stderr')
        .option('--json', 'Output machine-readable JSON')
        .action(async (options) => {
            const service = new RuleService(context);
            const preset = options.preset ?? 'recommended';
            const failOn = parseFailOn(options.failOn ?? 'error');
            const rawStopOnFirst = options.stopOnFirst;
            const stopOnFirst =
                rawStopOnFirst === true
                    ? parseStopOnFirst('error')
                    : typeof rawStopOnFirst === 'string'
                      ? parseStopOnFirst(rawStopOnFirst)
                      : undefined;
            const file = options.file;
            const rule = options.rule;
            const json = options.json === true;
            const verbose = options.verbose === true && !json;
            const color = makeColorize(shouldColor(context.env, process.stderr));
            const result = await service.evaluate({
                preset,
                failOn,
                stopOnFirst,
                file,
                rule,
                json,
                verbose,
                color,
            });
            context.setExitCode(result.exitCode);
        });

    rule.command('validate')
        .summary('Validate a rule file or preset without evaluating it.')
        .argument('[file-or-preset]', 'File path or preset name to validate')
        .option('--file <path>', 'Ad-hoc rule file path')
        .option('--preset <name>', 'Preset name')
        .option('--kind <type>', 'Source kind: file or preset')
        .option('--no-schema', 'Skip schema validation')
        .option('--json', 'Output machine-readable JSON')
        .action(async (fileOrPreset, options) => {
            const service = new RuleService(context);
            const source = resolveSource(
                { file: options.file, preset: options.preset },
                fileOrPreset ? [fileOrPreset] : [],
            );
            if (options.kind && (options.kind === 'file' || options.kind === 'preset')) {
                source.kind = options.kind;
            }
            const json = options.json === true;
            const validateSchema = options.schema === false ? false : undefined;
            const result = await service.validate({ source, json, validateSchema });
            context.setExitCode(result.exitCode);
        });

    rule.command('list')
        .summary('List discovered rule files, or list resolved rules for a preset.')
        .option('--preset <name>', 'Preset to list rules for')
        .option('--json', 'Output machine-readable JSON')
        .action(async (options) => {
            const service = new RuleService(context);
            const preset = options.preset;
            const result = await service.list(preset);
            context.output.write(
                options.json
                    ? JSON.stringify(result, null, 2)
                    : preset === undefined
                      ? formatRuleFileList(result)
                      : formatPresetRuleList(result),
            );
        });
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
    flags: Record<string, string | undefined>,
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

/** Severity threshold for --stop-on-first. Reuses the same set as --fail-on. */
function parseStopOnFirst(value: string): FailOnSeverity {
    if (value === 'error' || value === 'warning' || value === 'info') return value;
    throw new Error(`Invalid --stop-on-first value "${value}". Expected error, warning, or info.`);
}
