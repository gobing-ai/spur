import { homedir } from 'node:os';
import { delimiter, join, relative, resolve } from 'node:path';
import { bundledConfigRoot } from '@gobing-ai/spur-config/loader';
import {
    createId,
    type DbAdapter,
    RuleEvalRunDao,
    type RuleEvalRunRow,
    RuleRunDao,
    type RuleRunRow,
} from '@gobing-ai/spur-domain';
import { EventBus } from '@gobing-ai/ts-infra';
import {
    bundledRulesRoot,
    type ConstraintFinding,
    type ConstraintRule,
    DbRulePersistenceAdapter,
    type Fix,
    type FixApplicationResult,
    type FixMode,
    loadPresetRules,
    loadRuleFile,
    RuleEngine,
    type RuleEngineEvents,
    type RuleEngineResult,
    type RulePersistenceAdapter,
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
    /** Optional lazy DB adapter for persistence and trace queries. */
    getDb?: () => Promise<DbAdapter>;
    /**
     * Optional canonical server EventBus. When provided, every rule-engine
     * emit (`rule.run.start`, `rule.eval.start`, etc.) is also forwarded onto
     * this bus so the server's `system_events` tap/SSE stream can observe it.
     * The bus shape matches the canonical server `Record<string, listener>`
     * map, identical to the `SystemEventBus` in `system-event-tap.ts`.
     */
    events?: EventBus<Record<string, (event: unknown) => void>>;
}

/** Options for RuleService.evaluate(). */
export interface RuleEvaluateOptions {
    preset: string;
    failOn: FailOnSeverity;
    stopOnFirst?: FailOnSeverity;
    file?: string;
    rule?: string;
    json: boolean;
    verbose: boolean;
    color: Colorize;
    /** Fix collection/apply mode: 'none' (default) | 'suggest' | 'auto'. */
    fixMode?: FixMode;
    /** Preview fixes without writing (only meaningful with fixMode='auto'). */
    dryRun?: boolean;
}

/** Structured result returned by RuleService.evaluate(). */
export interface RuleEvaluationServiceResult {
    preset: string;
    ruleCount: number;
    findings: ConstraintFinding[];
    fixes: Fix[];
    /** Present when fixMode='auto' and fixes were applied (not a dry-run). */
    applied?: FixApplicationResult;
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

/** One rule source layer in a file inventory listing. */
export interface RuleSourceLayerEntry {
    id: string;
    path: string;
    priority: number;
}

/** One rule file in a file inventory listing. */
export interface RuleListFileEntry {
    path: string;
    source: string;
    valid: boolean;
    ruleCount: number;
    ruleIds: string[];
    error?: string;
}

/** Rule files grouped under one category directory. */
export interface RuleListCategoryEntry {
    name: string;
    files: RuleListFileEntry[];
}

/** Structured result returned by RuleService.list(). */
export interface RuleListServiceResult {
    preset: string | undefined;
    ruleCount: number;
    rules: RuleListEntry[];
    mode: 'layered' | 'flat' | 'empty' | 'preset';
    layers: RuleSourceLayerEntry[];
    totalFiles: number;
    categories: RuleListCategoryEntry[];
    uncategorized: RuleListFileEntry[];
    presets: RuleListPresetEntry[];
}
/** One available preset with its resolved rules. */
export interface RuleListPresetEntry {
    name: string;
    ruleCount: number;
    rules: RuleListEntry[];
}

interface RuleSourceLayer {
    id: string;
    path: string;
    priority: number;
}

/**
 * Application-layer service encapsulating all rule evaluation, validation, and
 * listing logic. Thin CLI wrappers in apps/cli/src/commands/rule.ts delegate
 * flag parsing and output formatting to this class.
 */
export class RuleService {
    private readonly context: RuleServiceContext;

