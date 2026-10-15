import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';

/**
 * Register `spur feature verify [id]` — the feature-verification pass (ADR-119, D63 task 0915)
 * behind the bundled `feature-verification.yaml` workflow (script-absorption PR-5; replaces the plugin
 * script `feature-verification-steps`).
 *
 * Thin transport over the app operation `runFeatureVerification`: resolve the selected
 * `feature-verification` definition, record and register the RUNNING receipt, run the effective
 * command through the safe argv splitter, then complete PASS/FAIL plus the coarse
 * `.spur/run/<runId>-feature-verification.status`. Exits 0 after a completed pass (PASS or FAIL —
 * the workflow guard reads the status file); 1 when the pass could not run (unsafe or missing ids,
 * unknown feature, run-store errors). Flags fall back to the workflow env names.
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
                'Flags fall back to the workflow env names: featureId, __runId, verificationCmd, confidence, ackLowConfidence.',
            ].join('\n'),
        )
        .argument('[id]', 'Feature ID (env: featureId)')
        .option('--run-id <id>', 'workflow run id the receipt binds to (env: __runId)')
        .option('--cmd <command>', 'verification command override (env: verificationCmd)')
        .option('--confidence <level>', 'declared confidence HIGH | MEDIUM | LOW (env: confidence)')
        .option(
            '--ack-low-confidence',
            'acknowledge a LOW confidence level on the receipt (env: ackLowConfidence=true)',
        )
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
                    // Operator-declared level (empty = derive from the pass) and the acknowledgement of
                    // a LOW level. Both ride the receipt, so the completion boundary reads them from the
                    // evidence rather than from whatever flags a later transition passes.
                    confidenceOverride: options.confidence || env.confidence || '',
                    ackLowConfidence: options.ackLowConfidence === true || env.ackLowConfidence === 'true',
                });
                context.output.write(`feature verify: ${featureId} ${result.message}`);
            } catch (err) {
                context.output.error(`feature verify: ${String(err)}`);
                context.setExitCode(1);
            }
        });
}
