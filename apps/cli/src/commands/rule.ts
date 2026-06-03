import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import {
    bundledRulesRoot,
    type ConstraintFinding,
    type ConstraintRule,
    loadPresetRules,
    loadRuleFile,
    RuleEngine,
    type RuleEngineResult,
} from '@gobing-ai/ts-rule-engine';
import { booleanFlag, stringFlag } from '../args';
import { type Colorize, makeColorize, shouldColor } from '../colors';
import type { CliContext } from '../context';
import { toJson } from '../output';

/** Local project rules root, relative to the working directory. */
const LOCAL_RULES_DIR = join('.spur', 'rules');

/** Global user rules root, relative to the home directory. */
const GLOBAL_RULES_DIR = join('.config', 'spur', 'rules');

/**
 * Build the ordered rule-source roots for the active context, highest priority
 * first: `SPUR_RULES_PATH` entries, the local project root (`.spur/rules`), then
 * the global user root (`~/.config/spur/rules`). Local roots shadow global ones
 * per relative path, so a project overrides individual rule files while inheriting
 * the rest of a preset's categories from the global layer.
 *
 * `SPUR_GLOBAL_RULES_DIR` overrides the global root (resolved against the working
 * directory); set it to a known-empty path to isolate a run from user globals.
 * Setting it also suppresses the bundled fallback below, so the caller gets a
 * fully hermetic rule layer (the local root plus the explicit global override) —
 * which is what tests and reproducible CI runs need.
 *
 * Otherwise the presets bundled with `@gobing-ai/ts-rule-engine` are appended as
 * the lowest-priority root so `--preset recommended` resolves to a working ruleset
 * on a clean install, before `spur init` has seeded the user-global directory.
 * Local and global roots still shadow individual bundled files per relative path.
 */
function ruleRoots(context: CliContext): string[] {
    const roots: string[] = [];
    const envValue = context.env.SPUR_RULES_PATH;
    if (envValue !== undefined && envValue.length > 0) {
        for (const entry of envValue.split(delimiter)) {
            if (entry.length > 0) roots.push(resolve(context.cwd, entry));
        }
    }
    roots.push(resolve(context.cwd, LOCAL_RULES_DIR));
    const globalOverride = context.env.SPUR_GLOBAL_RULES_DIR;
    const hasGlobalOverride = globalOverride !== undefined && globalOverride.length > 0;
    roots.push(hasGlobalOverride ? resolve(context.cwd, globalOverride) : join(homedir(), GLOBAL_RULES_DIR));
    // An explicit global override means a hermetic run; skip the bundled fallback.
    if (!hasGlobalOverride) {
        const bundled = bundledRulesRoot();
        if (bundled !== null) roots.push(bundled);
    }
    return roots;
}

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
            ? (await loadRuleFile(flags.file)).rules
            : await loadPresetRules(preset, { roots: ruleRoots(context) });
    const selectedRule = typeof flags.rule === 'string' ? flags.rule : positionals[0];
    const filteredRules = selectedRule === undefined ? rules : rules.filter((rule) => rule.id === selectedRule);
    const engine = new RuleEngine();
    const verbose = booleanFlag(flags, 'verbose') && !booleanFlag(flags, 'json');
    const result = verbose
        ? await evaluateVerbose(engine, filteredRules, context, makeColorize(shouldColor(context.env, process.stderr)))
        : await engine.evaluate(filteredRules, context.cwd);

    if (booleanFlag(flags, 'json')) {
        context.output.write(toJson({ preset, ruleCount: filteredRules.length, ...result }));
    } else if (verbose) {
        // Verbose already streamed per-rule findings inline; print only a summary line.
        context.output.write(verboseSummary(result.findings, filteredRules.length));
    } else if (result.findings.length > 0) {
        context.output.write(engine.host.formatters.get('text').format(result));
    } else {
        context.output.write(emptyResultMessage(flags, preset, selectedRule, filteredRules.length));
    }

    // A run that evaluated zero rules is a misconfiguration, not a pass: a
    // constraint gate that silently checks nothing is the worst failure mode.
    // Fail loud so an unseeded install or a typo'd --preset/--rule/--file is
    // caught instead of green-lit. The emptyResultMessage above explains which.
    if (filteredRules.length === 0) return 1;
    return result.findings.some((finding) => SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[failOn]) ? 1 : 0;
}

