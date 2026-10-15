import type { Command } from '@commander-js/extra-typings';
import { AgentTraceService, type TraceTree } from '@gobing-ai/spur-app';
import type { CliContext } from '../../context';
import { toEnvelopeJson } from '../../output';
import { SHARED_OPTIONS } from '../shared-options';
import { DEFAULT_TRACE_FOLLOW_TIMEOUT_MS, parseTimeout } from './shared';

/** Register `spur agent trace`. */
export function registerAgentTraceCommand(agent: Command, context: CliContext): void {
    // Per-spec process lifecycle through the `spur serve` supervisor
    // ── agent trace (1076 R4, ADR-132) ────────────────────────────────────────────
    // The execution record, read as one lineage. Logic lives in `@gobing-ai/spur-app`
    // (`AgentTraceService`); this transport only renders it (ADR-130).
    agent
        .command('trace')
        .description('Print one execution record: the run, its dispatch lineage, session ids and streams.')
        .argument('<runId>', 'Run id to trace (a workflow run or an agent run)')
        .option('--follow', 'Poll until every run in the lineage reaches a terminal status')
        .option(...SHARED_OPTIONS.timeout, parseTimeout)
        .option(...SHARED_OPTIONS.json)
        .action(async (runId: string, options: { follow?: boolean; timeout?: number; json?: boolean }) => {
            const service = new AgentTraceService({ projectPath: context.cwd, openDb: () => context.getDb() });
            const render = (tree: TraceTree): void => {
                if (options.json === true) {
                    context.output.write(toEnvelopeJson(tree));
                    return;
                }
                context.output.write(
                    [`lineage ${tree.rootRunId} (${tree.nodes.length} run${tree.nodes.length === 1 ? '' : 's'})`]
                        .concat(
                            tree.nodes.map((node) => {
                                const sessions =
                                    node.sessionIds.length > 0 ? ` sessions=${node.sessionIds.join(',')}` : '';
                                const log = node.logPath !== null ? ` stream=${node.logPath}` : '';
                                const parent = node.parentRunId !== null ? ` parent=${node.parentRunId}` : '';
                                return `${node.kind}\t${node.runId}\t${node.status}${parent}${sessions}${log}`;
                            }),
                        )
                        .join('\n'),
                );
            };
            if (options.follow === true) {
                const { tree, timedOut } = await service.follow(runId, {
                    timeoutMs: options.timeout ?? DEFAULT_TRACE_FOLLOW_TIMEOUT_MS,
                });
                render(tree);
                if (timedOut) {
                    // One checkpoint line, exit 1, the runs continue — `spur workflow trace --follow` parity.
                    context.output.error(`checkpoint: lineage ${runId} still running at the follow timeout`);
                    context.setExitCode(1);
                }
                return;
            }
            render(await service.trace(runId));
        });
}
