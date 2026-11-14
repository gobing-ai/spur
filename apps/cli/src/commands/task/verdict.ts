import type { Command } from '@commander-js/extra-typings';
import { resolvePlanningFolders } from '@gobing-ai/spur-app';
import type { CliContext } from '../../context';
import { writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';

/** Register `spur task verdict`. */
export function registerTaskVerdictCommand(task: Command, context: CliContext): void {
    // ── verdict ──
    task.command('verdict')
        .summary('Derive PASS/PARTIAL/FAIL/UNKNOWN verdict from verify answer text (replaces pipeline grep/shell).')
        .argument('<wbs>', 'Task WBS number')
        .option('--from-answer <path>', 'Path to verify answer text file')
        // 1319 R4: replay the test files the verdict rows cite, before a PASS becomes durable.
        .option('--replay', 'Re-execute the test files the verdict rows cite; a failure downgrades PASS to PARTIAL')
        .option(...SHARED_OPTIONS.folderTasks)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (wbs, options) => {
            // Lazy-import to keep the barrel clean for typecheck.
            const { deriveVerdict, formatReplayReport, readTaskAcceptanceCriteria, replayCitedTests } = await import(
                '@gobing-ai/spur-app'
            );
            const answerPath = options.fromAnswer ?? `.spur/run/${wbs}-verify-answer.txt`;
            let answerText: string;
            try {
                answerText = await context.fs.readFile(context.fs.resolve(answerPath));
            } catch {
                writeJsonError(context.output, options, `Answer file not found: ${answerPath}`);
                context.setExitCode(1);
                return;
            }

            const { foldersConfig, featuresDir } = await resolvePlanningFolders(context.fs);
            const corpusDeps = {
                fs: context.fs,
                tasksDir: context.fs.resolve(options.folder ?? foldersConfig.active_folder),
                foldersConfig,
                featuresDir: context.fs.resolve(featuresDir),
            };

            // Derive verdict from answer text. The pipeline's verify→record
            // transition already gates on task check independently, so the
            // answer text is the sole input here.
            const taskCheckPassed = true; // Pipeline runs its own check guard
            // P2: evidence-rule exemption tags come only from the task file's own AC items.
            const taskAc = await readTaskAcceptanceCriteria(wbs, corpusDeps);
            const result = deriveVerdict(answerText, taskCheckPassed, taskAc);

            // 1319 R4: replay before the artifact becomes durable. A cited test file that is missing,
            // fails or times out means the PASS was not earned, so it downgrades to PARTIAL and the
            // findings name the anchor. A non-PASS is never upgraded.
            const replay =
                options.replay === true
                    ? await replayCitedTests([...result.requirements, ...(result.acceptanceCriteria ?? [])], {
                          // The project's own `test-changed` binding, not the default preset.
                          cwd: context.cwd,
                          builder: context.spurConfig?.builder,
                      })
                    : undefined;
            const downgraded = replay !== undefined && replay.findings.length > 0 && result.verdict === 'PASS';
            if (downgraded) result.verdict = 'PARTIAL';

            // Emit verdict artifact.
            const jsonOut = JSON.stringify(
                {
                    wbs,
                    ...result,
                    ...(replay !== undefined ? { replay } : {}),
                    source: 'spur-task-verdict',
                },
                null,
                2,
            );
            await context.fs.ensureDir('.spur/run');
            await context.fs.writeFile(`.spur/run/${wbs}-verdict.json`, `${jsonOut}\n`);

            if (options.json) {
                context.output.write(jsonOut);
            } else {
                context.output.write(
                    `Verdict: ${result.verdict} (${result.requirements.length} requirements, ${result.checks.length} checks)`,
                );
                if (replay !== undefined) {
                    const report = formatReplayReport(replay);
                    context.output.write(report.summary);
                    for (const line of report.findings) context.output.error(line);
                }
            }

            if (result.verdict !== 'PASS') {
                context.setExitCode(1);
            }
        });
}
