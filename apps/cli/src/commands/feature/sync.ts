import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeReceiptRunPort, makeService } from './shared';

/** Register `spur feature sync`. */
export function registerFeatureSyncCommand(feature: Command, context: CliContext): void {
    // ── sync ──
    feature
        // Distinct from `refresh`: sync proposes/applies real lifecycle transitions
        // (and their guards). It does not rewrite INDEX.md or ## Tasks tables.
        .command('sync')
        .summary('Align feature lifecycle status with linked task states (status only — runs transition guards).')
        .description(
            [
                'Derive a feature status proposal from linked task statuses and apply legal hops',
                '(e.g. all tasks done → advance toward done; reopened work → reopen the feature).',
                '',
                'Applies real lifecycle transitions — gates such as dogfood, one-active-goal, and',
                'L4 AC readiness may deny a hop. Preview with --dry-run first.',
                '',
                'Does NOT rewrite INDEX.md or ## Tasks tables. For stale rosters use `spur feature refresh --feature <id>`.',
            ].join('\n'),
        )
        .argument('[id]', 'Feature ID to sync (optional if --all is passed)')
        .option('--all', 'Sync all features with linked tasks')
        .option(...SHARED_OPTIONS.dryRunFeatureSync)
        .option(...SHARED_OPTIONS.forceFeatureReopen)
        .option(...SHARED_OPTIONS.folderFeatures)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (id, options) => {
            const svc = await makeService(context, options.folder);
            try {
                if (!options.all && !id) {
                    writeJsonError(
                        context.output,
                        options,
                        'Feature ID is required unless --all is passed',
                        'VALIDATION_FAILED',
                    );
                    context.setExitCode(2);
                    return;
                }

                if (options.all) {
                    const result = await svc.syncAllFeatures({
                        dryRun: options.dryRun,
                        forceConfirm: options.force,
                        force: options.force,
                        // 1119: the completion-boundary receipt probe reads the same run store
                        // `feature check` / `feature advance` already consult.
                        receiptRunPort: await makeReceiptRunPort(context),
                    });
                    if (options.json) {
                        context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
                    } else {
                        context.output.write(
                            `Evaluated ${result.evaluated}/${result.totalFeatures} features; updated ${result.updatedCount} feature(s).`,
                        );
                        for (const res of result.results) {
                            const tag = res.applied
                                ? 'UPDATED'
                                : res.goalConflict !== undefined
                                  ? 'GOAL-CONFLICT'
                                  : res.proposal.from === res.proposal.to
                                    ? 'NOOP'
                                    : 'SKIPPED';
                            context.output.write(
                                `  [${tag}] ${res.proposal.featureId}: ${res.proposal.from} -> ${res.proposal.to} (${res.proposal.reason})`,
                            );
                        }
                    }
                } else if (id) {
                    const result = await svc.syncFeature(id, {
                        dryRun: options.dryRun,
                        forceConfirm: options.force,
                        force: options.force,
                        // 1119: same run-store port as --all / check / advance.
                        receiptRunPort: await makeReceiptRunPort(context),
                    });
                    if (options.json) {
                        context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
                    } else {
                        const tag = result.applied
                            ? 'UPDATED'
                            : result.goalConflict !== undefined
                              ? 'GOAL-CONFLICT'
                              : result.proposal.from === result.proposal.to
                                ? 'NOOP'
                                : 'SKIPPED';
                        context.output.write(
                            `Feature ${id}: [${tag}] ${result.proposal.from} -> ${result.proposal.to} (${result.proposal.reason})`,
                        );
                        // 1119 R4: name the receipt finding so a caller sees why `done` was withheld.
                        if (result.proposal.receiptPending) {
                            for (const f of result.proposal.gateFindings ?? []) {
                                const tag = f.severity === 'error' ? 'ERR' : 'WARN';
                                context.output.write(`  [${tag}] ${f.layer} ${f.section}: ${f.message}`);
                            }
                        }
                    }
                }
            } catch (err) {
                writeJsonError(context.output, options, String(err));
                context.setExitCode(1);
            }
        });
}
