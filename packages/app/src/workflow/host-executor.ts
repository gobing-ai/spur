import type { DbAdapter } from '@gobing-ai/spur-domain';
import {
    type ActionDef,
    DbWorkflowPersistenceAdapter,
    resolveTemplateString,
    type WorkflowDef,
} from '@gobing-ai/ts-dual-workflow-engine';
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

/** Gate kinds that stop a host run to wait for an operator answer (1248). */
const OPERATOR_PAUSE_KINDS = new Set(['hitl.confirm', 'hitl.select', 'hitl.input']);

/** The operator-pause gate a paused host run is waiting on (1248). */
export interface OperatorPauseGate {
    readonly kind: 'hitl.confirm' | 'hitl.select' | 'hitl.input';
    /** The gate action's declared options — the answer-var source. */
    readonly options: Record<string, unknown> | undefined;
    /** The gate's question, templates resolved against the paused snapshot's vars. */
    readonly prompt: string;
}

/**
 * The operator-pause gate a run is paused on (1248), read from the state snapshot's
 * `actionResume` cursor against the launched definition — the cursor's `nextAction` is
 * the first UNexecuted action, so the paused one sits at `nextAction - 1`.
 * Transition-flow nodes have one action and persist only the current node, with no cursor.
 *
 * `null` for other pauses: a host work item (`agent.run`), a declared state pause
 * (which persists no cursor), or a cursor addressing a non-gate action.
 */
export function operatorPauseAt(
    workflow: WorkflowDef,
    stateOrNodeId: string,
    data: Record<string, unknown> | undefined,
): OperatorPauseGate | null {
    if (data === undefined) return null;
    let action: ActionDef | undefined;
    if (workflow.kind === 'transition-flow' || workflow.kind === undefined) {
        action = actionsAt(workflow, stateOrNodeId, undefined)[0];
    } else {
        const cursor = data.actionResume as { phase?: string; nextAction?: number } | undefined;
        const nextAction = cursor?.nextAction;
        if (!Number.isInteger(nextAction) || (nextAction as number) < 1) return null;
        action = actionsAt(workflow, stateOrNodeId, cursor?.phase)[(nextAction as number) - 1];
    }
    if (action === undefined || !OPERATOR_PAUSE_KINDS.has(action.kind)) return null;
    const vars = (data?.effectiveVars ?? {}) as Record<string, string>;
    const rawPrompt = action.options?.prompt;
    return {
        kind: action.kind as OperatorPauseGate['kind'],
        options: action.options,
        prompt: typeof rawPrompt === 'string' ? resolveTemplateString(rawPrompt, { vars, env: {} }) : '',
    };
}

/** The action list a cursor phase addresses: state onEnter/onExit, else the node's single action. */
function actionsAt(workflow: WorkflowDef, stateOrNodeId: string, phase: string | undefined): readonly ActionDef[] {
    const def = workflow as {
        states?: readonly { id: string; onEnter?: readonly ActionDef[]; onExit?: readonly ActionDef[] }[];
        nodes?: readonly { id: string; action?: ActionDef }[];
    };
    const state = def.states?.find((candidate) => candidate.id === stateOrNodeId);
    if (state !== undefined) return (phase === 'exit' ? state.onExit : state.onEnter) ?? [];
    const node = def.nodes?.find((candidate) => candidate.id === stateOrNodeId);
    return node?.action !== undefined ? [node.action] : [];
}

/**
 * Attach the host pause payload to a run result (design §4.3): the work item the
 * paused stage wrote. Additive — the engine's own result fields are untouched, and
 * a run that did not pause on THIS state (including a work item left by an earlier
 * host stage) gets no payload.
 *
 * 1248: an operator-pause gate carries its question instead — the host relays it and
 * answers with `spur workflow continue --answer…`, never a work-item receipt. It is
 * classified first because a gate can pause in the same state an earlier `agent.run`
 * stage left a work item behind.
 */
export async function attachHostPause(
    fs: FileSystem,
    workdir: string,
    result: { status: string; runId: string; finalState: string } & Record<string, unknown>,
    db?: DbAdapter,
    workflow?: WorkflowDef,
): Promise<void> {
    if (result.status !== 'paused') return;
    const snapshot =
        db !== undefined ? await new DbWorkflowPersistenceAdapter(db).loadLatestStateSnapshot(result.runId) : undefined;
    const vars = snapshot?.data.effectiveVars as Record<string, string> | undefined;
    const gate =
        workflow !== undefined && selectsHostExecutor(vars)
            ? operatorPauseAt(workflow, result.finalState, snapshot?.data)
            : null;
    if (gate !== null) {
        result.pause = { reason: 'hitl-pause', kind: gate.kind, prompt: gate.prompt };
        return;
    }
    if (db !== undefined && result.mode === 'state-machine' && snapshot?.data.actionResume === undefined) return;
    const workItem: WorkItem | null = await readWorkItem(fs, workdir, result.runId);
    if (workItem === null || workItem.state !== result.finalState) return;
    result.pause = { kind: 'input', workItem };
}
