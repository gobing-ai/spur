import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { toEnvelopeJson } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeHistoryService } from './shared';

/** Register `spur history reset`. */
export function registerHistoryResetCommand(noun: Command, context: CliContext): void {
    noun.command('reset')
        .description(
            'Destructively wipe every history_* table: normalized rows, per-source ETL, board rollups, ' +
                'daily stats, and importer checkpoints/ledger. Requires --yes. Task corpus and run ' +
                'provenance (task_run_links) are untouched; a full `spur history import` rebuilds everything.',
        )
        .option('--yes', 'Confirm the destructive wipe', false)
        .option(...SHARED_OPTIONS.jsonSupported)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            if (!options.yes) {
                context.output.write(
                    options.json
                        ? toEnvelopeJson(
                              { status: 'error', message: 'Refusing to wipe history tables without --yes.' },
                              {
                                  enveloped: options.jsonEnvelope,
                                  error: {
                                      code: 'INTERNAL_ERROR',
                                      message: 'Refusing to wipe history tables without --yes.',
                                      details: { cliCode: 'usage' },
                                  },
                              },
                          )
                        : 'spur history reset: refusing to wipe history tables without --yes.',
                );
                context.setExitCode(1);
                return;
            }
            const svc = await makeHistoryService(context);
            const result = await svc.resetHistory();
            const note =
                result.unknown.length > 0
                    ? ` WARNING: ${result.unknown.length} unlisted history_* table(s) left intact: ${result.unknown.join(', ')}`
                    : '';
            context.output.write(
                options.json
                    ? toEnvelopeJson(
                          {
                              cleared: result.cleared,
                              skipped: result.skipped,
                              unknown: result.unknown,
                              clearedCount: result.cleared.length,
                          },
                          { enveloped: options.jsonEnvelope },
                      )
                    : `cleared ${result.cleared.length} history tables` +
                          (result.skipped.length > 0 ? ` (${result.skipped.length} not present)` : '') +
                          note,
            );
        });
}