    /**
     * Wrap a server EventBus so it can be passed as `events` to a `RuleEngine`.
     * Upstream `RuleEngineEvents` only emit on a fixed set of keys, so we just
     * forward every emit through the server bus's loose `Record<...>` shape.
     */
    private bridgeEvents(serverBus: EventBus<Record<string, (event: unknown) => void>>): EventBus<RuleEngineEvents> {
        const bridge = {
            on: (event: string, listener: (event: unknown) => void) => serverBus.on(event, listener),
            off: (event: string, listener: (event: unknown) => void) => serverBus.off(event, listener),
            emit: (event: string, detail: unknown) => Promise.resolve(serverBus.emit(event, detail)),
        };
        return bridge as unknown as EventBus<RuleEngineEvents>;
    }

    constructor(context: RuleServiceContext) {
        this.context = context;
    }

    /**
     * Evaluate rules and write formatted output to context.output.
     * Returns a structured result including the exit code the CLI should use.
     */
    async evaluate(opts: RuleEvaluateOptions): Promise<RuleEvaluationServiceResult> {
        const {
            preset,
            failOn,
            stopOnFirst,
            file,
            rule,
            json,
            verbose,
            color,
            fixMode = 'none',
            dryRun = false,
        } = opts;

        const rules =
            file !== undefined
                ? (await loadRuleFile(file)).rules
                : await loadPresetRules(preset, { roots: await this.ruleRoots() });
        const selectedRule = rule;
        const filteredRules = selectedRule === undefined ? rules : rules.filter((r) => r.id === selectedRule);

        let enabledCount = filteredRules.filter((r) => r.enabled !== false).length;

        // Persist run history when a DB is available. Spur stamps the run id
        // (R1.4) so the run can be re-queried via `spur rule trace <run-id>`.
        const db = await this.context.getDb?.();
        const persistence = db ? new DbRulePersistenceAdapter(db) : undefined;
        const runId = createId('rule');
        const runMeta: Record<string, unknown> = {
            preset: file === undefined ? preset : undefined,
            sourceKind: file !== undefined ? 'file' : 'preset',
            sourceValue: file ?? preset,
            failOn,
            stopOnFirst,
            dryRun,
            metadataJson: JSON.stringify(
                selectedRule === undefined ? { cwd: this.context.cwd } : { cwd: this.context.cwd, rule: selectedRule },
            ),
        };
        const engineOptions = {
            persistence,
            runId,
            runMeta,
            fileSystem: this.context.fs,
            ...(this.context.events !== undefined ? { events: this.bridgeEvents(this.context.events) } : {}),
        };
        const engine = new RuleEngine(engineOptions);
        let result: RuleEngineResult;
        if (verbose && !json) {
            const [engineResult, enabled] = await this.evaluateVerbose(
                engineOptions,
                filteredRules,
                color,
                stopOnFirst,
                fixMode,
            );
            result = engineResult;
            enabledCount = enabled;
        } else if (fixMode !== 'none') {
            result = await engine.evaluateWithFixes(filteredRules, this.context.cwd, fixMode, stopOnFirst);
        } else {
            result = await engine.evaluate(filteredRules, this.context.cwd, stopOnFirst);
        }

        // Apply fixes when fixMode='auto' and fixes were collected.
        let applied: FixApplicationResult | undefined;
        if (fixMode === 'auto' && result.fixes.length > 0) {
            applied = await new RuleEngine({ fileSystem: this.context.fs }).applyFixes(
                this.context.cwd,
                result.fixes,
                dryRun,
            );
            // The engine finalizes the run row before fixes are applied
            // (applied_fix_count=0, by contract); stamp the real applied count
            // once application completes. Dry runs record no applied writes.
            if (persistence && db && !dryRun) {
                const row = await new RuleRunDao(db).byId(runId);
                if (row) {
                    await persistence.updateRunStatus(
                        runId,
                        row.status === 'failed' ? 'failed' : 'done',
                        row.finding_count,
                        row.fix_count,
                        applied.applied.length,
                        row.duration_ms ?? 0,
                    );
                }
            }
        }

        const serviceResult: RuleEvaluationServiceResult = {
            preset,
            ruleCount: enabledCount,
            findings: result.findings,
            fixes: result.fixes,
            applied,
            exitCode: 0,
        };

        if (json) {
            const payload: Record<string, unknown> = { preset, ruleCount: enabledCount, ...result };
            if (applied) payload.applied = applied;
            this.context.output.write(JSON.stringify(payload, null, 2));
        } else if (verbose) {
            // Verbose already streamed per-rule findings inline; print only a summary line.
            this.context.output.write(this.verboseSummary(result.findings, enabledCount));
            if (fixMode !== 'none' && result.fixes.length > 0) {
                this.writeFixSummary(result.fixes, applied, dryRun, color);
            }
        } else if (result.findings.length > 0) {
            this.context.output.write(engine.host.formatters.get('text').format(result));
            if (fixMode !== 'none' && result.fixes.length > 0) {
                this.writeFixSummary(result.fixes, applied, dryRun, color);
            }
        } else {
            this.context.output.write(this.emptyResultMessage(file, preset, selectedRule, enabledCount));
        }

        if (enabledCount === 0) {
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
                      roots: await this.ruleRoots(),
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
        if (preset === undefined) {
            const files = await this.listDiscoveredRuleFiles();
            const presets = await this.listAvailablePresets();
            return { ...files, presets };
        }
        const entries = await this.listPresetRules(preset);
        return {
            preset,
            ruleCount: entries.length,
            rules: entries,
            mode: 'preset',
            layers: await this.ruleSourceLayers({ includeBundled: true }),
            totalFiles: 0,
            categories: [],
            uncategorized: [],
            presets: [],
        };
    }

    // ── Trace ──────────────────────────────────────────────────────────

    /** List recent rule runs with optional filters. */
    async traceList(filter: {
        preset?: string;
        status?: string;
        since?: string;
        limit: number;
    }): Promise<{ runs: RuleRunRow[] }> {
        const db = await this.context.getDb?.();
        if (!db) return { runs: [] };
        const dao = new RuleRunDao(db);
        const runs = await dao.list(filter);
        return { runs };
    }

    /** Show per-run detail including eval rows. */
    async traceDetail(runId: string): Promise<{ run: RuleRunRow; evaluations: RuleEvalRunRow[] }> {
        const db = await this.context.getDb?.();
        if (!db) throw new Error('Run not found');
        const runDao = new RuleRunDao(db);
        const evalDao = new RuleEvalRunDao(db);
        const run = await runDao.byId(runId);
        if (!run) throw new Error('Run not found');
        const evaluations = await evalDao.byRunId(runId);
        return { run, evaluations };
    }

    // ── Private helpers ────────────────────────────────────────────────

    private async ruleRoots(): Promise<string[]> {
        const layers = await this.ruleSourceLayers({ includeBundled: true });
        return layers.map((layer) => layer.path);
    }

    private async ruleSourceLayers(opts: { includeBundled: boolean }): Promise<RuleSourceLayer[]> {
        const { cwd, env } = this.context;
        const layers: RuleSourceLayer[] = [];
        const envValue = env.SPUR_RULES_PATH;
        if (envValue !== undefined && envValue.length > 0) {
            for (const entry of envValue.split(delimiter)) {
                if (entry.length > 0) {
                    layers.push({ id: 'env-override', path: resolve(cwd, entry), priority: -10 });
                }
            }
        }
        layers.push({ id: 'local', path: resolve(cwd, LOCAL_RULES_DIR), priority: 0 });
        const globalOverride = env.SPUR_GLOBAL_RULES_DIR;
        const hasGlobalOverride = globalOverride !== undefined && globalOverride.length > 0;
        layers.push({
            id: 'global',
            path: hasGlobalOverride ? resolve(cwd, globalOverride) : join(homedir(), GLOBAL_RULES_DIR),
            priority: 10,
        });
        if (opts.includeBundled && !hasGlobalOverride) {
            // Spur's own bundled config presets (recommended-pre-check, etc.) at priority 15,
            // between global and the ts-rule-engine demo categories at priority 20.
            const bundledConfig = bundledConfigRoot();
            if (bundledConfig !== null) {
                layers.push({ id: 'bundled-config', path: join(bundledConfig, 'rules'), priority: 15 });
            }
            // Generic demo rules from ts-rule-engine (categories: typescript, quality, structure).
            const bundled = await bundledRulesRoot();
            if (bundled !== null) layers.push({ id: 'bundled', path: bundled, priority: 20 });
        }
        return layers;
    }

    /**
     * Evaluate all rules in a single engine call, streaming per-rule progress via
     * the engine's EventBus. Progress goes to stderr (`output.error`) to keep
     * stdout clean for the final result. Returns the same aggregate shape as a batch run.
     */
    private async evaluateVerbose(
        engineOptions: { persistence?: RulePersistenceAdapter; runId: string; runMeta: Record<string, unknown> },
        rules: readonly ConstraintRule[],
        color: Colorize,
        stopOnFirst?: FailOnSeverity,
        fixMode: FixMode = 'none',
    ): Promise<[RuleEngineResult, number]> {
        const enabledRules = rules.filter((r) => r.enabled !== false);
        const disabledRules = rules.filter((r) => r.enabled === false);
        const enabledCount = enabledRules.length;
        const totalCount = rules.length;

        const localBus = new EventBus<RuleEngineEvents>();
        // When the rule service is constructed with a canonical server EventBus,
        // forward every rule-engine emit onto it so the system_events tap (R3) and
        // SSE stream can observe the same lifecycle events the engine produces.
        if (this.context.events !== undefined) {
            const serverBus = this.context.events;
            for (const eventName of [
                'rule.run.start',
                'rule.eval.start',
                'rule.eval.done',
                'rule.eval.error',
                'rule.run.done',
            ] as const) {
                localBus.on(eventName, (detail: unknown) => {
                    void serverBus.emit(eventName, detail);
                });
            }
        }
        const engine = new RuleEngine({ ...engineOptions, events: localBus, fileSystem: this.context.fs });

        // Header: show total rule count (enabled + disabled).
        const noun = totalCount === 1 ? 'rule' : 'rules';
        const suffix = disabledRules.length > 0 ? color.dim(` (${disabledRules.length} disabled)`) : '';
        this.context.output.error(`Evaluating ${totalCount} ${noun}…${suffix}`);

        // Emit progress lines for disabled rules up front, numbered before enabled rules.
        for (const [index, rule] of disabledRules.entries()) {
            const counter = color.dim(`[${index + 1}/${totalCount}]`);
            const type = color.dim(`(${rule.evaluator.type})`);
            this.context.output.error(`${color.dim('▶')} ${counter} ${rule.id} ${type}`);
            this.context.output.error(`  ${color.dim('⊘ disabled')} — skipped`);
        }

        localBus.on('rule.eval.start', ({ ruleId, index, total }) => {
            // Shift index past the disabled rules so counter is continuous across all rules.
            const shifted = index + disabledRules.length;
            const counter = color.dim(`[${shifted}/${total + disabledRules.length}]`);
            const rule = rules.find((r) => r.id === ruleId);
            const type = color.dim(rule ? `(${rule.evaluator.type})` : '');
            this.context.output.error(`${color.dim('▶')} ${counter} ${ruleId} ${type}`);
        });

        localBus.on('rule.eval.done', ({ findings, durationMs, details }) => {
            const elapsed = (durationMs / 1000).toFixed(2);
            if (findings === 0) {
                this.context.output.error(`  ${color.green('✓ passed')} - ${elapsed}s`);
            } else {
                // `details` carries the actual finding objects, so outcome + detail
                // lines render inline under the rule's progress line — not deferred
                // to a batch after all rules finish.
                this.context.output.error(`  ${this.verboseOutcome(details, color)} - ${elapsed}s`);
                for (const line of this.verboseFindingLines(details, color)) {
                    this.context.output.error(line);
                }
            }
        });

        localBus.on('rule.eval.error', ({ ruleId, error }) => {
            // R6: surface evaluator crash distinctly from normal violation findings.
            this.context.output.error(`  ${color.yellow(`! evaluator error in ${ruleId}: ${error}`)}`);
        });
        const result =
            fixMode !== 'none'
                ? await engine.evaluateWithFixes([...rules], this.context.cwd, fixMode, stopOnFirst)
                : await engine.evaluate([...rules], this.context.cwd, stopOnFirst);

        // When stopOnFirst short-circuits, emit the stop message.
        if (
            stopOnFirst !== undefined &&
            result.findings.some((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[stopOnFirst])
        ) {
            this.context.output.error(color.dim(`Stopping: first ${stopOnFirst}+ finding reached.`));
        }

        return [result, enabledCount];
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

    /** Write a human-readable summary of collected/applied fixes to stdout. */
    private writeFixSummary(
        fixes: readonly Fix[],
        applied: FixApplicationResult | undefined,
        dryRun: boolean,
        color: Colorize,
    ): void {
        if (!applied) {
            // suggest mode — candidates only.
            const noun = fixes.length === 1 ? 'fix' : 'fixes';
            this.context.output.write(color.cyan(`${fixes.length} ${noun} suggested (not applied).`));
            return;
        }
        if (dryRun) {
            this.context.output.write(color.cyan('Dry-run fix preview:'));
            if (applied.diff) this.context.output.write(applied.diff);
        } else {
            const files = applied.changedFiles.length === 1 ? 'file' : 'files';
            this.context.output.write(
                color.green(`${applied.applied.length} fixes applied across ${applied.changedFiles.length} ${files}.`),
            );
            if (applied.deferred.length > 0) {
                const noun = applied.deferred.length === 1 ? 'fix' : 'fixes';
                this.context.output.write(color.yellow(`${applied.deferred.length} ${noun} deferred (overlapping).`));
            }
        }
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
            return [`Preset "${source.value}" not found in any rules root (${(await this.ruleRoots()).join(', ')})`];
        }
        try {
            await loadPresetRules(source.value, { roots: await this.ruleRoots(), validateSchema });
            return null;
        } catch (error) {
            return [this.errorText(error)];
        }
    }

    /** True when a `<name>.{yaml,yml,json}` preset file exists in any configured root. */
    private async presetFileExists(name: string): Promise<boolean> {
        const { fs } = this.context;
        for (const root of await this.ruleRoots()) {
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
        const rules = await loadPresetRules(preset, { roots: await this.ruleRoots() });
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
    /**
     * Discover all root-level preset files across rule roots, resolve their rules,
     * and return a sorted list. Skipped presets (load failure) are silently omitted.
     */
    private async listAvailablePresets(): Promise<RuleListPresetEntry[]> {
        const presetNames = await this.discoverRootPresetNames();
        const entries: RuleListPresetEntry[] = [];
        for (const name of presetNames) {
            try {
                const rules = await this.listPresetRules(name);
                entries.push({ name, ruleCount: rules.length, rules });
            } catch {
                // preset failed to load — skip
            }
        }
        return entries;
    }

    /** Collect unique preset names from root-level YAML/JSON files across all rule roots. */
    private async discoverRootPresetNames(): Promise<string[]> {
        const candidates = new Set<string>();
        for (const layer of await this.existingRuleSourceLayers()) {
            const entries = await this.context.fs.readDir(layer.path);
            const named = entries
                .map((entry) => ({ entry, name: entry.match(/^([\w-]+)\.(?:ya?ml|json)$/i)?.[1] ?? '' }))
                .filter(({ name }) => name.length > 0);
            const stats = await Promise.all(named.map(({ entry }) => this.context.fs.stat(join(layer.path, entry))));
            named.forEach(({ name }, i) => {
                if (stats[i]?.isFile()) candidates.add(name);
            });
        }
        const names: string[] = [];
        const roots = await this.ruleRoots();
        for (const name of candidates) {
            try {
                await loadPresetRules(name, { roots });
                names.push(name);
            } catch {
                // not a valid preset — skip
            }
        }
        return names.sort();
    }

    private async listDiscoveredRuleFiles(): Promise<RuleListServiceResult> {
        const layers = await this.existingRuleSourceLayers();
        const merged = new Map<string, { absolutePath: string; source: string }>();
        for (const layer of layers) {
            for (const file of await this.listRuleFilesInLayer(layer.path)) {
                if (!merged.has(file)) merged.set(file, { absolutePath: join(layer.path, file), source: layer.id });
            }
        }

        const files: RuleListFileEntry[] = [];
        for (const [file, entry] of [...merged.entries()].sort(([left], [right]) => left.localeCompare(right))) {
            try {
                const { rules } = await loadRuleFile(entry.absolutePath);
                files.push({
                    path: file,
                    source: entry.source,
                    valid: true,
                    ruleCount: rules.length,
                    ruleIds: rules.map((rule) => rule.id).sort(),
                });
            } catch (error) {
                files.push({
                    path: file,
                    source: entry.source,
                    valid: false,
                    ruleCount: 0,
                    ruleIds: [],
                    error: this.errorText(error),
                });
            }
        }

        const categoryNames = [...new Set(files.flatMap((file) => this.categoryName(file.path) ?? []))].sort();
        const categories = categoryNames.map((name) => ({
            name,
            files: files.filter((file) => file.path.startsWith(`${name}/`)),
        }));
        const uncategorized = files.filter((file) => this.categoryName(file.path) === null);

        return {
            preset: undefined,
            ruleCount: files.reduce((count, file) => count + file.ruleCount, 0),
            rules: [],
            mode: files.length === 0 ? 'empty' : categoryNames.length > 0 ? 'layered' : 'flat',
            layers: layers.map((layer, index) => ({ id: layer.id, path: layer.path, priority: index })),
            totalFiles: files.length,
            categories,
            uncategorized,
            presets: [],
        };
    }

    private async existingRuleSourceLayers(): Promise<RuleSourceLayer[]> {
        const layers: RuleSourceLayer[] = [];
        for (const layer of (await this.ruleSourceLayers({ includeBundled: false })).sort(
            (a, b) => a.priority - b.priority,
        )) {
            if (await this.context.fs.exists(layer.path)) layers.push(layer);
        }
        return layers;
    }

    private async listRuleFilesInLayer(root: string): Promise<string[]> {
        const categoryDirs = await this.listCategoryDirs(root);
        if (categoryDirs.length > 0) {
            const files: string[] = [];
            for (const category of categoryDirs) {
                files.push(...(await this.listRuleFiles(root, category)));
            }
            return files.sort();
        }
        return (await this.listRuleFiles(root, '')).sort();
    }

    private async listCategoryDirs(root: string): Promise<string[]> {
        const entries = await this.context.fs.readDir(root);
        const dirs: string[] = [];
        for (const entry of entries.sort()) {
            if (entry === 'presets') continue;
            const stat = await this.context.fs.stat(join(root, entry));
            if (stat?.isDirectory()) dirs.push(entry);
        }
        return dirs;
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
            } else if (stat?.isFile() && /\.(ya?ml|json)$/i.test(entry)) {
                files.push(relativePath);
            }
        }
        return files;
    }

    private categoryName(path: string): string | null {
        const normalized = relative('.', path);
        const separatorIndex = normalized.indexOf('/');
        return separatorIndex > 0 ? normalized.slice(0, separatorIndex) : null;
    }
}

function compareRuleEntries(left: RuleListEntry, right: RuleListEntry): number {
    return left.file.localeCompare(right.file) || left.id.localeCompare(right.id);
}
