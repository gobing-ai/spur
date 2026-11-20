/**
 * `spur agent doctor-hosts [--agents <csv>] [--out <file>]` (A94 1414 R1) — the host-capability
 * probe as a shipped verb: probes each installed coding host's binary, classifies the wake channel
 * it can PROVE from its `--help`, and writes the report.
 *
 * The guest-join E2E that used to accompany it stays a repository fixture (`fleet-e2e --host-probe`),
 * so this verb never launches a host.
 *
 * Exit: 0 when every row was probed, 1 when the report violated its contract, 2 for an unknown
 * `--agents` entry.
 */
import type { Command } from '@commander-js/extra-typings';
import { type HostProbeOutcome, runHostProbe } from '@gobing-ai/spur-app';
import { bootFree } from '../../boot-free-route';
import type { CliContext } from '../../context';
import { toEnvelopeJson, toJson } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';

/** Accumulate a comma list option into an array. */
function collectCsv(value: string, previous: string[]): string[] {
    return [
        ...previous,
        ...value
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean),
    ];
}

/** Register `spur agent doctor-hosts`. */
export function registerAgentDoctorHostsCommand(noun: Command, context: CliContext): void {
    bootFree(noun.command('doctor-hosts'))
        .summary('probe each installed coding host for its wake channel and version, then write the report')
        .option('--agents <csv>', 'agents to probe (repeatable; default codex,claude,pi)', collectCsv, [])
        .option(
            '--out <file>',
            'report path relative to the project (default docs/reports/fleet-host-capabilities.json)',
        )
        .option(...SHARED_OPTIONS.json)
        .option(...SHARED_OPTIONS.jsonEnvelope)
        .action(async (options) => {
            let outcome: HostProbeOutcome;
            try {
                outcome = await runHostProbe({
                    cwd: context.cwd,
                    ...(options.agents.length > 0 ? { agents: options.agents } : {}),
                    ...(options.out !== undefined ? { out: options.out } : {}),
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (options.json === true) {
                    context.output.write(toJson({ error: { code: 'host-probe', message } }));
                    context.setExitCode(1);
                    return;
                }
                context.output.error(`doctor-hosts: ${message}`);
                context.setExitCode(1);
                return;
            }
            if (options.json === true) {
                context.output.write(
                    toEnvelopeJson(
                        {
                            ok: outcome.ok,
                            reportPath: outcome.reportPath,
                            hosts: outcome.report?.hosts ?? [],
                            findings: outcome.ok
                                ? []
                                : outcome.lines.map((line) => ({ kind: 'host-probe', detail: line })),
                        },
                        { enveloped: options.jsonEnvelope === true },
                    ),
                );
            } else {
                for (const line of outcome.lines) context.output.write(line);
            }
            if (!outcome.ok) context.setExitCode(outcome.usage ? 2 : 1);
        });
}
