/**
 * CLI EventBus → `agent_executor_updates` persistence bridge (task 0799 R1).
 *
 * The dual of `system-event-ledger.ts`: quota events emitted during `spur
 * agent run` / `spur workflow run` / `spur team` executions persist into the
 * project SQLite delivery table, so the server can apply them even when it
 * was offline while the CLI run produced them. Same failure-isolation
 * contract as the ledger tap — persistence or validation failures surface on
 * stderr and never abort the run — plus the same flush-before-exit handle so
 * a process exit cannot drop a recorded observation (R1).
 */
import {
    type AgentQuotaEventBus,
    type AgentQuotaUpdatesAttachment,
    attachAgentQuotaUpdates,
} from '@gobing-ai/spur-app';
import type { CliContext } from './context';

/** Structural subset of {@link CliContext} the quota persistence needs. */
export type AgentQuotaPersistenceContext = Pick<CliContext, 'cwd' | 'getDb' | 'output' | 'loadAgentConfig'>;

/**
 * Attach quota-event persistence to a CLI-local bus. Attaching never opens
 * the database — rows are written per event with log-and-continue isolation,
 * so an unmigrated or locked DB degrades to observable warnings, not a
 * failed run. Flush the returned handle in the command's `finally` before
 * process exit.
 */
export function attachAgentQuotaPersistence(
    bus: AgentQuotaEventBus,
    context: AgentQuotaPersistenceContext,
): AgentQuotaUpdatesAttachment {
    return attachAgentQuotaUpdates(bus, {
        getDb: () => context.getDb(),
        projectRoot: context.cwd,
        loadAgentConfig: context.loadAgentConfig,
        warn: (message) => context.output.error(`Warning: ${message}`),
    });
}
