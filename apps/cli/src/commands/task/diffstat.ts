import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';

/** Register `spur task diffstat` — triage diff evidence (script-absorption PR-3). */
export function registerTaskDiffstatCommand(task: Command, context: CliContext): void {
    task.command('diffstat')
        .summary('Write the triage diffstat for a task run.')
        .description(
            'Diff the working tree against the run base .spur/run/<wbs>-base.sha and write ' +
                '.spur/run/<wbs>-diffstat.json {files, insertions, deletions, paths, sensitive}.\n' +
                'Fail safe: a missing or malformed base or a failing git call writes sensitive:true and exits 0.\n\n' +
                'Exit codes: 0 written, 1 stdout redirected onto the artifact.',
        )
        .argument('<wbs>', 'Task WBS number')
        .action(async (wbs) => {
            const { runDiffstat } = await import('@gobing-ai/spur-app/task-diffstat');
            const result = runDiffstat(
                { wbs },
                {
                    cwd: context.cwd,
                    warn: (text) => context.output.error(text.endsWith('\n') ? text.slice(0, -1) : text),
                },
            );
            context.setExitCode(result.exitCode);
        });
}
