import type { Command } from '@commander-js/extra-typings';
import { normalizeFeatureStatus } from '@gobing-ai/spur-domain';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeService } from './shared';

/** Register `spur feature list`. */
export function registerFeatureListCommand(feature: Command, context: CliContext): void {
    // ── list ──
    feature
        .command('list')
        .summary('List features with optional status/priority filters.')
        .option(...SHARED_OPTIONS.statusFilter)
        .option(...SHARED_OPTIONS.priorityFilter)
        .option(...SHARED_OPTIONS.folderFeatures)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            const svc = await makeService(context, options.folder);
            try {
                let features = await svc.list();
                if (options.status !== undefined) {
                    const wantStatus = normalizeFeatureStatus(options.status);
                    features = features.filter((f) => f.status === wantStatus);
                }
                if (options.priority !== undefined) {
                    features = features.filter((f) => f.priority === options.priority);
                }
                features.sort((a, b) => a.id.localeCompare(b.id));
                if (options.json) {
                    context.output.write(toEnvelopeJson(features, { enveloped: options.jsonEnvelope, kind: 'list' }));
                } else if (features.length === 0) {
                    context.output.write('(no features)');
                } else {
                    for (const f of features) {
                        context.output.write(`${f.id.padEnd(4)}  ${f.status.padEnd(9)}  ${f.priority}  ${f.name}`);
                    }
                }
            } catch (err) {
                writeJsonError(context.output, options, String(err));
                context.setExitCode(1);
            }
        });
}
