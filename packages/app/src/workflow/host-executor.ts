import type { DbAdapter } from '@gobing-ai/spur-domain';
import { DbWorkflowPersistenceAdapter, type WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { readWorkItem, type WorkItem } from './receipt';

/**
 * Host executor selection (D65 1232, design `workflow-execution-foundation` §3.1/§3.2).
 *
 * The host executor is a run VAR — `vars.executor: 'host'` — resolved where the
 * fleet branch lives, never a flag (ADR-051 amendment). agent.run returns an
 * action-level pause; the engine persists its cursor so consumers wait for the
 * receipt and resume executes only the remaining actions.
 */

/** The run var value that selects the host executor. */
export const HOST_EXECUTOR = 'host';

/** True when the run's vars select the host executor. */
export function selectsHostExecutor(vars: Record<string, string | undefined> | undefined): boolean {
    return vars?.executor === HOST_EXECUTOR;
}

/**
 * Keep single-action node pause declarations for compatibility. State-machine
 * actions pause themselves so a state may safely consume the host output afterward.
 */
export function withHostExecutorPause(workflow: WorkflowDef): WorkflowDef {
    const runsAgentRun = (actions: readonly { kind: string }[] | undefined): boolean =>
        actions?.some((action) => action.kind === 'agent.run') === true;

    if (workflow.kind === 'transition-flow') {
        let changed = false;
        const nodes = workflow.nodes.map((node) => {
            if (node.pause === true || !runsAgentRun(node.action !== undefined ? [node.action] : undefined)) {
                return node;
            }
            changed = true;
            return { ...node, pause: true };
        });
        return changed ? { ...workflow, nodes } : workflow;
    }
    if (workflow.kind === 'dag') {
        let changed = false;
        const nodes = workflow.nodes.map((node) => {
            if (node.pause === true || !runsAgentRun(node.action !== undefined ? [node.action] : undefined)) {
                return node;
            }
            changed = true;
            return { ...node, pause: true };
        });
        return changed ? { ...workflow, nodes } : workflow;
    }
    // A state may have consumers after agent.run; only its action result can pause at that boundary.
    return workflow;
}

/**
 * True when the run was launched with `executor: host` — read from the run's last
 * persisted vars snapshot, the same source `--from-run` lineage uses. This is how a
 * resume knows to keep the pause transform on, before it has any caller vars.
 */
export async function hostExecutorPersisted(db: DbAdapter, runId: string): Promise<boolean> {
    const snapshot = await new DbWorkflowPersistenceAdapter(db).loadLatestStateSnapshot(runId);
    const raw = (snapshot?.data as { effectiveVars?: unknown } | undefined)?.effectiveVars;
    if (raw === null || typeof raw !== 'object') return false;
    return (raw as Record<string, unknown>).executor === HOST_EXECUTOR;
}

/**
 * Attach the host pause payload to a run result (design §4.3): the work item the
 * paused stage wrote. Additive — the engine's own result fields are untouched, and
 * a run that did not pause on THIS state (including a work item left by an earlier
 * host stage) gets no payload.
 */
export async function attachHostPause(
    fs: FileSystem,
    workdir: string,
    result: { status: string; runId: string; finalState: string } & Record<string, unknown>,
    db?: DbAdapter,
): Promise<void> {
    if (result.status !== 'paused') return;
    if (db !== undefined && result.mode === 'state-machine') {
        const snapshot = await new DbWorkflowPersistenceAdapter(db).loadLatestStateSnapshot(result.runId);
        if (snapshot?.data.actionResume === undefined) return;
    }
    const workItem: WorkItem | null = await readWorkItem(fs, workdir, result.runId);
    if (workItem === null || workItem.state !== result.finalState) return;
    result.pause = { kind: 'input', workItem };
}
