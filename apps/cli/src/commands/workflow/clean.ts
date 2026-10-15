import type { Command } from '@commander-js/extra-typings';
import { resolveWorkflowLogRetentionDays } from '@gobing-ai/spur-app';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeWorkflowService } from './shared';

/** Register `spur workflow clean`. */
export function registerWorkflowCleanCommand(workflow: Command, context: CliContext): void {
    workflow
        .command('clean')
        .description(
            'Housekeeping: finalize orphaned runs stuck in running/pending past a staleness threshold ' +
                '(mark as failed) and reclaim retained run logs, terminal checkpoints and .spur/run scratch older than ' +
                'workflows.logRetentionDays. ' +
                '`--logs` scopes to log reclamation only. To cancel a single live run by id, use ' +
                '`spur workflow cancel <run-id>` instead.',
        )
        .option('--older-than <minutes>', 'Staleness threshold in minutes (stale-run scope only)', '30')
        .option(...SHARED_OPTIONS.forceWorkflowClean)
        .option('--logs', 'Scope to retained run-log reclamation only (skip stale-run finalization)')
        .option(...SHARED_OPTIONS.dryRunWorkflowClean)
        .option(...SHARED_OPTIONS.jsonSupported)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            const dryRun = options.dryRun === true;
            const logsOnly = options.logs === true;
            const force = options.force === true;
            const minutes = force ? 0 : Number.parseInt(options.olderThan ?? '30', 10);
            if (!Number.isFinite(minutes) || minutes < 0) {
                writeJsonError(
                    context.output,
                    options,
                    `Invalid --older-than value: ${options.olderThan}`,
                    'VALIDATION_FAILED',
                );
                context.setExitCode(2);
                return;
            }
            const svc = makeWorkflowService(context, options.json);
            // Persist lasting data before any housekeeping; failure preserves all sources.
            const migration = await svc.migrateRunStorage({ dryRun, logsOnly });
            if (migration.failures.length > 0) {
                context.setExitCode(1);
                const result = logsOnly ? undefined : await svc.clean(minutes, dryRun);
                const logs = {
                    retentionDays: resolveWorkflowLogRetentionDays(context.spurConfig ?? null),
                    dryRun,
                    reclaimed: [],
                    failures: [],
                };
                if (options.json) {
                    context.output.write(
                        toEnvelopeJson(
                            logsOnly
                                ? { ...logs, migration }
                                : {
                                      olderThanMinutes: minutes,
                                      dryRun,
                                      cleaned: result?.cleaned ?? [],
                                      logs,
                                      checkpoints: { reclaimed: [], skipped: [], failures: [] },
                                      scratch: {
                                          retentionDays: logs.retentionDays,
                                          dryRun,
                                          reclaimed: [],
                                          failures: [],
                                      },
                                      migration,
                                  },
                            { enveloped: options.jsonEnvelope },
                        ),
                    );
                } else {
                    for (const failure of migration.failures) {
                        const remedySuffix = failure.remedy ? ` — ${failure.remedy}` : '';
                        context.output.error(
                            `Migration failed for ${failure.source}: ${failure.reason}${remedySuffix}; log/checkpoint reclamation skipped.`,
                        );
                    }
                    if (result !== undefined) {
                        const verb = dryRun ? 'Would finalize' : 'Finalized';
                        if (result.cleaned.length === 0) {
                            const ageMsg = force ? '' : ` older than ${minutes}m`;
                            context.output.write(`No stale runs${ageMsg}.`);
                        } else {
                            const ageMsg = force ? ' (all non-terminal)' : ` (>${minutes}m)`;
                            context.output.write(
                                `${verb} ${result.cleaned.length} stale run(s)${ageMsg}:\n` +
                                    result.cleaned.map((r) => `  ${r.runId} (started ${r.startedAt})`).join('\n'),
                            );
                        }
                    }
                }
                return;
            }
            const result = logsOnly ? undefined : await svc.clean(minutes, dryRun);
            const retentionDays = resolveWorkflowLogRetentionDays(context.spurConfig ?? null);
            const logResult = await svc.cleanRunLogs(retentionDays, dryRun);
            const checkpointResult = logsOnly ? undefined : await svc.cleanCheckpoints(retentionDays, dryRun);
            // After log/checkpoint passes: they own `.log` files and durable copies; scratch is disposable (ADR-131).
            const scratchResult = logsOnly ? undefined : await svc.cleanScratch(retentionDays, dryRun);
            if (options.json) {
                context.output.write(
                    toEnvelopeJson(
                        logsOnly
                            ? { ...logResult, migration }
                            : {
                                  ...result,
                                  logs: logResult,
                                  checkpoints: checkpointResult,
                                  scratch: scratchResult,
                                  migration,
                              },
                        { enveloped: options.jsonEnvelope },
                    ),
                );
            } else {
                if (result !== undefined) {
                    const verb = dryRun ? 'Would finalize' : 'Finalized';
                    if (result.cleaned.length === 0) {
                        const ageMsg = force ? '' : ` older than ${minutes}m`;
                        context.output.write(`No stale runs${ageMsg}.`);
                    } else {
                        const ageMsg = force ? ' (all non-terminal)' : ` (>${minutes}m)`;
                        context.output.write(
                            `${verb} ${result.cleaned.length} stale run(s)${ageMsg}:\n` +
                                result.cleaned.map((r) => `  ${r.runId} (started ${r.startedAt})`).join('\n'),
                        );
                    }
                }
                const logVerb = dryRun ? 'Would reclaim' : 'Reclaimed';
                if (logResult.reclaimed.length === 0) {
                    context.output.write(`No retained run logs older than ${retentionDays}d.`);
                } else {
                    context.output.write(
                        `${logVerb} ${logResult.reclaimed.length} retained run log(s) (>${retentionDays}d):\n` +
                            logResult.reclaimed.map((l) => `  ${l.runId} (mtime ${l.mtime})`).join('\n'),
                    );
                }
                for (const failure of logResult.failures) {
                    context.output.error(`Failed to remove run log ${failure.path}: ${failure.error}`);
                }
                if (checkpointResult !== undefined) {
                    const cpVerb = dryRun ? 'Would reclaim' : 'Reclaimed';
                    if (checkpointResult.reclaimed.length === 0) {
                        context.output.write(`No expired terminal checkpoints older than ${retentionDays}d.`);
                    } else {
                        context.output.write(
                            `${cpVerb} ${checkpointResult.reclaimed.length} expired terminal checkpoint(s) (>${retentionDays}d):\n` +
                                checkpointResult.reclaimed.map((c) => `  ${c.name} (age ${c.age})`).join('\n'),
                        );
                    }
                    for (const skip of checkpointResult.skipped) {
                        context.output.write(`  kept ${skip.name}: ${skip.reason}`);
                    }
                    for (const failure of checkpointResult.failures) {
                        context.output.error(`Failed to remove checkpoint ${failure.path}: ${failure.error}`);
                    }
                }
                if (scratchResult !== undefined) {
                    const scVerb = dryRun ? 'Would reclaim' : 'Reclaimed';
                    if (scratchResult.reclaimed.length === 0) {
                        context.output.write(`No .spur/run scratch older than ${retentionDays}d.`);
                    } else {
                        context.output.write(
                            `${scVerb} ${scratchResult.reclaimed.length} .spur/run scratch entr(ies) (>${retentionDays}d):\n` +
                                scratchResult.reclaimed.map((e) => `  ${e.name} (mtime ${e.mtime})`).join('\n'),
                        );
                    }
                    for (const failure of scratchResult.failures) {
                        context.output.error(`Failed to reclaim scratch ${failure.path}: ${failure.error}`);
                    }
                }
                const migrated = migration.entries.filter((e) => e.outcome === 'migrated').length;
                const present = migration.entries.filter((e) => e.outcome === 'already-present').length;
                const migVerb = dryRun ? 'Evidence migration would affect' : 'Evidence migration';
                context.output.write(
                    `${migVerb}: ${migrated} migrated, ${present} already present, ${migration.failures.length} failed.`,
                );
            }
        });
}
