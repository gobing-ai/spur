import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { toEnvelopeJson, writeJsonError } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';

/** Register `spur task scaffold-tests`. */
export function registerTaskScaffoldTestsCommand(task: Command, context: CliContext): void {
    // ── scaffold-tests ──
    task.command('scaffold-tests')
        .summary('Generate BDD test stubs from task Acceptance Criteria.')
        .argument('<wbs>', 'Task WBS number')
        .option(...SHARED_OPTIONS.fileTaskTest)
        .option(...SHARED_OPTIONS.folderTasks)
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (wbs, options) => {
            const { TaskScaffoldService, resolvePlanningFolders } = await import('@gobing-ai/spur-app');
            const foldersConfig = (await resolvePlanningFolders(context.fs)).foldersConfig;
            const tasksDir = options.folder ?? context.fs.resolve(foldersConfig.active_folder);
            const scaffoldSvc = new TaskScaffoldService({
                fs: context.fs,
                tasksDir,
                foldersConfig,
            });

            try {
                const result = await scaffoldSvc.scaffoldTests(wbs, {
                    targetFile: options.file,
                });
                if (options.json) {
                    context.output.write(toEnvelopeJson(result, { enveloped: options.jsonEnvelope }));
                } else {
                    context.output.write(
                        `Scaffolded tests for ${wbs} -> ${result.targetFile} (created: ${result.created}, skipped: ${result.skipped}, drifted: ${result.drifted})`,
                    );
                    for (const w of result.warnings) {
                        context.output.write(`  [WARN] ${w}`);
                    }
                }
            } catch (err) {
                writeJsonError(context.output, options, String(err));
                context.setExitCode(1);
            }
        });
}
