import type { Command } from '@commander-js/extra-typings';
import {
    type DailyResult,
    type FanOutResult,
    HistoryService,
    resolveArtifactPath,
    runHistoryReport,
    type SystemEventBus,
} from '@gobing-ai/spur-app';
import { formatSummary, stalenessBanner } from '@gobing-ai/spur-domain';
import { EventBus } from '@gobing-ai/ts-infra';
import { CLI_CONFIG } from '../config';
import type { CliContext } from '../context';
import { toJson } from '../output';
import { attachSystemEventLedger } from '../system-event-ledger';

/** Register `spur history` commands. */
export function registerHistoryCommand(program: Command, context: CliContext): void {
    const noun = program.command('history').summary('import and analyze coding-agent history');
    noun.command('import')
        .description(
            'Import agent conversation JSONL. `--source all` fans out across all sources with ' +
                'per-source failure isolation (task 0470). A single source is the n=1 case of ' +
                'the same contract — never two import paths.',
        )
        .option('--source <source>', 'pi|claude|codex|gemini|opencode|antigravity|openclaw|omp|grok|agy|all', 'all')
        .option('--file <path>', 'Import one JSONL file (single-source only)')
        .option('--root <path>', 'Scan a history root')
        .option('--mode <mode>', 'full|incremental|force-file')
        .option('--dry-run', 'Scan without persisting imported records')
        .option('--source-timeout <ms>', 'Per-source timeout in milliseconds (default 600000 = 10 min)', '600000')
        .option('--json', 'Output machine-readable JSON where supported')
        .action(async (options) => {
            const svc = new HistoryService({ getDb: () => context.getDb() });
            const source = options.source ?? 'all';

            // --file is single-source only — reject the contradictory combo up front.
            if (options.file && source === 'all') {
                context.output.write(
                    options.json
                        ? toJson({ status: 'error', message: '--file requires a single --source, not "all".' })
                        : 'spur history import: --file requires a single --source, not "all".',
                );
                context.setExitCode(1);
                return;
            }

            const sourceTimeout = Number.parseInt(options.sourceTimeout ?? '600000', 10) || 600_000;
            // Validate mode up-front — an invalid mode is a CLI usage error, not a per-source runtime failure.
            const mode = options.mode ?? (options.file ? 'force-file' : 'incremental');
            if (mode !== 'full' && mode !== 'incremental' && mode !== 'force-file') {
                const modeMsg = `Invalid history import mode "${mode}". Expected one of: full, incremental, force-file`;
                if (options.json) {
                    context.output.write(toJson({ status: 'error', message: modeMsg }));
                } else {
                    context.output.error(modeMsg);
                }
                context.setExitCode(1);
                return;
            }

            const fanOut = await svc.importAll({
                sources: source === 'all' ? undefined : [source],
                file: options.file || undefined,
                root: options.root || undefined,
                mode: mode,
                dryRun: options.dryRun === true,
                sourceTimeout,
            });

            context.output.write(options.json ? toJson(fanOut) : formatFanOutResult(fanOut));
            context.setExitCode(fanOut.exitCode);
        });
    noun.command('analyze')
        .description(
            'Aggregate imported history with SQL and write a versioned JSON artifact (Q1-Q10 forensic query set).',
        )
        .option('--since <iso>', 'Inclusive lower bound on message timestamp')
        .option('--until <iso>', 'Inclusive upper bound on message timestamp')
        .option('--source <source>', 'pi|claude|codex|gemini|opencode|antigravity|openclaw|omp|grok|agy|all', 'all')
        .option('--session <id>', 'Narrow to a single session id')
        .option('--run <runId>', 'Narrow to a single workflow run id')
        .option('--task <wbs>', 'Narrow to a single task WBS')
        .option('--top <n>', 'Leaderboard depth for byTool/bySession', '20')
        .option('--out <path>', 'Write the artifact to this path instead of the dated reports dir')
        .option('--json', 'Emit the artifact as JSON instead of the human summary')
        .action(async (options) => {
            const svc = new HistoryService({ getDb: () => context.getDb() });
            const source = options.source ?? 'all';
            const selector = {
                since: options.since || null,
                until: options.until || null,
                sources: source === 'all' ? null : [source],
                sessionId: options.session || null,
                runId: options.run || null,
                taskWbs: options.task || null,
            };
            const artifact = await svc.analyze(selector, {
                top: Number.parseInt(options.top ?? '20', 10) || 20,
                spurVersion: CLI_CONFIG.binaryVersion,
                out: options.out || undefined,
                cwd: context.cwd,
            });
            context.output.write(
                options.json
                    ? toJson(artifact)
                    : formatSummary({
                          totals: artifact.totals,
                          bySource: artifact.bySource,
                          byModel: artifact.byModel,
                          daily: artifact.daily,
                      }),
            );
        });
    noun.command('report')
        .description(
            'Render a previously-generated history artifact as a spend + forensic report. ' +
                'Never opens the database — pure renderer of the analyze JSON.',
        )
        .argument('[path]', 'Artifact JSON path (defaults to the latest.json pointer)')
        .option('--json', 'Emit the parsed artifact as JSON instead of the human report')
        .action(async (pathArg, options) => {
            try {
                const { report, artifactPath, resolution, artifact } = runHistoryReport({
                    path: pathArg,
                    cwd: context.cwd,
                    now: new Date(),
                });

                if (options.json) {
                    context.output.write(toJson(artifact));
                    context.setExitCode(0);
                    return;
                }

                // Staleness banner only when resolved via pointer, never on explicit path (R7).
                if (resolution === 'pointer') {
                    const banner = stalenessBanner(artifact.generatedAt, new Date());
                    if (banner !== null) context.output.write(banner);
                }

                context.output.write(report);
                context.output.write(`\n(artifact: ${artifactPath})\n`);
                context.setExitCode(0);
            } catch (e) {
                const message = `spur history report failed: ${(e as Error).message}`;
                context.output.write(options.json ? toJson({ status: 'error', message }) : message);
                context.setExitCode(1);
            }
        });
    noun.command('daily')
        .description(
            'Run-once daily pipeline: import-all (fan-out, per-source isolation) → analyze → write ' +
                'artifact → prune reports older than 90 days (task 0470 R6). Import uses checkpoint ' +
                'resume, so a missed night self-heals on the next run with no gap and no double-count.',
        )
        .option('--since <iso>', 'Inclusive lower bound on message timestamp for the report (not the import)')
        .option('--until <iso>', 'Inclusive upper bound on message timestamp for the report')
        .option(
            '--source-timeout <ms>',
            'Per-source import timeout in milliseconds (default 600000 = 10 min)',
            '600000',
        )
        .option('--root <path>', 'History root override (default: per-source platform dir)')
        .option('--json', 'Emit the daily result as JSON')
        .action(async (options) => {
            const svc = new HistoryService({ getDb: () => context.getDb() });
            const sourceTimeout = Number.parseInt(options.sourceTimeout ?? '600000', 10) || 600_000;

            // System-event bus + ledger (task 0471 R2): per-invocation, flushed in finally.
            const bus = new EventBus() as unknown as SystemEventBus;
            const ledger = await attachSystemEventLedger(bus, context);

            const startMs = Date.now();
            let result: DailyResult | null = null;
            let failure: { exitCode: number; detail: string } | null = null;
            try {
                result = await svc.daily({
                    since: options.since || undefined,
                    until: options.until || undefined,
                    sourceTimeout,
                    spurVersion: CLI_CONFIG.binaryVersion,
                    cwd: context.cwd,
                    root: options.root || undefined,
                });
            } catch (e) {
                failure = { exitCode: 1, detail: e instanceof Error ? e.message : String(e) };
            }
            const durationMs = Date.now() - startMs;

            try {
                if (failure !== null) {
                    // Exception path: emit failed, force exit 1.
                    await bus.emit('history.daily.failed', {
                        source: 'history',
                        renderer: 'history-daily',
                        detail: failure.detail,
                        exitCode: failure.exitCode,
                        durationMs,
                    });
                    context.setExitCode(1);
                } else if (result !== null) {
                    const exitCode = result.fanOut.exitCode;
                    // Resolve the artifact path written inside `daily()` via the latest pointer.
                    // `daily()` does not surface the path in its contract (task 0470 domain).
                    let artifactPath: string | undefined;
                    try {
                        artifactPath = resolveArtifactPath(undefined, context.cwd).path;
                    } catch {
                        // No pointer / unreadable — emit without it rather than dropping the event.
                        artifactPath = undefined;
                    }
                    const entries = result.fanOut.entries;
                    const sources = entries.length;
                    const okSources = entries.filter((e) => e.status === 'ok').length;
                    const failedSources = entries.filter((e) => e.status === 'failed').length;
                    const files = entries.reduce((sum, e) => sum + e.files, 0);
                    const messages = entries.reduce((sum, e) => sum + e.messages, 0);
                    if (exitCode === 0) {
                        await bus.emit('history.import.completed', {
                            source: 'history',
                            renderer: 'history-import',
                            sources,
                            okSources,
                            failedSources,
                            files,
                            messages,
                            durationMs,
                            artifactPath,
                        });
                        await bus.emit('history.analyze.completed', {
                            source: 'history',
                            renderer: 'history-analyze',
                            artifactPath,
                            totals: result.artifact.totals,
                        });
                    } else {
                        const failing = entries.filter((e) => e.status === 'failed');
                        await bus.emit('history.daily.failed', {
                            source: 'history',
                            renderer: 'history-daily',
                            exitCode,
                            sources,
                            okSources,
                            failedSources,
                            detail:
                                failing.length > 0
                                    ? failing
                                          .map((e) => `${e.source}: ${e.parseErrors + e.validationErrors} errors`)
                                          .join('; ')
                                    : 'daily fan-out reported non-zero exit with no failing source',
                            durationMs,
                            artifactPath,
                        });
                    }
                    context.setExitCode(exitCode);
                }
            } finally {
                ledger.unsubscribe();
                await ledger.flush();
            }

            if (failure !== null) {
                context.output.write(
                    options.json ? toJson({ error: failure.detail }) : `history daily failed: ${failure.detail}`,
                );
                return;
            }
            if (result === null) {
                // Defensive: unreachable (failure path handles the null case), but keeps TS happy.
                context.setExitCode(1);
                return;
            }
            context.output.write(options.json ? toJson(result) : formatDailyResult(result));
        });
}

