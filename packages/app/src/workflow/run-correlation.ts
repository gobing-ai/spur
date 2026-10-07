import type { WorkflowPersistenceAdapter } from '@gobing-ai/ts-dual-workflow-engine';

/**
 * Run correlation loaded from persisted run state (task 1113 R3): the workflow
 * name comes from the run row and the WBS from the latest snapshot's
 * effective vars. Both fields are optional — absent values stay absent and
 * nothing is inferred (feature P1 R7).
 */
export interface RunCorrelation {
    readonly workflowName?: string;
    readonly wbs?: string;
}

/**
 * A declared WBS counts as present only when it is a four-digit id that is not
 * the pipeline's `0000` placeholder (task 1113 refine correction). Empty,
 * non-numeric and placeholder values all count as absent.
 */
export function wbsFromVar(raw: unknown): string | undefined {
    return typeof raw === 'string' && /^\d{4}$/.test(raw) && raw !== '0000' ? raw : undefined;
}

/**
 * Load `{ workflowName, wbs }` for one run from persistence. Never throws: any
 * lookup failure (unknown run, closed db, malformed snapshot) returns `{}` so
 * correlation stays best-effort (design §5). The gate evaluator dep and the
 * inline-run decide driver both call this helper.
 */
export async function loadRunCorrelation(
    persistence: Pick<WorkflowPersistenceAdapter, 'loadRun' | 'loadLatestStateSnapshot'>,
    runId: string,
): Promise<RunCorrelation> {
    try {
        const run = await persistence.loadRun(runId);
        if (run === undefined) return {};
        const snapshot = await persistence.loadLatestStateSnapshot(runId);
        const vars = snapshot?.data.effectiveVars as Record<string, unknown> | undefined;
        const wbs = wbsFromVar(vars?.wbs);
        return {
            ...(run.workflow_name !== '' ? { workflowName: run.workflow_name } : {}),
            ...(wbs !== undefined ? { wbs } : {}),
        };
    } catch {
        return {};
    }
}