/**
 * Evaluate rules one at a time, streaming per-rule progress so the user sees which
 * rule is running and its outcome. Progress goes to stderr (`output.error`) to keep
 * stdout clean for the final result. Returns the same aggregate shape as a batch run.
 */
async function evaluateVerbose(
    engine: RuleEngine,
    rules: readonly ConstraintRule[],
    context: CliContext,
    color: Colorize,
): Promise<RuleEngineResult> {
    const total = rules.length;
    context.output.error(`Evaluating ${total} ${total === 1 ? 'rule' : 'rules'}…`);
    const findings: ConstraintFinding[] = [];
    const fixes: RuleEngineResult['fixes'] = [];
    for (const [index, rule] of rules.entries()) {
        const counter = color.dim(`[${index + 1}/${total}]`);
        const type = color.dim(`(${rule.evaluator.type})`);
        context.output.error(`${color.dim('▶')} ${counter} ${rule.id} ${type}`);
        const result = await engine.evaluate([rule], context.cwd);
        findings.push(...result.findings);
        fixes.push(...result.fixes);
        context.output.error(`  ${verboseOutcome(result.findings, color)}`);
        for (const line of verboseFindingLines(result.findings, color)) {
            context.output.error(line);
        }
    }
    return { findings, fixes };
}

/**
 * Format a single rule's outcome line for verbose progress.
 *
 * An evaluator error (the rule could not run) is surfaced as "misconfigured",
 * not as a policy violation. Otherwise color tracks the worst severity present:
 * red for errors, yellow for warnings, cyan for info-only, green when it passed.
 */
function verboseOutcome(findings: readonly ConstraintFinding[], color: Colorize): string {
    if (findings.length === 0) return color.green('✓ passed');
    if (findings.some((finding) => finding.kind === 'error')) {
        return color.yellow('⚠ misconfigured');
    }
    const counts: Record<FailOnSeverity, number> = { error: 0, warning: 0, info: 0 };
    for (const finding of findings) counts[finding.severity] += 1;
    const parts = (['error', 'warning', 'info'] as const)
        .filter((severity) => counts[severity] > 0)
        .map((severity) => `${counts[severity]} ${severity}${counts[severity] === 1 ? '' : 's'}`);
    const tint = counts.error > 0 ? color.red : counts.warning > 0 ? color.yellow : color.cyan;
    return tint(`✗ ${parts.join(', ')}`);
}

/** Indented, colored detail lines for a rule's findings under its progress line. */
function verboseFindingLines(findings: readonly ConstraintFinding[], color: Colorize): string[] {
    return findings.map((finding) => {
        const location = findingLocation(finding);
        const tint = finding.kind === 'error' ? color.yellow : severityTint(finding.severity, color);
        if (finding.kind === 'error') {
            return `    ${tint(`! ${finding.message}`)}`;
        }
        return `    ${color.dim('-')} ${location} ${color.dim(finding.message)}`;
    });
}

/** Map a finding's path + line to a compact location label. */
function findingLocation(finding: ConstraintFinding): string {
    if (finding.filePath === null) return '<workspace>';
    return finding.line ? `${finding.filePath}:${finding.line}` : finding.filePath;
}

/** Pick the color helper for a severity. */
function severityTint(severity: FailOnSeverity, color: Colorize): (text: string) => string {
    if (severity === 'error') return color.red;
    if (severity === 'warning') return color.yellow;
    return color.cyan;
}

/**
 * One-line stdout summary for a verbose run.
 *
 * Counts policy violations by severity and reports misconfigured rules separately,
 * since the per-rule detail was already streamed to stderr.
 */
function verboseSummary(findings: readonly ConstraintFinding[], ruleCount: number): string {
    const violations = findings.filter((finding) => finding.kind !== 'error');
    const errored = findings.filter((finding) => finding.kind === 'error').length;
    const rulesNoun = ruleCount === 1 ? 'rule' : 'rules';
    if (violations.length === 0 && errored === 0) {
        return `All ${ruleCount} ${rulesNoun} passed — no violations found.`;
    }
    const counts: Record<FailOnSeverity, number> = { error: 0, warning: 0, info: 0 };
    for (const finding of violations) counts[finding.severity] += 1;
    const parts = (['error', 'warning', 'info'] as const)
        .filter((severity) => counts[severity] > 0)
        .map((severity) => `${counts[severity]} ${severity}${counts[severity] === 1 ? '' : 's'}`);
    if (errored > 0) parts.push(`${errored} misconfigured ${errored === 1 ? 'rule' : 'rules'}`);
    return `${parts.join(', ')} across ${ruleCount} ${rulesNoun}.`;
}

