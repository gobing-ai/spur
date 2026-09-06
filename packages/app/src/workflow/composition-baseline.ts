import crypto from 'node:crypto';
import type { ActionDef, StateMachineWorkflowDef, WorkflowDef } from '@gobing-ai/ts-dual-workflow-engine';

/**
 * Deterministically serializes a JSON-compatible object with sorted keys.
 *
 * @param obj - The value to stringify.
 * @returns Canonical sorted JSON string.
 */
export function canonicalJsonStringify(obj: unknown): string {
    if (obj === null || typeof obj !== 'object') {
        return JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
        return `[${obj.map(canonicalJsonStringify).join(',')}]`;
    }
    const keys = Object.keys(obj as Record<string, unknown>).sort();
    const entries = keys.map(
        (key) => `${JSON.stringify(key)}:${canonicalJsonStringify((obj as Record<string, unknown>)[key])}`,
    );
    return `{${entries.join(',')}}`;
}

/**
 * Computes canonical SHA-256 digest string (`sha256:<hex>`) over a workflow definition.
 *
 * @param workflow - The loaded workflow definition.
 * @returns SHA-256 digest string.
 */
export function computeDefinitionDigest(workflow: WorkflowDef): string {
    const canonical = canonicalJsonStringify(workflow);
    const hash = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
    return `sha256:${hash}`;
}

/**
 * Extracts normalized action facts, terminal states, and model-bearing states from a workflow.
 *
 * @param workflow - The loaded workflow definition.
 * @returns Extracted facts object.
 */
export function extractResolvedWorkflowFacts(workflow: WorkflowDef): {
    terminalStates: string[];
    modelQueries: string[];
    actions: Record<string, { kind: string; invocation?: string }>;
} {
    const sm = workflow as StateMachineWorkflowDef;
    const terminalStates = Array.isArray(sm.terminalStates) ? [...sm.terminalStates] : [];
    const modelQueries: string[] = [];
    const actions: Record<string, { kind: string; invocation?: string }> = {};

    if (Array.isArray(sm.states)) {
        for (const state of sm.states) {
            let hasModelQuery = false;
            if (Array.isArray(state.onEnter)) {
                state.onEnter.forEach((action: ActionDef, idx: number) => {
                    const key = `${state.id}:onEnter:${idx}`;
                    const invocation =
                        typeof action.options?.input === 'string'
                            ? action.options.input
                            : typeof action.options?.command === 'string'
                              ? action.options.command
                              : undefined;
                    actions[key] = {
                        kind: action.kind,
                        ...(invocation !== undefined ? { invocation } : {}),
                    };
                    if (action.kind === 'agent.run') {
                        hasModelQuery = true;
                    }
                });
            }
            if (Array.isArray(state.onExit)) {
                state.onExit.forEach((action: ActionDef, idx: number) => {
                    const key = `${state.id}:onExit:${idx}`;
                    const invocation =
                        typeof action.options?.input === 'string'
                            ? action.options.input
                            : typeof action.options?.command === 'string'
                              ? action.options.command
                              : undefined;
                    actions[key] = {
                        kind: action.kind,
                        ...(invocation !== undefined ? { invocation } : {}),
                    };
                    if (action.kind === 'agent.run') {
                        hasModelQuery = true;
                    }
                });
            }
            if (hasModelQuery) {
                modelQueries.push(state.id);
            }
        }
    }

    return {
        terminalStates,
        modelQueries,
        actions,
    };
}
