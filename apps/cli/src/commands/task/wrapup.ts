import type { Command } from '@commander-js/extra-typings';
import { acceptArtifactId } from '../../artifact-id';
import type { CliContext } from '../../context';
import { resolveSpurArgv, resolveSpurBin } from '../../workflow/resolve-spur-bin';

/** Every `spur task wrapup` operation (the seven steps plus the drift probe), in help order. */
const WRAPUP_OPS = [
    'resolve',
    'route-reason',
    'metrics',
    'feature-transition',
    'doc-sync-snapshot',
    'doc-sync-scope',
    'doc-supersession',
    'drift-probe',
] as const;

/**
 * Register `spur task wrapup <op>` — the wrapup-pipeline's deterministic steps (script-absorption
 * PR-5; replaces the plugin scripts `wrapup-steps` and `wrapup-drift-probe`).
 *
 * Thin transport: flags override the workflow env names the steps read (`__runId`, `tasks`,
 * `mode`, `feature`, `featureGateCmd`, `spurBin`); the steps and their artifacts live in
 * `@gobing-ai/spur-app/pipeline-steps`.
 */
export function registerTaskWrapupCommand(task: Command, context: CliContext): void {
    task.command('wrapup')
        .summary(
            'Run one deterministic wrapup-pipeline step (resolve, metrics, feature sync, doc-sync guards, drift probe).',
        )
        .description(
            [
                'Deterministic wrapup-pipeline steps; each writes its .spur/run/<runId>-* artifact and',
                'exits 0 once the step ran (the verdict lives in the status file). Exit 1 = mis-invocation',
                '(empty run id / feature), 2 = unknown op.',
                '  resolve              validate + dedupe the task list, resolve each task, feature pre-flight',
                '  route-reason         write the route reason from the capture, mode and drift probe',
                '  metrics              append one .spur/memory/wrapup-metrics.jsonl row per task',
                '  feature-transition   required feature sync, observation and the feature gate',
                '  doc-sync-snapshot    record the working listing at doc-sync entry',
                '  doc-sync-scope       fail on doc-sync writes outside docs/** (minus the corpus)',
                '  doc-supersession     re-run the supersession pin after doc-sync',
                '  drift-probe          classify doc-ownership drift and project mode=fast when clean',
                'Flags override the workflow env names: __runId, tasks, mode, feature, featureGateCmd, spurBin.',
            ].join('\n'),
        )
        .argument('<op>', `step: ${WRAPUP_OPS.join(' | ')}`)
        .option('--run-id <id>', 'workflow run id (env: __runId)')
        .option('--tasks <json>', 'JSON array of four-digit WBS strings (env: tasks)')
        .option('--mode <mode>', 'projected wrapup mode for route-reason (env: mode)')
        .option('--feature <id>', 'feature to pre-flight / transition (env: feature)')
        .option('--feature-gate-cmd <cmd>', 'trusted shell feature gate for feature-transition (env: featureGateCmd)')
        .option('--spur-bin <cmd>', 'spur invocation for nested lookups (env: spurBin; default: this spur)')
        .action(async (op, options) => {
            const { WRAPUP_STEP_OPS, isWrapupStepOp, runDriftProbe, runWrapupStep } = await import(
                '@gobing-ai/spur-app/pipeline-steps'
            );
            const env: Record<string, string | undefined> = { ...context.env };
            const overrides: Array<[string, string | undefined]> = [
                ['__runId', options.runId],
                ['tasks', options.tasks],
                ['mode', options.mode],
                ['feature', options.feature],
                ['featureGateCmd', options.featureGateCmd],
                ['spurBin', options.spurBin],
            ];
            for (const [key, value] of overrides) if (value !== undefined) env[key] = value;
            if (env.__runId && !acceptArtifactId(env.__runId, 'run id', context)) return;
            const spurArgv = env.spurBin === undefined ? resolveSpurArgv() : undefined;
            env.spurBin ??= resolveSpurBin();
            const runOptions = { cwd: context.cwd, spurArgv };
            if (op === 'drift-probe') {
                context.setExitCode(runDriftProbe(env, runOptions).exitCode);
                return;
            }
            if (!isWrapupStepOp(op)) {
                context.output.error(
                    `usage: spur task wrapup <${[...WRAPUP_STEP_OPS, 'drift-probe'].join('|')}>  (env: __runId, tasks, mode, feature, featureGateCmd, spurBin)`,
                );
                context.setExitCode(2);
                return;
            }
            context.setExitCode(runWrapupStep(op, env, runOptions));
        });
}
