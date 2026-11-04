import type { Command } from '@commander-js/extra-typings';
import {
    type DailyResult,
    DEFAULT_SOURCE_TIMEOUT_MS,
    HISTORY_REFRESH_CONTEXT_ENV,
    type HistoryRefreshPayload,
    parseHistoryRefreshContext,
    resolveArtifactPath,
    type SystemEventBus,
    type TimeoutPolicyMs,
} from '@gobing-ai/spur-app';
import { getEnvVar, getEnvVars } from '@gobing-ai/spur-config';
import { EventBus } from '@gobing-ai/ts-infra';
import { CLI_CONFIG } from '../../config';
import type { CliContext } from '../../context';
import { toEnvelopeJson } from '../../output';
import { attachSystemEventLedger } from '../../system-event-ledger';
import { SHARED_OPTIONS } from '../shared-options';
import { makeHistoryService, resolveCliSourceTimeout } from './shared';

/** Register `spur history daily`. */
export function registerHistoryDailyCommand(noun: Command, context: CliContext): void {
    noun.command('daily')
        .description(
            'Run-once daily pipeline: import-all (fan-out, per-source isolation) → analyze → write ' +
                'artifact → prune reports older than 90 days (task 0470 R6). Import uses checkpoint ' +
                'resume, so a missed night self-heals on the next run with no gap and no double-count.',
        )
        .option('--since <iso>', 'Inclusive lower bound on message timestamp for the report (not the import)')
        .option('--until <iso>', 'Inclusive upper bound on message timestamp for the report')
        .option(
            '--source-timeout <ms|none>',
            `Per-source import timeout in milliseconds or 'none' (default ${DEFAULT_SOURCE_TIMEOUT_MS} = 10 min)`,
        )
        .option('--root <path>', 'History root override (default: per-source platform dir)')
        .option(...SHARED_OPTIONS.jsonDaily)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .option('--mode <name>', 'Render the artifact as a .md sidecar in this mode after analyze (e.g. forensics)')
        .action(async (options) => {
            // Task 0813 R3: strict explicit-input validation BEFORE service construction —
            // same contract as `history import` (only 'none' disables the deadline).
            let sourceTimeout: TimeoutPolicyMs;
            try {
                sourceTimeout = resolveCliSourceTimeout(options.sourceTimeout, getEnvVars());
            } catch (e) {
                const timeoutMsg = `spur history daily: ${e instanceof Error ? e.message : String(e)}`;
                context.output.write(
                    options.json
                        ? toEnvelopeJson(
                              { error: timeoutMsg },
                              {
                                  enveloped: options.jsonEnvelope,
                                  error: { code: 'INTERNAL_ERROR', message: timeoutMsg },
                              },
                          )
                        : timeoutMsg,
                );
                context.setExitCode(1);
                return;
            }
            const svc = await makeHistoryService(context);

            // Task 0717: queued child refresh context. Parsed BEFORE the bus/ledger so a
            // malformed context fails the child before any import or event emission;
            // absent env keeps interactive `history daily` unchanged.
            let refresh: HistoryRefreshPayload | null;
            try {
                refresh = parseHistoryRefreshContext(getEnvVar(HISTORY_REFRESH_CONTEXT_ENV));
            } catch (e) {
                const detail = e instanceof Error ? e.message : String(e);
                context.output.write(
                    options.json
                        ? toEnvelopeJson(
                              { error: detail },
                              { enveloped: options.jsonEnvelope, error: { code: 'INTERNAL_ERROR', message: detail } },
                          )
                        : `history daily failed: ${detail}`,
                );
                context.setExitCode(1);
                return;
            }

            // System-event bus + ledger (task 0471 R2): per-invocation, flushed in finally.
            // SAFETY: SystemEventBus is structurally the same ts-infra EventBus (see workflow.ts:248).
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
                    mode: options.mode,
                    ...(refresh?.importMode !== undefined ? { importMode: refresh.importMode } : {}),
                });
            } catch (e) {
                failure = { exitCode: 1, detail: e instanceof Error ? e.message : String(e) };
            }
            const durationMs = Date.now() - startMs;
            // Child-owned event enrichment (0717): trigger/window ride every history.*
            // event the child emits; interactive runs (refresh === null) stay unchanged.
            const refreshMeta =
                refresh === null
                    ? {}
                    : {
                          trigger: refresh.trigger,
                          windowStart: refresh.windowStart,
                          windowEnd: refresh.windowEnd,
                          importMode: refresh.importMode ?? 'incremental',
                      };

            try {
                if (failure !== null) {
                    // Exception path: emit failed, force exit 1.
                    await bus.emit('history.daily.failed', {
                        source: 'history',
                        renderer: 'history-daily',
                        detail: failure.detail,
                        exitCode: failure.exitCode,
                        durationMs,
                        ...refreshMeta,
                        severity: 'error',
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
                            ...refreshMeta,
                            ...(refresh !== null ? { coverage: result.coverage } : {}),
                            severity: 'info',
                        });
                        await bus.emit('history.analyze.completed', {
                            source: 'history',
                            renderer: 'history-analyze',
                            artifactPath,
                            totals: result.artifact.totals,
                            ...refreshMeta,
                            severity: 'info',
                        });
                    } else {
                        const failing = entries.filter((e) => e.status === 'failed');
                        const degraded = entries.filter((e) => e.status === 'degraded');
                        const problems = [...failing, ...degraded];
                        await bus.emit('history.daily.failed', {
                            source: 'history',
                            renderer: 'history-daily',
                            exitCode,
                            sources,
                            okSources,
                            failedSources,
                            detail:
                                problems.length > 0
                                    ? problems
                                          .map(
                                              (e) =>
                                                  `${e.source}: ${e.status} (${e.parseErrors + e.validationErrors} ` +
                                                  'parse/validation errors)',
                                          )
                                          .join('; ')
                                    : 'daily fan-out reported non-zero exit with no failing or degraded source',
                            durationMs,
                            artifactPath,
                            ...refreshMeta,
                            severity: 'error',
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
                    options.json
                        ? toEnvelopeJson(
                              { error: failure.detail },
                              {
                                  enveloped: options.jsonEnvelope,
                                  error: { code: 'INTERNAL_ERROR', message: String(failure.detail) },
                              },
                          )
                        : `history daily failed: ${failure.detail}`,
                );
                return;
            }
            if (result === null) {
                // Defensive: unreachable (failure path handles the null case), but keeps TS happy.
                context.setExitCode(1);
                return;
            }
            context.output.write(
                options.json ? toEnvelopeJson(result, { enveloped: options.jsonEnvelope }) : formatDailyResult(result),
            );
        });
}

