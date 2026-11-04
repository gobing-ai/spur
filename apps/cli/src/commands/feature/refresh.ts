import type { Command } from '@commander-js/extra-typings';
import { resolvePlanningFolders } from '@gobing-ai/spur-app';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeService } from './shared';

/** Register `spur feature refresh`. */
export function registerFeatureRefreshCommand(feature: Command, context: CliContext): void {
    // ── refresh ──
    // Distinct from `sync`: refresh rewrites derived docs only (INDEX + ## Tasks).
    // It never changes feature lifecycle status or runs transition guards.
    feature
        .command('refresh')
        .summary('Rebuild INDEX.md and each feature ## Tasks table from task edges (docs only — no status change).')
        .description(
            [
                'Regenerate derived views so feature markdown matches the task graph:',
                '  • docs/features/INDEX.md (ID-encoded tree)',
                '  • each feature ## Tasks auto-gen region (WBS / title / status from feature_id edges)',
                '',
                'Scope is explicit (task 0625 R5a, ADR-051 consent): pass --feature <id> to rewrite',
                'one feature, or --all to sweep every feature. A bare invocation refuses to sweep',
                '— the all-features rewrite silently touched unrelated features during the A3 run.',
                '',
                'Does NOT change feature frontmatter status. For lifecycle alignment use `spur feature sync`.',
                'Use after task create/link/done when the ## Tasks table is stale.',
            ].join('\n'),
        )
        .option(...SHARED_OPTIONS.featureTasksRewrite)
        .option('--all', 'Rewrite every feature ## Tasks region (explicit broad sweep)')
        .option(...SHARED_OPTIONS.folderFeatures)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            const svc = await makeService(context, options.folder);
            try {
                if (options.all && options.feature) {
                    writeJsonError(
                        context.output,
                        options,
                        '--feature <id> and --all are mutually exclusive',
                        'VALIDATION_FAILED',
                    );
                    context.setExitCode(2);
                    return;
                }
                if (!options.all && !options.feature) {
                    writeJsonError(
                        context.output,
                        options,
                        '--feature <id> or --all is required (refusing silent all-features sweep)',
                        'VALIDATION_FAILED',
                    );
                    context.setExitCode(2);
                    return;
                }
                const result = await svc.refresh({ featureId: options.feature });
                if (options.json) {
                    const featuresDir = options.folder ?? (await resolvePlanningFolders(context.fs)).featuresDir;
                    context.output.write(
                        toEnvelopeJson(
                            {
                                index_path: `${featuresDir}/INDEX.md`,
                                tasksUpdated: result.tasksUpdated,
                                skipped: result.skipped,
                            },
                            { enveloped: options.jsonEnvelope },
                        ),
                    );
                } else {
                    for (const s of result.skipped) {
                        context.output.write(`Skipped ${s.id} (${s.reason})`);
                    }
                    context.output.write(
                        `INDEX.md regenerated (${result.index.split('\n').length} lines); ${result.tasksUpdated} feature Tasks region(s) updated`,
                    );
                }
            } catch (err) {
                writeJsonError(context.output, options, String(err));
                context.setExitCode(1);
            }
        });
}
