import type { Command } from '@commander-js/extra-typings';
import { runHistoryReport } from '@gobing-ai/spur-app';
import { stalenessBanner } from '@gobing-ai/spur-domain';
import type { CliContext } from '../../context';
import { toEnvelopeJson } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { parseTopOrThrow } from './shared';

/** Register `spur history report`. */
export function registerHistoryReportCommand(noun: Command, context: CliContext): void {
    noun.command('report')
        .description(
            'Render a previously-generated history artifact as a spend + forensic report. ' +
                'Never opens the database — pure renderer of the analyze JSON. ' +
                '--task / --top narrow the already-loaded artifact client-side (0564 R3).',
        )
        .argument('[path]', 'Artifact JSON path (defaults to the latest.json pointer)')
        .option(...SHARED_OPTIONS.jsonParsedArtifact)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .option('--mode <name>', 'Report mode: default | forensics (registry-resolved; unknown names fail)')
        .option('--task <wbs>', 'Narrow to a single task WBS the artifact was analyzed with')
        .option('--top <n>', 'Leaderboard depth for byTool/bySession (re-slices the artifact)')
        .action(async (pathArg, options) => {
            try {
                // An unusable `--top` is an error, not a silently-ignored filter: coercing it
                // to `undefined` rendered the FULL artifact with no banner and no diagnostic,
                // so a typo (`--top l0`) read as a deliberate unfiltered report. `--task`
                // fails loud on a dimension it cannot satisfy; `--top` matches that contract.
                const top = parseTopOrThrow(options.top);
                const { report, artifactPath, resolution, artifact, banner } = runHistoryReport({
                    path: pathArg,
                    cwd: context.cwd,
                    now: new Date(),
                    mode: options.mode,
                    task: options.task,
                    top,
                });
                if (options.json) {
                    context.output.write(toEnvelopeJson(artifact, { enveloped: options.jsonEnvelope }));
                    context.setExitCode(0);
                    return;
                }

                // Staleness banner only when resolved via pointer, never on explicit path (R7).
                if (resolution === 'pointer') {
                    const staleBanner = stalenessBanner(artifact.generatedAt, new Date());
                    if (staleBanner !== null) context.output.write(staleBanner);
                }

                // Narrowing banner (R3, 0564): one line naming the applied filter and the artifact.
                if (banner !== null) context.output.write(`${banner}\n`);

                context.output.write(report);
                context.output.write(`\n(artifact: ${artifactPath})\n`);
                context.setExitCode(0);
            } catch (e) {
                const message = `spur history report failed: ${(e as Error).message}`;
                context.output.write(
                    options.json
                        ? toEnvelopeJson(
                              { status: 'error', message },
                              { enveloped: options.jsonEnvelope, error: { code: 'INTERNAL_ERROR', message } },
                          )
                        : message,
                );
                context.setExitCode(1);
            }
        });
}
