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
            const {
                ANSWER_LINT_MAX_FINDINGS,
                deriveVerdict,
                formatReplayReport,
                lintVerifyAnswerForTask,
                readTaskAcceptanceCriteria,
                replayCitedTests,
                summarizeRowIds,
                VERDICT_SCENARIO_KEY_FORMS,
                verdictScenarioKeyGap,
            } = await import('@gobing-ai/spur-app');
            const answerPath = options.fromAnswer ?? `.spur/run/${wbs}-verify-answer.txt`;
            let answerText: string;
            try {
                answerText = await context.fs.readFile(context.fs.resolve(answerPath));
            } catch {
                writeJsonError(context.output, options, `Answer file not found: ${answerPath}`);
                context.setExitCode(1);
                return;
            }

            // 1003 R2: the answer lint owns the pre-verdict gate — a malformed answer
            // blocks derivation here (no verdict artifact) instead of poisoning the
            // verdict parse downstream.
            const { foldersConfig, featuresDir } = await resolvePlanningFolders(context.fs);
            const corpusDeps = {
                fs: context.fs,
                tasksDir: context.fs.resolve(options.folder ?? foldersConfig.active_folder),
                foldersConfig,
                featuresDir: context.fs.resolve(featuresDir),
            };
            const lintFindings = await lintVerifyAnswerForTask(wbs, answerText, corpusDeps);
            // 1319 R5(a): one lint file per task, cleared on EVERY invocation so a retry token can
            // never read a stale finding set, and rewritten on a lint failure so the review state can
            // re-issue the prompt with the findings instead of buying a remediate hop.
            const lintPath = `.spur/run/${wbs}-verdict-lint.txt`;
            const clearLintFile = async (): Promise<void> => {
                try {
                    await context.fs.deleteFile(lintPath);
                } catch {
                    // Absent is the normal case.
                }
            };
            if (lintFindings.length > 0) {
                if (options.json) {
                    context.output.write(JSON.stringify({ wbs, lintFindings }, null, 2));
                } else {
                    context.output.error(
                        `task verdict: answer lint failed — ${lintFindings.length}` +
                            `${lintFindings.length >= ANSWER_LINT_MAX_FINDINGS ? '+' : ''} finding(s) in ${answerPath}`,
                    );
                    for (const f of lintFindings) context.output.error(`  line ${f.line}: ${f.message}`);
                }
                await context.fs.ensureDir('.spur/run');
                await context.fs.writeFile(
                    lintPath,
                    `${lintFindings.map((f) => `line ${f.line}: ${f.message}`).join('\n')}\n`,
                );
                context.setExitCode(1);
                return;
            }
            await clearLintFile();

            // Derive verdict from answer text. The pipeline's verify→record
            // transition already gates on task check independently, so the
            // answer text is the sole input here.
            const taskCheckPassed = true; // Pipeline runs its own check guard
            // P2: evidence-rule exemption tags come only from the task file's own AC items.
            const taskAc = await readTaskAcceptanceCriteria(wbs, corpusDeps);
            const result = deriveVerdict(answerText, taskCheckPassed, taskAc);

            // 0958 R2: the 0700 R3 removal retired an unclearable, requirements-only warning;
            // this check is its scoped successor — covering tasks only, so re-keying one row
            // clears it, and it reads both tables exactly as the done gate credits them. It
            // runs here, before the artifact exists, so the repair is a re-key instead of the
            // recorded manual re-derive + re-bind loop at the feature done gate.
            const gap = await verdictScenarioKeyGap(
                wbs,
                [...result.requirements, ...(result.acceptanceCriteria ?? [])],
                corpusDeps,
            );
            if (gap !== null) {
                writeJsonError(
                    context.output,
                    options,
                    `Verdict rows key to no scenario of linked feature ${gap.featureId}: ` +
                        `${summarizeRowIds(gap.offendingIds)}. ` +
                        `Key each row by ${VERDICT_SCENARIO_KEY_FORMS} (repair: /sp:dev-verify ${wbs})`,
                );
                context.setExitCode(1);
                return;
            }

            // 1319 R4: replay before the artifact becomes durable. A cited test file that is missing,
            // fails or times out means the PASS was not earned, so it downgrades to PARTIAL and the
            // findings name the anchor. A non-PASS is never upgraded.
            const replay =
                options.replay === true
                    ? await replayCitedTests([...result.requirements, ...(result.acceptanceCriteria ?? [])])
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