/**
 * Build the human message for a run that produced no findings.
 *
 * Distinguishes "nothing was evaluated" (no rules resolved — likely a missing or
 * mis-scoped preset/rule file) from "rules ran and the project passed", which the
 * engine's generic "No rule findings." cannot tell apart on its own.
 */
function emptyResultMessage(
    flags: Record<string, string | boolean>,
    preset: string,
    selectedRule: string | undefined,
    ruleCount: number,
): string {
    if (ruleCount > 0) {
        const noun = ruleCount === 1 ? 'rule' : 'rules';
        return `All ${ruleCount} ${noun} passed — no violations found.`;
    }
    if (typeof flags.file === 'string') {
        return `No rules evaluated — "${flags.file}" defined no rules.`;
    }
    if (selectedRule !== undefined) {
        return `No rules evaluated — rule "${selectedRule}" was not found in preset "${preset}".`;
    }
    return `No rules evaluated — preset "${preset}" resolved to no rule files (check .spur/rules or ~/.config/spur/rules).`;
}

async function runRuleValidate(
    context: CliContext,
    flags: Record<string, string | boolean>,
    positionals: readonly string[],
): Promise<number> {
    const source = ruleSource(flags, positionals);
    const json = booleanFlag(flags, 'json');
    const validateSchema = booleanFlag(flags, 'no-schema') ? false : undefined;

    const errors = await collectValidationErrors(context, source, validateSchema);
    if (errors !== null) {
        const result = { valid: false, kind: source.kind, source: source.value, errors };
        if (json) {
            context.output.write(toJson(result));
        } else {
            context.output.error(
                `invalid ${source.kind}: ${source.value}\n${errors.map((e) => `  - ${e}`).join('\n')}`,
            );
        }
        return 1;
    }

    const rules =
        source.kind === 'file'
            ? (await loadRuleFile(source.value, validateSchema === undefined ? undefined : { validateSchema })).rules
            : await loadPresetRules(source.value, { roots: ruleRoots(context), validateSchema });
    const result = {
        valid: true,
        kind: source.kind,
        source: source.value,
        ruleCount: rules.length,
        rules: rules.map((rule) => rule.id).sort(),
    };

    context.output.write(
        json
            ? toJson(result)
            : `valid ${result.kind}: ${result.source}\nrules: ${result.ruleCount}${
                  result.rules.length > 0 ? `\n${result.rules.join('\n')}` : ''
              }`,
    );
    return 0;
}

/**
 * Validate the source and return its error messages, or `null` when it is valid.
 *
 * Surfaces clean diagnostics for the failure modes a bare load would otherwise leak
 * as uncaught exceptions or silent false-positives: a missing file, a preset that
 * resolves to no preset file, or a structural/schema parse error.
 */
async function collectValidationErrors(
    context: CliContext,
    source: { kind: 'file' | 'preset'; value: string },
    validateSchema: boolean | undefined,
): Promise<string[] | null> {
    if (source.kind === 'file') {
        const absolute = resolve(context.cwd, source.value);
        if (!(await context.fs.exists(absolute))) return [`File not found: ${absolute}`];
        try {
            await loadRuleFile(absolute, validateSchema === undefined ? undefined : { validateSchema });
            return null;
        } catch (error) {
            return [errorText(error)];
        }
    }

    if (!(await presetFileExists(context, source.value))) {
        return [`Preset "${source.value}" not found in any rules root (${ruleRoots(context).join(', ')})`];
    }
    try {
        await loadPresetRules(source.value, { roots: ruleRoots(context), validateSchema });
        return null;
    } catch (error) {
        return [errorText(error)];
    }
}

/** True when a `<name>.{yaml,yml,json}` preset file exists in any configured root. */
async function presetFileExists(context: CliContext, name: string): Promise<boolean> {
    for (const root of ruleRoots(context)) {
        for (const ext of ['yaml', 'yml', 'json']) {
            if (await context.fs.exists(join(root, `${name}.${ext}`))) return true;
        }
    }
    return false;
}

/** Extract a readable message from a thrown value. */
function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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
    const rules = await loadPresetRules(preset, { roots: ruleRoots(context) });
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
        const { rules } = await loadRuleFile(join(root, file));
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
