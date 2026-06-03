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
import type { FileSystem } from '@gobing-ai/ts-runtime';

/** Local project rules root, relative to the working directory. */
const LOCAL_RULES_DIR = join('.spur', 'rules');

/** Global user rules root, relative to the home directory. */
const GLOBAL_RULES_DIR = join('.config', 'spur', 'rules');

/** Severity threshold accepted by --fail-on. */
export type FailOnSeverity = 'error' | 'warning' | 'info';

const SEVERITY_RANK: Record<FailOnSeverity, number> = {
    info: 0,
    warning: 1,
    error: 2,
};

/** Output sink consumed by RuleService for human and machine output. */
export interface RuleServiceOutput {
    write(message: string): void;
    error(message: string): void;
}

/** Colorize helpers passed from the caller for verbose runs. */
export interface Colorize {
    enabled: boolean;
    dim(text: string): string;
    red(text: string): string;
    green(text: string): string;
    yellow(text: string): string;
    cyan(text: string): string;
}

/** Construction context for RuleService — mirrors CliContext without DB. */
export interface RuleServiceContext {
    cwd: string;
    env: Record<string, string | undefined>;
    fs: FileSystem;
    output: RuleServiceOutput;
}

/** Options for RuleService.evaluate(). */
export interface RuleEvaluateOptions {
    preset: string;
    failOn: FailOnSeverity;
    file?: string;
    rule?: string;
    json: boolean;
    verbose: boolean;
    color: Colorize;
}

/** Structured result returned by RuleService.evaluate(). */
export interface RuleEvaluationServiceResult {
    preset: string;
    ruleCount: number;
    findings: ConstraintFinding[];
    fixes: RuleEngineResult['fixes'];
    exitCode: number;
}

/** Options for RuleService.validate(). */
export interface RuleValidateOptions {
    source: { kind: 'file' | 'preset'; value: string };
    validateSchema?: boolean;
    json: boolean;
}

/** Structured result returned by RuleService.validate(). */
export interface RuleValidateServiceResult {
    valid: boolean;
    kind: 'file' | 'preset';
    source: string;
    ruleCount?: number;
    rules?: string[];
    errors?: string[];
    exitCode: number;
}

/** One entry in the rule list. */
export interface RuleListEntry {
    id: string;
    description: string;
    severity: FailOnSeverity;
    enabled: boolean;
    evaluator: string;
    file: string;
}

/** Structured result returned by RuleService.list(). */
export interface RuleListServiceResult {
    preset: string | undefined;
    ruleCount: number;
    rules: RuleListEntry[];
}

/**
 * Application-layer service encapsulating all rule evaluation, validation, and
 * listing logic. Thin CLI wrappers in apps/cli/src/commands/rule.ts delegate
 * flag parsing and output formatting to this class.
 */
export class RuleService {
    private readonly context: RuleServiceContext;

    constructor(context: RuleServiceContext) {
        this.context = context;
    }

