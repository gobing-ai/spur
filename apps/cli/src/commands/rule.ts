import type { Command } from '@commander-js/extra-typings';
import {
    type FailOnSeverity,
    type RuleEvalRunRow,
    type RuleListFileEntry,
    type RuleListServiceResult,
    type RuleRunRow,
    RuleService,
    type RuleTraceDetail,
    type RuleTraceRun,
} from '@gobing-ai/spur-app';
import { makeColorize, shouldColor } from '../colors';
import type { CliContext } from '../context';
import { toEnvelopeJson, writeJsonError } from '../output';
import { SHARED_OPTIONS } from './shared-options';

/** Register the `spur rule` command and its subcommands on the CLI program. */
export function registerRuleCommand(program: Command, context: CliContext): void {
    const rule = program.command('rule').summary('manage constraint rules and presets');

    rule.command('run')
        .summary('Evaluate constraint rules over the working tree.')
        .option('--preset <name>', 'Preset to load (default: recommended-pre-check)', 'recommended-pre-check')
        .option(...SHARED_OPTIONS.fileRuleAdhoc)
        .option('--rule <id>', 'Filter run to one rule ID')
        .option('--fail-on <severity>', 'Exit 1 threshold: error|warning|info (default: error)', 'error')
        .option('--stop-on-first [severity]', 'Stop evaluation after first rule with findings at/above severity')
        .option('--fix-mode <mode>', 'Fix collection/apply mode: none|suggest|auto (default: none)', 'none')
        .option(...SHARED_OPTIONS.dryRunRuleFix)
        .option(...SHARED_OPTIONS.verboseRule)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            const service = new RuleService(context);
            const preset = options.preset ?? 'recommended-pre-check';
            const failOn = parseFailOn(options.failOn ?? 'error');
            const rawStopOnFirst = options.stopOnFirst;
            const stopOnFirst =
                rawStopOnFirst === true
                    ? parseStopOnFirst('error')
                    : typeof rawStopOnFirst === 'string'
                      ? parseStopOnFirst(rawStopOnFirst)
                      : undefined;
            const fixMode = parseFixMode(options.fixMode ?? 'none');
            const dryRun = options.dryRun === true;
            const file = options.file;
            const rule = options.rule;
            const json = options.json === true;
            const verbose = options.verbose === true && !json;
            const color = makeColorize(shouldColor(context.env, process.stderr));
            const result = await service.evaluate({
                preset,
                failOn,
                stopOnFirst,
                fixMode,
                dryRun,
                file,
                rule,
                json,
                enveloped: options.jsonEnvelope,
                verbose,
                color,
            });
            context.setExitCode(result.exitCode);
        });

    rule.command('validate')
        .summary('Validate a rule file or preset without evaluating it.')
        .argument('[file-or-preset]', 'File path or preset name to validate')
        .option(...SHARED_OPTIONS.fileRuleAdhocPath)
        .option('--preset <name>', 'Preset name')
        .option('--kind <type>', 'Source kind: file or preset')
        .option(...SHARED_OPTIONS.noSchema)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
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
            const result = await service.validate({ source, json, enveloped: options.jsonEnvelope, validateSchema });
            context.setExitCode(result.exitCode);
        });

    rule.command('list')
        .summary('List discovered rule files, or list resolved rules for a preset.')
        .option('--preset <name>', 'Preset to list rules for')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            const service = new RuleService(context);
            const preset = options.preset;
            const result = await service.list(preset);
            context.output.write(
                options.json
                    ? toEnvelopeJson(result, { enveloped: options.jsonEnvelope })
                    : preset === undefined
                      ? formatRuleFileList(result)
                      : formatPresetRuleList(result),
            );
        });

    rule.command('trace')
        .summary('Show persisted rule run history.')
        .argument('[run-id]', 'Run ID for per-run detail')
        .option('--preset <name>', 'Filter by preset name')
        .option(...SHARED_OPTIONS.statusDoneFailed)
        .option(...SHARED_OPTIONS.since)
        .option(...SHARED_OPTIONS.last, '20')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (runId, options) => {
            const last = parseInt(options.last, 10);
            if (!Number.isInteger(last) || last < 1) {
                context.output.error('--last must be a positive integer');
                context.setExitCode(1);
                return;
            }
            if (options.status !== undefined && !['done', 'failed'].includes(options.status)) {
                context.output.error('--status must be one of: done, failed');
                context.setExitCode(1);
                return;
            }
            if (options.since !== undefined && Number.isNaN(Date.parse(options.since))) {
                context.output.error('--since must be a valid ISO date');
                context.setExitCode(1);
                return;
            }
            const svc = context.ruleService();
            try {
                if (runId) {
                    const detail = await svc.traceDetail(runId);
                    if (options.json) {
                        context.output.write(toEnvelopeJson(detail, { enveloped: options.jsonEnvelope }));
                    } else {
                        context.output.write(formatTraceDetail(detail));
                    }
                } else {
                    const { runs } = await svc.traceList({
                        preset: options.preset,
                        status: options.status,
                        since: options.since,
                        limit: last,
                    });
                    if (options.json) {
                        context.output.write(toEnvelopeJson({ runs }, { enveloped: options.jsonEnvelope }));
                    } else if (runs.length === 0) {
                        context.output.write('No rule runs found.');
                    } else {
                        context.output.write(formatTraceList(runs));
                    }
                }
            } catch (error) {
                writeJsonError(context.output, options, error instanceof Error ? error.message : String(error));
                context.setExitCode(1);
            }
        });
}