function formatDailyResult(r: DailyResult): string {
    const lines: string[] = ['history daily'];
    lines.push('import:');
    for (const e of r.fanOut.entries) {
        lines.push(
            `  ${e.source}: ${e.status} (files=${e.files} scanned, new-messages=${e.messages}, tool-calls=${e.toolCalls})`,
        );
    }
    if (r.fanOut.warnings.length > 0) {
        lines.push('warnings:');
        for (const w of r.fanOut.warnings) {
            lines.push(`  [${w.code}] ${w.source ?? '-'}: ${w.detail}`);
        }
    }
    const a = r.fanOut.attribution;
    lines.push(
        `attribution: sessions=${a.sessionsEvaluated} links-created=${a.linksCreated} ` +
            `links-present=${a.linksAlreadyPresent} skipped=${a.skippedEvidence} ambiguous=${a.ambiguousEvidence}`,
    );
    lines.push(`artifact totals: messages=${r.artifact.totals.messages} toolCalls=${r.artifact.totals.toolCalls}`);
    lines.push(
        `coverage: refreshed=[${r.coverage.refreshed.join(', ')}] skipped=[${r.coverage.skipped.join(', ')}] ` +
            `window=${r.coverage.window.since ?? '…'} → ${r.coverage.window.until ?? '…'}`,
    );
    if (r.reportPath !== undefined) {
        lines.push(`report: ${r.reportPath}`);
    }
    lines.push(`pruned: ${r.pruned.length} report dir(s) older than 90 days`);
    lines.push(`exit_code: ${r.fanOut.exitCode}`);
    return lines.join('\n');
}