function formatFanOutResult(r: FanOutResult): string {
    const lines: string[] = ['history import (fan-out)', 'sources:'];
    for (const e of r.entries) {
        lines.push(`  ${e.source}: ${e.status} (files=${e.files} messages=${e.messages})`);
    }
    if (r.warnings.length > 0) {
        lines.push('warnings:');
        for (const w of r.warnings) {
            lines.push(`  [${w.code}] ${w.source ?? '-'}: ${w.detail}`);
        }
    }
    lines.push(`exit_code: ${r.exitCode}`);
    return lines.join('\n');
}

function formatDailyResult(r: DailyResult): string {
    const lines: string[] = ['history daily'];
    lines.push('import:');
    for (const e of r.fanOut.entries) {
        lines.push(`  ${e.source}: ${e.status} (files=${e.files} messages=${e.messages})`);
    }
    if (r.fanOut.warnings.length > 0) {
        lines.push('warnings:');
        for (const w of r.fanOut.warnings) {
            lines.push(`  [${w.code}] ${w.source ?? '-'}: ${w.detail}`);
        }
    }
    lines.push(`artifact totals: messages=${r.artifact.totals.messages} toolCalls=${r.artifact.totals.toolCalls}`);
    lines.push(`pruned: ${r.pruned.length} report dir(s) older than 90 days`);
    lines.push(`exit_code: ${r.fanOut.exitCode}`);
    return lines.join('\n');
}