function formatRuleFileList(result: RuleListServiceResult): string {
    const lines: string[] = [];

    // ── Part 1: file inventory ──────────────────────────────────────
    if (result.totalFiles > 0) {
        lines.push(
            `Sources: ${result.layers.map((layer) => `${layer.id} (${layer.path})`).join(', ')} (${result.mode} mode)`,
            `Total files: ${result.totalFiles}`,
            '',
        );
        for (const category of result.categories) {
            lines.push(`  ${category.name}/`);
            for (const file of category.files) {
                lines.push(`    ${formatRuleFileEntry(file)}`);
            }
        }
        for (const file of result.uncategorized) {
            lines.push(`  ${formatRuleFileEntry(file)}`);
        }
    }

    // ── Part 2: available presets ───────────────────────────────────
    if (result.presets.length > 0) {
        lines.push('');
        for (const preset of result.presets) {
            const label = preset.ruleCount === 1 ? 'rule' : 'rules';
            lines.push(`${preset.name}  (${preset.ruleCount} ${label})`);
            for (const rule of preset.rules) {
                const status = rule.enabled ? '✓' : '⊘';
                lines.push(`  ${status} ${rule.id.padEnd(32)} severity=${rule.severity}`);
            }
            lines.push('');
        }
    }

    if (lines.length === 0) return 'No rules found.';
    return lines.join('\n').trimEnd();
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
    return { kind: 'preset', value: 'recommended-pre-check' };
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

/** Parse and validate --fix-mode value. */
function parseFixMode(value: string): 'none' | 'suggest' | 'auto' {
    if (value === 'none' || value === 'suggest' || value === 'auto') return value;
    throw new Error(`Invalid --fix-mode value "${value}". Expected none, suggest, or auto.`);
}
/**
 * Format a list of rule runs as a tab-separated table for plain-text output.
 * Columns: RUN ID, PRESET, STATUS, RULES, FINDINGS, FIXES, STARTED.
 */
export function formatTraceList(runs: Array<RuleRunRow | RuleTraceRun>): string {
    const header = [
        'RUN ID',
        'PROJECT',
        'SOURCE',
        'STATUS',
        'RULES',
        'FINDINGS',
        'FIXES/APPLIED',
        'STARTED',
        'COMPLETED',
        'DURATION',
        'OUTCOME',
        'NEXT',
    ];
    const rows = runs.map((r) => [
        r.id.slice(0, 12),
        'project' in r ? r.project.name : 'unavailable',
        'source' in r
            ? `${r.source.kind}:${r.source.value}`
            : `${r.source_kind}:${r.source_value ?? r.preset ?? 'unavailable'}`,
        r.status,
        String(r.rule_count),
        String(r.finding_count),
        `${r.fix_count}/${r.applied_fix_count}`,
        r.started_at || 'unavailable',
        r.completed_at ?? 'unavailable',
        r.duration_ms === null ? 'unavailable' : `${r.duration_ms}ms`,
        'outcome' in r ? r.outcome : 'unavailable',
        'nextAction' in r && r.nextAction !== undefined ? r.nextAction.value : '-',
    ]);
    return [header.join('\t'), ...rows.map((row) => row.join('\t'))].join('\n');
}

/**
 * Format a single rule run detail (run metadata + per-rule evaluation rows)
 * for plain-text output.
 */
export function formatTraceDetail(
    detail: RuleTraceDetail | { run: RuleRunRow; evaluations: RuleEvalRunRow[] },
): string {
    const r = detail.run;
    const lines: string[] = [];
    lines.push(`Run: ${r.id} — ${r.preset ?? '-'} — ${r.status}`);
    lines.push(
        `Project: ${'project' in r ? `${r.project.name} (${r.project.root})` : 'unavailable'}   Source: ${'source' in r ? `${r.source.kind}:${r.source.value}` : `${r.source_kind}:${r.source_value ?? r.preset ?? 'unavailable'}`}`,
    );
    lines.push(
        `Started: ${r.started_at || 'unavailable'}   Completed: ${r.completed_at ?? 'unavailable'}   Duration: ${r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(2)}s` : 'unavailable'}`,
    );
    lines.push(
        `Rules: ${r.rule_count}   Findings: ${r.finding_count}   Fixes: ${r.fix_count}   Applied: ${r.applied_fix_count}`,
    );
    const stopOn = r.stop_on_first ?? 'none';
    lines.push(
        `Fail-on: ${r.fail_on ?? 'unavailable'}   Stop-on-first: ${stopOn}   Fix-mode: ${r.fix_mode}   Dry-run: ${r.dry_run === 1 ? 'yes' : 'no'}   Outcome: ${'outcome' in r ? r.outcome : 'unavailable'}`,
    );
    if ('nextAction' in r && r.nextAction !== undefined) {
        lines.push(`Next: ${r.nextAction.label} — ${r.nextAction.value}`);
    }
    lines.push('');
    for (const ev of detail.evaluations) {
        const icon = ev.status === 'failed' ? '✗' : ev.status === 'done' && ev.finding_count > 0 ? '!' : '✓';
        const dur = ev.duration_ms != null ? `${ev.duration_ms}ms` : 'unavailable';
        lines.push(
            `  ${icon} ${ev.rule_id}  severity=${ev.severity} evaluator=${ev.evaluator} status=${ev.status} findings=${ev.finding_count} fixes=${ev.fix_count} duration=${dur}`,
        );
        lines.push(`    started=${ev.started_at || 'unavailable'} completed=${ev.completed_at ?? 'unavailable'}`);
        lines.push(`    error: ${ev.error ?? 'unavailable'}`);
    }
    return lines.join('\n');
}
