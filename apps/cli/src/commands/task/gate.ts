import type { Command } from '@commander-js/extra-typings';
import { acceptArtifactId } from '../../artifact-id';
import type { CliContext } from '../../context';

/** Register `spur task gate` — the task-pipeline quality gate (script-absorption PR-3). */
export function registerTaskGateCommand(task: Command, context: CliContext): void {
    task.command('gate')
        .summary('Run the task-pipeline quality gate for a task.')
        .description(
            'Run one quality-gate mode for <wbs>, writing .spur/run/<wbs>-test-gate.{log,findings,status,attempt}:\n' +
                '  run       full tier: qualityGateCmd, retried and bounded; writes a check receipt when a proof digest is set\n' +
                '  recheck   full tier, skipping the receipt preconditions\n' +
                '  light     changed-scope tier (lint-changed on changed files, typecheck-changed and test-changed per touched workspace)\n' +
                '  deferred  light tier with a DEFERRED/FAIL status token (feature-level gate pending)\n' +
                '  status    print the {reuse, reason} receipt verdict and exit 0\n\n' +
                'Inputs come from the env (qualityGateCmd, gateProbeCmd, proofDigest, runId); the flags override them.\n\n' +
                'Exit codes: 0 PASS/DEFERRED/status, 1 FAIL, 2 usage error.',
        )
        .argument('<wbs>', 'Task WBS number')
        .argument('<mode>', 'Gate mode: run | recheck | light | deferred | status')
        .option('--cmd <command>', 'Full-tier gate command (overrides env qualityGateCmd)')
        .option('--probe-cmd <command>', 'Gate probe command (overrides env gateProbeCmd)')
        .option(
            '--proof-digest <digest>',
            'Proof-input digest bound into the check receipt (overrides env proofDigest)',
        )
        .option('--run-id <id>', 'Receipt run identity (overrides env runId; default pipeline-<wbs>)')
        .action(async (wbs, mode, options) => {
            if (!acceptArtifactId(wbs, 'task WBS', context)) return;
            const { qualityGateMain } = await import('@gobing-ai/spur-app/quality-gate');
            const env = {
                ...context.env,
                wbs,
                ...(options.cmd !== undefined ? { qualityGateCmd: options.cmd } : {}),
                ...(options.probeCmd !== undefined ? { gateProbeCmd: options.probeCmd } : {}),
                ...(options.proofDigest !== undefined ? { proofDigest: options.proofDigest } : {}),
                ...(options.runId !== undefined ? { runId: options.runId } : {}),
            };
            context.setExitCode(
                qualityGateMain([mode], env, { cwd: context.cwd, builder: context.spurConfig?.builder }),
            );
        });
}
