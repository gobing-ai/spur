import type { Command } from '@commander-js/extra-typings';
import { formatSummary } from '@gobing-ai/spur-domain';
import { CLI_CONFIG } from '../../config';
import type { CliContext } from '../../context';
import { toEnvelopeJson } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { makeHistoryService } from './shared';

/** Register `spur history analyze`. */
export function registerHistoryAnalyzeCommand(noun: Command, context: CliContext): void {
    noun.command('analyze')
        .description(
            'Aggregate imported history with SQL and write a versioned JSON artifact (Q1-Q10 forensic query set).',
        )
        .option('--since <iso>', 'Inclusive lower bound on message timestamp')
        .option('--until <iso>', 'Inclusive upper bound on message timestamp')
        .option(...SHARED_OPTIONS.sourceHistory, 'all')
        .option('--session <id>', 'Narrow to a single session id')
        .option(...SHARED_OPTIONS.runHistory)
        .option('--task <wbs>', 'Narrow to a single task WBS')
        .option('--top <n>', 'Leaderboard depth for byTool/bySession', '20')
        .option('--out <path>', 'Write the artifact to this path instead of the dated reports dir')
        .option(...SHARED_OPTIONS.jsonArtifact)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            const svc = await makeHistoryService(context);
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
                    ? toEnvelopeJson(artifact, { enveloped: options.jsonEnvelope })
                    : formatSummary({
                          totals: artifact.totals,
                          bySource: artifact.bySource,
                          byModel: artifact.byModel,
                          daily: artifact.daily,
                      }),
            );
            // Task 1131 R4: a --session selector that matched nothing is loud — exit 2 with
            // the session-not-found warning in the artifact. Other zero-data selectors stay 0.
            if (artifact.warnings.some((w) => w.code === 'session-not-found')) {
                context.setExitCode(2);
            }
        });
}
