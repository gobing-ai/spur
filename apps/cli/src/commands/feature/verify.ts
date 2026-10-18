import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';

/**
 * Register `spur feature verify [id]` — the feature-verification pass (ADR-119, D63 task 0915).
 * The `feature-verification.yaml` wrapper workflow was retired by 1246: `feature-lifecycle`'s
 * `verifying` onEnter calls this verb directly.
 *
 * Thin transport over the app operation `runFeatureVerification`: resolve the
 * `feature-lifecycle` definition, record and register the RUNNING receipt, run the effective
 * command through the safe argv splitter, then complete PASS/FAIL plus the coarse
 * `.spur/run/<runId>-feature-verification.status`. Without `--run-id` the pass opens and
 * finalizes its own run row bound to the feature-lifecycle definition (1246 R2). Exits 0 after a
 * completed pass (PASS or FAIL — the done-edge guard reads the receipt); 1 when the pass could
 * not run (unsafe or missing ids, unknown feature, run-store errors).
 * Flags fall back to the workflow env names.
 */
export function registerFeatureVerifyCommand(feature: Command, context: CliContext): void {
    feature
        .command('verify')
        .summary('Run the feature-verification pass and record its bound PASS/FAIL evidence receipt.')
        .description(
            [
                'Runs the selected feature-verification definition’s command once (or --cmd) and writes the',
                'run-scoped + feature-latest receipts and .spur/run/<runId>-feature-verification.status.',
                'Exit: 0 after a completed pass (PASS or FAIL); 1 when the pass could not run.',
                'Without --run-id the pass opens and finalizes its own feature-lifecycle run row.',
                'Flags fall back to the workflow env names: featureId, __runId.',
            ].join('\n'),
        )
        .argument('[id]', 'Feature ID (env: featureId)')
        .option('--run-id <id>', 'workflow run id the receipt binds to (env: __runId)')
        .option('--cmd <command>', 'verification command override (env: verificationCmd)')
        .action(async (id, options) => {
            const { runFeatureVerification } = await import('@gobing-ai/spur-app');
            const env = context.env;
            const featureId = id || env.featureId || '';
            try {
                const result = await runFeatureVerification({
                    workdir: context.cwd,
                    featureId,
                    runId: options.runId || env.__runId || '',
                    cmdOverride: options.cmd || env.verificationCmd || '',
                });
                context.output.write(`feature verify: ${featureId} ${result.message}`);
            } catch (err) {
                context.output.error(`feature verify: ${String(err)}`);
                context.setExitCode(1);
            }
        });
}
