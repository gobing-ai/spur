/**
 * `spur workflow persist-out` / `persist-check` — the WT-4 worktree-landing transport (flat verbs
 * since task 1242 flattened the deleted `workflow inline` group; the capability is unchanged).
 *
 * `persist-out` copies a worktree's run rows, two-file records and cited/owned evidence into the
 * invoking tree before teardown; `persist-check` asserts nothing owned would be abandoned by the
 * removal. They are boot-free (`index.ts` dispatches them before the full CLI boot): like the
 * plugin scripts they replace, they never create a database in the cwd — the app runners open the
 * run-owning trees' databases themselves.
 */
import type { Command } from '@commander-js/extra-typings';
import { runPersistOut } from '@gobing-ai/spur-app';
import { runPersistCheck } from '@gobing-ai/spur-app/persist-check';
import { errorMessage } from '../../errors';

/** The subset of the CLI context these verbs need: their own output channel and exit code. */
interface PersistContext {
    readonly cwd: string;
    readonly output: { write: (line: string) => void; error: (line: string) => void };
    setExitCode: (code: number) => void;
}

const collect = (value: string, previous: string[]): string[] => [...previous, value];

/** Register the two flat landing verbs under `workflow`. */
export function registerWorkflowPersistCommand(workflow: Command, context: PersistContext): void {
    const usage = (cmd: { helpInformation(): string }): void => {
        context.output.error(cmd.helpInformation().trimEnd());
        context.setExitCode(2);
    };

    const persistOut = workflow
        .command('persist-out')
        .summary("copy a worktree's run provenance and owned evidence into this tree (fail closed)")
        .description(
            'Before worktree teardown: transfer run rows and copy the two-file run records plus cited/owned evidence into the invoking tree.',
        )
        .option('--from <worktree>', 'Source worktree')
        .option(
            '--task-file <path>',
            'Merged task file whose cited/owned evidence rides along (repeatable)',
            collect,
            [],
        )
        .action(async (options) => {
            const from = options.from ?? '';
            if (from.trim() === '' || options.taskFile.some((taskFile) => taskFile.trim() === ''))
                return usage(persistOut);
            try {
                const result = await runPersistOut({ from, taskFiles: options.taskFile, to: context.cwd });
                for (const line of result.stdout) context.output.write(line);
                for (const line of result.stderr) context.output.error(line);
                context.setExitCode(result.exitCode);
            } catch (error) {
                context.output.error(`persist-out: FAIL — ${errorMessage(error)}`);
                context.setExitCode(1);
            }
        });

    workflow
        .command('persist-check')
        .summary('assert a worktree owns no unpersisted durable evidence before removal (WT-4)')
        .option('--from <worktree>', 'Worktree about to be removed')
        .option('--task-file <path>', 'Task file whose <wbs>- evidence the worktree owns (repeatable)', collect, [])
        .option('--run-id <id>', 'Run id whose <run-id>- evidence the worktree owns (repeatable)', collect, [])
        .option('--root <invoke-tree>', 'Invoking (main) tree (default: the git common dir parent)')
        .option('--success-json <path>', 'persist-out result to read skips from')
        .action((options) => {
            const result = runPersistCheck({
                from: options.from ?? '',
                taskFiles: options.taskFile,
                runIds: options.runId,
                ...(options.root === undefined ? {} : { root: options.root }),
                ...(options.successJson === undefined ? {} : { successJson: options.successJson }),
                cwd: context.cwd,
            });
            for (const line of result.stdout) context.output.write(line);
            for (const line of result.stderr) context.output.error(line);
            context.setExitCode(result.exitCode);
        });
}
