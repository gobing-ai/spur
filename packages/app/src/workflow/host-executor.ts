import type { DbAdapter } from '@gobing-ai/spur-domain';
import { DbWorkflowPersistenceAdapter, type WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';
import type { FileSystem } from '@gobing-ai/ts-runtime';
import { readWorkItem, type WorkItem } from './receipt';

/**
 * Host executor selection (D65 1232, design `workflow-execution-foundation` §3.1/§3.2).
 *
 * The host executor is a run VAR — `vars.executor: 'host'` — resolved where the
 * fleet branch lives, never a flag (ADR-051 amendment). The engine itself can only
 * pause on a definition declaration (`state.pause === true`), so a host run's
 * definition is transformed at the app seam: every stage that runs `agent.run`
 * pauses after its actions, which is exactly the engine's existing pause
 * primitive. Resume is `skip-enter`, so the stage is not re-executed — the host
 * performed it and `spur workflow continue --answer-text <receipt>` completes it.
 */

/** The run var value that selects the host executor. */
export const HOST_EXECUTOR = 'host';

/** True when the run's vars select the host executor. */
export function selectsHostExecutor(vars: Record<string, string | undefined> | undefined): boolean {
    return vars?.executor === HOST_EXECUTOR;
}

/**
 * Mark every state/node that runs `agent.run` with the engine's existing pause
 * declaration. Pure: the definition is never mutated, and a definition with no
 * `agent.run` stage comes back as the same object — a non-host run keeps the
 * identity it stamps, and a host run's digest covers the untransformed definition.
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
    let changed = false;
    const states = workflow.states.map((state) => {
        if (state.pause === true || !(runsAgentRun(state.onEnter) || runsAgentRun(state.onExit))) return state;
        changed = true;
        return { ...state, pause: true };
    });
    return changed ? { ...workflow, states } : workflow;
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
): Promise<void> {
    if (result.status !== 'paused') return;
    const workItem: WorkItem | null = await readWorkItem(fs, workdir, result.runId);
    if (workItem === null || workItem.state !== result.finalState) return;
    result.pause = { kind: 'input', workItem };
}
