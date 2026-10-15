/**
 * `spur workflow commit-guard <start|stage|check> --run <id>` — the run-scoped staging guard the
 * inline driver uses before a commit (script-absorption PR-4; replaces
 * `plugins/sp/scripts/commit-guard.ts`). Thin adapter: the probes and partition live in
 * `@gobing-ai/spur-app/commit-guard`, which returns its report lines instead of writing them.
 *
 * Exit codes are the script's: 0 ok · 1 usage error or failed probe (nothing staged) · 2 `stage`
 * refused at least one path (the `{staged, foreign}` JSON is still printed).
 */
import type { Command } from '@commander-js/extra-typings';
import {
    type CommitGuardReport,
    commitGuardCheck,
    commitGuardStage,
    commitGuardStart,
    commitGuardUsage,
} from '@gobing-ai/spur-app/commit-guard';
import { acceptArtifactId } from '../../artifact-id';
import type { CliContext } from '../../context';

type GuardContext = Pick<CliContext, 'cwd' | 'output' | 'setExitCode'>;

/** Register `spur workflow commit-guard start|stage|check` under `workflow`. */
export function registerWorkflowCommitGuardCommand(workflow: Command, context: GuardContext): void {
    const emit = (report: CommitGuardReport): void => {
        for (const line of report.stdout) context.output.write(line);
        for (const line of report.stderr) context.output.error(line);
        context.setExitCode(report.exitCode);
    };
    /** A missing `--run` is the guard's own usage line (exit 1), not a Commander error. */
    const withRun = (run: string | undefined, guarded: (run: string) => CommitGuardReport): void => {
        if (run === undefined || run === '') {
            emit(commitGuardUsage());
            return;
        }
        if (!acceptArtifactId(run, 'run id', context)) return;
        emit(guarded(run));
    };

    const guard = workflow
        .command('commit-guard')
        .summary('stage only the paths this run wrote; report the foreign ones')
        .description(
            [
                'Run-scoped commit guard for the inline driver: `start` fingerprints the tree before the',
                'run writes, `stage` stages only listed paths the run wrote, `check` reports foreign changes.',
                'Exit codes: 0 ok, 1 usage or failed probe (nothing staged), 2 stage refused a path.',
            ].join('\n'),
        );

    guard
        .command('start')
        .description('Fingerprint HEAD and the dirty working files into .spur/run/<run>-tree-start.json')
        .option('--run <id>', 'Run id the snapshot belongs to')
        .allowExcessArguments(false)
        .action((options) => withRun(options.run, (run) => commitGuardStart(run, { cwd: context.cwd })));

    guard
        .command('stage')
        .description('Stage only the listed paths this run wrote; print {staged, foreign}')
        .argument('[paths...]', 'Candidate paths (after `--`)')
        .option('--run <id>', 'Run id whose tree-start snapshot partitions the paths')
        .option('--base <sha>', 'Diff base (default: the snapshot HEAD)')
        .action((paths, options) =>
            withRun(options.run, (run) =>
                commitGuardStage(run, paths, {
                    cwd: context.cwd,
                    ...(options.base === undefined ? {} : { base: options.base }),
                }),
            ),
        );

    guard
        .command('check')
        .description('Report working-tree changes this run did not write; stage nothing')
        .option('--run <id>', 'Run id whose tree-start snapshot defines "written by this run"')
        .option('--base <sha>', 'Diff base (default: the snapshot HEAD)')
        .allowExcessArguments(false)
        .action((options) =>
            withRun(options.run, (run) =>
                commitGuardCheck(run, {
                    cwd: context.cwd,
                    ...(options.base === undefined ? {} : { base: options.base }),
                }),
            ),
        );
}
