import type { Command } from '@commander-js/extra-typings';
import type { CliContext } from '../../context';
import { defaultAgentUsageSnapshotPath } from '../../services/agent-usage-source';
import { SHARED_OPTIONS } from '../shared-options';

/** Register `spur agent doctor`. */
export function registerAgentDoctorCommand(agent: Command, context: CliContext): void {
    agent
        .command('doctor')
        .description('Check agent readiness.')
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .argument('[agent]', 'Agent to check')
        .option('--probe-health', 'Opt into model health probing (liveness questions are never cached)')
        .option('--force-refresh', 'Bypass the detection cache, re-run, and rewrite it')
        .action(async (agentName, options) => {
            const svc = context.agentService();
            const code = await svc.doctor(
                {
                    json: options.json === true,
                    enveloped: options.jsonEnvelope,
                    agent: agentName,
                    probeHealth: options.probeHealth === true,
                    forceRefresh: options.forceRefresh === true,
                    // 0893 R2: report the producer snapshot (optional — missing renders `usage: none`).
                    usageSnapshotPath: defaultAgentUsageSnapshotPath(context.env),
                },
                undefined,
            );
            context.setExitCode(code);
        });
}
