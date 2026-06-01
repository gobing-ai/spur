import { join } from 'node:path';
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
    switch (subcommand ?? 'run') {
        case 'run':
            return runRuleEvaluation(context, flags, positionals);
        case 'validate':
            return runRuleValidate(context, flags, positionals);
        case 'list':
            return runRuleList(context, flags);
        default:
            context.output.error(`Unknown rule command: ${subcommand}`);
            return 1;
    }
}

async function runRuleEvaluation(
    context: CliContext,
    flags: Record<string, string | boolean>,
    positionals: string[],
): Promise<number> {
    const preset = stringFlag(flags, 'preset', 'recommended');
    const failOn = parseFailOn(stringFlag(flags, 'fail-on', 'error'));
    const rules =
        typeof flags.file === 'string'
            ? await loadRuleFile(flags.file)
            : await loadPresetRules(preset, { workdir: context.cwd });
    const selectedRule = typeof flags.rule === 'string' ? flags.rule : positionals[0];
    const filteredRules = selectedRule === undefined ? rules : rules.filter((rule) => rule.id === selectedRule);
    const engine = new RuleEngine();
    const result = await engine.evaluate(filteredRules, context.cwd);

    if (booleanFlag(flags, 'json')) {
        context.output.write(toJson({ preset, ruleCount: filteredRules.length, ...result }));
    } else {
        context.output.write(engine.host.formatters.get('text').format(result));
    }

    return result.findings.some((finding) => SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[failOn]) ? 1 : 0;
}

async function runRuleValidate(
    context: CliContext,
    flags: Record<string, string | boolean>,
    positionals: readonly string[],
): Promise<number> {
    const source = ruleSource(flags, positionals);
    const rules =
        source.kind === 'file'
            ? await loadRuleFile(source.value)
            : await loadPresetRules(source.value, { workdir: context.cwd });
    const result = {
        valid: true,
        kind: source.kind,
        source: source.value,
        ruleCount: rules.length,
        rules: rules.map((rule) => rule.id).sort(),
    };

    context.output.write(
        booleanFlag(flags, 'json')
            ? toJson(result)
            : `valid ${result.kind}: ${result.source}\nrules: ${result.ruleCount}${
                  result.rules.length > 0 ? `\n${result.rules.join('\n')}` : ''
              }`,
    );
    return 0;
}

async function runRuleList(context: CliContext, flags: Record<string, string | boolean>): Promise<number> {
    const preset = typeof flags.preset === 'string' ? flags.preset : undefined;
    const entries = preset === undefined ? await listLocalRules(context) : await listPresetRules(context, preset);
    const result = {
        preset,
        ruleCount: entries.length,
        rules: entries,
    };

    context.output.write(
        booleanFlag(flags, 'json')
            ? toJson(result)
            : entries.length === 0
              ? 'No rules found.'
              : entries
                    .map(
                        (entry) =>
                            `${entry.id}\t${entry.severity}\t${entry.enabled ? 'enabled' : 'disabled'}\t${entry.file}`,
                    )
                    .join('\n'),
    );
    return 0;
}

function ruleSource(
    flags: Record<string, string | boolean>,
    positionals: readonly string[],
): { kind: 'file' | 'preset'; value: string } {
    if (typeof flags.file === 'string') return { kind: 'file', value: flags.file };
    if (typeof flags.preset === 'string') return { kind: 'preset', value: flags.preset };
    const positional = positionals[0];
    if (positional !== undefined) return { kind: 'file', value: positional };
    return { kind: 'preset', value: 'recommended' };
}

async function listPresetRules(context: CliContext, preset: string): Promise<RuleListEntry[]> {
    const rules = await loadPresetRules(preset, { workdir: context.cwd });
    return rules
        .map((rule) => ({
            id: rule.id,
            description: rule.description,
            severity: rule.severity,
            enabled: rule.enabled,
            evaluator: rule.evaluator.type,
            file: `preset:${preset}`,
        }))
        .sort(compareRuleEntries);
}

async function listLocalRules(context: CliContext): Promise<RuleListEntry[]> {
    const root = join(context.cwd, '.spur', 'rules');
    if (!(await context.fs.exists(root))) return [];
    const files = await listRuleFiles(context, root, '');
    const entries: RuleListEntry[] = [];
    for (const file of files) {
        const rules = await loadRuleFile(join(root, file));
        for (const rule of rules) {
            entries.push({
                id: rule.id,
                description: rule.description,
                severity: rule.severity,
                enabled: rule.enabled,
                evaluator: rule.evaluator.type,
                file,
            });
        }
    }
    return entries.sort(compareRuleEntries);
}

async function listRuleFiles(context: CliContext, root: string, relativeDir: string): Promise<string[]> {
    const dir = join(root, relativeDir);
    const entries = await context.fs.readDir(dir);
    const files: string[] = [];
    for (const entry of entries.sort()) {
        const relativePath = relativeDir.length === 0 ? entry : join(relativeDir, entry);
        const absolutePath = join(root, relativePath);
        const stat = await context.fs.stat(absolutePath);
        if (stat?.isDirectory()) {
            files.push(...(await listRuleFiles(context, root, relativePath)));
        } else if (stat?.isFile() && relativeDir.length > 0 && /\.(ya?ml|json)$/i.test(entry)) {
            files.push(relativePath);
        }
    }
    return files;
}

interface RuleListEntry {
    id: string;
    description: string;
    severity: FailOnSeverity;
    enabled: boolean;
    evaluator: string;
    file: string;
}

function compareRuleEntries(left: RuleListEntry, right: RuleListEntry): number {
    return left.file.localeCompare(right.file) || left.id.localeCompare(right.id);
}

function parseFailOn(value: string): FailOnSeverity {
    if (value === 'error' || value === 'warning' || value === 'info') return value;
    throw new Error(`Invalid --fail-on value "${value}". Expected error, warning, or info.`);
}