    /**
     * Evaluate rules and write formatted output to context.output.
     * Returns a structured result including the exit code the CLI should use.
     */
    async evaluate(opts: RuleEvaluateOptions): Promise<RuleEvaluationServiceResult> {
        const { preset, failOn, file, rule, json, verbose, color } = opts;

        const rules =
            file !== undefined
                ? (await loadRuleFile(file)).rules
                : await loadPresetRules(preset, { roots: this.ruleRoots() });

        const selectedRule = rule;
        const filteredRules = selectedRule === undefined ? rules : rules.filter((r) => r.id === selectedRule);

        const engine = new RuleEngine();
        const result =
            verbose && !json
                ? await this.evaluateVerbose(engine, filteredRules, color)
                : await engine.evaluate(filteredRules, this.context.cwd);

        const serviceResult: RuleEvaluationServiceResult = {
            preset,
            ruleCount: filteredRules.length,
            findings: result.findings,
            fixes: result.fixes,
            exitCode: 0,
        };

        if (json) {
            this.context.output.write(JSON.stringify({ preset, ruleCount: filteredRules.length, ...result }, null, 2));
        } else if (verbose) {
            // Verbose already streamed per-rule findings inline; print only a summary line.
            this.context.output.write(this.verboseSummary(result.findings, filteredRules.length));
        } else if (result.findings.length > 0) {
            this.context.output.write(engine.host.formatters.get('text').format(result));
        } else {
            this.context.output.write(this.emptyResultMessage(file, preset, selectedRule, filteredRules.length));
        }

        if (filteredRules.length === 0) {
            serviceResult.exitCode = 1;
        } else if (result.findings.some((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[failOn])) {
            serviceResult.exitCode = 1;
        }

        return serviceResult;
    }

    /**
     * Validate a rule source (file or preset) and write results to context.output.
     * Returns a structured result including the exit code the CLI should use.
     */
    async validate(opts: RuleValidateOptions): Promise<RuleValidateServiceResult> {
        const { source, validateSchema, json } = opts;

        const errors = await this.collectValidationErrors(source, validateSchema);
        if (errors !== null) {
            const jsonPayload = { valid: false, kind: source.kind, source: source.value, errors };
            if (json) {
                this.context.output.write(JSON.stringify(jsonPayload, null, 2));
            } else {
                this.context.output.error(
                    `invalid ${source.kind}: ${source.value}\n${errors.map((e) => `  - ${e}`).join('\n')}`,
                );
            }
            return { ...jsonPayload, exitCode: 1 };
        }

        const loadedRules =
            source.kind === 'file'
                ? (await loadRuleFile(source.value, validateSchema === undefined ? undefined : { validateSchema }))
                      .rules
                : await loadPresetRules(source.value, {
                      roots: this.ruleRoots(),
                      validateSchema,
                  });

        const ruleIds = loadedRules.map((r) => r.id).sort();
        const jsonPayload = {
            valid: true,
            kind: source.kind,
            source: source.value,
            ruleCount: loadedRules.length,
            rules: ruleIds,
        };

        this.context.output.write(
            json
                ? JSON.stringify(jsonPayload, null, 2)
                : `valid ${jsonPayload.kind}: ${jsonPayload.source}\nrules: ${jsonPayload.ruleCount}${
                      ruleIds.length > 0 ? `\n${ruleIds.join('\n')}` : ''
                  }`,
        );

        return { ...jsonPayload, exitCode: 0 };
    }

    /**
     * List rules discovered in the project or a specific preset.
     * Returns a structured result. Output writing is left to the caller.
     */
    async list(preset?: string): Promise<RuleListServiceResult> {
        const entries = preset === undefined ? await this.listLocalRules() : await this.listPresetRules(preset);

        return {
            preset,
            ruleCount: entries.length,
            rules: entries,
        };
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

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
    private ruleRoots(): string[] {
        const { cwd, env } = this.context;
        const roots: string[] = [];
        const envValue = env.SPUR_RULES_PATH;
        if (envValue !== undefined && envValue.length > 0) {
            for (const entry of envValue.split(delimiter)) {
                if (entry.length > 0) roots.push(resolve(cwd, entry));
            }
        }
        roots.push(resolve(cwd, LOCAL_RULES_DIR));
        const globalOverride = env.SPUR_GLOBAL_RULES_DIR;
        const hasGlobalOverride = globalOverride !== undefined && globalOverride.length > 0;
        roots.push(hasGlobalOverride ? resolve(cwd, globalOverride) : join(homedir(), GLOBAL_RULES_DIR));
        if (!hasGlobalOverride) {
            const bundled = bundledRulesRoot();
            if (bundled !== null) roots.push(bundled);
        }
        return roots;
    }

    /**
     * Evaluate rules one at a time, streaming per-rule progress so the user sees which
     * rule is running and its outcome. Progress goes to stderr (`output.error`) to keep
     * stdout clean for the final result. Returns the same aggregate shape as a batch run.
     */
    private async evaluateVerbose(
        engine: RuleEngine,
        rules: readonly ConstraintRule[],
        color: Colorize,
    ): Promise<RuleEngineResult> {
        const total = rules.length;
        this.context.output.error(`Evaluating ${total} ${total === 1 ? 'rule' : 'rules'}…`);
        const findings: ConstraintFinding[] = [];
        const fixes: RuleEngineResult['fixes'] = [];
        for (const [index, rule] of rules.entries()) {
            const counter = color.dim(`[${index + 1}/${total}]`);
            const type = color.dim(`(${rule.evaluator.type})`);
            this.context.output.error(`${color.dim('▶')} ${counter} ${rule.id} ${type}`);
            const result = await engine.evaluate([rule], this.context.cwd);
            findings.push(...result.findings);
            fixes.push(...result.fixes);
            this.context.output.error(`  ${this.verboseOutcome(result.findings, color)}`);
            for (const line of this.verboseFindingLines(result.findings, color)) {
                this.context.output.error(line);
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
    private verboseOutcome(findings: readonly ConstraintFinding[], color: Colorize): string {
        if (findings.length === 0) return color.green('✓ passed');
        if (findings.some((f) => f.kind === 'error')) {
            return color.yellow('⚠ misconfigured');
        }
        const counts: Record<FailOnSeverity, number> = { error: 0, warning: 0, info: 0 };
        for (const f of findings) counts[f.severity] += 1;
        const parts = (['error', 'warning', 'info'] as const)
            .filter((s) => counts[s] > 0)
            .map((s) => `${counts[s]} ${s}${counts[s] === 1 ? '' : 's'}`);
        const tint = counts.error > 0 ? color.red : counts.warning > 0 ? color.yellow : color.cyan;
        return tint(`✗ ${parts.join(', ')}`);
    }

    /** Indented, colored detail lines for a rule's findings under its progress line. */
    private verboseFindingLines(findings: readonly ConstraintFinding[], color: Colorize): string[] {
        return findings.map((f) => {
            const location = this.findingLocation(f);
            const tint = f.kind === 'error' ? color.yellow : this.severityTint(f.severity, color);
            if (f.kind === 'error') {
                return `    ${tint(`! ${f.message}`)}`;
            }
            return `    ${color.dim('-')} ${location} ${color.dim(f.message)}`;
        });
    }

    /** Map a finding's path + line to a compact location label. */
    private findingLocation(finding: ConstraintFinding): string {
        if (finding.filePath === null) return '<workspace>';
        return finding.line ? `${finding.filePath}:${finding.line}` : finding.filePath;
    }

    /** Pick the color helper for a severity. */
    private severityTint(severity: FailOnSeverity, color: Colorize): (text: string) => string {
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
    private verboseSummary(findings: readonly ConstraintFinding[], ruleCount: number): string {
        const violations = findings.filter((f) => f.kind !== 'error');
        const errored = findings.filter((f) => f.kind === 'error').length;
        const rulesNoun = ruleCount === 1 ? 'rule' : 'rules';
        if (violations.length === 0 && errored === 0) {
            return `All ${ruleCount} ${rulesNoun} passed — no violations found.`;
        }
        const counts: Record<FailOnSeverity, number> = { error: 0, warning: 0, info: 0 };
        for (const f of violations) counts[f.severity] += 1;
        const parts = (['error', 'warning', 'info'] as const)
            .filter((s) => counts[s] > 0)
            .map((s) => `${counts[s]} ${s}${counts[s] === 1 ? '' : 's'}`);
        if (errored > 0) parts.push(`${errored} misconfigured ${errored === 1 ? 'rule' : 'rules'}`);
        return `${parts.join(', ')} across ${ruleCount} ${rulesNoun}.`;
    }

    /**
     * Build the human message for a run that produced no findings.
     *
     * Distinguishes "nothing was evaluated" (no rules resolved — likely a missing or
     * mis-scoped preset/rule file) from "rules ran and the project passed".
     */
    private emptyResultMessage(
        file: string | undefined,
        preset: string,
        selectedRule: string | undefined,
        ruleCount: number,
    ): string {
        if (ruleCount > 0) {
            const noun = ruleCount === 1 ? 'rule' : 'rules';
            return `All ${ruleCount} ${noun} passed — no violations found.`;
        }
        if (file !== undefined) {
            return `No rules evaluated — "${file}" defined no rules.`;
        }
        if (selectedRule !== undefined) {
            return `No rules evaluated — rule "${selectedRule}" was not found in preset "${preset}".`;
        }
        return `No rules evaluated — preset "${preset}" resolved to no rule files (check .spur/rules or ~/.config/spur/rules).`;
    }

    /**
     * Validate the source and return its error messages, or `null` when it is valid.
     */
    private async collectValidationErrors(
        source: { kind: 'file' | 'preset'; value: string },
        validateSchema: boolean | undefined,
    ): Promise<string[] | null> {
        const { cwd, fs } = this.context;
        if (source.kind === 'file') {
            const absolute = resolve(cwd, source.value);
            if (!(await fs.exists(absolute))) return [`File not found: ${absolute}`];
            try {
                await loadRuleFile(absolute, validateSchema === undefined ? undefined : { validateSchema });
                return null;
            } catch (error) {
                return [this.errorText(error)];
            }
        }

        if (!(await this.presetFileExists(source.value))) {
            return [`Preset "${source.value}" not found in any rules root (${this.ruleRoots().join(', ')})`];
        }
        try {
            await loadPresetRules(source.value, { roots: this.ruleRoots(), validateSchema });
            return null;
        } catch (error) {
            return [this.errorText(error)];
        }
    }

    /** True when a `<name>.{yaml,yml,json}` preset file exists in any configured root. */
    private async presetFileExists(name: string): Promise<boolean> {
        const { fs } = this.context;
        for (const root of this.ruleRoots()) {
            for (const ext of ['yaml', 'yml', 'json']) {
                if (await fs.exists(join(root, `${name}.${ext}`))) return true;
            }
        }
        return false;
    }

    /** Extract a readable message from a thrown value. */
    private errorText(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }

    private async listPresetRules(preset: string): Promise<RuleListEntry[]> {
        const rules = await loadPresetRules(preset, { roots: this.ruleRoots() });
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

    private async listLocalRules(): Promise<RuleListEntry[]> {
        const { cwd, fs } = this.context;
        const root = join(cwd, '.spur', 'rules');
        if (!(await fs.exists(root))) return [];
        const files = await this.listRuleFiles(root, '');
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

    private async listRuleFiles(root: string, relativeDir: string): Promise<string[]> {
        const { fs } = this.context;
        const dir = join(root, relativeDir);
        const entries = await fs.readDir(dir);
        const files: string[] = [];
        for (const entry of entries.sort()) {
            const relativePath = relativeDir.length === 0 ? entry : join(relativeDir, entry);
            const absolutePath = join(root, relativePath);
            const stat = await fs.stat(absolutePath);
            if (stat?.isDirectory()) {
                files.push(...(await this.listRuleFiles(root, relativePath)));
            } else if (stat?.isFile() && relativeDir.length > 0 && /\.(ya?ml|json)$/i.test(entry)) {
                files.push(relativePath);
            }
        }
        return files;
    }
}

function compareRuleEntries(left: RuleListEntry, right: RuleListEntry): number {
    return left.file.localeCompare(right.file) || left.id.localeCompare(right.id);
}
